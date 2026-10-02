import { describe, expect, it } from "vitest";
import { controlOf } from "@shared/music/automation";
import { addChannels, setMuted } from "@shared/music/edits";
import { setEffect } from "@shared/music/mixer";
import { findPitchWheel } from "@shared/music/pitch-wheel";
import { PITCH_WHEEL_PLUGIN } from "@shared/music/pitch-wheel-presets";
import { createMusicProject } from "@shared/music/project";
import type { MusicProject } from "@shared/music/types";
import { pluginOwners, songControls } from "../automation/controls";
import { addAutomationEdit, resolveControl } from "../automation/tool-edits";
import { describeMixer } from "../mixer/tool-edits";
import { describePitchWheel, findWheel, liveText, updatePitchWheelTool } from "./tool-edits";

const song = () => addChannels(setEffect(createMusicProject("Vocal"), "insert_2", 1, PITCH_WHEEL_PLUGIN, "fx_wheel"), [{ id: "chan_keys", name: "Keys", sampleId: null }]);
const pw = (s: MusicProject) => findPitchWheel(s, "fx_wheel")!.pitchWheel;

describe("the assistant's Pitch Wheel", () => {
  it("finds it by id, by track, or as the song's only one, and lists them when it can't", () => {
    const s = song();
    expect(findWheel(s, { effect: "fx_wheel" }).effect.id).toBe("fx_wheel");
    expect(findWheel(s, { track: 2 }).slot).toBe(1);
    expect(findWheel(s, {}).effect.id).toBe("fx_wheel");
    expect(() => findWheel(s, { track: 1 })).toThrow(/Insert 1.*has no Pitch Wheel.*fx_wheel \(insert 2/i);
    expect(() => findWheel(s, { effect: "fx_nope" })).toThrow(/There's no Pitch Wheel "fx_nope".*fx_wheel/);
    expect(() => findWheel(createMusicProject("None"), {})).toThrow(/add_mixer_effect with plugin "Pitch Wheel"/);
  });

  it("sets a preset, then the wheels, the Timbre tab and where its notes come from", () => {
    const { song: s, text } = updatePitchWheelTool(song(), {
      preset: "octave up",
      timbre: { value: 3, gravity: 0.5 },
      midiMode: "multi",
      notesFrom: "keys",
      origin: "A4",
      resolution: "wide",
    });
    expect(pw(s)).toMatchObject({ pitch: { value: 12 }, timbre: { value: 3, gravity: 0.5 }, timbreOn: true, midiMode: "multi", notesFrom: "chan_keys", origin: 57, resolution: "wide" });
    expect(text).toContain("Pitch wheel: pointer +12 st");
    expect(text).toContain('Notes from "Keys" (chan_keys, heard too: mute it');
    expect(text).toContain("Origin A4 (MIDI 57)");
    expect(text).toContain("Preset: custom.");
  });

  it("widens a wheel's range for a value past it, and says what a snapped pointer plays", () => {
    const { song: s, text } = updatePitchWheelTool(song(), { pitch: { value: 19.4 } });
    expect(pw(s).pitch).toMatchObject({ value: 19.4, range: 48 });
    expect(text).toContain("pointer +19.4 st (plays +19 st), range 48 (±24)");
    expect(pw(updatePitchWheelTool(song(), { pitch: { value: 7, snap: "octave" } }).song).pitch.snap).toBe("octave");
    expect(pw(updatePitchWheelTool(song(), { pitch: { snap: false } }).song).pitch.snap).toBe("off");
  });

  it("clears its notes, and warns of a silent Multi", () => {
    const withNotes = updatePitchWheelTool(song(), { notesFrom: "chan_keys" }).song;
    expect(pw(updatePitchWheelTool(withNotes, { notesFrom: "none" }).song).notesFrom).toBeNull();
    expect(updatePitchWheelTool(song(), { midiMode: "multi" }).text).toContain("Multi with no channel's notes is silent");
    const muted = setMuted(withNotes, ["chan_keys"], true);
    expect(describePitchWheel(muted, {})).toContain("muted: only the result is heard");
  });

  it("refuses what isn't allowed, saying what is", () => {
    expect(() => updatePitchWheelTool(song(), { pitch: { range: 7 } })).toThrow(/"pitch.range" must be one of: 2, 4, 6, 12, 24, 48/);
    expect(() => updatePitchWheelTool(song(), { pitch: { value: 9, range: 12 } })).toThrow(/past range 12 \(±6\): give a range of 24 or more/);
    expect(() => updatePitchWheelTool(song(), { pitch: { value: 30 } })).toThrow(/from -24 to 24/);
    expect(() => updatePitchWheelTool(song(), { timbre: { gravity: 2 } })).toThrow(/"timbre.gravity" must be a number from 0 to 1/);
    expect(() => updatePitchWheelTool(song(), { pitch: { snap: "fifth" } })).toThrow(/off, semitone, octave/);
    expect(() => updatePitchWheelTool(song(), { notesFrom: "Bass" })).toThrow(/There's no channel "Bass".*"Keys"/);
    expect(() => updatePitchWheelTool(song(), { origin: "H2" })).toThrow(/"origin" must be a note name/);
    expect(() => updatePitchWheelTool(song(), { preset: "Cher" })).toThrow(/The presets: Natural, Octave Up/);
    expect(() => updatePitchWheelTool(song(), {})).toThrow(/Nothing to change/);
  });

  it("says its settings, presets and what the engine heard", () => {
    const text = describePitchWheel(song(), {}, { latency: 2048, pitch: 6.5, timbre: 0, voices: [{ key: 64, pitch: 4 }], input: 0.4, notes: [64] }, true);
    expect(text).toMatch(/Pitch Wheel fx_wheel, slot 2 of insert 2/i);
    expect(text).toContain("Pitch wheel: pointer 0 st, range 24 (±12), snap semitone, gravity 0.75");
    expect(text).toContain("Single (always heard");
    expect(text).toContain("Origin C5 (MIDI 60)");
    expect(text).toContain("Preset: Natural.");
    expect(text).toContain("Now (sound is going through it): pitch heard +6.5 st");
    expect(text).toContain("notes held: E5; voices: E5 at +4 st");
    expect(liveText(null, false)).toMatch(/hasn't said/);
    expect(describeMixer(song(), null)).toContain("Pitch Wheel (Vaudio), effect fx_wheel, pitch 0 semitones, formants kept, single (get_pitch_wheel)");
  });

  it("automates its controls by name, and isn't a plugin's parameters", () => {
    const s = song();
    const target = resolveControl(s, { control: "wheel pitch", track: 2, slot: 2 });
    expect(target).toEqual({ kind: "pitchWheel", effect: "fx_wheel", control: "pitch" });
    expect(resolveControl(s, { control: "wheel timbre smooth", track: 2, slot: 2 })).toEqual({ kind: "pitchWheel", effect: "fx_wheel", control: "timbreSmooth" });
    expect(() => resolveControl(s, { control: "wheel pitch", track: 2, slot: 1 })).toThrow(/has no effect in slot 1/);
    const made = addAutomationEdit(s, { length: 2, points: [{ at: 0, value: 12 }] }, target as never);
    const automation = made.song.automations[0];
    expect(automation.points[0].value).toBeCloseTo(0.75, 6);
    expect(controlOf(made.song, automation.target).format(automation.points[0].value)).toBe("+12.00 st");
    const rows = songControls(s).flatMap((g) => g.rows).filter((r) => r.target.kind === "pitchWheel");
    expect(rows).toHaveLength(8);
    expect(pluginOwners(s).some((o) => o.id === "fx_wheel")).toBe(false);
  });
});
