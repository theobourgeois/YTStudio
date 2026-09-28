// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@shared/types";
import { MAIN_TRACK_ID, createDefaultProject, moveClip, trackClips } from "@shared/timeline";

vi.mock("@/lib/api", () => ({
  ApiRequestError: class extends Error {},
  api: {
    saveProject: vi.fn(async () => {}),
    deleteMedia: vi.fn(async () => {}),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const { useEditor } = await import("./editor");

function asset(id: string, duration: number, kind: "video" | "audio" = "video"): MediaAsset {
  return {
    id, name: `${id}.mp4`, kind, duration, width: 1080, height: 1920, fps: 30,
    hasVideo: kind === "video", hasAudio: true, size: 1, createdAt: 0, status: "ready",
    src: `/files/media/${id}/source.mp4`, poster: null, filmstrip: null, waveform: null,
  };
}

const store = () => useEditor.getState();
const mainIds = () => trackClips(store().project, MAIN_TRACK_ID).map((c) => c.assetId);

beforeEach(() => {
  useEditor.setState({
    project: createDefaultProject(),
    assets: [asset("a", 2), asset("b", 3), asset("c", 1), asset("song", 20, "audio")],
    past: [],
    future: [],
    gestureBase: null,
    selectedClipId: null,
  });
});

describe("editor store", () => {
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
    store().preview(() => moveClip(store().gestureBase!, first.id, MAIN_TRACK_ID, 10, 10));
    expect(mainIds()).toEqual(["b", "a"]);
    store().cancelGesture(id);
    expect(mainIds()).toEqual(["a", "b"]);

    const id2 = store().beginGesture();
    store().preview(() => moveClip(store().gestureBase!, first.id, MAIN_TRACK_ID, 10, 10));
    store().endGesture(id2);
    expect(store().past).toHaveLength(2);
    store().undo();
    expect(mainIds()).toEqual(["a", "b"]);
  });

  it("an edit arriving mid-gesture finalises the gesture instead of being lost", () => {
    store().addAssetsToTimeline(["a", "b"]);
    const [first] = trackClips(store().project, MAIN_TRACK_ID);
    const id = store().beginGesture();
    store().preview(() => moveClip(store().gestureBase!, first.id, MAIN_TRACK_ID, 10, 10));
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
});
