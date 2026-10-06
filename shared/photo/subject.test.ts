import { describe, expect, it } from "vitest";
import { pixelCoverage } from "./selection.ts";
import { SUBJECT_SIDE, standInProbabilities, subjectInput, subjectSelection } from "./subject.ts";

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
});
