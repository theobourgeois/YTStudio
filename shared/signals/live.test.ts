import { describe, expect, it } from "vitest";
import { SIGNAL_RATE } from "./format.ts";
import { LiveSignals } from "./live.ts";
import { scalarAt } from "./sample.ts";

const RATE = 48_000;

/** Seeded noise, so every run hears the same. */
function noise(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

/**
 * A drum loop at `bpm` from `from` seconds: a kick on every beat (a sine falling from 150 to 50 Hz), a snare on 2
 * and 4 (noise), hats on the eighths (noise above 6 kHz or so), quieter before `loudFrom` (only hats and a hush).
 */
function drums(seconds: number, bpm: number, { from = 0, loudFrom = 0, kicksUntil = Infinity } = {}): Float32Array {
  const beat = 60 / bpm;
  const random = noise(3);
  const hatNoise = noise(9);
  let previous = 0;
  const out = new Float32Array(Math.round(seconds * RATE) * 2);
  for (let i = 0; i < out.length / 2; i++) {
    const t = i / RATE;
    let v = 0;
    const n = hatNoise();
    const high = n - previous;
    previous = n;
    if (t >= from) {
      const sinceBeat = (t - from) % beat;
      const beatIndex = Math.floor((t - from) / beat);
      const loud = t >= loudFrom;
      if (loud && t < kicksUntil) {
        const phase = 2 * Math.PI * (50 * sinceBeat + (100 / 30) * (1 - Math.exp(-30 * sinceBeat)));
        v += 0.8 * Math.sin(phase) * Math.exp(-sinceBeat / 0.06);
        if (beatIndex % 2 === 1) v += 0.35 * random() * Math.exp(-sinceBeat / 0.05);
      }
      const sinceEighth = (t - from) % (beat / 2);
      if (sinceEighth < 0.03) v += (loud ? 0.25 : 0.12) * high * Math.exp(-sinceEighth / 0.01);
    }
    out[i * 2] = v;
    out[i * 2 + 1] = v;
  }
  return out;
}

/** Heard as a tab hears it: a chunk at a time. */
function listen(samples: Float32Array, chunk = 1024): LiveSignals {
  const live = new LiveSignals(RATE);
  for (let i = 0; i < samples.length; i += chunk * 2) live.push(samples.subarray(i, Math.min(samples.length, i + chunk * 2)));
  return live;
}

const nearest = (times: readonly number[], t: number) => times.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), Infinity);

describe("LiveSignals", () => {
  it("measures as it hears, readable as a file's signals", () => {
    const live = listen(drums(4, 120));
    const data = live.data();
    // Each frame needs the next 21 ms of sound before it's measured.
    expect(data.header.frames).toBeGreaterThan(4 * SIGNAL_RATE - 10);
    expect(live.seconds).toBeCloseTo((data.header.frames - 1) / SIGNAL_RATE);
    expect(data.scalars.length).toBe(data.header.frames * data.header.scalars.length);
    expect(scalarAt(data, "bass", 2.0)).toBeGreaterThan(-40);
    expect(data.header.waveSamples).toBeGreaterThan(3.9 * data.header.waveRate);
  });

  it("keeps the last twelve seconds of the sound itself, read around a moment (silence for what isn't kept)", () => {
    const live = new LiveSignals(48_000);
    // Fourteen seconds: each sample's left is its frame's number, its right the negative.
    const n = 14 * 48_000;
    const samples = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      samples[i * 2] = i;
      samples[i * 2 + 1] = -i;
    }
    for (let i = 0; i < samples.length; i += 9600) live.push(samples.subarray(i, i + 9600));
    const left = new Float32Array(4);
    const right = new Float32Array(4);
    live.soundAt(13.5, left, right);
    expect([...left]).toEqual([647_998, 647_999, 648_000, 648_001]);
    expect([...right]).toEqual([-647_998, -647_999, -648_000, -648_001]);
    // Over twelve seconds ago is gone; what hasn't come yet is silence.
    live.soundAt(1, left, right);
    expect([...left]).toEqual([0, 0, 0, 0]);
    live.soundAt(14, left, right);
    expect([...left]).toEqual([671_998, 671_999, 0, 0]);
    // The newest, mono (left and right averaged: here 0), for the vibe: when it ends, too.
    const mono = new Float32Array(3);
    expect(live.lastSound(mono)).toBe(14);
    expect([...mono]).toEqual([0, 0, 0]);
  });

  it("finds each kick as it happens", () => {
    const bpm = 120;
    const live = listen(drums(8, bpm));
    const kicks = Array.from({ length: 16 }, (_, k) => (k * 60) / bpm);
    const hits = live.data().header.hits.onsetLow.map(([t]) => t);
    // After the first two seconds (what counts as loud is still being learned), every kick is a hit, on time.
    for (const kick of kicks.filter((k) => k >= 2 && k < 7.9)) expect(Math.abs(nearest(hits, kick) - kick)).toBeLessThan(0.02);
    for (const hit of hits.filter((t) => t >= 2 && t <= live.seconds)) expect(Math.abs(nearest(kicks, hit) - hit)).toBeLessThan(0.02);
  });

  it("measures a moment 11 ms after it (its onset window's half)", () => {
    const live = new LiveSignals(RATE);
    expect(live.delay).toBeCloseTo(512 / RATE, 6);
    live.push(new Float32Array(Math.round(RATE * 1) * 2));
    // The newest frame's moment is the sound pushed, less the delay (to a frame).
    expect(1 - live.seconds - live.delay).toBeGreaterThanOrEqual(0);
    expect(1 - live.seconds - live.delay).toBeLessThan(1 / SIGNAL_RATE);
  });

  it("expects the next kicks on the beat ahead of time, as early as the lead", () => {
    const bpm = 124;
    const from = 0.21;
    const live = listen(drums(12, bpm, { from }));
    live.lead = 0.03;
    const kicks = Array.from({ length: 40 }, (_, k) => from + (k * 60) / bpm);
    const hits = live.data().header.hits.onsetLow.map(([t]) => t);
    const ahead = hits.filter((t) => t > live.seconds);
    expect(ahead.length).toBeGreaterThanOrEqual(1);
    // Each lands on a kick still to come, 30 ms early (within 10 ms).
    for (const t of ahead) expect(Math.abs(nearest(kicks, t + 0.03) - (t + 0.03))).toBeLessThan(0.01);
    // The beat moves as early: the grid as heard is `beats`.
    const shown = live.data().header.rhythm!.beats;
    expect(shown.at(-1)! + 0.03).toBeCloseTo(live.beats.at(-1)!, 3);
  });

  it("expects snares where they've been: on 2 and 4, not on every beat", () => {
    // A high blip on every beat keeps the beat (nothing in the mids); a snare on 2 and 4.
    const random = noise(5);
    const samples = new Float32Array(14 * RATE * 2);
    for (let i = 0; i < samples.length / 2; i++) {
      const t = i / RATE;
      const since = t % 0.5;
      let v = 0.3 * Math.sin(2 * Math.PI * 9000 * since) * Math.min(1, since / 0.002) * Math.exp(-since / 0.015);
      if (Math.floor(t / 0.5) % 2 === 1) v += 0.5 * random() * Math.exp(-since / 0.06);
      samples[i * 2] = samples[i * 2 + 1] = v;
    }
    const live = listen(samples);
    const snares = Array.from({ length: 16 }, (_, k) => 0.5 + k);
    const ahead = live.data().header.hits.onsetMid.map(([t]) => t).filter((t) => t > live.seconds);
    expect(ahead.length).toBeGreaterThanOrEqual(1);
    for (const t of ahead) expect(Math.abs(nearest(snares, t) - t)).toBeLessThan(0.015);
  });

  it("keeps a beat through a syncopated (3-3-2) pattern rather than flipping between its tempos", () => {
    // Trap at 160 BPM: kicks on eighths 0, 3 and 6 of each bar, a snare on 3 (eighth 4), hats on every eighth.
    const eighth = 60 / 160 / 2;
    const random = noise(5);
    const hats = noise(13);
    let previous = 0;
    const samples = new Float32Array(40 * RATE * 2);
    for (let i = 0; i < samples.length / 2; i++) {
      const t = i / RATE;
      const index = Math.floor(t / eighth);
      const since = t - index * eighth;
      const n = hats();
      const high = n - previous;
      previous = n;
      let v = since < 0.03 ? 0.15 * high * Math.exp(-since / 0.01) : 0;
      if ([0, 3, 6].includes(index % 8)) v += 0.8 * Math.sin(2 * Math.PI * (50 * since + (100 / 30) * (1 - Math.exp(-30 * since)))) * Math.exp(-since / 0.08);
      if (index % 8 === 4) v += 0.4 * random() * Math.exp(-since / 0.06);
      samples[i * 2] = samples[i * 2 + 1] = v;
    }
    const live = new LiveSignals(RATE);
    const tempos: number[] = [];
    for (let i = 0; i < samples.length; i += 2048) {
      live.push(samples.subarray(i, i + 2048));
      if (live.seconds > 8 && live.bpm && live.bpm !== tempos.at(-1)) tempos.push(live.bpm);
    }
    // Nudged a little as it settles, but never to another tempo: within 2% of the first.
    expect(tempos.length).toBeGreaterThan(0);
    for (const t of tempos) expect(Math.abs(t / tempos[0] - 1)).toBeLessThan(0.02);
  });

  it("stops expecting kicks when they stop", () => {
    const live = listen(drums(13, 124, { kicksUntil: 9 }));
    const hits = live.data().header.hits.onsetLow.map(([t]) => t);
    expect(hits.filter((t) => t > 9.7)).toEqual([]);
  });

  for (const bpm of [96, 120, 128, 140, 174]) {
    it(`follows a beat at ${bpm} BPM, on the kicks`, () => {
      const live = listen(drums(14, bpm, { from: 0.37 }));
      const rhythm = live.data().header.rhythm;
      expect(rhythm).not.toBeNull();
      // 174 is drum & bass: its beat is counted as half that, as people tap it (87), or as 174.
      const expected = bpm > 160 ? [bpm, bpm / 2] : [bpm];
      expect(expected.some((b) => Math.abs(rhythm!.bpm! - b) < 1.5)).toBe(true);
      const period = 60 / rhythm!.bpm!;
      const kicks = Array.from({ length: 40 }, (_, k) => 0.37 + (k * 60) / bpm).filter((t) => t < 14);
      // The last few seconds' beats land on kicks (and are a beat apart).
      const recent = rhythm!.beats.filter((t) => t > 9 && t < 13.5);
      expect(recent.length).toBeGreaterThan(3);
      for (const b of recent) expect(Math.abs(nearest(kicks, b) - b)).toBeLessThan(0.035);
      for (let i = 1; i < recent.length; i++) expect(recent[i] - recent[i - 1]).toBeCloseTo(period, 1);
      // And the next ones are predicted.
      expect(rhythm!.beats.at(-1)!).toBeGreaterThan(live.seconds + 1);
    });
  }

  it("keeps the beats already past where they were", () => {
    const samples = drums(12, 124, { from: 0.2 });
    const live = new LiveSignals(RATE);
    const half = Math.floor(samples.length / 4) * 2;
    live.push(samples.subarray(0, half));
    const before = live.data().header.rhythm!.beats.filter((t) => t < live.seconds - 0.5);
    live.push(samples.subarray(half));
    const after = live.data().header.rhythm!.beats;
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("finds a drop where the drums come in", () => {
    const live = listen(drums(16, 120, { loudFrom: 9 }));
    const drops = live.data().header.rhythm?.drops ?? [];
    expect(drops.length).toBeGreaterThan(0);
    expect(Math.abs(drops[0].time - 9)).toBeLessThan(0.6);
  });

  it("meters the newest moment", () => {
    // Just after a kick.
    const live = listen(drums(3.06, 120));
    const bars = live.meter(12);
    expect(bars).toHaveLength(12);
    expect(bars.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Math.max(...bars)).toBeGreaterThan(0);
  });

  it("has no beat in silence", () => {
    const live = listen(new Float32Array(10 * RATE * 2));
    expect(live.data().header.rhythm).toBeNull();
    expect(live.data().header.hits.onset).toHaveLength(0);
  });
});
