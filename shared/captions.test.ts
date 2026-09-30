import { describe, expect, it } from "vitest";
import type { Clip, Project, Transcript } from "./types.ts";
import {
  CAPTIONS_TRACK_NAME,
  CAPTION_PRESETS,
  type CueOptions,
  type TimedWord,
  addCaptions,
  applyCaptionPreset,
  captionAnimation,
  captionAnimationOf,
  captionClips,
  captionCues,
  captionSourceClips,
  captionStyleOf,
  isSpokenWord,
  matchingPreset,
  mergeCaptionWithNext,
  presetPosition,
  presetStyle,
  setCaptionAnimation,
  setCaptionParams,
  setCaptionText,
  spaceCaptions,
  stripPunctuation,
  timelineWords,
} from "./captions.ts";
import { APPEARANCE, MOTION, TEXT, VOLUME, defaultEffects, findEffect, setParams, textStyleAt } from "./effects.ts";
import { MAIN_TRACK_ID, createDefaultProject, splitClip } from "./timeline.ts";
import { normalizeProject } from "./normalize.ts";
import { roundTime } from "./math.ts";

/** Words said one after another, `gap` apart, each lasting `len`. */
function said(text: string, { at = 0, len = 0.3, gap = 0.05, group = 0, limit = 100 } = {}): TimedWord[] {
  let t = at;
  return text.split(" ").map((word, i) => {
    const w = { text: i === 0 ? word : ` ${word}`, start: t, end: t + len, group, limit };
    t += len + gap;
    return w;
  });
}

const opts = (over: Partial<CueOptions> = {}): CueOptions => ({
  maxWords: 3,
  lines: 1,
  fits: (line) => line.length <= 30,
  punctuation: true,
  ...over,
});

const video = (id: string, start: number, over: Partial<Clip> = {}): Clip => ({
  id, assetId: "media_a", trackId: MAIN_TRACK_ID, start, in: 0, out: 5, effects: defaultEffects(), ...over,
});

const bold = CAPTION_PRESETS.find((p) => p.id === "bold")!;
const style = presetStyle(bold, "9:16");
const add = (project: Project, cues: { start: number; end: number; text: string }[], replace = [{ start: 0, end: 100 }]) =>
  addCaptions(project, cues, { style, motion: { position: presetPosition(bold, "9:16") }, animation: null, replace });

describe("captionCues", () => {
  it("groups words up to the word limit, breaking at sentence ends", () => {
    const cues = captionCues(said("Hey everyone. Welcome back to the channel today"), opts());
    expect(cues.map((c) => c.text)).toEqual(["Hey everyone.", "Welcome back to", "the channel today"]);
  });

  it("keeps each caption up until the next one, and a little into a silence", () => {
    const cues = captionCues([...said("one two"), ...said("three", { at: 5 })], opts());
    expect(cues[0].start).toBe(0);
    // "two" ends at 0.65; the next caption is far away, so it lingers a quarter second.
    expect(cues[0].end).toBeCloseTo(0.9);
    expect(cues[1]).toMatchObject({ start: 5, text: "three" });
    const close = captionCues(said("a b c d e f"), opts());
    expect(close[0].end).toBe(close[1].start);
  });

  it("breaks at pauses, at clip changes and when the text doesn't fit", () => {
    expect(captionCues([...said("one two"), ...said("three", { at: 1.4 })], opts()).map((c) => c.text)).toEqual(["one two", "three"]);
    expect(captionCues([...said("one"), ...said("two", { at: 0.35, group: 1 })], opts()).map((c) => c.text)).toEqual(["one", "two"]);
    const narrow = opts({ maxWords: 10, fits: (l) => l.length <= 12 });
    expect(captionCues(said("the quick brown fox jumps over"), narrow).map((c) => c.text)).toEqual(["the quick", "brown fox", "jumps over"]);
  });

  it("uses two balanced lines when one doesn't fit", () => {
    const cues = captionCues(said("this is a longer caption for subtitles"), opts({ maxWords: 20, lines: 2, fits: (l) => l.length <= 24 }));
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("this is a longer\ncaption for subtitles");
  });

  it("shows one word at a time, and drops punctuation when asked", () => {
    const cues = captionCues(said("Wait, what? ¿Qué? It's 3.5 dollars."), opts({ maxWords: 1, punctuation: false }));
    expect(cues.map((c) => c.text)).toEqual(["Wait", "what", "Qué", "It's", "3.5", "dollars"]);
    expect(stripPunctuation("Hello, world... ok!")).toBe("Hello world ok");
  });

  it("leaves out sound effects and music notes", () => {
    expect(isSpokenWord(" [Music]")).toBe(false);
    expect(isSpokenWord("(laughs)")).toBe(false);
    expect(isSpokenWord(" ♪")).toBe(false);
    expect(isSpokenWord(" okay")).toBe(true);
    expect(captionCues([...said("hi"), { text: " [Music]", start: 0.4, end: 0.8, group: 0, limit: 100 }], opts()).map((c) => c.text)).toEqual(["hi"]);
  });

  it("never runs past the end of its clip", () => {
    const cues = captionCues(said("last words", { limit: 0.7 }), opts());
    expect(cues.at(-1)!.end).toBe(0.7);
  });

  it("joins captions too short to be clips with the next one", () => {
    const words: TimedWord[] = [
      { text: "uh", start: 1, end: 1, group: 0, limit: 10 },
      { text: " yes", start: 1.02, end: 1.3, group: 1, limit: 10 },
    ];
    const cues = captionCues(words, opts());
    expect(cues).toEqual([{ start: 1, end: expect.any(Number), text: "uh yes", words: [1, 1.02] }]);
  });
});

describe("timelineWords", () => {
  const transcript: Transcript = {
    assetId: "media_a",
    in: 0,
    out: 10,
    language: "en",
    words: [
      { text: " zero", start: 0.2, end: 0.5 },
      { text: " two", start: 2.1, end: 2.4 },
      { text: " edge", start: 3.9, end: 4.3 },
      { text: " late", start: 6, end: 6.5 },
    ],
  };

  it("places the words each clip plays on the timeline (by their middle)", () => {
    const clip = video("c1", 10, { in: 2, out: 4.2 });
    const words = timelineWords([clip], [transcript]);
    expect(words.map((w) => w.text)).toEqual([" two", " edge"]);
    expect(words[0]).toMatchObject({ start: 10.1, group: 0, limit: 12.2 });
    // Clamped to the clip.
    expect(words[1].end).toBeCloseTo(12.2);
  });

  it("ignores other media", () => {
    expect(timelineWords([video("c1", 0, { assetId: "media_b" })], [transcript])).toEqual([]);
  });
});

describe("captionSourceClips", () => {
  const project: Project = {
    ...createDefaultProject(),
    clips: [
      video("v1", 0),
      video("silent", 5, { assetId: "media_img" }),
      { ...video("music", 0, { assetId: "media_song", trackId: "audio_1" }) },
    ],
  };
  const assets = { media_a: { hasAudio: true }, media_img: { hasAudio: false }, media_song: { hasAudio: true } };

  it("takes the selected clips with sound, or every clip that's heard", () => {
    expect(captionSourceClips(project, assets, ["v1", "silent"]).map((c) => c.id)).toEqual(["v1"]);
    expect(captionSourceClips(project, assets).map((c) => c.id)).toEqual(["v1", "music"]);
    const muted = { ...project, tracks: project.tracks.map((t) => (t.id === "audio_1" ? { ...t, muted: true } : t)) };
    expect(captionSourceClips(muted, assets).map((c) => c.id)).toEqual(["v1"]);
    const quiet = setParams(project, "v1", VOLUME.type, { level: 0 });
    expect(captionSourceClips(quiet, assets).map((c) => c.id)).toEqual(["music"]);
  });
});

describe("addCaptions", () => {
  const base: Project = { ...createDefaultProject(), clips: [video("v1", 0, { out: 10 })] };
  const cues = [
    { start: 0, end: 1, text: "Hello there" },
    { start: 1, end: 2.5, text: "friends" },
  ];

  it("keeps captions without an animation back to back", () => {
    const { project } = add(base, cues);
    expect(captionClips(project)[0].out).toBe(1);
    const animated = setCaptionAnimation(project, captionAnimation("cross-dissolve"));
    expect(captionClips(animated)[0].out).toBe(roundTime(1 - 1 / 30));
    expect(spaceCaptions(animated)).toBe(animated);
  });

  it("adds caption clips on a new Captions track on top, in the chosen style", () => {
    const { project, clipIds } = add(base, cues);
    expect(project.tracks[0]).toMatchObject({ kind: "video", name: CAPTIONS_TRACK_NAME });
    const captions = captionClips(project);
    expect(captions.map((c) => c.id)).toEqual(clipIds);
    expect(captions.every((c) => c.trackId === project.tracks[0].id && c.caption)).toBe(true);
    const look = textStyleAt(captions[0], captions[0].in);
    expect(look).toMatchObject({ text: "Hello there", font: "Avenir Next", fontStyle: "Heavy", textCase: "upper", strokeWidth: 6 });
    expect(findEffect(captions[0], MOTION.type)!.params.position).toEqual([0.5, 0.7]);
    expect(captions[1]).toMatchObject({ start: 1, in: 0, out: 1.5 });
  });

  it("replaces the captions over the same clips, on the same track", () => {
    const first = add(base, cues).project;
    const again = add(first, [{ start: 0.5, end: 2, text: "new" }], [{ start: 0, end: 10 }]).project;
    expect(captionClips(again).map((c) => textStyleAt(c, 0).text)).toEqual(["new"]);
    expect(again.tracks.filter((t) => t.name.startsWith(CAPTIONS_TRACK_NAME))).toHaveLength(1);
    // Captions elsewhere stay.
    const kept = add(first, [{ start: 20, end: 21, text: "later" }], [{ start: 20, end: 30 }]).project;
    expect(captionClips(kept)).toHaveLength(3);
  });

  it("animates each caption with a transition on its in-edge", () => {
    const pop = captionAnimation("pop")!;
    const { project } = addCaptions(base, cues, { style, motion: {}, animation: pop, replace: [] });
    expect(captionClips(project).every((c) => c.transitionIn?.type === "pop" && c.transitionIn.duration === 0.25)).toBe(true);
    expect(captionAnimationOf(project)).toMatchObject({ type: "pop" });
    // One frame apart, so each pops in on its own.
    expect(captionClips(project)[0]).toMatchObject({ start: 0, out: roundTime(1 - 1 / 30) });
    const slide = setCaptionAnimation(project, { type: "slide", duration: 0.2, params: { direction: "up" } });
    expect(captionClips(slide)[0].transitionIn).toMatchObject({ type: "slide", params: { direction: "up" } });
    expect(captionAnimation("wipe")).toEqual({ type: "wipe", duration: 0.2 });
    expect(captionAnimation("nope")).toBeNull();
    const none = setCaptionAnimation(slide, null);
    expect(captionClips(none).some((c) => c.transitionIn)).toBe(false);
    expect(setCaptionAnimation(none, null)).toBe(none);
  });

  it("follows the speech word by word with a text animator", () => {
    const spoken = [{ start: 0, end: 1, text: "Hello there", words: [0, 0.5] }, { start: 1, end: 2.5, text: "how are you", words: [1, 1.4, 2] }];
    const { project } = addCaptions(base, spoken, { style, motion: {}, animation: captionAnimation("spoken-words"), replace: [] });
    const [first, second] = captionClips(project);
    // No transition, and no gap between them: each word just appears when it's said.
    expect([first.transitionIn, first.out, second.start]).toEqual([undefined, 1, 1]);
    const animator = first.effects.find((e) => e.type === "text-animator")!;
    expect(animator.params).toMatchObject({ basedOn: "words", opacity: 0 });
    expect(animator.keyframes!.start.map((k) => [k.time, k.value, k.easing])).toEqual([[0, 0.5, "hold"], [0.5, 1, "hold"]]);
    // Before "there" is said only "Hello" shows: the range from `start` on is hidden.
    expect(textStyleAt(first, 0.2).animators![0]).toMatchObject({ start: 0.5, end: 1, opacity: 0 });
    expect(textStyleAt(first, 0.7).animators![0].start).toBe(1);
    expect(captionAnimationOf(project)).toEqual({ type: "spoken-words", duration: 0 });

    // A highlight on the word being said: a range one word long, stepping along; the words keep their times.
    const lit = setCaptionAnimation(project, captionAnimation("spoken-highlight"));
    const light = captionClips(lit)[1].effects.filter((e) => e.type === "text-animator");
    expect(light).toHaveLength(1);
    expect(light[0].params).toMatchObject({ recolor: true, fill: "#ffe14d", start: 0 });
    expect(light[0].params.end).toBeCloseTo(1 / 3);
    expect(light[0].keyframes!.offset.map((k) => [k.time, k.easing])).toEqual([[0, "hold"], [0.4, "hold"], [1, "hold"]]);
    expect(light[0].keyframes!.offset.map((k) => k.value as number)[2]).toBeCloseTo(2 / 3);
    expect(captionAnimationOf(lit)?.type).toBe("spoken-highlight");
    expect(setCaptionAnimation(lit, captionAnimation("spoken-highlight"))).toBe(lit);
    // Yellow captions get a white highlight.
    const yellow = setCaptionAnimation(setCaptionParams(project, APPEARANCE.type, { fill: "#ffe14d" }), captionAnimation("spoken-highlight"));
    expect(captionClips(yellow)[0].effects.find((e) => e.type === "text-animator")!.params.fill).toBe("#ffffff");

    // To a transition and back: the animator goes, then comes back spread evenly (the times are gone).
    const popped = setCaptionAnimation(lit, captionAnimation("pop"));
    expect(captionClips(popped).every((c) => c.transitionIn?.type === "pop" && !c.effects.some((e) => e.type === "text-animator"))).toBe(true);
    expect(captionClips(setCaptionAnimation(popped, captionAnimation("spoken-bounce")))[0].effects.find((e) => e.type === "text-animator")!.params.scale).toBe(1.18);
    const none = setCaptionAnimation(lit, null);
    expect(captionClips(none).some((c) => c.effects.some((e) => e.type === "text-animator"))).toBe(false);

    // Merged captions keep each word at the time it's said; retyped ones are spread evenly.
    const merged = mergeCaptionWithNext(lit, captionClips(lit)[0].id);
    const joined = captionClips(merged)[0];
    expect(textStyleAt(joined, 0).text).toBe("Hello there how are you");
    expect(joined.effects.find((e) => e.type === "text-animator")!.keyframes!.offset.map((k) => k.time)).toEqual([0, 0.5, 1, 1.4, 2]);
    const retyped = setCaptionText(lit, captionClips(lit)[0].id, "Hi");
    expect(captionClips(retyped)[0].effects.find((e) => e.type === "text-animator")!.params.end).toBe(1);
    expect(normalizeProject(JSON.parse(JSON.stringify(lit))).clips).toEqual(lit.clips);
  });

  it("survives saving and loading, and splits into two captions", () => {
    const { project, clipIds } = add(base, cues);
    const loaded = normalizeProject(JSON.parse(JSON.stringify(project)));
    expect(captionClips(loaded)).toHaveLength(2);
    const split = splitClip(loaded, clipIds[1], 2);
    expect(captionClips(split.project)).toHaveLength(3);
    // Only text clips can be captions.
    const junk = normalizeProject({ ...base, clips: [{ ...base.clips[0], caption: true }] });
    expect(junk.clips[0].caption).toBeUndefined();
  });
});

describe("editing every caption", () => {
  const base: Project = { ...createDefaultProject(), clips: [video("v1", 0, { out: 10 })] };
  const { project, clipIds } = add(base, [
    { start: 0, end: 1, text: "one" },
    { start: 1, end: 2, text: "two" },
    { start: 3, end: 4, text: "three" },
  ]);

  it("sets a style on all of them but keeps each one's text", () => {
    const p = setCaptionParams(project, TEXT.type, { size: 100, text: "nope" });
    expect(captionClips(p).map((c) => textStyleAt(c, 0))).toMatchObject([
      { size: 100, text: "one" },
      { size: 100, text: "two" },
      { size: 100, text: "three" },
    ]);
    expect(setCaptionParams(project, TEXT.type, { text: "nope" })).toBe(project);
  });

  it("applies a preset's look, and recognises it", () => {
    const boxed = CAPTION_PRESETS.find((p) => p.id === "boxed")!;
    const p = applyCaptionPreset(project, boxed);
    const look = textStyleAt(captionClips(p)[2], 0);
    expect(look).toMatchObject({ font: "Helvetica Neue", fontStyle: "Medium", background: 0.8, strokeWidth: 0, textCase: "none" });
    expect(matchingPreset(captionStyleOf(captionClips(p)[0]).style, "9:16")?.id).toBe("boxed");
    const tweaked = setCaptionParams(p, APPEARANCE.type, { fill: "#ff0000" });
    expect(matchingPreset(captionStyleOf(captionClips(tweaked)[0]).style, "9:16")).toBeUndefined();
  });

  it("merges a caption with the next one", () => {
    const p = mergeCaptionWithNext(project, clipIds[0]);
    const captions = captionClips(p);
    expect(captions).toHaveLength(2);
    expect(captions[0]).toMatchObject({ start: 0, out: 2 });
    expect(textStyleAt(captions[0], 0).text).toBe("one two");
    // Across a gap, too.
    const q = mergeCaptionWithNext(p, clipIds[0]);
    expect(captionClips(q)[0]).toMatchObject({ start: 0, out: 4 });
    expect(mergeCaptionWithNext(q, clipIds[0])).toBe(q);
  });
});
