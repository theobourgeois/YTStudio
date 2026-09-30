import { describe, expect, it } from "vitest";
import { captionClips } from "@shared/captions";
import { clipKind, findEffect, isVideoEffect, textEffects } from "@shared/effects";
import { MAIN_TRACK_ID, clipEnd, createDefaultProject, getClip, trackClips } from "@shared/timeline";
import { sequenceAsset } from "@shared/sequences";
import type { Clip, MediaAsset, Project } from "@shared/types";
import { describeCatalog, describeClips, describeMusic, describeTimeline, describeTranscript } from "./describe";
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

  it("makes subclips, adds them as their part of the file, and edits or deletes them", () => {
    const made = EDITS.make_subclips(createDefaultProject(), { assetId: "media_song", items: [{ in: 4, out: 12, name: "Chorus" }, { in: 20, out: 40 }] }, env);
    const [chorus, end] = made.project.subclips!;
    expect([chorus.name, end.name, end.out]).toEqual(["Chorus", "media_song 1", 30]);
    expect(made.text).toMatch(new RegExp(`${chorus.id} "Chorus" 4–12`));
    const p = run(made.project, ["add_clips", { items: [{ subclipId: chorus.id }, { subclipId: end.id, out: 25 }] }]);
    expect(p.clips.map((c) => [c.assetId, c.in, c.out])).toEqual([["media_song", 4, 12], ["media_song", 20, 25]]);
    const edited = run(p, ["edit_subclips", { items: [{ subclipId: chorus.id, name: "Hook", in: 2 }, { subclipId: end.id, delete: true }] }]);
    expect(edited.subclips).toEqual([{ ...chorus, name: "Hook", in: 2 }]);
    // The clips made from them stay.
    expect(edited.clips).toBe(p.clips);
    expect(() => EDITS.make_subclips(p, { assetId: "media_a", items: [{ in: 11, out: 12 }] }, env)).toThrow(/at least 0.1s long: the file is 0–10s/);
    expect(() => EDITS.add_clips(p, { items: [{ subclipId: "sub_x" }] }, env)).toThrow(/no subclip "sub_x".*list_media/);
    expect(() => EDITS.add_clips(p, { items: [{ start: 1 }] }, env)).toThrow(/`assetId` or a `subclipId`/);
    expect(() => EDITS.edit_subclips(p, { items: [{ subclipId: chorus.id, name: " " }] }, env)).toThrow(/can't be empty/);
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

  it("speeds clips up, slows them down and reverses them, moving what's after", () => {
    const p = withTwoClips();
    const [a, b] = main(p);
    const fast = EDITS.set_speed(p, { clipIds: [a.id], speed: 2 }, env);
    expect(main(fast.project).map((c) => [c.start, clipEnd(c)])).toEqual([[0, 5], [5, 7]]);
    expect(fast.text).toMatch(/2×/);
    expect(fast.text).toMatch(/1 later clip/);
    // Fit a clip to a length, backwards, with the pitch following the speed.
    const fitted = run(p, ["set_speed", { clipIds: [b.id], duration: 4, reversed: true, keepPitch: false }]);
    expect(getClip(fitted, b.id)).toMatchObject({ speed: 0.5, reversed: true, keepPitch: false, in: 1, out: 3 });
    const described = describeTimeline(fitted, assets, { playhead: 0, selectedClipIds: [] });
    expect(described).toContain("speed 0.5×, reversed, pitch follows speed");
    expect(JSON.parse(describeClips(fitted, assets, [b.id]))[0]).toMatchObject({ speed: 0.5, reversed: true, keepPitch: false });
  });

  it("explains what can't be retimed", () => {
    const p = run(createDefaultProject(), ["add_text", { text: "Hi", start: 0 }]);
    const text = p.clips[0].id;
    expect(() => EDITS.set_speed(p, { clipIds: [text], speed: 2 }, env)).toThrow(/text: only video and sound clips/);
    const q = withTwoClips();
    expect(() => EDITS.set_speed(q, { clipIds: [main(q)[0].id] }, env)).toThrow(/Give `speed`/);
    expect(() => EDITS.set_speed(q, { clipIds: [main(q)[0].id], speed: 20 }, env)).toThrow(/at most 10/);
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

  it("adds adjustment layers with effects over what's there, and solids", () => {
    const p = withTwoClips();
    const out = EDITS.add_layer(p, { kind: "adjustment", start: 8, duration: 4, effects: [{ type: "gaussian-blur", params: { blurriness: 0.02 } }, { type: "invert" }] }, env);
    const layer = out.project.clips.find((c) => c.adjustment)!;
    expect(layer).toMatchObject({ start: 8, in: 0, out: 4, assetId: "" });
    // On a new track on top: the main track is taken there.
    expect(out.project.tracks[0].id).toBe(layer.trackId);
    expect(layer.effects.filter(isVideoEffect).map((e) => e.id)).toEqual(["gaussian-blur", "invert"]);
    expect(out.text).toMatch(/adjustment layer .* with gaussian-blur, invert/);
    expect(describeTimeline(out.project, assets, { playhead: 0, selectedClipIds: [] })).toContain("adjustment layer (changes the tracks below it)");

    const solid = run(p, ["add_layer", { kind: "solid", start: 0, duration: 2, color: "#FF0000" }]).clips.find((c) => clipKind(c) === "solid")!;
    expect(findEffect(solid, "solid")!.params).toMatchObject({ color: "#ff0000", fill: 1 });
    expect(() => EDITS.add_layer(p, { kind: "adjustment", start: 0, color: "#ff0000" }, env)).toThrow(/only for solids/);
    expect(() => EDITS.add_layer(p, { kind: "solid", start: 0, trackId: "audio_1" }, env)).toThrow(/video track/);
    expect(() => EDITS.add_layer(p, { kind: "adjustment", start: 0, effects: [{ type: "motion" }] }, env)).toThrow(/isn't a video effect/);
  });

  it("applies presets: transitions as an adjustment layer on the cut, moves on clips", () => {
    const p = withTwoClips();
    const [a, b] = main(p);
    const out = EDITS.apply_preset(p, { type: "spin", at: b.start }, env);
    const layer = out.project.clips.find((c) => c.adjustment)!;
    expect(layer.start + clipEnd(layer)).toBeCloseTo(2 * b.start);
    expect(out.text).toMatch(/Spin: adjustment layer .* centred on 10/);
    const moved = run(p, ["apply_preset", { type: "punch-in", clipIds: [a.id] }]);
    expect(findEffect(getClip(moved, a.id)!, "motion")!.keyframes!.scale).toHaveLength(2);
    expect(() => EDITS.apply_preset(p, { type: "spin" }, env)).toThrow(/`at`/);
    expect(() => EDITS.apply_preset(p, { type: "warp-speed", at: 1 }, env)).toThrow(/get_catalog/);
    expect(describeCatalog("presets", "spin")).toContain('spin  "Spin" transition');
  });

  it("adds cameras for 3D layers, track mattes and optical-flow slow motion", () => {
    const p = withTwoClips();
    const [a, b] = main(p);
    const out = EDITS.add_layer(p, { kind: "camera", start: 0, duration: 4, camera: { orbitY: 30, distance: 0.8 } }, env);
    const cam = out.project.clips.find((c) => clipKind(c) === "camera")!;
    expect(findEffect(cam, "camera")!.params).toMatchObject({ orbitY: 30, distance: 0.8 });
    expect(out.text).toMatch(/3D layers/);
    expect(() => EDITS.add_layer(p, { kind: "camera", start: 0, effects: [{ type: "invert" }] }, env)).toThrow(/no effects/);
    const threeD = run(p, ["set_properties", { clipIds: [a.id], effect: "motion", params: { threeD: true, rotationY: 40, positionZ: 300 } }]);
    expect(findEffect(getClip(threeD, a.id)!, "motion")!.params).toMatchObject({ threeD: true, rotationY: 40, positionZ: 300 });
    const matted = run(p, ["set_properties", { clipIds: [a.id], effect: "opacity", params: { trackMatte: "luma" } }]);
    expect(findEffect(getClip(matted, a.id)!, "opacity")!.params.trackMatte).toBe("luma");
    const slow = run(p, ["set_speed", { clipIds: [b.id], speed: 0.5, interpolation: "flow" }]);
    expect(getClip(slow, b.id)).toMatchObject({ speed: 0.5, timeInterpolation: "flow" });
    expect(describeTimeline(slow, assets, { playhead: 0, selectedClipIds: [] })).toContain("optical flow");
  });

  it("sets blend modes, motion blur and snappy keyframes", () => {
    const p = withTwoClips();
    const [a] = main(p);
    const blended = run(p, ["set_properties", { clipIds: [a.id], effect: "opacity", params: { blendMode: "screen" } }]);
    expect(findEffect(getClip(blended, a.id)!, "opacity")!.params.blendMode).toBe("screen");
    expect(() => EDITS.set_properties(p, { clipIds: [a.id], effect: "opacity", params: { blendMode: "glow" } }, env)).toThrow(/"screen"/);
    const snappy = run(p, [
      "set_keyframes",
      { clipId: a.id, effect: "motion", param: "scale", keyframes: [{ time: 1, value: 1, easing: "ease", influence: 0.9 }, { time: 2, value: 3, easing: "ease", influence: 0.9 }] },
    ]);
    expect(findEffect(getClip(snappy, a.id)!, "motion")!.keyframes!.scale.map((k) => k.influence)).toEqual([0.9, 0.9]);
    expect(JSON.parse(describeClips(snappy, assets, [a.id]))[0].effects[0].keyframes.scale[0]).toMatchObject({ influence: 0.9 });
  });

  it("sets the graph editor's Bézier handles", () => {
    const p = withTwoClips();
    const a = main(p)[0];
    const out = run(p, [
      "set_keyframes",
      { clipId: a.id, effect: "motion", param: "scale", keyframes: [{ time: 0, value: 1, handleOut: [0.2, 0.9] }, { time: 2, value: 2, handleIn: [2, 1.3] }] },
    ]);
    const keys = findEffect(getClip(out, a.id)!, "motion")!.keyframes!.scale;
    expect(keys.map((k) => [k.handleOut, k.handleIn])).toEqual([[[0.2, 0.9], undefined], [undefined, [0.99, 1.3]]]);
    expect(JSON.parse(describeClips(out, assets, [a.id]))[0].effects[0].keyframes.scale[0]).toMatchObject({ handleOut: [0.2, 0.9] });
  });

  it("adds a null object and parents clips to it", () => {
    const p = withTwoClips();
    const a = main(p)[0];
    const withNull = EDITS.add_layer(p, { kind: "null", start: 0, duration: 4 }, env);
    expect(withNull.text).toContain("null object");
    const nul = withNull.project.clips.find((c) => c.nullObject)!;
    const linked = run(withNull.project, ["set_parent", { clipIds: [a.id], parentId: nul.id }]);
    expect(getClip(linked, a.id)?.parent).toEqual({ id: nul.id });
    expect(describeTimeline(linked, assets, { playhead: 0, selectedClipIds: [] })).toContain(`parent: ${nul.id}`);
    expect(() => EDITS.set_parent(linked, { clipIds: [nul.id], parentId: a.id }, env)).toThrow(/own parent/);
    expect(getClip(run(linked, ["set_parent", { clipIds: [a.id], parentId: null }]), a.id)?.parent).toBeUndefined();
  });

  it("nests clips, changes the sequence, and breaks it apart", () => {
    const p = withTwoClips();
    const [a, b] = main(p);
    const nested = EDITS.nest_clips(p, { clipIds: [a.id, b.id], name: "Intro" }, env);
    expect(nested.text).toContain("Intro");
    const seq = nested.project.sequences![0];
    const nest = main(nested.project)[0];
    expect(nest.assetId).toBe(seq.id);
    const withSeq = { ...env, assets: { ...assets, [seq.id]: sequenceAsset(seq) } };
    expect(describeTimeline(nested.project, withSeq.assets, { playhead: 0, selectedClipIds: [] })).toContain(`nested sequence "Intro" (${seq.id})`);
    const square = EDITS.edit_sequence(nested.project, { sequenceId: seq.id, aspectRatio: "1:1", duration: 20 }, withSeq);
    expect(square.project.sequences![0]).toMatchObject({ settings: { aspectRatio: "1:1" }, duration: 20 });
    const back = EDITS.break_apart(nested.project, { clipId: nest.id }, withSeq);
    expect(back.project.clips.map((c) => c.assetId).sort()).toEqual(["media_a", "media_b"]);
    expect(() => EDITS.edit_sequence(nested.project, { sequenceId: "seq_nope" }, withSeq)).toThrow(/no sequence/);
  });

  it("remaps a clip's time: ramps, freezes and reverses", () => {
    const p = withTwoClips();
    const a = main(p)[0];
    const ramp = EDITS.remap_time(p, { clipId: a.id, speeds: [{ duration: 1, speed: 1 }, { duration: 2, speed: 0.25 }, { duration: 1, speed: 2 }], ease: 0.5 }, env);
    expect(ramp.text).toContain("remapped");
    const ramped = main(ramp.project)[0];
    expect(clipEnd(ramped)).toBeCloseTo(4);
    // The next clip moved along with its end.
    expect(main(ramp.project)[1].start).toBeCloseTo(4);
    const frozen = EDITS.remap_time(ramp.project, { clipId: a.id, freeze: { at: 0.5, duration: 1 } }, env).project;
    expect(clipEnd(main(frozen)[0])).toBeCloseTo(5);
    const clips = JSON.parse(describeClips(frozen, assets, [a.id]))[0];
    expect(clips.remap.some((s: { speed: number }) => s.speed === 0)).toBe(true);
    const off = EDITS.remap_time(frozen, { clipId: a.id, enabled: false }, env);
    expect(off.text).toContain("steady speed");
    expect(() => EDITS.remap_time(p, { clipId: a.id }, env)).toThrow(/Give/);
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

  it("masks clips, morphs a mask, and builds shape layers", () => {
    const p = withTwoClips();
    const [a] = main(p).map((c) => c.id);
    // A mask from a list of points (the left half), then a second one as SVG path data.
    const masked = EDITS.add_effect(p, { clipIds: [a], type: "mask", params: { path: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]], feather: 20 } }, env);
    expect(masked.text).toMatch(new RegExp(`Added Mask \\(effect ids: ${a}: mask\\)`));
    const two = run(masked.project, ["add_effect", { clipIds: [a], type: "mask", params: { path: "M0.2 0.2 L0.8 0.2 C0.8 0.6 0.6 0.8 0.2 0.8 Z", mode: "subtract" } }]);
    const masks = getClip(two, a)!.effects.filter((e) => e.type === "mask");
    expect(masks.map((m) => [m.id, (m.params.path as { vertices: unknown[]; closed: boolean }).vertices.length, m.params.mode])).toEqual([["mask", 4, "add"], ["mask_2", 3, "subtract"]]);
    expect(() => EDITS.add_effect(p, { clipIds: [a], type: "mask", params: { path: "nonsense" } }, env)).toThrow(/"path" must be a path in fractions/);
    // The model reads paths back the way it writes them.
    expect(describeTimeline(two, assets, { playhead: 0, selectedClipIds: [] })).toContain('mask (path "M0 0 L0.5 0 L0.5 1 L0 1 Z", feather 20)');
    expect(JSON.parse(describeClips(two, assets, [a]))[0].effects.find((e: { id: string }) => e.id === "mask_2").params.path).toBe("M0.2 0.2 L0.8 0.2 C0.8 0.6 0.6 0.8 0.2 0.8 Z");

    // A wipe: the mask's path keyframed from nothing to the whole frame.
    const wipe = run(masked.project, [
      "set_keyframes",
      { clipId: a, effect: "mask", param: "path", keyframes: [{ time: 0, value: [[0, 0], [0.01, 0], [0.01, 1], [0, 1]] }, { time: 2, value: "M0 0 L1 0 L1 1 L0 1 Z", easing: "ease" }] },
    ]);
    const keys = getClip(wipe, a)!.effects.find((e) => e.id === "mask")!.keyframes!.path;
    expect(keys.map((k) => [k.time, (k.value as { vertices: { point: number[] }[] }).vertices[1].point[0]])).toEqual([[0, 0.01], [2, 1]]);
    // Masks can be removed; the built-in effects can't.
    expect(getClip(run(two, ["edit_effect", { clipIds: [a], effect: "mask", remove: true }]), a)!.effects.map((e) => e.id)).toContain("mask_2");
    expect(() => EDITS.edit_effect(two, { clipIds: [a], effect: "motion", remove: true }, env)).toThrow(/built in/);

    // A shape layer: a first shape, then more contents in order.
    const made = EDITS.add_layer(
      p,
      { kind: "shape", start: 1, duration: 3, shape: { kind: "ellipse", size: [300, 300], fillColor: "#ff0000" }, effects: [{ type: "vector-shape", params: { kind: "star", points: 6 } }, { type: "trim-paths", params: { end: 0.5 } }] },
      env,
    );
    expect(made.text).toMatch(/Added shape layer .* with vector-shape, vector-shape_2, trim-paths\. Add more shapes/);
    const layer = made.project.clips.find((c) => clipKind(c) === "shape")!;
    expect(layer.effects.filter((e) => e.type === "vector-shape").map((e) => [e.params.kind, e.params.fillColor])).toEqual([["ellipse", "#ff0000"], ["star", "#ffffff"]]);
    expect(describeTimeline(made.project, assets, { playhead: 0, selectedClipIds: [] })).toContain("shape layer");
    // Shape contents only go on shape layers; a shape layer keeps a shape.
    expect(() => EDITS.add_effect(p, { clipIds: [a], type: "repeater" }, env)).toThrow(/only goes on shape layers/);
    expect(() => EDITS.add_layer(p, { kind: "solid", start: 0, shape: {} }, env)).toThrow(/only for shape layers/);
    const lone = EDITS.add_layer(p, { kind: "shape", start: 1 }, env).project;
    const loneId = lone.clips.find((c) => clipKind(c) === "shape")!.id;
    expect(() => EDITS.edit_effect(lone, { clipIds: [loneId], effect: "vector-shape", remove: true }, env)).toThrow(/keeps at least one shape/);
    expect(describeCatalog("masks_and_shapes")).toMatch(/mask {2}"Mask"[\s\S]*vector-shape {2}"Shape"[\s\S]*trim-paths[\s\S]*merge-paths/);
    expect(describeCatalog("masks_and_shapes", "repeat")).toMatch(/repeater/);
  });

  it("bends a position's path with spatial handles", () => {
    const p = withTwoClips();
    const [a] = main(p).map((c) => c.id);
    const out = run(p, [
      "set_keyframes",
      { clipId: a, effect: "motion", param: "position", keyframes: [{ time: 0, value: [0.2, 0.5], spatialOut: [0, -0.3] }, { time: 2, value: [0.8, 0.5], spatialIn: [0, -0.3] }] },
    ]);
    const keys = findEffect(getClip(out, a)!, "motion")!.keyframes!.position;
    expect(keys.map((k) => [k.spatialIn, k.spatialOut])).toEqual([[undefined, [0, -0.3]], [[0, -0.3], undefined]]);
    expect(JSON.parse(describeClips(out, assets, [a]))[0].effects[0].keyframes.position[0].spatialOut).toEqual([0, -0.3]);
    expect(() =>
      EDITS.set_keyframes(p, { clipId: a, effect: "motion", param: "scale", keyframes: [{ time: 0, value: 1, spatialOut: [0, 1] }] }, env),
    ).toThrow(/isn't a point/);
  });

  it("sets markers on the timeline and on clips", () => {
    const p = withTwoClips();
    const [a] = main(p).map((c) => c.id);
    const made = EDITS.set_markers(p, { add: [{ time: 4, label: "Drop", color: "red" }, { time: 1 }, { time: 2.5, clipId: a, label: "hit" }] }, env);
    expect(made.text).toMatch(/^Markers: added marker_\w+ at 4, marker_\w+ at 1, marker_\w+ on clip_\w+ at 2\.5\.$/);
    expect(made.project.markers!.map((m) => [m.time, m.label, m.color])).toEqual([[1, undefined, undefined], [4, "Drop", "red"]]);
    const onClip = getClip(made.project, a)!.markers![0];
    expect([onClip.time, onClip.label]).toEqual([2.5, "hit"]);
    const text = describeTimeline(made.project, assets, { playhead: 0, selectedClipIds: [] });
    expect(text).toMatch(/Markers \(set_markers\): 1 \(marker_\w+\), 4 "Drop" \(marker_\w+\)/);
    expect(text).toMatch(/markers: 2\.5 "hit" \(marker_\w+\)/);
    // Change by id (wherever it is), remove, and clear.
    const drop = made.project.markers![1].id;
    const edited = run(made.project, ["set_markers", { update: [{ id: drop, time: 5, label: "" }, { id: onClip.id, color: "blue" }], remove: [made.project.markers![0].id] }]);
    expect(edited.markers).toEqual([{ id: drop, time: 5, color: "red" }]);
    expect(getClip(edited, a)!.markers![0].color).toBe("blue");
    const cleared = run(edited, ["set_markers", { clear: true, add: [{ time: 2 }] }]);
    expect(cleared.markers!.map((m) => m.time)).toEqual([2]);
    expect(getClip(cleared, a)!.markers).toHaveLength(1);
    expect(() => EDITS.set_markers(p, { add: [{ time: 50, clipId: a }] }, env)).toThrow(/is outside/);
    expect(() => EDITS.set_markers(p, { remove: ["marker_x"] }, env)).toThrow(/no marker "marker_x".*get_timeline/);
    expect(() => EDITS.set_markers(p, {}, env)).toThrow(/Give `add`/);
  });

  it("animates text letter by letter, and captions with the speech", () => {
    const p = run(createDefaultProject(), ["add_text", { text: "Hello world", start: 0, duration: 3 }]);
    const id = p.clips[0].id;
    const preset = EDITS.add_effect(p, { clipIds: [id], type: "text-animator", preset: "pop-words", params: { scale: 0.5 } }, env);
    expect(preset.text).toMatch(/Added the Pop in by word animator \(effect ids: clip_\w+: text-animator\)/);
    const animator = getClip(preset.project, id)!.effects.at(-1)!;
    expect(animator.params).toMatchObject({ basedOn: "words", scale: 0.5, opacity: 0 });
    expect(animator.keyframes!.start).toHaveLength(2);
    // A blank one, then its range keyframed by hand.
    const own = run(p, ["add_effect", { clipIds: [id], type: "text-animator", params: { opacity: 0 } }], ["set_keyframes", { clipId: id, effect: "text-animator", param: "start", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }] }]);
    expect(getClip(own, id)!.effects.at(-1)!.keyframes!.start.map((k) => k.value)).toEqual([0, 1]);
    expect(() => EDITS.add_effect(p, { clipIds: [id], type: "text-animator", preset: "nope" }, env)).toThrow(/no animator preset "nope".*fade-characters/);
    expect(() => EDITS.add_effect(p, { clipIds: [id], type: "gaussian-blur", preset: "typewriter" }, env)).toThrow(/only for type "text-animator"/);
    const video = withTwoClips();
    expect(() => EDITS.add_effect(video, { clipIds: [main(video)[0].id], type: "text-animator" }, env)).toThrow(/only goes on text clips/);
    expect(describeCatalog("text_animators")).toMatch(/text-animator {2}"Animator"[\s\S]*basedOn: characters \| words \| lines[\s\S]*typewriter {2}"Typewriter"/);
    expect(describeCatalog("caption_styles")).toMatch(/spoken-highlight \(Highlight/);
  });

  it("puts expressions on properties, and says what they give or what's wrong", () => {
    const p = withTwoClips();
    const [a] = main(p).map((c) => c.id);
    const spun = EDITS.set_expression(p, { clipIds: [a], effect: "motion", param: "rotation", expression: "value + time * 90" }, env);
    expect(spun.text).toBe(`rotation (motion) now follows the expression. It gives ${a}: 0 at its start, 90 1s in.`);
    expect(findEffect(getClip(spun.project, a)!, "motion")!.expressions).toEqual({ rotation: "value + time * 90" });
    expect(describeTimeline(spun.project, assets, { playhead: 0, selectedClipIds: [] })).toContain('rotation = expression "value + time * 90"');
    expect(JSON.parse(describeClips(spun.project, assets, [a]))[0].effects[0].expressions).toEqual({ rotation: "value + time * 90" });
    // Removed with null.
    const removed = EDITS.set_expression(spun.project, { clipIds: [a], effect: "motion", param: "rotation", expression: null }, env);
    expect(findEffect(getClip(removed.project, a)!, "motion")).not.toHaveProperty("expressions");
    expect(EDITS.set_expression(p, { clipIds: [a], effect: "motion", param: "rotation", expression: null }, env).text).toMatch(/had no expression/);
    // What's wrong comes back to the model, and nothing is written.
    expect(() => EDITS.set_expression(p, { clipIds: [a], effect: "motion", param: "rotation", expression: "wigle(2, 5)" }, env)).toThrow(/doesn't run: .*wigle.*get_catalog "expressions"/);
    expect(() => EDITS.set_expression(p, { clipIds: [a], effect: "motion", param: "position", expression: '"left"' }, env)).toThrow(/must be a point/);
    expect(() => EDITS.set_expression(p, { clipIds: [a], effect: "volume", param: "level", expression: "0.5" }, env)).toThrow(/can't have an expression \(none of its parameters can\)/);
    expect(() => EDITS.set_expression(p, { clipIds: [a], effect: "motion", param: "fit", expression: "1" }, env)).toThrow(/its numbers and points can: position, scale/);
    expect(describeCatalog("expressions")).toMatch(/wiggle\(freq, amp[\s\S]*loopOut/);
  });
});
