import { describe, expect, it } from "vitest";
import { findGrossBeat, offsetAt } from "@shared/music/gross-beat";
import { GROSS_BEAT_PLUGIN } from "@shared/music/gross-beat-presets";
import { setEffect } from "@shared/music/mixer";
import { createMusicProject } from "@shared/music/project";
import { curveValue } from "@shared/music/automation";
import { resolveControl } from "../automation/tool-edits";
import { describeGrossBeat, findGross, setGrossBeatSlotTool, slotNumber, updateGrossBeatTool } from "./tool-edits";

const song = () => setEffect(createMusicProject("Chops"), "insert_2", 3, GROSS_BEAT_PLUGIN, "fx_gross");
const gb = (s: ReturnType<typeof song>) => findGrossBeat(s, "fx_gross")!.grossBeat;

describe("the assistant's Gross Beat", () => {
  it("finds it by id, by track, or as the song's only one, and lists them when it can't", () => {
    const s = song();
    expect(findGross(s, { effect: "fx_gross" }).effect.id).toBe("fx_gross");
    expect(findGross(s, { track: 2 }).slot).toBe(3);
    expect(findGross(s, {}).effect.id).toBe("fx_gross");
    expect(() => findGross(s, { track: 1 })).toThrow(/Insert 1.*has no Gross Beat.*fx_gross \(insert 2/i);
    expect(() => findGross(createMusicProject("None"), {})).toThrow(/add_mixer_effect with plugin "Gross Beat"/);
  });

  it("names slots by number or name", () => {
    const g = gb(song());
    expect(slotNumber(g, "time", 31)).toBe(30);
    expect(slotNumber(g, "time", "1/2 speed")).toBe(30);
    expect(slotNumber(g, "volume", "Sidechain")).toBe(28);
    expect(() => slotNumber(g, "time", 40)).toThrow(/1 to 36/);
  });

  it("says what it plays, its slots and the playing envelopes", () => {
    const s = updateGrossBeatTool(song(), { timeSlot: "1/2 Speed" }).song;
    const text = describeGrossBeat(s, {});
    expect(text).toContain('Playing: time slot 31 "1/2 Speed", volume slot 1 "Empty"');
    expect(text).toContain("{ beat 0, back 0; then ×0.5 (-12 st) } { beat 4, back 2, single }");
    expect(describeGrossBeat(s, { slots: [{ kind: "volume", slot: "1 Beat Gate" }] })).toContain('Volume slot 3 "1 Beat Gate": { beat 0, level 1 }');
  });

  it("picks slots and sets knobs and options, refusing what isn't allowed", () => {
    const { song: s, text } = updateGrossBeatTool(song(), { timeSlot: 4, volume: 0.5, attack: 20, hold: "next", trigSync: 1, oneShot: true });
    expect(gb(s)).toMatchObject({ timeSlot: 3, volumeMix: 0.5, attack: 0.02, hold: "next", trigSync: 1, oneShot: true });
    expect(text).toContain('time slot 4 "1 Beat Rpt"');
    expect(() => updateGrossBeatTool(song(), { trigSync: 3 })).toThrow(/0, 0.25, 0.5, 1, 2, 4/);
    expect(() => updateGrossBeatTool(song(), { attack: 900 })).toThrow(/0 to 500/);
    expect(() => updateGrossBeatTool(song(), {})).toThrow(/Nothing to change/);
  });

  it("draws a slot's envelope in beats back, names it and picks it", () => {
    const points = [
      { beat: 0, back: 0 },
      { beat: 2, back: 2, curve: "hold" },
      { beat: 4, back: 2, curve: "hold" },
    ];
    const { song: s, text } = setGrossBeatSlotTool(song(), { kind: "time", slot: 36, points, name: "My chop" });
    const g = gb(s);
    expect(g.timeSlot).toBe(35);
    expect(g.time[35]?.name).toBe("My chop");
    expect([96, 200, 300].map((t) => offsetAt(g.time[35]!.points, t))).toEqual([0, -2, -2]);
    expect(text).toContain('Time slot 36 "My chop" (playing)');
    // A volume slot, not picked.
    const gate = setGrossBeatSlotTool(s, { kind: "volume", slot: 2, points: [{ beat: 0, level: 1 }, { beat: 0.5, level: 0, curve: "hold" }], pick: false }).song;
    expect(gb(gate).volumeSlot).toBe(0);
    expect(curveValue(gb(gate).volume[1]!.points, 60)).toBe(0);
    // Reset gives back the preset.
    expect(gb(setGrossBeatSlotTool(s, { kind: "time", slot: 36, reset: true }).song).time[35]).toBeNull();
    expect(() => setGrossBeatSlotTool(song(), { kind: "time", slot: 1, points: [{ beat: 0, back: 9 }] })).toThrow(/"back" must be/);
    expect(() => setGrossBeatSlotTool(song(), { kind: "time", slot: 1, points: [{ beat: 2, back: 0 }, { beat: 1, back: 0 }] })).toThrow(/in order/);
  });

  it("automates its slots: add_automation's controls", () => {
    expect(resolveControl(song(), { control: "time slot", track: 2, slot: 4 })).toEqual({ kind: "grossBeat", effect: "fx_gross", control: "timeSlot" });
    const plugin = setEffect(song(), "insert_2", 0, { id: "VST3-Pro-Q", name: "Pro-Q", format: "VST3" }, "fx_eq");
    expect(() => resolveControl(plugin, { control: "volume slot", track: 2, slot: 1 })).toThrow(/holds Pro-Q, not a Gross Beat/);
  });
});
