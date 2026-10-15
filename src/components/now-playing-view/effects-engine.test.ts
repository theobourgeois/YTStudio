import { describe, expect, it } from "vitest";
import { liveLook, seededRandom } from "@shared/live-looks";
import type { Mood, MoodEvent, Section } from "@shared/signals/mood";
import { type EffectsChange, EffectsEngine, type EffectsMode, MOST_FEEDBACK, composeSet, mutateSet } from "./effects-engine";

const BEAT = 0.5;
const BAR = 4 * BEAT;

function mood(intensity: number, section: Section = "steady", events: MoodEvent[] = [], slow = 0): Mood {
  return {
    intensity,
    presence: { low: 0, mid: 0, high: 0 },
    section,
    sectionSince: 0,
    character: "hype",
    sure: 0.8,
    scores: { chill: 0, groove: 0, hype: 0, heavy: 0 },
    slow,
    vibe: null,
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

  it("always feeds back (but on a chaos look), and never turns, repeats or zooms the picture", () => {
    const r = seededRandom("tiers");
    for (let i = 0; i < 200; i++) {
      for (const tier of ["calm", "groove", "intense"] as const) {
        const set = composeSet(tier, liveLook("nebula")!, r).effects;
        expect(set.fx.feedback, tier).toBeGreaterThan(0);
        expect(set.frame).toMatchObject({ repeat: 1, spin: 0, zoom: 1 });
        expect(set.fx.echoSpin).toBe(0);
        const m = mutateSet(set, r).effects;
        expect(m.frame).toMatchObject({ repeat: 1, spin: 0, zoom: 1 });
      }
    }
    // Calm is gentle: no lens, a little warp at most.
    for (let i = 0; i < 100; i++) {
      const calm = composeSet("calm", liveLook("nebula")!, r).effects;
      expect(calm.fx.lens).toBe(0);
      expect(calm.fx.warp).toBeLessThanOrEqual(0.3);
    }
  });

  it("plays no kaleidoscope over a look of its own world (chaos, MilkDrop), and a gentle one over the rest", () => {
    const random = seededRandom("kaleido");
    const own = [liveLook("chaos-tunnel")!, liveLook("md-neon-coils")!];
    for (let i = 0; i < 300; i++) {
      for (const tier of ["calm", "groove", "intense"] as const) {
        for (const look of own) expect(composeSet(tier, look, random).effects.fx.kaleido).toBe(0);
        expect(composeSet(tier, liveLook("cyberspace")!, random).effects.fx.kaleido).toBeLessThanOrEqual(0.45);
      }
      expect(mutateSet(composeSet("intense", own[1], random).effects, random, own[1]).effects.fx.kaleido).toBe(0);
    }
    // Through a build-up too.
    const building = run("music", (t) => ({ mood: mood(0.6, t < 1 ? "steady" : "build") }), 20, "md-neon-coils");
    expect(building.every((c) => c.effects.fx.kaleido === 0)).toBe(true);
  });

  it("mutates a set a little: one thing, never the one just played", () => {
    const r = seededRandom("mutate");
    const set = composeSet("groove", liveLook("nebula")!, r).effects;
    let last = "";
    for (let i = 0; i < 20; i++) {
      const m = mutateSet(set, r, null, last);
      expect(m.name).not.toBe(last);
      expect(m.effects).not.toEqual(set);
      last = m.name;
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
    // Within a bar, each beat varies the bar's own set (one thing changed from it, not piled up).
    const bar = changes.filter((c) => c.at >= BAR && c.at < 2 * BAR);
    for (const c of bar.slice(1)) {
      const changed = (Object.keys(c.effects.fx) as (keyof typeof c.effects.fx)[]).filter((k) => c.effects.fx[k] !== bar[0].effects.fx[k]).length + (c.effects.frame.mirror !== bar[0].effects.frame.mirror ? 1 : 0);
      expect(changed).toBeLessThanOrEqual(1);
    }
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

  it("is clean on a drop's cut, and tightens bar by bar through a build-up", () => {
    const drop = run("music", (t) => ({ mood: mood(0.9), drop: t >= 10.02 ? 10 : undefined }), 14);
    const onDrop = drop.find((c) => c.why.startsWith("the drop"))!;
    expect(onDrop.at).toBe(10);
    expect(onDrop.effects.fx.feedback).toBe(0);
    expect(onDrop.effects.frame.mirror).toBe(false);
    const build = run("music", () => ({ mood: mood(0.6, "build") }), 10).filter((c) => c.why.startsWith("the build-up"));
    expect(build.length).toBeGreaterThanOrEqual(4);
    expect(build.at(-1)!.effects.fx.kaleido).toBeGreaterThan(build[0].effects.fx.kaleido);
  });

  it("washes back to gentle on a breakdown", () => {
    const changes = run("music", (t) => ({ mood: mood(t < 8 ? 0.9 : 0.3, t < 8 ? "drop" : "breakdown", t >= 8 ? [{ kind: "breakdown", time: 8 }] : []) }), 12);
    const breakdown = changes.find((c) => c.why.startsWith("a breakdown"))!;
    expect(breakdown).toBeDefined();
    expect(breakdown.effects.fx.lens).toBe(0);
    expect(breakdown.seconds).toBeCloseTo(BAR);
  });

  it("is calm throughout a slow song, however loud: eased over a bar every 4, nothing mutated, its drop not cut", () => {
    const changes = run("music", (t) => ({ mood: mood(0.9, "steady", [], 0.8), drop: t >= 10.02 ? 10 : undefined }), 20);
    expect(changes.length).toBeGreaterThanOrEqual(2);
    for (const c of changes) {
      expect(c.why, c.why).toMatch(/^4 bars, calm/);
      expect(c.seconds).toBeCloseTo(BAR);
    }
    expect(changes.find((c) => c.why.startsWith("the drop"))).toBeUndefined();
  });
});
