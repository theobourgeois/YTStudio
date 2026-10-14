import { describe, expect, it } from "vitest";
import { LiveSignals } from "./live.ts";

const RATE = 48_000;

/** Seeded noise. */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

/** A part of a made-up song: what plays at time `t` (seconds into the part), mono. */
type Part = { seconds: number; play: (t: number) => number };

/** Parts one after another, stereo, as a tab would hear them. */
function song(...parts: Part[]): Float32Array {
  const total = parts.reduce((s, p) => s + p.seconds, 0);
  const out = new Float32Array(Math.round(total * RATE) * 2);
  let at = 0;
  for (const part of parts) {
    const n = Math.round(part.seconds * RATE);
    for (let i = 0; i < n; i++) {
      const v = part.play(i / RATE);
      out[(at + i) * 2] = v;
      out[(at + i) * 2 + 1] = v;
    }
    at += n;
  }
  return out;
}

const kick = (since: number) => Math.sin(2 * Math.PI * (50 * since + (100 / 30) * (1 - Math.exp(-30 * since)))) * Math.exp(-since / 0.09);

/** A soft pad: a slow minor chord, breathing (no drums). */
const pad = (seconds: number, gain = 0.05): Part => ({
  seconds,
  play: (t) => gain * (0.6 + 0.4 * Math.sin(t * 0.7)) * [220, 261.6, 329.6].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 1.003 * t), 0) / 3,
});

/** A club track: a kick on every beat, a clap on 2 and 4, hats on the off-beats (and 16ths if `busy`), a bassline. */
function club(seconds: number, bpm: number, gain: number, { busy = true, kicks = true } = {}): Part {
  const beat = 60 / bpm;
  const clap = noise(3);
  const hat = noise(7);
  let previous = 0;
  return {
    seconds,
    play: (t) => {
      const index = Math.floor(t / beat);
      const since = t - index * beat;
      const n = hat();
      const high = n - previous;
      previous = n;
      let v = 0;
      if (kicks) v += 0.9 * kick(since);
      if (index % 2 === 1) v += 0.45 * clap() * Math.exp(-since / 0.07);
      const sixteenth = beat / 4;
      const s16 = t % sixteenth;
      const step = Math.floor(t / sixteenth) % 4;
      if (step === 2 || (busy && step !== 0)) v += (step === 2 ? 0.35 : 0.18) * high * Math.exp(-s16 / 0.012);
      v += 0.35 * Math.sin(2 * Math.PI * [55, 55, 65.4, 49][Math.floor(index / 4) % 4] * t) * (0.5 + 0.5 * Math.exp(-since / 0.25));
      return gain * v;
    },
  };
}

/** A heavy track: half time at 140 (a kick on 1, a snare on 3), a long loud sub-bass, dark (nothing much on top). */
function heavy(seconds: number, gain: number): Part {
  const beat = 60 / 140;
  const snare = noise(5);
  let low = 0;
  return {
    seconds,
    play: (t) => {
      const bar = t % (beat * 4);
      let v = 0;
      if (bar < beat) v += kick(bar);
      if (bar >= beat * 2 && bar < beat * 3) {
        // A snare, made dark (smoothed noise).
        low += (snare() - low) * 0.25;
        v += 0.7 * low * Math.exp(-(bar - beat * 2) / 0.12);
      }
      v += 0.7 * Math.sin(2 * Math.PI * 41.2 * t) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 2.33 * t));
      return gain * v;
    },
  };
}

/** A build-up: no kick, a snare roll speeding up and a noise riser growing louder and brighter. */
function build(seconds: number, bpm: number, gain: number): Part {
  const beat = 60 / bpm;
  const roll = noise(9);
  const riser = noise(11);
  let previous = 0;
  return {
    seconds,
    play: (t) => {
      const x = t / seconds;
      const per = beat / (1 + Math.floor(x * 4) * 1); // 1, 2, 3, 4 a beat
      const since = t % per;
      const n = riser();
      const high = n - previous * (1 - x);
      previous = n;
      return gain * (0.25 * (0.4 + 0.6 * x) * roll() * Math.exp(-since / 0.04) + 0.25 * x * x * high);
    },
  };
}

/** Listen to a song a chunk at a time, noting the mood every quarter second (a new song at 0). */
function listen(samples: Float32Array) {
  const live = new LiveSignals(RATE);
  live.newSong();
  const timeline: { t: number; intensity: number; section: string; character: string | null }[] = [];
  for (let i = 0; i < samples.length; i += 2048) {
    live.push(samples.subarray(i, i + 2048));
    const m = live.mood;
    if (!timeline.length || live.seconds - timeline.at(-1)!.t >= 0.25) timeline.push({ t: live.seconds, intensity: m.intensity, section: m.section, character: m.character });
  }
  return { live, mood: live.mood, at: (t: number) => timeline.find((p) => p.t >= t) ?? timeline.at(-1)! };
}

describe("LiveMood", () => {
  it("hears a soft pad as chill and calm", () => {
    const { mood } = listen(song(pad(30)));
    expect(mood.character).toBe("chill");
    expect(mood.intensity).toBeLessThan(0.35);
    expect(mood.sure).toBeGreaterThan(0.4);
  });

  it("hears a steady, moderate beat as a groove", () => {
    const { mood } = listen(song(club(30, 112, 0.18, { busy: false })));
    expect(mood.character).toBe("groove");
    expect(mood.intensity).toBeGreaterThan(0.35);
    expect(mood.intensity).toBeLessThan(0.75);
  });

  it("hears a loud, busy club track as hype", () => {
    const { mood } = listen(song(club(30, 128, 0.55)));
    expect(mood.character).toBe("hype");
    expect(mood.intensity).toBeGreaterThan(0.7);
  });

  it("hears a loud, dark, bass-heavy half-time track as heavy", () => {
    const { mood } = listen(song(heavy(30, 0.55)));
    expect(mood.character).toBe("heavy");
    expect(mood.intensity).toBeGreaterThan(0.5);
  });

  it("follows a song's shape: a build-up, the drop on its downbeat, a breakdown", () => {
    const { mood, at } = listen(song(club(12, 126, 0.3, { busy: false }), build(10, 126, 0.5), club(14, 126, 0.55), pad(12, 0.06)));
    const kinds = mood.events.map((e) => e.kind);
    // Building during the build-up, the drop at 22 s (within half a second), broken down after 36 s.
    const built = mood.events.find((e) => e.kind === "build");
    expect(built && built.time > 12 && built.time < 22).toBe(true);
    const drop = mood.events.find((e) => e.kind === "drop");
    expect(drop && Math.abs(drop.time - 22)).toBeLessThan(0.5);
    const broke = mood.events.find((e) => e.kind === "breakdown");
    expect(broke && broke.time > 36 && broke.time < 41).toBe(true);
    expect(kinds.indexOf("build")).toBeLessThan(kinds.indexOf("drop"));
    // Each said once (a section doesn't flicker).
    expect(kinds).toEqual(["build", "drop", "breakdown"]);
    // Intensity: low in the build-up's start, high after the drop, low again in the breakdown.
    expect(at(30).intensity).toBeGreaterThan(at(14).intensity + 0.2);
    expect(at(45).intensity).toBeLessThan(at(30).intensity - 0.3);
  });

  it("finds a new song's character afresh", () => {
    const samples = song(pad(25), club(30, 128, 0.55));
    const live = new LiveSignals(RATE);
    live.newSong();
    let before: string | null = null;
    for (let i = 0; i < samples.length; i += 2048) {
      live.push(samples.subarray(i, i + 2048));
      if (before === null && live.seconds >= 24.5) {
        before = live.mood.character;
        live.newSong();
      }
    }
    expect(before).toBe("chill");
    expect(live.mood.character).toBe("hype");
  });

  it("reads presence: the highs rising in a build-up", () => {
    const { live } = (() => {
      const l = listen(song(pad(10, 0.05), build(8, 126, 0.5)));
      return l;
    })();
    expect(live.mood.presence.high).toBeGreaterThan(0.3);
  });
});
