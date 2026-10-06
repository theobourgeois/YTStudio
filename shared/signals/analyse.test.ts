import { describe, expect, it } from "vitest";
import { SignalAnalyser } from "./analyse.ts";
import { type SignalData, SIGNAL_RATE, decodeSignals, encodeSignals } from "./format.ts";
import { bandEnergyAt, powerDb, scalarAt, scalarMax } from "./sample.ts";

const RATE = 48_000;

/** Seeded noise, so every run hears the same. */
function noise(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000 * 2 - 1;
  };
}

/** Stereo sound of `seconds`, each channel from `left`/`right` (sample index → value). */
function stereo(seconds: number, left: (i: number) => number, right = left): Float32Array {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = left(i);
    out[i * 2 + 1] = right(i);
  }
  return out;
}

function analyse(samples: Float32Array, chunk = 4096): SignalData {
  const a = new SignalAnalyser(RATE, samples.length / 2 / RATE);
  for (let i = 0; i < samples.length; i += chunk * 2) a.push(samples.subarray(i, Math.min(samples.length, i + chunk * 2)));
  return a.finish();
}

/** A kick: a sine falling from 150 to 50 Hz, dying away in 0.15 s, every `every` seconds from `first`. */
const kicks = (first: number, every: number) => (i: number) => {
  const t = i / RATE;
  if (t < first) return 0;
  const since = (t - first) % every;
  const phase = 2 * Math.PI * (50 * since + (100 / 30) * (1 - Math.exp(-30 * since)));
  return 0.9 * Math.sin(phase) * Math.exp(-since / 0.05);
};

/** A hat: noise above 6 kHz or so (a difference of noise), 30 ms long, every `every` seconds from `first`. */
const hats = (first: number, every: number) => {
  const random = noise(7);
  let previous = 0;
  return (i: number) => {
    const t = i / RATE;
    const n = random();
    const high = n - previous;
    previous = n;
    if (t < first) return 0;
    const since = (t - first) % every;
    return since < 0.03 ? 0.4 * high * Math.exp(-since / 0.01) : 0;
  };
};

describe("SignalAnalyser", () => {
  it("measures a frame every 5 ms, centred on its moment", () => {
    const data = analyse(stereo(2, () => 0));
    expect(data.header.rate).toBe(SIGNAL_RATE);
    expect(data.header.frames).toBe(2 * SIGNAL_RATE + 1);
    expect(data.header.duration).toBe(2);
    expect(scalarAt(data, "level", 1)).toBe(-120);
    expect(data.header.hits.onset).toEqual([]);
  });

  it("reads a full-scale sine at 0 dB, in its band, as bright as its pitch", () => {
    const data = analyse(stereo(1, (i) => Math.sin((2 * Math.PI * 1000 * i) / RATE)));
    expect(scalarAt(data, "level", 0.5)).toBeCloseTo(0, 1);
    expect(scalarAt(data, "peak", 0.5)).toBeCloseTo(3.01, 1);
    expect(scalarAt(data, "mid", 0.5)).toBeCloseTo(0, 0);
    expect(scalarAt(data, "bass", 0.5)).toBeLessThan(-60);
    expect(scalarAt(data, "air", 0.5)).toBeLessThan(-60);
    expect(scalarAt(data, "brightness", 0.5)).toBeGreaterThan(950);
    expect(scalarAt(data, "brightness", 0.5)).toBeLessThan(1050);
    // The 96 bands carry the same energy.
    expect(powerDb(bandEnergyAt(data, 900, 1100, 0.5))).toBeCloseTo(0, 0);
    expect(powerDb(bandEnergyAt(data, 20, 20000, 0.5))).toBeCloseTo(0, 0);
  });

  it("puts a low sine in the sub and bass, 12 dB down", () => {
    const amp = 10 ** (-12 / 20);
    const data = analyse(stereo(1, (i) => amp * Math.sin((2 * Math.PI * 45 * i) / RATE)));
    // A bin is 23 Hz wide here: some of the sine's energy leaks over the band's edge, into the bass.
    expect(scalarAt(data, "sub", 0.5)).toBeGreaterThan(-13.5);
    expect(powerDb(bandEnergyAt(data, 20, 250, 0.5))).toBeCloseTo(-12, 0);
    expect(scalarAt(data, "mid", 0.5)).toBeLessThan(-60);
  });

  it("measures stereo: width and balance", () => {
    const tone = (i: number) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE);
    const centred = analyse(stereo(0.5, tone));
    expect(scalarAt(centred, "width", 0.25)).toBeCloseTo(0, 3);
    expect(scalarAt(centred, "balance", 0.25)).toBeCloseTo(0, 3);
    const inverted = analyse(stereo(0.5, tone, (i) => -tone(i)));
    expect(scalarAt(inverted, "width", 0.25)).toBeCloseTo(1, 3);
    const left = analyse(stereo(0.5, tone, () => 0));
    expect(scalarAt(left, "balance", 0.25)).toBeCloseTo(-1, 3);
    expect(scalarAt(left, "width", 0.25)).toBeCloseTo(0.5, 3);
  });

  it("finds kicks in the low onsets, on their attack (within 3.5 ms)", () => {
    const data = analyse(stereo(4, kicks(0.25, 0.5)));
    const times = data.header.hits.onsetLow.map(([t]) => t);
    const expected = [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75];
    expect(times).toHaveLength(expected.length);
    times.forEach((t, i) => expect(Math.abs(t - expected[i])).toBeLessThanOrEqual(0.0035));
    expect(data.header.hits.onsetHigh.length).toBeLessThan(2);
    // Read at any video frame, the kick's onset is caught.
    expect(scalarMax(data, "onsetLow", 0.75 - 1 / 60, 0.75 + 1 / 120)).toBeGreaterThan(0.5 * (data.header.reference.onsetLow ?? 1));
  });

  it("finds hats in the high onsets, not the low", () => {
    const data = analyse(stereo(3, hats(0.1, 0.25)));
    const times = data.header.hits.onsetHigh.map(([t]) => t);
    expect(times.length).toBe(12);
    times.forEach((t, i) => expect(Math.abs(t - (0.1 + i * 0.25))).toBeLessThanOrEqual(0.0035));
    expect(data.header.hits.onsetLow).toEqual([]);
  });

  it("gives the same signals whatever the chunks it's fed", () => {
    const sound = stereo(1.3, kicks(0.1, 0.3));
    const whole = analyse(sound, 1 << 20);
    const bits = analyse(sound, 333);
    expect(bits.scalars).toEqual(whole.scalars);
    expect(bits.bands).toEqual(whole.bands);
    expect(bits.header).toEqual(whole.header);
  });

  it("writes and reads a signals file", () => {
    const data = analyse(stereo(1, kicks(0.1, 0.3)));
    const back = decodeSignals(encodeSignals(data).slice().buffer);
    expect(back.header).toEqual(data.header);
    expect(back.scalars).toEqual(data.scalars);
    expect(back.bands).toEqual(data.bands);
    expect(() => decodeSignals(new ArrayBuffer(20))).toThrow("Not a signals file");
  });

  it("analyses three minutes in well under a second of work a minute", () => {
    const random = noise(3);
    const sound = stereo(180, () => random() * 0.3);
    const started = performance.now();
    analyse(sound, 16384);
    const ms = performance.now() - started;
    // About 0.7 s on an M-series Mac; generous for slower machines.
    expect(ms).toBeLessThan(6000);
  });
});
