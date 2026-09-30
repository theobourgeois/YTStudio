import { describe, expect, it } from "vitest";
import { defaultEffects, setParams } from "./effects.ts";
import { normalizeProject } from "./normalize.ts";
import {
  breakApart,
  canNestIn,
  createSequence,
  deleteSequence,
  getSequence,
  nestClips,
  sequenceAsset,
  sequenceClip,
  sequenceDuration,
  sequenceView,
  writeSequence,
} from "./sequences.ts";
import { MAIN_TRACK_ID, addTrack, clipEnd, createDefaultProject, getClip, trackClips } from "./timeline.ts";
import type { Clip, Project } from "./types.ts";

const clip = (id: string, trackId: string, start: number, length: number, inPoint = 0): Clip => ({
  id, assetId: "m", trackId, start, in: inPoint, out: inPoint + length, effects: defaultEffects(),
});

/** Two clips on the main track (0-2, 2-5), a title above (1-3) and a song (0-6). */
function edit(): Project {
  const top = addTrack(createDefaultProject(), "video", 0);
  return {
    ...top.project,
    clips: [clip("a", MAIN_TRACK_ID, 0, 2), clip("b", MAIN_TRACK_ID, 2, 3, 1), clip("t", top.trackId, 1, 2), clip("song", "audio_1", 0, 6)],
  };
}
const assets = { m: { kind: "video" as const, duration: 20, hasVideo: true, hasAudio: true } };

describe("nested sequences", () => {
  it("nests clips into a sequence played by one clip in their place", () => {
    const p = edit();
    const nested = nestClips(p, ["b", "t"], "Titles")!;
    const seq = getSequence(nested.project, nested.sequenceId)!;
    expect(seq.name).toBe("Titles");
    // Their tracks, the earliest starting at 0.
    expect(seq.tracks.map((t) => t.kind)).toEqual(["video", "video"]);
    expect(seq.clips.map((c) => [c.id, c.start])).toEqual([["b", 1], ["t", 0]]);
    expect(sequenceDuration(seq)).toBe(4);
    const nest = getClip(nested.project, nested.clipId)!;
    // On the top track it was on, where the first clip started, as long as they were.
    expect([nest.trackId, nest.start, nest.in, nest.out]).toEqual([p.tracks[0].id, 1, 0, 4]);
    expect(nested.project.clips.some((c) => c.id === "b" || c.id === "t")).toBe(false);
    // It describes itself as media for trimming and retiming.
    expect(sequenceAsset(seq)).toMatchObject({ kind: "video", duration: 4, width: 1080, height: 1920, sequence: true });
  });

  it("edits a sequence through a view shaped like a project", () => {
    const { project, sequenceId } = nestClips(edit(), ["b", "t"])!;
    const view = sequenceView(project, sequenceId);
    expect(view.clips).toBe(getSequence(project, sequenceId)!.clips);
    expect(sequenceView(project, sequenceId)).toBe(view);
    const edited = setParams(view, "b", "motion", { scale: 2 });
    const back = writeSequence(project, sequenceId, edited);
    expect(getSequence(back, sequenceId)!.clips.find((c) => c.id === "b")!.effects[0].params.scale).toBe(2);
    expect(back.clips).toBe(project.clips);
    expect(writeSequence(project, sequenceId, view)).toBe(project);
    expect(sequenceView(project, null)).toBe(project);
  });

  it("breaks a nested clip apart into the part it plays", () => {
    const { project, clipId } = nestClips(edit(), ["a", "b", "t"])!;
    // Trim the nest to 1.5..4.5 of its sequence, at 10 on the timeline.
    const trimmed = { ...project, clips: project.clips.map((c) => (c.id === clipId ? { ...c, start: 10, in: 1.5, out: 4.5 } : c)) };
    const res = breakApart(trimmed, clipId)!;
    const placed = res.clipIds.map((id) => getClip(res.project, id)!);
    expect(placed.map((c) => [c.start, clipEnd(c), c.in]).sort((x, y) => x[0] - y[0] || x[1] - y[1])).toEqual([
      [10, 10.5, 1.5], // the end of a
      [10, 11.5, 0.5], // the rest of the title
      [10.5, 13, 1], // b, up to where the nest ended
    ]);
    expect(res.project.clips.some((c) => c.id === clipId)).toBe(false);
    // A retimed nest can't be put back as it plays.
    expect(breakApart({ ...trimmed, clips: trimmed.clips.map((c) => (c.id === clipId ? { ...c, speed: 2 } : c)) }, clipId)).toBeNull();
  });

  it("never lets a sequence contain itself, and drops clips of missing sequences", () => {
    const a = createSequence(createDefaultProject(), { name: "A" });
    const b = createSequence(a.project, { name: "B" });
    let p = b.project;
    // B plays A.
    p = writeSequence(p, b.sequenceId, { ...sequenceView(p, b.sequenceId), clips: [sequenceClip(getSequence(p, a.sequenceId)!, MAIN_TRACK_ID, 0)] });
    expect(canNestIn(p, a.sequenceId, b.sequenceId)).toBe(false);
    expect(canNestIn(p, b.sequenceId, a.sequenceId)).toBe(true);
    expect(canNestIn(p, a.sequenceId, a.sequenceId)).toBe(false);
    // A loop saved anyway is broken on load, and so is a clip of a sequence that's gone.
    const aClips = [{ ...sequenceClip(getSequence(p, b.sequenceId)!, MAIN_TRACK_ID, 0), out: 1 }];
    const looped = writeSequence(p, a.sequenceId, { ...sequenceView(p, a.sequenceId), clips: aClips });
    const loaded = normalizeProject(
      { ...looped, clips: [{ ...clip("x", MAIN_TRACK_ID, 0, 1), assetId: "seq_gone" }] },
      assets,
    );
    const inA = getSequence(loaded, a.sequenceId)!.clips.length;
    const inB = getSequence(loaded, b.sequenceId)!.clips.length;
    expect(inA + inB).toBe(1);
    expect(loaded.clips).toEqual([]);
  });

  it("keeps sequences and their clips through normalising", () => {
    const { project, sequenceId, clipId } = nestClips(edit(), ["b", "t"])!;
    const loaded = normalizeProject(JSON.parse(JSON.stringify(project)), assets);
    expect(getSequence(loaded, sequenceId)!.clips).toHaveLength(2);
    expect(getClip(loaded, clipId)).toMatchObject({ assetId: sequenceId, in: 0, out: 4 });
    // A nest can be longer than its sequence (it shows nothing past its end).
    const long = normalizeProject({ ...project, clips: project.clips.map((c) => (c.id === clipId ? { ...c, out: 30 } : c)) }, assets);
    expect(getClip(long, clipId)!.out).toBe(30);
  });

  it("deletes a sequence with the clips that play it", () => {
    const { project, sequenceId } = nestClips(edit(), ["b", "t"])!;
    const p = deleteSequence(project, sequenceId);
    expect(p.sequences).toEqual([]);
    expect(trackClips(p, MAIN_TRACK_ID).map((c) => c.id)).toEqual(["a"]);
  });
});
