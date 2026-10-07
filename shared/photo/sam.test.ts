import { describe, expect, it } from "vitest";
import { paintedGrid } from "./object-select.ts";
import { SAM_FILES, SAM_MASK_SIDE, SAM_SIDE, chooseMask, samInput, samPoints, samSelection } from "./sam.ts";

const N = SAM_MASK_SIDE;

/** A mask's logits: +8 inside `inside(x, y)` (on the 256 grid), −8 outside. */
const logits = (inside: (x: number, y: number) => boolean) => {
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = inside(x + 0.5, y + 0.5) ? 8 : -8;
  return out;
};

describe("SAM", () => {
  it("names its four files, each a graph's or its weights' (by the name the graph knows)", () => {
    expect(SAM_FILES.map((f) => f.location)).toEqual(["vision_encoder_fp16.onnx", "vision_encoder_fp16.onnx_data", "prompt_encoder_mask_decoder_fp16.onnx", "prompt_encoder_mask_decoder_fp16.onnx_data"]);
    expect(new Set(SAM_FILES.map((f) => f.file)).size).toBe(4);
    for (const f of SAM_FILES) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads the photo squeezed to its square, normalised as ImageNet", () => {
    // A 4 × 2 sample: white on the left half, black on the right.
    const data = new Uint8ClampedArray(4 * 2 * 4);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) data.set(x < 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * 4 + x) * 4);
    const input = samInput({ width: 4, height: 2, data, scale: 1 });
    expect(input.length).toBe(3 * SAM_SIDE * SAM_SIDE);
    // Red, top left: (1 − 0.485) / 0.229; blue, bottom right: (0 − 0.406) / 0.225.
    expect(input[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
    expect(input[2 * SAM_SIDE * SAM_SIDE + SAM_SIDE * SAM_SIDE - 1]).toBeCloseTo(-0.406 / 0.225, 4);
  });

  it("prompts with points spread along the stroke, at most six, in the square's pixels", () => {
    const canvas = { width: 2048, height: 1024 };
    // A long stroke: six points from its middle outwards, the ends included.
    const long = samPoints([[{ x: 100, y: 500 }, { x: 1900, y: 500 }]], 40, canvas);
    expect(long).toHaveLength(6);
    for (const p of long) expect(p.y).toBeCloseTo(500, 6);
    const xs = long.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(50, 0);
    expect(xs.at(-1)).toBeCloseTo(950, 0);
    expect(long[0].x).toBeCloseTo(500, 0);
    // A dab is one point; a short stroke no more than its brush allows.
    expect(samPoints([[{ x: 1024, y: 512 }]], 40, canvas)).toEqual([{ x: 512, y: 512 }]);
    expect(samPoints([[{ x: 1000, y: 512 }, { x: 1030, y: 512 }]], 100, canvas)).toHaveLength(1);
    expect(samPoints([], 40, canvas)).toEqual([]);
  });

  it("chooses the mask that holds the stroke, not a part of it nor the thing and its surroundings", () => {
    // The thing: a disc of radius 60 at (128, 128); a part: its left half; the surroundings: everything.
    const disc = (x: number, y: number) => Math.hypot(x - 128, y - 128) < 60;
    const part = logits((x, y) => disc(x, y) && x < 110);
    const whole = logits(disc);
    const all = logits(() => true);
    const masks = new Float32Array(3 * N * N);
    masks.set(part, 0);
    masks.set(whole, N * N);
    masks.set(all, 2 * N * N);
    const painted = paintedGrid([[{ x: 90, y: 128 }, { x: 170, y: 128 }]], 20, 1, { x: 0, y: 0, width: N, height: N }, N);
    // The part holds half the stroke; the whole and everything hold all of it, and the model rates the whole best.
    expect(chooseMask(masks, [0.95, 0.9, 0.6], painted)).toBe(1);
    // Rated alike, the part still loses: it holds only half of what was painted.
    expect(chooseMask(masks, [0.9, 0.9, 0.5], painted)).toBe(1);
    // A stroke on nothing any mask holds: none.
    const elsewhere = new Float32Array(3 * N * N).fill(-8);
    expect(chooseMask(elsewhere, [0.9, 0.9, 0.9], painted)).toBe(-1);
  });

  it("makes a mask a selection of the document, its edge read between the grid's cells", () => {
    // A square from 64 to 192 on the grid: a quarter of a 1024 × 512 canvas's area, from (256, 128) to (768, 384).
    const square = logits((x, y) => x >= 64 && x < 192 && y >= 64 && y < 192);
    const shape = samSelection(square, { width: 1024, height: 512, scale: 1 }, { width: 1024, height: 512 })!;
    expect(shape.kind).toBe("mask");
    expect(Math.abs(shape.x - 256)).toBeLessThanOrEqual(4);
    expect(Math.abs(shape.x + shape.width - 768)).toBeLessThanOrEqual(4);
    expect(Math.abs(shape.y - 128)).toBeLessThanOrEqual(2);
    let area = 0;
    for (const v of shape.data) area += v / 255;
    expect(Math.abs(area - 512 * 256) / (512 * 256)).toBeLessThan(0.01);
    expect(samSelection(new Float32Array(N * N).fill(-8), { width: 64, height: 64, scale: 1 }, { width: 64, height: 64 })).toBeNull();
  });
});
