import { describe, expect, it } from "vitest";
import { RESERVED_EFFECT_UNIFORMS, effectFragmentSource, effectPasses } from "./effect-gl.ts";
import {
  type ClipKind,
  EFFECTS,
  EFFECT_TAGS,
  MOTION,
  OPACITY,
  VIDEO_EFFECTS,
  VOLUME,
  addEffect,
  defaultEffects,
  findEffect,
  motionAt,
  moveEffect,
  normalizeEffects,
  opacityAt,
  removeEffect,
  copyEffects,
  pasteEffects,
  textEffects,
  resetParams,
  setEffectEnabled,
  setParams,
  valuesAt,
  videoEffects,
  volumeAt,
} from "./effects.ts";
import { easedProgress, keyframeValue } from "./keyframes.ts";
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

  it("show Motion and Opacity for pictures, Volume for sound, Text and Appearance for text, Solid for solids", () => {
    const shown = (visual: boolean, audible: boolean, kind: ClipKind = "media") =>
      EFFECTS.filter((d) => !d.shader && d.appliesTo({ visual, audible, kind })).map((d) => d.type);
    expect(shown(true, true)).toEqual(["motion", "opacity", "volume"]);
    expect(shown(true, false)).toEqual(["motion", "opacity"]);
    expect(shown(false, true)).toEqual(["volume"]);
    expect(shown(true, false, "text")).toEqual(["motion", "opacity", "text", "appearance"]);
    expect(shown(true, false, "solid")).toEqual(["motion", "opacity", "solid"]);
    expect(shown(true, false, "adjustment")).toEqual(["motion", "opacity"]);
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

  it("interpolate linearly, eased where a keyframe eases, or not at all", () => {
    // 1 -> 3 arrives at an eased keyframe: ahead of linear (50) halfway, slowing down.
    expect(keyframeValue(keys, 2)).toBeCloseTo(62.5);
    // 3 -> 5 leaves it slowly: behind linear (50) halfway.
    expect(keyframeValue(keys, 3.5)).toBeGreaterThan(75);
    expect(keyframeValue(keys, 4)).toBeCloseTo(62.5);
    expect(keyframeValue(keys, 6.9)).toBe(0); // held until the next keyframe
    expect(keyframeValue(keys, 7)).toBe(50);
  });

  it("ease like Premiere's Bezier with 33% influence", () => {
    // Both sides eased: smoothstep. One side: zero speed there, linear speed at the other end.
    expect(easedProgress(0.5, true, true)).toBeCloseTo(0.5);
    expect(easedProgress(0.25, true, true)).toBeCloseTo(0.15625);
    expect(easedProgress(0.5, false, false)).toBeCloseTo(0.5);
    expect(easedProgress(0.1, false, false)).toBeCloseTo(0.1);
    const d = 1e-4;
    expect(easedProgress(d, true, false) / d).toBeLessThan(0.01); // leaves slowly
    expect((1 - easedProgress(1 - d, true, false)) / d).toBeCloseTo(1, 2); // arrives at full speed
    expect((1 - easedProgress(1 - d, false, true)) / d).toBeLessThan(0.01); // arrives slowly
  });

  it("reach further with a higher influence, hanging near the keyframes and snapping across", () => {
    // Both sides eased at 33% is the plain smoothstep; at 90% it's flatter at the ends and steeper in the middle.
    const snappy = (f: number) => easedProgress(f, true, true, 0.9, 0.9);
    expect(snappy(0.5)).toBeCloseTo(0.5);
    expect(snappy(0.15)).toBeLessThan(easedProgress(0.15, true, true));
    expect(snappy(0.85)).toBeGreaterThan(easedProgress(0.85, true, true));
    expect(snappy(0.55) - snappy(0.45)).toBeGreaterThan(easedProgress(0.55, true, true) - easedProgress(0.45, true, true));
    // It always rises, and at 100% (both handles all the way across) too.
    for (const influence of [0.01, 0.5, 0.9, 1]) {
      let last = 0;
      for (let f = 0; f <= 1.0001; f += 0.01) {
        const v = easedProgress(f, true, true, influence, influence);
        expect(v).toBeGreaterThanOrEqual(last - 1e-9);
        last = v;
      }
      expect(easedProgress(1, true, true, influence, influence)).toBeCloseTo(1);
    }
    // A linear side ignores it.
    expect(easedProgress(0.3, false, false, 0.9, 0.9)).toBeCloseTo(0.3);
    const keys: Keyframe[] = [
      { time: 0, value: 0, easing: "ease", influence: 0.9 },
      { time: 1, value: 10, easing: "ease", influence: 0.9 },
    ];
    expect(keyframeValue(keys, 0.2)).toBeCloseTo(10 * snappy(0.2));
  });

  it("keep a valid influence from storage, and drop the default", () => {
    const [a, b, c] = normalizeEffects([
      {
        type: "motion",
        keyframes: {
          rotation: [
            { time: 0, value: 0, easing: "ease", influence: 0.9 },
            { time: 1, value: 1, easing: "ease", influence: 1 / 3 },
            { time: 2, value: 2, easing: "ease", influence: 7 },
          ],
        },
      },
    ])[0].keyframes!.rotation;
    expect([a.influence, b.influence, c.influence]).toEqual([0.9, undefined, 1]);
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
    expect(valuesAt(OPACITY, undefined, 0)).toEqual({ opacity: 1, blendMode: "normal" });
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
    // At a time (Premiere): an animated value gets a keyframe of its default there instead.
    const keyed = resetParams(p, "c", "motion", ["rotation", "scale"], 2);
    expect(motionOf(keyed).keyframes!.rotation.map((k) => [k.time, k.value])).toEqual([[0, 5], [2, 0]]);
    expect(motionOf(keyed).params.scale).toBe(1);
  });

  it("keep linked values in step with what's showing at the edit's time", () => {
    const [motion, ...rest] = defaultEffects();
    const keys: Keyframe[] = [{ time: 0, value: 1, easing: "linear" }, { time: 2, value: 3, easing: "linear" }];
    const p = projectWith(clipWith([{ ...motion, keyframes: { scale: keys } }, ...rest]));
    // Turning uniform scale off at 1 s starts the width from the scale showing then (2), not the static 1.
    expect(motionOf(setParams(p, "c", "motion", { uniformScale: false }, 1)).params.scaleWidth).toBe(2);
  });

  it("keep MOTION/OPACITY/VOLUME ids stable", () => {
    expect([MOTION.type, OPACITY.type, VOLUME.type]).toEqual(["motion", "opacity", "volume"]);
  });
});

describe("video effects", () => {
  const withEffect = (p: Project, type: string) => addEffect(p, ["c"], type).project;

  it("are shaders with uniform-able parameters, not named like the prelude's, in a known category", () => {
    expect(VIDEO_EFFECTS.length).toBeGreaterThan(0);
    for (const def of VIDEO_EFFECTS) {
      expect(def.shader?.tags.length, def.type).toBeGreaterThan(0);
      expect(def.shader!.tags.every((t) => EFFECT_TAGS.includes(t)), def.type).toBe(true);
      expect(def.builtIn).toBe(false);
      for (const p of def.params) {
        expect(["number", "boolean", "choice", "vec2", "color"], `${def.type}.${p.key}`).toContain(p.kind);
        expect(RESERVED_EFFECT_UNIFORMS, `${def.type}.${p.key}`).not.toContain(p.key);
      }
      expect(effectFragmentSource({ params: def.params, glsl: def.shader!.glsl })).toContain("vec4 effect(vec2 uv)");
    }
  });

  it("are added at the end with their defaults and unique ids, only to clips on video tracks", () => {
    let p = projectWith(clipWith());
    const { project, added } = addEffect(p, ["c"], "gaussian-blur");
    expect(added.get("c")).toBe("gaussian-blur");
    p = withEffect(project, "gaussian-blur");
    expect(videoEffects(p.clips[0]).map((e) => e.id)).toEqual(["gaussian-blur", "gaussian-blur_2"]);
    expect(p.clips[0].effects.at(-1)!.params.blurriness).toBe(0.02);
    // Not an effect you add, or not a clip that shows.
    expect(addEffect(p, ["c"], "motion").project).toBe(p);
    const audio = { ...p, tracks: p.tracks.map((t) => ({ ...t, kind: "audio" as const })) };
    expect(addEffect(audio, ["c"], "sepia").project).toBe(audio);
  });

  it("are removed and moved among themselves, never the built-in ones", () => {
    let p = withEffect(withEffect(projectWith(clipWith()), "sepia"), "mosaic");
    const order = (q: Project) => q.clips[0].effects.map((e) => e.id);
    expect(order(p)).toEqual(["motion", "opacity", "volume", "sepia", "mosaic"]);
    p = moveEffect(p, "c", "mosaic", -1);
    expect(order(p)).toEqual(["motion", "opacity", "volume", "mosaic", "sepia"]);
    expect(moveEffect(p, "c", "mosaic", -1)).toBe(p);
    expect(removeEffect(p, "c", "motion")).toBe(p);
    expect(order(removeEffect(p, "c", "mosaic"))).toEqual(["motion", "opacity", "volume", "sepia"]);
  });

  it("survive normalising, in order, with their values and keyframes", () => {
    const p = withEffect(withEffect(projectWith(clipWith()), "vignette"), "vignette");
    const effects = setParams(p, "c", "vignette_2", { amount: 0.25 }).clips[0].effects;
    const again = normalizeEffects(JSON.parse(JSON.stringify(effects)));
    expect(again).toEqual(effects);
  });

  it("draw in order while on, with their values at the moment", () => {
    let p = withEffect(withEffect(projectWith(clipWith()), "sepia"), "black-white");
    p = setEffectEnabled(p, "c", "sepia", false);
    const passes = effectPasses(p.clips[0], 1.5);
    expect(passes.map((x) => x.shader.key)).toEqual(["fx:black-white"]);
    expect(passes[0].uniforms).toContainEqual({ name: "amount", type: "float", value: 1 });
    expect(passes[0].uniforms).toContainEqual({ name: "time", type: "float", value: 1.5 });
  });
});

describe("copy / paste effects", () => {
  const kf = (time: number, value: number): Keyframe => ({ time, value, easing: "linear" });
  const two = (from: Clip, to: Clip): Project => ({ ...createDefaultProject(), clips: [from, to] });

  it("pastes values and keyframes, at the same distance from the clip's start", () => {
    const from = clipWith(defaultEffects().map((e) =>
      e.type === "opacity" ? { ...e, params: { opacity: 40 } } : e.type === "motion" ? { ...e, keyframes: { rotation: [kf(10, 0), kf(12, 90)] } } : e,
    ));
    const source = { ...from, in: 10, out: 15 };
    const target: Clip = { ...clipWith(), id: "d", start: 20, in: 3, out: 8 };
    const p = pasteEffects(two(source, target), ["d"], copyEffects(source));
    const pasted = p.clips[1];
    expect(findEffect(pasted, "opacity")!.params.opacity).toBe(40);
    expect(findEffect(pasted, "motion")!.keyframes!.rotation.map((k) => k.time)).toEqual([3, 5]);
    // Pasting the same again changes nothing.
    expect(pasteEffects(p, ["d"], copyEffects(source))).toBe(p);
  });

  it("pastes only the chosen effects, and only ones the clip has", () => {
    const text: Clip = { id: "t", assetId: "", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 2, effects: [...defaultEffects(), ...textEffects({ text: "Hi", size: 200 })] };
    const video: Clip = { ...clipWith(defaultEffects().map((e) => (e.type === "opacity" ? { ...e, params: { opacity: 10 } } : e))), id: "v" };
    let p = two(text, video);
    p = pasteEffects(p, ["t"], copyEffects(video), ["opacity"]);
    expect(findEffect(p.clips[0], "opacity")!.params.opacity).toBe(10);
    // A video has no Text to take.
    const q = pasteEffects(p, ["v"], copyEffects(p.clips[0]), ["text"]);
    expect(q).toBe(p);
  });

  it("keeps a text's words, pasting only its look", () => {
    const a: Clip = { id: "a", assetId: "", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 2, effects: [...defaultEffects(), ...textEffects({ text: "First", size: 300 })] };
    const b: Clip = { ...a, id: "b", start: 3, effects: [...defaultEffects(), ...textEffects({ text: "Second", size: 80 })] };
    const p = pasteEffects(two(a, b), ["b"], copyEffects(a));
    expect(findEffect(p.clips[1], "text")!.params).toMatchObject({ text: "Second", size: 300 });
  });

  it("adds the video effects a clip doesn't have, after its own, once", () => {
    let p = two({ ...clipWith(), in: 10, out: 15 }, { ...clipWith(), id: "d", start: 20, in: 3, out: 8 });
    p = addEffect(p, ["c"], "sepia").project;
    p = addEffect(p, ["c"], "mosaic").project;
    p = setParams(p, "c", "mosaic", { blockSize: 0.1 });
    p = { ...p, clips: p.clips.map((c) => (c.id === "c" ? { ...c, effects: c.effects.map((e) => (e.id === "sepia" ? { ...e, keyframes: { amount: [kf(11, 0), kf(12, 1)] } } : e)) } : c)) };
    p = addEffect(p, ["d"], "vignette").project;
    const pasted = pasteEffects(p, ["d"], copyEffects(p.clips[0]));
    const target = pasted.clips[1];
    expect(videoEffects(target).map((e) => e.id)).toEqual(["vignette", "sepia", "mosaic"]);
    expect(findEffect(target, "mosaic")!.params.blockSize).toBe(0.1);
    expect(findEffect(target, "sepia")!.keyframes!.amount.map((k) => k.time)).toEqual([4, 5]);
    expect(pasteEffects(pasted, ["d"], copyEffects(p.clips[0]))).toBe(pasted);
    // Just one of them; and none on a clip that isn't on a video track.
    expect(videoEffects(pasteEffects(p, ["d"], copyEffects(p.clips[0]), ["mosaic"]).clips[1]).map((e) => e.id)).toEqual(["vignette", "mosaic"]);
    const audio = { ...p, tracks: p.tracks.map((t) => ({ ...t, kind: "audio" as const })) };
    expect(videoEffects(pasteEffects(audio, ["d"], copyEffects(p.clips[0])).clips[1]).map((e) => e.id)).toEqual(["vignette"]);
  });
});
