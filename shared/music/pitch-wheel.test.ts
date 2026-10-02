import { describe, expect, it } from "vitest";
import { controlOf, createAutomation, targetKey } from "./automation.ts";
import { compileSong } from "./compile.ts";
import { addChannels, removeChannels } from "./edits.ts";
import { setEffect } from "./mixer.ts";
import { addClips, editClips } from "./playlist.ts";
import {
  applyPitchWheelPreset,
  currentPreset,
  enginePitchWheel,
  engineControlValue,
  findPitchWheel,
  pitchWheels,
  restingAt,
  setControl,
  snapped,
  stepWheel,
  updatePitchWheel,
  wheelPhysics,
} from "./pitch-wheel.ts";
import { DEFAULT_PITCH_WHEEL, MAX_SWING, PITCH_WHEEL_PLUGIN, PITCH_WHEEL_PRESETS, normalizePitchWheel } from "./pitch-wheel-presets.ts";
import { FIRST_PATTERN_ID, createMusicProject, normalizeMusicProject } from "./project.ts";
import type { MusicProject } from "./types.ts";

const P = FIRST_PATTERN_ID;
const FX = "fx_wheel";

/** A song with a Pitch Wheel in Insert 1's first slot, and a channel to play it. */
function withWheel(): MusicProject {
  const song = addChannels(createMusicProject("Loop"), [{ id: "chan_keys", name: "Keys", sampleId: "media_keys" }]);
  return setEffect(song, "insert_1", 0, PITCH_WHEEL_PLUGIN, FX);
}
const pw = (song: MusicProject) => findPitchWheel(song, FX)!.pitchWheel;

/** Run a wheel for `seconds` towards `goal`, a sample at a time; its path. */
function run(physics: ReturnType<typeof wheelPhysics>, goal: number, seconds: number, rate = 1000) {
  const path: number[] = [];
  let m = restingAt(0);
  for (let i = 0; i < seconds * rate; i++) {
    m = stepWheel(m, goal, physics, 1 / rate);
    path.push(m.actual);
  }
  return path;
}

describe("a new Pitch Wheel", () => {
  it("shifts nothing, Timbre open, Single, C5 the origin, Wide", () => {
    const song = withWheel();
    expect(pw(song)).toEqual(DEFAULT_PITCH_WHEEL);
    expect(pw(song)).toMatchObject({ timbreOn: true, midiMode: "single", origin: 60, resolution: "wide", notesFrom: null });
    expect(pw(song).pitch).toMatchObject({ value: 0, range: 24, snap: "semitone" });
    expect(pitchWheels(song)).toHaveLength(1);
  });

  it("survives normalising, and repairs what's wrong", () => {
    const song = updatePitchWheel(withWheel(), FX, { pitch: { value: 5.5, snap: "off" }, notesFrom: "chan_keys", midiMode: "multi" });
    expect(pw(normalizeMusicProject(JSON.parse(JSON.stringify(song))))).toEqual(pw(song));
    const repaired = normalizePitchWheel({ pitch: { value: 99, range: 7, snap: true, gravity: -1 }, timbre: "no", midiMode: "poly", origin: 300, resolution: "huge" });
    expect(repaired.pitch).toMatchObject({ value: 12, range: 24, snap: "semitone", gravity: 0 });
    expect(repaired.timbre).toEqual(DEFAULT_PITCH_WHEEL.timbre);
    expect(repaired).toMatchObject({ midiMode: "single", origin: 127, resolution: "wide" });
  });
});

describe("editing it", () => {
  it("clamps the pointer to half the range, and a narrower range brings it in", () => {
    let song = updatePitchWheel(withWheel(), FX, { pitch: { value: 30 } });
    expect(pw(song).pitch.value).toBe(12);
    song = updatePitchWheel(song, FX, { pitch: { range: 48, value: 20 } });
    expect(pw(song).pitch.value).toBe(20);
    song = updatePitchWheel(song, FX, { pitch: { range: 4 } });
    expect(pw(song).pitch.value).toBe(2);
  });

  it("returns the same song when nothing changes", () => {
    const song = withWheel();
    expect(updatePitchWheel(song, FX, { pitch: { value: 0 }, timbreOn: true })).toBe(song);
    expect(updatePitchWheel(song, "fx_none", { pitch: { value: 3 } })).toBe(song);
    expect(setControl(song, FX, "pitchGravity", 0.75)).toBe(song);
  });

  it("sets one control at a time", () => {
    const song = setControl(setControl(withWheel(), FX, "timbreSmooth", 0.4), FX, "pitch", -7);
    expect(pw(song).timbre.smooth).toBe(0.4);
    expect(pw(song).pitch.value).toBe(-7);
  });

  it("applies presets and knows them", () => {
    const song = applyPitchWheelPreset(updatePitchWheel(withWheel(), FX, { notesFrom: "chan_keys", origin: 57 }), FX, "chipmunk");
    expect(pw(song)).toMatchObject({ timbreOn: false, pitch: { value: 7 }, notesFrom: "chan_keys", origin: 57 });
    expect(currentPreset(pw(song))).toBe("Chipmunk");
    expect(currentPreset(pw(setControl(song, FX, "pitch", 6)))).toBeNull();
    expect(currentPreset(DEFAULT_PITCH_WHEEL)).toBe("Natural");
    // Each preset is told apart from the others.
    expect(new Set(PITCH_WHEEL_PRESETS.map((p) => currentPreset(pw(applyPitchWheelPreset(withWheel(), FX, p.name))))).size).toBe(PITCH_WHEEL_PRESETS.length);
  });
});

describe("snapping", () => {
  it("lands on semitones or octaves", () => {
    expect(snapped(2.6, "semitone")).toBe(3);
    expect(snapped(-5.4, "semitone")).toBe(-5);
    expect(snapped(7, "octave")).toBe(12);
    expect(snapped(-5, "octave")).toBe(-0);
    expect(snapped(2.6, "off")).toBe(2.6);
  });
});

describe("the physics", () => {
  it("clamps the pitch to the pointer at full gravity", () => {
    const physics = wheelPhysics({ gravity: 1, inertia: 1, smooth: 0 });
    expect(run(physics, 7, 0.01)[0]).toBe(7);
  });

  it("follows firmly as it comes: there within 80 ms, barely overshooting", () => {
    const path = run(wheelPhysics(DEFAULT_PITCH_WHEEL.pitch), 12, 0.5);
    expect(Math.abs(path[80] - 12)).toBeLessThan(0.2);
    expect(Math.max(...path)).toBeLessThan(12.5);
    expect(path.at(-1)).toBeCloseTo(12, 3);
  });

  it("swings past the pointer and back at low gravity, settling slowly", () => {
    const path = run(wheelPhysics({ gravity: 0, inertia: 0.5, smooth: 0 }), 12, 3);
    // Flies straight past the arrow, nearly twice as far...
    expect(Math.max(...path)).toBeGreaterThan(22);
    // ...and back below the start.
    expect(Math.min(...path.slice(100))).toBeLessThan(2);
    // Still swinging after three seconds.
    expect(Math.abs(path.at(-1)! - 12)).toBeGreaterThan(0.5);
  });

  it("heads for the pointer more slowly with more inertia (at low gravity)", () => {
    const light = run(wheelPhysics({ gravity: 0.3, inertia: 0.1, smooth: 0 }), 12, 0.2);
    const heavy = run(wheelPhysics({ gravity: 0.3, inertia: 0.9, smooth: 0 }), 12, 0.2);
    expect(light[20]).toBeGreaterThan(heavy[20] + 3);
  });

  it("smooths the pointer: high smooth glides even at full gravity", () => {
    const path = run(wheelPhysics({ gravity: 1, inertia: 0, smooth: 0.6 }), 12, 5);
    const tau = wheelPhysics({ gravity: 1, inertia: 0, smooth: 0.6 }).tau;
    expect(path[Math.round(tau * 1000) - 1]).toBeCloseTo(12 * (1 - Math.exp(-1)), 1);
    expect(path.at(-1)).toBeCloseTo(12, 1);
  });

  it("is the same whatever the step (the spring is solved exactly)", () => {
    const physics = wheelPhysics({ gravity: 0.2, inertia: 0.4, smooth: 0 });
    const fine = run(physics, 10, 1, 48000).at(-1)!;
    const coarse = run(physics, 10, 1, 60).at(-1)!;
    expect(coarse).toBeCloseTo(fine, 6);
  });

  it("can't swing past four octaves", () => {
    // Pumped at resonance: the pointer flips side to side in time with the swing.
    const physics = wheelPhysics({ gravity: 0, inertia: 0.3, smooth: 0 });
    let m = restingAt(0);
    let most = 0;
    const period = (2 * Math.PI) / physics.omega;
    for (let i = 0; i < 20000; i++) {
      const t = i / 1000;
      m = stepWheel(m, Math.sin((2 * Math.PI * t) / period) > 0 ? 24 : -24, physics, 1 / 1000);
      most = Math.max(most, Math.abs(m.actual));
    }
    expect(most).toBe(MAX_SWING);
  });
});

describe("in the engine", () => {
  it("goes with its effect, its wheels snapped", () => {
    const song = updatePitchWheel(withWheel(), FX, { pitch: { value: 4.4 }, timbre: { value: 2.6, snap: "off" }, notesFrom: "chan_keys", midiMode: "multi", resolution: "tight" });
    const track = compileSong(song, P).tracks.find((t) => t.id === "insert_1")!;
    expect(track.effects[0]).toMatchObject({
      id: FX,
      plugin: { id: PITCH_WHEEL_PLUGIN.id },
      pitchWheel: { pitch: { target: 4, gravity: 0.75 }, timbre: { target: 2.6 }, timbreOn: true, multi: true, notesFrom: "chan_keys", origin: 60, window: 2048 },
    });
    expect(enginePitchWheel(DEFAULT_PITCH_WHEEL).window).toBe(4096);
  });

  it("forgets a channel the song no longer has", () => {
    const song = removeChannels(updatePitchWheel(withWheel(), FX, { notesFrom: "chan_keys" }), ["chan_keys"]);
    const track = compileSong(song, P).tracks.find((t) => t.id === "insert_1")!;
    expect(track.effects[0].pitchWheel?.notesFrom).toBeNull();
  });

  it("automates its controls as lanes, the wheels snapped, in song mode", () => {
    let song = withWheel();
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern" as const, ref: P, track: 0, start: 0, length: null }]).clips);
    // 0.6 of -24..24 is 4.8: snapped, 5.
    const pitch = createAutomation(song, { kind: "pitchWheel", effect: FX, control: "pitch" }, { start: 0, length: 384 }, { value: 0.6 });
    const gravity = createAutomation(pitch.song, { kind: "pitchWheel", effect: FX, control: "timbreGravity" }, { start: 0, length: 384 }, { value: 0.25 });
    const lanes = compileSong(gravity.song, P, null, "song").lanes;
    expect(lanes.find((l) => l.target.kind === "wheel" && l.target.control === "pitch")!.values[0]).toBe(5);
    expect(lanes.find((l) => l.target.kind === "wheel" && l.target.control === "timbreGravity")!.values[0]).toBeCloseTo(0.25, 6);
    expect(engineControlValue(DEFAULT_PITCH_WHEEL, "pitch", 13)).toBe(13);
    expect(compileSong(gravity.song, P).lanes).toEqual([]);
  });

  it("names its controls for automation", () => {
    const song = withWheel();
    const control = controlOf(song, { kind: "pitchWheel", effect: FX, control: "pitch" });
    expect(control).toMatchObject({ name: "Pitch", owner: "Pitch Wheel (Insert 1)", exists: true, own: 0.5 });
    expect(control.format(0.75)).toBe("+12.00 st");
    expect(targetKey({ kind: "pitchWheel", effect: FX, control: "timbreSmooth" })).toBe(`wheel:${FX}:timbreSmooth`);
    expect(controlOf(song, { kind: "pitchWheel", effect: "fx_gone", control: "pitch" }).exists).toBe(false);
  });
});
