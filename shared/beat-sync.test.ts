import { describe, expect, it } from "vitest";
import { beatMarkerCount, beatMarks, cutToMarkers, setBeatMarkers } from "./beat-sync.ts";
import { defaultEffects } from "./effects.ts";
import { addClipMarker, addMarker, clipMarkers } from "./markers.ts";
import { normalizeProject } from "./normalize.ts";
import { MAIN_TRACK_ID, clipEnd, createDefaultProject, snapPoints, trackClips } from "./timeline.ts";
import type { Clip, MusicAnalysis, Project } from "./types.ts";

const music: MusicAnalysis = {
  bpm: 120, confidence: 0.9,
  beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
  downbeats: [0, 2, 4],
  sections: [],
  drops: [{ time: 2, rise: 9 }],
};
const base = createDefaultProject();
const audio = { id: "a1", kind: "audio" as const, name: "Audio 1", muted: false };
const clip = (id: string, start: number, length: number, over: Partial<Clip> = {}): Clip => ({
  id, assetId: "v", trackId: MAIN_TRACK_ID, start, in: 0, out: length, effects: defaultEffects(), ...over,
});
const song: Clip = { id: "song", assetId: "s", trackId: "a1", start: 0, in: 0, out: 10, effects: defaultEffects() };
const project = (clips: Clip[]): Project => ({ ...base, tracks: [...base.tracks.filter((t) => t.kind === "video"), audio], clips: [...clips, song] });
const media = () => ({ min: 0, max: 3 });
const layout = (p: Project) => trackClips(p, MAIN_TRACK_ID).map((c) => [c.id, c.start, clipEnd(c)]);

describe("marking a song's beats", () => {
  it("picks beats, bars or drops, and tells bars and drops apart", () => {
    expect(beatMarks(music, "beats")).toHaveLength(9);
    expect(beatMarks(music, "beats").slice(0, 5)).toEqual([{ time: 0, color: "blue" }, { time: 0.5 }, { time: 1 }, { time: 1.5 }, { time: 2, label: "Drop", color: "red" }]);
    expect(beatMarks(music, "bars").map((m) => m.time)).toEqual([0, 2, 4]);
    expect(beatMarks(music, "drops")).toEqual([{ time: 2, label: "Drop", color: "red" }]);
  });

  it("puts them on the clip, replacing the beats it had and keeping the user's own markers", () => {
    const own = addClipMarker(project([]), "song", 1, { label: "mine" }).project;
    const marked = setBeatMarkers(own, "song", beatMarks(music, "beats"));
    const markers = marked.clips.find((c) => c.id === "song")!.markers!;
    // The beat at 1 s gave way to the marker already there.
    expect(markers).toHaveLength(9);
    expect(markers.find((m) => m.time === 1)).toMatchObject({ label: "mine" });
    expect(beatMarkerCount(marked.clips.find((c) => c.id === "song")!)).toBe(8);
    const bars = setBeatMarkers(marked, "song", beatMarks(music, "bars"));
    expect(bars.clips.find((c) => c.id === "song")!.markers!.map((m) => [m.time, !!m.beat])).toEqual([[0, true], [1, false], [2, true], [4, true]]);
    // Cleared: only the user's is left. Nothing to clear: nothing changes.
    const cleared = setBeatMarkers(bars, "song", []);
    expect(cleared.clips.find((c) => c.id === "song")!.markers).toEqual([expect.objectContaining({ label: "mine" })]);
    expect(setBeatMarkers(cleared, "song", [])).toBe(cleared);
    expect(normalizeProject(JSON.parse(JSON.stringify(marked))).clips.find((c) => c.id === "song")!.markers).toEqual(markers);
    // They move with the song, and clips snap to them.
    expect(snapPoints(marked, 99, "x")).toEqual(expect.arrayContaining([0.5, 1.5, 2.5]));
    expect(clipMarkers({ ...marked.clips.find((c) => c.id === "song")!, start: 3 })[1].time).toBe(3.5);
  });
});

describe("cutting to the beat", () => {
  const beats = (p: Project) => setBeatMarkers(p, "song", beatMarks(music, "beats"));

  it("ends each clip on the marker nearest its end, keeping clips back to back", () => {
    const p = beats(project([clip("a", 0, 1.2), clip("b", 1.2, 0.7), clip("c", 1.9, 1.4)]));
    const cut = cutToMarkers(p, ["a", "b", "c"], { range: media });
    // 1.2 → 1; then 1..1.7 → 1.5; then 1.5..2.9 → 3.
    expect(layout(cut.project)).toEqual([["a", 0, 1], ["b", 1, 1.5], ["c", 1.5, 3]]);
    expect(cut.moved).toBe(3);
    expect(cutToMarkers(cut.project, ["a", "b", "c"], { range: media }).project).toBe(cut.project);
  });

  it("cuts on every Nth marker, moves what comes after, and leaves the rest of the timeline alone", () => {
    const p = beats(project([clip("a", 0, 1.2), clip("b", 1.2, 0.7), clip("later", 4, 1)]));
    const cut = cutToMarkers(p, ["a", "b"], { every: 2, range: media });
    // A cut every second beat; the clip after them moves up by as much as they grew (0.1 s).
    expect(layout(cut.project)).toEqual([["a", 0, 1], ["b", 1, 2], ["later", 4.1, 5.1]]);
    expect(cut.project.clips.find((c) => c.id === "song")).toBe(p.clips.find((c) => c.id === "song"));
  });

  it("only makes a clip as long as its media goes, and cuts reversed ones at their in-point", () => {
    // Eight beats on would be 4 s, but the file is 3 s: it ends on the last marker it reaches.
    const p = beats(project([clip("a", 0, 2.8)]));
    expect(layout(cutToMarkers(p, ["a"], { every: 8, range: media }).project)).toEqual([["a", 0, 3]]);
    // A reversed one ends where its source starts, so it grows by reaching back: 2 s of it at most.
    const r = beats(project([clip("b", 0, 1, { reversed: true, in: 1, out: 2 })]));
    const b = cutToMarkers(r, ["b"], { every: 8, range: media }).project.clips.find((c) => c.id === "b")!;
    expect([b.start, b.in, b.out]).toEqual([0, 0, 2]);
  });

  it("uses any marker on the timeline, but not the song's own clip or the cut clips' own markers", () => {
    const p = addMarker(addMarker(project([clip("a", 0, 1.2)]), 1.4).project, 3).project;
    expect(layout(cutToMarkers(p, ["a"], { range: media }).project)).toEqual([["a", 0, 1.4]]);
    // The song selected along with the clips is left as it is.
    const marked = beats(project([clip("a", 0, 1.2)]));
    const both = cutToMarkers(marked, ["a", "song"], { range: media });
    expect(layout(both.project)).toEqual([["a", 0, 1]]);
    expect(clipEnd(both.project.clips.find((c) => c.id === "song")!)).toBe(10);
    // No markers: nothing to cut to.
    expect(cutToMarkers(project([clip("a", 0, 1.2)]), ["a"], { range: media })).toEqual({ project: expect.anything(), moved: 0 });
    // A text (no source range) can be any length.
    const text = beats(project([clip("t", 0, 0.6, { assetId: "" })]));
    expect(layout(cutToMarkers(text, ["t"], { every: 7, range: () => undefined }).project)).toEqual([["t", 0, 3.5]]);
  });
});
