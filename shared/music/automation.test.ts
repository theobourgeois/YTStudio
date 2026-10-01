import { describe, expect, it } from "vitest";
import {
  addPoint,
  automationValue,
  clipAtTick,
  controlAt,
  controlBreaks,
  controlOf,
  createAutomation,
  curveAt,
  curveValue,
  decimatePoints,
  deletePoint,
  flipPoints,
  isAutomated,
  lfoAt,
  movePoint,
  normalizePointLevels,
  removeAutomations,
  scalePoints,
  smoothPoints,
  automationIndex,
  targetKey,
  updateAutomation,
  updatePoint,
} from "./automation.ts";
import { clipContext, clipLength, makeUnique, updateTrack } from "./playlist.ts";
import { DEFAULT_LFO, createChannel, createMusicProject } from "./project.ts";
import { type Automation, type AutomationPoint, type AutomationTarget, CURVE_TYPES, type MusicProject } from "./types.ts";

const BAR = 384;
const point = (tick: number, value: number, curve: AutomationPoint["curve"] = "single", tension = 0): AutomationPoint => ({ tick, value, tension, curve });
const volume: AutomationTarget = { kind: "channel", channel: "chan_kick", control: "volume" };

function automation(points: AutomationPoint[], extra: Partial<Automation> = {}): Automation {
  return { id: "auto_1", name: "Volume (Kick)", color: null, target: volume, length: BAR * 4, points, min: 0, max: 1, lfo: DEFAULT_LFO, ...extra };
}

function song(automations: Automation[], clips: { ref?: string; start: number; track?: number; length?: number | null; offset?: number; muted?: boolean; id?: number }[]): MusicProject {
  const base = createMusicProject("Song");
  return {
    ...base,
    channels: [createChannel("Kick", null, "chan_kick")],
    automations,
    playlist: {
      tracks: [],
      clips: clips
        .map((c, i) => ({ id: c.id ?? i + 1, kind: "automation" as const, ref: c.ref ?? "auto_1", track: c.track ?? 0, start: c.start, length: c.length ?? null, offset: c.offset ?? 0, muted: c.muted ?? false }))
        .sort((a, b) => a.start - b.start || a.track - b.track || a.id - b.id),
    },
  };
}

describe("curve types", () => {
  it("start where the segment starts and arrive where it ends, every one at any tension", () => {
    for (const curve of CURVE_TYPES) {
      for (const tension of [-1, -0.4, 0, 0.6, 1]) {
        expect(curveAt(curve, tension, 0), `${curve} ${tension}`).toBe(0);
        expect(curveAt(curve, tension, 1), `${curve} ${tension}`).toBe(1);
        for (let x = 0; x < 1; x += 0.01) {
          const y = curveAt(curve, tension, x);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("bend as FL's do: straight at 0, slow then fast above, fast then slow below; S shapes cross the middle halfway", () => {
    expect(curveAt("single", 0, 0.25)).toBeCloseTo(0.25);
    expect(curveAt("single", 0.5, 0.5)).toBeLessThan(0.5);
    expect(curveAt("single", -0.5, 0.5)).toBeGreaterThan(0.5);
    expect(curveAt("double", 0.7, 0.5)).toBeCloseTo(0.5);
    expect(curveAt("double", 0.7, 0.2)).toBeLessThan(0.2);
    expect(curveAt("smooth", 0, 0.5)).toBeCloseTo(0.5);
    expect(curveAt("smooth", 0, 0.1)).toBeLessThan(0.1);
  });

  it("hold, stairs and pulse step; their tension sets how many steps", () => {
    expect(curveAt("hold", 0, 0.999)).toBe(0);
    const levels = (tension: number) => new Set(Array.from({ length: 1000 }, (_, i) => curveAt("stairs", tension, i / 1000))).size;
    expect(levels(0)).toBe(8);
    expect(levels(1)).toBeGreaterThan(levels(0));
    expect(levels(-1)).toBeLessThan(levels(0));
    const pulse = Array.from({ length: 16 }, (_, i) => curveAt("pulse", 0, (i + 0.5) / 16));
    expect(pulse).toEqual([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]);
  });

  it("make a curve's value: points joined, a jump where two share a tick, the last value held past the end", () => {
    const points = [point(0, 0), point(100, 1), point(100, 0.2), point(200, 0.6, "hold")];
    expect(curveValue(points, 50)).toBeCloseTo(0.5);
    expect(curveValue(points, 99.9)).toBeCloseTo(0.999);
    expect(curveValue(points, 100)).toBe(0.2);
    expect(curveValue(points, 199)).toBe(0.2);
    expect(curveValue(points, 200)).toBe(0.6);
    expect(curveValue(points, 5000)).toBe(0.6);
    expect(curveValue([point(0, 0.3)], 80)).toBe(0.3);
  });
});

describe("an automation clip's value", () => {
  it("is squeezed into its Min and Max", () => {
    const clip = automation([point(0, 0), point(BAR, 1)], { min: 0.2, max: 0.6 });
    expect(automationValue(clip, 0, BAR)).toBeCloseTo(0.2);
    expect(automationValue(clip, BAR / 2, BAR)).toBeCloseTo(0.4);
    // Upside down when Max is under Min.
    expect(automationValue({ ...clip, min: 1, max: 0 }, BAR, BAR)).toBeCloseTo(0);
  });

  it("has the LFO added, or multiplied in, at its speed in cycles a bar", () => {
    const lfo = { ...DEFAULT_LFO, enabled: true, speed: 2, level: 0.5 };
    // A triangle from the bottom (-1) to the top (1) and back, twice a bar.
    expect(lfoAt(lfo, 0, BAR)).toBeCloseTo(-1);
    expect(lfoAt(lfo, BAR / 8, BAR)).toBeCloseTo(0);
    expect(lfoAt(lfo, BAR / 4, BAR)).toBeCloseTo(1);
    expect(lfoAt(lfo, BAR / 2, BAR)).toBeCloseTo(-1);
    // Skewed all the way, a saw.
    expect(lfoAt({ ...lfo, skew: 1 }, BAR / 2 - 1, BAR)).toBeGreaterThan(0.95);
    const flat = automation([point(0, 0.5)], { lfo });
    expect(automationValue(flat, BAR / 4, BAR)).toBeCloseTo(0.75);
    expect(automationValue(flat, 0, BAR)).toBeCloseTo(0.25);
    const scaled = automation([point(0, 0.8)], { lfo: { ...lfo, multiply: true, level: 1 } });
    expect(automationValue(scaled, BAR / 4, BAR)).toBeCloseTo(0.8);
    expect(automationValue(scaled, 0, BAR)).toBeCloseTo(0);
    // Off, or at no level, it changes nothing.
    expect(automationValue(automation([point(0, 0.5)], { lfo: { ...lfo, enabled: false } }), 0, BAR)).toBe(0.5);
  });
});

describe("a control over the song", () => {
  const ramp = automation([point(0, 0), point(BAR, 1)], { length: BAR });

  it("is its own value before any clip, the curve inside one, and holds the last value after it", () => {
    const s = song([ramp], [{ start: BAR * 2 }]);
    expect(controlAt(s, volume, 0)).toBeNull();
    expect(controlAt(s, volume, BAR * 2)).toBeCloseTo(0);
    expect(controlAt(s, volume, BAR * 2.5)).toBeCloseTo(0.5);
    expect(controlAt(s, volume, BAR * 3)).toBeCloseTo(1);
    expect(controlAt(s, volume, BAR * 10)).toBeCloseTo(1);
    expect(isAutomated(s, volume)).toBe(true);
    expect(isAutomated(s, { ...volume, control: "pan" })).toBe(false);
  });

  it("is the clip that started latest where clips overlap, then the lower track on the same tick", () => {
    const flat = (id: string, value: number) => automation([point(0, value)], { id, length: BAR * 4 });
    const s = song([flat("auto_a", 0.1), flat("auto_b", 0.2), flat("auto_c", 0.3)], [
      { ref: "auto_a", start: 0, track: 3 },
      { ref: "auto_b", start: BAR, track: 0 },
      { ref: "auto_c", start: BAR, track: 1 },
    ]);
    expect(controlAt(s, volume, BAR / 2)).toBeCloseTo(0.1);
    expect(controlAt(s, volume, BAR * 2)).toBeCloseTo(0.3);
  });

  it("holds the value of the clip that ended latest, and ignores muted clips and clips on muted tracks", () => {
    const s = song([ramp], [{ start: 0, length: BAR / 2 }, { start: BAR * 4, muted: true }]);
    expect(controlAt(s, volume, BAR * 5)).toBeCloseTo(0.5);
    expect(controlAt(updateTrack(s, 0, { muted: true }), volume, BAR * 5)).toBeNull();
  });

  it("starts a clip's curve at its offset", () => {
    const s = song([ramp], [{ start: BAR, offset: BAR / 4 }]);
    expect(controlAt(s, volume, BAR)).toBeCloseTo(0.25);
    expect(clipLength(s.playlist.clips[0], clipContext(s))).toBe(BAR * 0.75);
  });

  it("says where it may jump: clips' edges and their curves' steps", () => {
    const steps = automation([point(0, 0), point(BAR, 1, "stairs", -1)], { length: BAR });
    const s = song([steps], [{ start: BAR }]);
    const placed = automationIndex(s).get(targetKey(volume))!;
    expect(controlBreaks(placed, 0, BAR * 4)).toEqual([BAR, BAR * 1.5, BAR * 2]);
    expect(clipAtTick(placed, BAR * 3)).toMatchObject({ holding: true });
  });

  it("names its control, and turns a fraction into the control's own value", () => {
    const s = song([], []);
    const pan = controlOf(s, { kind: "channel", channel: "chan_kick", control: "pan" });
    expect(pan).toMatchObject({ name: "Pan", owner: "Kick", exists: true, own: 0.5 });
    expect(pan.toControl(0)).toBe(-1);
    expect(pan.format(1)).toBe("100% right");
    expect(controlOf(s, { kind: "mixer", track: "insert_2", control: "volume" })).toMatchObject({ name: "Volume", owner: "Insert 2", own: 0.8 });
    expect(controlOf(s, { kind: "send", track: "insert_2", to: "master" })).toMatchObject({ name: "Send to Master", own: 1 });
    expect(controlOf(s, { kind: "channel", channel: "chan_gone", control: "pan" }).exists).toBe(false);
    expect(controlOf(s, { kind: "plugin", owner: "channel", id: "chan_kick", param: "1", index: 0, name: "Cutoff" }).exists).toBe(false);
  });
});

describe("editing a curve", () => {
  const points = [point(0, 0), point(100, 1, "double", 0.5)];

  it("adds a point between others, shaped as the segment it splits; never before the first", () => {
    const { points: added, index } = addPoint(points, 40, 0.3, 200);
    expect(index).toBe(1);
    expect(added[1]).toEqual({ tick: 40, value: 0.3, tension: 0.5, curve: "double" });
    expect(addPoint(points, -10, 0.3, 200).points[1].tick).toBe(0);
    expect(addPoint(points, 999, 0.3, 200).points[2].tick).toBe(200);
  });

  it("moves a point between its neighbours, the first staying at 0", () => {
    const three = [point(0, 0), point(50, 0.5), point(100, 1)];
    expect(movePoint(three, 1, 500, 2, 200)[1]).toMatchObject({ tick: 100, value: 1 });
    expect(movePoint(three, 0, 30, 0.4, 200)[0]).toMatchObject({ tick: 0, value: 0.4 });
    expect(movePoint(three, 2, 300, 0, 200)[2].tick).toBe(200);
    expect(movePoint(three, 1, 50, 0.5, 200)).toBe(three);
  });

  it("deletes any point but the first, and changes a segment's curve, tension and value", () => {
    expect(deletePoint(points, 0)).toBe(points);
    expect(deletePoint(points, 1)).toEqual([points[0]]);
    expect(updatePoint(points, 1, { curve: "pulse", tension: 3 })[1]).toMatchObject({ curve: "pulse", tension: 1 });
    expect(updatePoint(points, 1, { curve: "double" })).toBe(points);
  });

  it("has FL's tools: flip, scale, normalize, decimate, smooth", () => {
    const wave = [point(0, 0.2), point(10, 0.6), point(20, 0.4), point(30, 0.5)];
    const values = (points: AutomationPoint[]) => points.map((p) => Math.round(p.value * 1000) / 1000);
    expect(values(flipPoints(wave))).toEqual([0.8, 0.4, 0.6, 0.5]);
    expect(values(scalePoints(wave, 2))).toEqual([0, 0.7, 0.3, 0.5]);
    expect(values(normalizePointLevels(wave))).toEqual([0, 1, 0.5, 0.75]);
    expect(decimatePoints(wave).map((p) => p.tick)).toEqual([0, 20, 30]);
    expect(values(smoothPoints(wave))).toEqual([0.2, 0.45, 0.475, 0.5]);
    expect(normalizePointLevels([point(0, 0.5)])).toEqual([point(0, 0.5)]);
  });
});

describe("the song's automation clips", () => {
  it("are made for a control over a stretch of the song, flat at its value, on a track below the rest", () => {
    const base = song([], [{ ref: "nothing", start: 0, track: 2 }]);
    const { song: made, automationId, clipId } = createAutomation(base, { kind: "channel", channel: "chan_kick", control: "pan" }, { start: BAR, length: BAR * 8 }, { id: "auto_new" });
    expect(automationId).toBe("auto_new");
    expect(made.automations[0]).toMatchObject({ name: "Pan (Kick)", length: BAR * 8, points: [point(0, 0.5), point(BAR * 8, 0.5)] });
    expect(made.playlist.clips.find((c) => c.id === clipId)).toMatchObject({ kind: "automation", ref: "auto_new", track: 3, start: BAR, length: null });
    // A control that isn't there can't be automated.
    expect(createAutomation(base, { kind: "channel", channel: "chan_gone", control: "pan" }, { start: 0, length: BAR }).song).toBe(base);
  });

  it("change their name, range, LFO and length, the same song when nothing changes", () => {
    const s = song([automation([point(0, 0), point(BAR, 1), point(BAR * 3, 0)])], []);
    expect(updateAutomation(s, "auto_1", { min: 0 })).toBe(s);
    const changed = updateAutomation(s, "auto_1", { name: "  Fade ", max: 0.5, lfo: { enabled: true, speed: 999 }, length: BAR * 2 });
    expect(changed.automations[0]).toMatchObject({ name: "Fade", max: 0.5, lfo: { enabled: true, speed: 32 }, length: BAR * 2 });
    expect(changed.automations[0].points.map((p) => p.tick)).toEqual([0, BAR]);
  });

  it("go with their clips; Make unique gives a clip a curve of its own", () => {
    const s = song([automation([point(0, 0.5)])], [{ start: 0 }, { start: BAR * 4 }]);
    const unique = makeUnique(s, 2, "auto_copy");
    expect(unique.automations.map((a) => [a.id, a.name])).toEqual([
      ["auto_1", "Volume (Kick)"],
      ["auto_copy", "Volume (Kick) #2"],
    ]);
    expect(unique.playlist.clips.map((c) => c.ref)).toEqual(["auto_1", "auto_copy"]);
    const gone = removeAutomations(unique, new Set(["auto_1"]));
    expect(gone.automations.map((a) => a.id)).toEqual(["auto_copy"]);
    expect(gone.playlist.clips.map((c) => c.ref)).toEqual(["auto_copy"]);
    expect(removeAutomations(gone, new Set(["auto_x"]))).toBe(gone);
  });
});
