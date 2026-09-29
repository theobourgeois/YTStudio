import { describe, expect, it } from "vitest";
import type { Clip, Project } from "@shared/types";
import { MAIN_TRACK_ID, createDefaultProject } from "@shared/timeline";
import { fitRect, isLightColor } from "./canvas";
import { SEEK_DRIFT, assignSlots, planAudio, planTrack, playbackCorrection, sourceTime } from "./sync";

const clip = (id: string, start: number, inPoint: number, out: number, trackId = MAIN_TRACK_ID): Clip => ({
  id,
  assetId: "a",
  trackId,
  start,
  in: inPoint,
  out,
  volume: 1,
  fit: "contain",
});

const project = (clips: Clip[]): Project => ({ ...createDefaultProject(), clips });

describe("sourceTime", () => {
  it("maps timeline time into the source", () => {
    expect(sourceTime(clip("x", 2, 10, 15), 3.5)).toBeCloseTo(11.5);
  });
  it("clamps into the clip, just before the out-point", () => {
    const c = clip("x", 2, 10, 15);
    expect(sourceTime(c, 0)).toBe(10);
    expect(sourceTime(c, 100)).toBeLessThan(15);
    expect(sourceTime(c, 100)).toBeGreaterThan(14.99);
  });
});

describe("planTrack", () => {
  const planMain = (p: Project, t: number) => planTrack(p, MAIN_TRACK_ID, t);
  const p = project([clip("a", 0, 0, 2), clip("b", 2, 5, 8), clip("m", 0, 0, 10, "audio_1")]);

  it("finds the current clip and the next one", () => {
    const plan = planMain(p, 1);
    expect(plan.current?.clip.id).toBe("a");
    expect(plan.current?.time).toBe(1);
    expect(plan.next?.id).toBe("b");
  });
  it("switches exactly at the cut", () => {
    const plan = planMain(p, 2);
    expect(plan.current?.clip.id).toBe("b");
    expect(plan.current?.time).toBe(5);
    expect(plan.next).toBeNull();
  });
  it("shows only the background past the end of the main track", () => {
    expect(planMain(p, 6)).toEqual({ current: null, next: null });
  });
  it("holds the last frame when the playhead is parked at the very end", () => {
    const plan = planMain(project([clip("a", 0, 0, 2)]), 2);
    expect(plan.current?.clip.id).toBe("a");
    expect(plan.current?.time).toBeLessThan(2);
  });
  it("does not hold the last frame when audio runs past the main track", () => {
    expect(planMain(p, 5).current).toBeNull();
  });
  it("handles an empty timeline", () => {
    expect(planMain(project([]), 0)).toEqual({ current: null, next: null });
  });
  it("preloads the clip after a gap", () => {
    const q = project([clip("a", 0, 0, 2), clip("b", 4, 0, 2)]);
    expect(planMain(q, 3)).toEqual({ current: null, next: q.clips[1] });
  });
  it("plans each video track on its own", () => {
    const q: Project = {
      ...project([clip("a", 0, 0, 4), clip("top", 1, 0, 1, "v2")]),
      tracks: [{ id: "v2", kind: "video", name: "Video 2", muted: false }, ...createDefaultProject().tracks],
    };
    expect(planTrack(q, "v2", 0.5)).toMatchObject({ current: null, next: { id: "top" } });
    expect(planTrack(q, "v2", 1.5).current?.clip.id).toBe("top");
    expect(planTrack(q, MAIN_TRACK_ID, 1.5).current?.clip.id).toBe("a");
    expect(planAudio(q, 1.5)).toEqual([]);
  });
});

describe("planAudio", () => {
  const p = project([clip("v", 0, 0, 10), clip("m", 2, 1, 4, "audio_1")]);
  it("parks upcoming clips on their in-point", () => {
    expect(planAudio(p, 1)).toEqual([{ clip: p.clips[1], active: false, time: 1 }]);
  });
  it("plays clips under the playhead", () => {
    expect(planAudio(p, 3)[0]).toMatchObject({ active: true, time: 2 });
  });
  it("leaves finished clips alone", () => {
    expect(planAudio(p, 5)[0]).toMatchObject({ active: false, time: null });
  });
});

describe("assignSlots", () => {
  it("keeps the current clip where it is and preloads next in the other slot", () => {
    expect(assignSlots(["a", "x"], "a", "b")).toEqual(["a", "b"]);
    expect(assignSlots(["x", "a"], "a", "b")).toEqual(["b", "a"]);
  });
  it("flips at a cut: the preloaded slot becomes current", () => {
    expect(assignSlots(["a", "b"], "b", "c")).toEqual(["c", "b"]);
  });
  it("keeps a stale clip when there is nothing to preload", () => {
    expect(assignSlots(["a", "b"], "b", null)).toEqual(["a", "b"]);
  });
  it("loads both when jumping somewhere new", () => {
    expect(assignSlots(["a", "b"], "c", "d")).toEqual(["c", "d"]);
    expect(assignSlots([null, null], "c", null)).toEqual(["c", null]);
  });
  it("puts current beside an already-preloaded next", () => {
    expect(assignSlots(["x", "d"], "c", "d")).toEqual(["c", "d"]);
  });
});

describe("playbackCorrection", () => {
  it("leaves tiny drift alone", () => {
    expect(playbackCorrection(0.01, false)).toEqual({ seek: false, rate: 1 });
  });
  it("nudges a silent element's rate towards the clock for small drift", () => {
    expect(playbackCorrection(0.1, false).rate).toBeLessThan(1);
    expect(playbackCorrection(-0.1, false).rate).toBeGreaterThan(1);
    expect(playbackCorrection(0.1, false).seek).toBe(false);
  });
  it("never changes an audible element's rate", () => {
    expect(playbackCorrection(0.1, true)).toEqual({ seek: false, rate: 1 });
    expect(playbackCorrection(-0.1, true)).toEqual({ seek: false, rate: 1 });
  });
  it("seeks when far off", () => {
    expect(playbackCorrection(SEEK_DRIFT + 0.01, false)).toEqual({ seek: true, rate: 1 });
    expect(playbackCorrection(-1, true)).toEqual({ seek: true, rate: 1 });
  });
});

describe("canvas helpers", () => {
  it("letterboxes to the aspect ratio", () => {
    expect(fitRect(1000, 500, "9:16")).toEqual({ width: 281, height: 500 });
    expect(fitRect(400, 1000, "16:9")).toEqual({ width: 400, height: 225 });
    expect(fitRect(0, 100, "1:1")).toEqual({ width: 0, height: 0 });
  });
  it("detects light backgrounds", () => {
    expect(isLightColor("#ffffff")).toBe(true);
    expect(isLightColor("#000000")).toBe(false);
    expect(isLightColor("nope")).toBe(false);
  });
});
