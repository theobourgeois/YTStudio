import { describe, expect, it } from "vitest";
import type { Clip, Project } from "./types.ts";
import {
  MAIN_TRACK_ID,
  addAudioTrack,
  addClip,
  appendToMain,
  clipAtTime,
  clipEnd,
  createDefaultProject,
  findFreeStart,
  mainInsertIndex,
  moveClip,
  normalizeProject,
  outputSize,
  projectDuration,
  removeClips,
  removeTrack,
  snapTime,
  splitClip,
  trackClips,
  trimClip,
} from "./timeline.ts";
import { formatDuration, formatTime } from "./format.ts";

const AUDIO = "audio_1";

function clip(id: string, trackId: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip {
  return { id, assetId: "asset", trackId, start, in: 0, out: dur, volume: 1, fit: "contain", ...extra };
}

/** Main track with clips a(2s) b(3s) c(1s) packed at 0, 2, 5. */
function mainABC(): Project {
  let p = createDefaultProject();
  p = appendToMain(p, clip("a", MAIN_TRACK_ID, 0, 2));
  p = appendToMain(p, clip("b", MAIN_TRACK_ID, 0, 3));
  p = appendToMain(p, clip("c", MAIN_TRACK_ID, 0, 1));
  return p;
}

const order = (p: Project, track = MAIN_TRACK_ID) => trackClips(p, track).map((c) => c.id);
const starts = (p: Project, track = MAIN_TRACK_ID) => trackClips(p, track).map((c) => c.start);

describe("main track (magnetic)", () => {
  it("packs appended clips back to back", () => {
    const p = mainABC();
    expect(order(p)).toEqual(["a", "b", "c"]);
    expect(starts(p)).toEqual([0, 2, 5]);
    expect(projectDuration(p)).toBe(6);
  });

  it("inserts by drop position relative to clip midpoints", () => {
    const p = mainABC();
    expect(mainInsertIndex(p, 0.5)).toBe(0);
    expect(mainInsertIndex(p, 1.5)).toBe(1);
    expect(mainInsertIndex(p, 3)).toBe(1);
    expect(mainInsertIndex(p, 3.6)).toBe(2);
    expect(mainInsertIndex(p, 100)).toBe(3);
    const q = addClip(p, clip("x", MAIN_TRACK_ID, 1.9, 0.2)); // centre 2.0 -> after a
    expect(order(q)).toEqual(["a", "x", "b", "c"]);
    expect(starts(q)).toEqual([0, 2, 2.2, 5.2]);
  });

  it("reorders when a clip is dragged past a neighbour's midpoint", () => {
    const p = mainABC();
    // Drag c (1s) so its centre sits at 1.2 -> before b's midpoint (3.5), after a's (1)
    const q = moveClip(p, "c", MAIN_TRACK_ID, 0.7);
    expect(order(q)).toEqual(["a", "c", "b"]);
    expect(starts(q)).toEqual([0, 2, 3]);
    // Drag a to the very end
    const r = moveClip(p, "a", MAIN_TRACK_ID, 10);
    expect(order(r)).toEqual(["b", "c", "a"]);
    expect(starts(r)).toEqual([0, 3, 4]);
  });

  it("reorders by pointer time when given, so long clips can move before short ones", () => {
    const p = mainABC(); // a 0-2, b 2-5, c 5-6
    // Pointer at 0.3s (inside a's first half) while dragging b: b goes first,
    // even though b's centre could never get past a's midpoint.
    const q = moveClip(p, "b", MAIN_TRACK_ID, 0, 0.3);
    expect(order(q)).toEqual(["b", "a", "c"]);
  });

  it("ripple-deletes", () => {
    const q = removeClips(mainABC(), ["b"]);
    expect(order(q)).toEqual(["a", "c"]);
    expect(starts(q)).toEqual([0, 2]);
  });

  it("splits a clip into two contiguous halves with matching source ranges", () => {
    const p = mainABC();
    const { project: q, newClipId } = splitClip(p, "b", 3.25);
    expect(newClipId).toBeTruthy();
    const [a, b1, b2, c] = trackClips(q, MAIN_TRACK_ID);
    expect([a.id, b1.id, c.id]).toEqual(["a", "b", "c"]);
    expect(b1).toMatchObject({ start: 2, in: 0, out: 1.25 });
    expect(b2).toMatchObject({ id: newClipId, start: 3.25, in: 1.25, out: 3 });
    expect(projectDuration(q)).toBe(6);
  });

  it("refuses to split too close to an edge or outside the clip", () => {
    const p = mainABC();
    expect(splitClip(p, "b", 2.05).newClipId).toBeNull();
    expect(splitClip(p, "b", 4.95).newClipId).toBeNull();
    expect(splitClip(p, "b", 5.5).newClipId).toBeNull();
    expect(splitClip(p, "nope", 3).project).toBe(p);
  });

  it("trims the end with ripple and clamps to source + min length", () => {
    const p = mainABC();
    const q = trimClip(p, "b", "end", -1, 3);
    expect(starts(q)).toEqual([0, 2, 4]);
    expect(trimClip(p, "b", "end", 5, 3).clips.find((c) => c.id === "b")!.out).toBe(3);
    expect(trimClip(p, "b", "end", -10, 3).clips.find((c) => c.id === "b")!.out).toBeCloseTo(0.1);
  });

  it("trims the start by moving the in-point, keeping the slot", () => {
    const p = mainABC();
    const q = trimClip(p, "b", "start", 1, 3);
    const b = q.clips.find((c) => c.id === "b")!;
    expect(b).toMatchObject({ start: 2, in: 1, out: 3 });
    expect(starts(q)).toEqual([0, 2, 4]);
    // can't extend before the source start
    expect(trimClip(p, "b", "start", -1, 3).clips.find((c) => c.id === "b")!.in).toBe(0);
  });

  it("finds the clip under a time with an exclusive end", () => {
    const p = mainABC();
    expect(clipAtTime(p, MAIN_TRACK_ID, 0)?.id).toBe("a");
    expect(clipAtTime(p, MAIN_TRACK_ID, 2)?.id).toBe("b");
    expect(clipAtTime(p, MAIN_TRACK_ID, 5.999)?.id).toBe("c");
    expect(clipAtTime(p, MAIN_TRACK_ID, 6)).toBeUndefined();
  });
});

describe("audio tracks (free, non-overlapping)", () => {
  it("findFreeStart picks the closest non-overlapping slot", () => {
    const clips = [clip("m1", AUDIO, 2, 2), clip("m2", AUDIO, 6, 2)];
    expect(findFreeStart(clips, 0, 1)).toBe(0);
    expect(findFreeStart(clips, 2.4, 1)).toBe(1); // before m1 (dist 1.4) beats after m1 (dist 1.6)
    expect(findFreeStart(clips, 3.8, 1)).toBe(4);
    expect(findFreeStart(clips, 4.5, 3)).toBe(8); // gap 4..6 too small
    expect(findFreeStart(clips, -5, 1)).toBe(0);
    expect(findFreeStart(clips, 2, 2, "m1")).toBe(2);
  });

  it("adds and moves clips without overlap", () => {
    let p = createDefaultProject();
    p = addClip(p, clip("m1", AUDIO, 1, 4));
    p = addClip(p, clip("m2", AUDIO, 2, 2)); // would overlap -> placed at 5
    expect(starts(p, AUDIO)).toEqual([1, 5]);
    p = moveClip(p, "m2", AUDIO, 0.2);
    expect(order(p, AUDIO)).toEqual(["m1", "m2"]); // 0.2..2.2 overlaps m1; nearest free is 5 again
    p = moveClip(p, "m1", AUDIO, 10);
    expect(trackClips(p, AUDIO).find((c) => c.id === "m1")!.start).toBe(10);
  });

  it("moves clips between main and audio tracks", () => {
    let p = mainABC();
    p = moveClip(p, "b", AUDIO, 1);
    expect(order(p)).toEqual(["a", "c"]);
    expect(starts(p)).toEqual([0, 2]);
    expect(trackClips(p, AUDIO)[0]).toMatchObject({ id: "b", start: 1 });
    p = moveClip(p, "b", MAIN_TRACK_ID, -1); // centre at 0.5 -> before a
    expect(order(p)).toEqual(["b", "a", "c"]);
    expect(trackClips(p, AUDIO)).toEqual([]);
  });

  it("trims audio clips against neighbours and source bounds", () => {
    let p = createDefaultProject();
    p = addClip(p, clip("m1", AUDIO, 0, 2));
    p = addClip(p, clip("m2", AUDIO, 3, 2, { in: 1, out: 3 }));
    // start edge of m2 can extend left until m1's end (2) or source start (in=0 -> start 2)
    let q = trimClip(p, "m2", "start", -5, 10);
    expect(q.clips.find((c) => c.id === "m2")).toMatchObject({ start: 2, in: 0, out: 3 });
    // end edge of m1 can't pass m2's start
    q = trimClip(p, "m1", "end", 5, 10);
    expect(clipEnd(q.clips.find((c) => c.id === "m1")!)).toBe(3);
    // end of m2 limited by source duration
    q = trimClip(p, "m2", "end", 100, 4);
    expect(q.clips.find((c) => c.id === "m2")!.out).toBe(4);
  });

  it("adds and removes tracks", () => {
    let p = createDefaultProject();
    const { project, trackId } = addAudioTrack(p);
    p = addClip(project, clip("m", trackId, 0, 1));
    expect(p.tracks.map((t) => t.name)).toEqual(["Video", "Audio 1", "Audio 2"]);
    p = removeTrack(p, trackId);
    expect(p.tracks).toHaveLength(2);
    expect(p.clips).toEqual([]);
    expect(removeTrack(p, MAIN_TRACK_ID)).toBe(p);
  });
});

describe("snapping", () => {
  it("snaps to the nearest point within threshold", () => {
    expect(snapTime(1.04, [0, 1, 2], 0.1)).toEqual({ time: 1, snappedTo: 1 });
    expect(snapTime(1.5, [0, 1, 2], 0.1)).toEqual({ time: 1.5, snappedTo: null });
  });
});

describe("normalizeProject", () => {
  it("repairs garbage input", () => {
    const p = normalizeProject({} as Project);
    expect(p.tracks[0].id).toBe(MAIN_TRACK_ID);
    expect(p.settings.aspectRatio).toBe("9:16");
  });

  it("drops invalid clips, packs main and resolves audio overlaps", () => {
    const input: Project = {
      ...createDefaultProject(),
      clips: [
        clip("a", MAIN_TRACK_ID, 5, 2),
        clip("bad", MAIN_TRACK_ID, 0, 0),
        clip("orphan", "nope", 0, 1),
        clip("m1", AUDIO, 0, 2),
        clip("m2", AUDIO, 1, 2),
        clip("long", AUDIO, 10, 50, { assetId: "short" }),
      ],
    };
    const p = normalizeProject(input, {
      asset: { duration: 10, hasVideo: true, hasAudio: true },
      short: { duration: 5, hasVideo: false, hasAudio: true },
    });
    expect(order(p)).toEqual(["a"]);
    expect(starts(p)).toEqual([0]);
    expect(starts(p, AUDIO)).toEqual([0, 2, 10]);
    expect(p.clips.find((c) => c.id === "long")!.out).toBe(5);
  });
});

describe("outputSize", () => {
  it("computes even dimensions", () => {
    expect(outputSize("9:16", "1080p")).toEqual({ width: 1080, height: 1920 });
    expect(outputSize("16:9", "720p")).toEqual({ width: 1280, height: 720 });
    expect(outputSize("1:1", "4k")).toEqual({ width: 2160, height: 2160 });
    expect(outputSize("4:5", "1080p")).toEqual({ width: 1080, height: 1350 });
  });
});

describe("format", () => {
  it("formats times", () => {
    expect(formatTime(65.4)).toBe("1:05.40");
    expect(formatTime(0)).toBe("0:00.00");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(59.6)).toBe("1:00");
  });
});

describe("insertIntoMain", () => {
  it("inserts at a slot and clamps the index", async () => {
    const { insertIntoMain } = await import("./timeline.ts");
    const p = mainABC();
    expect(order(insertIntoMain(p, clip("x", MAIN_TRACK_ID, 0, 1), 1))).toEqual(["a", "x", "b", "c"]);
    expect(order(insertIntoMain(p, clip("x", MAIN_TRACK_ID, 0, 1), 99))).toEqual(["a", "b", "c", "x"]);
    expect(starts(insertIntoMain(p, clip("x", MAIN_TRACK_ID, 0, 1), -1))).toEqual([0, 1, 3, 6]);
  });
});
