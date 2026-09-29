// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@shared/types";
import { MAIN_TRACK_ID, createDefaultProject, getClip, moveClip, trackClips } from "@shared/timeline";

vi.mock("@/lib/api", () => ({
  ApiRequestError: class extends Error {},
  api: {
    saveProject: vi.fn(async () => {}),
    deleteMedia: vi.fn(async () => {}),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const { useEditor } = await import("./editor");
const { usePlayback } = await import("./playback");
const { useSourceMarks } = await import("./source-marks");

function asset(id: string, duration: number, kind: "video" | "audio" = "video"): MediaAsset {
  return {
    id, projectId: "p1", name: `${id}.mp4`, kind, duration, width: 1080, height: 1920, fps: 30,
    hasVideo: kind === "video", hasAudio: true, size: 1, createdAt: 0, status: "ready",
    src: `/files/media/${id}/source.mp4`, poster: null, filmstrip: null, waveform: null,
  };
}

const store = () => useEditor.getState();
const mainIds = () => trackClips(store().project, MAIN_TRACK_ID).map((c) => c.assetId);

beforeEach(() => {
  useEditor.setState({
    projectId: "p1",
    project: createDefaultProject(),
    assets: [asset("a", 2), asset("b", 3), asset("c", 1), asset("song", 20, "audio")],
    past: [],
    future: [],
    gestureBase: null,
    selectedClipIds: [],
    clipboard: [],
    autoRipple: false,
  });
  usePlayback.getState().seek(0);
  useSourceMarks.setState({ marks: {} });
});

describe("editor store", () => {
  it("with Auto ripple, deleting closes the gap and dropped media pushes the rest along", () => {
    const [a, b, c] = store().addAssetsToTimeline(["a", "b", "c"]); // 0-2, 2-5, 5-6
    store().toggleAutoRipple();
    store().select(b);
    store().deleteSelected();
    expect(mainIds()).toEqual(["a", "c"]);
    expect(getClip(store().project, c)!.start).toBe(2);
    // Dropped at the cut between a and c: c moves right to make room.
    const [inserted] = store().addAssetsToTimeline(["b"], { trackId: MAIN_TRACK_ID, at: 2 });
    expect(mainIds()).toEqual(["a", "b", "c"]);
    expect(getClip(store().project, inserted)!.start).toBe(2);
    expect(getClip(store().project, c)!.start).toBe(5);
    expect(getClip(store().project, a)!.start).toBe(0);
    store().toggleAutoRipple();
  });

  it("adds only the part of a file between its In and Out marks", () => {
    useSourceMarks.getState().mark("b", "in", 0.5, 3);
    useSourceMarks.getState().mark("b", "out", 2, 3);
    const [a, b] = store().addAssetsToTimeline(["a", "b"]);
    expect(getClip(store().project, a)).toMatchObject({ in: 0, out: 2, start: 0 });
    expect(getClip(store().project, b)).toMatchObject({ in: 0.5, out: 2, start: 2 });
    // Ranges given explicitly win over the marks.
    const [whole] = store().addAssetsToTimeline(["b"], { ranges: {} });
    expect(getClip(store().project, whole)).toMatchObject({ in: 0, out: 3 });
  });

  it("routes assets to the right tracks as one undo step", () => {
    store().addAssetsToTimeline(["a", "song", "b"]);
    expect(mainIds()).toEqual(["a", "b"]);
    expect(trackClips(store().project, "audio_1").map((c) => c.assetId)).toEqual(["song"]);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().project.clips).toEqual([]);
  });

  it("a gesture is one undo step, and cancelling restores the start", () => {
    store().addAssetsToTimeline(["a", "b"]);
    const [first] = trackClips(store().project, MAIN_TRACK_ID);
    const id = store().beginGesture();
    store().preview(() => moveClip(store().gestureBase!, first.id, MAIN_TRACK_ID, 10));
    expect(mainIds()).toEqual(["b", "a"]);
    store().cancelGesture(id);
    expect(mainIds()).toEqual(["a", "b"]);

    const id2 = store().beginGesture();
    store().preview(() => moveClip(store().gestureBase!, first.id, MAIN_TRACK_ID, 10));
    store().endGesture(id2);
    expect(store().past).toHaveLength(2);
    store().undo();
    expect(mainIds()).toEqual(["a", "b"]);
  });

  it("an edit arriving mid-gesture finalises the gesture instead of being lost", () => {
    store().addAssetsToTimeline(["a", "b"]);
    const [first] = trackClips(store().project, MAIN_TRACK_ID);
    const id = store().beginGesture();
    store().preview(() => moveClip(store().gestureBase!, first.id, MAIN_TRACK_ID, 10));
    // e.g. an upload that was dropped on the timeline finishes during the drag
    store().addAssetsToTimeline(["c"]);
    expect(store().gestureBase).toBeNull();
    expect(mainIds()).toEqual(["b", "a", "c"]);
    // The drag's own end/cancel are now stale and must not touch anything.
    store().cancelGesture(id);
    store().endGesture(id);
    expect(mainIds()).toEqual(["b", "a", "c"]);
    // Undo steps: add c, the drag, the initial add.
    store().undo();
    expect(mainIds()).toEqual(["b", "a"]);
    store().undo();
    expect(mainIds()).toEqual(["a", "b"]);
  });

  it("deleting media mid-gesture keeps the gesture usable", async () => {
    store().addAssetsToTimeline(["a", "b"]);
    const id = store().beginGesture();
    await store().deleteAsset("b");
    expect(store().gestureBase).not.toBeNull();
    store().endGesture(id);
    expect(store().gestureBase).toBeNull();
    expect(mainIds()).toEqual(["a"]);
    store().undo();
    expect(mainIds()).toEqual([]);
  });

  it("previews are ignored without an active gesture", () => {
    store().addAssetsToTimeline(["a"]);
    const before = store().project;
    store().preview(() => createDefaultProject());
    expect(store().project).toBe(before);
  });

  it("puts assets dropped above the tracks on a new video track", () => {
    store().addAssetsToTimeline(["a"]);
    const [created] = store().addAssetsToTimeline(["b", "song"], { newTrack: "above", at: 1 });
    const { tracks } = store().project;
    expect(tracks.map((t) => t.kind)).toEqual(["video", "video", "audio"]);
    expect(getClip(store().project, created)).toMatchObject({ trackId: tracks[0].id, start: 1 });
    // The song can't go on a video track, so it goes to the audio track as usual.
    expect(trackClips(store().project, "audio_1").map((c) => c.assetId)).toEqual(["song"]);
    expect(store().past).toHaveLength(2);
  });

  it("copies, pastes at the playhead and duplicates", () => {
    const [a] = store().addAssetsToTimeline(["a"]);
    store().select(a);
    store().copySelected();
    usePlayback.getState().seek(1); // over a: no room on the track -> new track on top
    store().paste();
    const pasted = store().selectedClipIds;
    expect(pasted).toHaveLength(1);
    expect(getClip(store().project, pasted[0])).toMatchObject({ start: 1, assetId: "a" });
    expect(store().project.tracks.filter((t) => t.kind === "video")).toHaveLength(2);

    store().select(a);
    store().duplicateSelected();
    const [dup] = store().selectedClipIds;
    expect(getClip(store().project, dup)).toMatchObject({ trackId: MAIN_TRACK_ID, start: 2 });
  });

  it("cut removes the selection and pastes it back", () => {
    const [a, b] = store().addAssetsToTimeline(["a", "b"]);
    store().setSelection([a, b]);
    store().cutSelected();
    expect(store().project.clips).toEqual([]);
    store().paste(4);
    expect(mainIds()).toEqual(["a", "b"]);
    expect(trackClips(store().project, MAIN_TRACK_ID).map((c) => c.start)).toEqual([4, 6]);
  });

  it("splits the video under the playhead when nothing is selected", () => {
    store().addAssetsToTimeline(["a", "song"]);
    store().select(null);
    usePlayback.getState().seek(1);
    store().splitAtPlayhead();
    expect(trackClips(store().project, MAIN_TRACK_ID)).toHaveLength(2);
    expect(trackClips(store().project, "audio_1")).toHaveLength(1);
  });

  it("nudges only when there's room", () => {
    const [a, b] = store().addAssetsToTimeline(["a", "b"]);
    store().select(a);
    store().nudgeSelected(0.5); // would overlap b
    expect(getClip(store().project, a)!.start).toBe(0);
    store().select(b);
    store().nudgeSelected(0.5);
    expect(getClip(store().project, b)!.start).toBe(2.5);
    store().select(a);
    store().nudgeSelected(0.5);
    expect(getClip(store().project, a)!.start).toBe(0.5);
  });

  it("moves the selection to a new track above, and back down", () => {
    const [a] = store().addAssetsToTimeline(["a"]);
    store().select(a);
    store().moveSelectedToTrack(1); // no video track below the bottom one
    expect(store().past).toHaveLength(1);
    store().moveSelectedToTrack(-1);
    const top = store().project.tracks[0];
    expect(getClip(store().project, a)!.trackId).toBe(top.id);
    expect(store().project.tracks).toHaveLength(3); // the home video track stays
    store().moveSelectedToTrack(1);
    expect(getClip(store().project, a)!.trackId).toBe(MAIN_TRACK_ID);
    expect(store().project.tracks).toHaveLength(2); // the emptied extra track goes away
  });

  it("ripple-trims to the playhead", () => {
    store().addAssetsToTimeline(["a", "b"]);
    store().select(null);
    usePlayback.getState().seek(0.5);
    store().trimToPlayhead("start");
    expect(trackClips(store().project, MAIN_TRACK_ID).map((c) => [c.start, c.in, c.out])).toEqual([
      [0, 0.5, 2],
      [1.5, 0, 3],
    ]);
    expect(usePlayback.getState().time).toBe(0);
  });
});
