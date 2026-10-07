/**
 * The Object Selection tool's second look at a thing (docs/photo/selections.md, "Object Selection's model"). SAM's
 * first answer is over the whole photo squeezed to 1024 × 1024, so a thing gets as many of its 256² cells as it fills
 * of the photo. The tool then looks again at the thing alone: the photo cropped to the first answer's box and a margin
 * (`zoomBox`), prompted by the stroke's points and that box, the answer kept that agrees most with the first
 * (`chooseRefined`). Last, a guided filter (He, Sun and Tang) on the crop's own pixels decides each pixel in a band
 * along the edge (`refineEdge`): its coverage follows the photo's edges there (fur, a wisp), not SAM's grid. Pure.
 */
import type { Size } from "./geometry.ts";
import { type PixelSample, coverageToSelection } from "./pixel-sample.ts";
import { SAM_MASK_SIDE } from "./sam.ts";
import type { MaskSelection } from "./types.ts";

/** A box of the document, in its pixels. */
export interface DocBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The cells of a mask (256² logits over `frame`, a box of the document) where it's the thing, as a box of the document. Null when it's nowhere. */
export function maskBox(logits: Float32Array, frame: DocBox): DocBox | null {
  const side = SAM_MASK_SIDE;
  let x0 = side;
  let y0 = side;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (logits[y * side + x] <= 0) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return null;
  const sx = frame.width / side;
  const sy = frame.height / side;
  return { x: frame.x + x0 * sx, y: frame.y + y0 * sy, width: (x1 - x0 + 1) * sx, height: (y1 - y0 + 1) * sy };
}

/** How far past the first answer's box the second look reaches, as a share of its longer side. */
const MARGIN = 0.2;
/** A crop as big as this share of the photo's longer side gains too little to be worth a second look. */
const GAIN = 0.75;

/**
 * The part of the document the second look is shown: the first answer's box (`box`), grown by `MARGIN` of its longer
 * side and made as square as the canvas lets it be (the encoder squeezes it to a square), within the canvas. Null when
 * that's nearly the whole photo: SAM saw the thing at about that size already.
 */
export function zoomBox(box: DocBox, canvas: Size): DocBox | null {
  const side = Math.max(box.width, box.height) * (1 + 2 * MARGIN);
  if (side >= GAIN * Math.max(canvas.width, canvas.height)) return null;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const w = Math.min(canvas.width, side);
  const h = Math.min(canvas.height, side);
  const x = Math.round(Math.max(0, Math.min(canvas.width - w, cx - w / 2)));
  const y = Math.round(Math.max(0, Math.min(canvas.height - h, cy - h / 2)));
  return { x, y, width: Math.round(Math.min(w, canvas.width - x)), height: Math.round(Math.min(h, canvas.height - y)) };
}

/** A box of the document as the encoder's square sees `frame`: [x0, y0, x1, y1] in its 1024 pixels. */
export function boxIn(box: DocBox, frame: DocBox, square: number): [number, number, number, number] {
  const sx = square / frame.width;
  const sy = square / frame.height;
  return [(box.x - frame.x) * sx, (box.y - frame.y) * sy, (box.x + box.width - frame.x) * sx, (box.y + box.height - frame.y) * sy];
}

/** The first answer (256² logits over `from`) on the second look's grid (256² over `to`): 1 where it was the thing. */
export function priorGrid(logits: Float32Array, from: DocBox, to: DocBox): Uint8Array {
  const side = SAM_MASK_SIDE;
  const out = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) {
    const dy = to.y + ((y + 0.5) * to.height) / side;
    const fy = Math.floor(((dy - from.y) / from.height) * side);
    if (fy < 0 || fy >= side) continue;
    for (let x = 0; x < side; x++) {
      const dx = to.x + ((x + 0.5) * to.width) / side;
      const fx = Math.floor(((dx - from.x) / from.width) * side);
      if (fx >= 0 && fx < side && logits[fy * side + fx] > 0) out[y * side + x] = 1;
    }
  }
  return out;
}

/** Below this overlap with the first answer, the second look found something else: the first answer stands. */
const AGREEMENT = 0.5;

/**
 * Which of the second look's masks (3 × 256² logits, rated by `scores`) is the thing the first answer found (`prior`
 * on the same grid): the best rated once weighed by its overlap with it (intersection over union). −1 when none
 * overlaps it by `AGREEMENT`.
 */
export function chooseRefined(masks: Float32Array, scores: ArrayLike<number>, prior: Uint8Array): number {
  const n = SAM_MASK_SIDE * SAM_MASK_SIDE;
  let best = -1;
  let bestScore = 0;
  for (let k = 0; k * n < masks.length; k++) {
    let both = 0;
    let either = 0;
    for (let i = 0; i < n; i++) {
      const m = masks[k * n + i] > 0;
      if (m && prior[i]) both++;
      if (m || prior[i]) either++;
    }
    const iou = either ? both / either : 0;
    if (iou < AGREEMENT) continue;
    const score = scores[k] * iou;
    if (score > bestScore) {
      best = k;
      bestScore = score;
    }
  }
  return best;
}

/** The mean of `src` over a `(2r + 1)²` square at each pixel (clipped at the picture's edges), into `out`; `tmp` is scratch. */
function boxMean(src: Float32Array, out: Float32Array, tmp: Float32Array, width: number, height: number, r: number) {
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let s = 0;
    for (let x = 0; x <= Math.min(width - 1, r); x++) s += src[row + x];
    for (let x = 0; x < width; x++) {
      const lo = Math.max(0, x - r);
      const hi = Math.min(width - 1, x + r);
      tmp[row + x] = s / (hi - lo + 1);
      if (x + r + 1 < width) s += src[row + x + r + 1];
      if (x - r >= 0) s -= src[row + x - r];
    }
  }
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = 0; y <= Math.min(height - 1, r); y++) s += tmp[y * width + x];
    for (let y = 0; y < height; y++) {
      const lo = Math.max(0, y - r);
      const hi = Math.min(height - 1, y + r);
      out[y * width + x] = s / (hi - lo + 1);
      if (y + r + 1 < height) s += tmp[(y + r + 1) * width + x];
      if (y - r >= 0) s -= tmp[(y - r) * width + x];
    }
  }
}

/** How the edge is refined, in the crop's pixels. */
export interface EdgeOptions {
  /** Pixels either side of the edge that are decided again (further in or out is left as it was). */
  band: number;
  /** The guided filter's radius. */
  radius: number;
  /** Its regulariser (on 0..1 colours): smaller follows the photo's edges more closely. */
  eps: number;
  /**
   * How much steeper than the filter's own the coverage crosses from out to in (about 0.5): the filter leans a little
   * soft, and on a photo of a tabby against the sky 1 left a faint blur along the back, 2 began to lose its fur.
   */
  contrast: number;
}

/** How the edge is refined for a crop whose mask cells are `cell` of its pixels: SAM's edge is off by up to about two. */
export const edgeOptions = (cell: number): EdgeOptions => ({ band: Math.max(3, Math.round(2 * cell)), radius: Math.max(2, Math.round(cell)), eps: 1e-4, contrast: 1.5 });

/** The pictures are refined a square of this many pixels at a time (with the filter's reach around it), only where the band is. */
const TILE = 128;

/**
 * The coverage of a crop (`coverage`, 0..255, the size of `image`) with its edge decided by the crop's own colours:
 * a guided filter of the coverage, guided by the image's colour (He, Sun and Tang's colour guide, so a thing and what's
 * behind it part where their hues differ, not only their lightness), replaces it in a band `band` pixels either side
 * of the edge (where it isn't all one thing within that distance), so the edge moves to the photo's own and fine
 * strands come in part (steepened by `contrast`). Away from the edge it's unchanged. Worked a tile at a time, and only
 * tiles the band crosses. A new array.
 */
export function refineEdge(coverage: Uint8Array, image: PixelSample, options: EdgeOptions): Uint8Array {
  const { width, height } = image;
  const { band, radius: r } = options;
  // The band: where the mask isn't all in or all out within `band` pixels (a box sum of in-or-out, by rows then
  // columns, kept as counts so it's exact).
  const inside = new Uint8Array(width * height);
  for (let i = 0; i < inside.length; i++) inside[i] = coverage[i] >= 128 ? 1 : 0;
  const rows = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    for (let x = 0; x <= Math.min(width - 1, band); x++) s += inside[y * width + x];
    for (let x = 0; x < width; x++) {
      rows[y * width + x] = s;
      if (x + band + 1 < width) s += inside[y * width + x + band + 1];
      if (x - band >= 0) s -= inside[y * width + x - band];
    }
  }
  const inBand = new Uint8Array(width * height);
  // How far inside SAM's edge each band pixel is (negative: outside), from the share of its window that's in: across
  // a straight edge the share goes from 0 to 1 over the window's width.
  const depth = new Float32Array(width * height);
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = 0; y <= Math.min(height - 1, band); y++) s += rows[y * width + x];
    for (let y = 0; y < height; y++) {
      const w = Math.min(width - 1, x + band) - Math.max(0, x - band) + 1;
      const h = Math.min(height - 1, y + band) - Math.max(0, y - band) + 1;
      inBand[y * width + x] = s > 0 && s < w * h ? 1 : 0;
      depth[y * width + x] = (s / (w * h) - 0.5) * (2 * band + 1);
      if (y + band + 1 < height) s += rows[(y + band + 1) * width + x];
      if (y - band >= 0) s -= rows[(y - band) * width + x];
    }
  }
  const out = new Uint8Array(coverage);
  // Known colours are looked for this far round a band pixel (past the band on both sides), and the filter's own
  // windows need their radius twice over.
  const reach = 2 * band + r;
  const margin = reach + 2 * r;
  for (let ty = 0; ty < height; ty += TILE) {
    for (let tx = 0; tx < width; tx += TILE) {
      const x1 = Math.min(width, tx + TILE);
      const y1 = Math.min(height, ty + TILE);
      let any = false;
      for (let y = ty; y < y1 && !any; y++) for (let x = tx; x < x1; x++) if (inBand[y * width + x]) { any = true; break; }
      if (any) refineTile(coverage, image, inBand, depth, out, { x0: Math.max(0, tx - margin), y0: Math.max(0, ty - margin), x1: Math.min(width, x1 + margin), y1: Math.min(height, y1 + margin) }, { tx, ty, x1, y1 }, reach, options);
    }
  }
  return out;
}

/** Colours closer than this (squared distance on 0..1 RGB) can't tell a thing from what's behind it: SAM's edge stands there. */
const SEPARABLE = 0.02;

/**
 * The band's coverage over `region` of the crop, written into `out` where the band is within the tile. Each band
 * pixel's colour is placed on the line between the thing's colour and the background's near it (the means of the
 * pixels around it known to be in, and known to be out: past the band, within `reach`), which is its coverage (Knockout's
 * and the colour-line model's idea): the edge goes where the colours change, and a strand of fur over the sky comes in
 * as much as it covers. Where the two colours are alike that can't decide, and SAM's coverage is kept, in proportion.
 * A colour guided filter (He, Sun and Tang), radius `r`, then takes out the noise. Colour has the last word near SAM's
 * edge only (`trust`): SAM is rarely off by more than a cell, and colour alone is fooled by a thing's own pale parts.
 */
function refineTile(
  coverage: Uint8Array,
  image: PixelSample,
  inBand: Uint8Array,
  depth: Float32Array,
  out: Uint8Array,
  region: { x0: number; y0: number; x1: number; y1: number },
  tile: { tx: number; ty: number; x1: number; y1: number },
  reach: number,
  options: EdgeOptions,
) {
  // Colour decides fully within half the band of SAM's edge; past that SAM's answer comes back by the band's end, so a
  // pale strand deep in fur that's the sky's colour isn't taken out, nor a twig of the fur's colour far outside taken in.
  const half = options.band / 2;
  const trust = (d: number) => {
    const t = Math.max(0, Math.min(1, (d - half) / half));
    return t * t * (3 - 2 * t);
  };
  const W = region.x1 - region.x0;
  const H = region.y1 - region.y0;
  const n = W * H;
  const arr = () => new Float32Array(n);
  const I = [arr(), arr(), arr()];
  const p = arr();
  const known = [arr(), arr()];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = (region.y0 + y) * image.width + region.x0 + x;
      const i = y * W + x;
      const a = image.data[j * 4 + 3] / 255;
      // Over white where it's transparent, as the models read it.
      for (let c = 0; c < 3; c++) I[c][i] = (image.data[j * 4 + c] * a + 255 * (1 - a)) / 255;
      p[i] = coverage[j] / 255;
      if (!inBand[j]) known[coverage[j] >= 128 ? 0 : 1][i] = 1;
    }
  }
  const tmp = arr();
  const scratch = arr();
  const mean = (src: Float32Array, radius: number) => {
    const m = arr();
    boxMean(src, m, tmp, W, H, radius);
    return m;
  };
  const product = (a: Float32Array, b: Float32Array, radius: number) => {
    for (let i = 0; i < n; i++) scratch[i] = a[i] * b[i];
    return mean(scratch, radius);
  };
  // The thing's colour and the background's near each pixel: known pixels' means (as fractions of the window, so the
  // division by how many are known cancels the window's size).
  const [inside, outside] = known.map((k) => ({ share: mean(k, reach), colour: I.map((c) => product(c, k, reach)) }));
  const alpha = arr();
  for (let i = 0; i < n; i++) {
    if (!(inside.share[i] > 0) || !(outside.share[i] > 0)) {
      alpha[i] = p[i];
      continue;
    }
    let dot = 0;
    let span = 0;
    for (let c = 0; c < 3; c++) {
      const f = inside.colour[c][i] / inside.share[i];
      const b = outside.colour[c][i] / outside.share[i];
      dot += (I[c][i] - b) * (f - b);
      span += (f - b) * (f - b);
    }
    const sure = Math.min(1, span / SEPARABLE);
    const fromColour = span > 1e-9 ? Math.max(0, Math.min(1, dot / span)) : p[i];
    alpha[i] = sure * fromColour + (1 - sure) * p[i];
  }
  // The colour guided filter of that coverage: alpha ≈ a · I + b in each window.
  const r = options.radius;
  const mI = I.map((c) => mean(c, r));
  const mp = mean(alpha, r);
  const mIp = I.map((c) => product(c, alpha, r));
  const pairs: [number, number][] = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]];
  const cov = pairs.map(([a, b]) => {
    const m = product(I[a], I[b], r);
    for (let i = 0; i < n; i++) m[i] -= mI[a][i] * mI[b][i];
    return m;
  });
  const eps = options.eps;
  for (let i = 0; i < n; i++) {
    const rr = cov[0][i] + eps, rg = cov[1][i], rb = cov[2][i], gg = cov[3][i] + eps, gb = cov[4][i], bb = cov[5][i] + eps;
    const i00 = gg * bb - gb * gb, i01 = rb * gb - rg * bb, i02 = rg * gb - rb * gg;
    const i11 = rr * bb - rb * rb, i12 = rb * rg - rr * gb, i22 = rr * gg - rg * rg;
    const det = rr * i00 + rg * i01 + rb * i02;
    const c0 = mIp[0][i] - mI[0][i] * mp[i], c1 = mIp[1][i] - mI[1][i] * mp[i], c2 = mIp[2][i] - mI[2][i] * mp[i];
    const a0 = (i00 * c0 + i01 * c1 + i02 * c2) / det;
    const a1 = (i01 * c0 + i11 * c1 + i12 * c2) / det;
    const a2 = (i02 * c0 + i12 * c1 + i22 * c2) / det;
    mIp[0][i] = a0;
    mIp[1][i] = a1;
    mIp[2][i] = a2;
    mp[i] = mp[i] - a0 * mI[0][i] - a1 * mI[1][i] - a2 * mI[2][i];
  }
  const ma = mIp.map((m) => mean(m, r));
  const mb = mean(mp, r);
  for (let y = tile.ty; y < tile.y1; y++) {
    for (let x = tile.tx; x < tile.x1; x++) {
      const j = y * image.width + x;
      if (!inBand[j]) continue;
      const i = (y - region.y0) * W + x - region.x0;
      const q = ma[0][i] * I[0][i] + ma[1][i] * I[1][i] + ma[2][i] * I[2][i] + mb[i];
      const sharp = (q - 0.5) * options.contrast + 0.5;
      const d = depth[j];
      out[j] = Math.round(Math.max(trust(d), Math.min(1 - trust(-d), sharp)) * 255);
    }
  }
}

/**
 * A crop's coverage (`values`, `at.width × at.height`, at `at` in a sample's pixels) as a selection of the document:
 * nothing outside the crop (it holds the thing and a margin round it).
 */
export function cropSelection(values: Uint8Array, at: DocBox, sample: { width: number; height: number; scale: number }, canvas: Size): MaskSelection | null {
  if (at.x === 0 && at.y === 0 && at.width === sample.width && at.height === sample.height) return coverageToSelection(values, sample.width, sample.height, sample.scale, canvas);
  const full = new Uint8Array(sample.width * sample.height);
  for (let y = 0; y < at.height; y++) full.set(values.subarray(y * at.width, (y + 1) * at.width), (at.y + y) * sample.width + at.x);
  return coverageToSelection(full, sample.width, sample.height, sample.scale, canvas);
}
