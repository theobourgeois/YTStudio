/**
 * Auto captions: from timed words (a `Transcript` of each clip's media) to
 * caption clips on the timeline, and edits to all captions at once.
 *
 * A caption is an ordinary text clip flagged `caption`, so moving, trimming,
 * the properties panel and the export already work. What makes them a set is
 * that the Captions tab edits their style together (like Premiere's caption
 * track style, or CapCut's "apply to all"): style edits go to every caption,
 * while each caption keeps its own text and timing. A caption's animation is
 * a transition on its in-edge.
 */
import { APPEARANCE, MOTION, TEXT, findEffect, resetParams, setParams, textEffects, volumeAt } from "./effects.ts";
import { EPS, roundTime } from "./math.ts";
import { sanitizeParams } from "./params.ts";
import { MIN_CLIP_DURATION, addTrack, clipEnd, clipsById, createId, getTrack, isFree, perClipList, removeClips, timelineTime, trackClips } from "./timeline.ts";
import { createTransition, transitionDefinition } from "./transitions.ts";
import type { AspectRatio, Clip, MediaAsset, ParamValues, Project, Transcript, Transition, Vec2 } from "./types.ts";

export const isCaptionClip = (clip: Pick<Clip, "caption">) => clip.caption === true;

/** Every caption, in time order. Shared between callers: don't change it. */
export const captionClips = perClipList(({ clips }): readonly Clip[] =>
  clips.filter(isCaptionClip).sort((a, b) => a.start - b.start),
);

const captionIds = perClipList(({ clips }): ReadonlySet<string> => new Set(clips.filter(isCaptionClip).map((c) => c.id)));

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** How captions look: Text values (except the text itself) and Appearance values. */
export interface CaptionStyle {
  text: ParamValues;
  appearance: ParamValues;
}

export interface CaptionPreset {
  id: string;
  label: string;
  /** Over the Text defaults. `size` is for a portrait canvas (see `presetStyle`). */
  text: ParamValues;
  /** Over the Appearance defaults. */
  appearance: ParamValues;
  /** How far down the canvas new captions sit (0 = top, 1 = bottom), on a tall canvas and a wide one. */
  y: { tall: number; wide: number };
}

/** Looks to start from, with fonts every Mac has. */
export const CAPTION_PRESETS: readonly CaptionPreset[] = [
  {
    id: "clean",
    label: "Clean",
    text: { font: "Helvetica Neue", fontStyle: "Bold", size: 72 },
    appearance: { shadow: 0.6, shadowDistance: 3, shadowBlur: 14 },
    y: { tall: 0.72, wide: 0.84 },
  },
  {
    id: "bold",
    label: "Bold",
    text: { font: "Avenir Next", fontStyle: "Heavy", size: 78, textCase: "upper" },
    appearance: { strokeWidth: 6, shadow: 0.5, shadowDistance: 5, shadowBlur: 0 },
    y: { tall: 0.7, wide: 0.82 },
  },
  {
    id: "yellow",
    label: "Yellow",
    text: { font: "Futura", fontStyle: "Condensed ExtraBold", size: 92, textCase: "upper", tracking: 10 },
    appearance: { fill: "#ffe14d", strokeWidth: 6 },
    y: { tall: 0.7, wide: 0.82 },
  },
  {
    id: "boxed",
    label: "Boxed",
    text: { font: "Helvetica Neue", fontStyle: "Medium", size: 58 },
    appearance: { background: 0.8 },
    y: { tall: 0.74, wide: 0.86 },
  },
  {
    id: "rounded",
    label: "Rounded",
    text: { font: "Arial Rounded MT Bold", fontStyle: "Regular", size: 76 },
    appearance: { strokeWidth: 5, strokeColor: "#1a1a1a", shadow: 0.35, shadowDistance: 6, shadowBlur: 10 },
    y: { tall: 0.72, wide: 0.84 },
  },
  {
    id: "subtitle",
    label: "Subtitle",
    text: { font: "Helvetica Neue", fontStyle: "Medium", size: 50 },
    appearance: { shadow: 0.9, shadowDistance: 2, shadowBlur: 8 },
    y: { tall: 0.84, wide: 0.9 },
  },
];

export const DEFAULT_CAPTION_PRESET = "bold";

export function captionPreset(id: string): CaptionPreset | undefined {
  return CAPTION_PRESETS.find((p) => p.id === id);
}

/** Portrait sizes read well; a wide canvas is shorter, so the same text is smaller there. */
const SIZE_BY_ASPECT: Record<AspectRatio, number> = { "9:16": 1, "4:5": 1, "1:1": 0.9, "16:9": 0.8 };

const isWide = (aspect: AspectRatio) => aspect === "16:9";

/** A preset's full style (every other value at its default), sized for the canvas. */
export function presetStyle(preset: CaptionPreset, aspect: AspectRatio): CaptionStyle {
  const text = sanitizeParams(TEXT.params, preset.text);
  delete text.text;
  text.size = Math.round((text.size as number) * SIZE_BY_ASPECT[aspect]);
  return { text, appearance: sanitizeParams(APPEARANCE.params, preset.appearance) };
}

/** Where a preset puts new captions on the canvas (Motion's position). */
export function presetPosition(preset: CaptionPreset, aspect: AspectRatio): Vec2 {
  return [0.5, isWide(aspect) ? preset.y.wide : preset.y.tall];
}

/** A caption's own style and position (to give new captions the same look). */
export function captionStyleOf(clip: Clip): { style: CaptionStyle; motion: ParamValues } {
  const text = { ...findEffect(clip, TEXT.type)?.params };
  delete text.text;
  return {
    style: { text, appearance: { ...findEffect(clip, APPEARANCE.type)?.params } },
    motion: { ...findEffect(clip, MOTION.type)?.params },
  };
}

/** Which preset a style is exactly (for highlighting it), if any. */
export function matchingPreset(style: CaptionStyle, aspect: AspectRatio): CaptionPreset | undefined {
  const same = (a: ParamValues, b: ParamValues) => Object.keys(b).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  return CAPTION_PRESETS.find((p) => {
    const s = presetStyle(p, aspect);
    return same(style.text, s.text) && same(style.appearance, s.appearance);
  });
}

// ---------------------------------------------------------------------------
// Animation: a transition on each caption's in-edge
// ---------------------------------------------------------------------------

export interface CaptionAnimation {
  /** A transition type (see `TRANSITIONS`). */
  type: string;
  duration: number;
  /** Over the transition's defaults. */
  params?: ParamValues;
}

/** The animations offered first, with values that suit a short caption. The rest of the transitions follow. */
export const CAPTION_ANIMATIONS: readonly (CaptionAnimation & { label: string })[] = [
  { label: "Pop", type: "pop", duration: 0.25 },
  { label: "Fade", type: "cross-dissolve", duration: 0.15 },
  { label: "Rise", type: "rise", duration: 0.25 },
  { label: "Blur", type: "blur-dissolve", duration: 0.2 },
  { label: "Glitch", type: "rgb-split", duration: 0.2 },
];

/** How long a caption animation of another type (one of the other transitions) lasts. */
export const CAPTION_ANIMATION_DURATION = 0.2;

/** The recommended values for a transition type used as a caption animation. */
export function captionAnimation(type: string): CaptionAnimation | null {
  if (!transitionDefinition(type)) return null;
  return CAPTION_ANIMATIONS.find((a) => a.type === type) ?? { type, duration: CAPTION_ANIMATION_DURATION };
}

function animationTransition(animation: CaptionAnimation): Transition {
  const t = createTransition(animation.type, animation.duration);
  const def = transitionDefinition(animation.type)!;
  return { ...t, params: sanitizeParams(def.params, { ...t.params, ...animation.params }) };
}

/** The captions' animation (the first caption's), or null for none. */
export function captionAnimationOf(project: Project): CaptionAnimation | null {
  const t = captionClips(project)[0]?.transitionIn;
  return t ? { type: t.type, duration: t.duration, params: t.params } : null;
}

/**
 * End each caption one frame before a caption right after it, so each one's
 * animation plays in from nothing instead of as a transition from the one
 * before (subtitles are spaced like this anyway).
 */
export function spaceCaptions(project: Project): Project {
  const frame = roundTime(1 / project.settings.fps);
  const byTrack = new Map<string, Clip[]>();
  for (const c of captionClips(project)) byTrack.set(c.trackId, [...(byTrack.get(c.trackId) ?? []), c]);
  const shortened = new Map<string, Clip>();
  for (const clips of byTrack.values()) {
    clips.forEach((c, i) => {
      const next = clips[i + 1];
      if (!next || next.start - clipEnd(c) > frame / 2) return;
      const out = roundTime(next.start - frame - c.start + c.in);
      if (out - c.in >= MIN_CLIP_DURATION) shortened.set(c.id, { ...c, out });
    });
  }
  if (shortened.size === 0) return project;
  return { ...project, clips: project.clips.map((c) => shortened.get(c.id) ?? c) };
}

/** Give every caption this animation (null: none). */
export function setCaptionAnimation(project: Project, animation: CaptionAnimation | null): Project {
  const transition = animation && transitionDefinition(animation.type) ? animationTransition(animation) : null;
  let changed = false;
  const clips = project.clips.map((clip) => {
    if (!isCaptionClip(clip)) return clip;
    if (!transition) {
      if (!clip.transitionIn) return clip;
      changed = true;
      const { transitionIn: _, ...rest } = clip;
      return rest;
    }
    if (JSON.stringify(clip.transitionIn) === JSON.stringify(transition)) return clip;
    changed = true;
    return { ...clip, transitionIn: transition };
  });
  const next = changed ? { ...project, clips } : project;
  return transition ? spaceCaptions(next) : next;
}

// ---------------------------------------------------------------------------
// Words to captions
// ---------------------------------------------------------------------------

export type CaptionLength = "word" | "short" | "line" | "lines";

export const CAPTION_LENGTHS: readonly { value: CaptionLength; label: string; hint: string; maxWords: number; lines: 1 | 2 }[] = [
  { value: "word", label: "Word", hint: "One word at a time", maxWords: 1, lines: 1 },
  { value: "short", label: "Short", hint: "Up to three words", maxWords: 3, lines: 1 },
  { value: "line", label: "Line", hint: "One line", maxWords: 10, lines: 1 },
  { value: "lines", label: "2 lines", hint: "Up to two lines, like subtitles", maxWords: 20, lines: 2 },
];

export const DEFAULT_CAPTION_LENGTH: CaptionLength = "short";

/** A word on the timeline. */
export interface TimedWord {
  /** With its leading space (see `TranscriptWord`). */
  text: string;
  start: number;
  end: number;
  /** Which clip it's heard in: a caption never spans two. */
  group: number;
  /** Where that clip ends on the timeline (a caption stops there). */
  limit: number;
}

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

export interface CueOptions {
  maxWords: number;
  lines: 1 | 2;
  /** Whether one line of text fits across the canvas in the captions' style. */
  fits: (line: string) => boolean;
  /** Keep the punctuation (otherwise it's dropped, except inside words like "3.5" or "don't"). */
  punctuation: boolean;
}

/** A silence this long (seconds) ends a caption. */
const PAUSE = 0.6;
/** A caption never lasts longer than this while words keep coming. */
const MAX_CUE = 6;
/** How long a caption may stay up into a silence, and at least how long it shows. */
const LINGER = 0.8;
const MIN_CUE = 0.3;

const SENTENCE_END = /[.!?…。！？]["')\]»”’]*$/;
const CLAUSE_END = /[,;:，、；：]["')\]»”’]*$/;

/** Sound effects and music that speech-to-text writes down ("[Music]", "(laughs)", "♪"). */
export function isSpokenWord(text: string): boolean {
  const t = text.trim();
  return t !== "" && !/^[[(♪*].*[\])♪*]$/.test(t) && !/^[♪\s]+$/.test(t);
}

/** Words on the timeline, as they sit in text: joined, with the first one's leading space dropped. */
const joinWords = (words: readonly { text: string }[]) => words.map((w) => w.text).join("").trim();

export function stripPunctuation(text: string): string {
  return text
    .replace(/[.,!?;:…。，、！？；：]+(?=\s|$)/g, "")
    .replace(/(^|\s)[¿¡]+/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * The text laid out in at most `lines` lines that each fit, or null. Two
 * lines are only used when one doesn't fit, split where they're most even.
 */
function layoutLines(words: readonly { text: string }[], lines: 1 | 2, opts: CueOptions): string | null {
  const show = (ws: readonly { text: string }[]) => (opts.punctuation ? joinWords(ws) : stripPunctuation(joinWords(ws)));
  const one = show(words);
  if (opts.fits(one)) return one;
  if (lines === 1 || words.length < 2) return null;
  let best: string | null = null;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = show(words.slice(0, i));
    const b = show(words.slice(i));
    const score = Math.abs(a.length - b.length);
    if (score < bestScore && opts.fits(a) && opts.fits(b)) {
      best = `${a}\n${b}`;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Group timed words into captions: a new caption starts after `maxWords`
 * words, at the end of a sentence, at a pause, when the text would no longer
 * fit, or in another clip. Each caption shows from its first word until the
 * next caption (or a little into a silence), so they don't flicker.
 */
export function captionCues(input: readonly TimedWord[], opts: CueOptions): CaptionCue[] {
  const words = input.filter((w) => isSpokenWord(w.text)).sort((a, b) => a.start - b.start);
  const groups: TimedWord[][] = [];
  let current: TimedWord[] = [];
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
  };
  for (const w of words) {
    const last = current.at(-1);
    if (last) {
      const lastText = last.text.trim();
      const breakHere =
        w.group !== last.group ||
        w.start - last.end >= PAUSE ||
        current.length >= opts.maxWords ||
        SENTENCE_END.test(lastText) ||
        (CLAUSE_END.test(lastText) && opts.maxWords > 3 && current.length >= Math.ceil(opts.maxWords / 2)) ||
        w.end - current[0].start > MAX_CUE ||
        layoutLines([...current, w], opts.lines, opts) === null;
      if (breakHere) flush();
    }
    current.push(w);
  }
  flush();

  const cues: (CaptionCue & { limit: number })[] = [];
  for (const group of groups) {
    // A single word too long for a line still gets shown (on one line).
    const text = layoutLines(group, opts.lines, opts) ?? (opts.punctuation ? joinWords(group) : stripPunctuation(joinWords(group)));
    if (!text) continue;
    cues.push({ start: group[0].start, end: Math.max(...group.map((w) => w.end)), text, limit: group[0].limit });
  }

  // Timing: until the next caption when it's close, else a little into the silence; never past the clip.
  const out: CaptionCue[] = [];
  cues.forEach((cue, i) => {
    const next = cues[i + 1];
    const nextStart = next ? next.start : Infinity;
    let end = nextStart - cue.end < LINGER ? nextStart : cue.end + Math.min(0.25, (nextStart - cue.end) / 2);
    end = Math.max(end, cue.start + MIN_CUE);
    end = Math.min(end, nextStart, cue.limit);
    const start = roundTime(cue.start);
    end = roundTime(end);
    if (end - start < MIN_CLIP_DURATION - EPS) {
      // Too short to be a clip (words said on top of each other): it joins the next caption.
      if (next) next.text = `${cue.text} ${next.text}`.replace(/\n/g, " ");
      if (next) next.start = Math.min(next.start, cue.start);
      return;
    }
    out.push({ start, end, text: cue.text });
  });
  return out;
}

/**
 * The words heard in `clips` on the timeline, from transcripts of their media
 * (in source time). A word belongs to a clip when its middle is inside it.
 */
export function timelineWords(clips: readonly Clip[], transcripts: readonly Transcript[]): TimedWord[] {
  const words: TimedWord[] = [];
  clips.forEach((clip, group) => {
    // Speech played backwards has no words.
    if (clip.reversed) return;
    const limit = clipEnd(clip);
    for (const t of transcripts) {
      if (t.assetId !== clip.assetId || t.out <= clip.in || t.in >= clip.out) continue;
      for (const w of t.words) {
        const mid = (w.start + w.end) / 2;
        if (mid < clip.in || mid >= clip.out) continue;
        const at = (s: number) => timelineTime(clip, Math.min(Math.max(s, clip.in), clip.out));
        words.push({ text: w.text, start: at(w.start), end: at(w.end), group, limit });
      }
    }
  });
  // Clips playing at the same time: their captions take turns rather than overlap.
  return words.sort((a, b) => a.start - b.start);
}

/**
 * The clips whose sound Auto captions listens to: the ones given (when they
 * have sound), or else every clip with sound that's heard (its track isn't
 * muted and its volume isn't zero).
 */
export function captionSourceClips(
  project: Project,
  assets: Readonly<Record<string, Pick<MediaAsset, "hasAudio"> | undefined>>,
  clipIds?: readonly string[],
): Clip[] {
  // Speech played backwards has no words to caption.
  const audible = (c: Clip) => !isCaptionClip(c) && c.assetId !== "" && !c.reversed && !!assets[c.assetId]?.hasAudio;
  if (clipIds?.length) {
    const ids = new Set(clipIds);
    return project.clips.filter((c) => ids.has(c.id) && audible(c)).sort((a, b) => a.start - b.start);
  }
  return project.clips
    .filter((c) => audible(c) && !getTrack(project, c.trackId)?.muted && volumeAt(c, c.in) > 0)
    .sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Captions on the timeline
// ---------------------------------------------------------------------------

export interface AddCaptionsOptions {
  style: CaptionStyle;
  /** Motion values (at least the position). */
  motion: ParamValues;
  animation: CaptionAnimation | null;
  /** Timeline ranges whose existing captions the new ones replace (the clips they're for). */
  replace: readonly { start: number; end: number }[];
}

export const CAPTIONS_TRACK_NAME = "Captions";

/** A new caption clip. */
function captionClip(cue: CaptionCue, trackId: string, opts: AddCaptionsOptions): Clip {
  const effects = textEffects({ ...opts.style.text, text: cue.text }).map((e) => {
    if (e.type === APPEARANCE.type) return { ...e, params: sanitizeParams(APPEARANCE.params, { ...e.params, ...opts.style.appearance }) };
    if (e.type === MOTION.type) return { ...e, params: sanitizeParams(MOTION.params, { ...e.params, ...opts.motion }) };
    return e;
  });
  const clip: Clip = {
    id: createId("clip"),
    assetId: "",
    trackId,
    start: cue.start,
    in: 0,
    out: roundTime(cue.end - cue.start),
    effects,
    caption: true,
  };
  if (opts.animation && transitionDefinition(opts.animation.type)) clip.transitionIn = animationTransition(opts.animation);
  return clip;
}

/**
 * Put captions on the timeline, replacing the captions already over the same
 * clips. They go on the track the other captions are on when they fit there,
 * otherwise on a new "Captions" track on top.
 */
export function addCaptions(
  project: Project,
  cues: readonly CaptionCue[],
  opts: AddCaptionsOptions,
): { project: Project; clipIds: string[] } {
  const overlaps = (c: Clip, r: { start: number; end: number }) => c.start < r.end - EPS && clipEnd(c) > r.start + EPS;
  const replaced = project.clips.filter((c) => isCaptionClip(c) && opts.replace.some((r) => overlaps(c, r)));
  let p = removeClips(project, replaced.map((c) => c.id));
  if (cues.length === 0) return { project: p, clipIds: [] };

  const fitsOn = (trackId: string) =>
    getTrack(p, trackId)?.kind === "video" && cues.every((cue) => isFree(p, trackId, cue.start, cue.end - cue.start));
  const candidates = [...new Set([...captionClips(p), ...replaced].map((c) => c.trackId))];
  let trackId = candidates.find(fitsOn);
  if (!trackId) {
    const added = addTrack(p, "video");
    p = renameTrack(added.project, added.trackId, captionsTrackName(added.project));
    trackId = added.trackId;
  }
  const clips = cues.map((cue) => captionClip(cue, trackId, opts));
  p = { ...p, clips: [...p.clips, ...clips] };
  return { project: opts.animation ? spaceCaptions(p) : p, clipIds: clips.map((c) => c.id) };
}

function captionsTrackName(project: Project): string {
  const names = new Set(project.tracks.map((t) => t.name));
  let name = CAPTIONS_TRACK_NAME;
  for (let n = 2; names.has(name); n++) name = `${CAPTIONS_TRACK_NAME} ${n}`;
  return name;
}

function renameTrack(project: Project, trackId: string, name: string): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, name } : t)) };
}

// ---------------------------------------------------------------------------
// Edits to every caption at once (the Captions tab)
// ---------------------------------------------------------------------------

/** Set parameters of one effect on every caption. The text itself stays each caption's own. */
export function setCaptionParams(project: Project, effectType: string, patch: ParamValues): Project {
  const rest = { ...patch };
  if (effectType === TEXT.type) delete rest.text;
  if (Object.keys(rest).length === 0) return project;
  return setParams(project, captionIds(project), effectType, rest);
}

/** Put parameters of one effect back to their defaults on every caption (never the text). */
export function resetCaptionParams(project: Project, effectType: string, keys: string[]): Project {
  const reset = keys.filter((k) => effectType !== TEXT.type || k !== "text");
  if (reset.length === 0) return project;
  return resetParams(project, captionIds(project), effectType, reset);
}

/** Give every caption a preset's look (their positions and animation stay). */
export function applyCaptionPreset(project: Project, preset: CaptionPreset): Project {
  const style = presetStyle(preset, project.settings.aspectRatio);
  return setCaptionParams(setCaptionParams(project, TEXT.type, style.text), APPEARANCE.type, style.appearance);
}

/** Change one caption's words. */
export function setCaptionText(project: Project, clipId: string, text: string): Project {
  return setParams(project, clipId, TEXT.type, { text });
}

/** The caption right after this one on its track (touching or not), if it's a caption. */
export function nextCaption(project: Project, clipId: string): Clip | undefined {
  const clip = clipsById(project).get(clipId);
  if (!clip) return undefined;
  const clips = trackClips(project, clip.trackId);
  const next = clips[clips.indexOf(clip) + 1];
  return next && isCaptionClip(next) ? next : undefined;
}

/** Ids of the captions that have a next caption (see `nextCaption`), for many at once. */
export const captionsWithNext = perClipList((project): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const trackId of new Set(captionClips(project).map((c) => c.trackId))) {
    const clips = trackClips(project, trackId);
    clips.forEach((c, i) => {
      if (isCaptionClip(c) && clips[i + 1] && isCaptionClip(clips[i + 1])) ids.add(c.id);
    });
  }
  return ids;
});

/** Join a caption with the next one: one caption over both, saying both. */
export function mergeCaptionWithNext(project: Project, clipId: string): Project {
  const clip = project.clips.find((c) => c.id === clipId);
  const next = nextCaption(project, clipId);
  if (!clip || !isCaptionClip(clip) || !next) return project;
  const text = (c: Clip) => String(findEffect(c, TEXT.type)?.params.text ?? "").trim();
  const joined = [text(clip), text(next)].filter(Boolean).join(" ").replace(/\s*\n\s*/g, " ");
  const merged: Clip = { ...clip, out: roundTime(clip.in + clipEnd(next) - clip.start) };
  if (next.transitionOut) merged.transitionOut = next.transitionOut;
  const p = {
    ...project,
    clips: project.clips.filter((c) => c.id !== next.id).map((c) => (c.id === clipId ? merged : c)),
  };
  return setCaptionText(p, clipId, joined);
}

/** Remove every caption. */
export function removeCaptions(project: Project): Project {
  return removeClips(project, captionClips(project).map((c) => c.id));
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/** Languages to pick from (ISO 639-1), besides detecting it. Whisper knows many more. */
export const CAPTION_LANGUAGES: readonly { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "pl", label: "Polish" },
  { code: "cs", label: "Czech" },
  { code: "ro", label: "Romanian" },
  { code: "hu", label: "Hungarian" },
  { code: "el", label: "Greek" },
  { code: "tr", label: "Turkish" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "ar", label: "Arabic" },
  { code: "he", label: "Hebrew" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "ms", label: "Malay" },
  { code: "tl", label: "Tagalog" },
  { code: "vi", label: "Vietnamese" },
  { code: "th", label: "Thai" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

export const isCaptionLanguage = (code: string) => code === "auto" || CAPTION_LANGUAGES.some((l) => l.code === code);
