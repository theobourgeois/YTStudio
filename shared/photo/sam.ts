/**
 * The Object Selection tool's model (docs/photo/selections.md): SAM 2.1 (Meta's Segment Anything 2.1, Hiera small;
 * Apache-2.0 weights), as onnx-community exported it for Transformers.js: a vision encoder run once per photo (the
 * photo squeezed to 1024 × 1024, ImageNet's normalisation) and a prompt decoder run per stroke, in milliseconds, on
 * what the encoder made. The stroke prompts it as points (a box from a rough stroke cuts off what it didn't reach);
 * of its three answers the one it rates best that holds most of the stroke is kept. Pure.
 */
import type { Size } from "./geometry.ts";
import { type PixelSample, coverageToSelection } from "./pixel-sample.ts";
import { dabsAlong } from "./quick-select.ts";
import { colourAt } from "./subject.ts";
import type { MaskSelection } from "./types.ts";

type Point = { x: number; y: number };

/** The encoder's input side: the photo is squeezed to a square of it. */
export const SAM_SIDE = 1024;
/** The decoder's masks' side (logits over the encoder's square). */
export const SAM_MASK_SIDE = 256;

const REPO = "https://huggingface.co/onnx-community/sam2.1-hiera-small-ONNX/resolve/a7df49d8de14b9d2e4504d1687b0d568f905fd8d/onnx/";
const part = (name: string, location: string, size: number, sha256: string) => ({ name, file: `sam2.1-hiera-small-${location}`, url: REPO + location, size, sha256, location });

/** The encoder: `pixel_values` (1 × 3 × 1024 × 1024) to its three embeddings, the decoder's inputs. */
export const SAM_ENCODER = {
  graph: part("SAM 2.1 (Hiera small) vision encoder, fp16", "vision_encoder_fp16.onnx", 422_501, "f236074c31a7ba9d1e00362e8c29cb95bf9dcdd61e208048493902878d9dc4db"),
  weights: part("SAM 2.1 (Hiera small) vision encoder's weights", "vision_encoder_fp16.onnx_data", 81_182_784, "557e013522bace72a6b8441f66747f1c4b2a237d1e3c86f84dba86b6d814ec1f"),
  input: "pixel_values",
  /** 1 × 32 × 256², 1 × 64 × 128², 1 × 256 × 64². */
  outputs: ["image_embeddings.0", "image_embeddings.1", "image_embeddings.2"],
};

/**
 * The decoder: the embeddings, `input_points` (1 × 1 × n × 2, in the encoder's square's pixels), `input_labels`
 * (int64, 1 × 1 × n: 1 is the thing) and `input_boxes` (1 × 0 × 4: none) to `pred_masks` (1 × 1 × 3 × 256 × 256
 * logits), `iou_scores` (1 × 1 × 3: how good it thinks each is) and `object_score_logits` (under 0: nothing there).
 */
export const SAM_DECODER = {
  graph: part("SAM 2.1 (Hiera small) prompt decoder, fp16", "prompt_encoder_mask_decoder_fp16.onnx", 229_799, "b36b0f515864220402b18054e37f236e7ef33486a7716fb45d0df17c64332392"),
  weights: part("SAM 2.1 (Hiera small) prompt decoder's weights", "prompt_encoder_mask_decoder_fp16.onnx_data", 10_454_016, "33fc89eb7fb87fd638c7232a5bb6f8a1743bd4eee1a4aadca88a141f5b35945f"),
  points: "input_points",
  labels: "input_labels",
  boxes: "input_boxes",
  masks: "pred_masks",
  scores: "iou_scores",
  object: "object_score_logits",
};

/** Every file of it, downloaded together. */
export const SAM_FILES = [SAM_ENCODER.graph, SAM_ENCODER.weights, SAM_DECODER.graph, SAM_DECODER.weights];

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** The encoder's input: the sample squeezed to 1024 × 1024 (over white where it's transparent), planar RGB, ImageNet's normalisation. */
export function samInput(sample: PixelSample): Float32Array {
  const n = SAM_SIDE;
  const out = new Float32Array(3 * n * n);
  const sx = sample.width / n;
  const sy = sample.height / n;
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) * sx - 0.5;
      for (let c = 0; c < 3; c++) out[c * n * n + y * n + x] = (colourAt(sample, u, v, c) / 255 - MEAN[c]) / STD[c];
    }
  }
  return out;
}

/** At most this many points prompt it: SAM was trained on a handful. */
const MAX_POINTS = 6;

/**
 * The points a stroke prompts with, in the encoder's square's pixels: along the strokes' middles (`strokes` in
 * document points, painted `size` across, over a `canvas` the square squeezes), spread out (each the farthest from
 * those taken, from the one nearest their middle), none closer than the brush's radius to another.
 */
export function samPoints(strokes: readonly (readonly Point[])[], size: number, canvas: Size): Point[] {
  const r = size / 2;
  const candidates = strokes.flatMap((stroke) => dabsAlong(stroke, Math.max(1, r)));
  if (!candidates.length) return [];
  const mx = candidates.reduce((s, p) => s + p.x, 0) / candidates.length;
  const my = candidates.reduce((s, p) => s + p.y, 0) / candidates.length;
  let first = 0;
  for (let i = 1; i < candidates.length; i++) if (Math.hypot(candidates[i].x - mx, candidates[i].y - my) < Math.hypot(candidates[first].x - mx, candidates[first].y - my)) first = i;
  const taken = [candidates[first]];
  const nearest = candidates.map((p) => Math.hypot(p.x - taken[0].x, p.y - taken[0].y));
  while (taken.length < MAX_POINTS) {
    let far = 0;
    for (let i = 1; i < candidates.length; i++) if (nearest[i] > nearest[far]) far = i;
    if (nearest[far] < Math.max(1, r)) break;
    const p = candidates[far];
    taken.push(p);
    for (let i = 0; i < candidates.length; i++) nearest[i] = Math.min(nearest[i], Math.hypot(candidates[i].x - p.x, candidates[i].y - p.y));
  }
  return taken.map((p) => ({ x: (p.x * SAM_SIDE) / canvas.width, y: (p.y * SAM_SIDE) / canvas.height }));
}

/**
 * Which of the decoder's three masks (`masks`: 3 × 256² logits, `scores`: its own ratings) the stroke meant: the best
 * rated once weighed by how much of what was painted (`painted`, 1 painted, on the masks' grid) it holds, so neither
 * a part of the thing the stroke spilled out of nor the thing and its surroundings wins. −1 when none holds any.
 */
export function chooseMask(masks: Float32Array, scores: ArrayLike<number>, painted: Uint8Array): number {
  const n = SAM_MASK_SIDE * SAM_MASK_SIDE;
  let paintedArea = 0;
  for (let i = 0; i < n; i++) paintedArea += painted[i];
  if (!paintedArea) return -1;
  let best = -1;
  let bestScore = 0;
  for (let k = 0; k * n < masks.length; k++) {
    let held = 0;
    for (let i = 0; i < n; i++) if (painted[i] && masks[k * n + i] > 0) held++;
    const score = scores[k] * (held / paintedArea);
    if (score > bestScore) {
      best = k;
      bestScore = score;
    }
  }
  return best;
}

/**
 * A mask (256² logits over the squeezed photo) as a selection of the document. SAM's answer is where its logits are
 * over 0: they're read between cells at the sample's size, and each pixel is covered by how far it is inside that
 * line (the logit over its slope there), so the edge is anti-aliased over a pixel and follows the thing, not the grid.
 * (A sigmoid of the logits would also half-select the wide places the model is unsure of, far from the thing.)
 */
export function samSelection(logits: Float32Array, sample: { width: number; height: number; scale: number }, canvas: Size): MaskSelection | null {
  const side = SAM_MASK_SIDE;
  const { width, height } = sample;
  const at = (x: number, y: number) => logits[Math.max(0, Math.min(side - 1, y)) * side + Math.max(0, Math.min(side - 1, x))];
  const field = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const v = ((y + 0.5) * side) / height - 0.5;
    const y0 = Math.floor(v);
    const fy = v - y0;
    for (let x = 0; x < width; x++) {
      const u = ((x + 0.5) * side) / width - 0.5;
      const x0 = Math.floor(u);
      const fx = u - x0;
      field[y * width + x] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  const values = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const l = field[i];
      const gx = (field[y * width + Math.min(width - 1, x + 1)] - field[y * width + Math.max(0, x - 1)]) / 2;
      const gy = (field[Math.min(height - 1, y + 1) * width + x] - field[Math.max(0, y - 1) * width + x]) / 2;
      const slope = Math.hypot(gx, gy);
      const cover = slope > 1e-6 ? 0.5 + l / slope : l > 0 ? 1 : 0;
      values[i] = Math.round(Math.max(0, Math.min(1, cover)) * 255);
    }
  }
  return coverageToSelection(values, width, height, sample.scale, canvas);
}
