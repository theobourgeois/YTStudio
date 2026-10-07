/** The cells filters' CPU references (`../../effects/filters/cells.ts`), mirrored by `render/filters/cells.ts`. */
import { type KernelEnv, type KernelReference, type Pixel, clamp, dec3, enc3, fromEncoded, hexEncoded, mix, premul, rand, smoothstep, unpremul, vnoise } from "../kernel.ts";
import { held } from "./stylize.ts";

/** Rec. 709's weights, used on encoded colour as a stylised brightness. */
const W = [0.2126, 0.7152, 0.0722] as const;
const dot3 = (v: readonly number[]) => W[0] * v[0] + W[1] * v[1] + W[2] * v[2];

/** A seeded site: the point of grid cell (i, j), moved within its cell by up to half of it times `jitter`. */
export interface Site {
  x: number;
  y: number;
  i: number;
  j: number;
}
export const site = (i: number, j: number, size: number, jitter: number, seed: number): Site => ({
  x: (i + 0.5 + (rand(i, j, seed) - 0.5) * jitter) * size,
  y: (j + 0.5 + (rand(i, j, seed + 1) - 0.5) * jitter) * size,
  i,
  j,
});

/**
 * The Voronoi cell a point is in: its site `a` (the nearest of the 3 × 3 grid cells' around it), the neighbour `b`
 * across the nearest edge, the distance `e` to that edge (the bisector of a and b: what edges are smoothed and lead
 * lines drawn by) and `d` to the site itself.
 */
export function voronoi(p: readonly [number, number], size: number, jitter: number, seed: number): { a: Site; b: Site; e: number; d: number } {
  const gx = Math.floor(p[0] / size);
  const gy = Math.floor(p[1] / size);
  const sites: Site[] = [];
  let best = 0;
  let bestD = Infinity;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const s = site(gx + di, gy + dj, size, jitter, seed);
      const d = (p[0] - s.x) ** 2 + (p[1] - s.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = sites.length;
      }
      sites.push(s);
    }
  }
  const a = sites[best];
  let b = a;
  let e = Infinity;
  for (let k = 0; k < 9; k++) {
    if (k === best) continue;
    const s = sites[k];
    const nx = s.x - a.x;
    const ny = s.y - a.y;
    const ek = -((p[0] - (a.x + s.x) / 2) * nx + (p[1] - (a.y + s.y) / 2) * ny) / Math.max(Math.hypot(nx, ny), 1e-6);
    if (ek < e) {
      e = ek;
      b = s;
    }
  }
  return { a, b, e, d: Math.sqrt(bestD) };
}

/** A cell's colour: the average (premultiplied) of a 3 × 3 grid of reads a quarter-cell apart around its site, held on the canvas. */
function cellColour(env: KernelEnv, p: readonly [number, number], s: Site, size: number): Pixel {
  const sum: Pixel = [0, 0, 0, 0];
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const at = held(s.x + i * 0.25 * size, s.y + j * 0.25 * size, p, env.canvas);
      const c = env.src(at[0], at[1]);
      for (let k = 0; k < 4; k++) sum[k] += c[k];
    }
  }
  return [sum[0] / 9, sum[1] / 9, sum[2] / 9, sum[3] / 9];
}

const mixPixel = (a: Pixel, b: Pixel, t: number): Pixel => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t)];

/**
 * Crystallize: each Voronoi cell its colour (shaded as a tilted facet, lighter towards a seeded side, with Facets),
 * blended with the neighbour's across the edge over a pixel, so edges are smooth.
 */
const crystallize: KernelReference = (p) => {
  const size = p.cellSize as number;
  const jitter = (p.jitter as number) / 100;
  const facets = (p.facets as number) / 100;
  const seed = p.seed as number;
  const look = (env: KernelEnv, pt: readonly [number, number], s: Site): Pixel => {
    const avg = cellColour(env, pt, s, size);
    if (!(facets > 0)) return avg;
    const t = rand(s.i, s.j, seed + 2) * 2 * Math.PI;
    const k = 1 + (facets * 1.2 * ((pt[0] - s.x) * Math.cos(t) + (pt[1] - s.y) * Math.sin(t))) / size;
    const v = enc3(unpremul(avg));
    return fromEncoded([clamp(v[0] * k), clamp(v[1] * k), clamp(v[2] * k)], avg[3]);
  };
  return (pt, _c, env) => {
    const { a, b, e } = voronoi(pt, size, jitter, seed);
    const ca = look(env, pt, a);
    const aa = 0.5 * env.px;
    const w = smoothstep(-aa, aa, e);
    if (w >= 1) return ca;
    return mixPixel(look(env, pt, b), ca, w);
  };
};

/** How much more saturated a pane is than the picture under it. */
const PANE_SATURATION = 1.35;
/** How much a pane's brightness varies across it, as hand-made glass's (relatively, either way). */
const PANE_MOTTLE = 0.15;

/**
 * Stained Glass: Voronoi panes of their cell's colour, saturated, lit from behind (brighter towards the site, darker
 * towards the edge: `t` is how central the point is), in lead lines along the edges with a sheen down their middle.
 */
const stainedGlass: KernelReference = (p) => {
  const size = p.cellSize as number;
  const hw = (p.border as number) / 2;
  const lead = hexEncoded(p.lead as string);
  const light = (p.light as number) / 100;
  const seed = p.seed as number;
  const pane = (env: KernelEnv, pt: readonly [number, number], s: Site, lit: number): Pixel => {
    const avg = cellColour(env, pt, s, size);
    const v = enc3(unpremul(avg));
    const l = dot3(v);
    const lin = dec3(v.map((x) => clamp(l + (x - l) * PANE_SATURATION)));
    return premul([lin[0] * lit, lin[1] * lit, lin[2] * lit], avg[3]);
  };
  return (pt, _c, env) => {
    const { a, b, e, d } = voronoi(pt, size, 1, seed);
    const t = e / Math.max(e + d, 1e-6);
    const mottle = 1 + (vnoise(pt[0] / (0.3 * size), pt[1] / (0.3 * size), seed + 7) - 0.5) * 2 * PANE_MOTTLE;
    const lit = mix(1 - 0.55 * light, 1 + 1.1 * light, t * t) * mottle;
    const aa = 0.5 * env.px;
    const w = smoothstep(-aa, aa, e);
    let g = pane(env, pt, a, lit);
    if (w < 1) g = mixPixel(pane(env, pt, b, lit), g, w);
    if (!(hw > 0)) return g;
    const cover = (1 - smoothstep(hw - aa, hw + aa, e)) * Math.min(1, hw / aa);
    if (!(cover > 0)) return g;
    const bump = Math.sqrt(clamp(1 - (e / hw) * (e / hw)));
    const b4 = bump * bump * bump * bump;
    const sheen = lead.map((x) => clamp(x * (0.55 + 0.6 * bump) + 0.09 * b4));
    return mixPixel(g, fromEncoded(sheen, g[3]), cover);
  };
};

/** Pointillize's dots are each this much bigger or smaller at random (0.85 to 1.15 of their size). */
const DOT_SPREAD = 0.3;

/**
 * Pointillize: over the paper, the dots of the 3 × 3 grid cells around the point stacked in a seeded order, each
 * the picture at its site (five reads, held on the canvas) varied in hue, saturation and brightness by Variation.
 */
const pointillize: KernelReference = (p) => {
  const size = p.cellSize as number;
  const radius = ((p.dotSize as number) / 200) * size;
  const variation = (p.variation as number) / 100;
  const paper = dec3(hexEncoded(p.paper as string));
  const seed = p.seed as number;
  const dab = (env: KernelEnv, pt: readonly [number, number], s: Site, r: number): Pixel => {
    const sum: Pixel = [0, 0, 0, 0];
    for (let k = 0; k < 5; k++) {
      const ox = k === 0 ? 0 : k === 1 || k === 2 ? 0.3 * r : -0.3 * r;
      const oy = k === 0 ? 0 : k === 1 || k === 3 ? 0.3 * r : -0.3 * r;
      const at = held(s.x + ox, s.y + oy, pt, env.canvas);
      const c = env.src(at[0], at[1]);
      for (let ch = 0; ch < 4; ch++) sum[ch] += c[ch];
    }
    const avg: Pixel = [sum[0] / 5, sum[1] / 5, sum[2] / 5, sum[3] / 5];
    if (!(variation > 0)) return avg;
    const v = enc3(unpremul(avg));
    // The hue turned about the grey axis (Rodrigues), then saturation and brightness.
    const angle = (rand(s.i, s.j, seed + 4) - 0.5) * variation * Math.PI;
    const cs = Math.cos(angle);
    const sn = Math.sin(angle);
    const m = (v[0] + v[1] + v[2]) / 3;
    const k3 = 1 / Math.sqrt(3);
    const h = [v[0] * cs + (v[2] - v[1]) * k3 * sn + m * (1 - cs), v[1] * cs + (v[0] - v[2]) * k3 * sn + m * (1 - cs), v[2] * cs + (v[1] - v[0]) * k3 * sn + m * (1 - cs)];
    const sat = 1 + variation * 0.8 * rand(s.i, s.j, seed + 5);
    const bright = 1 + (rand(s.i, s.j, seed + 6) - 0.5) * variation * 0.8;
    const l = dot3(h);
    return fromEncoded(h.map((x) => clamp((l + (x - l) * sat) * bright)), avg[3]);
  };
  return (pt, c, env) => {
    const gx = Math.floor(pt[0] / size);
    const gy = Math.floor(pt[1] / size);
    const aa = 0.5 * env.px;
    const sites: Site[] = [];
    const radii: number[] = [];
    const covers: number[] = [];
    const ranks: number[] = [];
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const s = site(gx + di, gy + dj, size, 1, seed);
        const r = radius * (1 - DOT_SPREAD / 2 + DOT_SPREAD * rand(s.i, s.j, seed + 2));
        const d = Math.hypot(pt[0] - s.x, pt[1] - s.y);
        sites.push(s);
        radii.push(r);
        covers.push((1 - smoothstep(r - aa, r + aa, d)) * Math.min(1, r / aa));
        ranks.push(rand(s.i, s.j, seed + 3));
      }
    }
    let out = premul(paper, c[3]);
    // Lowest rank first: each dot over the ones before it.
    let last = -1;
    for (let n = 0; n < 9; n++) {
      let k = -1;
      let low = 2;
      for (let m = 0; m < 9; m++) {
        if (ranks[m] > last && ranks[m] < low) {
          low = ranks[m];
          k = m;
        }
      }
      if (k < 0) break;
      last = low;
      const cover = covers[k];
      if (!(cover > 0)) continue;
      const dot = dab(env, pt, sites[k], radii[k]);
      out = [dot[0] * cover + out[0] * (1 - dot[3] * cover), dot[1] * cover + out[1] * (1 - dot[3] * cover), dot[2] * cover + out[2] * (1 - dot[3] * cover), dot[3] * cover + out[3] * (1 - dot[3] * cover)];
    }
    return out;
  };
};

export const CELLS_REFERENCES: Record<string, KernelReference> = { crystallize, pointillize, "stained-glass": stainedGlass };
