import { describe, expect, it } from "vitest";
import {
  adjacentKeyframe,
  clipKeyframes,
  copyKeyframes,
  deleteKeyframes,
  keyframeTime,
  keyframeTimes,
  moveKeyframes,
  pasteKeyframes,
  roveKeyframes,
  scaleKeyframes,
  setAnimated,
  setKeyframeEasing,
  setKeyframeInfluence,
  setKeyframeSpatial,
  smoothMotionPath,
  toggleKeyframe,
} from "./animation.ts";
import { keyframeDistance } from "./keyframes.ts";
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

describe("motion paths", () => {
  const ref = (time: number) => ({ effectId: "motion", key: "position", time });
  const straight = project(clip({ position: [k(10, [0, 0]), k(12, [1, 0]), k(14, [1, 1])] }));

  it("bend a point's travel with spatial handles, still reaching each keyframe on time", () => {
    // Leaving the first keyframe downwards: the path bows below the straight line.
    const bent = setKeyframeSpatial(straight, "c", ref(10), { out: [0, 0.5] });
    expect(motion(bent).keyframes!.position[0].spatialOut).toEqual([0, 0.5]);
    expect(motionAt(bent.clips[0], 10).position).toEqual([0, 0]);
    expect(motionAt(bent.clips[0], 12).position).toEqual([1, 0]);
    const mid = motionAt(bent.clips[0], 11).position;
    expect(mid[1]).toBeGreaterThan(0.1);
    // The straight stretch after it is as it was.
    expect(motionAt(bent.clips[0], 13).position).toEqual([1, 0.5]);
    // Even pace along the curve: the halfway point in time is halfway along its length.
    const [a, b] = motion(bent).keyframes!.position;
    const total = keyframeDistance(a, b);
    expect(total).toBeGreaterThan(1);
    let walked = 0;
    let prev = motionAt(bent.clips[0], 10).position;
    for (let i = 1; i <= 200; i++) {
      const at = motionAt(bent.clips[0], 10 + i / 200).position;
      walked += Math.hypot(at[0] - prev[0], at[1] - prev[1]);
      prev = at;
    }
    expect(walked).toBeCloseTo(total / 2, 2);
    // Clearing the handle straightens it; the same handles change nothing.
    expect(setKeyframeSpatial(bent, "c", ref(10), { out: [0, 0.5] })).toBe(bent);
    expect(motion(setKeyframeSpatial(bent, "c", ref(10), { out: null })).keyframes!.position[0]).not.toHaveProperty("spatialOut");
    // Not on numbers.
    const spin = project(clip({ rotation: [k(10, 0), k(12, 90)] }));
    expect(setKeyframeSpatial(spin, "c", { effectId: "motion", key: "rotation", time: 10 }, { out: [1, 1] })).toBe(spin);
  });

  it("smooth a keyframe along the line between its neighbours, and straighten it again", () => {
    const smooth = smoothMotionPath(straight, "c", [ref(12)], true);
    const corner = motion(smooth).keyframes!.position[1];
    // Its neighbours are at (0, 0) and (1, 1): the handles run along that diagonal, a third of the way to each.
    expect(corner.spatialIn![0]).toBeCloseTo(-corner.spatialIn![1] * -1);
    expect(Math.hypot(...corner.spatialIn!)).toBeCloseTo(1 / 3);
    expect(corner.spatialOut![0]).toBeCloseTo(corner.spatialOut![1]);
    expect(corner.spatialOut![0]).toBeGreaterThan(0);
    // The path now cuts the corner's outside: before it, the point swings past x = 1.
    expect(Math.max(...[11.6, 11.8, 12.2, 12.4].map((t) => motionAt(smooth.clips[0], t).position[0]))).toBeGreaterThan(1);
    expect(smoothMotionPath(smooth, "c", [ref(12)], false)).toEqual(straight);
    expect(smoothMotionPath(straight, "c", [ref(12)], false)).toBe(straight);
    // The ends get one handle each.
    const ends = motion(smoothMotionPath(straight, "c", [ref(10), ref(14)], true)).keyframes!.position;
    expect([!!ends[0].spatialIn, !!ends[0].spatialOut, !!ends[2].spatialIn, !!ends[2].spatialOut]).toEqual([false, true, true, false]);
  });
});

describe("keyframe workflow", () => {
  const ref = (key: string, time: number) => ({ effectId: "motion", key, time });
  const p = project(clip({ position: [k(10, [0, 0]), k(11, [1, 0], "ease"), k(14, [1, 1])], rotation: [k(10, 0), k(12, 90)] }));

  it("copies keyframes and pastes them at another time, on the same properties", () => {
    const copied = copyKeyframes(p.clips[0], [ref("position", 11), ref("position", 14), ref("rotation", 12)])!;
    // Times count from the first keyframe copied.
    expect(copied.items.map((i) => [i.key, i.keys.map((kf) => kf.time)])).toEqual([["position", [0, 3]], ["rotation", [1]]]);
    const pasted = pasteKeyframes(p, "c", copied, 15);
    expect(times(pasted.project, "position")).toEqual([[10, [0, 0]], [11, [1, 0]], [14, [1, 1]], [15, [1, 0]], [18, [1, 1]]]);
    expect(times(pasted.project, "rotation")).toEqual([[10, 0], [12, 90], [16, 90]]);
    expect(motion(pasted.project).keyframes!.position[3].easing).toBe("ease");
    expect(pasted.refs).toEqual([ref("position", 15), ref("position", 18), ref("rotation", 16)]);
    // Pasting over keyframes replaces them.
    expect(times(pasteKeyframes(p, "c", copied, 11).project, "position")).toEqual([[10, [0, 0]], [11, [1, 0]], [14, [1, 1]]]);
    expect(copyKeyframes(p.clips[0], [ref("scale", 10)])).toBeNull();
  });

  it("pastes onto another clip, and one property's keyframes onto another property of the same kind", () => {
    const other: Clip = { ...clip(), id: "d", start: 20, in: 0, out: 5 };
    const both: Project = { ...p, clips: [...p.clips, other] };
    const copied = copyKeyframes(p.clips[0], [ref("rotation", 10), ref("rotation", 12)])!;
    const across = pasteKeyframes(both, "d", copied, 1);
    expect(findEffect(across.project.clips[1], "motion")!.keyframes!.rotation.map((kf) => [kf.time, kf.value])).toEqual([[1, 0], [3, 90]]);
    // Rotation's keyframes onto Scale (both numbers): the values are limited to what Scale takes.
    const onto = pasteKeyframes(p, "c", copied, 10, { effectId: "motion", key: "scale" });
    expect(times(onto.project, "scale")).toEqual([[10, 0], [12, 90]]);
    expect(onto.refs).toEqual([ref("scale", 10), ref("scale", 12)]);
    // A number's can't go onto a point, and only one property's at a time.
    expect(pasteKeyframes(p, "c", copied, 10, { effectId: "motion", key: "position" }).project).toBe(p);
    const two = copyKeyframes(p.clips[0], [ref("rotation", 10), ref("position", 10)])!;
    expect(pasteKeyframes(p, "c", two, 10, { effectId: "motion", key: "scale" }).project).toBe(p);
  });

  it("stretches keyframes about a pivot", () => {
    const refs = [ref("position", 10), ref("position", 11), ref("position", 14)];
    expect(times(scaleKeyframes(p, "c", refs, 10, 2), "position")!.map(([t]) => t)).toEqual([10, 12, 18]);
    expect(times(scaleKeyframes(p, "c", refs, 14, 0.5), "position")!.map(([t]) => t)).toEqual([12, 12.5, 14]);
    expect(scaleKeyframes(p, "c", refs, 10, 1)).toBe(p);
    expect(scaleKeyframes(p, "c", refs, 10, 0)).toBe(p);
    // Only the selected ones move.
    expect(times(scaleKeyframes(p, "c", [ref("position", 11), ref("position", 14)], 14, 2), "position")!.map(([t]) => t)).toEqual([8, 10, 14]);
  });

  it("roves keyframes so the value travels at an even speed", () => {
    // Two legs of the same length, the first in 1 s and the second in 3 s: the middle keyframe goes to the middle.
    const roved = roveKeyframes(p, "c", [ref("position", 10), ref("position", 11), ref("position", 14)]);
    expect(motion(roved).keyframes!.position.map((kf) => [kf.time, kf.easing])).toEqual([[10, "linear"], [12, "linear"], [14, "linear"]]);
    expect(motionAt(roved.clips[0], 11).position).toEqual([0.5, 0]);
    expect(roveKeyframes(roved, "c", [ref("position", 10), ref("position", 12), ref("position", 14)])).toBe(roved);
    // Two keyframes have nothing between them to rove.
    expect(roveKeyframes(p, "c", [ref("rotation", 10), ref("rotation", 12)])).toBe(p);
  });
});
