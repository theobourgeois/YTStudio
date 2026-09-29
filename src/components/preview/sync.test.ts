import { describe, expect, it } from "vitest";
import { defaultEffects } from "@shared/effects";
import type { Clip, Project } from "@shared/types";
import { MAIN_TRACK_ID, createDefaultProject } from "@shared/timeline";
import { sourceTime } from "@shared/timeline";
import { fitRect } from "./canvas";
import { SEEK_DRIFT, assignSlots, planAudio, playbackCorrection } from "./sync";

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
});
