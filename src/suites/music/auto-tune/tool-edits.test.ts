import { describe, expect, it } from "vitest";
import { controlOf } from "@shared/music/automation";
import { findAutoTune } from "@shared/music/auto-tune";
import { AUTO_TUNE_PLUGIN } from "@shared/music/auto-tune-presets";
import { addChannels, setChannelNotes } from "@shared/music/edits";
import { setEffect } from "@shared/music/mixer";
import { FIRST_PATTERN_ID, createMusicProject } from "@shared/music/project";
import type { MusicProject } from "@shared/music/types";
import { addAutomationEdit, resolveControl } from "../automation/tool-edits";
import { describeAutoTune, findTune, heardText, pitchClassOf, updateAutoTuneTool } from "./tool-edits";

const song = () => setEffect(createMusicProject("Vocal"), "insert_2", 1, AUTO_TUNE_PLUGIN, "fx_tune");
const at = (s: MusicProject) => findAutoTune(s, "fx_tune")!.autoTune;

describe("the assistant's Auto-Tune", () => {
  it("finds it by id, by track, or as the song's only one, and lists them when it can't", () => {
    const s = song();
    expect(findTune(s, { effect: "fx_tune" }).effect.id).toBe("fx_tune");
    expect(findTune(s, { track: 2 }).slot).toBe(1);
    expect(findTune(s, {}).effect.id).toBe("fx_tune");
    expect(() => findTune(s, { track: 1 })).toThrow(/Insert 1.*has no YT-Tune.*fx_tune \(insert 2/i);
    expect(() => findTune(createMusicProject("None"), {})).toThrow(/add_mixer_effect with plugin "YT-Tune"/);
  });

  it("names notes as musicians do", () => {
    expect(pitchClassOf("A")).toBe(9);
    expect(pitchClassOf("f#")).toBe(6);
    expect(pitchClassOf("Bb")).toBe(10);
    expect(pitchClassOf("E♭")).toBe(3);
    expect(pitchClassOf(11)).toBe(11);
    expect(() => pitchClassOf("H")).toThrow(/isn't a note/);
  });

  it("sets a preset, then the key, scale, notes and knobs in Auto-Tune's own numbers", () => {
    const { song: s, text } = updateAutoTuneTool(song(), {
      preset: "natural vocal",
      key: "F#",
      scale: "minor",
      notes: { E: "bypass", "C#": "remove" },
      humanize: 60,
      throat: 120,
      vibrato: { shape: "sine", pitch: 30, amplitude: 10 },
    });
    expect(at(s)).toMatchObject({ key: 6, scale: "minor", retuneSpeed: 30, flexTune: 0.2, humanize: 0.6, throat: 1.2, vibrato: { shape: "sine", pitch: 30, amplitude: 0.1 } });
    expect(at(s).notes[4]).toBe("bypass");
    expect(at(s).notes[1]).toBe("remove");
    expect(text).toContain("Key F# Minor (notes edited)");
    expect(text).toContain("bypassed E");
  });

  it("detects the song's key from its notes", () => {
    let s = addChannels(song(), [{ id: "chan_keys", name: "Keys", sampleId: null }]);
    s = setChannelNotes(s, FIRST_PATTERN_ID, "chan_keys", () =>
      [57, 60, 64, 69, 55, 59, 62, 67, 53, 57, 60, 65, 52, 56, 59, 64, 57, 60, 64, 57].map((pitch, i) => ({ id: i + 1, start: i * 96, length: 96, pitch, velocity: 0.8, pan: 0, muted: false })),
    );
    expect(at(updateAutoTuneTool(s, { detectKey: true }).song)).toMatchObject({ key: 9, scale: "minor" });
    expect(describeAutoTune(s, {})).toContain("The song's notes suggest A Minor");
    expect(() => updateAutoTuneTool(song(), { detectKey: true })).toThrow(/too few pitched notes/);
  });

  it("refuses what isn't allowed, saying what is", () => {
    expect(() => updateAutoTuneTool(song(), { retuneSpeed: 900 })).toThrow(/"retuneSpeed" must be a number from 0 to 400/);
    expect(() => updateAutoTuneTool(song(), { scale: "lydian dominant" })).toThrow(/"scale" must be one of: chromatic, major/);
    expect(() => updateAutoTuneTool(song(), { preset: "Cher" })).toThrow(/The presets: Hard Tune/);
    expect(() => updateAutoTuneTool(song(), { notes: { C: "mute" } })).toThrow(/tune, bypass, remove/);
    expect(() => updateAutoTuneTool(song(), {})).toThrow(/Nothing to change/);
  });

  it("says its settings, presets and what it heard", () => {
    const text = describeAutoTune(song(), {}, [
      { n: 1, sung: 57.3, tuned: 57, target: 57 },
      { n: 2, sung: 57.4, tuned: 57, target: 57 },
      { n: 3, sung: -1, tuned: -1, target: -1 },
      { n: 4, sung: 59.9, tuned: 60, target: 60 },
    ]);
    expect(text).toMatch(/YT-Tune fx_tune, slot 2 of insert 2/i);
    expect(text).toContain("Input type Alto/Tenor (altoTenor). Key C Chromatic");
    expect(text).toContain("Retune speed 0 ms, humanize 0, flex-tune 0");
    expect(text).toContain("Preset: Hard Tune.");
    expect(text).toContain("A3 (+35 cents), C4 (-10 cents)");
    expect(heardText([])).toMatch(/hasn't heard a pitch/);
  });

  it("automates its controls, in its own numbers", () => {
    const s = song();
    const target = resolveControl(s, { control: "humanize", track: 2, slot: 2 });
    expect(target).toEqual({ kind: "autoTune", effect: "fx_tune", control: "humanize" });
    expect(() => resolveControl(s, { control: "key", track: 2, slot: 1 })).toThrow(/has no effect in slot 1/);
    const made = addAutomationEdit(s, { length: 2, points: [{ at: 0, value: 80 }] }, target as never);
    const automation = made.song.automations[0];
    expect(automation.points[0].value).toBeCloseTo(0.8, 6);
    expect(controlOf(made.song, automation.target).format(automation.points[0].value)).toBe("80");
  });
});
