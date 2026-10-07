/** The print filters' CPU references (`../../effects/filters/print.ts`), mirrored by `render/filters/print.ts`. */
import { ASCII_GLYPHS, ASCII_TEXT_ASPECT } from "../../effects/filters/print.ts";
import { type KernelReference, type Pixel, type Rgb, clamp, enc, enc3, fract, fromEncoded, hexEncoded, luma, mix, rand, rotate, smoothstep, unpremul, vnoise } from "../kernel.ts";
import { held } from "./stylize.ts";

// --- Risograph ---

/** Added to the separation's normal equations, so two inks of nearly one colour still separate. */
const RISO_RIDGE = 1e-3;

/**
 * Risograph's separation: three rows turning an absorption (1 − the encoded colour) into each ink's density, by least
 * squares over the inks' own absorptions (1 − their colour): (KᵀK + λI)⁻¹Kᵀ, for two inks or three (for two, the
 * third row is 0). The WGSL gets these rows.
 */
export function risoSeparation(inks: readonly Rgb[]): [Rgb, Rgb, Rgb] {
  const k = inks.map((c) => [1 - c[0], 1 - c[1], 1 - c[2]]);
  const g = k.map((a, i) => k.map((b, j) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + (i === j ? RISO_RIDGE : 0)));
  let inv: number[][];
  if (k.length === 2) {
    const det = g[0][0] * g[1][1] - g[0][1] * g[1][0];
    inv = [
      [g[1][1] / det, -g[0][1] / det],
      [-g[1][0] / det, g[0][0] / det],
    ];
  } else {
    const [[a, b, c], [d, e, f], [h, i, j]] = g;
    const det = a * (e * j - f * i) - b * (d * j - f * h) + c * (d * i - e * h);
    inv = [
      [(e * j - f * i) / det, (c * i - b * j) / det, (b * f - c * e) / det],
      [(f * h - d * j) / det, (a * j - c * h) / det, (c * d - a * f) / det],
      [(d * i - e * h) / det, (b * h - a * i) / det, (a * e - b * d) / det],
    ];
  }
  const rows: [Rgb, Rgb, Rgb] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let r = 0; r < k.length; r++) for (let ch = 0; ch < 3; ch++) rows[r][ch] = inv[r].reduce((sum, w, s) => sum + w * k[s][ch], 0);
  return rows;
}

/** How far each of the three inks slips, by Seed: a direction of its own, 35–100% of Misregistration. */
export function risoOffsets(misregistration: number, seed: number): [number, number][] {
  return [0, 1, 2].map((i) => rotate(misregistration * (0.35 + 0.65 * rand(i, 3, seed)), 0, 2 * Math.PI * rand(i, 4, seed)));
}

/** An ink's stochastic screen: two octaves of value noise, stretched towards a uniform spread of thresholds. */
function risoScreen(x: number, y: number, seed: number): number {
  const a = vnoise(x, y, seed);
  const b = vnoise(x * 2.31 + 17.3, y * 2.31 + 5.9, seed + 1);
  return clamp((0.62 * a + 0.38 * b - 0.5) * 2.1 + 0.5);
}

/**
 * Risograph: each ink's density read where its drum slipped to (`held` on the canvas), separated by least squares,
 * thinned by blotches, then screened against its noise (a ramp over the evaluated pixel, so grain finer than it
 * averages to the density), multiplied over the paper and its fibre, in encoded colour.
 */
const risograph: KernelReference = (p, canvas) => {
  const count = p.inks === "3" ? 3 : 2;
  const inks = [hexEncoded(p.ink1 as string), hexEncoded(p.ink2 as string), hexEncoded(p.ink3 as string)];
  const rows = risoSeparation(inks.slice(0, count));
  const paper = hexEncoded(p.paper as string);
  const density = (p.density as number) / 100;
  const gs = p.grainSize as number;
  const amount = (p.grain as number) / 100;
  const texture = (p.texture as number) / 100;
  const seed = p.seed as number;
  const offsets = risoOffsets(p.misregistration as number, seed);
  const fibre = Math.max(gs, 1);
  return (pt, c, env) => {
    // The paper: a fine fibre (faded where finer than the pixels shown) and a broad mottle.
    const fine = vnoise(pt[0] / (3 * fibre), pt[1] / (1.2 * fibre), seed + 40) - 0.5;
    const broad = vnoise(pt[0] / (40 * fibre), pt[1] / (40 * fibre), seed + 41) - 0.5;
    const tex = 1 + texture * (0.1 * fine * smoothstep(0.6, 1.6, (1.2 * fibre) / env.px) + 0.08 * broad);
    let out: Rgb = [paper[0] * tex, paper[1] * tex, paper[2] * tex];
    const w = Math.max(env.px / gs, 0.05);
    const sharp = smoothstep(0.6, 1.6, gs / env.px);
    for (let i = 0; i < count; i++) {
      // The drum's grain moves with it; its colour is read on the canvas.
      const qx = pt[0] - offsets[i][0];
      const qy = pt[1] - offsets[i][1];
      const at = held(qx, qy, pt, canvas);
      const s = env.src(at[0], at[1]);
      const v = enc3(unpremul(s));
      const al = clamp(s[3]);
      const r = rows[i];
      let d = clamp((r[0] * (1 - v[0]) + r[1] * (1 - v[1]) + r[2] * (1 - v[2])) * al * density);
      // Blotches about a dozen grains wide where the drum laid less ink.
      d *= 1 - 0.3 * amount * vnoise(qx / (12 * gs), qy / (12 * gs), seed + 10 + i);
      const t = risoScreen(qx / gs, qy / gs, seed + 20 + 2 * i);
      let screened = clamp((d - t) / w + 0.5);
      screened = Math.max(Math.min(screened, d / w), 1 - (1 - d) / w);
      const cover = mix(d, mix(d, screened, sharp), amount);
      out = [out[0] * mix(1, inks[i][0], cover), out[1] * mix(1, inks[i][1], cover), out[2] * mix(1, inks[i][2], cover)];
    }
    return fromEncoded(out, c[3]);
  };
};

// --- ASCII ---

/** A glyph's pixel (column i, row j): 1 lit, 0 not or outside its 5 × 7. */
function glyphBit(g: number, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= 5 || j >= 7) return 0;
  const bit = j * 5 + i;
  const { lo, hi } = ASCII_GLYPHS[g];
  return bit < 32 ? (lo >>> bit) & 1 : (hi >>> (bit - 32)) & 1;
}

/** How much of a box `f` glyph pixels wide (at most one) around (x, y) glyph `g` covers: its pixels antialiased. */
function glyphCover(g: number, x: number, y: number, f: number): number {
  const over = (i: number, v: number) => Math.max(0, Math.min(i + 1, v + f / 2) - Math.max(i, v - f / 2)) / f;
  const i0 = Math.floor(x - f / 2);
  const j0 = Math.floor(y - f / 2);
  let sum = 0;
  for (let j = j0; j <= j0 + 1; j++) for (let i = i0; i <= i0 + 1; i++) sum += glyphBit(g, i, j) * over(i, x) * over(j, y);
  return sum;
}

/**
 * ASCII: each cell's brightness (six reads averaged, encoded luminance, brightness, contrast) picks a character from the ramp;
 * its 5 × 7 pixels (a ninth of the cell's height each, centred) antialiased over the pixel shown and faded to its
 * average where finer; drawn in the Ink, the cell's own colour or typed on paper, over the Background; Rain fades
 * columns in seeded streaks.
 */
const ascii: KernelReference = (p, canvas) => {
  const ch = p.cellSize as number;
  const cw = p.cells === "square" ? ch : ch * ASCII_TEXT_ASPECT;
  const g = ch / 9;
  const mode = p.mode === "own" ? 1 : p.mode === "paper" ? 2 : 0;
  const ink = hexEncoded(p.ink as string);
  const background = hexEncoded(p.background as string);
  const brightness = 0.5 * ((p.brightness as number) / 100);
  const contrast = 1 + 3 * ((p.contrast as number) / 100);
  const invert = !!p.invert;
  const rain = (p.rain as number) / 100;
  const seed = p.seed as number;
  const count = ASCII_GLYPHS.length;
  return (pt, _c, env) => {
    const ix = Math.floor(pt[0] / cw);
    const iy = Math.floor(pt[1] / ch);
    const sum: Pixel = [0, 0, 0, 0];
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 2; i++) {
        const at = held((ix + (i + 0.5) / 2) * cw, (iy + (j + 0.5) / 3) * ch, pt, canvas);
        const s = env.src(at[0], at[1]);
        for (let k = 0; k < 4; k++) sum[k] += s[k] / 6;
      }
    const v = enc3(unpremul(sum));
    const b = clamp((enc(luma(unpremul(sum))) + brightness - 0.5) * contrast + 0.5);
    let density = mode === 2 ? 1 - b : b;
    if (invert) density = 1 - density;
    const glyph = Math.min(count - 1, Math.floor(density * count));
    let ox = ix * cw + (cw - 5 * g) / 2;
    let oy = iy * ch + g;
    let strike = 1;
    if (mode === 2) {
      // A typewriter's strikes: each character a little off its line and unevenly inked.
      ox += (rand(ix, iy, seed + 7) - 0.5) * 0.3 * g;
      oy += (rand(ix, iy, seed + 8) - 0.5) * 0.8 * g;
      strike = 0.72 + 0.28 * rand(ix, iy, seed + 9);
    }
    const detail = smoothstep(0.5, 1.2, g / env.px);
    const mean = (ASCII_GLYPHS[glyph].count * g * g) / (cw * ch);
    const cover = mix(mean, glyphCover(glyph, (pt[0] - ox) / g, (pt[1] - oy) / g, Math.min(1, env.px / g)), detail) * strike;
    let colour: Rgb = ink;
    if (mode === 1) {
      const top = Math.max(0.05, v[0], v[1], v[2]);
      colour = [mix(v[0], v[0] / top, 0.6), mix(v[1], v[1] / top, 0.6), mix(v[2], v[2] / top, 0.6)];
    }
    if (rain > 0 && mode !== 2) {
      const length = 8 + 16 * rand(ix, 1, seed);
      const t = fract(iy / length + rand(ix, 2, seed));
      const trail = mix(1, 0.12 + 0.88 * t * t, rain);
      const head = t > 1 - 1 / length ? 0.75 * rain : 0;
      colour = [mix(colour[0] * trail, 1, head), mix(colour[1] * trail, 1, head), mix(colour[2] * trail, 1, head)];
    }
    const out: Rgb = [mix(background[0], colour[0], cover), mix(background[1], colour[1], cover), mix(background[2], colour[2], cover)];
    return fromEncoded(out, clamp(sum[3]));
  };
};


export const PRINT_REFERENCES: Record<string, KernelReference> = { risograph, ascii };
