import { describe, expect, it } from "vitest";
import { SAMPLE_RATE, analyseRhythm, fft, regularise } from "./beats.ts";

/** A drum loop: a kick on every beat (louder on each bar's first), a hi-hat between. */
function drums(bpm: number, seconds: number, opts: { offset?: number; gain?: number; from?: number } = {}): Float32Array {
  const { offset = 0.25, gain = 0.8, from = 0 } = opts;
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const beat = 60 / bpm;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; offset + i * beat < seconds; i++) {
    const at = offset + i * beat;
    if (at < from) continue;
    const loud = i % 4 === 0 ? 1 : 0.55;
    const start = Math.round(at * SAMPLE_RATE);
    // Kick: a falling low sine.
    for (let n = 0; n < 0.15 * SAMPLE_RATE && start + n < out.length; n++) {
      const t = n / SAMPLE_RATE;
      out[start + n] += gain * loud * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18);
    }
    // Hi-hat half a beat later: short noise, high-passed (a difference of differences) like a real one.
    const hat = Math.round((at + beat / 2) * SAMPLE_RATE);
    let [a, b] = [0, 0];
    for (let n = 0; n < 0.03 * SAMPLE_RATE && hat + n < out.length; n++) {
      const x = noise();
      out[hat + n] += gain * 0.12 * (x - 2 * a + b) * Math.exp(-n / 150);
      [a, b] = [x, a];
    }
  }
  return out;
}

/** A bar's drums on repeat: kicks and snares at these beats of the bar, hi-hats on each eighth (or `hats` per bar). */
function pattern(bpm: number, seconds: number, opts: { kicks: number[]; snares: number[]; hats?: number; gain?: number }): Float32Array {
  const { kicks, snares, hats = 8, gain = 1.2 } = opts;
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const beat = 60 / bpm;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const hit = (at: number, length: number, sound: (t: number) => number) => {
    const start = Math.round(at * SAMPLE_RATE);
    for (let n = 0; n < length * SAMPLE_RATE && start + n < out.length; n++) out[start + n] += sound(n / SAMPLE_RATE);
  };
  for (let bar = 0; 0.25 + bar * 4 * beat < seconds; bar++) {
    const t0 = 0.25 + bar * 4 * beat;
    for (const k of kicks) hit(t0 + k * beat, 0.15, (t) => 0.8 * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18));
    for (const k of snares) hit(t0 + k * beat, 0.12, (t) => gain * (0.7 * noise() + 0.3 * Math.sin(2 * Math.PI * 200 * t)) * Math.exp(-t * 25));
    for (let h = 0; h < hats; h++) hit(t0 + (h * 4 * beat) / hats, 0.03, (t) => 0.1 * noise() * Math.exp(-t * 150));
  }
  return out;
}

describe("beats", () => {
  it("does a correct FFT", () => {
    const re = new Float64Array(8).map((_, i) => Math.cos((2 * Math.PI * i) / 8));
    const im = new Float64Array(8);
    fft(re, im);
    expect(Array.from(re, (v) => Math.round(v * 1000) / 1000 + 0)).toEqual([0, 4, 0, 0, 0, 0, 0, 4]);
  });

  it.each([90, 120, 128, 150])("finds the tempo and the beats of a %i BPM loop", (bpm) => {
    const r = analyseRhythm(drums(bpm, 20));
    expect(r.bpm).toBeGreaterThan(bpm - 1.5);
    expect(r.bpm).toBeLessThan(bpm + 1.5);
    expect(r.confidence).toBeGreaterThan(0.3);
    // Every beat lands within 25 ms of a kick.
    const beat = 60 / bpm;
    for (const t of r.beats.filter((t) => t > 1)) {
      const k = Math.round((t - 0.25) / beat);
      expect(Math.abs(t - (0.25 + k * beat))).toBeLessThan(0.025);
    }
    expect(r.beats.length).toBeGreaterThan(20 / beat - 3);
  });

  it.each([170, 174])("finds %i BPM in drum & bass, whose kick 1.5 beats in repeats more plainly than the beat", (bpm) => {
    const r = analyseRhythm(pattern(bpm, 30, { kicks: [0, 2.5], snares: [1, 3] }));
    expect(Math.abs(r.bpm! - bpm)).toBeLessThan(1.5);
  });

  it("finds hip-hop's and trap's tempo, not a syncopated kick's spacing", () => {
    // Half or double the tempo is a matter of feel (the beats are the same ones, or every other one);
    // a kick ¾ of a beat after another used to read as 120 here, and trap's as 80.
    const hiphop = analyseRhythm(pattern(90, 30, { kicks: [0, 1.5, 2.25], snares: [1, 3], gain: 0.5 }));
    expect([90, 180].some((t) => Math.abs(hiphop.bpm! - t) < 1.5)).toBe(true);
    const trap = analyseRhythm(pattern(140, 30, { kicks: [0, 1.75, 2.5], snares: [2], hats: 16 }));
    expect([70, 140].some((t) => Math.abs(trap.bpm! - t) < 1.5)).toBe(true);
  });

  it("puts bars on the loudest kicks", () => {
    const r = analyseRhythm(drums(120, 20));
    // Bars start at 0.25 s and every 2 s after.
    for (const t of r.downbeats.slice(1)) expect(Math.abs(((t - 0.25) / 2) % 1) < 0.02 || Math.abs(((t - 0.25) / 2) % 1) > 0.98).toBe(true);
  });

  it("finds the drop where the beat comes in", () => {
    const pad = new Float32Array(Math.round(20 * SAMPLE_RATE)).map((_, i) => 0.02 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE));
    const loop = drums(120, 20, { from: 8.25 });
    const mix = pad.map((v, i) => v + loop[i]);
    const r = analyseRhythm(mix);
    expect(r.drops[0].time).toBeGreaterThan(7.7);
    expect(r.drops[0].time).toBeLessThan(8.8);
    expect(r.drops[0].rise).toBeGreaterThan(6);
    expect(r.sections.length).toBeGreaterThanOrEqual(2);
    expect(r.sections[0].level).toBeLessThan(r.sections.at(-1)!.level);
  });

  it("has no tempo without a beat", () => {
    const tone = new Float32Array(Math.round(10 * SAMPLE_RATE)).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 330 * i) / SAMPLE_RATE));
    const r = analyseRhythm(tone);
    expect(r.bpm).toBeNull();
    expect(r.beats).toEqual([]);
  });

  it("evens out jittery beats but follows a tempo that drifts", () => {
    const jitter = [0.02, -0.03, 0.01, -0.01, 0.03, -0.02, 0, 0.02, -0.03, 0.01, -0.02, 0.03];
    const steady = regularise(jitter.map((j, i) => i * 0.5 + j));
    for (const [i, t] of steady.entries()) expect(Math.abs(t - i * 0.5)).toBeLessThan(0.015);
    // Speeding up by a tenth over 15 s (from 0.5 s to 0.45 s beats): still on them.
    const faster = Array.from({ length: 30 }, (_, i) => i * 0.5 - (0.05 * i * i) / 58);
    for (const [i, t] of regularise(faster).entries()) expect(Math.abs(t - faster[i])).toBeLessThan(0.02);
  });
});
