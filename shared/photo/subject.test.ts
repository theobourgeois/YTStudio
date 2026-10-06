import { describe, expect, it } from "vitest";
import { pixelCoverage } from "./selection.ts";
import { SUBJECT_SIDE, cropSample, standInProbabilities, subjectInput, subjectSelection } from "./subject.ts";

describe("Select Subject's model input and answer", () => {
  const width = 64;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(x >= 16 && x < 48 && y >= 8 && y < 24 ? [250, 250, 250, 255] : [10, 10, 10, 255], (y * width + x) * 4);
  const sample = { width, height, data, scale: 0.5 };

  it("normalises the photo stretched to 1024 × 1024 as IS-Net was trained", () => {
    const input = subjectInput(sample);
    expect(input.length).toBe(3 * SUBJECT_SIDE * SUBJECT_SIDE);
    expect(input[0]).toBeCloseTo((10 - 128) / 256);
    expect(input[512 * SUBJECT_SIDE + 512]).toBeCloseTo((250 - 128) / 256);
  });

  it("turns probabilities into the document's selection", () => {
    const s = subjectSelection(standInProbabilities(sample), SUBJECT_SIDE, sample, { width: 128, height: 64 })!;
    expect(pixelCoverage(s, 64, 32)).toBe(1);
    expect(pixelCoverage(s, 5, 5)).toBe(0);
    expect(s.x).toBeGreaterThanOrEqual(30);
    expect(s.x).toBeLessThanOrEqual(34);
  });

  it("looks at one box alone, and puts its answer back where the box is", () => {
    // The right half of the document (x 64..128 at scale 0.5: sample x 32..64), where the bright square's right half is.
    const part = cropSample(sample, { x: 64, y: -10, width: 100, height: 100 })!;
    expect(part.at).toEqual({ x: 32, y: 0, width: 32, height: 32 });
    // Its top-left is the dark ground; its row 8 starts inside the bright square.
    expect([part.crop.width, part.crop.height, part.crop.data[0], part.crop.data[8 * 32 * 4]]).toEqual([32, 32, 10, 250]);
    // Every pixel of the crop is "subject" for a model that sees a uniform box: only the box is selected.
    const all = new Float32Array(SUBJECT_SIDE * SUBJECT_SIDE).fill(1);
    const s = subjectSelection(all, SUBJECT_SIDE, sample, { width: 128, height: 64 }, part.at)!;
    expect(pixelCoverage(s, 100, 30)).toBe(1);
    expect(pixelCoverage(s, 20, 30)).toBe(0);
    expect(cropSample(sample, { x: 500, y: 0, width: 10, height: 10 })).toBeNull();
  });
});
