/**
 * Content-Aware Fill (docs/photo/content-aware-fill.md): an inpainting model fills the selection from what's around
 * it. The model is LaMa (Suvorov et al., "Resolution-robust Large Mask Inpainting with Fourier Convolutions", WACV
 * 2022; Apache-2.0 weights) as an ONNX file, run in the tab by ONNX Runtime on the GPU. It reads and answers
 * 512 × 512, so a photo isn't squeezed into it whole: each hole gets a square crop about twice its size (never
 * smaller than 512, so a small hole is filled at the photo's own resolution), and crops are filled one after
 * another. This is that plan, the hole and its soft edge, and the pieces of the way back up. Pure.
 */
import type { Size } from "./geometry.ts";

/** The model's side: it reads and answers 512 × 512. */
export const FILL_SIDE = 512;

/** The model file the server keeps (downloaded once, checked). */
export const FILL_MODEL = {
  name: "LaMa (big-lama), fp32",
  file: "lama-fp32.onnx",
  url: "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx",
  size: 208_044_816,
  sha256: "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6",
  /** RGB in 0..1 (the hole's pixels 0), 1 × 3 × 512 × 512. */
  image: "image",
  /** 1 where it fills, 1 × 1 × 512 × 512. */
  mask: "mask",
  /** RGB in 0..255, 1 × 3 × 512 × 512. */
  output: "output",
};

/** A crop's side is this many times its hole's longest side: the hole is under half of it across. */
export const FILL_CONTEXT = 2.2;

/** The most document pixels a fill works over (the selection's box): a bigger one asks for a smaller selection. */
export const MAX_FILL_PIXELS = 64_000_000;

/** A crop shrunk more than this has the photo's grain put back into its fill (it's as soft as 512 px across). */
export const GRAIN_BELOW_SCALE = 1 / 1.3;

/** A box of document pixels (x1, y1 excluded). */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * How far the hole grows past the selection (an object's edge and halo go too, as Photoshop's Remove does), and how
 * soft its edge is, for a canvas this size. `grow` ≥ 2 × `feather`, so whatever was selected is replaced entirely.
 */
export function fillReach(canvas: Size): { grow: number; feather: number } {
  const grow = Math.max(4, Math.round(Math.max(canvas.width, canvas.height) * 0.003));
  return { grow, feather: Math.max(2, Math.round(grow / 3)) };
}

/** The box a fill works in: the selection's, grown by `grow`, inside the canvas (null when that's nothing). */
export function fillBox(selection: PixelBox, grow: number, canvas: Size): PixelBox | null {
  const box = {
    x0: Math.max(0, Math.floor(selection.x0) - grow),
    y0: Math.max(0, Math.floor(selection.y0) - grow),
    x1: Math.min(canvas.width, Math.ceil(selection.x1) + grow),
    y1: Math.min(canvas.height, Math.ceil(selection.y1) + grow),
  };
  return box.x1 > box.x0 && box.y1 > box.y0 ? box : null;
}

/** Which of a box's sides are the canvas's own (past them there's no photo: a hole there runs on). */
const canvasSides = (box: PixelBox, canvas: Size) => ({ left: box.x0 <= 0, top: box.y0 <= 0, right: box.x1 >= canvas.width, bottom: box.y1 >= canvas.height });

/**
 * A box's 0/1 values grown by a square of radius `r` (`value` 1) or shrunk by one (`value` 0: what's 0 grows),
 * row then column, in O(pixels). Past a canvas side (`sides`) the values run on as at the edge; past another, 0.
 */
function grow(values: Uint8Array, w: number, h: number, r: number, value: 0 | 1, sides: ReturnType<typeof canvasSides>): Uint8Array {
  const out = new Uint8Array(w * h);
  const tmp = new Uint8Array(w * h);
  const other = value ^ 1;
  // Rows: the nearest `value` either way.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let last = (sides.left ? values[row] : 0) === value ? -1 : -Infinity;
    for (let x = 0; x < w; x++) {
      if (values[row + x] === value) last = x;
      tmp[row + x] = x - last <= r ? value : other;
    }
    let next = (sides.right ? values[row + w - 1] : 0) === value ? w : Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (values[row + x] === value) next = x;
      if (next - x <= r) tmp[row + x] = value;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = (sides.top ? tmp[x] : 0) === value ? -1 : -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x] === value) last = y;
      out[y * w + x] = y - last <= r ? value : other;
    }
    let next = (sides.bottom ? tmp[(h - 1) * w + x] : 0) === value ? h : Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x] === value) next = y;
      if (next - y <= r) out[y * w + x] = value;
    }
  }
  return out;
}

/** The hole: what the selection covers at all (`coverage` over `box`), grown by `r`. 1 where it fills. */
export function growHole(coverage: Uint8Array, box: PixelBox, r: number, canvas: Size): Uint8Array {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const covered = new Uint8Array(w * h);
  for (let i = 0; i < covered.length; i++) covered[i] = coverage[i] > 0 ? 1 : 0;
  // Past the box there's nothing selected (it holds the selection with room to grow), unless it's the canvas's side.
  return grow(covered, w, h, r, 1, canvasSides(box, canvas));
}

/**
 * How much of the fill shows at each pixel (0..255): the hole shrunk by `feather`, then blurred by it, so it's 0
 * past the hole and 255 at least `2 × feather` inside it. At a canvas side the hole runs on.
 */
export function fillAlpha(hole: Uint8Array, box: PixelBox, feather: number, canvas: Size): Uint8Array {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const sides = canvasSides(box, canvas);
  const core = grow(hole, w, h, feather, 0, sides);
  // A box blur of radius `feather`, rows then columns; past a canvas side the edge runs on, past another it's 0.
  const f = feather;
  const rows = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const at = (x: number) => (x < 0 ? (sides.left ? core[row] : 0) : x >= w ? (sides.right ? core[row + w - 1] : 0) : core[row + x]);
    let sum = 0;
    for (let x = -f; x <= f; x++) sum += at(x);
    for (let x = 0; x < w; x++) {
      rows[row + x] = sum;
      sum += at(x + f + 1) - at(x - f);
    }
  }
  const out = new Uint8Array(w * h);
  const area = (2 * f + 1) ** 2;
  for (let x = 0; x < w; x++) {
    const at = (y: number) => (y < 0 ? (sides.top ? rows[x] : 0) : y >= h ? (sides.bottom ? rows[(h - 1) * w + x] : 0) : rows[y * w + x]);
    let sum = 0;
    for (let y = -f; y <= f; y++) sum += at(y);
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round((255 * sum) / area);
      sum += at(y + f + 1) - at(y - f);
    }
  }
  return out;
}

/** One pass of the model: a square of the photo (it may run past the canvas: reflected there), and its holes. */
export interface FillCrop {
  /** Its top-left, in document pixels. */
  x: number;
  y: number;
  side: number;
  /** Model pixels per document pixel: 1 (a 512 crop) or less. */
  scale: number;
  /** The box of the holes it fills, in document pixels. */
  hole: PixelBox;
  /** Which holes (`FillPlan.labels`) it fills. */
  members: number[];
}

export interface FillPlan {
  /** Largest first: the small holes after, at full resolution, see the large ones filled. */
  crops: FillCrop[];
  /** Each `block`-pixel block of the box's hole (-1: none), row by row, `blocksWide` a row. */
  labels: Int32Array;
  block: number;
  blocksWide: number;
  box: PixelBox;
}

/** The hole (over `box`) a pixel at document (x, y) belongs to: its label, or -1. */
export const holeAt = (plan: FillPlan, x: number, y: number): number =>
  plan.labels[Math.floor((y - plan.box.y0) / plan.block) * plan.blocksWide + Math.floor((x - plan.box.x0) / plan.block)] ?? -1;

/**
 * The crops that fill a hole (over `box`). Holes are the hole's parts, by blocks of 16 pixels (touching blocks are
 * one part). Each gets a square crop FILL_CONTEXT × its size, at least 512 and at most the canvas's longer side,
 * kept inside the canvas where it fits. Two parts share a crop only if it's hardly bigger than the larger's own:
 * a tree and the sheep beside it are filled apart, the sheep at full resolution.
 */
export function planFill(hole: Uint8Array, box: PixelBox, canvas: Size): FillPlan {
  const B = 16;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  const blocks = new Uint8Array(bw * bh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (hole[y * w + x]) blocks[Math.floor(y / B) * bw + Math.floor(x / B)] = 1;
  const labels = new Int32Array(bw * bh).fill(-1);
  const parts: PixelBox[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i] || labels[i] >= 0) continue;
    const id = parts.length;
    const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const stack = [i];
    labels[i] = id;
    while (stack.length) {
      const j = stack.pop()!;
      const bx = j % bw;
      const by = Math.floor(j / bw);
      r.x0 = Math.min(r.x0, bx);
      r.y0 = Math.min(r.y0, by);
      r.x1 = Math.max(r.x1, bx + 1);
      r.y1 = Math.max(r.y1, by + 1);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx;
          const ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const k = ny * bw + nx;
          if (blocks[k] && labels[k] < 0) {
            labels[k] = id;
            stack.push(k);
          }
        }
    }
    parts.push({ x0: box.x0 + r.x0 * B, y0: box.y0 + r.y0 * B, x1: Math.min(box.x1, box.x0 + r.x1 * B), y1: Math.min(box.y1, box.y0 + r.y1 * B) });
  }
  const longest = Math.max(canvas.width, canvas.height);
  const sideOf = (r: PixelBox) => Math.max(FILL_SIDE, Math.min(longest, Math.ceil(FILL_CONTEXT * Math.max(r.x1 - r.x0, r.y1 - r.y0))));
  const cropOf = (r: PixelBox, members: number[]): FillCrop => {
    const side = sideOf(r);
    // Inside the canvas where it fits; centred on it (reflected past it) where it doesn't.
    const place = (centre: number, size: number) => Math.round(side <= size ? Math.min(Math.max(centre - side / 2, 0), size - side) : (size - side) / 2);
    return { x: place((r.x0 + r.x1) / 2, canvas.width), y: place((r.y0 + r.y1) / 2, canvas.height), side, scale: side === FILL_SIDE ? 1 : FILL_SIDE / side, hole: r, members };
  };
  let crops = parts.map((r, i) => cropOf(r, [i]));
  for (let merged = true; merged; ) {
    merged = false;
    search: for (let a = 0; a < crops.length; a++)
      for (let b = a + 1; b < crops.length; b++) {
        const p = crops[a];
        const q = crops[b];
        const r = { x0: Math.min(p.hole.x0, q.hole.x0), y0: Math.min(p.hole.y0, q.hole.y0), x1: Math.max(p.hole.x1, q.hole.x1), y1: Math.max(p.hole.y1, q.hole.y1) };
        if (sideOf(r) <= 1.25 * Math.max(p.side, q.side)) {
          crops = [...crops.filter((_, i) => i !== a && i !== b), cropOf(r, [...p.members, ...q.members])];
          merged = true;
          break search;
        }
      }
  }
  crops.sort((a, b) => b.side - a.side || a.y - b.y || a.x - b.x);
  return { crops, labels, block: B, blocksWide: bw, box };
}

/** An index past an edge of 0..n−1 mirrored back in (…2 1 0 | 0 1 2 … n−1 | n−1 n−2…). */
export function reflect(v: number, n: number): number {
  if (n <= 1) return 0;
  const period = 2 * n;
  let m = ((v % period) + period) % period;
  if (m >= n) m = period - 1 - m;
  return m;
}

/** Catmull-Rom's weights for a fraction `t` between the middle two of four samples. */
function cubicWeights(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}

/**
 * The model's answer (RGB 0..255, `side` × `side`) read between its pixels at (u, v) (pixel centres at integers),
 * bicubic, into `out` (three channels), clamped to 0..255.
 */
export function sampleCubic(rgb: Float32Array | Uint8Array, side: number, u: number, v: number, out: number[]) {
  const x = Math.floor(u);
  const y = Math.floor(v);
  const wx = cubicWeights(u - x);
  const wy = cubicWeights(v - y);
  out[0] = out[1] = out[2] = 0;
  for (let j = 0; j < 4; j++) {
    const sy = Math.min(side - 1, Math.max(0, y - 1 + j));
    for (let i = 0; i < 4; i++) {
      const sx = Math.min(side - 1, Math.max(0, x - 1 + i));
      const k = wx[i] * wy[j];
      const o = (sy * side + sx) * 3;
      out[0] += rgb[o] * k;
      out[1] += rgb[o + 1] * k;
      out[2] += rgb[o + 2] * k;
    }
  }
  for (let c = 0; c < 3; c++) out[c] = Math.min(255, Math.max(0, out[c]));
}

/** A noise level: 1.4826 × the median of absolute high-pass values (grain, not edges or texture; 0 with few). */
export function noiseSigma(values: number[]): number {
  if (values.length < 50) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return 1.4826 * sorted[sorted.length >> 1];
}

/** A pixel's 3 × 3 high-pass in channel `c` of RGBA (`stride` 4) or RGB (3) samples `w` wide, at an inner pixel. */
export function highPass(data: ArrayLike<number>, w: number, x: number, y: number, c: number, stride: 3 | 4): number {
  let sum = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += data[((y + dy) * w + x + dx) * stride + c];
  return data[(y * w + x) * stride + c] - sum / 9;
}

/** The grain to add (a normal variate's scale) so a fill whose own is `have` matches `target`. */
export const grainToAdd = (target: number, have: number) => Math.sqrt(Math.max(0, target * target - have * have)) / Math.sqrt(8 / 9);

/** Normal variates from a seed, repeatable: the same fill gets the same grain. */
export function gaussian(seed: number): () => number {
  let t = seed >>> 0;
  const uniform = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

/**
 * The tests' stand-in for the model (EDITOR_PHOTO_MODELS=stand-in): the hole filled with the mean of what's around
 * it. RGB 0..255 and a mask (1 fills), `side` × `side`; answers as the model does.
 */
export function standInFill(rgb: Uint8Array, mask: Uint8Array): Float32Array {
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) continue;
    for (let c = 0; c < 3; c++) sum[c] += rgb[i * 3 + c];
    n++;
  }
  const mean = sum.map((s) => (n ? s / n : 128));
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < mask.length; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = mask[i] ? mean[c] : rgb[i * 3 + c];
  return out;
}
