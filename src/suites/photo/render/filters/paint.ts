/** The paint filters' WGSL (shared/photo/effects/filters/paint.ts), mirroring `reference/filters/paint.ts`. */
import { BRISTLE_GAIN, CALM, DRIFT, FLAT, OIL_TAP_FLOATS, SHINE_GAIN, bristleScale, oilTaps } from "@shared/photo/reference/filters/paint.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const OIL_PAINT: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { count: u32, q: f32, shine: f32, bristles: f32, lx: f32, ly: f32, along: f32, across: f32, cell: f32, seed: u32, p0: f32, p1: f32 }
const W709 = vec3f(0.2126, 0.7152, 0.0722);
const SECTORS: u32 = 8u;
const TAP: u32 = ${OIL_TAP_FLOATS}u;
const CALM: f32 = ${CALM};
const FLAT: f32 = ${FLAT};
const DRIFT: f32 = ${DRIFT};

fn held(d: vec2f, p: vec2f) -> vec2f {
  if (p.x < 0.0 || p.y < 0.0 || p.x > header.canvas.x || p.y > header.canvas.y) { return d; }
  return clamp(d, vec2f(0.5), header.canvas - 0.5);
}

fn effect(p: vec2f, c: vec4f) -> vec4f {
  var mean: array<vec3f, 8>;
  var square: array<vec3f, 8>;
  var weight: array<f32, 8>;
  var full: array<f32, 8>;
  for (var t = 0u; t < params.count; t++) {
    let o = t * TAP;
    let s = src(held(p + vec2f(table[o], table[o + 1u]), p));
    let a = clamp(s.a, 0.0, 1.0);
    let v = enc3(unpremul(s));
    for (var k = 0u; k < SECTORS; k++) {
      let wt = table[o + 2u + k];
      let w = wt * a;
      full[k] += wt;
      weight[k] += w;
      mean[k] += w * v;
      square[k] += w * v * v;
    }
  }
  // Each sector's mean and spread; the calmest one's spread.
  var spread: array<f32, 8>;
  var calmest = 3.0e38;
  for (var k = 0u; k < SECTORS; k++) {
    if (!(weight[k] > 0.0)) { continue; }
    mean[k] = mean[k] / weight[k];
    let var3 = square[k] / weight[k] - mean[k] * mean[k];
    spread[k] = sqrt(max(0.0, var3.r + var3.g + var3.b));
    calmest = min(calmest, spread[k]);
  }
  var v = vec3f(0.0);
  var total = 0.0;
  var g = vec2f(0.0);
  for (var k = 0u; k < SECTORS; k++) {
    if (!(weight[k] > 0.0)) { continue; }
    let alpha = pow((CALM + calmest) / (CALM + spread[k]), params.q);
    total += alpha;
    v += alpha * mean[k];
    // The sector's brightness (none where it's uncovered) towards its axis: the paint's slope.
    let l = dot(W709, mean[k]) * (weight[k] / full[k]);
    let a = f32(k) * 2.0 * PI / f32(SECTORS);
    g += l * vec2f(cos(a), sin(a));
  }
  if (!(total > 0.0)) { return c; }
  g = g * (2.0 / f32(SECTORS));
  // The strokes' direction: across the slope (doubled angles), or a slow drift about the diagonal.
  let drift = PI / 2.0 + (vnoise(p / (6.0 * params.cell), params.seed + 9u) - 0.5) * 2.0 * DRIFT;
  let dd = vec2f(g.x * g.x - g.y * g.y + FLAT * cos(drift), 2.0 * g.x * g.y + FLAT * sin(drift));
  let theta = 0.5 * atan2(dd.y, dd.x);
  let ax = -sin(theta);
  let ay = cos(theta);
  // Bristles: each of the four nearest patches' streaks, turned to the stroke, blended.
  let qq = p / params.cell;
  let i0 = floor(qq);
  let f = qq - i0;
  let sm = f * f * (3.0 - 2.0 * f);
  var streak = 0.0;
  for (var n = 0; n < 4; n++) {
    let ox = n & 1;
    let oy = n >> 1u;
    let ix = i32(i0.x) + ox;
    let iy = i32(i0.y) + oy;
    let o0 = p - vec2f(f32(ix), f32(iy)) * params.cell;
    let u = (o0.x * ax + o0.y * ay) / params.along;
    let w = (o0.x * ay - o0.y * ax) / params.across;
    let cc = vec2f(rand(ix, iy, params.seed) * 64.0, rand(ix, iy, params.seed + 1u) * 64.0);
    let h = 0.5 * (vnoise(cc + vec2f(u, w), params.seed + 2u) + vnoise(cc - vec2f(u, w), params.seed + 2u));
    streak += select(1.0 - sm.x, sm.x, ox == 1) * select(1.0 - sm.y, sm.y, oy == 1) * h;
  }
  // The relief lit towards white or shaded towards black, then the bristles' streaks, relatively.
  let relief = clamp(-(g.x * params.lx + g.y * params.ly) * params.shine, -1.0, 1.0);
  let hi = max(relief, 0.0) * 0.7;
  let lo = min(relief, 0.0) * 0.8;
  let streaked = 1.0 + (streak - 0.5) * 2.0 * params.bristles;
  let m = v / total;
  return from_encoded(clamp((m + hi * (1.0 - m) + lo * m) * streaked, vec3f(0.0), vec3f(1.0)), c.a);
}`,
  pack: (p) => {
    const radius = p.radius as number;
    const taps = oilTaps(radius);
    const angle = ((p.angle as number) * Math.PI) / 180;
    const { along, across, patch } = bristleScale(radius);
    return {
      uniform: packValues([
        { u32: taps.length / OIL_TAP_FLOATS },
        p.sharpness as number,
        ((p.shine as number) / 100) * SHINE_GAIN,
        ((p.bristles as number) / 100) * BRISTLE_GAIN,
        Math.cos(angle),
        -Math.sin(angle),
        along,
        across,
        patch,
        { u32: p.seed as number },
        0,
        0,
      ]),
      table: taps,
      tableKey: `oil-paint:${radius}`,
    };
  },
};

export const PAINT_KERNELS: Record<string, FilterKernel> = { "oil-paint": OIL_PAINT };
