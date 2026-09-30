import { describe, expect, it } from "vitest";
import type { Clip, Project } from "./types.ts";
import {
  MAIN_TRACK_ID,
  addClip,
  addTrack,
  adjacentTrack,
  appendToTrack,
  clipAtTime,
  clipEnd,
  closeGap,
  copyClips,
  createDefaultProject,
  editPoints,
  findFreeStart,
  insertClip,
  gapAt,
  getClip,
  moveClip,
  moveClips,
  nearestPoint,
  outputSize,
  pasteClips,
  projectDuration,
  pruneEmptyTrack,
  removeClips,
  removeTrack,
  rippleClipEdit,
  rippleDelete,
  rippleTrimTo,
  snapTime,
  splitClip,
  sourceRange,
  splitClips,
  stretchClip,
  trackClips,
  trimClip,
  withoutAudioTracks,
  newLayerClip,
} from "./timeline.ts";
import { clipKind, defaultEffects, motionAt, setParams, volumeAt } from "./effects.ts";
import { createTransition } from "./transitions.ts";
import { formatDuration, formatRelative, formatTime } from "./format.ts";
import { normalizeProject } from "./normalize.ts";

const AUDIO = "audio_1";

function clip(id: string, trackId: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip {
  return { id, assetId: "asset", trackId, start, in: 0, out: dur, effects: defaultEffects(), ...extra };
}

/** Video track with clips a(2s) b(3s) c(1s) back to back at 0, 2, 5. */
function mainABC(): Project {
  let p = createDefaultProject();
  p = appendToTrack(p, clip("a", MAIN_TRACK_ID, 0, 2), MAIN_TRACK_ID);
  p = appendToTrack(p, clip("b", MAIN_TRACK_ID, 0, 3), MAIN_TRACK_ID);
  p = appendToTrack(p, clip("c", MAIN_TRACK_ID, 0, 1), MAIN_TRACK_ID);
  return p;
}

const order = (p: Project, track = MAIN_TRACK_ID) => trackClips(p, track).map((c) => c.id);
const starts = (p: Project, track = MAIN_TRACK_ID) => trackClips(p, track).map((c) => c.start);
const startOf = (p: Project, id: string) => p.clips.find((c) => c.id === id)!.start;

describe("placing clips", () => {
  it("appends clips back to back", () => {
    const p = mainABC();
    expect(order(p)).toEqual(["a", "b", "c"]);
    expect(starts(p)).toEqual([0, 2, 5]);
    expect(projectDuration(p)).toBe(6);
  });

  it("finds the nearest free start", () => {
    const clips = [clip("m1", AUDIO, 2, 2), clip("m2", AUDIO, 6, 2)];
    expect(findFreeStart(clips, 2.4, 1)).toBe(1); // before m1 (dist 1.4) beats after m1 (dist 1.6)
    expect(findFreeStart(clips, 3.8, 1)).toBe(4);
    expect(findFreeStart(clips, 4.5, 3)).toBe(8); // gap 4..6 too small
    expect(findFreeStart(clips, -5, 1)).toBe(0);
    expect(findFreeStart(clips, 2, 2, "m1")).toBe(2);
  });

  it("adds clips at the nearest free spot, on any track", () => {
    let p = mainABC();
    p = addClip(p, clip("x", MAIN_TRACK_ID, 1.9, 0.5)); // overlaps a and b; the nearest free spot is after c
    expect(startOf(p, "x")).toBe(6);
    p = addClip(p, clip("y", MAIN_TRACK_ID, 10, 1)); // free: leaves a gap
    expect(startOf(p, "y")).toBe(10);
  });
});

describe("moving clips", () => {
  it("moves a clip freely, leaving a gap behind", () => {
    const p = moveClip(mainABC(), "a", MAIN_TRACK_ID, 8);
    expect(order(p)).toEqual(["b", "c", "a"]);
    expect(starts(p)).toEqual([2, 5, 8]);
  });

  it("lands next to a clip it would overlap", () => {
    const p = mainABC();
    // c (1s) dropped at 3.2 overlaps b (2..5): nearest free spot is right after b.
    expect(startOf(moveClip(p, "c", MAIN_TRACK_ID, 3.2), "c")).toBe(5);
    // a (2s) dropped at 5.5 overlaps c (5..6): right after c.
    expect(startOf(moveClip(p, "a", MAIN_TRACK_ID, 5.5), "a")).toBe(6);
  });

  it("never moves before 0", () => {
    const p = moveClip(mainABC(), "c", AUDIO, -3);
    expect(startOf(p, "c")).toBe(0);
  });

  it("moves between tracks", () => {
    let p = mainABC();
    p = moveClip(p, "b", AUDIO, 1);
    expect(order(p)).toEqual(["a", "c"]);
    expect(starts(p)).toEqual([0, 5]); // no ripple
    expect(trackClips(p, AUDIO)[0]).toMatchObject({ id: "b", start: 1 });
  });

  it("moves a group by the nearest delta at which all of it fits", () => {
    let p = mainABC();
    p = addClip(p, clip("m", AUDIO, 0, 1));
    p = addClip(p, clip("n", AUDIO, 4, 1));
    const q = moveClips(p, ["c", "m"], 1); // both fit as asked
    expect(startOf(q, "c")).toBe(6);
    expect(startOf(q, "m")).toBe(1);
    // +3.5 would put m over n (4..5): the nearest delta that fits everything is +3 (m just before n).
    const r = moveClips(p, ["c", "m"], 3.5);
    expect(startOf(r, "m")).toBe(3);
    expect(startOf(r, "c")).toBe(8);
    expect(moveClips(p, ["c", "m"], -10)).toBe(p); // clamped at 0: nothing moves
  });
});

describe("splitting and trimming", () => {
  it("splits a clip into two adjacent halves", () => {
    const { project, newClipId } = splitClip(mainABC(), "b", 3);
    const [a, b1, b2, c] = trackClips(project, MAIN_TRACK_ID);
    expect([a.id, b1.id, c.id]).toEqual(["a", "b", "c"]);
    expect(b2.id).toBe(newClipId);
    expect(b1).toMatchObject({ start: 2, in: 0, out: 1 });
    expect(b2).toMatchObject({ start: 3, in: 1, out: 3 });
    expect(splitClip(mainABC(), "b", 2.05).newClipId).toBeNull();
  });

  it("splits several clips at once", () => {
    let p = mainABC();
    p = addClip(p, clip("m", AUDIO, 0, 10));
    const res = splitClips(p, ["b", "m", "c"], 3); // c isn't under 3
    expect(res.newClipIds).toHaveLength(2);
    expect(trackClips(res.project, AUDIO).map((c) => c.start)).toEqual([0, 3]);
  });

  it("trims against neighbours and source bounds", () => {
    let p = createDefaultProject();
    p = addClip(p, clip("m1", AUDIO, 0, 2));
    p = addClip(p, clip("m2", AUDIO, 3, 2, { in: 1, out: 3 }));
    // start edge of m2 can extend left until m1's end (2) or source start (in=0 -> start 2)
    let q = trimClip(p, "m2", "start", -5, { min: 0, max: 10 });
    expect(q.clips.find((c) => c.id === "m2")).toMatchObject({ start: 2, in: 0, out: 3 });
    // end edge of m1 can't pass m2's start
    q = trimClip(p, "m1", "end", 5, { min: 0, max: 10 });
    expect(clipEnd(q.clips.find((c) => c.id === "m1")!)).toBe(3);
    // end of m2 limited by source duration
    q = trimClip(p, "m2", "end", 100, { min: 0, max: 4 });
    expect(q.clips.find((c) => c.id === "m2")!.out).toBe(4);
  });

  it("ripple-trims: the clip keeps its start and the clips after it follow (Auto ripple)", () => {
    const media = { min: 0, max: 10 };
    const p = mainABC(); // a 0-2, b 2-5, c 5-6, all with media 0..10
    // b's end: longer pushes c along, however close it was.
    let q = rippleClipEdit(p, "b", (x) => trimClip(x, "b", "end", 1.5, media));
    expect(starts(q)).toEqual([0, 2, 6.5]);
    expect(getClip(q, "b")).toMatchObject({ in: 0, out: 4.5 });
    // b's start, dragged right: it stays at 2, loses its first second, and c comes 1s closer.
    q = rippleClipEdit(p, "b", (x) => trimClip(x, "b", "start", 1, media));
    expect(starts(q)).toEqual([0, 2, 4]);
    expect(getClip(q, "b")).toMatchObject({ in: 1, out: 3 });
    // Dragged back left, b's start only goes back as far as its media starts.
    q = rippleClipEdit(p, "b", (x) => trimClip(x, "b", "start", 1, media));
    q = rippleClipEdit(q, "b", (x) => trimClip(x, "b", "start", -5, media));
    expect(getClip(q, "b")).toMatchObject({ start: 2, in: 0, out: 3 });
    expect(starts(q)).toEqual([0, 2, 5]);
    // A rate stretch ripples too.
    q = rippleClipEdit(p, "a", (x) => stretchClip(x, "a", "end", 2));
    expect(starts(q)).toEqual([0, 4, 7]);
    expect(getClip(q, "a")!.speed).toBe(0.5);
    // No change: the same project back.
    expect(rippleClipEdit(p, "b", (x) => x)).toBe(p);
  });

  it("inserts a clip, pushing later clips only as far as it needs (Auto ripple)", () => {
    const p = mainABC();
    // Into the middle of b (nearer its end): goes to b's end, pushing c by its length.
    let q = insertClip(p, clip("n", MAIN_TRACK_ID, 4, 1));
    expect(order(q)).toEqual(["a", "b", "n", "c"]);
    expect(starts(q)).toEqual([0, 2, 5, 6]);
    // Nearer b's start: before b.
    q = insertClip(p, clip("n", MAIN_TRACK_ID, 2.4, 1));
    expect(order(q)).toEqual(["a", "n", "b", "c"]);
    expect(starts(q)).toEqual([0, 2, 3, 6]);
    // In a gap with room to spare, nothing moves.
    const gappy = moveClip(p, "c", MAIN_TRACK_ID, 10);
    q = insertClip(gappy, clip("n", MAIN_TRACK_ID, 6, 2));
    expect(starts(q)).toEqual([0, 2, 6, 10]);
    // Just too long for the gap: c moves only by the overlap.
    q = insertClip(gappy, clip("n", MAIN_TRACK_ID, 6, 5));
    expect(starts(q)).toEqual([0, 2, 6, 11]);
  });

  it("lets a still image's clip stretch either way", () => {
    const still = sourceRange({ kind: "image", duration: 5 });
    expect(sourceRange({ kind: "video", duration: 5 })).toEqual({ min: 0, max: 5 });
    let p = addClip(createDefaultProject(), clip("s", MAIN_TRACK_ID, 4, 5));
    p = trimClip(p, "s", "start", -3, still);
    expect(p.clips[0]).toMatchObject({ start: 1, in: -3, out: 5 });
    p = trimClip(p, "s", "end", 60, still);
    expect(p.clips[0].out).toBe(65);
  });

  it("keeps a clip's effects on both halves of a split", () => {
    const p = addClip(createDefaultProject(), clip("v", MAIN_TRACK_ID, 0, 4));
    const styled = setParams(p, "v", "motion", { rotation: 30 });
    const { project, newClipId } = splitClip(styled, "v", 2);
    expect(project.clips.map((c) => motionAt(c, c.in).rotation)).toEqual([30, 30]);
    expect(newClipId).toBeTruthy();
  });

  it("trims video clips without rippling", () => {
    const p = trimClip(mainABC(), "a", "end", -1, { min: 0, max: 10 });
    expect(starts(p)).toEqual([0, 2, 5]);
    expect(clipEnd(p.clips.find((c) => c.id === "a")!)).toBe(1);
  });

  it("ripple-trims to a time and closes the gap on that track only", () => {
    let p = mainABC();
    p = addClip(p, clip("m", AUDIO, 4, 2));
    const start = rippleTrimTo(p, "b", "start", 3); // drop b's first second
    expect(trackClips(start, MAIN_TRACK_ID).map((c) => [c.start, c.in, c.out])).toEqual([[0, 0, 2], [2, 1, 3], [4, 0, 1]]);
    expect(startOf(start, "m")).toBe(4);
    const end = rippleTrimTo(p, "b", "end", 3); // drop b's last two seconds
    expect(starts(end)).toEqual([0, 2, 3]);
    expect(rippleTrimTo(p, "b", "end", 2.01)).toBe(p);
  });
});

describe("deleting and gaps", () => {
  it("delete leaves a gap; ripple delete closes it", () => {
    expect(starts(removeClips(mainABC(), ["b"]))).toEqual([0, 5]);
    expect(starts(rippleDelete(mainABC(), ["b"]))).toEqual([0, 2]);
    expect(starts(rippleDelete(mainABC(), ["a", "b"]))).toEqual([0]);
  });

  it("ripple delete only shifts the tracks it removed from", () => {
    let p = mainABC();
    p = addClip(p, clip("m", AUDIO, 3, 1));
    const q = rippleDelete(p, ["a"]);
    expect(starts(q)).toEqual([0, 3]);
    expect(startOf(q, "m")).toBe(3);
  });

  it("finds and closes gaps", () => {
    const p = removeClips(mainABC(), ["b"]); // a 0..2, gap 2..5, c 5..6
    expect(gapAt(p, MAIN_TRACK_ID, 3)).toEqual({ start: 2, end: 5 });
    expect(gapAt(p, MAIN_TRACK_ID, 1)).toBeNull(); // inside a
    expect(gapAt(p, MAIN_TRACK_ID, 7)).toBeNull(); // after the last clip
    expect(starts(closeGap(p, MAIN_TRACK_ID, 3))).toEqual([0, 2]);
    const late = moveClip(mainABC(), "a", MAIN_TRACK_ID, 10);
    expect(gapAt(late, MAIN_TRACK_ID, 1)).toEqual({ start: 0, end: 2 });
  });

  it("lists edit points", () => {
    expect(editPoints(removeClips(mainABC(), ["b"]))).toEqual([0, 2, 5, 6]);
  });

  it("finds the edit point nearest a time (⌘ while scrubbing)", () => {
    const points = editPoints(removeClips(mainABC(), ["b"]));
    expect(nearestPoint(points, 4.2)).toBe(5);
    expect(nearestPoint(points, 0.9)).toBe(0);
    expect(nearestPoint(points, 3.5)).toBe(2); // a tie goes to the earlier one
    expect(nearestPoint(points, 40)).toBe(6);
    expect(nearestPoint([], 3)).toBe(3);
  });
});

describe("copy and paste", () => {
  it("pastes onto the original tracks when there's room", () => {
    const p = mainABC();
    const copied = copyClips(p, ["a", "c"]);
    const { project, clipIds } = pasteClips(p, copied, 10);
    expect(clipIds).toHaveLength(2);
    expect(starts(project)).toEqual([0, 2, 5, 10, 15]); // a@0, c@5 -> 10, 15
  });

  it("pastes onto new tracks when the spot is taken", () => {
    const p = mainABC();
    const { project, clipIds } = pasteClips(p, copyClips(p, ["b"]), 1);
    expect(project.tracks.filter((t) => t.kind === "video")).toHaveLength(2);
    const pasted = project.clips.find((c) => c.id === clipIds[0])!;
    expect(pasted.trackId).toBe(project.tracks[0].id); // new video track on top
    expect(pasted.start).toBe(1);
  });

  it("recreates a missing track of the right kind", () => {
    let p = mainABC();
    p = addClip(p, clip("m", AUDIO, 0, 1));
    const copied = copyClips(p, ["m"]);
    p = removeTrack(p, AUDIO);
    const { project } = pasteClips(p, copied, 0);
    expect(project.tracks.map((t) => t.kind)).toEqual(["video", "audio"]);
  });
});

describe("tracks", () => {
  it("adds video tracks on top and audio tracks at the bottom", () => {
    let p = createDefaultProject();
    const v = addTrack(p, "video");
    p = v.project;
    const a = addTrack(p, "audio");
    p = a.project;
    expect(p.tracks.map((t) => t.name)).toEqual(["Video 2", "Video 1", "Audio 1", "Audio 2"]);
    // Clamped so video stays above audio.
    const odd = addTrack(p, "video", 99);
    expect(odd.project.tracks.map((t) => t.kind)).toEqual(["video", "video", "video", "audio", "audio"]);
    expect(adjacentTrack(p, MAIN_TRACK_ID, -1)?.id).toBe(v.trackId);
    expect(adjacentTrack(p, MAIN_TRACK_ID, 1)).toBeNull(); // audio isn't the same kind
  });

  it("removes tracks but always keeps a video track", () => {
    let p = createDefaultProject();
    p = addClip(p, clip("m", AUDIO, 0, 1));
    p = removeTrack(p, AUDIO);
    expect(p.tracks).toHaveLength(1);
    expect(p.clips).toEqual([]);
    expect(removeTrack(p, MAIN_TRACK_ID)).toBe(p);
    const two = addTrack(p, "video").project;
    expect(removeTrack(two, MAIN_TRACK_ID).tracks).toHaveLength(1);
  });

  it("prunes empty extra tracks but keeps the home tracks", () => {
    const { project, trackId } = addTrack(createDefaultProject(), "video");
    expect(pruneEmptyTrack(project, trackId).tracks).toHaveLength(2);
    expect(pruneEmptyTrack(project, MAIN_TRACK_ID)).toBe(project); // bottom video track
    expect(pruneEmptyTrack(project, AUDIO)).toBe(project); // top audio track
    const used = addClip(project, clip("x", trackId, 0, 1));
    expect(pruneEmptyTrack(used, trackId)).toBe(used);
  });

  it("keeps only video-track clips without audio tracks", () => {
    let p = mainABC();
    const top = addTrack(p, "video");
    p = addClip(top.project, clip("t", top.trackId, 0, 1));
    p = addClip(p, clip("m", AUDIO, 0, 1));
    expect(withoutAudioTracks(p).clips.map((c) => c.id).sort()).toEqual(["a", "b", "c", "t"]);
  });

  it("finds the clip under a time", () => {
    const p = mainABC();
    expect(clipAtTime(p, MAIN_TRACK_ID, 0)?.id).toBe("a");
    expect(clipAtTime(p, MAIN_TRACK_ID, 2)?.id).toBe("b");
    expect(clipAtTime(p, MAIN_TRACK_ID, 5.999)?.id).toBe("c");
    expect(clipAtTime(p, MAIN_TRACK_ID, 6)).toBeUndefined();
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

  it("keeps several video tracks, above the audio tracks", () => {
    const base = createDefaultProject();
    const p = normalizeProject({
      ...base,
      tracks: [base.tracks[1], base.tracks[0], { id: "v2", kind: "video", name: "Video 2", muted: false }],
    });
    expect(p.tracks.map((t) => t.id)).toEqual([MAIN_TRACK_ID, "v2", AUDIO]);
    const noVideo = normalizeProject({ ...base, tracks: [base.tracks[1]] });
    expect(noVideo.tracks.map((t) => t.kind)).toEqual(["video", "audio"]);
  });

  it("drops invalid clips and resolves overlaps", () => {
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
      asset: { kind: "video", duration: 10, hasVideo: true, hasAudio: true },
      short: { kind: "audio", duration: 5, hasVideo: false, hasAudio: true },
    });
    expect(order(p)).toEqual(["a"]);
    expect(starts(p)).toEqual([5]);
    expect(starts(p, AUDIO)).toEqual([0, 2, 10]);
    expect(p.clips.find((c) => c.id === "long")!.out).toBe(5);
  });

  it("keeps still-image clips of any length, even starting before the image's 0", () => {
    const input: Project = { ...createDefaultProject(), clips: [clip("s", MAIN_TRACK_ID, 0, 30, { in: -10, out: 20 })] };
    const p = normalizeProject(input, { asset: { kind: "image", duration: 5, hasVideo: true, hasAudio: false } });
    expect(p.clips[0]).toMatchObject({ in: -10, out: 20 });
    // The same clip against a video is cut to the video's range.
    const v = normalizeProject(input, { asset: { kind: "video", duration: 5, hasVideo: true, hasAudio: false } });
    expect(v.clips[0]).toMatchObject({ in: 0, out: 5 });
  });

  it("keeps solids and adjustment layers on video tracks only, without media, and adjustment layers without transitions", () => {
    const solid = { ...newLayerClip("solid", 0, 2, { color: "#123456" }), trackId: MAIN_TRACK_ID };
    const adjust = { ...newLayerClip("adjustment", 2, 2), trackId: MAIN_TRACK_ID, transitionIn: createTransition("cross-dissolve") };
    const onAudio = { ...newLayerClip("adjustment", 0, 2), id: "heard", trackId: AUDIO };
    const p = normalizeProject({ ...createDefaultProject(), clips: [solid, adjust, onAudio] }, {});
    expect(p.clips.map((c) => clipKind(c))).toEqual(["solid", "adjustment"]);
    expect(p.clips[1]).not.toHaveProperty("transitionIn");
    expect(p.clips[1].adjustment).toBe(true);
    // A text or a solid can't also be an adjustment layer.
    const both = normalizeProject({ ...createDefaultProject(), clips: [{ ...solid, adjustment: true }] });
    expect(both.clips[0]).not.toHaveProperty("adjustment");
  });

  it("gives every clip its effects, upgrading old clips", () => {
    const old = { id: "o", assetId: "asset", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 1, volume: 0.3, fit: "cover" };
    const p = normalizeProject({ ...createDefaultProject(), clips: [old as unknown as Clip] });
    expect(p.clips[0]).not.toHaveProperty("volume");
    expect(p.clips[0]).not.toHaveProperty("fit");
    expect(volumeAt(p.clips[0], 0)).toBe(0.3);
    expect(motionAt(p.clips[0], 0).fit).toBe("cover");
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
    const now = new Date(2026, 8, 28, 12).getTime();
    expect(formatRelative(now - 10_000, now)).toBe("now");
    expect(formatRelative(now - 4 * 60_000, now)).toBe("4m");
    expect(formatRelative(now - 3 * 3600_000, now)).toBe("3h");
    expect(formatRelative(now - 2 * 86400_000, now)).toBe("2d");
    expect(formatRelative(now - 30 * 86400_000, now)).toMatch(/Aug/);
  });
});

describe("placement matches trying every position", () => {
  // The obvious O(n²) searches `findFreeStart` and `moveClips` replaced: every edge of every neighbour, tried
  // against every neighbour. Random timelines on a coarse grid (so clips touch and tie a lot) must agree.
  function referenceFreeStart(clips: Clip[], desired: number, duration: number): number {
    const fits = (s: number) =>
      s >= -1e-6 && clips.every((o) => s + duration <= o.start + 1e-6 || s >= clipEnd(o) - 1e-6);
    const candidates = [Math.max(0, desired), ...clips.map(clipEnd), ...clips.map((o) => o.start - duration)];
    let best = Infinity;
    for (const s of candidates) if (fits(s) && Math.abs(s - desired) < Math.abs(best - desired)) best = s;
    return Math.round(Math.max(0, best) * 1e6) / 1e6;
  }

  function referenceMoveDelta(p: Project, ids: Set<string>, delta: number): number {
    const moving = p.clips.filter((c) => ids.has(c.id));
    const obstacles = (c: Clip) => p.clips.filter((o) => o.trackId === c.trackId && !ids.has(o.id));
    const minStart = Math.min(...moving.map((c) => c.start));
    const fits = (d: number) =>
      minStart + d >= -1e-6 &&
      moving.every((c) => obstacles(c).every((o) => clipEnd(c) + d <= o.start + 1e-6 || c.start + d >= clipEnd(o) - 1e-6));
    const candidates = [delta, -minStart];
    let afterAll = -minStart;
    for (const c of moving) {
      for (const o of obstacles(c)) {
        candidates.push(clipEnd(o) - c.start, o.start - clipEnd(c));
        afterAll = Math.max(afterAll, clipEnd(o) - c.start);
      }
    }
    let best = afterAll;
    for (const d of candidates) if (fits(d) && Math.abs(d - delta) < Math.abs(best - delta) - 1e-6) best = d;
    return best;
  }

  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const grid = (max: number) => Math.round(random() * max * 4) / 4;

  function randomProject(): Project {
    let p = createDefaultProject();
    const count = 1 + Math.floor(random() * 12);
    for (let i = 0; i < count; i++) p = addClip(p, clip(`c${i}`, random() < 0.7 ? MAIN_TRACK_ID : AUDIO, grid(20), 0.25 + grid(3)));
    return p;
  }

  it("findFreeStart", () => {
    for (let i = 0; i < 2000; i++) {
      const clips = trackClips(randomProject(), MAIN_TRACK_ID) as Clip[];
      const desired = grid(24) - 2;
      const duration = 0.25 + grid(4);
      expect(findFreeStart(clips, desired, duration)).toBe(referenceFreeStart(clips, desired, duration));
    }
  });

  it("moveClips", () => {
    for (let i = 0; i < 2000; i++) {
      const p = randomProject();
      const ids = new Set(p.clips.filter(() => random() < 0.3).map((c) => c.id));
      if (ids.size === 0) ids.add(p.clips[0].id);
      const delta = grid(24) - 12;
      const moved = moveClips(p, [...ids], delta);
      const best = referenceMoveDelta(p, ids, delta);
      for (const c of p.clips) {
        const start = moved.clips.find((m) => m.id === c.id)!.start;
        expect(start).toBe(ids.has(c.id) ? Math.round(Math.max(0, c.start + best) * 1e6) / 1e6 : c.start);
      }
    }
  });

  it("stays fast with thousands of clips", () => {
    let p = createDefaultProject();
    const clips = Array.from({ length: 2000 }, (_, i) => clip(`c${i}`, MAIN_TRACK_ID, i, 0.8));
    p = { ...p, clips };
    const selected = clips.filter((_, i) => i % 5 === 0).map((c) => c.id); // 400 clips moving together
    const t0 = performance.now();
    moveClips(p, selected, 0.35);
    normalizeProject(p);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
