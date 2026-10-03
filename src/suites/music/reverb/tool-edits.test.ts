import { describe, expect, it } from "vitest";
import { addChannels } from "@shared/music/edits";
import { routeChannels, setEffect } from "@shared/music/mixer";
import { createMusicProject } from "@shared/music/project";
import { findReverb, reverbKey, reverbT60 } from "@shared/music/reverb";
import { PRESET_LOUDNESS, REVERB_INFINITE, REVERB_PLUGIN } from "@shared/music/reverb-presets";
import { levelGain } from "@shared/music/compile";
import type { MusicProject } from "@shared/music/types";
import { addAutomationEdit, resolveControl } from "../automation/tool-edits";
import { VOCAL_REVERB_LU, addVocalReverbTool, describeReverb, findReverbRef, setReverbDecayTool, updateReverbTool } from "./tool-edits";

/** A vocal on Insert 1 (named "Vox"), a Reverb on Insert 2's second slot. */
function song(): MusicProject {
  let s = addChannels(createMusicProject("Verb", 120), [{ id: "chan_vox", name: "Vox", sampleId: "s" }]);
  s = routeChannels(s, ["chan_vox"], "insert_1");
  s = { ...s, mixer: { ...s.mixer, tracks: s.mixer.tracks.map((t) => (t.id === "insert_1" ? { ...t, name: "Vox" } : t)) } };
  return setEffect(s, "insert_2", 1, REVERB_PLUGIN, "fx_verb");
}
const verb = (s: MusicProject, id = "fx_verb") => findReverb(s, id)!.reverb;

describe("the assistant's Reverb", () => {
  it("finds it by id, by track, or as the song's only one, and lists them when it can't", () => {
    const s = song();
    expect(findReverbRef(s, { effect: "fx_verb" }).effect.id).toBe("fx_verb");
    expect(findReverbRef(s, { track: 2 }).slot).toBe(1);
    expect(findReverbRef(s, {}).effect.id).toBe("fx_verb");
    expect(() => findReverbRef(s, { track: 1 })).toThrow(/has no YT-R.*fx_verb/);
    expect(() => findReverbRef(createMusicProject("None"), {})).toThrow(/add_vocal_reverb/);
  });

  it("says every setting, the T60 at each band, the modes and presets", () => {
    const text = describeReverb(song(), {});
    expect(text).toContain('preset "Vocal Plate"');
    expect(text).toContain("Smooth Plate, Now");
    expect(text).toMatch(/pre-delay 1\/64 \(31 ms at 120 BPM\)/);
    expect(text).toMatch(/T60 by octave band: 31\.5 Hz/);
    expect(text).toContain("Ballad Hall");
  });

  it("takes values in units, note values and presets, and says what's wrong", () => {
    let s = updateReverbTool(song(), { preset: "ballad hall", decay: "2.4 s", predelay: "1/8 dot", duck: "-6 dB", highCut: "7 kHz", deEss: 8, duckRelease: "400 ms" }).song;
    expect(verb(s)).toMatchObject({ mode: "hall", decay: 2.4, sync: true, predelayNote: { note: 8, feel: "dotted" }, duck: -6, highCut: 7000, deEss: 8 });
    expect(verb(s).ducking.release).toBeCloseTo(0.4, 6);
    s = updateReverbTool(s, { predelay: 40, decay: "inf", duckThreshold: "auto", lowShelf: { gain: -3 } }).song;
    expect(verb(s)).toMatchObject({ sync: false, predelay: 0.04, decay: REVERB_INFINITE });
    expect(verb(s).output.lowShelf.gain).toBe(-3);
    expect(() => updateReverbTool(s, { decay: "90 s" })).toThrow(/seconds from 0.1 to 60/);
    expect(() => updateReverbTool(s, { mode: "spring" })).toThrow(/smoothPlate, plate, room/);
    expect(() => updateReverbTool(s, { preset: "Nope" })).toThrow(/There's no preset/);
    expect(() => updateReverbTool(s, {})).toThrow(/Nothing to change/);
  });

  it("keys its ducking from another track (its slot's key), or its own input", () => {
    const s = updateReverbTool(song(), { duckKey: "Vox" }).song;
    expect(reverbKey(s, "fx_verb")).toBe("insert_1");
    expect(updateReverbTool(s, { duckKey: "self" }).song.mixer.tracks.flatMap((t) => t.effects).some((e) => e?.sidechain)).toBe(false);
    expect(() => updateReverbTool(s, { duckKey: 2 })).toThrow(/own track/);
  });

  it("shapes the Decay EQ by multipliers or seconds, at most six bands", () => {
    let s = setReverbDecayTool(song(), { bands: [{ shape: "highShelf", frequency: 6000, multiplier: 0.5 }, { shape: "lowShelf", frequency: 250, seconds: 1 }] }).song;
    expect(verb(s).bands).toHaveLength(2);
    expect(verb(s).bands[1].multiplier).toBeLessThan(1);
    expect(reverbT60(verb(s))[9]).toBeLessThan(reverbT60(verb(song()))[9]);
    s = setReverbDecayTool(s, { bands: [{ band: 1, remove: true }], bypass: true }).song;
    expect(verb(s).bands.map((b) => b.id)).toEqual([2]);
    expect(verb(s).bandsBypass).toBe(true);
    expect(() => setReverbDecayTool(s, { bands: [{ band: 5, multiplier: 2 }] })).toThrow(/There's no band 5/);
    expect(() => setReverbDecayTool(s, {})).toThrow(/Nothing to change/);
  });

  it("sets up a vocal's reverb send: a named return, fully wet and locked, about 14 LU under, ducked by the vocal", () => {
    const { song: s, text } = addVocalReverbTool(song(), { track: "Vox" }, ["ins_unused", "fx_vv"]);
    const r = findReverb(s, "fx_vv")!;
    expect(r.track.name).toBe("Vox Verb");
    expect(r.reverb).toMatchObject({ mix: 1, mixLock: true, preset: "Vocal Plate" });
    expect(r.effect.sidechain?.track).toBe("insert_1");
    const send = s.mixer.tracks.find((t) => t.id === "insert_1")!.sends.find((x) => x.to === r.track.id)!;
    expect(20 * Math.log10(levelGain(send.level, 1)) + PRESET_LOUDNESS).toBeCloseTo(VOCAL_REVERB_LU, 6);
    expect(text).toContain("14 LU");
    // A pair and a throw: three returns, the throw's send off.
    const three = addVocalReverbTool(song(), { track: 1, pair: true, throw: true }).song;
    const made = three.mixer.tracks.filter((t) => t.name?.startsWith("Vox "));
    expect(made.map((t) => t.name)).toEqual(["Vox Room", "Vox Verb", "Vox Throw"]);
    const throwSend = three.mixer.tracks.find((t) => t.id === "insert_1")!.sends.find((x) => x.to === made[2].id)!;
    expect(throwSend.level).toBe(0);
    expect(() => addVocalReverbTool(song(), { track: 0 })).toThrow(/not the master/);
    expect(() => addVocalReverbTool(song(), { track: 1, kind: "cathedral" })).toThrow(/"kind" must be/);
  });

  it("automates its controls by name, times in milliseconds", () => {
    const s = song();
    expect(resolveControl(s, { control: "reverb decay", track: 2, slot: 2 })).toEqual({ kind: "reverb", effect: "fx_verb", control: "decay" });
    expect(() => resolveControl(s, { control: "reverb decay", track: 1, slot: 1 })).toThrow();
    const input = { control: "reverb predelay", track: 2, slot: 2, bar: 1, length: 1, points: [{ at: 0, value: 20 }, { at: 1, value: 80 }] };
    const made = addAutomationEdit(s, input, { kind: "reverb", effect: "fx_verb", control: "predelay" });
    const automation = made.song.automations[0];
    // 20 and 80 ms, as fractions of the knob (its taper: 0.5 s at the top, as the square).
    expect(automation.points.map((p) => Math.round(p.value * 1000) / 1000)).toEqual([0.2, 0.4]);
  });
});
