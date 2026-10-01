import { describe, expect, it } from "vitest";
import { TAP_RESET_MS, addTap, tappedTempo } from "./tap-tempo";

const tapAll = (times: number[]) => times.reduce<number[]>((taps, t) => addTap(taps, t), []);

describe("tap tempo", () => {
  it("finds the tempo once there are three taps", () => {
    expect(tappedTempo(tapAll([0, 500]))).toBeNull();
    expect(tappedTempo(tapAll([0, 500, 1000]))).toBe(120);
    // 140 BPM is a beat every 428.57 ms.
    expect(tappedTempo(tapAll([0, 429, 857, 1286, 1714]))).toBe(140);
  });

  it("evens out a hand that's a little early or late", () => {
    const taps = tapAll([0, 520, 990, 1510, 1995, 2500, 3010, 3490]);
    expect(tappedTempo(taps)).toBeGreaterThan(119);
    expect(tappedTempo(taps)).toBeLessThan(121);
  });

  it("starts again after a pause, and keeps only the latest taps", () => {
    const taps = tapAll([0, 500, 1000, 1000 + TAP_RESET_MS + 1]);
    expect(taps).toEqual([1000 + TAP_RESET_MS + 1]);
    const long = tapAll(Array.from({ length: 40 }, (_, i) => i * 400));
    expect(long).toHaveLength(12);
    expect(tappedTempo(long)).toBe(150);
  });

  it("brings a tempo outside a song's range into it", () => {
    // A tap every 1.9 s is 31.6 BPM: in range. Halving taps of a fast song come back doubled.
    expect(tappedTempo([0, 1900, 3800])).toBe(31.6);
    expect(tappedTempo([0, 50, 100])).toBe(600);
  });
});
