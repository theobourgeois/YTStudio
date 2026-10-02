import { describe, expect, it } from "vitest";
import { controlOf } from "@shared/music/automation";
import { findEchoBoy } from "@shared/music/echo-boy";
import { ECHO_BOY_PLUGIN } from "@shared/music/echo-boy-presets";
import { setEffect } from "@shared/music/mixer";
import { createMusicProject } from "@shared/music/project";
import { addAutomationEdit, resolveControl } from "../automation/tool-edits";
import { describeEchoBoy, findEcho, updateEchoBoyTool } from "./tool-edits";

const song = () => setEffect(createMusicProject("Echoes", 120), "insert_2", 3, ECHO_BOY_PLUGIN, "fx_echo");
const eb = (s: ReturnType<typeof song>) => findEchoBoy(s, "fx_echo")!.echoBoy;

describe("the assistant's EchoBoy", () => {
  it("finds it by id, by track, or as the song's only one, and lists them when it can't", () => {
    const s = song();
    expect(findEcho(s, { effect: "fx_echo" }).effect.id).toBe("fx_echo");
    expect(findEcho(s, { track: 2 }).slot).toBe(3);
    expect(findEcho(s, {}).effect.id).toBe("fx_echo");
    expect(() => findEcho(s, { track: 1 })).toThrow(/has no EchoBoy.*fx_echo/);
    expect(() => findEcho(createMusicProject("None"), {})).toThrow(/add_mixer_effect with plugin "EchoBoy"/);
  });

  it("says what it is, at the tempo, and what can be chosen", () => {
    const text = describeEchoBoy(song(), {});
    expect(text).toContain("Mode: Single Echo.");
    expect(text).toContain("Echo time: 1/8 (250 ms).");
    expect(text).toContain("Style: Studio Tape: ATR-102 at 15 ips");
    expect(text).toContain("Space Echo");
    expect(text).toContain("Classic: 15 ips Tape Echo, AnaLogged");
    expect(describeEchoBoy(song(), { style: true })).toContain("Saturation tape: decay sat +4 dB");
  });

  it("loads a preset, then sets what's given over it", () => {
    const { song: s, text } = updateEchoBoyTool(song(), { preset: "AnaLogged", echo2: "1/4 dot", feedback: 0.6, highCut: 3000, tempo: 90 });
    expect(eb(s)).toMatchObject({ mode: "dual", style: "DM-2", echo2: { sync: "dot", note: 4 }, feedback: 0.6, highCut: 3000, followTempo: false, bpm: 90 });
    expect(text).toContain('loaded "AnaLogged"');
    expect(text).toContain("Echo 2 (right): 1/4 dot (1000 ms)");
    expect(eb(updateEchoBoyTool(s, { highCut: "off", tempo: "song" }).song)).toMatchObject({ highCut: 20_000, followTempo: true });
  });

  it("sets times in ms or note values, styles by name, and refuses what isn't allowed", () => {
    expect(eb(updateEchoBoyTool(song(), { echo1: "350 ms", style: "space echo" }).song)).toMatchObject({ echo1: { sync: "time", ms: 350 }, style: "Space Echo" });
    expect(eb(updateEchoBoyTool(song(), { echo1: 126.2 }).song).echo1).toMatchObject({ sync: "time", ms: 126.2 });
    expect(() => updateEchoBoyTool(song(), { echo1: "1/3" })).toThrow(/note value .*1\/2 to 1\/64/);
    expect(() => updateEchoBoyTool(song(), { style: "Loud" })).toThrow(/There's no style "Loud".*Studio Tape/);
    expect(() => updateEchoBoyTool(song(), { mix: 2 })).toThrow(/"mix" must be a number from 0 to 1/);
    expect(() => updateEchoBoyTool(song(), {})).toThrow(/Nothing to change/);
  });

  it("sets Rhythm Echo's pattern, laid-out taps or its own", () => {
    let s = updateEchoBoyTool(song(), { mode: "rhythm", rhythm: { pattern: "Gallop", shape: "swell" } }).song;
    expect(eb(s).rhythm).toMatchObject({ pattern: "Gallop", shape: "swell", length: 2 });
    s = updateEchoBoyTool(s, { rhythm: { time: "1/16", repeats: 6 } }).song;
    expect(eb(s).rhythm.taps.map((t) => t.beat)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);
    s = updateEchoBoyTool(s, { rhythm: { taps: [{ beat: 0.75, level: 0.5 }, { beat: 1.5 }] } }).song;
    expect(eb(s).rhythm).toMatchObject({ pattern: "Custom", taps: [{ beat: 0.75, level: 0.5 }, { beat: 1.5, level: 1 }] });
    expect(() => updateEchoBoyTool(s, { rhythm: { taps: [{ beat: 9 }] } })).toThrow(/under the pattern's length \(2 beats\)/);
  });

  it("edits the style (it's Custom then) and drops the edits", () => {
    let s = updateEchoBoyTool(song(), { styleEdit: { high: { decay: -30 }, wobble: { depth: 12, shape: "sine" } } }).song;
    expect(eb(s).custom).toMatchObject({ high: { freq: 8000, decay: -30 }, wobble: { depth: 12, shape: "sine" } });
    expect(describeEchoBoy(s, {})).toContain("Style: Custom (edited from Studio Tape)");
    s = updateEchoBoyTool(s, { revertStyle: true }).song;
    expect(eb(s).custom).toBeNull();
  });

  it("automates its controls by name, in their own units", () => {
    const s = song();
    const target = resolveControl(s, { control: "echo high cut", track: 2, slot: 4 });
    expect(target).toEqual({ kind: "echoBoy", effect: "fx_echo", control: "highCut" });
    expect(() => resolveControl(s, { control: "echo mix", track: 2, slot: 1 })).toThrow(/no effect in slot 1/);
    const made = addAutomationEdit(s, { points: [{ at: 0, value: 8000 }, { at: 1, value: 1000 }], length: 1 }, target as never);
    const automation = made.song.automations.find((a) => a.id === made.automationId)!;
    const info = controlOf(made.song, automation.target);
    expect(info.toControl(automation.points[0].value)).toBeCloseTo(8000, -1);
    expect(info.toControl(automation.points[1].value)).toBeCloseTo(1000, -1);
  });
});
