/** The glass filters' CPU references (`../../effects/filters/glass.ts`), mirrored by `render/filters/glass.ts`. */
import { addLight } from "../../effects/glow.ts";
import { DISPERSION } from "../../effects/filters/glass.ts";
import { type KernelEnv, type KernelReference, type Pixel, clamp, rand, smoothstep, vnoise } from "../kernel.ts";

/**
 * Where a displaced read lands: held inside the canvas (grown to take in the point itself, so a read never moves
 * farther from it), so the edges stretch rather than pull transparency in.
 */
const held = (v: number, at: number, size: number) => clamp(v, Math.min(at, 0.5), Math.max(at, size - 0.5));

/** Frost's reads: this many seeded ones, each within the frost's radius on either axis. */
export const FROST_TAPS = 8;
/** Frost's seed for its tap `k` (a hash of its own, apart from the textures'). */
export const frostSeed = (seed: number, k: number) => (seed ^ (0x5f3759df + k)) >>> 0;

/**
 * The picture through glass at `p`, moved by (ox, oy), red and blue moved `1 ± d` times as far (`d` 0: one read),
 * averaged over Frost's seeded reads around it (none: the read alone). Premultiplied; coverage the largest read's.
 */
function through(p: readonly [number, number], ox: number, oy: number, d: number, frost: number, seed: number, env: KernelEnv): Pixel {
  const [x, y] = p;
  const { width, height } = env.canvas;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const taps = frost > 0 ? FROST_TAPS : 1;
  const sum: Pixel = [0, 0, 0, 0];
  for (let k = 0; k < taps; k++) {
    let jx = 0;
    let jy = 0;
    if (frost > 0) {
      jx = (rand(ix, iy, frostSeed(seed, 2 * k)) * 2 - 1) * frost;
      jy = (rand(ix, iy, frostSeed(seed, 2 * k + 1)) * 2 - 1) * frost;
    }
    const read = (f: number) => env.src(held(x + jx + ox * f, x, width), held(y + jy + oy * f, y, height));
    if (d > 0) {
      const r = read(1 + d);
      const g = read(1);
      const b = read(1 - d);
      sum[0] += r[0];
      sum[1] += g[1];
      sum[2] += b[2];
      sum[3] += Math.max(r[3], g[3], b[3]);
    } else {
      const s = read(1);
      for (let c = 0; c < 4; c++) sum[c] += s[c];
    }
  }
  return [sum[0] / taps, sum[1] / taps, sum[2] / taps, sum[3] / taps];
}

/** A curved surface's slope across a rib or lens, `t` in [−1, 1]: steepest at its edges, within ±2. */
const lens = (t: number) => t / Math.sqrt(1 - 0.75 * t * t);

/** A Gaussian bump of light at `s`, `w` wide. */
const sheen = (s: number, at: number, w: number) => Math.exp(-((s - at) / w) * ((s - at) / w));

/**
 * Reeded Glass: ribs across the direction `u` (centred on the canvas), `s` in [−½, ½] across each. A rib moves its
 * reads along `u` by Refraction × Width × its profile's offset at `s` (Round: the lens's slope, turned back; Fluted:
 * the same, forwards; Prism: a straight ramp); seams darkened and a sheen of light added along each rib. Within a pixel
 * of a seam the two ribs are mixed, so the seam is smooth.
 */
const reededGlass: KernelReference = (p, canvas) => {
  const width = p.width as number;
  const angle = ((p.angle as number) * Math.PI) / 180;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const profile = p.profile === "fluted" ? 1 : p.profile === "prism" ? 2 : 0;
  const k = ((p.refraction as number) / 100) * width;
  const d = DISPERSION * ((p.dispersion as number) / 100);
  const frost = p.frost as number;
  const light = (p.highlight as number) / 100;
  const seed = (p.seed as number) >>> 0;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const rib = (q: readonly [number, number], s: number, i: number, env: KernelEnv): Pixel => {
    // Held to the rib: a neighbour's `s` reaches past ½ only where its share is mixed in.
    const t = clamp(2 * s, -1, 1);
    const h = profile === 0 ? -0.5 * lens(t) : profile === 1 ? 0.5 * lens(t) : 0.5 * t;
    const o = through(q, ux * k * h, uy * k * h, d, frost, seed, env);
    // The sheen's width, never finer than the pixels evaluated.
    const w = Math.max(0.04, (0.6 * env.px) / width);
    const a = Math.abs(s);
    let spec: number;
    let dark: number;
    if (profile === 0) {
      spec = sheen(s, -0.22, w) + 0.35 * sheen(s, 0.34, w * 0.7);
      dark = smoothstep(0.3, 0.5, a);
    } else if (profile === 1) {
      spec = sheen(a, 0.5, w) + 0.25 * sheen(s, 0, w * 3);
      dark = (1 - smoothstep(0, 0.35, a)) * 0.6;
    } else {
      spec = sheen(s, 0.4, w);
      dark = 1 - smoothstep(-0.5, 0.1, s);
    }
    // The sheen catches the light unevenly along each rib, as real glass does.
    const along = (-(q[0] - cx) * uy + (q[1] - cy) * ux) / (6 * width);
    const uneven = 0.35 + 0.9 * vnoise(along, i * 3.1, (seed + 9) >>> 0);
    const keep = 1 - 0.45 * light * dark;
    const l = 0.3 * light * spec * uneven * o[3];
    return addLight([o[0] * keep, o[1] * keep, o[2] * keep, o[3]], [l, l, l]);
  };
  return (q, _c, env) => {
    const u = ((q[0] - cx) * ux + (q[1] - cy) * uy) / width + 0.5;
    const s = u - Math.floor(u) - 0.5;
    const i = Math.floor(u);
    const out = rib(q, s, i, env);
    // The neighbouring rib's share near a seam: half at it, none a pixel away.
    const w = 0.5 * (1 - smoothstep(0, env.px, (0.5 - Math.abs(s)) * width));
    if (!(w > 0)) return out;
    const other = s > 0 ? rib(q, s - 1, i + 1, env) : rib(q, s + 1, i - 1, env);
    return [0, 1, 2, 3].map((c) => out[c] + (other[c] - out[c]) * w) as Pixel;
  };
};

/**
 * Value noise (`vnoise`'s) and its slope on the lattice: [value, ∂/∂x, ∂/∂y].
 */
export function noiseSlope(x: number, y: number, seed: number): [number, number, number] {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const dx = 6 * fx * (1 - fx);
  const dy = 6 * fy * (1 - fy);
  const a = rand(ix, iy, seed);
  const b = rand(ix + 1, iy, seed);
  const c = rand(ix, iy + 1, seed);
  const e = rand(ix + 1, iy + 1, seed);
  const k = a - b - c + e;
  return [a + (b - a) * ux + (c - a) * uy + k * ux * uy, dx * (b - a + k * uy), dy * (c - a + k * ux)];
}

/**
 * Frosted Glass: the texture's slope `g` (in [−1, 1] a component, held there) at the point moves the read by
 * Distortion × `g`; Frost averages seeded reads around it. Blocks darken their seams and Raindrops are a lens each, with
 * a dark rim and a highlight, clear on frosted glass.
 */
const glass: KernelReference = (p) => {
  const texture = ["frosted", "blocks", "lens", "rippled", "drops"].indexOf(p.texture as string);
  const amount = p.distortion as number;
  const scale = p.scale as number;
  const frost = p.frost as number;
  const seed = (p.seed as number) >>> 0;
  return (q, _c, env) => {
    const qx = q[0] / scale;
    const qy = q[1] / scale;
    const aa = env.px;
    let gx = 0;
    let gy = 0;
    // How dark it is there (seams, rims), how clear (inside a drop) and the drop's highlight.
    let dark = 0;
    let clear = 0;
    let spec = 0;
    if (texture === 0) {
      const a = noiseSlope(qx, qy, seed);
      const b = noiseSlope(qx * 2.03 + 3.7, qy * 2.03 + 1.3, (seed + 1) >>> 0);
      gx = (a[1] + 1.015 * b[1]) / 1.5;
      gy = (a[2] + 1.015 * b[2]) / 1.5;
    } else if (texture === 1) {
      const i = Math.floor(qx);
      const j = Math.floor(qy);
      const tx = (qx - i) * 2 - 1;
      const ty = (qy - j) * 2 - 1;
      const edge = (Math.min(1 - Math.abs(tx), 1 - Math.abs(ty)) * scale) / 2;
      const fade = smoothstep(0, aa, edge);
      // Each brick a lens, a little tilted, its glass rippled inside.
      const w = noiseSlope(qx * 2.5, qy * 2.5, (seed + 2) >>> 0);
      gx = (-0.5 * lens(tx) + 0.2 * (rand(i, j, seed) * 2 - 1) + 0.4 * w[1]) * fade;
      gy = (-0.5 * lens(ty) + 0.2 * (rand(i, j, (seed + 1) >>> 0) * 2 - 1) + 0.4 * w[2]) * fade;
      dark = 0.55 * (1 - smoothstep(0, Math.max(aa, 0.03 * scale), edge));
    } else if (texture === 2) {
      const dx = (qx - Math.floor(qx)) * 2 - 1;
      const dy = (qy - Math.floor(qy)) * 2 - 1;
      const r = Math.min(Math.hypot(dx, dy), 1);
      const fade = smoothstep(0, aa, ((1 - r) * scale) / 2);
      const m = (-0.5 * fade) / Math.sqrt(1 - 0.75 * r * r);
      gx = dx * m;
      gy = dy * m;
      dark = 0.3 * smoothstep(0.7, 1, r) * fade;
    } else if (texture === 3) {
      const n = noiseSlope(qx * 0.5, qy * 0.5, seed);
      const phase = qy + 0.8 * n[0];
      const w = 0.6 * Math.cos(2 * Math.PI * phase);
      gx = w * 0.4 * n[1];
      gy = w * (1 + 0.4 * n[2]);
    } else {
      const i = Math.floor(qx);
      const j = Math.floor(qy);
      if (rand(i, j, (seed + 3) >>> 0) < 0.6) {
        const r = 0.16 + 0.28 * rand(i, j, (seed + 4) >>> 0);
        const dx = (qx - (i + r + (1 - 2 * r) * rand(i, j, (seed + 5) >>> 0))) / r;
        const dy = (qy - (j + r + (1 - 2 * r) * rand(i, j, (seed + 6) >>> 0))) / r;
        const rho = Math.min(Math.hypot(dx, dy), 1);
        clear = smoothstep(0, aa, (1 - rho) * r * scale);
        const m = (-0.6 * clear) / Math.sqrt(1 - 0.75 * rho * rho);
        gx = dx * m;
        gy = dy * m;
        dark = 0.55 * smoothstep(0.5, 1, rho) * clear;
        spec = clear * Math.exp(-((dx + 0.35) * (dx + 0.35) + (dy + 0.4) * (dy + 0.4)) / 0.03);
      }
    }
    const ox = clamp(gx * amount, -amount, amount);
    const oy = clamp(gy * amount, -amount, amount);
    let o: Pixel;
    if (texture !== 4) o = through(q, ox, oy, 0, frost, seed, env);
    else {
      o = clear < 1 ? through(q, 0, 0, 0, frost, seed, env) : [0, 0, 0, 0];
      if (clear > 0) {
        const drop = through(q, ox, oy, 0, 0, seed, env);
        o = [0, 1, 2, 3].map((c) => o[c] + (drop[c] - o[c]) * clear) as Pixel;
      }
    }
    const keep = 1 - dark;
    const l = 1.2 * spec * o[3];
    return addLight([o[0] * keep, o[1] * keep, o[2] * keep, o[3]], [l, l, l]);
  };
};

export const GLASS_REFERENCES: Record<string, KernelReference> = { "reeded-glass": reededGlass, glass };
