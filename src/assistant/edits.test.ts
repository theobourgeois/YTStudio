import { describe, expect, it } from "vitest";
import { captionClips } from "@shared/captions";
import { findEffect, textEffects } from "@shared/effects";
import { MAIN_TRACK_ID, clipEnd, createDefaultProject, getClip, trackClips } from "@shared/timeline";
import type { Clip, MediaAsset, Project } from "@shared/types";
import { describeClips, describeMusic, describeTimeline, describeTranscript } from "./describe";
import { EDITS, type EditEnv, clipChanges } from "./edits";

function asset(id: string, duration: number, kind: MediaAsset["kind"] = "video"): MediaAsset {
  return {
    id, projectId: "p1", name: `${id}.mp4`, kind, duration, width: 1080, height: 1920, fps: 30,
    hasVideo: kind !== "audio", hasAudio: kind !== "image", size: 1, createdAt: 0, status: "ready",
    src: "", poster: null, filmstrip: null, waveform: null,
  };
}

const assets = { media_a: asset("media_a", 10), media_b: asset("media_b", 4), media_song: asset("media_song", 30, "audio") };
const env: EditEnv = { assets, playhead: 0 };

/** Runs edits in order (like the tools do), failing the test on a tool error. */
function run(project: Project, ...steps: [keyof typeof EDITS, object][]) {
  return steps.reduce((p, [tool, input]) => EDITS[tool](p, input as Record<string, unknown>, env).project, project);
}

const withTwoClips = () =>
  run(createDefaultProject(), ["add_clips", { items: [{ assetId: "media_a" }, { assetId: "media_b", in: 1, out: 3 }] }]);

const main = (p: Project) => trackClips(p, MAIN_TRACK_ID);

describe("assistant edits", () => {
  it("adds clips after each other, part of a file, and sound on an audio track", () => {
    const p = run(withTwoClips(), ["add_clips", { items: [{ assetId: "media_song", start: 2 }] }]);
    expect(main(p).map((c) => [c.assetId, c.start, c.in, c.out])).toEqual([
      ["media_a", 0, 0, 10],
      ["media_b", 10, 1, 3],
    ]);
    const song = p.clips.find((c) => c.assetId === "media_song")!;
    expect([p.tracks.find((t) => t.id === song.trackId)?.kind, song.start]).toEqual(["audio", 2]);
  });

  it("explains what's wrong with an input", () => {
    const p = withTwoClips();
    expect(() => EDITS.add_clips(p, { items: [{ assetId: "media_x" }] }, env)).toThrow(/no media "media_x".*list_media/);
    expect(() => EDITS.split_clips(p, { at: 5, clipIds: ["clip_nope"] }, env)).toThrow(/no clip "clip_nope"/);
    const id = main(p)[0].id;
    expect(() => EDITS.set_properties(p, { clipIds: [id], effect: "motion", params: { zoom: 2 } }, env)).toThrow(/no parameter "zoom".*scale/);
    expect(() => EDITS.set_properties(p, { clipIds: [id], effect: "motion", params: { fit: "stretch" } }, env)).toThrow(/"contain", "cover"/);
    expect(() => EDITS.add_effect(p, { clipIds: [id], type: "motion" }, env)).toThrow(/isn't a video effect/);
  });

  it("splits under a time by default, reporting the new parts", () => {
    const p = withTwoClips();
    const out = EDITS.split_clips(p, { at: 4 }, env);
    expect(main(out.project).map((c) => [c.start, clipEnd(c)])).toEqual([
      [0, 4],
      [4, 10],
      [10, 12],
    ]);
    expect(out.text).toContain(main(out.project)[1].id);
  });

  it("trims edges to times, and ripple-trims", () => {
    const p = withTwoClips();
    const [a, b] = main(p);
    const trimmed = run(p, ["trim_clip", { clipId: a.id, start: 2, end: 8 }]);
    expect(getClip(trimmed, a.id)).toMatchObject({ start: 2, in: 2, out: 8 });
    const rippled = run(p, ["trim_clip", { clipId: a.id, end: 6, ripple: true }]);
    expect([clipEnd(getClip(rippled, a.id)!), getClip(rippled, b.id)!.start]).toEqual([6, 6]);
    expect(() => EDITS.trim_clip(p, { clipId: a.id, end: 11, ripple: true }, env)).toThrow(/only shortens/);
  });

  it("moves clips, saying where they really went", () => {
    const p = withTwoClips();
    const b = main(p)[1];
    const out = EDITS.move_clips(p, { clipIds: [b.id], to: 5 }, env);
    expect(getClip(out.project, b.id)!.start).toBe(10);
    expect(out.text).toMatch(/wasn't room at 5/);
  });

  it("closes every gap on a track", () => {
    const two = withTwoClips();
    const p = run(two, ["delete_clips", { clipIds: [main(two)[0].id] }]);
    const gapped = run(createDefaultProject(), ["add_clips", { items: [{ assetId: "media_a", start: 3 }, { assetId: "media_b", start: 20 }] }]);
    const closed = run(gapped, ["close_gaps", { trackId: MAIN_TRACK_ID }]);
    expect(main(closed).map((c) => c.start)).toEqual([0, 10]);
    expect(p.clips).toHaveLength(1);
  });

  it("keyframes at timeline times (stored in source time)", () => {
    const p = withTwoClips();
    const b = main(p)[1]; // starts at 10, source from 1
    const out = run(p, ["set_keyframes", { clipId: b.id, effect: "motion", param: "scale", keyframes: [{ time: 10, value: 1 }, { time: 12, value: 1.2, easing: "ease" }] }]);
    expect(findEffect(getClip(out, b.id)!, "motion")!.keyframes!.scale).toEqual([
      { time: 1, value: 1, easing: "linear" },
      { time: 3, value: 1.2, easing: "ease" },
    ]);
    expect(() => EDITS.set_keyframes(p, { clipId: b.id, effect: "motion", param: "scale", keyframes: [{ time: 3, value: 1 }] }, env)).toThrow(/outside/);
    const still = run(out, ["set_keyframes", { clipId: b.id, effect: "motion", param: "scale", keyframes: [], value: 1.5 }]);
    expect(findEffect(getClip(still, b.id)!, "motion")).toMatchObject({ params: { scale: 1.5 } });
    expect(findEffect(getClip(still, b.id)!, "motion")!.keyframes).toBeUndefined();
  });

  it("adds, sets and removes video effects", () => {
    const p = withTwoClips();
    const a = main(p)[0].id;
    const added = run(p, ["add_effect", { clipIds: [a], type: "gaussian-blur", params: { blurriness: 0.05 } }]);
    expect(findEffect(getClip(added, a)!, "gaussian-blur")?.params.blurriness).toBe(0.05);
    const removed = run(added, ["edit_effect", { clipIds: [a], effect: "gaussian-blur", remove: true }]);
    expect(findEffect(getClip(removed, a)!, "gaussian-blur")).toBeUndefined();
    expect(() => EDITS.edit_effect(p, { clipIds: [a], effect: "motion", remove: true }, env)).toThrow(/built in/);
  });

  it("puts a transition on a cut and changes it", () => {
    const p = withTwoClips();
    const [a, b] = main(p);
    const out = EDITS.set_transition(p, { clipId: b.id, edge: "in", type: "cross-dissolve", duration: 1 }, env);
    // A cut is stored on the outgoing clip.
    expect(getClip(out.project, a.id)?.transitionOut).toMatchObject({ type: "cross-dissolve", duration: 1 });
    expect(out.text).toContain(`the cut between ${a.id} and ${b.id}`);
    const gone = run(out.project, ["set_transition", { clipId: a.id, edge: "out", type: null }]);
    expect(getClip(gone, a.id)?.transitionOut).toBeUndefined();
  });

  it("adds text with a style and a place", () => {
    const out = EDITS.add_text(withTwoClips(), { text: "Summer", start: 0, duration: 2, style: { size: 150, fill: "#ffcc00" }, position: [0.5, 0.2] }, env);
    const text = out.project.clips.find((c) => c.assetId === "")!;
    expect(findEffect(text, "text")?.params).toMatchObject({ text: "Summer", size: 150 });
    expect(findEffect(text, "appearance")?.params.fill).toBe("#ffcc00");
    expect(findEffect(text, "motion")?.params.position).toEqual([0.5, 0.2]);
    expect(() => EDITS.add_text(withTwoClips(), { text: "x", start: 0, style: { glow: 1 } }, env)).toThrow(/no parameter "glow"/);
  });

  it("makes a batch one edit, or nothing if a step fails", () => {
    const p = withTwoClips();
    const a = main(p)[0].id;
    const out = EDITS.batch(p, { steps: [{ tool: "split_clips", input: { at: 2 } }, { tool: "delete_clips", input: { clipIds: [a], ripple: true } }] }, env);
    expect(main(out.project).map((c) => [c.start, c.in])).toEqual([
      [0, 2],
      [8, 1],
    ]);
    expect(() => EDITS.batch(p, { steps: [{ tool: "split_clips", input: { at: 2 } }, { tool: "get_timeline", input: {} }] }, env)).toThrow(/Step 2.*Nothing was changed/);
  });

  it("styles every caption", () => {
    const caption = (id: string, start: number): Clip => ({ id, assetId: "", trackId: MAIN_TRACK_ID, start, in: 0, out: 1, effects: textEffects({ text: id }), caption: true });
    const p: Project = { ...createDefaultProject(), clips: [caption("clip_c1", 0), caption("clip_c2", 1)] };
    const out = run(p, ["style_captions", { preset: "yellow", appearance: { strokeWidth: 2 }, animation: "pop" }]);
    for (const c of captionClips(out)) {
      expect(findEffect(c, "appearance")?.params).toMatchObject({ fill: "#ffe14d", strokeWidth: 2 });
      expect(c.transitionIn?.type).toBe("pop");
    }
    expect(() => EDITS.style_captions(createDefaultProject(), { preset: "bold" }, env)).toThrow(/no captions/);
  });

  it("reports what changed", () => {
    const p = withTwoClips();
    const out = run(p, ["split_clips", { at: 2 }]);
    const changes = clipChanges(p, out);
    expect([changes.added.length, changes.changed, changes.removed]).toEqual([1, [main(p)[0].id], 0]);
  });
});

describe("what the assistant reads", () => {
  it("describes the timeline with ids, gaps and what's not default", () => {
    const p = run(
      createDefaultProject(),
      ["add_clips", { items: [{ assetId: "media_a" }, { assetId: "media_b", start: 12 }] }],
    );
    const b = main(p)[1];
    const styled = run(p, ["set_properties", { clipIds: [b.id], effect: "motion", params: { scale: 1.2 } }]);
    const text = describeTimeline(styled, assets, { playhead: 1.5, selectedClipIds: [b.id] });
    expect(text).toContain(`Playhead 1.5 · selected: ${b.id}`);
    expect(text).toContain("gap 10–12");
    expect(text).toMatch(new RegExp(`${b.id}  12–16  "media_b.mp4" \\(video, media_b\\) · source 0–4 of 4 · motion: scale 1.2`));
    expect(JSON.parse(describeClips(styled, assets, [b.id]))[0]).toMatchObject({ id: b.id, start: 12, end: 16, source: { in: 0, out: 4 } });
  });

  it("writes transcripts as timed words, a line per phrase", () => {
    const clip: Clip = { id: "clip_1", assetId: "media_a", trackId: MAIN_TRACK_ID, start: 10, in: 0, out: 10, effects: [] };
    const text = describeTranscript(
      [clip],
      [{ assetId: "media_a", in: 0, out: 10, language: "en", words: [
        { text: " Hello", start: 0.5, end: 0.9 },
        { text: " there.", start: 0.95, end: 1.3 },
        { text: " Um", start: 3, end: 3.4 },
      ] }],
      assets,
    );
    expect(text.split("\n").slice(1)).toEqual([`clip_1 "media_a.mp4" 10–20`, "  Hello@10.5 there.@10.95 – 11.3", "  Um@13 – 13.4"]);
  });

  it("writes a song's beats in timeline times, only inside the clip", () => {
    const music = {
      bpm: 120,
      confidence: 0.8,
      beats: [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14],
      downbeats: [10, 12, 14],
      sections: [
        { start: 0, end: 12, db: -20, level: 0.5 },
        { start: 12, end: 30, db: -6, level: 1 },
      ],
      drops: [{ time: 12, rise: 9 }],
    };
    // The clip plays source 10.5–13.5 from timeline 2.
    const text = describeMusic('clip_1 "song.mp3"', music, 2 - 10.5, { start: 2, end: 5 }, true);
    expect(text.split("\n")).toEqual([
      'clip_1 "song.mp3" 2–5 (timeline times)',
      "120 BPM: a beat every 0.5s, a bar (4 beats) every 2s; a clear beat (confidence 0.8).",
      "Bars start at: 3.5",
      "Beats: 2 2.5 3 3.5 4 4.5 5",
      "Sections: 2–3.5 quiet (-20 dB) · 3.5–5 loud (-6 dB)",
      "Drops (the energy jumps up; biggest first): 3.5 (+9 dB)",
    ]);
    expect(describeMusic("x", { ...music, bpm: null, beats: [], downbeats: [] }, 0, { start: 0, end: 30 }, false)).toContain("No steady beat");
  });
});
