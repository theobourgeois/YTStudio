import { describe, expect, it } from "vitest";
import { DEFAULT_LFO, cutoffHz, envelopeLevel, lfoValue, normalizeSamplerFields, resonanceQ, samplerFields, samplerOf, tensionCurve } from "./sampler.ts";

describe("the sampler's envelopes", () => {
  const env = { delay: 0.1, attack: 0.2, hold: 0.1, decay: 0.2, sustain: 0.5, release: 0.4 };

  it("go through delay, attack, hold, decay and sustain while the note's held", () => {
    expect(envelopeLevel(env, 0.05, null)).toBe(0);
    expect(envelopeLevel(env, 0.2, null)).toBeCloseTo(0.5);
    expect(envelopeLevel(env, 0.35, null)).toBe(1);
    expect(envelopeLevel(env, 0.5, null)).toBeCloseTo(0.75);
    expect(envelopeLevel(env, 5, null)).toBe(0.5);
  });

  it("release from wherever they were when the note was let go", () => {
    expect(envelopeLevel(env, 1.2, 1)).toBeCloseTo(0.25);
    expect(envelopeLevel(env, 1.5, 1)).toBe(0);
    // Let go during the attack: from half way up.
    expect(envelopeLevel(env, 0.4, 0.2)).toBeCloseTo(0.25);
  });

  it("bend each stage by its tension", () => {
    expect(tensionCurve(0.5, 0)).toBe(0.5);
    expect(tensionCurve(0.5, 1)).toBeGreaterThan(0.5);
    expect(envelopeLevel({ ...env, attackTension: 1 }, 0.2, null)).toBeGreaterThan(0.5);
  });
});

describe("the sampler's LFOs", () => {
  const lfo = { ...DEFAULT_LFO, enabled: true, speed: 2 };

  it("make their wave once their delay has passed, faded in over their attack", () => {
    expect(lfoValue(lfo, 0.125, 120)).toBeCloseTo(1);
    expect(lfoValue({ ...lfo, shape: "square" }, 0.3, 120)).toBe(-1);
    expect(lfoValue({ ...lfo, shape: "triangle" }, 0.125, 120)).toBeCloseTo(1);
    expect(lfoValue({ ...lfo, shape: "saw" }, 0, 120)).toBe(-1);
    expect(lfoValue({ ...lfo, delay: 1 }, 0.5, 120)).toBe(0);
    expect(lfoValue({ ...lfo, attack: 1 }, 0.125, 120)).toBeCloseTo(0.125);
    expect(lfoValue({ ...lfo, enabled: false }, 0.125, 120)).toBe(0);
  });

  it("follow the tempo when synced: a cycle a beat at 120 BPM is half a second", () => {
    expect(lfoValue({ ...lfo, sync: true, speed: 1 }, 0.125, 120)).toBeCloseTo(1);
  });
});

describe("the sampler's settings on a channel", () => {
  it("are absent while they're their defaults, and only what differs is kept", () => {
    expect(samplerFields({}, {})).toEqual({});
    const fields = samplerFields({}, { swingMix: 0.5, loop: { enabled: true, start: 0.2 }, filter: { type: "lowpass", cutoff: 0.6 }, mods: { pitch: { envelope: { enabled: true, amount: -0.5 } } } });
    expect(fields).toMatchObject({ swingMix: 0.5, loop: { enabled: true, start: 0.2, end: 1 }, filter: { type: "lowpass", cutoff: 0.6, resonance: 0 } });
    expect(fields.mods?.pitch?.envelope).toMatchObject({ enabled: true, amount: -0.5 });
    expect(fields.mods?.pan).toBeUndefined();
    expect(samplerOf(fields).mods.pan.lfo.enabled).toBe(false);
    // Back to the defaults: gone.
    expect(samplerFields(fields, { swingMix: 1, loop: { enabled: false, start: 0 }, filter: { type: "off", cutoff: 1 }, mods: { pitch: { envelope: { enabled: false, amount: 0.5 } } } })).toEqual({});
  });

  it("are checked when read from a saved song", () => {
    const read = normalizeSamplerFields({ swingMix: 9, loop: { enabled: true, start: 0.9, end: 0.1 }, filter: { type: "notch", cutoff: -1 }, mods: { pitch: { lfo: { enabled: true, shape: "wobble", speed: 900 } }, volume: {} } });
    expect(read.swingMix).toBeUndefined();
    expect(read.loop).toMatchObject({ enabled: true, start: 0.9 });
    expect(read.loop!.end).toBeGreaterThan(read.loop!.start);
    expect(read.filter).toEqual({ type: "off", cutoff: 0, resonance: 0 });
    expect(read.mods?.pitch?.lfo).toMatchObject({ enabled: true, shape: "sine", speed: 30 });
  });

  it("put the filter's cutoff in octaves from 20 Hz to 20 kHz, and its resonance as a Q", () => {
    expect(cutoffHz(0)).toBe(20);
    expect(cutoffHz(1)).toBeCloseTo(20_000);
    expect(cutoffHz(0.5)).toBeCloseTo(632.5, 0);
    expect(resonanceQ(0)).toBeCloseTo(0.707, 3);
    expect(resonanceQ(1)).toBeCloseTo(22.6, 1);
  });
});
