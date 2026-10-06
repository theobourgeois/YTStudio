import { describe, expect, it } from "vitest";
import { integratedLoudness, loudnessChunks, loudnessRange, loudnessSummary, truePeak } from "./loudness.ts";
import { bandBalance, bandFrames, changePoints, describeTone, listen } from "./spectrum.ts";

const RATE = 48000;
const sine = (seconds: number, hz: number, amp: number, phase = 0) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / RATE + phase));
const join = (...parts: Float32Array[]) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
/** Repeatable white noise. */
function noise(seconds: number, amp: number, seed = 1) {
  let s = seed;
  return Float32Array.from({ length: Math.round(seconds * RATE) }, () => { s = (s * 1664525 + 1013904223) >>> 0; return amp * (s / 2 ** 32 * 2 - 1); });
}
/** A simple high-pass (one pole): noise with more high frequencies. */
const brighter = (x: Float32Array) => Float32Array.from(x, (v, i) => i ? v - 0.95 * x[i - 1] : v);

describe("loudness (BS.1770-4, EBU Tech 3341/3342)", () => {
  it("reads EBU's 1 kHz stereo tone at -23 dBFS as -23 LUFS", () => {
    const tone = sine(20, 1000, 10 ** (-23 / 20));
    expect(integratedLoudness(loudnessChunks([tone, tone], RATE))!).toBeCloseTo(-23, 1);
  });
  it("reads a 10 dB step (EBU 3342 case 1) as a loudness range of 10 LU", () => {
    const a = sine(20, 1000, 10 ** (-20 / 20)), b = sine(20, 1000, 10 ** (-30 / 20)), x = join(a, b);
    expect(loudnessRange(loudnessChunks([x, x], RATE))!).toBeCloseTo(10, 0);
  });
  it("gates silence out: a tone with silence after reads as the tone alone", () => {
    const tone = sine(10, 1000, 0.1), x = join(tone, new Float32Array(RATE * 10));
    // Blocks straddling the tone's end pass the gates and count, as BS.1770 has it: within 0.1 LU.
    expect(Math.abs(integratedLoudness(loudnessChunks([x, x], RATE))! - integratedLoudness(loudnessChunks([tone, tone], RATE))!)).toBeLessThan(0.1);
    expect(integratedLoudness(loudnessChunks([new Float32Array(RATE * 2)], RATE))).toBeNull();
  });
  it("finds the peak between samples (a quarter-rate sine sampled at 45°)", () => {
    const x = sine(1, RATE / 4, 0.5, Math.PI / 4);
    expect(20 * Math.log10(Math.max(...x.map(Math.abs)))).toBeCloseTo(-9.03, 1);
    expect(20 * Math.log10(truePeak([x], RATE))).toBeCloseTo(-6.02, 0);
    expect(truePeak([new Float32Array(100)], RATE)).toBe(0);
  });
  it("summarises: integrated, range, true peak, maxima and a short-term series", () => {
    const x = join(sine(6, 1000, 0.1), sine(6, 1000, 0.3));
    const s = loudnessSummary([x, x], RATE);
    expect(s.shortTerm.lufs.length).toBe(10);
    expect(s.maxShortTermLufs!).toBeGreaterThan(s.shortTerm.lufs[0]);
    expect(s.truePeakDbtp!).toBeCloseTo(20 * Math.log10(0.3), 0);
    expect(JSON.stringify(s)).not.toContain("NaN");
  });
});

describe("spectrum and changes", () => {
  it("puts a tone's energy in its band and measures balance against pink noise", () => {
    const frames = bandFrames(sine(2, 100, 0.5), RATE);
    const balance = bandBalance(frames, RATE);
    expect(balance.find(b => b.band === "bass")!.shareDb).toBeGreaterThan(-0.5);
    expect(balance.find(b => b.band === "air")!.shareDb).toBeLessThan(-40);
    // White noise has more energy up high than pink noise has.
    const white = bandBalance(bandFrames(noise(2, 0.3), RATE), RATE);
    expect(white.find(b => b.band === "air")!.relativeToPinkDb).toBeGreaterThan(3);
    expect(white.find(b => b.band === "bass")!.relativeToPinkDb).toBeLessThan(-3);
  });
  it("finds a step at its time, and a ramp as gradual", () => {
    const step = [...new Array(20).fill(-20), ...new Array(20).fill(-29)];
    const found = changePoints(step, 0.5, 3);
    expect(found).toHaveLength(1);
    expect(found[0].at).toBe(10);
    expect(found[0].delta).toBeCloseTo(-9, 5);
    expect(found[0].gradual).toBe(false);
    const ramp = [...new Array(16).fill(-20), ...Array.from({ length: 10 }, (_, i) => -20 - 1.6 * (i + 1)), ...new Array(16).fill(-36)];
    expect(changePoints(ramp, 0.5, 3).every(c => c.gradual)).toBe(true);
    expect(changePoints(new Array(40).fill(-20), 0.5, 3)).toEqual([]);
  });
  it("hears a level drop and a tonal change in noise at their times, and nothing in steady noise", () => {
    const base = noise(20, 0.2), quieter = Float32Array.from(base, (v, i) => i >= 10 * RATE ? v * 10 ** (-9 / 20) : v);
    const level = listen([quieter, quieter], RATE).changes;
    expect(level.filter(c => c.kind === "loudness")).toHaveLength(1);
    expect(level[0].at).toBeCloseTo(10, 0);
    expect(level[0].deltaDb).toBeCloseTo(-9, 0);
    const bright = brighter(noise(20, 0.2, 7)), toned = Float32Array.from(base, (v, i) => i >= 9 * RATE ? 0.5 * (v + bright[i]) : v);
    const tone = listen([toned], RATE).changes.filter(c => c.kind === "tone");
    expect(tone.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(tone[0].at - 9)).toBeLessThanOrEqual(0.5);
    expect(describeTone(tone[0])).toMatch(/(sub|bass|low mids) \(.*\) -/);
    expect(listen([base, base], RATE).changes).toEqual([]);
  });
});
