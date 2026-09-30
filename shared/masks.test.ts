import { describe, expect, it } from "vitest";
import { setAnimated } from "./animation.ts";
import { MASK, addEffect, defaultEffects, effectPeers, moveEffect, normalizeEffects, removeEffect, setParams } from "./effects.ts";
import { clipLayer } from "./layers.ts";
import { addMask, maskPresetPath, masksAt, masksChange } from "./masks.ts";
import { normalizeProject } from "./normalize.ts";
import { ellipsePath, polygonPath, rectPath } from "./path.ts";
import { MAIN_TRACK_ID, createDefaultProject } from "./timeline.ts";
import type { Clip, Project } from "./types.ts";

const clip: Clip = { id: "c", assetId: "a", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 5, effects: defaultEffects() };
const project: Project = { ...createDefaultProject(), clips: [clip] };
const only = (p: Project) => p.clips[0];

describe("masks", () => {
  it("are added after the clip's other effects, one id each, and drawn in order", () => {
    const one = addMask(project, "c");
    expect(one.effectId).toBe("mask");
    const two = addMask(one.project, "c", { path: maskPresetPath("ellipse"), mode: "subtract", feather: 54 });
    expect(two.effectId).toBe("mask_2");
    const masks = masksAt(only(two.project), 0);
    expect(masks.map((m) => m.mode)).toEqual([0, 1]);
    expect(masks[0].d).toMatch(/^M0\.1 0\.1/);
    // Feather is px of a 1080-high frame.
    expect(masks[1].feather).toBeCloseTo(0.05);
    expect(masks[1].opacity).toBe(1);
  });

  it("go before the video effects whatever order they were added in, and move among themselves", () => {
    let p = addEffect(project, ["c"], "gaussian-blur").project;
    p = addMask(p, "c").project;
    p = addMask(p, "c").project;
    expect(only(p).effects.map((e) => e.id).slice(-3)).toEqual(["mask", "mask_2", "gaussian-blur"]);
    expect(effectPeers(only(p), "mask")).toEqual(["mask", "mask_2"]);
    const moved = moveEffect(p, "c", "mask", 1);
    expect(only(moved).effects.map((e) => e.id).slice(-3)).toEqual(["mask_2", "mask", "gaussian-blur"]);
    // Already last of its kind: nothing to swap with.
    expect(moveEffect(moved, "c", "mask", 1)).toBe(moved);
    expect(only(removeEffect(moved, "c", "mask")).effects.map((e) => e.id).slice(-2)).toEqual(["mask_2", "gaussian-blur"]);
  });

  it("aren't drawn when off, or when their path has no inside", () => {
    const { project: p } = addMask(project, "c");
    expect(masksAt(only(setParams(p, "c", "mask", { path: polygonPath([[0, 0], [1, 1]], false) })), 0)).toEqual([]);
    const off = { ...only(p), effects: only(p).effects.map((e) => (e.type === MASK.type ? { ...e, enabled: false } : e)) };
    expect(masksAt(off, 0)).toEqual([]);
  });

  it("morph between path keyframes", () => {
    let p = addMask(project, "c", { path: rectPath(0, 0, 0.5, 0.5) }).project;
    p = setAnimated(p, "c", "mask", "path", 0, true);
    p = setParams(p, "c", "mask", { path: rectPath(0.5, 0.5, 0.5, 0.5) }, 2);
    expect(masksAt(only(p), 0)[0].d).toMatch(/^M0 0/);
    expect(masksAt(only(p), 1)[0].d).toMatch(/^M0\.25 0\.25/);
    expect(masksAt(only(p), 2)[0].d).toMatch(/^M0\.5 0\.5/);
    expect(masksChange(only(p), 0, 1)).toBe(true);
    expect(masksChange(only(p), 2, 3)).toBe(false);
  });

  it("travel with the layer the compositor draws", () => {
    const { project: p } = addMask(project, "c", { inverted: true, expansion: -10.8 });
    const layer = clipLayer(only(p), 0, () => [1, 0, 0, 1, 0, 0], { canvas: { width: 1080, height: 1920 }, fps: 30, maxSamples: 1 });
    expect(layer?.masks).toEqual([{ d: expect.any(String), mode: 0, inverted: true, opacity: 1, feather: 0, expansion: -0.01 }]);
    expect(clipLayer(clip, 0, () => [1, 0, 0, 1, 0, 0], { canvas: { width: 1080, height: 1920 }, fps: 30, maxSamples: 1 })?.masks).toBeUndefined();
  });

  it("survive being saved and loaded, with bad paths repaired", () => {
    const { project: p } = addMask(project, "c", { path: ellipsePath(0.5, 0.5, 0.2, 0.3) });
    expect(normalizeProject(JSON.parse(JSON.stringify(p))).clips[0].effects).toEqual(only(p).effects);
    const broken = normalizeEffects([...defaultEffects(), { id: "mask", type: "mask", enabled: true, params: { path: { vertices: "no" }, feather: -5 } }]);
    const mask = broken.find((e) => e.type === "mask")!;
    expect(mask.params.path).toEqual(MASK.params[0].default);
    expect(mask.params.feather).toBe(0);
  });
});
