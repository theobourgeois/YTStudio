/** The stylize filters' CPU references (`../../effects/filters/stylize.ts`), mirrored by `render/filters/stylize.ts`. */
import { PROCESS_INKS } from "../../effects/filters/stylize.ts";
import { type KernelEnv, type KernelReference, type Pixel, type Rgb, clamp, enc, enc3, fromEncoded, hexEncoded, luma, mix, rand, rotate, smoothstep, unpremul } from "../kernel.ts";

const RAD = Math.PI / 180;
const HALFTONE_SHAPES: Record<string, number> = { dot: 0, line: 1, square: 2 };

/**
 * How much of a cell a halftone dot of ink `k` covers at offset (x, y) from its centre, in cells: a dot's area is the
 * ink (growing a little faster near full, so full ink just covers the cell), a square's side its root, a line's
 * width the ink itself. Edges are smoothed over `aa`, and a dot smaller than that fades rather than vanishes.
 */
export function shapeCover(shape: number, k: number, x: number, y: number, aa: number): number {
  let r: number;
  let d: number;
  if (shape === 0) {
    r = Math.sqrt(k / Math.PI) * mix(1, 1.277, k * k);
    d = Math.hypot(x, y);
  } else if (shape === 2) {
    r = Math.sqrt(k) * (0.5 + aa);
    d = Math.max(Math.abs(x), Math.abs(y));
  } else {
    r = k * (0.5 + aa);
    d = Math.abs(y);
  }
  return (1 - smoothstep(r - aa, r + aa, d)) * Math.min(1, r / aa);
}

/**
 * Where a pattern reads its content for the point `p`: inside the canvas when `p` is, so a cell the canvas's edge cuts
 * reads the edge rather than the transparency past it (no border of paper). Never farther from `p` than asked.
 */
export function held(x: number, y: number, p: readonly [number, number], canvas: { width: number; height: number }): [number, number] {
  if (p[0] < 0 || p[1] < 0 || p[0] > canvas.width || p[1] > canvas.height) return [x, y];
  return [clamp(x, 0.5, canvas.width - 0.5), clamp(y, 0.5, canvas.height - 0.5)];
}

/**
 * A screen's ink at a document point: the sample's encoded colour and its ink (`ch` 0–2: cyan, magenta, yellow; 3: the
 * key; 4: mono, the darkness; 5: colour, how far it is from the paper), times its coverage. CMYK's key is a skeleton
 * black, only in the shadows (as a press's separations), so colours keep their dots.
 */
function inkAt(env: KernelEnv, p: readonly [number, number], x: number, y: number, ch: number, paper: Rgb): [number, Rgb] {
  const at = held(x, y, p, env.canvas);
  const s = env.src(at[0], at[1]);
  const lin = unpremul(s);
  const v = enc3(lin);
  let k: number;
  if (ch === 4) k = 1 - enc(luma(lin));
  else if (ch === 5) k = COLOUR_DOT * Math.max(Math.abs(v[0] - paper[0]), Math.max(Math.abs(v[1] - paper[1]), Math.abs(v[2] - paper[2])));
  else {
    const key = clamp((1 - Math.max(v[0], Math.max(v[1], v[2])) - KEY_FROM) / (1 - KEY_FROM));
    k = ch === 3 ? key : clamp((1 - v[ch] - key) / Math.max(1 - key, 1e-4));
  }
  return [k * clamp(s[3]), v];
}

/** How dark a colour is before CMYK's key starts to print. */
const KEY_FROM = 0.3;
/** Colour mode's largest ink: a full dot just touches its neighbours, so the dots never merge into flat colour. */
const COLOUR_DOT = 0.65;

/**
 * One screen at a document point: its cover and the colour of the dot covering most. The screen is a grid of cells
 * turned by `angle`; the point's cell and its three nearest neighbours are read, so a big dot isn't cut at its
 * cell's edge. A line's width is interpolated between the cells' centres along it, so lines swell smoothly.
 */
function screen(env: KernelEnv, p: readonly [number, number], angle: number, ch: number, cell: number, shape: number, soft: number, paper: Rgb): [number, Rgb] {
  const [gx0, gy0] = rotate(p[0], p[1], -angle);
  const gx = gx0 / cell;
  const gy = gy0 / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix - 0.5;
  const fy = gy - iy - 0.5;
  const dx = fx >= 0 ? 1 : -1;
  const dy = fy >= 0 ? 1 : -1;
  const aa = (0.5 * env.px) / cell + soft * 0.35;
  let best = 0;
  let colour: Rgb = [0, 0, 0];
  const at = (ox: number, oy: number) => {
    const [x, y] = rotate((ix + 0.5 + ox) * cell, (iy + 0.5 + oy) * cell, angle);
    return inkAt(env, p, x, y, ch, paper);
  };
  for (let j = 0; j < 2; j++) {
    const oy = j * dy;
    const a = at(0, oy);
    const b = at(dx, oy);
    if (shape === 1) {
      const t = Math.abs(fx);
      const cover = shapeCover(shape, mix(a[0], b[0], t), 0, fy - oy, aa);
      if (cover > best) {
        best = cover;
        colour = [mix(a[1][0], b[1][0], t), mix(a[1][1], b[1][1], t), mix(a[1][2], b[1][2], t)];
      }
    } else {
      const ca = shapeCover(shape, a[0], fx, fy - oy, aa);
      if (ca > best) {
        best = ca;
        colour = a[1];
      }
      const cb = shapeCover(shape, b[0], fx - dx, fy - oy, aa);
      if (cb > best) {
        best = cb;
        colour = b[1];
      }
    }
  }
  return [best, colour];
}

/** Halftone: one screen of ink over the paper (Mono, Colour), or four process inks multiplied over it (CMYK). */
const halftone: KernelReference = (p) => {
  const cell = p.cellSize as number;
  const angle = (p.angle as number) * RAD;
  const shape = HALFTONE_SHAPES[p.shape as string] ?? 0;
  const soft = (p.softness as number) / 100;
  const ink = hexEncoded(p.ink as string);
  const paper = hexEncoded(p.paper as string);
  const inks = [hexEncoded(PROCESS_INKS.cyan), hexEncoded(PROCESS_INKS.magenta), hexEncoded(PROCESS_INKS.yellow), ink];
  // The printers' angles, relative to the key's.
  const offsets = [-Math.PI / 6, Math.PI / 6, -Math.PI / 4, 0];
  return (pt, c, env) => {
    let out: Rgb = [paper[0], paper[1], paper[2]];
    if (p.mode === "cmyk") {
      for (let ch = 0; ch < 4; ch++) {
        const cover = screen(env, pt, angle + offsets[ch], ch, cell, shape, soft, paper)[0];
        out = [out[0] * mix(1, inks[ch][0], cover), out[1] * mix(1, inks[ch][1], cover), out[2] * mix(1, inks[ch][2], cover)];
      }
    } else if (p.mode === "colour") {
      const [cover, v] = screen(env, pt, angle, 5, cell, shape, soft, paper);
      out = [mix(paper[0], v[0], cover), mix(paper[1], v[1], cover), mix(paper[2], v[2], cover)];
    } else {
      const cover = screen(env, pt, angle, 4, cell, shape, soft, paper)[0];
      out = [mix(paper[0], ink[0], cover), mix(paper[1], ink[1], cover), mix(paper[2], ink[2], cover)];
    }
    return fromEncoded(out, c[3]);
  };
};

/** Bayer's ordered-dither threshold at a cell, in (0, 1), for a matrix of 2^bits on a side. */
export function bayer(x: number, y: number, bits: number): number {
  let v = 0;
  for (let b = 0; b < bits; b++) {
    const xb = (x >> b) & 1;
    const yb = (y >> b) & 1;
    v = (v << 2) | (((xb ^ yb) << 1) | yb);
  }
  return (v + 0.5) / (1 << (2 * bits));
}

/** The average of a cell of `size` (premultiplied), from a 4 × 4 grid of reads inside it (and the canvas: `held`). */
function cellAverage(env: KernelEnv, p: readonly [number, number], cx: number, cy: number, size: number): Pixel {
  const sum: Pixel = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const at = held((cx + (i + 0.5) / 4) * size, (cy + (j + 0.5) / 4) * size, p, env.canvas);
      const s = env.src(at[0], at[1]);
      for (let k = 0; k < 4; k++) sum[k] += s[k];
    }
  }
  return [sum[0] / 16, sum[1] / 16, sum[2] / 16, sum[3] / 16];
}

/** The seed Dither's noise pattern is drawn with. */
const DITHER_SEED = 17;

/** Dither: each cell's average, its brightness (or each channel) put on one of the levels by the cell's threshold. */
const dither: KernelReference = (p) => {
  const size = p.pixelSize as number;
  const n = (p.levels as number) - 1;
  const colourMode = p.mode === "colour";
  const bits = p.pattern === "bayer4" ? 2 : 3;
  const noise = p.pattern === "noise";
  const ink = hexEncoded(p.ink as string);
  const paper = hexEncoded(p.paper as string);
  const level = (v: number, t: number) => clamp(Math.floor(v * n + t) / n);
  return (pt, _c, env) => {
    const cx = Math.floor(pt[0] / size);
    const cy = Math.floor(pt[1] / size);
    const avg = cellAverage(env, pt, cx, cy, size);
    const t = noise ? rand(cx, cy, DITHER_SEED) : bayer(cx, cy, bits);
    const lin = unpremul(avg);
    let out: Rgb;
    if (colourMode) {
      const v = enc3(lin);
      out = [level(v[0], t), level(v[1], t), level(v[2], t)];
    } else {
      const q = level(enc(luma(lin)), t);
      out = [mix(ink[0], paper[0], q), mix(ink[1], paper[1], q), mix(ink[2], paper[2], q)];
    }
    return fromEncoded(out, clamp(avg[3]));
  };
};

/** Pixelate: each cell's average; with a gap or as circles, a tile of it on black (at the cell's coverage). */
const pixelate: KernelReference = (p) => {
  const size = p.cellSize as number;
  const circle = p.shape === "circle";
  const gap = (p.gap as number) / 100;
  return (pt, _c, env) => {
    const cx = Math.floor(pt[0] / size);
    const cy = Math.floor(pt[1] / size);
    const avg = cellAverage(env, pt, cx, cy, size);
    if (!circle && !(gap > 0)) return avg;
    const fx = pt[0] / size - cx - 0.5;
    const fy = pt[1] / size - cy - 0.5;
    const aa = (0.5 * env.px) / size;
    const h = 0.5 * (1 - gap);
    const d = circle ? Math.hypot(fx, fy) : Math.max(Math.abs(fx), Math.abs(fy));
    const cover = 1 - smoothstep(h - aa, h + aa, d);
    return [avg[0] * cover, avg[1] * cover, avg[2] * cover, avg[3]];
  };
};

export const STYLIZE_REFERENCES: Record<string, KernelReference> = { halftone, dither, pixelate };
