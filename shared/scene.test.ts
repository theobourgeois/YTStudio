import { describe, expect, it } from "vitest";
import { defaultEffects } from "./effects.ts";
import { handleTime, planTrack, planTransition, sceneAt, transitionWindows } from "./scene.ts";
import { MAIN_TRACK_ID, createDefaultProject } from "./timeline.ts";
import { trackTransitions } from "./transition-windows.ts";
import { createTransition } from "./transitions.ts";
import type { Clip, Project } from "./types.ts";

const clip = (id: string, start: number, inPoint: number, out: number, trackId = MAIN_TRACK_ID): Clip => ({
  id,
  assetId: "a",
  trackId,
  start,
  in: inPoint,
  out,
  effects: defaultEffects(),
});

const project = (clips: Clip[]): Project => ({ ...createDefaultProject(), clips });

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
  it("shows only the background past the end of a video track", () => {
    expect(planMain(p, 6)).toEqual({ current: null, next: null });
  });
  it("holds the last frame when the playhead is parked at the very end", () => {
    const plan = planMain(project([clip("a", 0, 0, 2)]), 2);
    expect(plan.current?.clip.id).toBe("a");
    expect(plan.current?.time).toBeLessThan(2);
  });
  it("does not hold the last frame when audio runs past the video", () => {
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
  });
});

describe("planTransition", () => {
  // "a" uses source 2..6 of a 7 s file, "b" starts at the very beginning of its file.
  const a = { ...clip("a", 0, 2, 6), transitionOut: createTransition("cross-dissolve", 2) };
  const b = clip("b", 4, 0, 4);
  const p = project([a, b]);
  const windows = trackTransitions(p, MAIN_TRACK_ID);
  const range = (c: Clip) => (c.id === "a" ? { min: 0, max: 7 } : { min: 0, max: 4 });

  it("shows both clips across the cut, running into handles and holding where the media ends", () => {
    const plan = planTransition(p, windows, 4.5, range)!;
    expect(plan.progress).toBe(0.75);
    expect(plan.from?.clip.id).toBe("a");
    expect(plan.from?.time).toBeCloseTo(6.5); // past its out-point, into the handle
    expect(plan.to?.time).toBe(0.5);
    const early = planTransition(p, windows, 3.2, range)!;
    expect(early.to?.time).toBe(0); // "b" has no media before its in-point: first frame held
    expect(planTransition(p, windows, 4.99, range)!.from!.time).toBeLessThan(7);
  });

  it("is null outside transitions", () => {
    expect(planTransition(p, windows, 2, range)).toBeNull();
    expect(planTransition(p, windows, 5, range)).toBeNull();
  });

  it("holds the last frame of a transition that ends the project", () => {
    const tail = project([{ ...clip("x", 0, 0, 2), transitionOut: createTransition("cross-dissolve", 1) }]);
    const plan = planTransition(tail, trackTransitions(tail, MAIN_TRACK_ID), 2, () => ({ min: 0, max: 2 }));
    expect(plan?.progress).toBe(1);
    expect(plan?.to).toBeNull();
  });

  it("maps timeline time into the media, clamped to it", () => {
    expect(handleTime(clip("x", 2, 10, 15), 1, { min: 0, max: 20 })).toBe(9);
    expect(handleTime(clip("x", 2, 10, 15), 30, { min: 0, max: 20 })).toBeCloseTo(20, 2);
  });
});

describe("sceneAt", () => {
  const top = { id: "v2", kind: "video" as const, name: "Video 2", muted: false };
  const range = () => ({ min: 0, max: 100 });

  it("lists what each video track shows, bottom layer first", () => {
    const p: Project = {
      ...project([
        { ...clip("a", 0, 0, 4), transitionOut: createTransition("cross-dissolve", 2) },
        clip("b", 4, 0, 4),
        clip("t", 1, 0, 6, "v2"),
        clip("m", 0, 0, 10, "audio_1"),
      ]),
      tracks: [top, ...createDefaultProject().tracks],
    };
    const windows = transitionWindows(p);
    expect(sceneAt(p, windows, 0.5, range).map((s) => [s.trackId, s.kind])).toEqual([[MAIN_TRACK_ID, "clip"]]);
    const mid = sceneAt(p, windows, 4, range);
    expect(mid.map((s) => [s.trackId, s.kind])).toEqual([[MAIN_TRACK_ID, "transition"], ["v2", "clip"]]);
    expect(mid[0]).toMatchObject({ progress: 0.5, from: { clip: { id: "a" }, time: 4 }, to: { clip: { id: "b" }, time: 0 } });
    expect(mid[1]).toMatchObject({ shown: { clip: { id: "t" }, time: 3 } });
    expect(sceneAt(p, windows, 9, range)).toEqual([]);
  });
});
