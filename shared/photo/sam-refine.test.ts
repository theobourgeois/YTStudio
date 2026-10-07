import { describe, expect, it } from "vitest";
import type { PixelSample } from "./pixel-sample.ts";
import { SAM_MASK_SIDE } from "./sam.ts";
import { boxIn, chooseRefined, cropSelection, edgeOptions, maskBox, priorGrid, refineEdge, zoomBox } from "./sam-refine.ts";

const N = SAM_MASK_SIDE;

/** A mask's logits: +8 where `inside(x, y)` holds on the 256 grid, −8 elsewhere. */
const logits = (inside: (x: number, y: number) => boolean) => {
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = inside(x, y) ? 8 : -8;
  return out;
};

/** A picture: orange where `inside(x, y)`, sky blue elsewhere (alike in lightness, apart in hue). */
function picture(width: number, height: number, inside: (x: number, y: number) => boolean): PixelSample {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(inside(x, y) ? [210, 130, 60, 255] : [120, 160, 220, 255], (y * width + x) * 4);
  return { width, height, data, scale: 1 };
}

describe("Object Selection's second look", () => {
  it("finds the first answer's box in the document", () => {
    const frame = { x: 0, y: 0, width: 2048, height: 1024 };
    // Cells 64..127 across and 32..63 down: 8 × 4 document pixels each.
    expect(maskBox(logits((x, y) => x >= 64 && x < 128 && y >= 32 && y < 64), frame)).toEqual({ x: 512, y: 128, width: 512, height: 128 });
    expect(maskBox(logits(() => false), frame)).toBeNull();
  });

  it("zooms to the box and a margin, as square as the canvas allows, unless that's nearly the whole photo", () => {
    const canvas = { width: 4000, height: 3000 };
    // 400 × 200 at (1000, 1000): 560 a side, about its middle.
    expect(zoomBox({ x: 1000, y: 1000, width: 400, height: 200 }, canvas)).toEqual({ x: 920, y: 820, width: 560, height: 560 });
    // Against the canvas's corner: moved inside it.
    expect(zoomBox({ x: 0, y: 0, width: 300, height: 300 }, canvas)).toEqual({ x: 0, y: 0, width: 420, height: 420 });
    // A thing filling much of the photo: SAM saw it at about that size already.
    expect(zoomBox({ x: 500, y: 200, width: 2500, height: 2600 }, canvas)).toBeNull();
    // A tall crop on a short canvas: as tall as the canvas lets it be.
    expect(zoomBox({ x: 1000, y: 100, width: 600, height: 700 }, { width: 4000, height: 900 })).toEqual({ x: 810, y: 0, width: 980, height: 900 });
  });

  it("sees the first answer's box and mask from the crop", () => {
    const seen = boxIn({ x: 1000, y: 1000, width: 400, height: 200 }, { x: 920, y: 820, width: 560, height: 560 }, 1024);
    [80, 180, 480, 380].forEach((v, i) => expect(seen[i]).toBeCloseTo((v / 560) * 1024, 6));
    // A disc over the whole photo, seen from a crop around it: still a disc, filling as much of the crop as it does.
    const whole = { x: 0, y: 0, width: 1024, height: 1024 };
    const disc = logits((x, y) => Math.hypot(x + 0.5 - 128, y + 0.5 - 128) < 32);
    const prior = priorGrid(disc, whole, { x: 384, y: 384, width: 256, height: 256 });
    let area = 0;
    for (const v of prior) area += v;
    expect(Math.abs(area - Math.PI * 128 * 128) / (Math.PI * 128 * 128)).toBeLessThan(0.03);
    expect(prior[128 * N + 128]).toBe(1);
    expect(prior[5 * N + 5]).toBe(0);
  });

  it("keeps the second look's mask that agrees with the first, or none", () => {
    const prior = new Uint8Array(N * N);
    const disc = (x: number, y: number) => Math.hypot(x - 128, y - 128) < 60;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) prior[y * N + x] = disc(x, y) ? 1 : 0;
    const masks = new Float32Array(3 * N * N);
    masks.set(logits((x, y) => disc(x, y) && x < 100), 0);
    masks.set(logits((x, y) => Math.hypot(x - 128, y - 128) < 62), N * N);
    masks.set(logits(() => true), 2 * N * N);
    // The part is rated best but overlaps the first answer less; everything overlaps it by under a half.
    expect(chooseRefined(masks, [0.99, 0.9, 0.95], prior)).toBe(1);
    const elsewhere = new Float32Array(3 * N * N).fill(-8);
    expect(chooseRefined(elsewhere, [0.9, 0.9, 0.9], prior)).toBe(-1);
  });

  it("moves an edge SAM put a few pixels off to the photo's own, and leaves the rest alone", () => {
    // A crop 2048 wide (SAM's cells 8 pixels): the thing is orange left of x = 1024, SAM's coverage ends 6 short.
    const [w, h] = [2048, 64];
    const image = picture(w, h, (x) => x < 1024);
    const coverage = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) coverage[y * w + x] = x < 1018 ? 255 : 0;
    const refined = refineEdge(coverage, image, edgeOptions(w / N));
    const row = 32 * w;
    // Now in up to the photo's edge, out past it.
    for (const x of [1018, 1020, 1022]) expect(refined[row + x]).toBeGreaterThan(200);
    for (const x of [1025, 1027, 1030]) expect(refined[row + x]).toBeLessThan(55);
    // Far from the edge, as it was.
    expect(refined[row + 500]).toBe(255);
    expect(refined[row + 1500]).toBe(0);
  });

  it("puts a crop's coverage back where the crop is in the sample", () => {
    const values = new Uint8Array(4 * 3).fill(255);
    const shape = cropSelection(values, { x: 10, y: 20, width: 4, height: 3 }, { width: 100, height: 100, scale: 1 }, { width: 100, height: 100 })!;
    expect(shape).toMatchObject({ kind: "mask", x: 10, y: 20, width: 4, height: 3 });
  });
});
