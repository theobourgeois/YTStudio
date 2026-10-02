import { describe, expect, it } from "vitest";
import { controlOf, createAutomation, editPoints } from "./automation.ts";
import { compileSong } from "./compile.ts";
import { addChannels } from "./edits.ts";
import { setEffect } from "./mixer.ts";
import {
  addShapeEvent,
  addStepPoint,
  adjacentPreset,
  cycleValue,
  editShapeEvents,
  editStepPoints,
  editorEvents,
  editorSteps,
  enginePanMan,
  findPanMan,
  generatedSteps,
  loadPanPreset,
  moveStepPoint,
  panCurve,
  panDegrees,
  panEdited,
  panGains,
  panMans,
  panPattern,
  panSeed,
  panShape,
  setPatternLayout,
  setShapeEvent,
  stepValue,
  ungroove,
  updatePanMan,
} from "./panman.ts";
import { DEFAULT_PANMAN, PANMAN_PLUGIN, PANMAN_PRESETS, PAN_CURVES, PAN_SHAPE_POINTS, normalizePanMan, panControlFraction, panControlValue } from "./panman-presets.ts";
import { addClips, editClips } from "./playlist.ts";
import { FIRST_PATTERN_ID, createMusicProject, normalizeMusicProject } from "./project.ts";
import type { PanControl, PanMan } from "./types.ts";

const BEAT = 96;
const BAR = 384;
const P = FIRST_PATTERN_ID;
const FX = "fx_pan";

/** A song with a PanMan in Insert 1's first slot, set as `patch` says. */
function withPanMan(patch: Partial<PanMan> = {}) {
  const song = addChannels(createMusicProject("Pans"), [{ id: "chan_loop", name: "Loop", sampleId: "media_loop" }]);
  return updatePanMan(setEffect(song, "insert_1", 0, PANMAN_PLUGIN, FX), FX, patch);
}
const pm = (song: ReturnType<typeof withPanMan>) => findPanMan(song, FX)!.panMan;
/** A pattern's position at a tick. */
const at = (p: PanMan, tick: number) => panPattern(p)!.value(tick);
const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

describe("PanMan's settings", () => {
  it("is put in a slot as ours, a slow pan, and kept through a save", () => {
    const song = withPanMan();
    const effect = song.mixer.tracks[1].effects[0]!;
    expect(effect.plugin).toEqual(PANMAN_PLUGIN);
    expect(effect.panMan).toEqual(DEFAULT_PANMAN);
    expect(DEFAULT_PANMAN).toMatchObject({ mode: "lfo", rate: 0.5, width: 180, direction: "both", style: "clean" });
    expect(normalizeMusicProject(JSON.parse(JSON.stringify(song))).mixer.tracks[1].effects[0]!.panMan).toEqual(DEFAULT_PANMAN);
    expect(panMans(song).map((p) => p.effect.id)).toEqual([FX]);
  });

  it("holds every setting to its range, and drops what's wrong", () => {
    const pm = normalizePanMan({
      mode: "spin",
      offset: 300,
      width: -5,
      rate: 50,
      steps: 40,
      rhythm: "1/7",
      divider: 0,
      cutoff: 20,
      style: "loud",
      input: 99,
      stepPattern: { bars: 2, beatsPerBar: 3, curve: "wobble", points: [{ tick: 50, value: 3 }, { tick: 10, value: -0.5 }, { tick: 50, value: 0.2 }, { tick: 2000, value: 0 }, "x"] },
      shapePattern: { events: [{ tick: 96, length: 500 }, { tick: 0, length: 192 }, { tick: 96, length: 10 }, { tick: 384, length: 5 }] },
    });
    expect(pm).toMatchObject({ mode: "lfo", offset: 105, width: 0, rate: 10, steps: 16, rhythm: "1/4", divider: 1, cutoff: 100, style: "clean", input: 24 });
    // Points: in order, one per tick (the later kept), inside the 2 bars of 3 beats.
    expect(pm.stepPattern).toEqual({ bars: 2, beatsPerBar: 3, curve: "sine", points: [{ tick: 10, value: -0.5 }, { tick: 50, value: 0.2 }] });
    // Events: in order, none overlapping (the earlier cut short), inside the bar.
    expect(pm.shapePattern.events).toEqual([{ tick: 0, length: 96 }, { tick: 96, length: 288 }]);
    expect(normalizePanMan("nonsense")).toBe(DEFAULT_PANMAN);
  });

  it("changes only what's asked, the same song when nothing changes", () => {
    const song = withPanMan();
    expect(updatePanMan(song, FX, { width: 180 })).toBe(song);
    expect(updatePanMan(song, "fx_none", { width: 10 })).toBe(song);
    const next = updatePanMan(song, FX, { width: 400, mode: "random", stepPattern: { curve: "exp" } });
    expect(pm(next)).toMatchObject({ width: 210, mode: "random", stepPattern: { curve: "exp", bars: 1 } });
  });

  it("has factory presets that are all valid, each named once; loading one is one edit, and it knows when it's been changed", () => {
    expect(new Set(PANMAN_PRESETS.map((p) => p.name)).size).toBe(PANMAN_PRESETS.length);
    for (const preset of PANMAN_PRESETS) expect(normalizePanMan(preset.settings)).toEqual(preset.settings);
    // The seven names the manual shows are among them.
    for (const name of ["Tooo Dang Fast", "Pendulum Pan", "Faast Shimmer Pan", "Wiper Panner", "SpazPong", "Random Ambler", "EasyHopper"]) expect(PANMAN_PRESETS.some((p) => p.name === name)).toBe(true);
    let song = withPanMan();
    expect(panEdited(pm(song))).toBe(false);
    song = loadPanPreset(song, FX, "spazpong");
    expect(pm(song)).toMatchObject({ preset: "SpazPong", mode: "pingPong" });
    expect(panEdited(pm(song))).toBe(false);
    song = updatePanMan(song, FX, { divider: 3 });
    expect(panEdited(pm(song))).toBe(true);
    expect(loadPanPreset(song, FX, "No such preset")).toBe(song);
    expect(adjacentPreset(DEFAULT_PANMAN, -1)).toBe(PANMAN_PRESETS.at(-1)!.name);
    expect(adjacentPreset(DEFAULT_PANMAN, 1)).toBe(PANMAN_PRESETS[1].name);
  });
});

describe("PanMan's shapes", () => {
  it("ramps across and snaps back, Smoothing giving the snap-back up to half the cycle", () => {
    close(cycleValue("down", 0, 0), 1);
    close(cycleValue("down", 0, 0.5), 0);
    close(cycleValue("down", 0, 0.999), -0.998);
    close(cycleValue("up", 0, 0.25), -0.5);
    // Soft: across in the first half, back in the second, a sine's shape.
    close(cycleValue("down", 1, 0.5), -1);
    close(cycleValue("down", 1, 0.75), 0);
    close(cycleValue("down", 1, 1 - 1e-9), 1);
  });

  it("goes back and forth from the left, rounded into a sine by Smoothing", () => {
    close(cycleValue("both", 0, 0), -1);
    close(cycleValue("both", 0, 0.125), -0.5);
    close(cycleValue("both", 0, 0.5), 1);
    for (const p of [0.1, 0.3, 0.6, 0.9]) close(cycleValue("both", 1, p), -Math.cos(2 * Math.PI * p));
  });

  it("has the Smoothing Mode's curves, from 0 to 1, each its own shape", () => {
    for (const { id } of PAN_CURVES) {
      close(panCurve(id, 0), 0);
      close(panCurve(id, 1), 1);
    }
    expect(panCurve("exp", 0.2)).toBeGreaterThan(0.5);
    expect(panCurve("rev", 0.8)).toBeLessThan(0.5);
    close(panCurve("sym", 0.5), 0.5);
    expect(panCurve("sym", 0.25)).toBeLessThan(panCurve("sine", 0.25));
  });

  it("steps across the width in the direction's order", () => {
    expect(generatedSteps("down", 3)).toEqual([1, 0, -1]);
    expect(generatedSteps("up", 5)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(generatedSteps("both", 3)).toEqual([-1, 0, 1, 0]);
    expect(generatedSteps("both", 2)).toEqual([-1, 1]);
  });

  it("holds each step and moves into the next over the last Smoothing of the time between them, in the curve's shape", () => {
    const points = [
      { tick: 0, value: -1 },
      { tick: 96, value: 1 },
    ];
    // Hard: a jump on the point.
    expect(stepValue(points, 192, 0, "linear", 95.9)).toBe(-1);
    expect(stepValue(points, 192, 0, "linear", 96)).toBe(1);
    // Half: the move takes the second half; linear, half way at three quarters.
    expect(stepValue(points, 192, 0.5, "linear", 40)).toBe(-1);
    close(stepValue(points, 192, 0.5, "linear", 72), 0);
    close(stepValue(points, 192, 0.5, "sine", 60), -1 + 2 * panCurve("sine", 0.25));
    // It wraps round: from the last point back to the first.
    close(stepValue(points, 192, 1, "linear", 144), 0);
    close(stepValue(points, 192, 1, "linear", -48), 0);
    expect(stepValue([], 192, 0, "linear", 10)).toBe(0);
  });

  it("makes Rhythm Step's pattern from the rhythm and steps, moved by Feel", () => {
    const p: PanMan = { ...DEFAULT_PANMAN, mode: "rhythmStep", rhythm: "1/16t", steps: 3, direction: "down", smoothing: 0 };
    const pattern = panPattern(p)!;
    expect(pattern.length).toBe(48);
    expect([0, 16, 32].map((t) => pattern.value(t))).toEqual([1, 0, -1]);
    expect(pattern.breaks).toEqual([0, 16, 32]);
    // Drag all the way: the pattern a 16th later, wrapping round.
    const dragged = { ...p, rhythm: "1/4", feel: 1 };
    expect(at(dragged, 24)).toBe(1);
    expect(at(dragged, 23)).toBe(-1);
    expect(at({ ...dragged, feel: -1 }, 72)).toBe(0);
  });

  it("plays the editor's own points once they're edited, from what it showed", () => {
    let song = withPanMan({ mode: "rhythmStep", rhythm: "1/4", steps: 2, smoothing: 0 });
    expect(editorSteps(pm(song))).toEqual([0, 1, 2, 3].map((k) => ({ tick: k * BEAT, value: k % 2 ? 1 : -1 })));
    song = editStepPoints(song, FX, (points) => addStepPoint(points, 48, 0.5));
    expect(pm(song).custom).toBe(true);
    expect(pm(song).stepPattern.points.map((p) => p.tick)).toEqual([0, 48, 96, 192, 288]);
    // Its length is the editor's bars now.
    expect(panPattern(pm(song))!.length).toBe(BAR);
    expect(at(pm(song), 50)).toBe(0.5);
    // A point dropped on another goes back; one already on a tick isn't added again.
    const points = pm(song).stepPattern.points;
    expect(moveStepPoint(points, 1, 96, 0)).toBe(points);
    expect(addStepPoint(points, 0, 0)).toBe(points);
    // Fewer bars drop what's past the end.
    song = setPatternLayout(song, FX, "step", { beatsPerBar: 2 });
    expect(pm(song).stepPattern.points.map((p) => p.tick)).toEqual([0, 48, 96]);
  });

  it("plays one cycle of the shape per Rhythm Shape event, Groove swinging every second one to a triplet", () => {
    const p: PanMan = { ...DEFAULT_PANMAN, mode: "rhythmShape", rhythm: "1/4", direction: "up", smoothing: 0 };
    const pattern = panPattern(p)!;
    expect(pattern.length).toBe(2 * BEAT);
    close(at(p, 48), 0);
    close(at(p, 96 + 48), 0);
    // Swing: the second event starts at 4/3 of a beat (a triplet's 2:1); shuffle at 2/3.
    close(ungroove(128, 96, 1), 96);
    close(ungroove(64, 96, -1), 96);
    const swung = { ...p, groove: 1 };
    expect(panPattern(swung)!.breaks).toEqual([128]);
    close(at(swung, 64), 0);
    close(at(swung, 128 + 32), 0);
  });

  it("holds between custom events where a cycle starts, the centre with none", () => {
    let song = withPanMan({ mode: "rhythmShape", rhythm: "1/2", direction: "down", smoothing: 0 });
    expect(editorEvents(pm(song))).toEqual([{ tick: 0, length: 192 }, { tick: 192, length: 192 }]);
    song = editShapeEvents(song, FX, () => [{ tick: 96, length: 96 }]);
    expect(at(pm(song), 0)).toBe(1);
    close(at(pm(song), 144), 0);
    song = editShapeEvents(song, FX, () => []);
    expect(at(pm(song), 10)).toBe(0);
  });

  it("edits events: added up to the next, resized between neighbours", () => {
    const events = [{ tick: 0, length: 96 }, { tick: 192, length: 96 }];
    expect(addShapeEvent(events, 120, 200)).toEqual([...events.slice(0, 1), { tick: 120, length: 72 }, events[1]]);
    expect(addShapeEvent(events, 50, 10)).toBe(events);
    expect(setShapeEvent(events, 1, 50, 500, BAR)).toEqual([events[0], { tick: 96, length: 288 }]);
    expect(setShapeEvent(events, 0, 0, 96, BAR)).toBe(events);
  });

  it("sends the engine its pattern as lines within a 500th of the width", () => {
    for (const patch of [{}, { mode: "rhythmStep" as const, smoothing: 0.4, steps: 5 }, { mode: "rhythmShape" as const, groove: 0.6, smoothing: 0.3, direction: "down" as const }, { rate: 3, smoothing: 0 }]) {
      const p = { ...DEFAULT_PANMAN, ...patch };
      const pattern = panPattern(p)!;
      const engine = enginePanMan(p, FX);
      expect(engine.beats).toBe(pattern.length / BEAT);
      const ticks = engine.shape!.at.map((a) => a * pattern.length);
      const { values } = engine.shape!;
      for (let t = 0; t < pattern.length; t += pattern.length / 997) {
        let i = 0;
        while (i + 1 < ticks.length && ticks[i + 1] <= t) i++;
        const f = ticks[i + 1] > ticks[i] ? (t - ticks[i]) / (ticks[i + 1] - ticks[i]) : 0;
        const line = values[i] + (values[Math.min(i + 1, values.length - 1)] - values[i]) * f;
        expect(Math.abs(line - pattern.value(t))).toBeLessThan(2.5e-3);
      }
    }
    // Random and the trigger modes are the engine's: no pattern; their chance is the effect's own.
    const random = enginePanMan({ ...DEFAULT_PANMAN, mode: "random", rhythm: "1/8" }, FX);
    expect(random).toMatchObject({ shape: null, stepBeats: 0.5, dynamics: false });
    expect(random.seed).toBe(panSeed(FX));
    expect(panSeed("fx_other")).not.toBe(panSeed(FX));
  });
});

describe("PanMan's sound", () => {
  it("places the position around the offset over the width, never past 105°", () => {
    expect(panDegrees(0, 180, -1)).toBe(-90);
    expect(panDegrees(90, 180, 1)).toBe(105);
    expect(panDegrees(-30, 60, 0.5)).toBe(-15);
  });

  it("pans with constant power, the centre at unity, past 90° a little inverted in the far side", () => {
    close(panGains(0)[0], 1);
    close(panGains(0)[1], 1);
    close(panGains(-90)[0], Math.SQRT2);
    close(panGains(-90)[1], 0);
    for (const d of [-105, -60, 10, 77, 105]) close(panGains(d)[0] ** 2 + panGains(d)[1] ** 2, 2);
    expect(panGains(105)[0]).toBeLessThan(0);
    expect(panGains(105)[0]).toBeGreaterThan(-0.4);
  });

  it("compiles its settings for the engine, and its automated controls as lanes in their own units", () => {
    let song = withPanMan({ width: 120 });
    const [effect] = compileSong(song, P).tracks.find((t) => t.id === "insert_1")!.effects;
    expect(effect.panMan).toMatchObject({ mode: "lfo", width: 120, beats: 1, dynamics: true });
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: BAR * 2 }]).clips);
    const made = createAutomation(song, { kind: "panMan", effect: FX, control: "offset" }, { start: 0, length: BAR }, { id: "auto_offset" });
    song = editPoints(made.song, "auto_offset", () => [
      { tick: 0, value: 0, tension: 0, curve: "single" },
      { tick: BAR, value: 1, tension: 0, curve: "single" },
    ]);
    const compiled = compileSong(song, P, null, "song");
    const lane = compiled.lanes.find((l) => l.target.kind === "panman")!;
    expect(lane.target).toEqual({ kind: "panman", track: compiled.tracks.findIndex((t) => t.id === "insert_1"), effect: 0, control: "offset" });
    // As fractions of 105°.
    expect(lane.values[0]).toBe(-1);
    expect(lane.values.at(-1)).toBeCloseTo(1, 5);
  });

  it("automates every knob: the engine's own as lanes, Smoothing, Feel and Groove as its pattern sent whole", () => {
    let song = withPanMan({ mode: "rhythmStep" });
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: BAR * 2 }]).clips);
    const automate = (s: typeof song, control: PanControl) => {
      const made = createAutomation(s, { kind: "panMan", effect: FX, control }, { start: 0, length: BAR });
      return editPoints(made.song, made.automationId, () => [
        { tick: 0, value: 0, tension: 0, curve: "single" },
        { tick: BAR, value: 1, tension: 0, curve: "single" },
      ]);
    };
    song = automate(automate(song, "cutoff"), "feel");
    const lanes = compileSong(song, P, null, "song").lanes.filter((l) => l.target.kind === "panman");
    expect(lanes.map((l) => (l.target.kind === "panman" ? l.target.control : "")).sort()).toEqual(["cutoff", "shape"]);
    // The cutoff in kHz, 100 Hz to 15 kHz.
    const cutoff = lanes.find((l) => l.target.kind === "panman" && l.target.control === "cutoff")!;
    expect(cutoff.values[0]).toBeCloseTo(0.1, 6);
    expect(cutoff.values.at(-1)).toBeCloseTo(15, 3);
    // The pattern, evenly sampled, Feel moving it from rushed to dragged.
    const shape = lanes.find((l) => l.target.kind === "panman" && l.target.control === "shape")!;
    expect(shape.values.length % PAN_SHAPE_POINTS).toBe(0);
    const felt = (feel: number) => ({ ...pm(withPanMan({ mode: "rhythmStep" })), feel });
    const rounded = (values: number[]) => values.map((v) => Math.round(v * 1000) / 1000);
    expect(rounded(shape.values.slice(0, PAN_SHAPE_POINTS))).toEqual(rounded(panShape(felt(-1))));
    expect(rounded(shape.values.slice(-PAN_SHAPE_POINTS))).toEqual(rounded(panShape(felt(1))));
    expect(rounded(panShape(felt(-1)))).not.toEqual(rounded(panShape(felt(1))));
    // The trigger modes have no pattern: Feel moves nothing there.
    expect(compileSong(automate(withPanMan({ mode: "pingPong" }), "feel"), P, null, "song").lanes).toEqual([]);
  });

  it("names its controls for automation clips, the rate along a log scale", () => {
    const song = withPanMan({ rate: 1 });
    const rate = controlOf(song, { kind: "panMan", effect: FX, control: "rate" });
    expect(rate).toMatchObject({ name: "Rate", owner: "PanMan (Insert 1)", exists: true });
    close(rate.toControl(rate.own!), 1);
    close(panControlValue("rate", 0.5), Math.sqrt(0.01 * 10));
    close(panControlFraction("offset", 0), 0.5);
    expect(controlOf(song, { kind: "panMan", effect: FX, control: "offset" }).format(0.25)).toBe("53° L");
    expect(controlOf(song, { kind: "panMan", effect: "fx_gone", control: "width" }).exists).toBe(false);
  });
});
