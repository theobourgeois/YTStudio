import { setEffect } from "@shared/music/mixer";
import { findProC } from "@shared/music/pro-c";
import { PRO_C_PLUGIN, ratioOf } from "@shared/music/pro-c-presets";
import { AUTO_TUNE_PLUGIN } from "@shared/music/auto-tune-presets";
import { createMusicProject } from "@shared/music/project";
import type { MusicProject } from "@shared/music/types";
import { describe, expect, it } from "vitest";
import { addAutomationEdit, resolveControl } from "../automation/tool-edits";
import { addVocalCompressionTool, describeProC, findProCRef, setProCBandsTool, setProCSidechainTool, updateProCTool } from "./tool-edits";

/** A song with a Pro-C in Insert 1's first slot. */
const song = (): MusicProject => setEffect(createMusicProject("Squash", 120), "insert_1", 0, PRO_C_PLUGIN, "fx_c");
const proC = (s: MusicProject, id = "fx_c") => findProC(s, id)!.proC;

describe("the assistant's Pro-C", () => {
  it("finds it by id, by track, or as the only one, and says which there are when it can't", () => {
    expect(findProCRef(song(), {}).effect.id).toBe("fx_c");
    expect(findProCRef(song(), { track: 1 }).effect.id).toBe("fx_c");
    expect(() => findProCRef(song(), { effect: "fx_nope" })).toThrow(/fx_c \(.*slot 1\)/);
    expect(() => findProCRef(createMusicProject("Empty", 120), {})).toThrow(/add_mixer_effect/);
  });

  it("describes its style, knobs, curve and side chain", () => {
    const text = describeProC(song(), {});
    expect(text).toMatch(/Style vocal \(Vocal\)/);
    expect(text).toMatch(/Its curve/);
    expect(text).toMatch(/Side chain: internal/);
    expect(text).toMatch(/lowCut 120 Hz/);
    expect(text).toMatch(/Latency: none/);
  });

  it("sets a style, knobs in their units, and a Vintage unit's switches", () => {
    let s = updateProCTool(song(), { style: "fet", threshold: -24, ratio: 8, attack: 0.3, release: 60, options: { allButtons: true } }).song;
    expect(proC(s)).toMatchObject({ style: "fet", threshold: -24, attack: 0.0003, release: 0.06 });
    expect(ratioOf(proC(s).slope)).toBeCloseTo(8, 6);
    expect(proC(s).options.allButtons).toBe(true);
    expect(describeProC(s, {})).toMatch(/Input 24/);
    s = updateProCTool(s, { ratio: 100, dry: -6, maxLookahead: 5, lookahead: 3 }).song;
    // FET 76 has no ∞: its top button is 20:1.
    expect(ratioOf(proC(s).slope)).toBeCloseTo(20, 6);
    expect(proC(s)).toMatchObject({ dry: -6, maxLookahead: 0.005, lookahead: 0.003 });
    // Lookahead past its maximum makes room for it.
    s = updateProCTool(s, { lookahead: 8 }).song;
    expect(proC(s).maxLookahead).toBeCloseTo(0.008, 9);
    s = updateProCTool(s, { dry: "off", preset: "Vocal – Opto Level" }).song;
    expect(proC(s)).toMatchObject({ style: "opto2a", dry: null });
    expect(() => updateProCTool(s, { ratio: 0.5 })).toThrow(/"ratio" must be/);
    expect(() => updateProCTool(s, { preset: "Loud" })).toThrow(/Vocal – FET Catch/);
    expect(() => updateProCTool(s, {})).toThrow(/Nothing to change/);
  });

  it("switches and copies A/B", () => {
    let s = updateProCTool(song(), { threshold: -30 }).song;
    s = updateProCTool(s, { ab: "switch" }).song;
    s = updateProCTool(s, { threshold: -10 }).song;
    s = updateProCTool(s, { ab: "switch" }).song;
    expect(proC(s)).toMatchObject({ slot: "a", threshold: -30 });
  });

  it("keys it from another track (no send needed), at a tap, and sets Host Sync", () => {
    let s = setProCSidechainTool(song(), { source: 2, level: 6, tap: "postFader" }).song;
    expect(proC(s).sidechain).toMatchObject({ trigger: "external", level: 6 });
    expect(s.mixer.tracks.flatMap((t) => t.effects).find((e) => e?.proC)!.sidechain).toEqual({ track: "insert_2", tap: "postFader" });
    expect(s.mixer.tracks.find((t) => t.id === "insert_2")!.sends).not.toContainEqual({ to: "insert_1", level: 0 });
    expect(() => setProCSidechainTool(s, { source: 1 })).toThrow(/own track/);
    s = setProCSidechainTool(s, { trigger: "sync", note: 8, length: 0.25 }).song;
    expect(proC(s).sidechain).toMatchObject({ trigger: "sync", sync: { note: 8, offset: 1, length: 0.25 } });
  });

  it("adds, changes and removes side chain bands", () => {
    let s = setProCBandsTool(song(), { clear: true, bands: [{ shape: "lowCut", frequency: 100, slope: 24 }, { shape: "bell", frequency: 6000, gain: 6 }] }).song;
    expect(proC(s).sidechain.bands.map((b) => [b.id, b.shape, b.frequency])).toEqual([
      [1, "lowCut", 100],
      [2, "bell", 6000],
    ]);
    s = setProCBandsTool(s, { bands: [{ band: 2, gain: 9 }, { band: 1, remove: true }] }).song;
    expect(proC(s).sidechain.bands.map((b) => [b.id, b.gain])).toEqual([[2, 9]]);
    expect(() => setProCBandsTool(s, { bands: [{ shape: "bell" }] })).toThrow(/frequency/);
  });

  it("sets up a vocal's compression in one step, after its tuning", () => {
    const tuned = setEffect(createMusicProject("Vocal", 120), "insert_1", 0, AUTO_TUNE_PLUGIN, "fx_tune");
    const s = addVocalCompressionTool(tuned, { track: 1 }, ["fx_a", "fx_b"]).song;
    const effects = s.mixer.tracks.find((t) => t.id === "insert_1")!.effects;
    expect(effects[0]?.id).toBe("fx_tune");
    expect(proC(s, "fx_a")).toMatchObject({ style: "fet", preset: "Vocal – FET Catch", threshold: -22 });
    expect(proC(s, "fx_b").style).toBe("opto2a");
    expect(effects.indexOf(effects.find((e) => e?.id === "fx_a")!)).toBe(1);
    const tracking = addVocalCompressionTool(createMusicProject("Vocal", 120), { track: 1, kind: "tracking", amount: "heavy" }, ["fx_t"]).song;
    expect(proC(tracking, "fx_t")).toMatchObject({ style: "optoTube", threshold: -30 });
  });

  it("automates its controls in their units (times in ms, a ratio as a ratio)", () => {
    const s = song();
    expect(resolveControl(s, { control: "pro-c threshold", track: 1, slot: 1 })).toEqual({ kind: "proC", effect: "fx_c", control: "threshold" });
    const input = { control: "pro-c attack", track: 1, slot: 1, points: [{ at: 0, value: 1 }, { at: 1, value: 100 }] };
    const target = resolveControl(s, input);
    if (!("kind" in target)) throw new Error("not a song control");
    const made = addAutomationEdit(s, input, target);
    const clip = made.song.automations.at(-1)!;
    // 1 ms and 100 ms along Attack's log taper (0.005 to 250 ms).
    const fraction = (ms: number) => Math.log(ms / 0.005) / Math.log(250 / 0.005);
    expect(clip.points[0].value).toBeCloseTo(fraction(1), 3);
    expect(clip.points.at(-1)!.value).toBeCloseTo(fraction(100), 3);
  });
});

