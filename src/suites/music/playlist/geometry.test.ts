import { describe, expect, it } from "vitest";
import { addClips, clipContext } from "@shared/music/playlist";
import { DEFAULT_PLAYLIST_TRACK, createMusicProject } from "@shared/music/project";
import type { PlaylistClip } from "@shared/music/types";
import { applyDrag, rectSelection, shownSelection } from "./drag";
import { MAX_PX_PER_TICK, MIN_TRACKS, MIN_ZOOM_OUT_BARS, SPARE_TRACKS, hitClip, minPxPerTick, paintClipStarts, scrollViewBy, shownTracks, tickToX, trackLayout, trackTop, visibleTracks, xToTick, yToTrack, zoomAt, zoomTracksAt } from "./geometry";
import type { PlaylistView } from "./store";

const view: PlaylistView = { scrollTick: 0, pxPerTick: 0.25, scrollY: 0, trackHeight: 40 };
const song = createMusicProject();
const ctx = clipContext(song);
const clips = (list: Partial<PlaylistClip>[]) => addClips([], list.map((c) => ({ kind: "pattern" as const, ref: song.patterns[0].id, track: 0, start: 0, ...c }))).clips;

describe("the Playlist's tracks on screen", () => {
  it("are as tall as their size says, one after another", () => {
    const tracks = [DEFAULT_PLAYLIST_TRACK, { ...DEFAULT_PLAYLIST_TRACK, size: 2 }, { ...DEFAULT_PLAYLIST_TRACK, size: 0.5 }];
    const layout = trackLayout(tracks, 4, 40);
    expect(layout).toEqual([0, 40, 120, 140, 180]);
    expect(trackLayout(tracks, 4, 40)).toBe(layout);
    expect([0, 39, 40, 119, 120, 139, 140, 500].map((y) => yToTrack(layout, view, y))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    // Scrolled down.
    const down = { ...view, scrollY: 50 };
    expect(yToTrack(layout, down, 0)).toBe(1);
    expect(trackTop(layout, down, 2)).toBe(70);
    expect(visibleTracks(layout, down, 80)).toEqual([1, 2]);
  });

  it("are those in use and some spare, enough to fill the view", () => {
    expect(shownTracks([], [], 40, 0, 300)).toBe(MIN_TRACKS);
    expect(shownTracks(clips([{ track: 30 }]), [], 40, 0, 300)).toBe(31 + SPARE_TRACKS);
    expect(shownTracks([], [], 40, 0, 2000)).toBeGreaterThanOrEqual(50);
  });
});

describe("a clip under the pointer", () => {
  const list = clips([{ start: 384, track: 1, length: 384 }]);
  const layout = trackLayout([], 8, 40);
  it("is found by its track and time, its edges a few pixels in", () => {
    const x = (tick: number) => tickToX(view, tick);
    expect(hitClip(list, ctx, layout, view, x(500), 50)).toMatchObject({ clip: { start: 384 }, edge: null });
    expect(hitClip(list, ctx, layout, view, x(384) + 2, 50)?.edge).toBe("start");
    expect(hitClip(list, ctx, layout, view, x(768) - 2, 50)?.edge).toBe("end");
    expect(hitClip(list, ctx, layout, view, x(500), 10)).toBeNull();
    expect(hitClip(list, ctx, layout, view, x(800), 50)).toBeNull();
  });
});

describe("an audio clip's handles", () => {
  const audioSong = { ...song, channels: [{ ...song.channels[0], id: "chan_vox", kind: "audio" as const }] };
  const audioCtx = clipContext(audioSong);
  const audio = (c: Partial<PlaylistClip>) => addClips([], [{ kind: "audio", ref: "chan_vox", track: 0, start: 0, length: 384, ...c }]).clips;
  const layout = trackLayout([], 8, 60);
  const wide = { ...view, pxPerTick: 1 };

  it("sit at its fades' corners, its curves' middles and its bottom's middle, before its edges", () => {
    const [clip] = audio({ fadeIn: 96, fadeOut: 48 });
    // The track is 60 px: its body from 13 (under the title) to 58.
    expect(hitClip([clip], audioCtx, layout, wide, 96, 16)).toMatchObject({ handle: "fadeIn", edge: null });
    expect(hitClip([clip], audioCtx, layout, wide, 384 - 48, 16)?.handle).toBe("fadeOut");
    expect(hitClip([clip], audioCtx, layout, wide, 192, 55)?.handle).toBe("gain");
    expect(hitClip([clip], audioCtx, layout, wide, 48, 58 - 0.5 * 45)?.handle).toBe("fadeInTension");
    // No fade: its corner just inside the edge, which stays the edge's below it.
    const [plain] = audio({});
    expect(hitClip([plain], audioCtx, layout, wide, 8, 16)?.handle).toBe("fadeIn");
    expect(hitClip([plain], audioCtx, layout, wide, 2, 40)).toMatchObject({ edge: "start", handle: null });
  });

  it("aren't there on a clip too small to show them, or on a pattern clip", () => {
    const [clip] = audio({});
    expect(hitClip([clip], audioCtx, layout, { ...wide, pxPerTick: 0.05 }, 1, 16)?.handle ?? null).toBeNull();
    const [pattern] = clips([{ length: 384 }]);
    expect(hitClip([pattern], ctx, layout, wide, 8, 16)?.handle ?? null).toBeNull();
  });
});

describe("zooming and scrolling the Playlist", () => {
  it("keeps what's under the pointer where it is", () => {
    const zoomed = zoomAt(view, 200, 0.5);
    expect(xToTick(zoomed, 200)).toBeCloseTo(xToTick(view, 200));
    const taller = zoomTracksAt({ ...view, scrollY: 100 }, 50, 80);
    expect(taller).toMatchObject({ trackHeight: 80, scrollY: 250 });
  });

  it("zooms out as far as the whole song and some room after it, and never to fewer than 32 bars", () => {
    const bar = 384;
    // A short song: 32 bars across.
    expect(minPxPerTick(2 * bar, bar, 960)).toBeCloseTo(960 / (MIN_ZOOM_OUT_BARS * bar));
    // A long one: all of it, and an eighth more (100 bars, then 13).
    expect(minPxPerTick(100 * bar, bar, 960)).toBeCloseTo(960 / (113 * bar));
    // At least four bars of room.
    expect(minPxPerTick(30 * bar, bar, 960)).toBeCloseTo(960 / (34 * bar));
    // Never past the closest zoom.
    expect(minPxPerTick(bar, bar, 1e9)).toBe(MAX_PX_PER_TICK);
    // Zooming stops there.
    const min = minPxPerTick(2 * bar, bar, 960);
    expect(zoomAt(view, 0, min / 10, min).pxPerTick).toBe(min);
  });

  it("scrolls no further back than the start, nor down past the tracks", () => {
    expect(scrollViewBy(view, -100, -100, 500)).toBe(view);
    expect(scrollViewBy(view, 40, 900, 500)).toMatchObject({ scrollTick: 160, scrollY: 500 });
  });

  it("paints clips one after another, a clip's length apart (never closer than the grid)", () => {
    expect(paintClipStarts(0, 1000, 384, 96)).toEqual([0, 384, 768]);
    expect(paintClipStarts(96, 50, 384, 96)).toEqual([96]);
    expect(paintClipStarts(0, 100, 10, 96)).toEqual([0, 96]);
  });
});

describe("a drag on the Playlist", () => {
  const list = clips([{ start: 0 }, { start: 384, track: 2 }]);
  it("is what it will commit: moved, cloned, resized, slipped, added, erased, muted, sliced", () => {
    expect(applyDrag(list, { kind: "move", ids: new Set([1]), ticks: 96, tracks: 1, clone: false }, ctx).clips[0]).toMatchObject({ start: 96, track: 1 });
    expect(applyDrag(list, { kind: "move", ids: new Set([1]), ticks: 96, tracks: 0, clone: true }, ctx).created).toEqual([3]);
    expect(applyDrag(list, { kind: "resize", ids: new Set([1]), edge: "end", ticks: -96 }, ctx).clips[0].length).toBe(288);
    expect(applyDrag(list, { kind: "erase", ids: new Set([2]) }, ctx).clips).toHaveLength(1);
    expect(applyDrag(list, { kind: "mute", ids: new Set([2]), muted: true }, ctx).clips[1].muted).toBe(true);
    expect(applyDrag(list, { kind: "slice", tick: 192, top: 0, bottom: 0, all: false }, ctx).created).toEqual([3]);
    // Shift: every track, whatever the line's ends.
    expect(applyDrag(list, { kind: "slice", tick: 500, top: 0, bottom: 0, all: true }, ctx).created).toEqual([3]);
    expect(applyDrag(list, { kind: "slice", tick: 500, top: 0, bottom: 0, all: false }, ctx).clips).toBe(list);
    expect(applyDrag(list, { kind: "add", clips: [{ kind: "pattern", ref: "pat_1", track: 5, start: 0 }] }, ctx).created).toEqual([3]);
    expect(applyDrag(list, { kind: "rect", from: 0, to: 10, top: 0, bottom: 0, add: false }, ctx).clips).toBe(list);
    expect(applyDrag(list, null, ctx).clips).toBe(list);
  });

  it("selects what a rectangle touches, with what was selected when it adds", () => {
    expect([...rectSelection(list, { kind: "rect", from: 300, to: 400, top: 0, bottom: 2, add: false }, new Set(), ctx)]).toEqual([1, 2]);
    expect([...rectSelection(list, { kind: "rect", from: 500, to: 600, top: 2, bottom: 2, add: true }, new Set([1]), ctx)]).toEqual([1, 2]);
  });

  it("shows what a rectangle will select while it's drawn, and the selection otherwise", () => {
    const selected = new Set([2]);
    expect([...shownSelection(list, { kind: "rect", from: 0, to: 10, top: 0, bottom: 0, add: false }, selected, ctx)]).toEqual([1]);
    expect([...shownSelection(list, { kind: "rect", from: 0, to: 10, top: 0, bottom: 0, add: true }, selected, ctx)].sort()).toEqual([1, 2]);
    expect(shownSelection(list, null, selected, ctx)).toBe(selected);
    expect(shownSelection(list, { kind: "erase", ids: new Set() }, selected, ctx)).toBe(selected);
  });
});
