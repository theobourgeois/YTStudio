/** The film filters' CPU references (`../../effects/filters/film.ts`), mirrored by `render/filters/film.ts`. */
import { type KernelReference, type Pixel, clamp, enc3, fromEncoded, hexEncoded, luma, mix, rand, smoothstep, unpremul, vnoise } from "../kernel.ts";

/** Two octaves of value noise, centred on 0 (in [-1, 1), most of it near 0): one grain channel. */
const grainNoise = (x: number, y: number, seed: number) => vnoise(x, y, seed) + vnoise(x * 1.93 + 7.1, y * 1.93 + 3.3, (seed + 11) >>> 0) - 1;

/**
 * Film Grain: noise on the encoded colour, weighted towards the midtones by Response; Dust mixes in specks (one at
 * most per cell, kept inside it) and broken vertical scratches (one at most per band).
 */
const grain: KernelReference = (p) => {
  const amount = (p.amount as number) / 100;
  const size = p.size as number;
  const chroma = (p.chroma as number) / 100;
  const response = (p.response as number) / 100;
  const dust = (p.dust as number) / 100;
  const seed = (p.seed as number) >>> 0;
  return ([x, y], c, env) => {
    if (!(c[3] > 0)) return c;
    const v = enc3(unpremul(c));
    const qx = x / size;
    const qy = y / size;
    const mono = grainNoise(qx, qy, seed);
    let g = [mono, mono, mono];
    if (chroma > 0) {
      g = [
        mix(mono, grainNoise(qx + 31.7, qy + 11.3, (seed + 101) >>> 0), chroma),
        mix(mono, grainNoise(qx + 57.1, qy + 23.9, (seed + 202) >>> 0), chroma),
        mix(mono, grainNoise(qx + 83.3, qy + 47.5, (seed + 303) >>> 0), chroma),
      ];
    }
    const y0 = clamp(luma(v));
    const weight = mix(1, 0.15 + 3.4 * y0 * (1 - y0), response);
    const k = amount * 0.45 * weight;
    let out = [v[0] + g[0] * k, v[1] + g[1] * k, v[2] + g[2] * k];
    if (dust > 0) {
      // A speck: white (dust on the negative) or, now and then, dark.
      const cell = size * 48;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      if (rand(cx, cy, (seed + 500) >>> 0) < dust * 0.3) {
        const r = size * (0.6 + 1.8 * rand(cx, cy, (seed + 501) >>> 0));
        const sx = (cx + 0.25 + 0.5 * rand(cx, cy, (seed + 502) >>> 0)) * cell;
        const sy = (cy + 0.25 + 0.5 * rand(cx, cy, (seed + 503) >>> 0)) * cell;
        // Ragged rather than round: the distance stretched by noise around the speck.
        const ragged = Math.hypot(x - sx, y - sy) / (0.7 + 0.6 * vnoise((x - sx) / r * 1.3 + 0.5, (y - sy) / r * 1.3 + 0.5, (seed + 505) >>> 0));
        const speck = 1 - smoothstep(r - 0.5 * env.px, r + 0.5 * env.px, ragged);
        const tone = rand(cx, cy, (seed + 504) >>> 0) < 0.75 ? 1 : 0.05;
        out = out.map((o) => mix(o, tone, speck * 0.85));
      }
      // A scratch: a thin light line down a band, wandering a little and broken along its length.
      const band = size * 160;
      const bx = Math.floor(x / band);
      if (rand(bx, 0, (seed + 600) >>> 0) < dust * 0.45) {
        const sx = (bx + 0.2 + 0.6 * rand(bx, 1, (seed + 600) >>> 0)) * band + (vnoise(y / (band * 1.5), bx * 7 + 0.5, (seed + 601) >>> 0) - 0.5) * band * 0.15;
        const half = Math.max(0.2 * size, 0.5 * env.px);
        const line = 1 - smoothstep(half, half + env.px, Math.abs(x - sx));
        const broken = smoothstep(0.4, 0.65, vnoise(y / (size * 90), bx * 7 + 3.5, (seed + 602) >>> 0));
        out = out.map((o) => mix(o, 0.95, line * broken * 0.6));
      }
    }
    return fromEncoded(out, c[3]);
  };
};

/**
 * Vignette: a superellipse distance from the canvas's centre (its extents between the canvas's half sizes and their
 * mean, by Roundness above 0; its power from 2 up to 6, by Roundness below 0), through a smoothstep around Size,
 * mixes the encoded colour towards Colour (darkening) or white (lightening).
 */
const vignette: KernelReference = (p, canvas) => {
  const amount = (p.amount as number) / 100;
  const size = (p.size as number) / 100;
  const round = (p.roundness as number) / 100;
  const feather = (p.feather as number) / 100;
  const edge = amount < 0 ? hexEncoded(p.colour as string) : [1, 1, 1];
  const hx = canvas.width / 2;
  const hy = canvas.height / 2;
  const t = Math.max(0, round);
  const ex = mix(hx, (hx + hy) / 2, t);
  const ey = mix(hy, (hx + hy) / 2, t);
  const q = 2 + Math.max(0, -round) * 4;
  const middle = 0.25 + size * 1.1;
  const strength = Math.abs(amount);
  return ([x, y], c, env) => {
    if (!(c[3] > 0)) return c;
    const v = enc3(unpremul(c));
    const dx = Math.abs(x - hx) / ex + 1e-6;
    const dy = Math.abs(y - hy) / ey + 1e-6;
    const d = Math.pow(Math.pow(dx, q) + Math.pow(dy, q), 1 / q);
    const half = 0.6 * feather + env.px / Math.min(ex, ey);
    const k = smoothstep(middle - half, middle + half, d) * strength;
    return fromEncoded([mix(v[0], edge[0], k), mix(v[1], edge[1], k), mix(v[2], edge[2], k)], c[3]) as Pixel;
  };
};

export const FILM_REFERENCES: Record<string, KernelReference> = { grain, vignette };
