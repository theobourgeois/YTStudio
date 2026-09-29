import { describe, expect, it } from "vitest";
import { keyframeTime } from "./animation.ts";
import { defaultEffects, setParams, textEffects, volumeAt } from "./effects.ts";
import { formatSpeed, parseSpeed } from "./format.ts";
import { normalizeProject } from "./normalize.ts";
import { handleTime } from "./scene.ts";
import {
  END_GUARD,
  MAIN_TRACK_ID,
  MAX_SPEED,
  MIN_CLIP_DURATION,
  appendToTrack,
  clipDuration,
  clipEnd,
  createDefaultProject,
  fileTime,
  getClip,
  rippleTrimTo,
  setClipSpeed,
  sourceAt,
  sourceTime,
  speedForDuration,
  splitClip,
  stretchClip,
  timelineTime,
  trackClips,
  trimClip,
} from "./timeline.ts";
import type { Clip, Project } from "./types.ts";

function clip(id: string, start: number, from: number, to: number, extra: Partial<Clip> = {}): Clip {
  return { id, assetId: "asset", trackId: MAIN_TRACK_ID, start, in: from, out: to, effects: defaultEffects(), ...extra };
}

/** Clips a (source 0–4), b (source 10–12) and c (source 0–1), back to back from 0. */
function abc(): Project {
  let p = createDefaultProject();
  p = appendToTrack(p, clip("a", 0, 0, 4), MAIN_TRACK_ID);
  p = appendToTrack(p, clip("b", 0, 10, 12), MAIN_TRACK_ID);
  p = appendToTrack(p, clip("c", 0, 0, 1), MAIN_TRACK_ID);
  return p;
}

const of = (p: Project, id: string) => getClip(p, id)!;
const edges = (p: Project) => trackClips(p, MAIN_TRACK_ID).map((c) => [c.id, c.start, +clipEnd(c).toFixed(6)]);

describe("clip timing", () => {
  it("plays its source range at its speed", () => {
    const fast = clip("x", 2, 1, 5, { speed: 2 });
    expect(clipDuration(fast)).toBe(2);
    expect(clipEnd(fast)).toBe(4);
    expect(sourceTime(fast, 3)).toBe(3);
    expect(timelineTime(fast, 3)).toBe(3);
    const slow = clip("y", 0, 0, 1, { speed: 0.5 });
    expect(clipDuration(slow)).toBe(2);
    expect(sourceTime(slow, 1)).toBe(0.5);
  });

  it("plays backwards from its out-point, each moment showing the frame before its edge", () => {
    const back = clip("x", 2, 1, 5, { reversed: true });
    expect(sourceTime(back, 2)).toBeCloseTo(5 - END_GUARD, 9);
    expect(sourceTime(back, 3)).toBeCloseTo(4 - END_GUARD, 9);
    // Clamped to the in-point at the end.
    expect(sourceTime(back, 6)).toBe(1);
    // A transition shows it past its edges (unclamped), then into the media's handles.
    expect(sourceAt(back, 1)).toBeCloseTo(6 - END_GUARD, 9);
    expect(handleTime(back, 1, { min: 0, max: 5.5 })).toBeCloseTo(5.5 - END_GUARD, 9);
    for (const s of [1.2, 3, 4.9]) expect(sourceTime(back, timelineTime(back, s))).toBeCloseTo(s, 9);
  });

  it("finds a reversed clip's frames in the reversed copy of its media", () => {
    const back = clip("x", 0, 1, 5, { reversed: true, speed: 2 });
    // A 10s file: the clip's first frame (just before 5s) starts at 5s in the reversed copy.
    expect(fileTime(back, sourceTime(back, 0), 10)).toBeCloseTo(5, 9);
    expect(fileTime(back, sourceTime(back, 1), 10)).toBeCloseTo(7, 9);
    expect(fileTime(clip("y", 0, 1, 5), 3, 10)).toBe(3);
  });

  it("keyframes the frame under the playhead of a retimed clip", () => {
    const fast = clip("x", 0, 0, 4, { speed: 2 });
    expect(keyframeTime(fast, 1, 30)).toBe(2);
    const back = clip("y", 0, 0, 4, { reversed: true });
    expect(keyframeTime(back, 1, 30)).toBeCloseTo(3 - END_GUARD, 9);
  });
});

describe("setClipSpeed", () => {
  it("keeps the clip's start and moves the clips after it with its end", () => {
    const p = abc();
    const fast = setClipSpeed(p, ["a"], { speed: 2 });
    expect(edges(fast)).toEqual([["a", 0, 2], ["b", 2, 4], ["c", 4, 5]]);
    const slow = setClipSpeed(p, ["a"], { speed: 0.5 });
    expect(edges(slow)).toEqual([["a", 0, 8], ["b", 8, 10], ["c", 10, 11]]);
    // Clips on other tracks stay put, and the source range doesn't change.
    expect(of(slow, "a")).toMatchObject({ in: 0, out: 4, speed: 0.5 });
  });

  it("retimes several clips on a track in one pass", () => {
    const p = setClipSpeed(abc(), ["a", "b"], { speed: 2 });
    expect(edges(p)).toEqual([["a", 0, 2], ["b", 2, 3], ["c", 3, 4]]);
  });

  it("reverses, keeps pitch by default and doesn't store the defaults", () => {
    let p = setClipSpeed(abc(), ["a"], { reversed: true, keepPitch: false });
    expect(of(p, "a")).toMatchObject({ reversed: true, keepPitch: false });
    expect(edges(p)).toEqual(edges(abc()));
    p = setClipSpeed(p, ["a"], { speed: 1, reversed: false, keepPitch: true });
    expect(of(p, "a")).toEqual(of(abc(), "a"));
  });

  it("returns the same project when nothing changes", () => {
    const p = abc();
    expect(setClipSpeed(p, ["a"], { speed: 1, reversed: false })).toBe(p);
    expect(setClipSpeed(p, ["nope"], { speed: 2 })).toBe(p);
  });

  it("keeps speeds in range and clips at least MIN_CLIP_DURATION long", () => {
    const p = setClipSpeed(abc(), ["a", "c"], { speed: 100 });
    expect(of(p, "a").speed).toBe(MAX_SPEED);
    expect(clipDuration(of(p, "c"))).toBeGreaterThanOrEqual(MIN_CLIP_DURATION - 1e-9);
    expect(speedForDuration(of(abc(), "a"), 8)).toBe(0.5);
  });
});

describe("editing retimed clips", () => {
  it("splits a fast clip where the playhead is in its media", () => {
    const { project, newClipId } = splitClip(setClipSpeed(abc(), ["a"], { speed: 2 }), "a", 0.5);
    expect(of(project, "a")).toMatchObject({ in: 0, out: 1, speed: 2 });
    expect(of(project, newClipId!)).toMatchObject({ start: 0.5, in: 1, out: 4, speed: 2 });
    expect(clipEnd(of(project, newClipId!))).toBe(2);
  });

  it("splits a reversed clip: its left half has the end of the media", () => {
    const p = setClipSpeed(abc(), ["a"], { reversed: true });
    const { project, newClipId } = splitClip(p, "a", 1);
    expect(of(project, "a")).toMatchObject({ start: 0, in: 3, out: 4, reversed: true });
    expect(of(project, newClipId!)).toMatchObject({ start: 1, in: 0, out: 3, reversed: true });
  });

  it("trims a fast clip in timeline seconds", () => {
    const p = setClipSpeed(abc(), ["a"], { speed: 2 });
    const range = { min: 0, max: 10 };
    // Shorten the end by 0.5s on the timeline: 1s of media.
    expect(of(trimClip(p, "a", "end", -0.5, range), "a")).toMatchObject({ in: 0, out: 3 });
    expect(of(trimClip(p, "a", "start", 0.5, range), "a")).toMatchObject({ start: 0.5, in: 1, out: 4 });
    // Lengthening runs into the next clip.
    expect(clipEnd(of(trimClip(p, "a", "end", 5, range), "a"))).toBe(2);
  });

  it("trims a reversed clip's out-point at its start and its in-point at its end", () => {
    const p = setClipSpeed(abc(), ["a"], { reversed: true });
    const range = { min: 0, max: 5 };
    expect(of(trimClip(p, "a", "start", 1, range), "a")).toMatchObject({ start: 1, in: 0, out: 3 });
    expect(of(trimClip(p, "a", "end", -1, range), "a")).toMatchObject({ start: 0, in: 1, out: 4 });
    // The media's end is past the start edge: it can open up by 1s.
    const moved = { ...p, clips: p.clips.map((c) => (c.id === "a" ? { ...c, start: 3 } : c)).filter((c) => c.id === "a") };
    expect(of(trimClip(moved, "a", "start", -5, range), "a")).toMatchObject({ start: 2, in: 0, out: 5 });
    expect(of(rippleTrimTo(p, "a", "start", 1), "a")).toMatchObject({ start: 0, in: 0, out: 3 });
  });

  it("stretches a clip's speed to fit when its edge is dragged", () => {
    const p = abc();
    // Pull a's end back by 2s: its 4s of media now last 2s.
    const faster = stretchClip(p, "a", "end", -2);
    expect(of(faster, "a")).toMatchObject({ start: 0, in: 0, out: 4, speed: 2 });
    // It can't grow into b.
    expect(stretchClip(p, "a", "end", 1)).toBe(p);
    // The start edge moves and the end stays.
    const fromStart = stretchClip(p, "b", "start", 1);
    expect(of(fromStart, "b")).toMatchObject({ start: 5, speed: 2 });
    expect(clipEnd(of(fromStart, "b"))).toBeCloseTo(6, 9);
  });
});

describe("normalizing retimed clips", () => {
  it("keeps valid speeds and directions, clamps others and drops them from text", () => {
    const text: Clip = { id: "t", assetId: "", trackId: MAIN_TRACK_ID, start: 20, in: 0, out: 2, effects: textEffects({ text: "Hi" }), speed: 2, reversed: true };
    const input: Project = {
      ...createDefaultProject(),
      clips: [clip("a", 0, 0, 4, { speed: 2, reversed: true, keepPitch: false }), clip("b", 10, 0, 4, { speed: 1000 }), clip("c", 30, 0, 4, { speed: -1 }), text],
    };
    const p = normalizeProject(input);
    expect(of(p, "a")).toMatchObject({ speed: 2, reversed: true, keepPitch: false });
    expect(of(p, "b").speed).toBe(MAX_SPEED);
    expect(of(p, "c").speed).toBeUndefined();
    expect(of(p, "t")).not.toHaveProperty("speed");
    expect(of(p, "t")).not.toHaveProperty("reversed");
    // Stills have no speed either (when the media is known).
    const still = normalizeProject(input, { asset: { kind: "image", duration: 5, hasVideo: true, hasAudio: false } });
    expect(of(still, "a")).not.toHaveProperty("speed");
  });

  it("keeps a slow clip's edge exactly against the next one", () => {
    let p = abc();
    p = setClipSpeed(p, ["a"], { speed: 0.3 });
    p = setClipSpeed(p, ["a"], { speed: 0.37 });
    const again = normalizeProject(p);
    expect(edges(again)).toEqual(edges(p));
  });

  it("reads volume at a retimed clip's source time", () => {
    const p = setParams(setClipSpeed(abc(), ["a"], { speed: 2 }), "a", "volume", { level: 0.5 });
    expect(volumeAt(of(p, "a"), sourceTime(of(p, "a"), 1))).toBe(0.5);
  });
});

describe("speed text", () => {
  it("formats and parses speeds", () => {
    expect(formatSpeed(2)).toBe("2×");
    expect(formatSpeed(0.333333)).toBe("0.33×");
    expect(parseSpeed("2")).toBe(2);
    expect(parseSpeed("0.5x")).toBe(0.5);
    expect(parseSpeed(" 1.5× ")).toBe(1.5);
    expect(parseSpeed("50%")).toBe(0.5);
    expect(parseSpeed("fast")).toBeNull();
    expect(parseSpeed("0")).toBeNull();
  });
});
