/**
 * The Lens Flare's GPU pass (shared/photo/effects/flare.ts): every enabled element evaluated at each target pixel's
 * document point, added together, written as premultiplied linear light whose coverage is its `max` (Unmult, as
 * any light's). The arithmetic is `shared/photo/reference/flare.ts`'s, element by element; the elements are packed
 * here, where their centres, colours and gains are worked out once.
 */
import { hexToLinear } from "@shared/photo/colour.ts";
import { flareShape } from "@shared/photo/effects/flare.ts";
import { elementCentre } from "@shared/photo/reference/flare.ts";
import type { EffectParamValue } from "@shared/photo/types.ts";
import { ROUND_FOR_STORE, type StorageFormat } from "./kernels.ts";
import { MATHS } from "./wgsl.ts";

/** Floats per packed element. */
const ELEMENT_FLOATS = 16;
const TYPES: Record<string, number> = { glow: 0, halo: 1, ghost: 2, streak: 3 };

/**
 * The elements as the shader reads them: [cx, cy, type, size, r, g, b, p0…p8] each, r g b being the element's
 * tint × 2^intensity × the flare's colour × 2^intensity. Per type: glow p0 falloff, p1 core; halo p0 thickness (%),
 * p1 spread (%); ghost p0 polygon, p1 sides, p2 rotation (radians), p3 softness (%), p4 rim (%), p5 chroma (%);
 * streak p0 angle (radians), p1 thickness (px), p2 haze (%).
 */
export function packFlare(params: Record<string, EffectParamValue>, canvas: { width: number; height: number }): { data: Float32Array; count: number } {
  const shape = flareShape(params, canvas, hexToLinear);
  const out = new Float32Array(Math.max(1, shape.elements.length) * ELEMENT_FLOATS);
  shape.elements.forEach((e, i) => {
    const [cx, cy] = elementCentre(shape, e);
    const tint = hexToLinear(e.tint as string);
    const k = 2 ** (e.intensity as number);
    const n = (key: string) => e[key] as number;
    const rad = (key: string) => (n(key) * Math.PI) / 180;
    const own =
      e.type === "glow"
        ? [n("falloff"), n("core")]
        : e.type === "halo"
          ? [n("thickness"), n("spread")]
          : e.type === "ghost"
            ? [e.shape === "polygon" ? 1 : 0, Math.round(n("sides")), rad("rotation"), n("softness"), n("rim"), n("chroma")]
            : [rad("angle"), n("thickness"), n("haze")];
    out.set([cx, cy, TYPES[e.type] ?? -1, n("size"), ...tint.map((t, c) => t * k * shape.gain[c]), ...own], i * ELEMENT_FLOATS);
  });
  return { data: out, count: shape.elements.length };
}

/** The pass: group 0 is its uniform (the target's grid and the element count) and the packed elements. */
export const FLARE_SHADER = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${MATHS}
struct Params { origin: vec2f, zoom: f32, count: u32 }
struct Element { centre: vec2f, kind: f32, size: f32, rgb: vec3f, p0: f32, p1: f32, p2: f32, p3: f32, p4: f32, p5: f32, p6: f32, p7: f32, p8: f32 }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> elements: array<Element>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

const PI = 3.141592653589793;

// A Gaussian edge widened by a pixel's footprint: its width (x) and how much it dims to keep its energy (y).
fn widen(width: f32, footprint: f32) -> vec2f {
  let w = sqrt(width * width + footprint * footprint * 0.5);
  return vec2f(w, width / w);
}

// Inigo Quilez's sdRegularPolygon: the distance to a regular polygon of circumradius r (negative inside).
fn polygon_distance(q: vec2f, r: f32, n: f32) -> f32 {
  let an = PI / n;
  let raw = atan2(q.x, q.y);
  let period = 2.0 * an;
  let bn = raw - period * floor(raw / period) - an;
  let len = length(q);
  var px = len * cos(bn) - r * cos(an);
  var py = len * abs(sin(bn)) - r * sin(an);
  py += min(max(-py, 0.0), r * sin(an));
  return length(vec2f(px, py)) * sign(px);
}

fn profile(e: Element, d: vec2f, footprint: f32) -> vec3f {
  let size = max(e.size, 1e-3);
  let r = length(d);
  if (e.kind == 0.0) {
    let s = widen(size, footprint);
    let body = s.y * s.y / (1.0 + pow(r / s.x, e.p0));
    let c = widen(size * 0.3, footprint);
    let core = (e.p1 / 100.0) * c.y * c.y * exp(-(r / c.x) * (r / c.x));
    return vec3f(body + core);
  }
  if (e.kind == 1.0) {
    let th = widen(size * e.p0 / 100.0, footprint);
    let spread = (e.p1 / 100.0) * th.x;
    var out = vec3f(0.0);
    for (var c = 0; c < 3; c++) {
      let dd = r - (size + f32(1 - c) * spread);
      out[c] = th.y * exp(-(dd / th.x) * (dd / th.x));
    }
    return out;
  }
  if (e.kind == 2.0) {
    let turn = e.p2;
    let q = vec2f(d.x * cos(turn) + d.y * sin(turn), -d.x * sin(turn) + d.y * cos(turn));
    let rim = e.p4 / 100.0;
    var out = vec3f(0.0);
    for (var c = 0; c < 3; c++) {
      let sc = size * (1.0 + f32(1 - c) * e.p5 / 100.0);
      var dist = r - sc;
      if (e.p0 > 0.5) { dist = polygon_distance(q, sc, e.p1); }
      let edge = widen(sc * 0.08, footprint);
      let soft = max(sc * e.p3 / 100.0, edge.x);
      let body = 1.0 - smoothstep(-soft, edge.x, dist);
      let ring = edge.y * exp(-(dist / edge.x) * (dist / edge.x));
      out[c] = body * (1.0 - rim) + ring * rim;
    }
    return out;
  }
  if (e.kind == 3.0) {
    let along = d.x * cos(e.p0) + d.y * sin(e.p0);
    let across = -d.x * sin(e.p0) + d.y * cos(e.p0);
    let th = widen(e.p1, footprint);
    let core = th.y * exp(-(across / th.x) * (across / th.x)) * exp(-abs(along) / size);
    let haze = (e.p2 / 100.0) * exp(-abs(across) / (th.x * 6.0)) * exp(-abs(along) / (size * 0.5));
    return vec3f(core + haze);
  }
  return vec3f(0.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = params.origin + pos.xy / params.zoom;
  let footprint = max(1.0, 1.0 / params.zoom);
  var light = vec3f(0.0);
  for (var i = 0u; i < params.count; i++) {
    let e = elements[i];
    light += profile(e, p - e.centre, footprint) * e.rgb;
  }
  // Light's coverage is its brightest channel (held to 1): colour is never without alpha.
  let a = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
  return round_for_store(vec4f(light, a));
}
`;
