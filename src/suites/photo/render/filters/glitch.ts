/** The glitch filters' WGSL (shared/photo/effects/filters/glitch.ts), mirroring `reference/filters/glitch.ts`. */
import { type FilterKernel, packValues } from "../kernel.ts";

const RGB_SPLIT: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { distance: f32, angle: f32, radial: u32, anaglyph: u32 }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  var d = vec2f(cos(params.angle), sin(params.angle)) * params.distance;
  if (params.radial == 1u) {
    d = (p - header.canvas / 2.0) / (length(header.canvas) / 2.0) * params.distance;
  }
  let r = src(p - d);
  let b = src(p + d);
  if (params.anaglyph == 1u) { return vec4f(r.r, b.g, b.b, max(r.a, b.a)); }
  return vec4f(r.r, c.g, b.b, max(r.a, max(c.a, b.a)));
}`,
  pack: (p) => ({ uniform: packValues([p.distance as number, ((p.angle as number) * Math.PI) / 180, { u32: p.mode === "radial" ? 1 : 0 }, { u32: p.pair === "anaglyph" ? 1 : 0 }]) }),
};

const GLITCH: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { h: f32, thin: f32, size: f32, shift: f32, density: f32, blocks: f32, split: f32, seed: u32 }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let seed = params.seed;
  let shift = params.shift;
  let row = i32(floor(p.y / params.h));
  var on_a = 0.0;
  if (rand(row, 0, seed) < params.density) { on_a = 1.0; }
  var dx = on_a * (rand(row, 1, seed) * 2.0 - 1.0) * shift;
  let swap = on_a == 1.0 && rand(row, 2, seed) > 0.88;
  let row_b = i32(floor(p.y / params.thin));
  var on_b = 0.0;
  if (rand(row_b, 0, seed + 17u) < params.density * 0.5) { on_b = 1.0; }
  dx += on_b * (rand(row_b, 1, seed + 17u) * 2.0 - 1.0) * shift * 0.35;
  var hit = max(on_a, on_b);
  var dy = 0.0;
  let size = params.size;
  let cy = i32(floor(p.y / size));
  let cx = i32(floor((p.x + rand(cy, 5, seed + 31u) * size) / size));
  var corrupt = 0.0;
  if (rand(cx, cy, seed + 37u) < params.blocks * 0.45) {
    hit = 1.0;
    let kind = rand(cx, cy, seed + 41u);
    if (kind < 0.5) {
      dx += (rand(cx, cy, seed + 43u) * 2.0 - 1.0) * shift;
      dy += (rand(cx, cy, seed + 47u) * 2.0 - 1.0) * shift * 0.5;
    } else if (kind < 0.78) {
      dy += floor((f32(cy) + rand(cx, cy, seed + 53u)) * size) + 0.5 - p.y;
    } else {
      corrupt = kind;
    }
  }
  dx = clamp(floor(dx + 0.5), -shift, shift);
  dy = clamp(floor(dy + 0.5), -shift, shift);
  var side = 1.0;
  if (rand(1, 2, seed + 59u) < 0.5) { side = -1.0; }
  var reach = 0.35;
  if (hit == 1.0) { reach = 1.0; }
  let s = params.split * reach * side;
  // Past the canvas's edge, its last pixels are read again (smeared) rather than nothing.
  let lo = min(p, vec2f(0.5 * px()));
  let hi = max(p, header.canvas - 0.5 * px());
  let r = src(clamp(vec2f(p.x + dx + s, p.y + dy), lo, hi));
  let g = src(clamp(vec2f(p.x + dx, p.y + dy), lo, hi));
  let b = src(clamp(vec2f(p.x + dx - s, p.y + dy), lo, hi));
  var out = vec4f(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
  if (swap) { out = vec4f(out.g, out.b, out.r, out.a); }
  if (corrupt > 0.0) {
    var v = floor(enc3(unpremul(out)) * 4.0 + 0.5) / 4.0;
    if (corrupt > 0.9) { v = v.gbr; }
    out = from_encoded(v, out.a);
  }
  return out;
}`,
  pack: (p) => {
    const h = p.sliceHeight as number;
    return { uniform: packValues([h, h * 0.31, 2 * h, p.shift as number, (p.density as number) / 100, (p.blocks as number) / 100, p.split as number, { u32: p.seed as number }]) };
  },
};

const VHS: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { bleed: f32, jitter: f32, lh: f32, tracking: f32, band_y: f32, band_h: f32, scan: f32, noise: f32, wash: f32, seed: u32, p0: f32, p1: f32 }
const W709 = vec3f(0.2126, 0.7152, 0.0722);
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let seed = params.seed;
  let jitter = params.jitter;
  let lh = params.lh;
  let bleed = params.bleed;
  let line = i32(floor(p.y / lh));
  let band = (1.0 - smoothstep(0.0, 1.0, abs((f32(line) + 0.5) * lh - params.band_y) / params.band_h)) * params.tracking;
  let dx = (vnoise(vec2f(f32(line) * 0.23, 0.0), seed) - 0.5) * 2.0 * jitter + (rand(line, 7, seed) - 0.5) * 0.7 * jitter + band * (0.3 + 0.7 * rand(line, 11, seed)) * 4.65 * jitter;
  let qx = p.x + dx;
  let s0 = src(vec2f(qx, p.y));
  let left = src(vec2f(qx - bleed / 6.0, p.y));
  let right = src(vec2f(qx + bleed / 6.0, p.y));
  var sum = s0 + left;
  for (var k = 2; k <= 6; k++) {
    sum += src(vec2f(qx - bleed * f32(k) / 6.0, p.y));
  }
  let lum = 0.25 * dot(W709, enc3(unpremul(left))) + 0.5 * dot(W709, enc3(unpremul(s0))) + 0.25 * dot(W709, enc3(unpremul(right)));
  let vb = enc3(unpremul(sum));
  let yb = dot(W709, vb);
  var v = clamp(vb - yb + lum, vec3f(0.0), vec3f(1.0));
  let a = max(max(s0.a, left.a), max(right.a, sum.a / 7.0));
  let w = params.wash;
  let yv = dot(W709, v);
  v = (mix(v, vec3f(yv), 0.5 * w) * (1.0 - 0.15 * w) + w * vec3f(0.1, 0.075, 0.05)) * vec3f(1.0 + 0.05 * w, 1.0, 1.0 - 0.06 * w);
  let streak = rand(i32(floor(p.x / (lh * 8.0))), line, seed + 5u);
  v = mix(v + band * 0.06, vec3f(1.0), band * smoothstep(0.82, 1.0, streak) * 0.8);
  let fine = smoothstep(1.0, 2.0, lh / px());
  let dark = params.scan * 0.6 * (0.5 + 0.5 * cos(2.0 * PI * fract((p.y - 0.5) / lh))) * fine;
  let n = rand(i32(floor(p.x)), i32(floor(p.y)), seed + 3u);
  let amp = params.noise * 0.3 + band * 0.25;
  v = clamp(v * (1.0 - dark) + (n - 0.5) * amp, vec3f(0.0), vec3f(1.0));
  return from_encoded(v, a);
}`,
  pack: (p, canvas) =>
    ({
      uniform: packValues([
        p.bleed as number,
        p.jitter as number,
        p.lineHeight as number,
        (p.tracking as number) / 100,
        ((p.band as number) / 100) * canvas.height,
        0.05 * canvas.height,
        (p.scanlines as number) / 100,
        (p.noise as number) / 100,
        (p.wash as number) / 100,
        { u32: p.seed as number },
      ]),
    }),
};

export const GLITCH_KERNELS: Record<string, FilterKernel> = { "rgb-split": RGB_SPLIT, glitch: GLITCH, vhs: VHS };
