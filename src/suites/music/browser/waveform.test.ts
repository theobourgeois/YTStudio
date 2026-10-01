import { describe, expect, it } from "vitest";
import { columns } from "./waveform";

describe("columns", () => {
  it("keeps each column's lowest and highest point, the channels mixed", () => {
    const left = new Float32Array([0, 1, -1, 0.5, 0, 0, 0, 0]);
    const right = new Float32Array([0, 1, 1, 0.5, 0, 0, 0, -0.5]);
    const peaks = columns([left, right], 2, 2);
    expect([...peaks.max]).toEqual([1, 0]);
    expect([...peaks.min]).toEqual([0, -0.25]);
    expect(peaks.duration).toBe(2);
  });

  it("draws a short file across every column", () => {
    const peaks = columns([new Float32Array([0.5, -0.5])], 0.1, 4);
    expect([...peaks.max]).toEqual([0.5, 0.5, -0.5, -0.5]);
  });
});
