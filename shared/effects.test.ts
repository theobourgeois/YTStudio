import { describe, expect, it } from "vitest";
import {
  EFFECTS,
  MOTION,
  OPACITY,
  VOLUME,
  defaultEffects,
  findEffect,
  motionAt,
  normalizeEffects,
  opacityAt,
  resetParams,
  setEffectEnabled,
  setParams,
  valuesAt,
  volumeAt,
} from "./effects.ts";
import { keyframeValue } from "./keyframes.ts";
import { createDefaultProject, MAIN_TRACK_ID } from "./timeline.ts";
import type { Clip, Effect, Keyframe, Project } from "./types.ts";

const clipWith = (effects: Effect[] = defaultEffects()): Clip => ({
  id: "c", assetId: "a", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 5, effects,
});
const projectWith = (clip: Clip): Project => ({ ...createDefaultProject(), clips: [clip] });
const motionOf = (p: Project) => findEffect(p.clips[0], "motion")!;

describe("effect definitions", () => {
  it("have unique types and parameter keys, and defaults inside their range", () => {
    expect(new Set(EFFECTS.map((d) => d.type)).size).toBe(EFFECTS.length);
    for (const def of EFFECTS) {
      expect(new Set(def.params.map((p) => p.key)).size).toBe(def.params.length);
      for (const p of def.params) {
        if (p.kind === "number") expect(p.default).toBeGreaterThanOrEqual(p.min);
        if (p.kind === "number") expect(p.default).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it("give a new clip every built-in effect at identity", () => {
    const clip = clipWith();
    expect(clip.effects.map((e) => e.id)).toEqual(["motion", "opacity", "volume"]);
    expect(motionAt(clip, 0)).toEqual({
      fit: "contain", position: [0.5, 0.5], scaleX: 1, scaleY: 1, rotation: 0, anchor: [0.5, 0.5],
    });
    expect(opacityAt(clip, 0)).toBe(1);
    expect(volumeAt(clip, 0)).toBe(1);
  });

  it("show Motion and Opacity for pictures, Volume for sound, Text and Appearance for text", () => {
    const shown = (visual: boolean, audible: boolean, text = false) =>
      EFFECTS.filter((d) => d.appliesTo({ visual, audible, text })).map((d) => d.type);
    expect(shown(true, true)).toEqual(["motion", "opacity", "volume"]);
    expect(shown(true, false)).toEqual(["motion", "opacity"]);
    expect(shown(false, true)).toEqual(["volume"]);
    expect(shown(true, false, true)).toEqual(["motion", "opacity", "text", "appearance"]);
  });
});

describe("normalizeEffects", () => {
  it("upgrades clips saved before effects existed", () => {
    const effects = normalizeEffects(undefined, { volume: 0.25, fit: "cover" });
    expect(findEffect(clipWith(effects), "volume")!.params).toEqual({ level: 0.25 });
    expect(motionAt(clipWith(effects), 0).fit).toBe("cover");
    // Garbage legacy values fall back to defaults.
    expect(normalizeEffects(undefined, { volume: "loud", fit: "zoom" })).toEqual(defaultEffects());
  });

  it("keeps each built-in once and first, drops unknown effects and repairs values", () => {
    const effects = normalizeEffects([
      { id: "x", type: "sparkles", enabled: true, params: {} },
      { id: "volume", type: "volume", enabled: false, params: { level: 7 } },
      { id: "motion", type: "motion", enabled: true, params: { scale: -2, rotation: "90", position: [0.1, 0.2], anchor: [1] } },
      { id: "motion2", type: "motion", enabled: true, params: { scale: 3 } },
      null,
    ]);
    expect(effects.map((e) => e.id)).toEqual(["motion", "opacity", "volume"]);
    const [motion, , volume] = effects;
    expect(motion.params).toMatchObject({ scale: 0, rotation: 0, position: [0.1, 0.2], anchor: [0.5, 0.5] });
    expect(volume).toEqual({ id: "volume", type: "volume", enabled: false, params: { level: 1 } });
  });

  it("sorts keyframes, drops invalid ones and never animates switches", () => {
    const [motion] = normalizeEffects([
      {
        type: "motion",
        params: {},
        keyframes: {
          rotation: [
            { time: 2, value: 90, easing: "ease" },
            { time: 1, value: 0, easing: "bogus" },
            { time: "3", value: 180 },
            { time: 4, value: "x" },
          ],
          uniformScale: [{ time: 0, value: false, easing: "hold" }],
          nope: [{ time: 0, value: 1, easing: "linear" }],
        },
      },
    ]);
    expect(motion.keyframes).toEqual({
      rotation: [
        { time: 1, value: 0, easing: "linear" },
        { time: 2, value: 90, easing: "ease" },
      ],
    });
  });
});

describe("keyframes", () => {
  const keys: Keyframe[] = [
    { time: 1, value: 0, easing: "linear" },
    { time: 3, value: 100, easing: "ease" },
    { time: 5, value: 0, easing: "hold" },
    { time: 7, value: 50, easing: "linear" },
  ];

  it("hold the first and last values outside their range", () => {
    expect(keyframeValue(keys, 0)).toBe(0);
    expect(keyframeValue(keys, 9)).toBe(50);
  });

  it("interpolate linearly, with easing, or not at all", () => {
    expect(keyframeValue(keys, 2)).toBe(50);
    expect(keyframeValue(keys, 3.5)).toBeGreaterThan(75); // eased: fast in the middle...
    expect(keyframeValue(keys, 3.5)).toBeLessThan(100);
    expect(keyframeValue(keys, 4)).toBe(50);
    expect(keyframeValue(keys, 6.9)).toBe(0); // held until the next keyframe
    expect(keyframeValue(keys, 7)).toBe(50);
  });

  it("interpolate points component-wise", () => {
    const points: Keyframe[] = [
      { time: 0, value: [0, 1], easing: "linear" },
      { time: 2, value: [1, 0], easing: "linear" },
    ];
    expect(keyframeValue(points, 0.5)).toEqual([0.25, 0.75]);
  });

  it("win over the static value, in source time", () => {
    const [motion, ...rest] = defaultEffects();
    const clip = clipWith([{ ...motion, keyframes: { rotation: [{ time: 10, value: 0, easing: "linear" }, { time: 12, value: 90, easing: "linear" }] } }, ...rest]);
    expect(motionAt(clip, 11).rotation).toBe(45);
  });
});

describe("evaluation", () => {
  it("uses defaults while an effect is off", () => {
    const p = setEffectEnabled(setParams(projectWith(clipWith()), "c", "opacity", { opacity: 0.2 }), "c", "opacity", false);
    expect(opacityAt(p.clips[0], 0)).toBe(1);
    expect(valuesAt(OPACITY, undefined, 0)).toEqual({ opacity: 1 });
  });

  it("stretches only when uniform scale is off", () => {
    const p = setParams(projectWith(clipWith()), "c", "motion", { scale: 2 });
    expect(motionAt(p.clips[0], 0)).toMatchObject({ scaleX: 2, scaleY: 2 });
    // The width followed the scale, so turning uniform scale off doesn't change the size...
    const q = setParams(p, "c", "motion", { uniformScale: false });
    expect(motionAt(q.clips[0], 0)).toMatchObject({ scaleX: 2, scaleY: 2 });
    // ...until the axes are set apart.
    const r = setParams(q, "c", "motion", { scaleWidth: 0.5 });
    expect(motionAt(r.clips[0], 0)).toMatchObject({ scaleX: 0.5, scaleY: 2 });
    // Back to uniform: the width snaps to the height.
    const s = setParams(r, "c", "motion", { uniformScale: true });
    expect(motionAt(s.clips[0], 0)).toMatchObject({ scaleX: 2, scaleY: 2 });
    expect(findEffect(s.clips[0], "motion")!.params.scaleWidth).toBe(2);
  });
});

describe("edits", () => {
  it("set valid values, clamped, and ignore the rest", () => {
    const p = setParams(projectWith(clipWith()), "c", "motion", {
      scale: 1000, rotation: 45, fit: "stretch", nope: 1, position: [0.2, 0.3],
    });
    expect(motionOf(p).params).toMatchObject({ scale: 100, rotation: 45, fit: "contain", position: [0.2, 0.3] });
    const v = setParams(p, "c", "volume", { level: -1 });
    expect(volumeAt(v.clips[0], 0)).toBe(0);
  });

  it("return the same project when nothing changes", () => {
    const p = projectWith(clipWith());
    expect(setParams(p, "c", "motion", { scale: 1, position: [0.5, 0.5] })).toBe(p);
    expect(setParams(p, "other", "motion", { scale: 2 })).toBe(p);
    expect(setParams(p, "c", "missing", { scale: 2 })).toBe(p);
    expect(setEffectEnabled(p, "c", "motion", true)).toBe(p);
    expect(resetParams(p, "c", "motion")).toBe(p);
  });

  it("add or replace a keyframe instead when the parameter is animated", () => {
    const [motion, ...rest] = defaultEffects();
    const keys: Keyframe[] = [{ time: 0, value: 0, easing: "linear" }, { time: 2, value: 90, easing: "ease" }];
    const p = projectWith(clipWith([{ ...motion, keyframes: { rotation: keys } }, ...rest]));
    const added = setParams(p, "c", "motion", { rotation: 30 }, 1);
    expect(motionOf(added).keyframes!.rotation.map((k) => [k.time, k.value])).toEqual([[0, 0], [1, 30], [2, 90]]);
    const replaced = setParams(added, "c", "motion", { rotation: 80 }, 2);
    expect(motionOf(replaced).keyframes!.rotation[2]).toEqual({ time: 2, value: 80, easing: "ease" });
    expect(motionOf(replaced).params.rotation).toBe(0);
    // Without a time, the static value changes (keyframes still win when drawing).
    expect(motionOf(setParams(p, "c", "motion", { rotation: 10 })).params.rotation).toBe(10);
  });

  it("reset some or all parameters, dropping their keyframes", () => {
    let p = setParams(projectWith(clipWith()), "c", "motion", { scale: 2, rotation: 30 });
    const [motion, ...rest] = p.clips[0].effects;
    p = projectWith(clipWith([{ ...motion, keyframes: { rotation: [{ time: 0, value: 5, easing: "linear" }] } }, ...rest]));
    const one = resetParams(p, "c", "motion", ["rotation"]);
    expect(motionOf(one).params).toMatchObject({ scale: 2, rotation: 0 });
    expect(motionOf(one).keyframes).toBeUndefined();
    expect(motionOf(resetParams(p, "c", "motion")).params).toEqual(defaultEffects()[0].params);
  });

  it("keep MOTION/OPACITY/VOLUME ids stable", () => {
    expect([MOTION.type, OPACITY.type, VOLUME.type]).toEqual(["motion", "opacity", "volume"]);
  });
});
