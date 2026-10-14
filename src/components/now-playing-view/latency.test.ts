import { describe, expect, it } from "vitest";
import { LiveSignals } from "@shared/signals/live";
import { CAPTURE_SECONDS, latencyOf } from "./live-source";

const RATE = 48_000;
const CHUNK = 128;
const FPS = 60;

/** Seeded noise. */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

/** Kicks at `bpm` from `from`, snares on 2 and 4, hats on the eighths (until `kicksUntil` for the kicks). */
function song(seconds: number, bpm: number, from: number, kicksUntil = Infinity) {
  const beat = 60 / bpm;
  const random = noise(3);
  const hat = noise(9);
  let previous = 0;
  const out = new Float32Array(Math.round(seconds * RATE) * 2);
  for (let i = 0; i < out.length / 2; i++) {
    const t = i / RATE;
    const n = hat();
    const high = n - previous;
    previous = n;
    let v = 0;
    if (t >= from) {
      const since = (t - from) % beat;
      const index = Math.floor((t - from) / beat);
      if (t < kicksUntil) v += 0.8 * Math.sin(2 * Math.PI * (50 * since + (100 / 30) * (1 - Math.exp(-30 * since)))) * Math.exp(-since / 0.06);
      if (index % 2 === 1) v += 0.35 * random() * Math.exp(-since / 0.05);
      const eighth = (t - from) % (beat / 2);
      if (eighth < 0.03) v += 0.25 * high * Math.exp(-eighth / 0.01);
    }
    out[i * 2] = out[i * 2 + 1] = v;
  }
  return { samples: out, kicks: Array.from({ length: Math.floor((Math.min(seconds, kicksUntil) - from) / beat) + 1 }, (_, k) => from + k * beat) };
}

/**
 * The visualizer's pipeline, as it runs: sound handed to the app `CAPTURE_SECONDS` after it's sent, in chunks;
 * frames asked for 60 times a second (at an odd phase), each showing the newest moment measured (the lead set
 * from the latency model), seen a frame later. When is each kick's punch on screen, against when it's heard?
 */
function onScreen(samples: Float32Array, kicks: number[], ears = 0) {
  const live = new LiveSignals(RATE);
  const latency = latencyOf({ analysis: live.delay, chunks: CHUNK / RATE, drawing: 1.5 / FPS, capture: CAPTURE_SECONDS, ears });
  live.lead = latency.lead;
  const seen = new Map<number, number>();
  let pushed = 0;
  const chunks = samples.length / 2 / CHUNK;
  for (let frame = 0; frame / FPS < samples.length / 2 / RATE; frame++) {
    const now = frame / FPS + 0.0037;
    // Every chunk handed over by now.
    while (pushed < chunks && ((pushed + 1) * CHUNK) / RATE + CAPTURE_SECONDS <= now) {
      live.push(samples.subarray(pushed * CHUNK * 2, (pushed + 1) * CHUNK * 2));
      pushed++;
    }
    const time = Math.max(0, live.seconds - latency.wait);
    const hits = live.data().header.hits.onsetLow;
    for (const kick of kicks) {
      if (seen.has(kick)) continue;
      // Its punch has started: a hit for it (heard, or expected early) at or before the time drawn.
      if (hits.some(([t]) => t <= time && Math.abs(t - kick) < 0.08)) seen.set(kick, now + 1 / FPS - (kick + ears));
    }
  }
  return { live, latency, late: (from: number, to = Infinity) => kicks.filter((k) => k >= from && k < to).map((k) => seen.get(k) ?? NaN) };
}

describe("the visualizer's sync", () => {
  /** On screen as they're heard: on average within 5 ms, each within a frame (a 60 Hz screen shows a moment up to 8 ms either side). */
  const onTheBeat = (late: number[]) => {
    expect(late.length).toBeGreaterThan(10);
    expect(Math.abs(late.reduce((a, b) => a + b, 0) / late.length)).toBeLessThan(0.005);
    for (const l of late) expect(Math.abs(l)).toBeLessThan(1 / FPS);
  };

  it("puts kicks on the beat on screen as they're heard", () => {
    const { samples, kicks } = song(14, 126, 0.21);
    const { late, live } = onScreen(samples, kicks);
    expect(live.expectingKicks).toBe(true);
    onTheBeat(late(7, 13));
  });

  it("puts any other kick on screen within 60 ms of it being heard (it was ~115 ms)", () => {
    // Before the beat is followed, every kick is only known once it's heard.
    const { samples, kicks } = song(4, 126, 0.21);
    const late = onScreen(samples, kicks).late(1.5);
    expect(late.length).toBeGreaterThan(3);
    for (const l of late) {
      expect(l).toBeGreaterThan(0);
      expect(l).toBeLessThan(0.06);
    }
  });

  it("waits for headphones that play late, so kicks on the beat still land", () => {
    const { samples, kicks } = song(14, 126, 0.21);
    const { late, latency } = onScreen(samples, kicks, 0.2);
    expect(latency.wait).toBeGreaterThan(0.1);
    onTheBeat(late(7, 13));
  });

  it("models the picture's delay against the ears", () => {
    const speakers = latencyOf({ analysis: 0.0107, chunks: 0.0027, drawing: 0.025, capture: 0.01, ears: 0 });
    expect(speakers.total).toBeCloseTo(0.0471, 3);
    expect(speakers).toMatchObject({ lead: speakers.total, wait: 0 });
    const bluetooth = latencyOf({ analysis: 0.0107, chunks: 0.0027, drawing: 0.025, capture: 0.01, ears: 0.2 });
    expect(bluetooth.lead).toBe(0);
    expect(bluetooth.wait).toBeCloseTo(0.2 - 0.0471, 3);
  });
});
