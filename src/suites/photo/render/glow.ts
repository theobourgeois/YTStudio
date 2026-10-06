/**
 * The glow's GPU passes (shared/photo/effects/glow.ts; the plan's "Evaluation"): the contribution (a soft knee on
 * linear luminance), the pyramid's box (the compositor's `reduce`), a separable Gaussian at an octave's level, and
 * the apply pass, which reads every octave by its cubic B-spline at each target pixel's document point and adds
 * the light to the layer's content. Octaves live on grids aligned to the document's 2^k (an origin and a spacing),
 * so the screen, export regions and refinements need not share a grid: only `shared/photo/reference/glow.ts`'s
 * numbers.
 */
import { gaussianWeights } from "@shared/photo/reference/glow.ts";
import { GLOW_SIGMAS, type GlowShape, type Octave } from "@shared/photo/effects/glow.ts";
import { ROUND_FOR_STORE, type StorageFormat } from "./kernels.ts";
import { MATHS } from "./wgsl.ts";

/** At most this many taps either side of a Gaussian (an octave's σ is under 3 texels of its level). */
export const MAX_TAPS = 15;

/** An octave as one evaluation reads it: at level `at` (its own, or coarser for a reduced view), with its σ there. */
export interface PlacedOctave extends Octave {
  at: number;
  /** σ in texels of `at`. */
  atTexels: number;
  atTaps: number;
}

/** The octaves read at base level `base`: each at its own level, or the base's when that's coarser. */
export function placeOctaves(shape: GlowShape, base: number): PlacedOctave[] {
  return shape.octaves.map((o) => {
    const at = Math.max(o.level, base);
    const atTexels = o.sigma / 2 ** at;
    return { ...o, at, atTexels, atTaps: Math.min(MAX_TAPS, Math.max(1, Math.ceil(GLOW_SIGMAS * atTexels))) };
  });
}

/** How far from a texel of its input an octave read at `at` reaches, in document pixels (its taps, the B-spline's 2, one more). */
export const placedReach = (o: PlacedOctave) => (o.atTaps + 3) * 2 ** o.at;

/** The contribution: premultiplied rgb where its unassociated colour's luminance passes the knee (alpha 0). */
export const CONTRIBUTION = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${MATHS}
struct Params { threshold: f32, knee: f32, p0: f32, p1: f32 }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = textureLoad(src, vec2i(pos.xy), 0);
  if (!(c.a > 0.0)) { return vec4f(0.0); }
  let un = c.rgb / c.a;
  let y = 0.2126 * un.r + 0.7152 * un.g + 0.0722 * un.b;
  let hi = params.threshold;
  let lo = params.threshold * (1.0 - params.knee);
  var k = 0.0;
  if (y >= hi) { k = 1.0; } else if (y > lo) { let t = (y - lo) / (hi - lo); k = t * t * (3.0 - 2.0 * t); }
  return round_for_store(vec4f(c.rgb * k, 0.0));
}
`;

/** One direction of a Gaussian over a region of `size`, transparent past it (weights normalised in TypeScript). */
export const BLUR = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${MATHS}
struct Params { size: vec2i, dir: vec2i, taps: i32, p0: i32, p1: i32, p2: i32, w: array<vec4f, 8> }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = vec2i(floor(pos.xy));
  var sum = vec3f(0.0);
  for (var i = -params.taps; i <= params.taps; i++) {
    let q = p + params.dir * i;
    if (q.x < 0 || q.y < 0 || q.x >= params.size.x || q.y >= params.size.y) { continue; }
    let k = u32(i + params.taps);
    sum += textureLoad(src, q, 0).rgb * params.w[k / 4u][k % 4u];
  }
  return round_for_store(vec4f(sum, 0.0));
}
`;

/** A blur pass's uniform: 16 + 16 + 128 bytes. */
export function blurUniform(width: number, height: number, horizontal: boolean, o: PlacedOctave): ArrayBuffer {
  const data = new ArrayBuffer(160);
  new Int32Array(data, 0, 5).set([width, height, horizontal ? 1 : 0, horizontal ? 0 : 1, o.atTaps]);
  new Float32Array(data, 32, 32).set(gaussianWeights(o.atTexels, o.atTaps));
  return data;
}

/** Octaves the apply pass reads at once. */
export const APPLY_OCTAVES = 6;

/**
 * The apply pass: the layer's content (`content`, on the target's grid) plus the light, every octave read by the
 * cubic B-spline on its own grid; where the content had no coverage the light's is its `max` (D1).
 */
export const APPLY = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${MATHS}
struct Octave { origin: vec2f, inv: f32, weight: f32, size: vec2f, p0: f32, p1: f32 }
struct Params { origin: vec2f, zoom: f32, count: u32, tint: vec4f, gain: f32, p0: f32, p1: f32, p2: f32, octaves: array<Octave, ${APPLY_OCTAVES}> }
@group(0) @binding(0) var content: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;
${Array.from({ length: APPLY_OCTAVES }, (_, i) => `@group(0) @binding(${i + 2}) var o${i}: texture_2d<f32>;`).join("\n")}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

fn bspline(x: f32) -> f32 {
  let t = abs(x);
  if (t < 1.0) { return (4.0 - 6.0 * t * t + 3.0 * t * t * t) / 6.0; }
  if (t < 2.0) { let u = 2.0 - t; return u * u * u / 6.0; }
  return 0.0;
}

${Array.from(
  { length: APPLY_OCTAVES },
  (_, n) => /* wgsl */ `
fn read${n}(p: vec2f) -> vec3f {
  let o = params.octaves[${n}];
  let u = (p - o.origin) * o.inv - 0.5;
  let base = vec2i(floor(u));
  var sum = vec3f(0.0);
  for (var j = -1; j <= 2; j++) {
    let y = base.y + j;
    if (y < 0 || y >= i32(o.size.y)) { continue; }
    let wy = bspline(u.y - f32(y));
    for (var i = -1; i <= 2; i++) {
      let x = base.x + i;
      if (x < 0 || x >= i32(o.size.x)) { continue; }
      sum += textureLoad(o${n}, vec2i(x, y), 0).rgb * (wy * bspline(u.x - f32(x)));
    }
  }
  return sum * o.weight;
}`,
).join("\n")}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = params.origin + pos.xy / params.zoom;
  var s = vec3f(0.0);
${Array.from({ length: APPLY_OCTAVES }, (_, n) => `  if (params.count > ${n}u) { s += read${n}(p); }`).join("\n")}
  let y = 0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b;
  let light = mix(s, params.tint.rgb * y, params.tint.a) * params.gain;
  let c = textureLoad(content, vec2i(pos.xy), 0);
  let coverage = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
  return round_for_store(vec4f(c.rgb + light, c.a + coverage * (1.0 - c.a)));
}
`;

/** One octave's place for the apply pass: its texture's grid and size, and its weight. */
export interface OctaveRead {
  texture: GPUTexture;
  /** The document point at its texel (0, 0)'s top-left corner. */
  origin: { x: number; y: number };
  /** Document pixels per texel (2^level). */
  spacing: number;
  width: number;
  height: number;
  weight: number;
}

/** The apply pass's uniform: 48 bytes, then 32 an octave. */
export function applyUniform(view: { x: number; y: number; zoom: number }, shape: GlowShape, reads: readonly OctaveRead[]): ArrayBuffer {
  const data = new ArrayBuffer(48 + 32 * APPLY_OCTAVES);
  const f = new Float32Array(data);
  f.set([view.x, view.y, view.zoom]);
  new Uint32Array(data, 12, 1)[0] = reads.length;
  f.set([...shape.tint, shape.tintAmount, shape.gain], 4);
  reads.forEach((r, i) => f.set([r.origin.x, r.origin.y, 1 / r.spacing, r.weight, r.width, r.height, 0, 0], 12 + i * 8));
  return data;
}
