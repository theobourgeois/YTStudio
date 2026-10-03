import { describe, expect, it } from "vitest";
import { setEffect } from "@shared/music/mixer";
import { findPanMan, panPattern } from "@shared/music/panman";
import { PANMAN_PLUGIN } from "@shared/music/panman-presets";
import { createMusicProject } from "@shared/music/project";
import { resolveControl } from "../automation/tool-edits";
import { describePanMan, findPan, setPanPatternTool, updatePanManTool } from "./tool-edits";

const song = () => setEffect(createMusicProject("Pans"), "insert_2", 1, PANMAN_PLUGIN, "fx_pan");
const pm = (s: ReturnType<typeof song>) => findPanMan(s, "fx_pan")!.panMan;

describe("the assistant's PanMan", () => {
  it("finds it by id, by track, or as the song's only one, and lists them when it can't", () => {
    const s = song();
    expect(findPan(s, { effect: "fx_pan" }).effect.id).toBe("fx_pan");
    expect(findPan(s, { track: 2 }).slot).toBe(1);
    expect(findPan(s, {}).effect.id).toBe("fx_pan");
    expect(() => findPan(s, { track: 1 })).toThrow(/Insert 1.*has no YT-Pan.*fx_pan \(insert 2/i);
    expect(() => findPan(createMusicProject("None"), {})).toThrow(/add_mixer_effect with plugin "YT-Pan"/);
  });

  it("says what it does, in degrees and beats, and where it is now", () => {
    const text = describePanMan(song(), {}, { position: -45, least: -60, most: -30, input: 0.5, output: 0.5, level: -6, count: 0 });
    expect(text).toContain('Preset "Slow Pan"');
    expect(text).toContain("an LFO at 0.5 Hz, back and forth");
    expect(text).toContain("width 180°");
    expect(text).toContain("Now: at 45° L");
  });

  it("loads a preset, then sets what's given, each checked against its range", () => {
    let s = updatePanManTool(song(), { preset: "random ambler", width: 100, attack: 250, rhythm: "1/8d" }).song;
    expect(pm(s)).toMatchObject({ preset: "Random Ambler", mode: "random", width: 100, attack: 0.25, rhythm: "1/8d", custom: false });
    s = updatePanManTool(s, { mode: "rhythmStep", smoothingMode: "exp", steps: 4 }).song;
    expect(pm(s)).toMatchObject({ mode: "rhythmStep", steps: 4, stepPattern: { curve: "exp" } });
    expect(() => updatePanManTool(s, { width: 300 })).toThrow('"width" must be a number from 0 to 210');
    expect(() => updatePanManTool(s, { steps: 2.5 })).toThrow("whole number");
    expect(() => updatePanManTool(s, { style: "warm" })).toThrow("clean, fat, squash");
    expect(() => updatePanManTool(s, { preset: "Nope" })).toThrow(/no preset "Nope".*Slow Pan/);
    expect(() => updatePanManTool(s, {})).toThrow("Nothing to change");
  });

  it("draws its own Rhythm Step pattern, which plays", () => {
    const { song: s, text } = setPanPatternTool(song(), {
      editor: "step",
      beatsPerBar: 3,
      points: [
        { beat: 0, position: -1 },
        { beat: 0.75, position: 1 },
        { beat: 1.5, position: 0 },
      ],
    });
    expect(pm(s)).toMatchObject({ mode: "rhythmStep", custom: true, stepPattern: { bars: 1, beatsPerBar: 3 } });
    expect(pm(s).stepPattern.points.map((p) => p.tick)).toEqual([0, 72, 144]);
    expect(panPattern({ ...pm(s), smoothing: 0 })!.value(100)).toBe(1);
    expect(text).toContain("{ beat 0.75, position 1 }");
    expect(() => setPanPatternTool(song(), { editor: "step", points: [{ beat: 9, position: 0 }] })).toThrow(/under 4/);
    expect(() => setPanPatternTool(song(), { editor: "step", points: [{ beat: 1, position: 0 }, { beat: 1, position: 1 }] })).toThrow(/one beat/);
  });

  it("draws its own Rhythm Shape events, refusing ones that overlap", () => {
    const s = setPanPatternTool(song(), { editor: "shape", bars: 2, events: [{ beat: 0, length: 3 }, { beat: 4, length: 0.5 }] }).song;
    expect(pm(s)).toMatchObject({ mode: "rhythmShape", custom: true, shapePattern: { bars: 2, events: [{ tick: 0, length: 288 }, { tick: 384, length: 48 }] } });
    expect(() => setPanPatternTool(song(), { editor: "shape", events: [{ beat: 0, length: 2 }, { beat: 1, length: 1 }] })).toThrow(/can't overlap/);
    expect(() => setPanPatternTool(song(), { editor: "lines" })).toThrow('"editor" must be');
  });

  it("names its controls for add_automation", () => {
    const s = song();
    expect(resolveControl(s, { control: "panman offset", track: 2, slot: 2 })).toEqual({ kind: "panMan", effect: "fx_pan", control: "offset" });
    const other = setEffect(s, "insert_2", 0, { id: "vst3:x", name: "Comp", format: "VST3" }, "fx_comp");
    expect(() => resolveControl(other, { control: "panman rate", track: 2, slot: 1 })).toThrow(/holds Comp, not a YT-Pan/);
  });
});
