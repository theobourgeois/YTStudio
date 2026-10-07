/**
 * Select Subject (docs/photo/selections.md): a segmentation model finds the photo's main subject. The model is
 * IS-Net (Qin et al., "Highly Accurate Dichotomous Image Segmentation", ECCV 2022; Apache-2.0 weights) as an ONNX
 * file, run in the tab by ONNX Runtime on the GPU. This is what's around it: the photo squeezed to the model's
 * 1024 × 1024 input (normalised as it was trained), and its answer (a probability a pixel) made a selection of the
 * document's pixels. Pure.
 */
import type { Size } from "./geometry.ts";
import { type PixelSample, coverageToSelection } from "./pixel-sample.ts";
import type { PhotoModelStatus } from "./models.ts";
import type { MaskSelection } from "./types.ts";

/** The model's side: it reads and answers 1024 × 1024. */
export const SUBJECT_SIDE = 1024;

/** The model file the server keeps (downloaded once, checked). */
export const SUBJECT_MODEL = {
  name: "IS-Net (general use), fp16",
  file: "isnet-general-use-fp16.onnx",
  url: "https://huggingface.co/imgly/isnet-general-onnx/resolve/main/onnx/model_fp16.onnx",
  size: 88_152_708,
  sha256: "2eb4b5dda7ec41c617e59706e5aafa1f978c9a5f983d2518d9f0ae4d6eb04f20",
  input: "input",
  output: "output",
};

/** Whether the model is here (`/api/photo/models/subject`). */
export type SubjectModelStatus = PhotoModelStatus;

/** A sample's colour at (x, y) read between pixels, over white where it's transparent, 0..255. */
function colourAt(s: PixelSample, x: number, y: number, c: number): number {
  const x0 = Math.max(0, Math.min(s.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(s.height - 1, Math.floor(y)));
  const x1 = Math.min(s.width - 1, x0 + 1);
  const y1 = Math.min(s.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const v = (px: number, py: number) => {
    const i = (py * s.width + px) * 4;
    const a = s.data[i + 3] / 255;
    return s.data[i + c] * a + 255 * (1 - a);
  };
  return (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
}

/** The model's input: the sample stretched to 1024 × 1024, planar RGB, (v − 128) / 256 as IS-Net was trained. */
export function subjectInput(sample: PixelSample): Float32Array {
  const n = SUBJECT_SIDE;
  const out = new Float32Array(3 * n * n);
  const sx = sample.width / n;
  const sy = sample.height / n;
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) * sx - 0.5;
      for (let c = 0; c < 3; c++) out[c * n * n + y * n + x] = (colourAt(sample, u, v, c) - 128) / 256;
    }
  }
  return out;
}

/** Below this a pixel isn't the subject at all, above 1 − it wholly is: the model's haze is left out. */
const CERTAIN = 0.02;

/** A box of a sample, in its pixels. */
export interface SampleBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of a sample inside `box` (document pixels, clipped to the sample), as a sample of its own and where it is
 * in the sample's pixels, or null when nothing of it is in the sample. Select Subject on one layer looks at its box
 * alone: the whole canvas shows the model a picture on blank space, whose subject is the picture.
 */
export function cropSample(sample: PixelSample, box: { x: number; y: number; width: number; height: number }): { crop: PixelSample; at: SampleBox } | null {
  const x0 = Math.max(0, Math.floor(box.x * sample.scale));
  const y0 = Math.max(0, Math.floor(box.y * sample.scale));
  const x1 = Math.min(sample.width, Math.ceil((box.x + box.width) * sample.scale));
  const y1 = Math.min(sample.height, Math.ceil((box.y + box.height) * sample.scale));
  if (x1 <= x0 || y1 <= y0) return null;
  const width = x1 - x0;
  const height = y1 - y0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) data.set(sample.data.subarray(((y0 + y) * sample.width + x0) * 4, ((y0 + y) * sample.width + x1) * 4), y * width * 4);
  return { crop: { width, height, data, scale: sample.scale }, at: { x: x0, y: y0, width, height } };
}

/**
 * The model's answer (`side × side` probabilities) as a selection of the document: stretched back to the sample's
 * size (or to `box` of it, when the model looked at that part alone), then to the document's.
 */
export function subjectSelection(probabilities: Float32Array, side: number, sample: { width: number; height: number; scale: number }, canvas: Size, box?: SampleBox): MaskSelection | null {
  const full = new Uint8Array(sample.width * sample.height);
  const { x: bx, y: by, width, height } = box ?? { x: 0, y: 0, width: sample.width, height: sample.height };
  const values = new Uint8Array(width * height);
  const at = (x: number, y: number) => probabilities[Math.max(0, Math.min(side - 1, y)) * side + Math.max(0, Math.min(side - 1, x))];
  for (let y = 0; y < height; y++) {
    const v = ((y + 0.5) * side) / height - 0.5;
    const y0 = Math.floor(v);
    const fy = v - y0;
    for (let x = 0; x < width; x++) {
      const u = ((x + 0.5) * side) / width - 0.5;
      const x0 = Math.floor(u);
      const fx = u - x0;
      const p = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      values[y * width + x] = p < CERTAIN ? 0 : p > 1 - CERTAIN ? 255 : Math.round(p * 255);
    }
  }
  if (!box) return coverageToSelection(values, width, height, sample.scale, canvas);
  for (let y = 0; y < height; y++) full.set(values.subarray(y * width, (y + 1) * width), (by + y) * sample.width + bx);
  return coverageToSelection(full, sample.width, sample.height, sample.scale, canvas);
}

/**
 * The tests' stand-in for the model (no download, no GPU): what's unlike the photo's border is the subject. Same
 * shape as the model's answer.
 */
export function standInProbabilities(sample: PixelSample): Float32Array {
  const n = SUBJECT_SIDE;
  const border = [0, 0, 0];
  let count = 0;
  const add = (x: number, y: number) => {
    for (let c = 0; c < 3; c++) border[c] += colourAt(sample, x, y, c);
    count++;
  };
  for (let x = 0; x < sample.width; x++) (add(x, 0), add(x, sample.height - 1));
  for (let y = 0; y < sample.height; y++) (add(0, y), add(sample.width - 1, y));
  for (let c = 0; c < 3; c++) border[c] /= count;
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5) * sample.width) / n - 0.5;
      const v = ((y + 0.5) * sample.height) / n - 0.5;
      const d = Math.max(...[0, 1, 2].map((c) => Math.abs(colourAt(sample, u, v, c) - border[c])));
      out[y * n + x] = d > 48 ? 1 : 0;
    }
  }
  return out;
}
