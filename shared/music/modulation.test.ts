import { describe, expect, it } from "vitest";
import { addChannels } from "./edits.ts";
import {
  DEFAULT_MODULATOR,
  addModulator,
  followerCoefficient,
  linkControl,
  linkRangeText,
  modulatedFraction,
  modulationIndex,
  modulationOf,
  modulatorName,
  removeModulator,
  shapeLevel,
  unlinkControl,
  updateModulator,
} from "./modulation.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject, normalizeMusicProject } from "./project.ts";
import { compileSong } from "./compile.ts";
import { createAutomation } from "./automation.ts";
import { setEffect } from "./mixer.ts";
import type { AutomationTarget, MusicProject } from "./types.ts";

const FADER: AutomationTarget = { kind: "mixer", track: "insert_2", control: "volume" };
const PAN: AutomationTarget = { kind: "mixer", track: "insert_2", control: "pan" };

/** A song with a kick channel and a modulator following Insert 1. */
function song(): MusicProject {
  const s = addChannels(createMusicProject("Pump", 120), [{ id: "chan_kick", name: "Kick", sampleId: null }]);
  return addModulator(s, { kind: "track", track: "insert_1", tap: "postFx" }, "mod_a")!;
}

describe("modulators", () => {
  it("are added with FL's Peak Controller's feel, named by their source, kept in range", () => {
    const s = song();
    expect(s.modulators[0]).toEqual({ id: "mod_a", source: { kind: "track", track: "insert_1", tap: "postFx" }, ...DEFAULT_MODULATOR, links: [] });
    expect(modulatorName(s, s.modulators[0])).toBe("Insert 1 level");
    const notes = addModulator(s, { kind: "notes", channel: "chan_kick" }, "mod_b")!;
    expect(modulatorName(notes, notes.modulators[1])).toBe("Kick notes");
    // A source the song doesn't have, or an id it does: none.
    expect(addModulator(s, { kind: "notes", channel: "chan_gone" }, "mod_c")).toBeNull();
    expect(addModulator(s, { kind: "track", track: "insert_1", tap: "postFx" }, "mod_a")).toBeNull();
    const changed = updateModulator(s, "mod_a", { attack: 5, release: 0, gain: 99, tension: -3, name: "  Duck " });
    expect(changed.modulators[0]).toMatchObject({ attack: 1, release: 0.005, gain: 24, tension: -1, name: "Duck" });
    expect(updateModulator(s, "mod_a", { attack: DEFAULT_MODULATOR.attack })).toBe(s);
    expect(removeModulator(s, "mod_a").modulators).toEqual([]);
    expect(removeModulator(s, "mod_x")).toBe(s);
  });

  it("move each control they're linked to, one modulator per control, and never the tempo", () => {
    let s = linkControl(song(), "mod_a", FADER, -0.6);
    expect(modulationOf(s, FADER)?.link.amount).toBe(-0.6);
    expect(linkControl(s, "mod_a", FADER, -0.6)).toBe(s);
    expect(linkControl(s, "mod_a", { kind: "tempo" }, 0.5)).toBe(s);
    // Linked by another: it moves there.
    s = addModulator(s, { kind: "notes", channel: "chan_kick" }, "mod_b")!;
    s = linkControl(s, "mod_b", FADER, 0.3);
    expect(modulationOf(s, FADER)).toMatchObject({ modulator: { id: "mod_b" }, link: { amount: 0.3 } });
    expect(s.modulators[0].links).toEqual([]);
    s = linkControl(s, "mod_b", PAN, 2);
    expect(modulationOf(s, PAN)?.link.amount).toBe(1);
    expect(modulationIndex(s).size).toBe(2);
    s = unlinkControl(s, FADER);
    expect(modulationOf(s, FADER)).toBeNull();
    expect(unlinkControl(s, FADER)).toBe(s);
  });

  it("are checked on load: a source gone, a tempo link and a control linked twice go", () => {
    const raw = JSON.parse(JSON.stringify(linkControl(linkControl(song(), "mod_a", FADER, -0.5), "mod_a", PAN, 0.5)));
    raw.modulators.push({ id: "mod_gone", source: { kind: "track", track: "insert_99" }, links: [] });
    raw.modulators.push({ id: "mod_b", source: { kind: "track", track: "insert_3", tap: "sideways" }, attack: -1, links: [{ target: FADER, amount: 1 }, { target: { kind: "tempo" }, amount: 1 }, { target: { kind: "main" }, amount: 3 }] });
    const s = normalizeMusicProject(raw);
    expect(s.modulators.map((m) => m.id)).toEqual(["mod_a", "mod_b"]);
    expect(s.modulators[1]).toMatchObject({ source: { kind: "track", track: "insert_3", tap: "postFx" }, attack: 0, links: [{ target: { kind: "main" }, amount: 1 }] });
    expect(s.modulators[0].links).toHaveLength(2);
  });

  it("follow as the engine does: a one-pole, its level bent by tension, the control moved from its own value", () => {
    expect(followerCoefficient(0, 48_000)).toBe(1);
    // 10 ms at 48 kHz: 1 − e^(−1/480).
    expect(followerCoefficient(0.01, 48_000)).toBeCloseTo(1 - Math.exp(-1 / 480), 12);
    expect(shapeLevel(0.5, 0)).toBe(0.5);
    expect(shapeLevel(0.5, 1)).toBeCloseTo(0.0625, 9);
    expect(shapeLevel(0.5, -1)).toBeCloseTo(0.5 ** 0.25, 9);
    expect(shapeLevel(2, 0)).toBe(1);
    expect(modulatedFraction(0.8, -0.6, 1)).toBeCloseTo(0.2, 9);
    expect(modulatedFraction(0.8, -0.6, 0)).toBe(0.8);
    expect(modulatedFraction(0.2, -0.6, 1)).toBe(0);
    const s = linkControl(song(), "mod_a", { kind: "mixer", track: MASTER_TRACK_ID, control: "pan" }, -1);
    expect(linkRangeText(s, s.modulators[0].links[0])).toBe("Centre → 100% left");
  });
});

describe("modulation, compiled", () => {
  /** Insert 2's fader (at 0.8) ducked by Insert 1's level, −60%. */
  const ducked = () => linkControl(song(), "mod_a", FADER, -0.6);
  const laneOf = (c: ReturnType<typeof compileSong>, kind: string) => c.lanes.find((l) => l.target.kind === kind && ("track" in l.target ? c.tracks[l.target.track].id === "insert_2" : true));

  it("is a grid over the modulator's level, in pattern mode too: its own gains at 0, the ducked fader's at 1", () => {
    const c = compileSong(ducked(), FIRST_PATTERN_ID);
    expect(c.modulators).toEqual([{ id: "mod_a", track: c.tracks.findIndex((t) => t.id === "insert_1"), tap: "postFx", attack: 0.002, release: 0.15, gain: 1, tension: 0 }]);
    const lane = laneOf(c, "track")!;
    expect(lane).toMatchObject({ modulator: 0, steps: 17 });
    // Each point: 17 sets of the track's four gains.
    expect(lane.values.length).toBe(lane.ticks.length * 17 * 4);
    expect(lane.base!.slice(0, 4)).toEqual([1, 0, 0, 1]);
    // At full level, the fader at 0.8 − 0.6 = 0.2: (0.2 / 0.8)³.
    expect(lane.base![16 * 4]).toBeCloseTo((0.2 / 0.8) ** 3, 6);
    expect(lane.base![8 * 4]).toBeCloseTo((0.5 / 0.8) ** 3, 6);
  });

  it("follows the control's automation in song mode, its own value where it's stopped", () => {
    let s = ducked();
    s = createAutomation(s, FADER, { start: 0, length: 384 }, { id: "auto_f", value: 0.5 }).song;
    const c = compileSong(s, FIRST_PATTERN_ID, null, "song");
    const lane = laneOf(c, "track")!;
    // The automation's 0.5 at level 0, 0.5 − 0.6 (kept at 0) at 1; the base: its own 0.8.
    expect(lane.values[0]).toBeCloseTo((0.5 / 0.8) ** 3, 6);
    expect(lane.values[16 * 4]).toBe(0);
    expect(lane.base![0]).toBe(1);
  });

  it("adds its amount to a plugin's parameter in the engine (only the plugin knows its value)", () => {
    let s = setEffect(song(), "insert_2", 0, { id: "VST3-Comp", name: "Comp", format: "VST3" }, "fx_comp");
    s = linkControl(s, "mod_a", { kind: "plugin", owner: "effect", id: "fx_comp", param: "7", index: 7, name: "Cutoff" }, 0.4);
    const lane = compileSong(s, FIRST_PATTERN_ID).lanes.find((l) => l.target.kind === "param")!;
    expect(lane).toMatchObject({ ticks: [0], values: [-1], modulator: 0, amount: 0.4 });
  });

  it("leaves out a modulator with no links or whose source isn't there, and the lanes it would move", () => {
    expect(compileSong(song(), FIRST_PATTERN_ID).modulators).toBeUndefined();
    const gone = { ...ducked(), modulators: ducked().modulators.map((m) => ({ ...m, source: { kind: "track" as const, track: "insert_99", tap: "postFx" as const } })) };
    const c = compileSong(gone, FIRST_PATTERN_ID);
    expect(c.modulators).toBeUndefined();
    expect(c.lanes).toEqual([]);
  });
});

