/** The cells filters' WGSL (shared/photo/effects/filters/cells.ts), mirroring `reference/filters/cells.ts`. */
import { dec3, hexEncoded } from "@shared/photo/reference/kernel.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

/** Where a cell reads its content (reference: held, in stylize.ts). */
const HELD = /* wgsl */ `
fn held(d: vec2f, p: vec2f) -> vec2f {
  if (p.x < 0.0 || p.y < 0.0 || p.x > header.canvas.x || p.y > header.canvas.y) { return d; }
  return clamp(d, vec2f(0.5), header.canvas - 0.5);
}`;

/** Seeded sites and the Voronoi cell a point is in (reference: site, voronoi), and a cell's colour (cellColour). */
const VORONOI = /* wgsl */ `
${HELD}
const W709 = vec3f(0.2126, 0.7152, 0.0722);

fn site(i: i32, j: i32, size: f32, jitter: f32, seed: u32) -> vec2f {
  return vec2f((f32(i) + 0.5 + (rand(i, j, seed) - 0.5) * jitter) * size, (f32(j) + 0.5 + (rand(i, j, seed + 1u) - 0.5) * jitter) * size);
}

// The nearest site a (and its grid cell), the neighbour b across the nearest edge (and its cell), the distance e to
// that edge and d to a.
struct Cells { a: vec2f, b: vec2f, ia: vec2i, ib: vec2i, e: f32, d: f32 }

fn voronoi(p: vec2f, size: f32, jitter: f32, seed: u32) -> Cells {
  let g = vec2i(floor(p / size));
  var sites: array<vec2f, 9>;
  var best = 0;
  var best_d = 3.0e38;
  for (var k = 0; k < 9; k++) {
    let s = site(g.x + k % 3 - 1, g.y + k / 3 - 1, size, jitter, seed);
    sites[k] = s;
    let o = p - s;
    let d = o.x * o.x + o.y * o.y;
    if (d < best_d) { best_d = d; best = k; }
  }
  let a = sites[best];
  var b = a;
  var kb = best;
  var e = 3.0e38;
  for (var k = 0; k < 9; k++) {
    if (k == best) { continue; }
    let s = sites[k];
    let nrm = s - a;
    let ek = -dot(p - (a + s) / 2.0, nrm) / max(length(nrm), 1e-6);
    if (ek < e) { e = ek; b = s; kb = k; }
  }
  return Cells(a, b, vec2i(g.x + best % 3 - 1, g.y + best / 3 - 1), vec2i(g.x + kb % 3 - 1, g.y + kb / 3 - 1), e, sqrt(best_d));
}

fn cell_colour(p: vec2f, s: vec2f, size: f32) -> vec4f {
  var sum = vec4f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      sum += src(held(vec2f(s.x + f32(i) * 0.25 * size, s.y + f32(j) * 0.25 * size), p));
    }
  }
  return sum / 9.0;
}`;

const CRYSTALLIZE: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { size: f32, jitter: f32, facets: f32, seed: u32 }
${VORONOI}

fn look(p: vec2f, s: vec2f, id: vec2i) -> vec4f {
  let avg = cell_colour(p, s, params.size);
  if (!(params.facets > 0.0)) { return avg; }
  let t = rand(id.x, id.y, params.seed + 2u) * 2.0 * PI;
  let k = 1.0 + params.facets * 1.2 * ((p.x - s.x) * cos(t) + (p.y - s.y) * sin(t)) / params.size;
  let v = enc3(unpremul(avg));
  return from_encoded(clamp(v * k, vec3f(0.0), vec3f(1.0)), avg.a);
}

fn effect(p: vec2f, c: vec4f) -> vec4f {
  let v = voronoi(p, params.size, params.jitter, params.seed);
  let ca = look(p, v.a, v.ia);
  let aa = 0.5 * px();
  let w = smoothstep(-aa, aa, v.e);
  if (w >= 1.0) { return ca; }
  return mix(look(p, v.b, v.ib), ca, w);
}`,
  pack: (p) => ({ uniform: packValues([p.cellSize as number, (p.jitter as number) / 100, (p.facets as number) / 100, { u32: p.seed as number }]) }),
};

const STAINED_GLASS: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { size: f32, hw: f32, light: f32, seed: u32, lead: vec3f, p0: f32 }
${VORONOI}

// How much more saturated a pane is than the picture under it, and how much its brightness varies across it
// (reference: PANE_SATURATION, PANE_MOTTLE).
const PANE_SATURATION: f32 = 1.35;
const PANE_MOTTLE: f32 = 0.15;

fn pane(p: vec2f, s: vec2f, lit: f32) -> vec4f {
  let avg = cell_colour(p, s, params.size);
  let v = enc3(unpremul(avg));
  let l = dot(W709, v);
  let lin = dec3(clamp(l + (v - l) * PANE_SATURATION, vec3f(0.0), vec3f(1.0)));
  return premul(lin * lit, avg.a);
}

fn effect(p: vec2f, c: vec4f) -> vec4f {
  let v = voronoi(p, params.size, 1.0, params.seed);
  let t = v.e / max(v.e + v.d, 1e-6);
  let mottle = 1.0 + (vnoise(p / (0.3 * params.size), params.seed + 7u) - 0.5) * 2.0 * PANE_MOTTLE;
  let lit = mix(1.0 - 0.55 * params.light, 1.0 + 1.1 * params.light, t * t) * mottle;
  let aa = 0.5 * px();
  let w = smoothstep(-aa, aa, v.e);
  var g = pane(p, v.a, lit);
  if (w < 1.0) { g = mix(pane(p, v.b, lit), g, w); }
  let hw = params.hw;
  if (!(hw > 0.0)) { return g; }
  let cover = (1.0 - smoothstep(hw - aa, hw + aa, v.e)) * min(1.0, hw / aa);
  if (!(cover > 0.0)) { return g; }
  let bump = sqrt(clamp(1.0 - (v.e / hw) * (v.e / hw), 0.0, 1.0));
  let b4 = bump * bump * bump * bump;
  let sheen = clamp(params.lead * (0.55 + 0.6 * bump) + 0.09 * b4, vec3f(0.0), vec3f(1.0));
  return mix(g, from_encoded(sheen, g.a), cover);
}`,
  pack: (p) => {
    const lead = hexEncoded(p.lead as string);
    return { uniform: packValues([p.cellSize as number, (p.border as number) / 2, (p.light as number) / 100, { u32: p.seed as number }, lead[0], lead[1], lead[2], 0]) };
  },
};

const POINTILLIZE: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { size: f32, radius: f32, variation: f32, seed: u32, paper: vec3f, p0: f32 }
${VORONOI}

// Dots are each this much bigger or smaller at random (reference: DOT_SPREAD).
const DOT_SPREAD: f32 = 0.3;

fn dab(p: vec2f, s: vec2f, id: vec2i, r: f32) -> vec4f {
  var sum = src(held(s, p));
  sum += src(held(s + vec2f(0.3 * r, 0.3 * r), p));
  sum += src(held(s + vec2f(0.3 * r, -0.3 * r), p));
  sum += src(held(s + vec2f(-0.3 * r, 0.3 * r), p));
  sum += src(held(s + vec2f(-0.3 * r, -0.3 * r), p));
  let avg = sum / 5.0;
  let variation = params.variation;
  if (!(variation > 0.0)) { return avg; }
  let v = enc3(unpremul(avg));
  // The hue turned about the grey axis (Rodrigues), then saturation and brightness.
  let angle = (rand(id.x, id.y, params.seed + 4u) - 0.5) * variation * PI;
  let cs = cos(angle);
  let sn = sin(angle);
  let m = (v.r + v.g + v.b) / 3.0;
  let k3 = 1.0 / sqrt(3.0);
  let h = v * cs + vec3f(v.b - v.g, v.r - v.b, v.g - v.r) * k3 * sn + m * (1.0 - cs);
  let sat = 1.0 + variation * 0.8 * rand(id.x, id.y, params.seed + 5u);
  let bright = 1.0 + (rand(id.x, id.y, params.seed + 6u) - 0.5) * variation * 0.8;
  let l = dot(W709, h);
  return from_encoded(clamp((l + (h - l) * sat) * bright, vec3f(0.0), vec3f(1.0)), avg.a);
}

fn effect(p: vec2f, c: vec4f) -> vec4f {
  let g = vec2i(floor(p / params.size));
  let aa = 0.5 * px();
  var sites: array<vec2f, 9>;
  var ids: array<vec2i, 9>;
  var radii: array<f32, 9>;
  var covers: array<f32, 9>;
  var ranks: array<f32, 9>;
  for (var k = 0; k < 9; k++) {
    let id = vec2i(g.x + k % 3 - 1, g.y + k / 3 - 1);
    let s = site(id.x, id.y, params.size, 1.0, params.seed);
    let r = params.radius * (1.0 - DOT_SPREAD / 2.0 + DOT_SPREAD * rand(id.x, id.y, params.seed + 2u));
    let d = length(p - s);
    sites[k] = s;
    ids[k] = id;
    radii[k] = r;
    covers[k] = (1.0 - smoothstep(r - aa, r + aa, d)) * min(1.0, r / aa);
    ranks[k] = rand(id.x, id.y, params.seed + 3u);
  }
  var res = premul(params.paper, c.a);
  // Lowest rank first: each dot over the ones before it.
  var last = -1.0;
  for (var n = 0; n < 9; n++) {
    var k = -1;
    var low = 2.0;
    for (var m = 0; m < 9; m++) {
      if (ranks[m] > last && ranks[m] < low) { low = ranks[m]; k = m; }
    }
    if (k < 0) { break; }
    last = low;
    let cover = covers[k];
    if (!(cover > 0.0)) { continue; }
    let d0 = dab(p, sites[k], ids[k], radii[k]);
    res = d0 * cover + res * (1.0 - d0.a * cover);
  }
  return res;
}`,
  pack: (p) => {
    const lin = dec3(hexEncoded(p.paper as string));
    return { uniform: packValues([p.cellSize as number, ((p.dotSize as number) / 200) * (p.cellSize as number), (p.variation as number) / 100, { u32: p.seed as number }, lin[0], lin[1], lin[2], 0]) };
  },
};

export const CELLS_KERNELS: Record<string, FilterKernel> = { crystallize: CRYSTALLIZE, pointillize: POINTILLIZE, "stained-glass": STAINED_GLASS };
