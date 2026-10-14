import { describe, expect, it } from "vitest";
import { liveLook, seededRandom } from "@shared/live-looks";
import type { Mood, MoodEvent, Section } from "@shared/signals/mood";
import { type EffectsChange, EffectsEngine, type EffectsMode, MOST_FEEDBACK, composeSet, mutateSet } from "./effects-engine";

const BEAT = 0.5;
const BAR = 4 * BEAT;

function mood(intensity: number, section: Section = "steady", events: MoodEvent[] = []): Mood {
  return {
    intensity,
    presence: { low: 0, mid: 0, high: 0 },
    section,
    sectionSince: 0,
    character: "hype",
    sure: 0.8,
    scores: { chill: 0, groove: 0, hype: 0, heavy: 0 },
    events,
    heard: { loudness: -10, hits: 4, kicks: 2, sub: 0.3, brightness: 3000 },
  };
}

/** Run the engine over `seconds` at a steady mood, every 20 ms: its changes. */
function run(mode: EffectsMode, at: (t: number) => { mood: Mood; drop?: number }, seconds: number, look = "cyberspace") {
  const engine = new EffectsEngine(seededRandom("fx"));
  const changes: EffectsChange[] = [];
  for (let t = 0; t < seconds; t += 0.02) {
    const nextBeat = Math.ceil((t + 1e-6) / BEAT) * BEAT;
    const nextBar = Math.ceil((t + 1e-6) / BAR) * BAR;
    const { mood: m, drop } = at(t);
    const change = engine.step({ time: t, mood: m, beat: BEAT, nextBeat, nextBar, drop, look: liveLook(look)! }, mode);
    if (change) changes.push(change);
  }
  return changes;
}

describe("composeSet", () => {
  it("never feeds back past its most, nor at all on a chaos look (it has a world of its own)", () => {
    const r = seededRandom("sets");
    for (let i = 0; i < 300; i++) {
      for (const tier of ["calm", "groove", "intense"] as const) {
        expect(composeSet(tier, liveLook("nebula")!, r).effects.fx.feedback).toBeLessThanOrEqual(MOST_FEEDBACK);
        expect(composeSet(tier, liveLook("chaos-stargate")!, r).effects.fx.feedback).toBe(0);
      }
    }
  });

  it("is gentle when calm (no copies, pixels or lens), harder when intense", () => {
    const r = seededRandom("tiers");
    for (let i = 0; i < 200; i++) {
      const calm = composeSet("calm", liveLook("nebula")!, r).effects;
      expect(calm.frame.repeat).toBe(1);
      expect(calm.fx.pixelate).toBe(0);
      expect(calm.fx.lens).toBe(0);
    }
    const intense = Array.from({ length: 200 }, () => composeSet("intense", liveLook("nebula")!, r).effects);
    expect(intense.some((e) => e.frame.repeat >= 2)).toBe(true);
    expect(intense.some((e) => e.fx.kaleido >= 0.5 || e.fx.swirl >= 0.5)).toBe(true);
  });

  it("mutates a set a little: its frame only", () => {
    const r = seededRandom("mutate");
    const set = composeSet("groove", liveLook("nebula")!, r).effects;
    for (let i = 0; i < 20; i++) {
      const m = mutateSet(set, r);
      expect(m.effects.fx).toEqual(set.fx);
      expect(m.effects.frame).not.toEqual(set.frame);
    }
  });
});

describe("EffectsEngine", () => {
  it("does nothing by hand", () => {
    expect(run("hand", () => ({ mood: mood(0.9) }), 20)).toEqual([]);
  });

  it("follows the music: intense a new set every 2 bars mutated between, calm every 4 bars eased over one, on downbeats", () => {
    const intense = run("music", () => ({ mood: mood(0.9) }), 20);
    expect(intense.length).toBeGreaterThanOrEqual(8);
    expect(intense.length).toBeLessThanOrEqual(11);
    for (const c of intense) expect((c.at / BAR) % 1).toBeCloseTo(0);
    const sets = intense.filter((c) => c.why.startsWith("2 bars"));
    expect(sets.length).toBeGreaterThanOrEqual(4);
    expect(intense.filter((c) => c.why.startsWith("a bar between")).length).toBeGreaterThanOrEqual(3);
    const calm = run("music", () => ({ mood: mood(0.2) }), 20);
    expect(calm.length).toBeGreaterThanOrEqual(2);
    expect(calm.length).toBeLessThanOrEqual(4);
    for (const c of calm) expect(c.seconds).toBeCloseTo(BAR);
  });

  it("every beat: a new set on each downbeat, a mutation of it on each beat between", () => {
    const changes = run("beat", () => ({ mood: mood(0.8) }), 8);
    expect(changes.length).toBeGreaterThanOrEqual(14);
    for (const c of changes) {
      expect((c.at / BEAT) % 1).toBeCloseTo(0);
      expect(c.often).toBe(true);
      const downbeat = Math.abs((c.at / BAR) % 1) < 1e-6 || Math.abs((c.at / BAR) % 1 - 1) < 1e-6;
      expect(c.why.startsWith(downbeat ? "a bar" : "a beat"), `${c.at}: ${c.why}`).toBe(true);
    }
    // Never the same mutation two beats running (from the same set it'd show no change).
    const beats = changes.filter((c) => c.why.startsWith("a beat"));
    for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i].at - beats[i - 1].at - BEAT) < 1e-6) expect(beats[i].why).not.toBe(beats[i - 1].why);
    // Within a bar, only the frame changes (the bar's set stays).
    const bar = changes.filter((c) => c.at >= BAR && c.at < 2 * BAR);
    for (const c of bar.slice(1)) expect(c.effects.fx).toEqual(bar[0].effects.fx);
  });

  it("counts bars in beats before the music's downbeats are known", () => {
    const engine = new EffectsEngine(seededRandom("count"));
    const whys: string[] = [];
    for (let t = 0; t < 4; t += 0.02) {
      const nextBeat = Math.ceil((t + 1e-6) / BEAT) * BEAT;
      const c = engine.step({ time: t, mood: mood(0.8), beat: BEAT, nextBeat, nextBar: null, look: liveLook("cyberspace")! }, "beat");
      if (c) whys.push(c.why);
    }
    expect(whys.filter((w) => w.startsWith("a bar")).length).toBe(2);
    expect(whys.filter((w) => w.startsWith("a beat")).length).toBeGreaterThanOrEqual(5);
  });

  it("never zooms out a sparse look (a thing in black), nor copies it past 2×2", () => {
    const r = seededRandom("sparse");
    for (const look of ["halo", "chaos-liquid"]) {
      for (let i = 0; i < 200; i++) {
        for (const tier of ["calm", "groove", "intense"] as const) {
          const set = composeSet(tier, liveLook(look)!, r).effects;
          expect(set.frame.zoom).toBeGreaterThanOrEqual(1);
          expect(set.frame.repeat).toBeLessThanOrEqual(2);
          const m = mutateSet(set, r, liveLook(look)!).effects;
          expect(m.frame.zoom).toBeGreaterThanOrEqual(1);
          expect(m.frame.repeat).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("is clean on a drop's cut, and tightens bar by bar through a build-up", () => {
    const drop = run("music", (t) => ({ mood: mood(0.9), drop: t >= 10.02 ? 10 : undefined }), 14);
    const onDrop = drop.find((c) => c.why.startsWith("the drop"))!;
    expect(onDrop.at).toBe(10);
    expect(onDrop.effects.fx.feedback).toBe(0);
    expect(onDrop.effects.frame.repeat).toBe(1);
    const build = run("music", () => ({ mood: mood(0.6, "build") }), 10).filter((c) => c.why.startsWith("the build-up"));
    expect(build.length).toBeGreaterThanOrEqual(4);
    expect(build.at(-1)!.effects.fx.kaleido).toBeGreaterThan(build[0].effects.fx.kaleido);
  });

  it("washes back to gentle on a breakdown", () => {
    const changes = run("music", (t) => ({ mood: mood(t < 8 ? 0.9 : 0.3, t < 8 ? "drop" : "breakdown", t >= 8 ? [{ kind: "breakdown", time: 8 }] : []) }), 12);
    const breakdown = changes.find((c) => c.why.startsWith("a breakdown"))!;
    expect(breakdown).toBeDefined();
    expect(breakdown.effects.frame.repeat).toBe(1);
    expect(breakdown.seconds).toBeCloseTo(BAR);
  });
});
