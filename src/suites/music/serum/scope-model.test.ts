import { describe, expect, it } from "vitest";
import { MOST_GAIN, steady, triggered } from "./scope-model";

describe("the Serum player's oscilloscope", () => {
  it("starts the waveform on a rising zero crossing, so a steady note stands still", () => {
    const sine = (phase: number) => Array.from({ length: 1024 }, (_, i) => Math.sin(i * 0.1 + phase));
    const a = triggered(sine(1), 768);
    const b = triggered(sine(2.5), 768);
    expect(a.length).toBe(768);
    expect(a[0]).toBeGreaterThanOrEqual(0);
    expect(a[0]).toBeLessThan(0.1);
    expect(Math.abs(a[20] - b[20])).toBeLessThan(0.1);
    // Nothing crossing: from the start.
    expect(triggered(new Array(1024).fill(0.5))[0]).toBe(0.5);
  });

  it("takes a new frame quickly and settles flat when nothing sounds", () => {
    let state = steady(new Float32Array(4), 1, [0.5, -0.5, 0.5, -0.5], 1 / 60);
    expect(state.shown[0]).toBeGreaterThan(0.2);
    for (let i = 0; i < 60; i++) state = steady(state.shown, state.gain, [0.5, -0.5, 0.5, -0.5], 1 / 60);
    expect(state.shown[0]).toBeCloseTo(0.5, 3);
    for (let i = 0; i < 120; i++) state = steady(state.shown, state.gain, null, 1 / 60);
    expect(Math.abs(state.shown[0])).toBeLessThan(1e-3);
  });

  it("scales a quiet sound up to fill the screen, never past its most, and back in silence", () => {
    let state: ReturnType<typeof steady> = { shown: new Float32Array(2), gain: 1 };
    for (let i = 0; i < 300; i++) state = steady(state.shown, state.gain, [0.3, -0.3], 1 / 60);
    expect(state.gain).toBeCloseTo(3, 1);
    for (let i = 0; i < 300; i++) state = steady(state.shown, state.gain, [0.01, -0.01], 1 / 60);
    expect(state.gain).toBeCloseTo(MOST_GAIN, 1);
    for (let i = 0; i < 300; i++) state = steady(state.shown, state.gain, [1, -1], 1 / 60);
    expect(state.gain).toBeCloseTo(1, 2);
    for (let i = 0; i < 300; i++) state = steady(state.shown, state.gain, null, 1 / 60);
    expect(state.gain).toBeCloseTo(1, 2);
  });
});
