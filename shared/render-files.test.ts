import { describe, expect, it } from "vitest";
import { addEffect, defaultEffects, setParams, solidEffects, textEffects, visualizerEffects } from "./effects.ts";
import { type SegmentAsset, MAX_SEGMENT, frameAt, hash, renderSegments, segmentAt, stable } from "./render-files.ts";
import { MAIN_TRACK_ID, createDefaultProject } from "./timeline.ts";
import { createTransition } from "./transitions.ts";
import type { Clip, Project } from "./types.ts";

const media = (id: string, hasAudio = false): SegmentAsset => ({
  id,
  src: `/files/media/${id}/source.mp4`,
  kind: "video",
  duration: 60,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio,
});
const assets = [media("a"), media("song", true)];

const clip = (id: string, start: number, length: number, extra: Partial<Clip> = {}): Clip => ({
  id,
  assetId: "a",
  trackId: MAIN_TRACK_ID,
  start,
  in: 0,
  out: length,
  effects: defaultEffects(),
  ...extra,
});
const project = (clips: Clip[]): Project => ({
  ...createDefaultProject(),
  settings: { aspectRatio: "16:9", fps: 30 },
  tracks: [
    { id: "v2", kind: "video", name: "Video 2", muted: false },
    { id: MAIN_TRACK_ID, kind: "video", name: "Video 1", muted: false },
    { id: "audio_1", kind: "audio", name: "Audio 1", muted: false },
  ],
  clips,
});
const keysOf = (p: Project) => renderSegments(p, assets).map((s) => s.key);

describe("renderSegments", () => {
  const base = project([clip("x", 0, 3), clip("y", 3, 1.5), clip("top", 1, 2, { trackId: "v2", assetId: "", effects: solidEffects() })]);

  it("covers the sequence on its frame grid, cut at every edge and every MAX_SEGMENT", () => {
    const segments = renderSegments(base, assets);
    expect(segments[0].from).toBe(0);
    expect(segments.at(-1)!.to).toBe(frameAt(4.5, 30));
    for (let i = 1; i < segments.length; i++) expect(segments[i].from).toBe(segments[i - 1].to);
    const edges = segments.map((s) => s.from);
    // Clip edges (1 s, 3 s) are cuts; so is 2 s after the start of a long stretch.
    expect(edges).toEqual(expect.arrayContaining([0, 30, 90]));
    for (const s of segments) expect(s.to - s.from).toBeLessThanOrEqual(MAX_SEGMENT * 30);
  });

  it("gives the same keys to the same content, and new keys only where an edit shows", () => {
    expect(keysOf(base)).toEqual(keysOf(structuredClone(base)));
    // The solid on top (1..3 s) changes colour: only its segments change.
    const recoloured = setParams(base, "top", "solid", { color: "#ff0000" });
    const [before, after] = [renderSegments(base, assets), renderSegments(recoloured, assets)];
    for (const [i, s] of before.entries()) {
      const covers = s.from < 90 && s.to > 30;
      expect(after[i].key !== s.key).toBe(covers);
    }
  });

  it("changes a segment's key when a parent it follows changes, even one outside it", () => {
    const p = project([clip("child", 0, 1, { parent: { id: "parent" } }), clip("parent", 3, 1, { trackId: "v2" })]);
    const moved = setParams(p, "parent", "motion", { position: [100, 0] });
    expect(renderSegments(moved, assets)[0].key).not.toBe(renderSegments(p, assets)[0].key);
  });

  it("says which segments are worth rendering", () => {
    const withEffect = addEffect(base, ["y"], "gaussian-blur").project;
    const heavy = (p: Project, t: number) => segmentAt(renderSegments(p, assets), frameAt(t, 30))!.heavy;
    expect(heavy(base, 0.5)).toBe(false);
    expect(heavy(withEffect, 3.5)).toBe(true);
    expect(heavy(withEffect, 0.5)).toBe(false);
    const adjusted = project([clip("x", 0, 3), clip("adj", 0, 3, { trackId: "v2", assetId: "", adjustment: true })]);
    expect(heavy(adjusted, 1)).toBe(true);
    const crossed = project([clip("x", 0, 3, { transitionOut: createTransition("cross-dissolve", 1) }), clip("y", 3, 2)]);
    expect(heavy(crossed, 3)).toBe(true);
    expect(heavy(crossed, 0.2)).toBe(false);
  });

  it("hears the sound only where something reacts to it", () => {
    const song = (start: number) => ({ id: "music", assetId: "song", trackId: "audio_1", start, in: 0, out: 6, effects: defaultEffects() });
    const look = { ...clip("look", 0, 2, { trackId: "v2", assetId: "" }), effects: visualizerEffects() };
    const p = project([clip("x", 0, 4), look, song(0)]);
    const shifted = { ...p, clips: [...p.clips.slice(0, 2), song(0.5)] };
    const [a, b] = [renderSegments(p, assets), renderSegments(shifted, assets)];
    // The visualizer's segments (0..2 s) hear the song move; the plain clip's (2..4 s) don't.
    expect(segmentAt(b, 15)!.key).not.toBe(segmentAt(a, 15)!.key);
    expect(segmentAt(b, 90)!.key).toBe(segmentAt(a, 90)!.key);
  });

  it("scales with the clip count: 1500 captions, and one of them moved", () => {
    const captions = Array.from({ length: 1500 }, (_, i) => clip(`c${i}`, i, 0.8, { assetId: "", effects: textEffects({ text: `Caption ${i}` }) }));
    const p = project(captions);
    let t = performance.now();
    const segments = renderSegments(p, assets);
    const first = performance.now() - t;
    // A caption and a gap each (the last caption ends the sequence).
    expect(segments).toHaveLength(2999);
    const moved = { ...p, clips: p.clips.map((c, i) => (i === 700 ? { ...c, start: 700.1 } : c)) };
    t = performance.now();
    const again = renderSegments(moved, assets);
    const second = performance.now() - t;
    // Only the moved caption's neighbourhood changes.
    expect(again.filter((s, i) => s.key !== segments[i]?.key).length).toBeLessThan(10);
    expect(first).toBeLessThan(1500);
    expect(second).toBeLessThan(400);
  });

  it("is empty for an empty sequence", () => {
    expect(renderSegments(project([]), assets)).toEqual([]);
  });
});

describe("segmentAt", () => {
  it("finds the segment showing a frame", () => {
    const segments = [
      { from: 0, to: 10, key: "a", heavy: false },
      { from: 10, to: 25, key: "b", heavy: true },
    ];
    expect(segmentAt(segments, 0)?.key).toBe("a");
    expect(segmentAt(segments, 10)?.key).toBe("b");
    expect(segmentAt(segments, 24)?.key).toBe("b");
    expect(segmentAt(segments, 25)).toBeNull();
  });
});

describe("stable and hash", () => {
  it("reads objects the same whatever their keys' order", () => {
    expect(stable({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe(stable({ a: [1, { d: 2 }], b: 1 }));
    expect(hash("abc")).toMatch(/^[0-9a-f]{27}$/);
    expect(hash("abc")).not.toBe(hash("abd"));
  });
});
