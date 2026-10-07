/** The paint filters' CPU references (`../../effects/filters/paint.ts`), mirrored by `render/filters/paint.ts`. */
import { type KernelReference, clamp, enc3, fromEncoded, rand, unpremul, vnoise } from "../kernel.ts";
import { held } from "./stylize.ts";

/** Rec. 709's weights, used on encoded colour as a stylised brightness. */
const W = [0.2126, 0.7152, 0.0722] as const;

/** Oil Paint's sectors around a point (their axes on the grid's axes and diagonals). */
export const OIL_SECTORS = 8;
/** Floats per tap in Oil Paint's table: its offset, then its weight in each sector. */
export const OIL_TAP_FLOATS = 2 + OIL_SECTORS;
/** The most taps from the centre to Radius along an axis: larger radii step their taps wider (whole pixels). */
const OIL_STEPS = 7;
/** Kyprianidis's polynomial sectors: how far behind the centre a sector reaches, and how narrow it is. */
const ZETA = 0.33;
const ETA = (ZETA + Math.cos(Math.PI / OIL_SECTORS)) / Math.sin(Math.PI / OIL_SECTORS) ** 2;

/**
 * Oil Paint's taps for a radius: a grid inside the disc, at most OIL_STEPS a side from the centre, each with its
 * offset and its weight in every sector (Kyprianidis, Semmo and Döllner's polynomial weights, which overlap so the
 * sectors blend, times a Gaussian fall-off). A grid wider than a pixel steps whole pixels and pushes each tap half
 * a pixel outwards, between four pixels' centres, so it reads their average: small bright details are caught by
 * neighbouring points alike rather than by every other one (a dotted pattern). Float32 for the GPU's table, and the
 * reference reads the same numbers.
 */
export function oilTaps(radius: number): Float32Array {
  const step = Math.max(1, Math.ceil(radius / OIL_STEPS));
  const k = Math.max(1, Math.floor(radius / step));
  const push = step >= 2 ? 0.5 : 0;
  const rows: number[] = [];
  for (let j = -k; j <= k; j++) {
    for (let i = -k; i <= k; i++) {
      if (i * i + j * j > k * k) continue;
      const x = i / k;
      const y = j / k;
      const g = Math.exp(-2 * (x * x + y * y));
      rows.push(i * step + push * Math.sign(i), j * step + push * Math.sign(j));
      for (let s = 0; s < OIL_SECTORS; s++) {
        const a = (s * 2 * Math.PI) / OIL_SECTORS;
        const xr = Math.cos(a) * x + Math.sin(a) * y;
        const yr = -Math.sin(a) * x + Math.cos(a) * y;
        const w = Math.max(0, xr + ZETA - ETA * yr * yr);
        rows.push(w * w * g);
      }
    }
  }
  return Float32Array.from(rows);
}

/** The calmest sector's lead: sectors' standard deviations are compared over this much more (encoded). */
export const CALM = 0.02;
/** How much a unit of relief slope lights or shades, at Shine 100%. */
export const SHINE_GAIN = 3;
/** How much the bristles' streaks brighten or darken the paint (relatively), at Bristles 100%. */
export const BRISTLE_GAIN = 0.9;
/** How much the gradient must say before strokes follow it rather than their own lazy drift (squared slope). */
export const FLAT = 0.004;
/** How far the strokes drift from the diagonal where the picture is flat (doubled angle, radians: ±54°). */
export const DRIFT = 0.6 * Math.PI;

/** Oil Paint's bristle streaks' lengths, widths and patches for a radius (the GPU's too). */
export const bristleScale = (radius: number) => ({ along: Math.max(2, 1.6 * radius), across: Math.max(0.7, 0.15 * radius + 0.5), patch: Math.max(4, 2 * radius) });

/**
 * Oil Paint: a generalised Kuwahara filter on the encoded colour (each sector's mean and variance over the taps,
 * held on the canvas and weighted by their coverage; the result the sectors' means weighted towards the calmest by
 * Sharpness), then lit: the sectors' brightness gives the paint's slope, highlights facing the light, shade away
 * from it, and bristles streak along the strokes (across the slope, or a slow drift where it's flat). The bristles
 * are seeded value noise in patches about the size of a stroke, each turned to the stroke's direction at the point,
 * blended over their neighbours; read either way along (symmetric), so a stroke flipping direction is no seam.
 */
const oilPaint: KernelReference = (p) => {
  const radius = p.radius as number;
  const taps = oilTaps(radius);
  const count = taps.length / OIL_TAP_FLOATS;
  const q = p.sharpness as number;
  const shine = ((p.shine as number) / 100) * SHINE_GAIN;
  const bristles = ((p.bristles as number) / 100) * BRISTLE_GAIN;
  const angle = ((p.angle as number) * Math.PI) / 180;
  const lx = Math.cos(angle);
  const ly = -Math.sin(angle);
  const seed = p.seed as number;
  const { along, across, patch } = bristleScale(radius);
  return (pt, c, env) => {
    const mean = Array.from({ length: OIL_SECTORS }, () => [0, 0, 0]);
    const square = Array.from({ length: OIL_SECTORS }, () => [0, 0, 0]);
    const weight = new Array<number>(OIL_SECTORS).fill(0);
    const full = new Array<number>(OIL_SECTORS).fill(0);
    for (let t = 0; t < count; t++) {
      const o = t * OIL_TAP_FLOATS;
      const at = held(pt[0] + taps[o], pt[1] + taps[o + 1], pt, env.canvas);
      const s = env.src(at[0], at[1]);
      const a = clamp(s[3]);
      const v = enc3(unpremul(s));
      for (let k = 0; k < OIL_SECTORS; k++) {
        const wt = taps[o + 2 + k];
        const w = wt * a;
        full[k] += wt;
        weight[k] += w;
        for (let ch = 0; ch < 3; ch++) {
          mean[k][ch] += w * v[ch];
          square[k][ch] += w * v[ch] * v[ch];
        }
      }
    }
    // Each sector's mean and spread; the calmest one's spread.
    const spread = new Array<number>(OIL_SECTORS).fill(0);
    let calmest = Infinity;
    for (let k = 0; k < OIL_SECTORS; k++) {
      if (!(weight[k] > 0)) continue;
      let variance = 0;
      for (let ch = 0; ch < 3; ch++) {
        mean[k][ch] /= weight[k];
        variance += square[k][ch] / weight[k] - mean[k][ch] * mean[k][ch];
      }
      spread[k] = Math.sqrt(Math.max(0, variance));
      calmest = Math.min(calmest, spread[k]);
    }
    const v = [0, 0, 0];
    let total = 0;
    let gx = 0;
    let gy = 0;
    for (let k = 0; k < OIL_SECTORS; k++) {
      if (!(weight[k] > 0)) continue;
      const alpha = ((CALM + calmest) / (CALM + spread[k])) ** q;
      total += alpha;
      for (let ch = 0; ch < 3; ch++) v[ch] += alpha * mean[k][ch];
      // The sector's brightness (none where it's uncovered) towards its axis: the paint's slope.
      const l = (W[0] * mean[k][0] + W[1] * mean[k][1] + W[2] * mean[k][2]) * (weight[k] / full[k]);
      const a = (k * 2 * Math.PI) / OIL_SECTORS;
      gx += l * Math.cos(a);
      gy += l * Math.sin(a);
    }
    if (!(total > 0)) return c;
    gx *= 2 / OIL_SECTORS;
    gy *= 2 / OIL_SECTORS;
    // The strokes' direction: across the slope (doubled angles, so its sign doesn't matter), or a slow drift
    // about the diagonal where it's flat.
    const drift = Math.PI / 2 + (vnoise(pt[0] / (6 * patch), pt[1] / (6 * patch), seed + 9) - 0.5) * 2 * DRIFT;
    const dx = gx * gx - gy * gy + FLAT * Math.cos(drift);
    const dy = 2 * gx * gy + FLAT * Math.sin(drift);
    const theta = 0.5 * Math.atan2(dy, dx);
    const ax = -Math.sin(theta);
    const ay = Math.cos(theta);
    // Bristles: each of the four nearest patches' streaks, turned to the stroke, blended.
    const qx = pt[0] / patch;
    const qy = pt[1] / patch;
    const ix = Math.floor(qx);
    const iy = Math.floor(qy);
    const fx = qx - ix;
    const fy = qy - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    let streak = 0;
    for (let n = 0; n < 4; n++) {
      const ox = n & 1;
      const oy = n >> 1;
      const ox0 = pt[0] - (ix + ox) * patch;
      const oy0 = pt[1] - (iy + oy) * patch;
      const u = (ox0 * ax + oy0 * ay) / along;
      const w = (ox0 * ay - oy0 * ax) / across;
      const cx = rand(ix + ox, iy + oy, seed) * 64;
      const cy = rand(ix + ox, iy + oy, seed + 1) * 64;
      const h = 0.5 * (vnoise(cx + u, cy + w, seed + 2) + vnoise(cx - u, cy - w, seed + 2));
      streak += (ox ? sx : 1 - sx) * (oy ? sy : 1 - sy) * h;
    }
    // The relief lit towards white or shaded towards black, then the bristles' streaks, relatively.
    const relief = clamp(-(gx * lx + gy * ly) * shine, -1, 1);
    const hi = Math.max(relief, 0) * 0.7;
    const lo = Math.min(relief, 0) * 0.8;
    const streaked = 1 + (streak - 0.5) * 2 * bristles;
    return fromEncoded(
      v.map((x) => {
        const m = x / total;
        return clamp((m + hi * (1 - m) + lo * m) * streaked);
      }),
      c[3],
    );
  };
};

export const PAINT_REFERENCES: Record<string, KernelReference> = { "oil-paint": oilPaint };
