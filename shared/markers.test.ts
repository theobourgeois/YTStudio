import { describe, expect, it } from "vitest";
import { defaultEffects } from "./effects.ts";
import {
  addClipMarker,
  addMarker,
  adjacentMarker,
  allMarkers,
  clipMarkers,
  markerAt,
  normalizeMarkers,
  removeClipMarkers,
  removeMarkers,
  sequenceMarkers,
  updateClipMarker,
  updateMarker,
} from "./markers.ts";
import { normalizeProject } from "./normalize.ts";
import { nestClips, sequenceView, writeSequence } from "./sequences.ts";
import { MAIN_TRACK_ID, createDefaultProject, moveClips, snapPoints, splitClip, trimClip } from "./timeline.ts";
import type { Clip, Project } from "./types.ts";

// Plays source 10..20 from timeline time 2.
const clip: Clip = { id: "c", assetId: "a", trackId: MAIN_TRACK_ID, start: 2, in: 10, out: 20, effects: defaultEffects() };
const project: Project = { ...createDefaultProject(), clips: [clip] };
const times = (p: Project) => sequenceMarkers(p).map((m) => m.time);

describe("sequence markers", () => {
  it("are added in time order, one per time", () => {
    let p = addMarker(project, 5, { label: "  Drop  ", color: "red" }).project;
    const first = addMarker(p, 1);
    p = first.project;
    expect(sequenceMarkers(p).map((m) => [m.time, m.label, m.color])).toEqual([[1, undefined, undefined], [5, "Drop", "red"]]);
    // M on a marker (within half a frame) finds it rather than stacking another.
    const again = addMarker(p, 1.01, {}, 1 / 60);
    expect(again.project).toBe(p);
    expect(again.id).toBe(first.id);
    expect(addMarker(p, -3).project.markers![0].time).toBe(0);
  });

  it("are moved, renamed, recoloured and removed", () => {
    const made = addMarker(addMarker(project, 1).project, 5);
    const moved = updateMarker(made.project, made.id, { time: 0.5, label: "Intro" });
    expect(sequenceMarkers(moved).map((m) => [m.time, m.label])).toEqual([[0.5, "Intro"], [1, undefined]]);
    expect(updateMarker(moved, made.id, { label: "Intro" })).toBe(moved);
    expect(updateMarker(moved, made.id, { label: "" }).markers![0]).not.toHaveProperty("label");
    // The default colour isn't stored; moving onto another marker replaces it.
    expect(updateMarker(updateMarker(moved, made.id, { color: "blue" }), made.id, { color: "green" }).markers![0]).not.toHaveProperty("color");
    expect(times(updateMarker(moved, made.id, { time: 1 }))).toEqual([1]);
    expect(removeMarkers(moved, [made.id]).markers).toHaveLength(1);
    expect(removeMarkers(removeMarkers(moved, [made.id]), [moved.markers![0].id, moved.markers![1].id])).not.toHaveProperty("markers");
    expect(removeMarkers(moved, ["nope"])).toBe(moved);
  });

  it("belong to their sequence", () => {
    const marked = addMarker(project, 3).project;
    const nested = nestClips(marked, ["c"])!;
    const id = nested.project.sequences![0].id;
    // The nest has none of its own; adding one inside doesn't touch the main sequence's.
    const view = sequenceView(nested.project, id);
    expect(sequenceMarkers(view)).toEqual([]);
    const written = writeSequence(nested.project, id, addMarker(view, 1, { label: "inside" }).project);
    expect(times(written)).toEqual([3]);
    expect(written.sequences![0].markers!.map((m) => m.label)).toEqual(["inside"]);
    expect(sequenceMarkers(sequenceView(written, id)).map((m) => m.time)).toEqual([1]);
    expect(normalizeProject(JSON.parse(JSON.stringify(written))).sequences![0].markers).toEqual(written.sequences![0].markers);
  });
});

describe("clip markers", () => {
  const made = addClipMarker(project, "c", 5, { label: "hit" });
  const only = (p: Project) => p.clips[0];

  it("are kept in source time, so they stay on their frame", () => {
    expect(only(made.project).markers).toEqual([{ id: made.id, time: 13, label: "hit" }]);
    expect(clipMarkers(only(made.project)).map((m) => m.time)).toEqual([5]);
    // The clip moves: so does the marker.
    const moved = moveClips(made.project, ["c"], 4);
    expect(clipMarkers(only(moved)).map((m) => m.time)).toEqual([9]);
    // Trimmed away, it doesn't show (but comes back when the clip is opened up again).
    const trimmed = trimClip(made.project, "c", "start", 6, { min: 0, max: 30 });
    expect(clipMarkers(only(trimmed))).toEqual([]);
    expect(only(trimmed).markers).toHaveLength(1);
    // Split: it shows on the half that has its frame.
    const split = splitClip(made.project, "c", 4).project;
    expect(split.clips.map((c) => clipMarkers(c).map((m) => m.time))).toEqual([[], [5]]);
    expect(addClipMarker(project, "c", 40).id).toBeNull();
  });

  it("are changed and removed", () => {
    const moved = updateClipMarker(made.project, "c", made.id!, { time: 6, color: "yellow" });
    expect(only(moved).markers).toEqual([{ id: made.id, time: 14, label: "hit", color: "yellow" }]);
    expect(only(removeClipMarkers(moved, "c", [made.id!]))).not.toHaveProperty("markers");
    expect(normalizeProject(JSON.parse(JSON.stringify(moved))).clips[0].markers).toEqual(only(moved).markers);
  });

  it("are found with the sequence's, and snapped to", () => {
    const p = addMarker(made.project, 1, { label: "start" }).project;
    expect(allMarkers(p).map((m) => [m.time, m.clipId])).toEqual([[1, undefined], [5, "c"]]);
    expect(adjacentMarker(p, 1, 1)?.time).toBe(5);
    expect(adjacentMarker(p, 5, -1)?.time).toBe(1);
    expect(adjacentMarker(p, 5, 1)).toBeNull();
    expect(markerAt(p, 5.01, 0.02)?.marker.id).toBe(made.id);
    expect(markerAt(p, 3, 0.02)).toBeNull();
    expect(snapPoints(p, 0).sort((a, b) => a - b)).toEqual([0, 1, 2, 5, 12]);
    // A clip being dragged isn't a target, nor are its markers.
    expect(snapPoints(p, 0, "c").sort((a, b) => a - b)).toEqual([0, 1]);
  });
});

describe("markers from storage", () => {
  it("are repaired: valid ones only, sorted, one per id and time", () => {
    expect(
      normalizeMarkers(
        [
          { id: "b", time: 4, label: "x".repeat(300), color: "pink" },
          { id: "a", time: 1, color: "green" },
          { id: "a", time: 2 },
          { id: "c", time: 4 },
          { id: "d", time: "soon" },
          { id: "e", time: -2 },
          null,
        ],
        0,
      ),
    ).toEqual([{ id: "e", time: 0 }, { id: "a", time: 1 }, { id: "b", time: 4, label: "x".repeat(200) }]);
    expect(normalizeMarkers("nope")).toEqual([]);
  });
});
