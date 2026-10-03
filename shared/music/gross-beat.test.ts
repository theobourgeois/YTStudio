import { describe, expect, it } from "vitest";
import { controlOf, createAutomation, curveValue, editPoints } from "./automation.ts";
import { compileSong } from "./compile.ts";
import { addChannels } from "./edits.ts";
import {
  editGrossBeat,
  editGrossSlot,
  emptyGrossSlot,
  engineEnvelope,
  findGrossBeat,
  grossBeats,
  grossSlot,
  offsetAt,
  paintStep,
  pitchSegment,
  renameGrossSlot,
  setGrossSlot,
  slidePoint,
  smoothAllPoints,
  speedAt,
  speedText,
  updateGrossBeat,
} from "./gross-beat.ts";
import { GROSS_BEAT_PLUGIN, GROSS_SLOTS, GROSS_TICKS, GROSS_TIME_PRESETS, GROSS_VOLUME_PRESETS, offsetValue } from "./gross-beat-presets.ts";
import { MAX_GROSS_RELEASE } from "./gross-beat-presets.ts";
import { setEffect } from "./mixer.ts";
import { addClips, editClips } from "./playlist.ts";
import { DEFAULT_GROSS_BEAT, FIRST_PATTERN_ID, createMusicProject, normalizeGrossBeat, normalizeMusicProject, normalizePoints } from "./project.ts";
import type { AutomationPoint } from "./types.ts";

const BEAT = 96;
const BAR = 384;
const P = FIRST_PATTERN_ID;
const preset = (name: string) => GROSS_TIME_PRESETS.find((p) => p.name === name)!.points;
const volumePreset = (name: string) => GROSS_VOLUME_PRESETS.find((p) => p.name === name)!.points;
const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

/** A song with a Gross Beat in Insert 1's first slot. */
function withGrossBeat() {
  const song = addChannels(createMusicProject("Chops"), [{ id: "chan_loop", name: "Loop", sampleId: "media_loop" }]);
  return setEffect(song, "insert_1", 0, GROSS_BEAT_PLUGIN, "fx_gross");
}

describe("the presets", () => {
  it("are 36 time and 36 volume slots, each a valid envelope across the bar", () => {
    expect(GROSS_TIME_PRESETS).toHaveLength(GROSS_SLOTS);
    expect(GROSS_VOLUME_PRESETS).toHaveLength(GROSS_SLOTS);
    for (const slot of [...GROSS_TIME_PRESETS, ...GROSS_VOLUME_PRESETS]) {
      // What a song would keep of it is what it is.
      expect(normalizePoints(slot.points, GROSS_TICKS), slot.name).toEqual(slot.points);
      expect(slot.points[0].tick, slot.name).toBe(0);
      expect(slot.points[slot.points.length - 1].tick, slot.name).toBe(GROSS_TICKS);
      for (const p of slot.points) {
        expect(Number.isInteger(p.tick), slot.name).toBe(true);
        expect(p.value, slot.name).toBeGreaterThanOrEqual(0);
        expect(p.value, slot.name).toBeLessThanOrEqual(1);
      }
    }
    expect(new Set(GROSS_TIME_PRESETS.map((p) => p.name)).size).toBe(GROSS_SLOTS);
    expect(new Set(GROSS_VOLUME_PRESETS.map((p) => p.name)).size).toBe(GROSS_SLOTS);
  });

  it("repeat the bar's first part: each step reads from where the bar began", () => {
    const points = preset("1 Beat Rpt");
    expect([0.5, 1.5, 2.5, 3.5].map((b) => offsetAt(points, b * BEAT))).toEqual([0, -1, -2, -3]);
    expect(speedAt(points, 1.5 * BEAT)).toBeCloseTo(1, 6);
    const sixteenths = preset("1/16 Repeat");
    // Every sixteenth reads the bar's first sixteenth again.
    for (const k of [0, 5, 63]) expect(offsetAt(sixteenths, k * 6 + 3) + (k * 6 + 3) / BEAT).toBeCloseTo(3 / BEAT, 9);
  });

  it("speed up and slow down as their names say", () => {
    expect(speedAt(preset("1/2 Speed"), BEAT)).toBeCloseTo(0.5, 6);
    expect(speedAt(preset("Reverse"), BEAT)).toBeCloseTo(-1, 6);
    expect(speedAt(preset("X2 Speed"), BEAT / 2)).toBeCloseTo(2, 6);
    expect(speedAt(preset("1/4 Pitch Up"), 10)).toBeCloseTo(2, 6);
    expect(speedAt(preset("1/4 Pitch Dn"), 10)).toBeCloseTo(0.5, 6);
    expect(speedAt(preset("Empty"), BEAT)).toBeCloseTo(1, 6);
    // Vinyl Off slows to a stop across the bar; Vinyl On starts from one.
    expect(speedAt(preset("Vinyl Off"), 0)).toBeCloseTo(1, 1);
    expect(speedAt(preset("Vinyl Off"), BAR - 1)).toBeCloseTo(0, 1);
    expect(speedAt(preset("Vinyl On"), 0)).toBeCloseTo(0, 1);
    expect(speedAt(preset("Vinyl On"), BAR - 1)).toBeCloseTo(1, 1);
    // Grains keep their pitch while the bar plays at half its tempo.
    expect(speedAt(preset("1/2 Grains"), 4)).toBeCloseTo(1, 6);
    expect(offsetAt(preset("1/2 Grains"), BAR - 1)).toBeCloseTo(-2, 1);
  });

  it("never read ahead of now, and the volume ones say what they do", () => {
    for (const slot of GROSS_TIME_PRESETS) for (let t = 0; t <= BAR; t += 3) expect(offsetAt(slot.points, t), slot.name).toBeLessThanOrEqual(1e-9);
    const gate = volumePreset("1/4 Bt Gate");
    expect([0, 12, 24, 36].map((t) => curveValue(gate, t + 1))).toEqual([1, 0, 1, 0]);
    expect(curveValue(volumePreset("Mute"), 100)).toBe(0);
    const sidechain = volumePreset("Sidechain");
    expect(curveValue(sidechain, BEAT)).toBe(0);
    expect(curveValue(sidechain, BEAT + 0.3 * BEAT)).toBeGreaterThan(0.6);
  });
});

describe("the settings", () => {
  it("come with a new Gross Beat, and a plugin has none", () => {
    const song = withGrossBeat();
    const effect = song.mixer.tracks[1].effects[0]!;
    expect(effect.plugin).toEqual(GROSS_BEAT_PLUGIN);
    expect(effect.grossBeat).toBe(DEFAULT_GROSS_BEAT);
    const plugin = setEffect(song, "insert_1", 1, { id: "VST3-Pro-Q", name: "Pro-Q", format: "VST3" }, "fx_eq");
    expect(plugin.mixer.tracks[1].effects[1]!.grossBeat).toBeUndefined();
  });

  it("are kept through a save, repaired where they're wrong", () => {
    let song = withGrossBeat();
    song = updateGrossBeat(song, "fx_gross", { timeSlot: 7, attack: 0.1, trigSync: 1, hold: "next" });
    song = editGrossSlot(song, "fx_gross", "time", 7, (points) => pitchSegment(points, 1, 12));
    const saved = normalizeMusicProject(JSON.parse(JSON.stringify(song)));
    expect(saved.mixer.tracks[1].effects[0]!.grossBeat).toEqual(findGrossBeat(song, "fx_gross")!.grossBeat);
    const repaired = normalizeGrossBeat({ timeSlot: 99, trigSync: 3, attack: 9, hold: "loop", time: [{ name: "Mine", points: [{ tick: 500, value: 2 }] }] });
    expect(repaired).toMatchObject({ timeSlot: 0, trigSync: DEFAULT_GROSS_BEAT.trigSync, attack: 0.5, hold: "last" });
    expect(repaired.time[0]).toEqual({ name: "Mine", points: [{ tick: 0, value: 1, tension: 0, curve: "single" }] });
    expect(repaired.time.slice(1).every((s) => s === null)).toBe(true);
    expect(normalizeGrossBeat(null)).toBe(DEFAULT_GROSS_BEAT);
  });

  it("change only when something does, and link the slots when asked", () => {
    const song = withGrossBeat();
    expect(updateGrossBeat(song, "fx_gross", { timeSlot: 0 })).toBe(song);
    expect(updateGrossBeat(song, "fx_nope", { timeSlot: 3 })).toBe(song);
    const picked = findGrossBeat(updateGrossBeat(song, "fx_gross", { timeSlot: 3 }), "fx_gross")!.grossBeat;
    expect([picked.timeSlot, picked.volumeSlot]).toEqual([3, 0]);
    const linked = updateGrossBeat(updateGrossBeat(song, "fx_gross", { linkSlots: true }), "fx_gross", { volumeSlot: 5 });
    expect(findGrossBeat(linked, "fx_gross")!.grossBeat).toMatchObject({ timeSlot: 5, volumeSlot: 5 });
    expect(findGrossBeat(updateGrossBeat(song, "fx_gross", { timeMix: 3, tension: -4, trigSync: 0.3 }), "fx_gross")!.grossBeat).toMatchObject({
      timeMix: 1,
      tension: -1,
      trigSync: DEFAULT_GROSS_BEAT.trigSync,
    });
    expect(grossBeats(song).map((g) => g.effect.id)).toEqual(["fx_gross"]);
  });

  it("keep a changed slot in the song, and give back its preset when it's reset", () => {
    let song = withGrossBeat();
    song = editGrossSlot(song, "fx_gross", "volume", 2, (points) => paintStep(points, 0, BEAT, 0));
    let gb = findGrossBeat(song, "fx_gross")!.grossBeat;
    expect(gb.volume[2]?.name).toBe("1 Beat Gate");
    expect(curveValue(grossSlot(gb, "volume", 2).points, 10)).toBe(0);
    song = renameGrossSlot(song, "fx_gross", "volume", 2, "  My gate ");
    expect(findGrossBeat(song, "fx_gross")!.grossBeat.volume[2]?.name).toBe("My gate");
    song = setGrossSlot(song, "fx_gross", "volume", 2, null);
    gb = findGrossBeat(song, "fx_gross")!.grossBeat;
    expect(gb.volume[2]).toBeNull();
    expect(grossSlot(gb, "volume", 2)).toBe(GROSS_VOLUME_PRESETS[2]);
    expect(setGrossSlot(song, "fx_gross", "volume", 2, null)).toBe(song);
    expect(editGrossSlot(song, "fx_gross", "time", 1, (p) => p)).toBe(song);
    const cleared = setGrossSlot(song, "fx_gross", "time", 4, emptyGrossSlot());
    expect(offsetAt(grossSlot(findGrossBeat(cleared, "fx_gross")!.grossBeat, "time", 4).points, 200)).toBe(0);
    expect(editGrossBeat(song, "fx_gross", (g) => g)).toBe(song);
  });
});

describe("editing an envelope", () => {
  const flat: AutomationPoint[] = [
    { tick: 0, value: 1, tension: 0, curve: "single" },
    { tick: BAR, value: 1, tension: 0, curve: "single" },
  ];

  it("pitches a segment by semitones", () => {
    const half = preset("1/2 Speed");
    // An octave up from half speed is normal speed: flat.
    const up = pitchSegment(half, 1, 12);
    expect(speedAt(up, BEAT)).toBeCloseTo(1, 6);
    expect(speedAt(pitchSegment(half, 1, 1), BEAT)).toBeCloseTo(0.5 * 2 ** (1 / 12), 6);
    expect(pitchSegment(half, 0, 1)).toBe(half);
    // Faster than now can't be: it stops at the top.
    expect(pitchSegment(flat, 1, 12)).toBe(flat);
  });

  it("paints steps, keeping what's around them", () => {
    const painted = paintStep(flat, BEAT, 2 * BEAT, offsetValue(-1));
    expect([BEAT / 2, BEAT, 1.5 * BEAT, 2 * BEAT, 3 * BEAT].map((t) => offsetAt(painted, t))).toEqual([0, -1, -1, 0, 0]);
    const pulse = paintStep(flat, 0, BEAT, 0.25, true, 0);
    expect([10, 60, 100].map((t) => curveValue(pulse, t))).toEqual([0.25, 0, 1]);
    // Painting over a step again replaces it.
    const again = paintStep(painted, BEAT, 2 * BEAT, offsetValue(-0.5));
    expect(offsetAt(again, 1.5 * BEAT)).toBe(-0.5);
    expect(again.length).toBe(painted.length);
  });

  it("slides the points after a moved one along with it", () => {
    const points = preset("1 Beat Rpt");
    expect(points.map((p) => p.tick)).toEqual([0, 96, 192, 288, 384]);
    expect(slidePoint(points, 1, BEAT + 24, points[1].value).map((p) => p.tick)).toEqual([0, 120, 216, 312, 384]);
    // Slid into the bar's end, they gather there: the last one's value stays.
    const far = slidePoint(points, 1, 3.5 * BEAT, points[1].value);
    expect(far.map((p) => p.tick)).toEqual([0, 336, 384]);
    expect(far[2]).toBe(points[4]);
  });

  it("turns every segment smooth", () => {
    const smooth = smoothAllPoints(preset("1 Beat Rpt"));
    expect(smooth.slice(1).every((p) => p.curve === "smooth")).toBe(true);
    expect(smoothAllPoints(smooth)).toBe(smooth);
  });

  it("says speeds as a musician would", () => {
    expect(speedText(1)).toBe("normal speed");
    expect(speedText(0)).toBe("paused");
    expect(speedText(0.5)).toBe("×0.5 (-12 st)");
    expect(speedText(-1)).toBe("reverse ×1");
  });
});

describe("compiling", () => {
  it("sends the picked slots' envelopes, as straight lines (offsets in beats, levels)", () => {
    const song = updateGrossBeat(withGrossBeat(), "fx_gross", { timeSlot: 30, volumeSlot: 5 });
    const [effect] = compileSong(song, P).tracks.find((t) => t.id === "insert_1")!.effects;
    expect(effect).toMatchObject({ id: "fx_gross", plugin: { id: GROSS_BEAT_PLUGIN.id } });
    const gb = effect.grossBeat!;
    expect(gb).toMatchObject({ timeSlot: 30, volumeSlot: 5, trigSync: 24, posSync: 384, ticks: BAR, depth: 8 });
    expect(gb.time.flatMap((e, i) => (e ? [i] : []))).toEqual([30]);
    expect(gb.volume.flatMap((e, i) => (e ? [i] : []))).toEqual([5]);
    // 1/2 Speed: a straight line from now to two beats back.
    expect(gb.time[30]).toEqual({ ticks: [0, BAR], values: [0, -2] });
    // A gate's steps are jumps: two points on one tick.
    const gate = gb.volume[5]!;
    expect(gate.ticks.slice(0, 4)).toEqual([0, 12, 12, 24]);
    expect(gate.values.slice(0, 4)).toEqual([1, 1, 0, 0]);
  });

  it("draws curves closely: a scratch's offset is within a ten-thousandth of a beat", () => {
    const points = preset("Bar Scratch");
    const envelope = engineEnvelope(points, "time");
    for (let t = 0; t < BAR; t += 0.37) {
      let i = 0;
      while (i + 1 < envelope.ticks.length && envelope.ticks[i + 1] <= t) i++;
      const f = (t - envelope.ticks[i]) / (envelope.ticks[i + 1] - envelope.ticks[i]);
      const line = envelope.values[i] + (envelope.values[i + 1] - envelope.values[i]) * f;
      expect(Math.abs(line - offsetAt(points, t))).toBeLessThan(2e-4);
    }
  });

  it("automates its slots and mixes in song mode, sending every slot the automation reaches", () => {
    let song = withGrossBeat();
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: BAR * 4 }]).clips);
    const made = createAutomation(song, { kind: "grossBeat", effect: "fx_gross", control: "timeSlot" }, { start: 0, length: BAR * 2 }, { id: "auto_slot" });
    song = editPoints(made.song, "auto_slot", () => [
      { tick: 0, value: 3 / 35, tension: 0, curve: "single" },
      { tick: BAR, value: 7 / 35, tension: 0, curve: "hold" },
    ]);
    const compiled = compileSong(song, P, null, "song");
    const gb = compiled.tracks.find((t) => t.id === "insert_1")!.effects[0].grossBeat!;
    expect(gb.time.flatMap((e, i) => (e ? [i] : []))).toEqual([0, 3, 4, 5, 6, 7]);
    const lane = compiled.lanes.find((l) => l.target.kind === "gross")!;
    expect(lane.target).toEqual({ kind: "gross", track: compiled.tracks.findIndex((t) => t.id === "insert_1"), effect: 0, control: "timeSlot" });
    expect(lane.values[0]).toBe(3);
    expect(lane.values[lane.values.length - 1]).toBe(7);
    // In pattern mode, only the picked slot.
    expect(compileSong(song, P).tracks.find((t) => t.id === "insert_1")!.effects[0].grossBeat!.time.filter(Boolean)).toHaveLength(1);
  });

  it("automates ATT, REL and TNS in their own units (seconds, -1..1)", () => {
    let song = withGrossBeat();
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: BAR * 2 }]).clips);
    const made = createAutomation(song, { kind: "grossBeat", effect: "fx_gross", control: "release" }, { start: 0, length: BAR }, { id: "auto_rel" });
    song = editPoints(made.song, "auto_rel", () => [
      { tick: 0, value: 0, tension: 0, curve: "single" },
      { tick: BAR, value: 0.5, tension: 0, curve: "single" },
    ]);
    const lane = compileSong(song, P, null, "song").lanes.find((l) => l.target.kind === "gross")!;
    expect(lane.target).toMatchObject({ kind: "gross", control: "release" });
    expect(lane.values[0]).toBe(0);
    expect(lane.values[lane.values.length - 1]).toBeCloseTo(0.5 * MAX_GROSS_RELEASE, 6);
    const tension = controlOf(song, { kind: "grossBeat", effect: "fx_gross", control: "tension" });
    expect(tension.own).toBe(0.5);
    expect(tension.toControl(1)).toBe(1);
    expect(controlOf(song, { kind: "grossBeat", effect: "fx_gross", control: "attack" }).format(1)).toBe("500 ms");
  });

  it("names its controls for automation clips", () => {
    const song = updateGrossBeat(withGrossBeat(), "fx_gross", { timeSlot: 30 });
    const slot = controlOf(song, { kind: "grossBeat", effect: "fx_gross", control: "timeSlot" });
    expect(slot).toMatchObject({ name: "Time slot", owner: "YT-Time (Insert 1)", exists: true });
    expect(slot.own).toBeCloseTo(30 / 35);
    expect(slot.format(slot.own!)).toBe("31: 1/2 Speed");
    expect(slot.toControl(1)).toBe(35);
    expect(round(controlOf(song, { kind: "grossBeat", effect: "fx_gross", control: "volumeMix" }).own!)).toBe(1);
    expect(controlOf(song, { kind: "grossBeat", effect: "fx_gone", control: "timeMix" }).exists).toBe(false);
  });
});
