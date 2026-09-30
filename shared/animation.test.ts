import { describe, expect, it } from "vitest";
import {
  adjacentKeyframe,
  clipKeyframes,
  deleteKeyframes,
  keyframeTime,
  keyframeTimes,
  moveKeyframes,
  setAnimated,
  setKeyframeEasing,
  setKeyframeInfluence,
  toggleKeyframe,
} from "./animation.ts";
import { defaultEffects, findEffect, motionAt, setParams } from "./effects.ts";
import { MAIN_TRACK_ID, createDefaultProject } from "./timeline.ts";
import type { Clip, Keyframe, Project } from "./types.ts";

// The clip plays source 10..20 from timeline time 2.
const clip = (keyframes?: Record<string, Keyframe[]>): Clip => ({
  id: "c",
  assetId: "a",
  trackId: MAIN_TRACK_ID,
  start: 2,
  in: 10,
  out: 20,
  effects: defaultEffects().map((e) => (e.type === "motion" && keyframes ? { ...e, keyframes } : e)),
});
const project = (c: Clip): Project => ({ ...createDefaultProject(), clips: [c] });
const motion = (p: Project) => findEffect(p.clips[0], "motion")!;
const k = (time: number, value: Keyframe["value"], easing: Keyframe["easing"] = "linear"): Keyframe => ({ time, value, easing });
const times = (p: Project, key: string) => motion(p).keyframes?.[key]?.map((kf) => [kf.time, kf.value]);

describe("the stopwatch", () => {
  it("starts animating from the value showing, and stops keeping the one showing", () => {
    const p = setParams(project(clip()), "c", "motion", { rotation: 30 });
    const on = setAnimated(p, "c", "motion", "rotation", 12, true);
    expect(times(on, "rotation")).toEqual([[12, 30]]);
    expect(setAnimated(on, "c", "motion", "rotation", 13, true)).toBe(on);

    const two = setParams(on, "c", "motion", { rotation: 90 }, 14);
    const off = setAnimated(two, "c", "motion", "rotation", 13, false);
    expect(motion(off).keyframes).toBeUndefined();
    expect(motion(off).params.rotation).toBe(60);
  });

  it("only animates numbers and points", () => {
    const p = project(clip());
    expect(setAnimated(p, "c", "motion", "fit", 12, true)).toBe(p);
    expect(setAnimated(p, "c", "motion", "uniformScale", 12, true)).toBe(p);
    expect(times(setAnimated(p, "c", "motion", "position", 12, true), "position")).toEqual([[12, [0.5, 0.5]]]);
  });
});

describe("the keyframe navigator", () => {
  it("adds a keyframe of the value showing, or removes the one there", () => {
    const p = project(clip({ rotation: [k(10, 0), k(14, 40)] }));
    const added = toggleKeyframe(p, "c", "motion", "rotation", 12);
    expect(times(added, "rotation")).toEqual([[10, 0], [12, 20], [14, 40]]);
    // Within a millisecond counts as on it.
    expect(times(toggleKeyframe(added, "c", "motion", "rotation", 12.0004), "rotation")).toEqual([[10, 0], [14, 40]]);
    // Removing the last one ends the animation at its value.
    const last = toggleKeyframe(project(clip({ rotation: [k(10, 25)] })), "c", "motion", "rotation", 10);
    expect(motion(last).keyframes).toBeUndefined();
    expect(motion(last).params.rotation).toBe(25);
  });

  it("jumps between the keyframes inside the clip, in timeline time", () => {
    const c = clip({ rotation: [k(8, 0), k(11, 0), k(15, 0)], scale: [k(13, 1), k(25, 1)] });
    const fps = 30;
    expect(keyframeTimes(c)).toEqual([8, 11, 13, 15, 25]);
    expect(adjacentKeyframe(c, 2, 1, fps)).toBe(3);
    expect(adjacentKeyframe(c, 3, 1, fps)).toBe(5);
    expect(adjacentKeyframe(c, 3.01, -1, fps)).toBe(null); // on it (within half a frame); 8 is before the clip
    expect(adjacentKeyframe(c, 7, 1, fps)).toBe(null); // 25 is past the clip's end
    expect(adjacentKeyframe(c, 7, -1, fps, { effectId: "motion", key: "scale" })).toBe(5);
  });
});

describe("keyframeTime", () => {
  it("keyframes the frame under the playhead, or a keyframe within half a frame", () => {
    const c = clip({ rotation: [k(11.5, 0)] });
    expect(keyframeTime(c, 3.012, 30)).toBeCloseTo(11, 6); // frame 90 = 3 s
    expect(keyframeTime(c, 3.49, 30)).toBe(11.5);
    expect(keyframeTime(c, 100, 30)).toBeLessThan(20); // clamped into the clip
  });
});

describe("keyframe edits", () => {
  const p = project(clip({ rotation: [k(10, 0), k(12, 45), k(14, 90)], scale: [k(12, 1), k(16, 2)] }));

  it("move keyframes, replacing any they land on", () => {
    const refs = clipKeyframes(p.clips[0], { time: 12 });
    expect(refs).toHaveLength(2);
    const moved = moveKeyframes(p, "c", refs, 1);
    expect(times(moved, "rotation")).toEqual([[10, 0], [13, 45], [14, 90]]);
    expect(times(moved, "scale")).toEqual([[13, 1], [16, 2]]);
    expect(times(moveKeyframes(p, "c", refs.slice(0, 1), 2), "rotation")).toEqual([[10, 0], [14, 45]]);
    expect(moveKeyframes(p, "c", refs, 0)).toBe(p);
  });

  it("delete keyframes, stopping a parameter left without any at the value it showed", () => {
    const gone = deleteKeyframes(p, "c", clipKeyframes(p.clips[0], { effectId: "motion" }).filter((r) => r.key === "scale"), 14);
    expect(times(gone, "scale")).toBeUndefined();
    expect(motion(gone).params.scale).toBeCloseTo(1.5);
    expect(times(gone, "rotation")).toHaveLength(3);
    expect(deleteKeyframes(p, "c", [{ effectId: "motion", key: "rotation", time: 11 }], 11)).toBe(p);
  });

  it("change how far their ease reaches (After Effects' influence), dropping it at Premiere's 33%", () => {
    const ref = [{ effectId: "motion", key: "rotation", time: 12 }];
    const eased = setKeyframeEasing(p, "c", ref, "ease");
    const snappy = setKeyframeInfluence(eased, "c", ref, 0.9);
    expect(motion(snappy).keyframes!.rotation.map((kf) => kf.influence)).toEqual([undefined, 0.9, undefined]);
    // Arriving at 12 (eased, 90%): slower near the keyframe than at 33%.
    expect(motionAt(snappy.clips[0], 11.8).rotation).toBeGreaterThan(motionAt(eased.clips[0], 11.8).rotation);
    expect(setKeyframeInfluence(snappy, "c", ref, 0.9)).toBe(snappy);
    expect(motion(setKeyframeInfluence(snappy, "c", ref, 1 / 3)).keyframes!.rotation[1]).not.toHaveProperty("influence");
    expect(motion(setKeyframeInfluence(snappy, "c", ref, 5)).keyframes!.rotation[1].influence).toBe(1);
  });

  it("change their interpolation", () => {
    const eased = setKeyframeEasing(p, "c", [{ effectId: "motion", key: "rotation", time: 12 }], "ease");
    expect(motion(eased).keyframes!.rotation.map((kf) => kf.easing)).toEqual(["linear", "ease", "linear"]);
    expect(motionAt(eased.clips[0], 11).rotation).toBeGreaterThan(22.5);
    expect(setKeyframeEasing(eased, "c", [{ effectId: "motion", key: "rotation", time: 12 }], "ease")).toBe(eased);
  });
});
