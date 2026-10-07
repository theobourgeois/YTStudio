import type { EngineProLState } from "@shared/music/engine";
import { setEffect } from "@shared/music/mixer";
import { findProL } from "@shared/music/pro-l";
import { PRO_L_PLUGIN, turnFromAttack } from "@shared/music/pro-l-presets";
import { MASTER_TRACK_ID, createMusicProject } from "@shared/music/project";
import type { MusicProject } from "@shared/music/types";
import { describe, expect, it } from "vitest";
import { addAutomationEdit, resolveControl } from "../automation/tool-edits";
import { describeProL, findProLRef, updateProLTool } from "./tool-edits";

/** A song with a YT-L in the master's first slot. */
const song = (): MusicProject => setEffect(createMusicProject("Loud", 140), MASTER_TRACK_ID, 0, PRO_L_PLUGIN, "fx_lim");
const proL = (s: MusicProject) => findProL(s, "fx_lim")!.proL;

const LIVE: EngineProLState = {
  latency: 1440,
  reduction: 3.2,
  input: [1.4, 1.3],
  output: [0.98, 0.97],
  truePeak: [1.01, 0.99],
  rms: [-9.5, -9.8],
  loudness: { momentary: -8.4, shortTerm: -8.9, integrated: -9.2, range: 4.1, maxMomentary: -7.1, maxShortTerm: -8.1, maxTruePeak: 0.3, seconds: 42, paused: false },
  clipped: 0.01,
  density: 0.12,
  maxClip: 1.5,
  maxReduction: 5.8,
  step: 0.01,
  columns: [],
};

describe("the assistant's YT-L", () => {
  it("finds it by id, by track, or as the only one, and says which there are when it can't", () => {
    expect(findProLRef(song(), {}).effect.id).toBe("fx_lim");
    expect(findProLRef(song(), { track: "master" }).effect.id).toBe("fx_lim");
    expect(() => findProLRef(song(), { effect: "fx_nope" })).toThrow(/fx_lim \(.*slot 1\)/);
    expect(() => findProLRef(createMusicProject("Empty", 120), {})).toThrow(/add_mixer_effect/);
  });

  it("describes its style in numbers, its knobs, and its meters while it plays", () => {
    const text = describeProL(song(), {});
    expect(text).toMatch(/Style modern/);
    expect(text).toMatch(/output -0\.1 dB \(sample peak\)/);
    expect(text).toMatch(/Clip stage: off/);
    expect(text).toMatch(/nothing measured yet/);
    const live = describeProL(song(), {}, LIVE);
    expect(live).toMatch(/Integrated -9\.2 LUFS/);
    expect(live).toMatch(/PLR 9\.5 dB/);
    expect(live).toMatch(/12% within 0\.5 dB of the ceiling \(dense/);
  });

  it("sets a preset, then knobs in their units, the clip stage, and A/B", () => {
    let s = updateProLTool(song(), { preset: "master: trap loud" }).song;
    expect(proL(s)).toMatchObject({ preset: "Master: Trap Loud", style: "punchy", clip: true, clipShape: "fl" });
    s = updateProLTool(s, { gain: 8, attack: 150, release: 300, hold: "auto", clipRange: 2, truePeak: true, output: -1, target: -9 }).song;
    expect(proL(s)).toMatchObject({ gain: 8, attack: 0.15, release: 0.3, hold: null, clipRange: 2, truePeak: true, output: -1, preset: null, meter: { target: -9 } });
    s = updateProLTool(s, { hold: 12 }).song;
    expect(proL(s).hold).toBeCloseTo(0.012, 9);
    s = updateProLTool(s, { ab: "switch" }).song;
    expect(proL(s).slot).toBe("b");
  });

  it("keeps the delivery settings when Lock Output is set with a preset", () => {
    const s = updateProLTool(updateProLTool(song(), { output: -2, truePeak: true }).song, { lockOutput: true, preset: "Master: Rage / Hyperpop" }).song;
    expect(proL(s)).toMatchObject({ style: "aggressive", output: -2, truePeak: true, lockOutput: true });
  });

  it("says what's wrong", () => {
    expect(() => updateProLTool(song(), { preset: "Loudest" })).toThrow(/Master: Streaming −14/);
    expect(() => updateProLTool(song(), { gain: 50 })).toThrow(/"gain" must be a number from 0 to 30/);
    expect(() => updateProLTool(song(), { style: "spit", lookahead: 3 })).toThrow(/"lookahead" must be a number from 0 to 1/);
    expect(() => updateProLTool(song(), {})).toThrow(/Nothing to change/);
  });

  it("automates its controls in their units (times in ms)", () => {
    const s = song();
    expect(resolveControl(s, { control: "limiter gain", track: "master", slot: 1 })).toEqual({ kind: "proL", effect: "fx_lim", control: "gain" });
    const input = { control: "limiter attack", track: "master", slot: 1, points: [{ at: 0, value: 10 }, { at: 1, value: 1000 }] };
    const target = resolveControl(s, input);
    if (!("kind" in target)) throw new Error("not a song control");
    const clip = addAutomationEdit(s, input, target).song.automations.at(-1)!;
    // Along Attack's own taper (10 s × turn⁴).
    expect(clip.points[0].value).toBeCloseTo(turnFromAttack(0.01), 3);
    expect(clip.points.at(-1)!.value).toBeCloseTo(turnFromAttack(1), 3);
    expect(() => resolveControl(setEffect(s, MASTER_TRACK_ID, 0, null), { control: "limiter gain", track: "master", slot: 1 })).toThrow();
  });
});
