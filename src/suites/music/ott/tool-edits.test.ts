import { describe, expect, it } from "vitest";
import { findOtt } from "@shared/music/ott";
import { OTT_PLUGIN } from "@shared/music/ott-presets";
import { setEffect } from "@shared/music/mixer";
import { createMusicProject } from "@shared/music/project";
import { addAutomationEdit, resolveControl } from "../automation/tool-edits";
import { describeOtt, findOttRef, updateOttTool } from "./tool-edits";

const song = () => setEffect(createMusicProject("Squash", 120), "insert_2", 1, OTT_PLUGIN, "fx_ott");
const ott = (s: ReturnType<typeof song>) => findOtt(s, "fx_ott")!.ott;

describe("the assistant's OTT", () => {
  it("finds it by id, by track, or as the song's only one, and lists them when it can't", () => {
    const s = song();
    expect(findOttRef(s, { effect: "fx_ott" }).effect.id).toBe("fx_ott");
    expect(findOttRef(s, { track: 2 }).slot).toBe(1);
    expect(findOttRef(s, {}).effect.id).toBe("fx_ott");
    expect(() => findOttRef(s, { track: 1 })).toThrow(/has no YT-Multiband.*fx_ott/);
    expect(() => findOttRef(createMusicProject("None"), {})).toThrow(/add_mixer_effect with plugin "YT-Multiband"/);
  });

  it("says its knobs, its bands and what they do at a few levels", () => {
    const text = describeOtt(song(), {});
    expect(text).toContain('preset "Default"');
    expect(text).toContain("Depth 1 (100%), time 1 (100%)");
    expect(text).toMatch(/Mid \(88 Hz to 2\.5 kHz\): threshold 1 \(100%\), gain 0 dB, upward on below -46\.6 dB, downward on above -34\.8 dB/);
    expect(text).toContain("Drum smash");
  });

  it("sets its knobs, its bands and presets, and says what's wrong", () => {
    let s = updateOttTool(song(), { depth: 0.4, time: 2, bands: [{ band: "high", gain: 3, downward: false }] }).song;
    expect(ott(s)).toMatchObject({ depth: 0.4, time: 2, preset: null });
    expect(ott(s).bands[2]).toEqual({ threshold: 1, gain: 3, upward: true, downward: false });
    s = updateOttTool(s, { preset: "gentle" }).song;
    expect(ott(s)).toMatchObject({ preset: "Gentle", depth: 0.3 });
    expect(() => updateOttTool(s, { depth: 3 })).toThrow('"depth" must be a number from 0 to 1.');
    expect(() => updateOttTool(s, { bands: [{ band: "sub" }] })).toThrow(/"low", "mid" or "high"/);
    expect(() => updateOttTool(s, { preset: "Nope" })).toThrow(/Drum smash/);
    expect(() => updateOttTool(s, {})).toThrow(/Nothing to change/);
  });

  it("automates its controls in their own units", () => {
    const s = song();
    expect(resolveControl(s, { control: "ott depth", track: 2, slot: 2 })).toEqual({ kind: "ott", effect: "fx_ott", control: "depth" });
    expect(() => resolveControl(s, { control: "ott depth", track: 2, slot: 1 })).toThrow(/no effect in slot 1/);
    const made = addAutomationEdit(s, { bar: 1, length: 2, points: [{ at: 0, value: 0 }, { at: 2, value: 1 }] }, { kind: "ott", effect: "fx_ott", control: "midThreshold" });
    const automation = made.song.automations.find((a) => a.id === made.automationId)!;
    expect(automation.name).toBe("Mid threshold (YT-Multiband (Insert 2))");
    // 0 to 1 of 0..2: the curve's 0 to 0.5.
    expect(automation.points.map((p) => p.value)).toEqual([0, 0.5]);
  });
});
