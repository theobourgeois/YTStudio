import { describe, expect, it } from "vitest";
import { findEffect, isVideoEffect, motionAt } from "./effects.ts";
import { PRESETS, PRESET_TAGS, addPresetLayer, applyPresetToClips, presetClip, presetDefinition, presetProblems } from "./presets.ts";
import { MAIN_TRACK_ID, clipEnd, createDefaultProject, getClip } from "./timeline.ts";
import type { Clip, Project } from "./types.ts";
import { defaultEffects } from "./effects.ts";

const clip = (id: string, start: number, duration: number): Clip => ({
  id, assetId: "a", trackId: MAIN_TRACK_ID, start, in: 10, out: 10 + duration, effects: defaultEffects(),
});
const project = (...clips: Clip[]): Project => ({ ...createDefaultProject(), clips });

describe("preset library", () => {
  it("has unique types, known tags, and only effects and values that exist", () => {
    expect(new Set(PRESETS.map((p) => p.type)).size).toBe(PRESETS.length);
    for (const def of PRESETS) {
      expect(def.tags.length, def.type).toBeGreaterThan(0);
      expect(def.tags.every((t) => PRESET_TAGS.includes(t)), def.type).toBe(true);
      expect(presetProblems(def)).toEqual([]);
      expect(def.duration).toBeGreaterThan(0);
    }
  });

  it("transitions start and end on the picture they're given (every animated value back at rest)", () => {
    // Whole turns, and whole canvases away over a tiled picture, look the same.
    const wrap = (v: number, period: number) => Math.round((((v % period) + period) % period) * 1e6) / 1e6;
    for (const def of PRESETS.filter((p) => p.kind === "transition")) {
      const layer = presetClip(def);
      for (const t of [0, def.duration]) {
        const motion = motionAt(layer, t);
        const [x, y] = motion.position;
        expect([motion.scaleX, wrap(motion.rotation, 360), wrap(x - 0.5, 1), wrap(y - 0.5, 1)], `${def.type} at ${t}`).toEqual([1, 0, 0, 0]);
      }
    }
  });
});

describe("applying presets", () => {
  it("centres a transition's adjustment layer on the cut, above the clips", () => {
    const p = project(clip("a", 0, 2), clip("b", 2, 2));
    const { project: out, clipId } = addPresetLayer(p, "spin", 2);
    const layer = getClip(out, clipId!)!;
    const def = presetDefinition("spin")!;
    expect(layer).toMatchObject({ adjustment: true, start: 2 - def.duration / 2, in: 0 });
    expect(clipEnd(layer)).toBeCloseTo(2 + def.duration / 2);
    // A new track on top: the main track is taken there.
    expect(out.tracks[0].id).toBe(layer.trackId);
    // Upside down at the cut.
    expect(motionAt(layer, def.duration / 2).rotation).toBeCloseTo(180, 0);
    expect(findEffect(layer, "motion")!.params).toMatchObject({ motionBlur: true, edges: "mirror" });
  });

  it("jumps at the cut for a move through it: the frame before arrives, the cut's frame has jumped", () => {
    const { project: out, clipId } = addPresetLayer(project(clip("a", 0, 2), clip("b", 2, 2)), "zoom-through", 2);
    const layer = getClip(out, clipId!)!;
    const cut = 0.3;
    expect(motionAt(layer, cut - 1 / 30).scaleX).toBeGreaterThan(1.8);
    expect(motionAt(layer, cut).scaleX).toBeCloseTo(0.45);
  });

  it("starts a transition at the timeline's start, keeping its cut in the middle of the move", () => {
    const { project: out, clipId } = addPresetLayer(createDefaultProject(), "spin", 0.1);
    const layer = getClip(out, clipId!)!;
    expect(layer.start).toBe(0);
    expect(clipEnd(layer)).toBeCloseTo(0.45);
    // 0.1 s in is the cut: halfway through the turn.
    expect(motionAt(layer, 0.1).rotation).toBeCloseTo(180, 0);
  });

  it("puts effect presets on clips: entrances from the start, exits at the end, slow moves over the whole clip", () => {
    const p = project(clip("a", 1, 4));
    const entrance = getClip(applyPresetToClips(p, ["a"], "zoom-in-entrance"), "a")!;
    const scale = findEffect(entrance, "motion")!.keyframes!.scale;
    // Source time: the clip plays 10..14 from 1 s.
    expect(scale.map((k) => k.time)).toEqual([10, 10.5]);
    const exit = findEffect(getClip(applyPresetToClips(p, ["a"], "zoom-out-exit"), "a")!, "motion")!.keyframes!.scale;
    expect(exit.map((k) => k.time)).toEqual([13.5, 14]);
    const push = findEffect(getClip(applyPresetToClips(p, ["a"], "slow-push"), "a")!, "motion")!.keyframes!.scale;
    expect(push.map((k) => k.time)).toEqual([10, 14]);
    const looked = getClip(applyPresetToClips(p, ["a"], "vhs-look"), "a")!;
    expect(looked.effects.filter(isVideoEffect).map((e) => e.type)).toEqual(["vhs", "film-grain", "vignette"]);
    expect(applyPresetToClips(p, ["a"], "nope")).toBe(p);
  });
});
