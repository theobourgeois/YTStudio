/**
 * The assistant's timeline edits (`kind: "edit"` tools): pure functions from
 * a project and a tool input to the edited project and a short report for
 * the model. They check their input and say exactly what's wrong (the model
 * reads it and tries again), and report where things really ended up when
 * that differs from what was asked (a clip that couldn't go there, a clamped value).
 */
import type { EditToolName } from "@shared/assistant-tools";
import { canAnimate, keyframeTime, setAnimated } from "@shared/animation";
import {
  CAPTION_PRESETS,
  applyCaptionPreset,
  captionAnimation,
  captionClips,
  mergeCaptionWithNext,
  setCaptionAnimation,
  setCaptionParams,
} from "@shared/captions";
import {
  APPEARANCE,
  EFFECTS,
  type EffectDefinition,
  CAMERA,
  MOTION,
  SOLID,
  TEXT,
  addEffect,
  copyEffects,
  defaultEffects,
  effectDefinition,
  isTextClip,
  isVideoEffect,
  moveEffect,
  pasteEffects,
  removeEffect,
  resetParams,
  setEffectEnabled,
  setParams,
  textEffects,
  updateEffect,
} from "@shared/effects";
import { DEFAULT_INFLUENCE, EASINGS, MIN_INFLUENCE } from "@shared/keyframes";
import { addPresetLayer, applyPresetToClips, presetDefinition } from "@shared/presets";
import { addSubclips, canSubclip, cleanSubclipName, getSubclip, removeSubclips, subclipRange, updateSubclip } from "@shared/subclips";
import { EPS, roundTime, tidy } from "@shared/math";
import { type ParamSpec, sanitizeValue } from "@shared/params";
import {
  ASPECT_RATIOS,
  MAX_SPEED,
  MIN_CLIP_DURATION,
  MIN_SPEED,
  STILL_DURATION,
  addClip,
  addLayerClip,
  addTextClip,
  addTrack,
  canPlaceOnTrack,
  canRetime,
  clipDuration,
  clipEnd,
  clipName,
  clipSpeed,
  clipSourceRange,
  clipsAtTime,
  closeGap,
  copyClips,
  createId,
  getClip,
  getTrack,
  isOnVideoTrack,
  maxClipSpeed,
  moveClips,
  newLayerClip,
  pasteClips,
  removeClips,
  removeTrack,
  rippleDelete,
  rippleTrimTo,
  setClipSpeed,
  setTrackMuted,
  sourceAt,
  sourceRange,
  speedForDuration,
  splitClip,
  trackClips,
  timelineTime,
  trimClip,
  videoTracks,
} from "@shared/timeline";
import {
  type TransitionRef,
  addTransition,
  canonicalRef,
  findWindow,
  removeTransition,
  setTransitionParams,
  storedTransition,
} from "@shared/transition-windows";
import { ALIGNMENT_SPEC, DURATION_SPEC, transitionDefinition } from "@shared/transitions";
import type { AspectRatio, Clip, Easing, Effect, Keyframe, MediaAsset, ParamValues, Project, Track } from "@shared/types";
import {
  type Input,
  ToolError,
  number,
  oneOf,
  optBoolean,
  optNumber,
  optObject,
  optString,
  optStrings,
  optVec2,
  range,
  secs,
  string,
  strings,
  value,
} from "./input";

export interface EditEnv {
  assets: Readonly<Record<string, MediaAsset>>;
  playhead: number;
}

export interface EditOutcome {
  project: Project;
  text: string;
  /** A new name for the video (renames aren't undo steps, so the caller applies it). */
  rename?: string;
}

type EditHandler = (project: Project, input: Input, env: EditEnv) => EditOutcome;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clipOf(project: Project, id: string): Clip {
  const clip = getClip(project, id);
  if (!clip) throw new ToolError(`There's no clip "${id}". Call get_timeline for the current clip ids.`);
  return clip;
}

function trackOf(project: Project, id: string): Track {
  const track = getTrack(project, id);
  if (!track) throw new ToolError(`There's no track "${id}". Call get_timeline for the track ids.`);
  return track;
}

const trackName = (project: Project, id: string) => `"${getTrack(project, id)?.name ?? id}"`;

/** `clip_x "intro.mp4" on "Video 1" at 3–8.2`. */
function place(project: Project, clip: Clip, env: EditEnv): string {
  return `${clip.id} "${clipName(clip, env.assets[clip.assetId])}" on ${trackName(project, clip.trackId)} at ${range(clip.start, clipEnd(clip))}`;
}

/** One of a clip's effects, by id (or by type when that's unambiguous). */
function effectOf(clip: Clip, id: string): { effect: Effect; def: EffectDefinition } {
  const effect = clip.effects.find((e) => e.id === id) ?? clip.effects.find((e) => e.type === id);
  const def = effect && effectDefinition(effect.type);
  if (!effect || !def) {
    throw new ToolError(`Clip ${clip.id} has no effect "${id}". Its effects: ${clip.effects.map((e) => e.id).join(", ")}.`);
  }
  return { effect, def };
}

function expected(spec: ParamSpec): string {
  switch (spec.kind) {
    case "number":
      return `a number from ${spec.min} to ${spec.max}`;
    case "vec2":
      return "[x, y]";
    case "boolean":
      return "true or false";
    case "choice":
      return `one of ${spec.options.map((o) => JSON.stringify(o.value)).join(", ")}`;
    case "color":
      return 'a colour like "#ff0000"';
    default:
      return "a string";
  }
}

/**
 * Checked parameter values for `specs` (named `label` in messages), with a
 * note for each value that had to be clamped. `skip`: keys that aren't allowed here.
 */
function checkParams(
  specs: readonly ParamSpec[],
  raw: Input,
  label: string,
  skip: readonly string[] = [],
): { values: ParamValues; notes: string[] } {
  const values: ParamValues = {};
  const notes: string[] = [];
  for (const [key, v] of Object.entries(raw)) {
    const spec = skip.includes(key) ? undefined : specs.find((s) => s.key === key);
    if (!spec) {
      const keys = specs.filter((s) => !skip.includes(s.key)).map((s) => s.key);
      throw new ToolError(`${label} has no parameter "${key}". Its parameters: ${keys.join(", ")}.`);
    }
    const clean = sanitizeValue(spec, v);
    if (clean === undefined) throw new ToolError(`${label} "${key}" must be ${expected(spec)}.`);
    if (JSON.stringify(clean) !== JSON.stringify(v) && spec.kind !== "color") notes.push(`${key} was limited to ${value(clean)}`);
    values[key] = clean;
  }
  return { values, notes };
}

const withNotes = (text: string, notes: string[]) => (notes.length ? `${text} Note: ${[...new Set(notes)].join("; ")}.` : text);

/** Timeline time -> the clip's source time (unclamped). */
const toSource = (clip: Clip, t: number) => tidy(sourceAt(clip, t));

// ---------------------------------------------------------------------------
// Adding
// ---------------------------------------------------------------------------

const addClips: EditHandler = (project, input, env) => {
  const items = input.items;
  if (!Array.isArray(items) || items.length === 0) throw new ToolError("`items` must be a non-empty list.");
  const newTrack = optBoolean(input, "newTrack") ?? false;
  let p = project;
  const lines: string[] = [];
  const notes: string[] = [];
  const cursor = new Map<string, number>();
  const created = { video: null as string | null, audio: null as string | null };

  for (const [i, raw] of items.entries()) {
    if (!raw || typeof raw !== "object") throw new ToolError(`items[${i}] must be an object.`);
    const item = raw as Input;
    const subclipId = optString(item, "subclipId");
    const subclip = subclipId ? getSubclip(p, subclipId) : undefined;
    if (subclipId && !subclip) throw new ToolError(`There's no subclip "${subclipId}" in this video. Call list_media for the subclip ids.`);
    if (!subclip && optString(item, "assetId") === undefined) throw new ToolError(`items[${i}] needs an \`assetId\` or a \`subclipId\`.`);
    const assetId = subclip?.assetId ?? string(item, "assetId");
    const asset = env.assets[assetId];
    if (!asset) throw new ToolError(`There's no media "${assetId}" in this video. Call list_media.`);
    if (asset.status === "error" || asset.duration <= 0) throw new ToolError(`"${asset.name}" couldn't be read, so it can't be used.`);

    let trackId = optString(item, "trackId");
    if (trackId) {
      const track = trackOf(p, trackId);
      if (!canPlaceOnTrack(asset, track)) {
        throw new ToolError(`"${asset.name}" can't go on ${track.kind} track "${track.name}" (it has ${asset.hasVideo ? "a picture" : "only sound"}).`);
      }
    } else {
      const kind = asset.hasVideo ? "video" : "audio";
      if (newTrack) {
        if (!created[kind]) ({ project: p, trackId: created[kind] } = addTrack(p, kind));
        trackId = created[kind]!;
      } else if (kind === "video") {
        trackId = videoTracks(p).at(-1)!.id;
      } else {
        trackId = p.tracks.find((t) => t.kind === "audio")?.id;
        if (!trackId) ({ project: p, trackId } = addTrack(p, "audio"));
      }
    }

    const bounds = sourceRange(asset);
    const fileLength = asset.kind === "image" ? STILL_DURATION : asset.duration;
    const from = optNumber(item, "in") ?? subclip?.in ?? 0;
    const to = optNumber(item, "out") ?? subclip?.out ?? (asset.kind === "image" ? from + fileLength : asset.duration);
    const inPoint = Math.max(bounds.min, Math.min(from, bounds.max - MIN_CLIP_DURATION));
    const outPoint = Math.min(bounds.max, Math.max(to, inPoint + MIN_CLIP_DURATION));
    if (inPoint !== from || outPoint !== to) notes.push(`${assetId}'s range was limited to ${range(inPoint, outPoint)} (the file is ${secs(asset.duration)}s)`);

    const track = getTrack(p, trackId)!;
    const lastEnd = Math.max(0, ...trackClips(p, trackId).map(clipEnd));
    const start = optNumber(item, "start", { min: 0 }) ?? cursor.get(trackId) ?? (track.kind === "video" ? lastEnd : 0);
    const clip: Clip = {
      id: createId("clip"),
      assetId,
      trackId,
      start: roundTime(start),
      in: roundTime(inPoint),
      out: roundTime(outPoint),
      effects: defaultEffects(),
    };
    p = addClip(p, clip);
    const placed = getClip(p, clip.id)!;
    if (Math.abs(placed.start - clip.start) > EPS) notes.push(`${clip.id} would have overlapped a clip at ${secs(clip.start)}, so it starts at ${secs(placed.start)}`);
    cursor.set(trackId, clipEnd(placed));
    lines.push(`Added ${place(p, placed, env)} (source ${range(placed.in, placed.out)}).`);
  }
  return { project: p, text: withNotes(lines.join("\n"), notes) };
};

const addText: EditHandler = (project, input, env) => {
  const text = string(input, "text");
  const start = number(input, "start", { min: 0 });
  const duration = optNumber(input, "duration", { min: MIN_CLIP_DURATION }) ?? STILL_DURATION;
  const style = optObject(input, "style") ?? {};
  const textKeys = Object.fromEntries(Object.entries(style).filter(([k]) => TEXT.params.some((s) => s.key === k)));
  const lookKeys = Object.fromEntries(Object.entries(style).filter(([k]) => !(k in textKeys)));
  const t = checkParams(TEXT.params, textKeys, "Text", ["text"]);
  const look = checkParams(APPEARANCE.params, lookKeys, "Text style");
  const position = optVec2(input, "position");
  const trackId = optString(input, "trackId");

  const clip: Omit<Clip, "trackId"> = {
    id: createId("clip"),
    assetId: "",
    start: roundTime(start),
    in: 0,
    out: roundTime(duration),
    effects: textEffects({ ...t.values, text }),
  };
  let p: Project;
  if (trackId) {
    const track = trackOf(project, trackId);
    if (track.kind !== "video") throw new ToolError("Text goes on a video track.");
    p = addClip(project, { ...clip, trackId });
  } else {
    p = addTextClip(project, clip).project;
  }
  if (Object.keys(look.values).length) p = setParams(p, clip.id, APPEARANCE.type, look.values);
  if (position) p = setParams(p, clip.id, MOTION.type, { position });
  return { project: p, text: withNotes(`Added text ${place(p, getClip(p, clip.id)!, env)}.`, [...t.notes, ...look.notes]) };
};

const addLayer: EditHandler = (project, input, env) => {
  const kind = oneOf(input, "kind", ["adjustment", "solid", "camera"] as const);
  if (!kind) throw new ToolError('`kind` must be "adjustment", "solid" or "camera".');
  const start = number(input, "start", { min: 0 });
  const duration = optNumber(input, "duration", { min: MIN_CLIP_DURATION }) ?? STILL_DURATION;
  const trackId = optString(input, "trackId");
  if (trackId && trackOf(project, trackId).kind !== "video") throw new ToolError(`A ${kind === "solid" ? "solid" : kind} goes on a video track.`);
  const color = optString(input, "color");
  if (kind !== "solid" && color !== undefined) throw new ToolError("`color` is only for solids.");
  const cameraValues = optObject(input, "camera");
  if (kind !== "camera" && cameraValues) throw new ToolError("`camera` is only for cameras.");
  if (kind === "camera" && input.effects !== undefined) throw new ToolError("A camera takes no effects: it's what 3D layers are seen through.");
  const values =
    kind === "solid" && color !== undefined
      ? checkParams(SOLID.params, { color }, "Solid").values
      : kind === "camera" && cameraValues
        ? checkParams(CAMERA.params, cameraValues, "Camera").values
        : {};
  const clip = newLayerClip(kind, start, duration, values);
  let p = addLayerClip(project, clip, trackId).project;
  const notes: string[] = [];
  const raw = input.effects;
  if (raw !== undefined && !Array.isArray(raw)) throw new ToolError("`effects` must be a list of { type, params }.");
  for (const [i, item] of (raw ?? []).entries()) {
    if (!item || typeof item !== "object") throw new ToolError(`effects[${i}] must be { type, params }.`);
    const type = string(item as Input, "type");
    const def = effectDefinition(type);
    if (!def?.shader) throw new ToolError(`effects[${i}]: "${type}" isn't a video effect. See get_catalog with kind "video_effects".`);
    const { values, notes: clamped } = checkParams(def.params, optObject(item as Input, "params") ?? {}, def.label);
    notes.push(...clamped);
    const res = addEffect(p, [clip.id], type);
    p = res.project;
    if (Object.keys(values).length) p = setParams(p, clip.id, res.added.get(clip.id)!, values);
  }
  const placed = getClip(p, clip.id)!;
  if (trackId && placed.trackId !== trackId) notes.push(`${trackName(project, trackId)} wasn't free there, so it went on ${trackName(p, placed.trackId)}`);
  const effects = placed.effects.filter(isVideoEffect).map((e) => e.id);
  return {
    project: p,
    text: withNotes(
      `Added ${kind === "adjustment" ? "adjustment layer" : kind} ${place(p, placed, env)}${effects.length ? ` with ${effects.join(", ")}` : ""}.` +
        (kind === "camera" ? " Only 3D layers (motion threeD: true) are seen through it." : ""),
      notes,
    ),
  };
};

const applyPreset: EditHandler = (project, input, env) => {
  const type = string(input, "type");
  const def = presetDefinition(type);
  if (!def) throw new ToolError(`There's no preset "${type}". See get_catalog with kind "presets".`);
  const at = optNumber(input, "at", { min: 0 });
  const ids = optStrings(input, "clipIds");
  const trackId = optString(input, "trackId");
  if (trackId && trackOf(project, trackId).kind !== "video") throw new ToolError("A preset's adjustment layer goes on a video track.");
  if (def.kind === "effect" && ids?.length) {
    ids.forEach((id) => clipOf(project, id));
    const p = applyPresetToClips(project, ids, type);
    if (p === project) throw new ToolError("Presets only go on clips on video tracks.");
    return { project: p, text: `Put ${def.label} on ${ids.join(", ")} (see get_clips for the effects and keyframes it added).` };
  }
  if (at === undefined) {
    throw new ToolError(def.kind === "transition" ? "`at` (the cut's timeline time) is required for a transition preset." : "Give `clipIds`, or `at` for an adjustment layer.");
  }
  const { project: p, clipId } = addPresetLayer(project, type, at, trackId);
  const layer = getClip(p, clipId!)!;
  const effects = layer.effects.filter(isVideoEffect).map((e) => e.id);
  const where = def.kind === "transition" ? `centred on ${secs(at)}` : `from ${secs(layer.start)}`;
  return {
    project: p,
    text: `Added ${def.label}: adjustment layer ${place(p, layer, env)} ${where}${effects.length ? ` with ${effects.join(", ")}` : ""}.`,
  };
};

// ---------------------------------------------------------------------------
// Arranging
// ---------------------------------------------------------------------------

const move: EditHandler = (project, input, env) => {
  const ids = strings(input, "clipIds");
  const clips = ids.map((id) => clipOf(project, id));
  const to = optNumber(input, "to", { min: 0 });
  const by = optNumber(input, "by");
  const trackId = optString(input, "trackId");
  if (to === undefined && by === undefined && !trackId) throw new ToolError("Give `to`, `by` or `trackId`.");
  if (trackId) {
    const target = trackOf(project, trackId);
    const wrong = clips.find((c) => getTrack(project, c.trackId)?.kind !== target.kind);
    if (wrong) throw new ToolError(`${wrong.id} is on a ${getTrack(project, wrong.trackId)?.kind} track; it can't move to ${target.kind} track "${target.name}".`);
  }
  const first = Math.min(...clips.map((c) => c.start));
  const delta = to !== undefined ? to - first : (by ?? 0);
  const p = moveClips(project, ids, delta, trackId ? () => trackId : undefined);
  const moved = ids.map((id) => getClip(p, id)!);
  const actual = Math.min(...moved.map((c) => c.start)) - first;
  const notes = Math.abs(actual - delta) > 1e-4 ? [`there wasn't room at ${secs(Math.max(0, first + delta))}, so they moved by ${secs(actual)}s instead`] : [];
  if (p === project) return { project, text: withNotes("Nothing moved.", notes) };
  return { project: p, text: withNotes(moved.map((c) => `Moved ${place(p, c, env)}.`).join("\n"), notes) };
};

const trim: EditHandler = (project, input, env) => {
  const clip = clipOf(project, string(input, "clipId"));
  const start = optNumber(input, "start", { min: 0 });
  const end = optNumber(input, "end", { min: 0 });
  const ripple = optBoolean(input, "ripple") ?? false;
  if (start === undefined && end === undefined) throw new ToolError("Give `start` and/or `end` (the new edge times).");
  if (start !== undefined && end !== undefined && end - start < MIN_CLIP_DURATION) throw new ToolError(`A clip must be at least ${MIN_CLIP_DURATION}s long.`);
  let p = project;
  if (ripple) {
    if ((start !== undefined && start < clip.start - EPS) || (end !== undefined && end > clipEnd(clip) + EPS)) {
      throw new ToolError("A ripple trim only shortens a clip. Lengthen it without `ripple`.");
    }
    // The end first, so `start` still means the same place.
    if (end !== undefined && end < clipEnd(clip) - EPS) p = rippleTrimTo(p, clip.id, "end", end);
    if (start !== undefined && start > clip.start + EPS) p = rippleTrimTo(p, clip.id, "start", start);
  } else {
    const bounds = clipSourceRange(clip, env.assets[clip.assetId]);
    if (start !== undefined) p = trimClip(p, clip.id, "start", start - clip.start, bounds);
    if (end !== undefined) p = trimClip(p, clip.id, "end", end - clipEnd(getClip(p, clip.id)!), bounds);
  }
  const after = getClip(p, clip.id)!;
  const notes: string[] = [];
  if (!ripple && start !== undefined && Math.abs(after.start - start) > 1e-4) notes.push(`the left edge stopped at ${secs(after.start)} (the media or the clip before is in the way)`);
  if (!ripple && end !== undefined && Math.abs(clipEnd(after) - end) > 1e-4) notes.push(`the right edge stopped at ${secs(clipEnd(after))} (the media or the clip after is in the way)`);
  return {
    project: p,
    text: withNotes(`Trimmed: ${place(p, after, env)} (source ${range(after.in, after.out)})${ripple ? "; the rest of the track moved left" : ""}.`, notes),
  };
};

const setSpeed: EditHandler = (project, input, env) => {
  const ids = strings(input, "clipIds");
  const clips = ids.map((id) => clipOf(project, id));
  const speed = optNumber(input, "speed", { min: MIN_SPEED, max: MAX_SPEED });
  const duration = optNumber(input, "duration", { min: MIN_CLIP_DURATION });
  const reversed = optBoolean(input, "reversed");
  const keepPitch = optBoolean(input, "keepPitch");
  const interpolation = oneOf(input, "interpolation", ["frames", "blend", "flow"] as const);
  if (speed !== undefined && duration !== undefined) throw new ToolError("Give `speed` or `duration`, not both.");
  if (speed === undefined && duration === undefined && reversed === undefined && keepPitch === undefined && interpolation === undefined) {
    throw new ToolError("Give `speed`, `duration`, `reversed`, `keepPitch` and/or `interpolation`.");
  }
  const still = clips.find((c) => !canRetime(c, env.assets[c.assetId]));
  if (still) throw new ToolError(`${still.id} is ${isTextClip(still) ? "text" : "a still image"}: only video and sound clips have a speed. Change its length with trim_clip.`);
  let p = project;
  const notes: string[] = [];
  if (duration !== undefined) {
    // Each clip gets its own speed to last `duration`.
    for (const clip of clips) {
      const fit = speedForDuration(clip, duration);
      p = setClipSpeed(p, [clip.id], { speed: fit, reversed, keepPitch, interpolation });
      const lasts = clipDuration(getClip(p, clip.id)!);
      if (Math.abs(lasts - duration) > 1e-3) notes.push(`${clip.id} can only go from ${secs((clip.out - clip.in) / maxClipSpeed(clip))}s to ${secs((clip.out - clip.in) / MIN_SPEED)}s at speeds ${MIN_SPEED}–${MAX_SPEED}, so it lasts ${secs(lasts)}s`);
    }
  } else {
    p = setClipSpeed(p, ids, { speed, reversed, keepPitch, interpolation });
    for (const clip of clips) {
      const got = clipSpeed(getClip(p, clip.id)!);
      if (speed !== undefined && Math.abs(got - speed) > 1e-6) notes.push(`${clip.id} is too short to play faster than ${got}× (a clip lasts at least ${MIN_CLIP_DURATION}s)`);
    }
  }
  if (p === project) return { project, text: withNotes("Nothing changed: the clips already play like that.", notes) };
  const lines = ids.map((id) => {
    const c = getClip(p, id)!;
    const how = [
      `${clipSpeed(c)}×`,
      ...(c.reversed ? ["reversed"] : []),
      ...(c.keepPitch === false ? ["pitch follows speed"] : []),
      ...(c.timeInterpolation ? [c.timeInterpolation === "flow" ? "optical flow" : "frame blending"] : []),
    ];
    return `${place(p, c, env)}: ${how.join(", ")}.`;
  });
  const moved = p.clips.filter((c) => !ids.includes(c.id) && getClip(project, c.id)?.start !== c.start).length;
  if (moved) lines.push(`${moved} later clip${moved === 1 ? "" : "s"} on the same track${moved === 1 ? "" : "s"} moved with ${ids.length === 1 ? "its" : "their"} end.`);
  return { project: p, text: withNotes(lines.join("\n"), notes) };
};

const split: EditHandler = (project, input) => {
  const at = number(input, "at", { min: 0 });
  const given = optStrings(input, "clipIds");
  given?.forEach((id) => clipOf(project, id));
  const ids = given ?? clipsAtTime(project, at).filter((c) => isOnVideoTrack(project, c)).map((c) => c.id);
  if (ids.length === 0) throw new ToolError(`No clip on a video track is under ${secs(at)}. Pass clipIds to split others.`);
  let p = project;
  const lines: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const res = splitClip(p, id, at);
    if (!res.newClipId) {
      skipped.push(id);
      continue;
    }
    p = res.project;
    lines.push(`${id} → ${id} (left) + ${res.newClipId} (right, from ${secs(at)})`);
  }
  if (lines.length === 0) throw new ToolError(`${secs(at)} isn't inside those clips (at least ${MIN_CLIP_DURATION}s from their edges).`);
  const notes = skipped.length ? [`not split (not under ${secs(at)} or too near an edge): ${skipped.join(", ")}`] : [];
  return { project: p, text: withNotes(`Split at ${secs(at)}:\n${lines.join("\n")}`, notes) };
};

const deleteClips: EditHandler = (project, input) => {
  const ids = strings(input, "clipIds");
  ids.forEach((id) => clipOf(project, id));
  const ripple = optBoolean(input, "ripple") ?? false;
  const p = ripple ? rippleDelete(project, ids) : removeClips(project, ids);
  return { project: p, text: `Deleted ${ids.join(", ")}${ripple ? " and closed the gaps" : ""}.` };
};

const closeGaps: EditHandler = (project, input) => {
  const track = trackOf(project, string(input, "trackId"));
  const at = optNumber(input, "at", { min: 0 });
  if (at !== undefined) {
    const p = closeGap(project, track.id, at);
    if (p === project) throw new ToolError(`There's no gap at ${secs(at)} on "${track.name}".`);
    return { project: p, text: `Closed the gap at ${secs(at)} on "${track.name}".` };
  }
  let p = closeGap(project, track.id, 0);
  let closed = p === project ? 0 : 1;
  for (let guard = 0; guard < 10_000; guard++) {
    const clips = trackClips(p, track.id);
    const gap = clips.findIndex((c, i) => i + 1 < clips.length && clips[i + 1].start - clipEnd(c) > EPS);
    if (gap === -1) break;
    p = closeGap(p, track.id, (clipEnd(clips[gap]) + clips[gap + 1].start) / 2);
    closed++;
  }
  return { project: p, text: closed ? `Closed ${closed} gap${closed === 1 ? "" : "s"} on "${track.name}".` : `"${track.name}" has no gaps.` };
};

const duplicate: EditHandler = (project, input, env) => {
  const ids = strings(input, "clipIds");
  ids.forEach((id) => clipOf(project, id));
  const copied = copyClips(project, ids);
  const at = optNumber(input, "at", { min: 0 }) ?? Math.max(...copied.map((c) => clipEnd(c.clip)));
  const res = pasteClips(project, copied, at);
  return { project: res.project, text: `Copies: ${res.clipIds.map((id) => place(res.project, getClip(res.project, id)!, env)).join("; ")}.` };
};

// ---------------------------------------------------------------------------
// Properties and effects
// ---------------------------------------------------------------------------

const setProperties: EditHandler = (project, input) => {
  const ids = strings(input, "clipIds");
  const effectId = string(input, "effect");
  const raw = optObject(input, "params");
  if (!raw || Object.keys(raw).length === 0) throw new ToolError("`params` must have at least one value.");
  const at = optNumber(input, "at", { min: 0 });
  let p = project;
  const notes: string[] = [];
  for (const id of ids) {
    const clip = clipOf(p, id);
    const { effect, def } = effectOf(clip, effectId);
    const { values, notes: clamped } = checkParams(def.params, raw, def.label);
    notes.push(...clamped);
    const animated = Object.keys(values).filter((k) => effect.keyframes?.[k]?.length);
    if (animated.length && at === undefined) {
      notes.push(`${animated.join(", ")} ${animated.length === 1 ? "is" : "are"} animated on ${id}, so ${animated.length === 1 ? "it" : "they"} kept ${animated.length === 1 ? "its" : "their"} keyframes: pass \`at\` to keyframe the new value, or use set_keyframes`);
    }
    const time = at === undefined ? undefined : keyframeTime(clip, at, p.settings.fps);
    p = setParams(p, id, effect.id, values, time);
  }
  const summary = Object.entries(raw).map(([k, v]) => `${k} ${value(v)}`).join(", ");
  return { project: p, text: withNotes(`Set ${summary} (${effectId}) on ${ids.join(", ")}.`, notes) };
};

const setKeyframes: EditHandler = (project, input) => {
  const clip = clipOf(project, string(input, "clipId"));
  const { effect, def } = effectOf(clip, string(input, "effect"));
  const key = string(input, "param");
  const spec = def.params.find((s) => s.key === key);
  if (!spec) throw new ToolError(`${def.label} has no parameter "${key}". Its parameters: ${def.params.map((s) => s.key).join(", ")}.`);
  if (!canAnimate(effect, key)) throw new ToolError(`${def.label} "${key}" can't be animated (only numbers and points can).`);
  const raw = input.keyframes;
  if (!Array.isArray(raw)) throw new ToolError("`keyframes` must be a list (empty to stop animating).");

  if (raw.length === 0) {
    const first = effect.keyframes?.[key]?.[0]?.time ?? clip.in;
    let p = setAnimated(project, clip.id, effect.id, key, first, false);
    const still = input.value;
    if (still !== undefined) {
      const clean = sanitizeValue(spec, still);
      if (clean === undefined) throw new ToolError(`\`value\` must be ${expected(spec)}.`);
      p = setParams(p, clip.id, effect.id, { [key]: clean });
    }
    return { project: p, text: `${key} of ${clip.id} isn't animated any more.` };
  }

  const keys = new Map<number, Keyframe>();
  const notes: string[] = [];
  for (const [i, k] of raw.entries()) {
    if (!k || typeof k !== "object") throw new ToolError(`keyframes[${i}] must be { time, value }.`);
    const kf = k as Input;
    const t = number(kf, "time", { min: 0 });
    if (t < clip.start - 1e-3 || t > clipEnd(clip) + 1e-3) {
      throw new ToolError(`keyframes[${i}] at ${secs(t)} is outside ${clip.id} (${range(clip.start, clipEnd(clip))}).`);
    }
    const v = sanitizeValue(spec, kf.value);
    if (v === undefined) throw new ToolError(`keyframes[${i}].value must be ${expected(spec)}.`);
    if (JSON.stringify(v) !== JSON.stringify(kf.value)) notes.push(`a value was limited to ${value(v)}`);
    const easing: Easing = oneOf(kf, "easing", EASINGS) ?? "linear";
    const influence = optNumber(kf, "influence", { min: MIN_INFLUENCE, max: 1 });
    const time = toSource(clip, t);
    keys.set(time, { time, value: v, easing, ...(influence !== undefined && Math.abs(influence - DEFAULT_INFLUENCE) > 1e-6 && { influence: tidy(influence) }) });
  }
  const sorted = [...keys.values()].sort((a, b) => a.time - b.time);
  const p = updateEffect(project, clip.id, effect.id, (e) => ({ ...e, keyframes: { ...e.keyframes, [key]: sorted } }));
  const shown = sorted.map((k) => `${secs(timelineTime(clip, k.time))}: ${value(k.value)}`).join(", ");
  return { project: p, text: withNotes(`Animated ${key} (${effect.id}) on ${clip.id}: ${shown}.`, notes) };
};

const addEffects: EditHandler = (project, input) => {
  const ids = strings(input, "clipIds");
  ids.forEach((id) => clipOf(project, id));
  const type = string(input, "type");
  const def = effectDefinition(type);
  if (!def?.shader) throw new ToolError(`"${type}" isn't a video effect. See get_catalog with kind "video_effects".`);
  const raw = optObject(input, "params") ?? {};
  const { values, notes } = checkParams(def.params, raw, def.label);
  const res = addEffect(project, ids, type);
  if (res.added.size === 0) throw new ToolError("Video effects only go on clips on video tracks.");
  let p = res.project;
  if (Object.keys(values).length) for (const [clipId, effectId] of res.added) p = setParams(p, clipId, effectId, values);
  const skipped = ids.filter((id) => !res.added.has(id));
  if (skipped.length) notes.push(`not on a video track, so skipped: ${skipped.join(", ")}`);
  const added = [...res.added].map(([clipId, effectId]) => `${clipId}: ${effectId}`).join(", ");
  return { project: p, text: withNotes(`Added ${def.label} (effect ids: ${added}).`, notes) };
};

const editEffect: EditHandler = (project, input) => {
  const ids = strings(input, "clipIds");
  const effectId = string(input, "effect");
  const enabled = optBoolean(input, "enabled");
  const reset = optBoolean(input, "reset") ?? false;
  const move = oneOf(input, "move", ["earlier", "later"] as const);
  const remove = optBoolean(input, "remove") ?? false;
  if (enabled === undefined && !reset && !move && !remove) throw new ToolError("Give `enabled`, `reset`, `move` or `remove`.");
  let p = project;
  const done: string[] = [];
  for (const id of ids) {
    const { effect, def } = effectOf(clipOf(p, id), effectId);
    if (remove) {
      if (!isVideoEffect(effect)) throw new ToolError(`${def.label} is built in and can't be removed; turn it off (enabled: false) or reset it.`);
      p = removeEffect(p, id, effect.id);
      continue;
    }
    if (reset) p = resetParams(p, id, effect.id);
    if (enabled !== undefined) p = setEffectEnabled(p, id, effect.id, enabled);
    if (move) p = moveEffect(p, id, effect.id, move === "earlier" ? -1 : 1);
  }
  if (remove) done.push("removed");
  if (reset) done.push("reset");
  if (enabled !== undefined) done.push(enabled ? "turned on" : "turned off");
  if (move) done.push(`moved ${move}`);
  return { project: p, text: `${effectId} ${done.join(", ")} on ${ids.join(", ")}.` };
};

const copyEffectsTo: EditHandler = (project, input) => {
  const from = clipOf(project, string(input, "fromClipId"));
  const to = strings(input, "toClipIds");
  to.forEach((id) => clipOf(project, id));
  const types = optStrings(input, "types");
  types?.forEach((t) => {
    if (!EFFECTS.some((d) => d.type === t)) throw new ToolError(`There's no effect type "${t}".`);
  });
  const p = pasteEffects(project, to, copyEffects(from), types);
  return { project: p, text: p === project ? "Nothing changed (they already had those effects)." : `Pasted ${types?.join(", ") ?? "every effect"} from ${from.id} onto ${to.join(", ")}.` };
};

// ---------------------------------------------------------------------------
// Transitions and tracks
// ---------------------------------------------------------------------------

function describeTransition(project: Project, ref: TransitionRef): string {
  const w = findWindow(project, ref);
  if (!w) return `${ref.clipId} ${ref.edge}`;
  const where = w.from && w.to ? `the cut between ${w.from.id} and ${w.to.id} at ${secs(w.at)}` : `${ref.clipId}'s ${ref.edge === "in" ? "start" : "end"} (${secs(w.at)})`;
  return `${w.def.label} on ${where}, ${secs(w.transition.duration)}s ${w.transition.alignment}, playing ${range(w.start, w.end)}`;
}

const setTransition: EditHandler = (project, input) => {
  const clip = clipOf(project, string(input, "clipId"));
  const edge = oneOf(input, "edge", ["in", "out"] as const);
  if (!edge) throw new ToolError('`edge` must be "in" or "out".');
  if (!isOnVideoTrack(project, clip)) throw new ToolError("Transitions go on clips on video tracks.");
  const ref: TransitionRef = { clipId: clip.id, edge };
  let p = project;
  let target = canonicalRef(p, ref);

  if (input.type === null) {
    p = removeTransition(removeTransition(p, target), ref);
    if (p === project) throw new ToolError(`There's no transition at ${clip.id}'s ${edge} edge.`);
    return { project: p, text: `Removed the transition at ${clip.id}'s ${edge} edge.` };
  }
  const type = optString(input, "type");
  if (type !== undefined) {
    if (!transitionDefinition(type)) throw new ToolError(`There's no transition "${type}". See get_catalog with kind "transitions".`);
    const res = addTransition(p, ref, type);
    if (!res.ref) throw new ToolError("A transition can't go there.");
    p = res.project;
    target = res.ref;
  }
  const stored = storedTransition(getClip(p, target.clipId)!, target.edge);
  if (!stored) throw new ToolError(`There's no transition at ${clip.id}'s ${edge} edge yet; give a \`type\`.`);
  const def = transitionDefinition(stored.type)!;
  const patch: ParamValues = {};
  const notes: string[] = [];
  const duration = optNumber(input, "duration");
  if (duration !== undefined) patch[DURATION_SPEC.key] = duration;
  const alignment = oneOf(input, "alignment", ["center", "start", "end"] as const);
  if (alignment) patch[ALIGNMENT_SPEC.key] = alignment;
  const params = optObject(input, "params");
  if (params) {
    const checked = checkParams(def.params, params, def.label);
    Object.assign(patch, checked.values);
    notes.push(...checked.notes);
  }
  if (Object.keys(patch).length) p = setTransitionParams(p, target, patch);
  const w = findWindow(p, target);
  if (w && duration !== undefined && Math.abs(w.end - w.start - duration) > 1e-3) notes.push(`it only has room to play for ${secs(w.end - w.start)}s`);
  return { project: p, text: withNotes(`${describeTransition(p, target)}.`, notes) };
};

const addTrackTool: EditHandler = (project, input) => {
  const kind = oneOf(input, "kind", ["video", "audio"] as const);
  if (!kind) throw new ToolError('`kind` must be "video" or "audio".');
  const res = addTrack(project, kind);
  return { project: res.project, text: `Added ${kind} track ${res.trackId} ${trackName(res.project, res.trackId)}.` };
};

const editTrack: EditHandler = (project, input) => {
  const track = trackOf(project, string(input, "trackId"));
  if (optBoolean(input, "remove")) {
    const p = removeTrack(project, track.id);
    if (p === project) throw new ToolError("The last video track can't be removed.");
    return { project: p, text: `Removed "${track.name}" and its clips.` };
  }
  const muted = optBoolean(input, "muted");
  if (muted === undefined) throw new ToolError("Give `muted` or `remove`.");
  return { project: setTrackMuted(project, track.id, muted), text: `"${track.name}" is ${muted ? "muted" : "unmuted"}.` };
};

const setProject: EditHandler = (project, input) => {
  const name = optString(input, "name")?.trim();
  const aspectRatio = oneOf(input, "aspectRatio", ASPECT_RATIOS);
  const fps = optNumber(input, "fps");
  if (fps !== undefined && ![24, 25, 30, 60].includes(fps)) throw new ToolError("`fps` must be 24, 25, 30 or 60.");
  if (!name && !aspectRatio && fps === undefined) throw new ToolError("Give `name`, `aspectRatio` or `fps`.");
  const settings = { ...project.settings, ...(aspectRatio && { aspectRatio: aspectRatio as AspectRatio }), ...(fps && { fps }) };
  const same = settings.aspectRatio === project.settings.aspectRatio && settings.fps === project.settings.fps;
  const p = same ? project : { ...project, settings };
  const parts = [name && `named "${name}"`, `${settings.aspectRatio} at ${settings.fps} fps`].filter(Boolean);
  return { project: p, text: `The video is ${parts.join(", ")}.`, ...(name && { rename: name }) };
};

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

const styleCaptions: EditHandler = (project, input) => {
  const captions = captionClips(project);
  if (captions.length === 0) throw new ToolError("There are no captions yet. Add them with generate_captions.");
  let p = project;
  const notes: string[] = [];
  const presetId = optString(input, "preset");
  if (presetId) {
    const preset = CAPTION_PRESETS.find((c) => c.id === presetId);
    if (!preset) throw new ToolError(`There's no caption preset "${presetId}". Presets: ${CAPTION_PRESETS.map((c) => c.id).join(", ")}.`);
    p = applyCaptionPreset(p, preset);
  }
  const text = optObject(input, "text");
  if (text) {
    const checked = checkParams(TEXT.params, text, "Caption text", ["text"]);
    notes.push(...checked.notes);
    p = setCaptionParams(p, TEXT.type, checked.values);
  }
  const look = optObject(input, "appearance");
  if (look) {
    const checked = checkParams(APPEARANCE.params, look, "Caption appearance");
    notes.push(...checked.notes);
    p = setCaptionParams(p, APPEARANCE.type, checked.values);
  }
  const position = optVec2(input, "position");
  if (position) p = captions.reduce((q, c) => setParams(q, c.id, MOTION.type, { position }), p);
  const animation = optString(input, "animation");
  if (animation !== undefined) {
    if (animation === "none") p = setCaptionAnimation(p, null);
    else {
      const anim = captionAnimation(animation);
      if (!anim) throw new ToolError(`There's no transition "${animation}" to animate captions with. See get_catalog "caption_styles".`);
      p = setCaptionAnimation(p, anim);
    }
  }
  return { project: p, text: withNotes(`Restyled ${captions.length} caption${captions.length === 1 ? "" : "s"}.`, notes) };
};

const mergeCaptions: EditHandler = (project, input) => {
  const clip = clipOf(project, string(input, "clipId"));
  const p = mergeCaptionWithNext(project, clip.id);
  if (p === project) throw new ToolError(`${clip.id} isn't a caption followed by another caption on its track.`);
  return { project: p, text: `Merged ${clip.id} with the caption after it.` };
};

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

const batch: EditHandler = (project, input, env) => {
  const steps = input.steps;
  if (!Array.isArray(steps) || steps.length === 0) throw new ToolError("`steps` must be a non-empty list.");
  let p = project;
  let rename: string | undefined;
  const lines: string[] = [];
  for (const [i, raw] of steps.entries()) {
    const step = raw && typeof raw === "object" ? (raw as Input) : {};
    const tool = typeof step.tool === "string" ? step.tool.replace(/^mcp__editor__/, "") : "";
    const handler = tool && tool !== "batch" ? (EDITS as Record<string, EditHandler | undefined>)[tool] : undefined;
    if (!handler) throw new ToolError(`Step ${i + 1}: "${tool}" isn't an edit tool that can go in a batch. Nothing was changed.`);
    const stepInput = step.input && typeof step.input === "object" && !Array.isArray(step.input) ? (step.input as Input) : {};
    try {
      const out = handler(p, stepInput, env);
      p = out.project;
      rename = out.rename ?? rename;
      lines.push(`${i + 1}. ${out.text}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ToolError(`Step ${i + 1} (${tool}) failed: ${message} Nothing was changed.`);
    }
  }
  return { project: p, text: lines.join("\n"), ...(rename && { rename }) };
};

/** A video or sound file of the video, that can have subclips. */
function subclippable(env: EditEnv, assetId: string): MediaAsset {
  const asset = env.assets[assetId];
  if (!asset) throw new ToolError(`There's no media "${assetId}" in this video. Call list_media.`);
  if (!canSubclip(asset)) throw new ToolError(`"${asset.name}" is ${asset.kind === "image" ? "a still image" : "unreadable"}: only video and sound files have subclips.`);
  return asset;
}

const makeSubclips: EditHandler = (project, input, env) => {
  const asset = subclippable(env, string(input, "assetId"));
  const items = input.items;
  if (!Array.isArray(items) || items.length === 0) throw new ToolError("`items` must be a non-empty list of { in, out, name? }.");
  const parts = items.map((raw, i) => {
    const item = raw && typeof raw === "object" ? (raw as Input) : {};
    const from = number(item, "in");
    const to = number(item, "out");
    if (!subclipRange(from, to, asset.duration)) {
      throw new ToolError(
        `items[${i}] (${range(from, to)}) isn't a part of "${asset.name}" at least ${MIN_CLIP_DURATION}s long: the file is 0–${secs(asset.duration)}s. Nothing was made.`,
      );
    }
    return { in: from, out: to, name: optString(item, "name") };
  });
  const made = addSubclips(project, asset, parts);
  const lines = made.ids.map((id) => {
    const s = getSubclip(made.project, id)!;
    return `${id} "${s.name}" ${range(s.in, s.out)}`;
  });
  return {
    project: made.project,
    text: `Made ${made.ids.length} subclip${made.ids.length === 1 ? "" : "s"} of "${asset.name}" (source times; in the Media tab):\n${lines.join("\n")}`,
  };
};

const editSubclips: EditHandler = (project, input, env) => {
  const items = input.items;
  if (!Array.isArray(items) || items.length === 0) throw new ToolError("`items` must be a non-empty list.");
  let p = project;
  const lines: string[] = [];
  for (const [i, raw] of items.entries()) {
    const item = raw && typeof raw === "object" ? (raw as Input) : {};
    const id = string(item, "subclipId");
    const subclip = getSubclip(p, id);
    if (!subclip) throw new ToolError(`items[${i}]: there's no subclip "${id}". Call list_media for the subclip ids.`);
    if (optBoolean(item, "delete")) {
      p = removeSubclips(p, [id]);
      lines.push(`Deleted ${id} "${subclip.name}".`);
      continue;
    }
    const asset = subclippable(env, subclip.assetId);
    const name = optString(item, "name");
    if (name !== undefined && !cleanSubclipName(name)) throw new ToolError(`items[${i}]: \`name\` can't be empty.`);
    const from = optNumber(item, "in") ?? subclip.in;
    const to = optNumber(item, "out") ?? subclip.out;
    if (!subclipRange(from, to, asset.duration)) {
      throw new ToolError(`items[${i}]: ${range(from, to)} isn't a part of "${asset.name}" at least ${MIN_CLIP_DURATION}s long (the file is 0–${secs(asset.duration)}s).`);
    }
    p = updateSubclip(p, id, { name, in: from, out: to }, asset.duration);
    const now = getSubclip(p, id)!;
    lines.push(`${id} "${now.name}" ${range(now.in, now.out)}`);
  }
  return { project: p, text: lines.join("\n") };
};

/** Every edit tool's handler. */
export const EDITS: Record<EditToolName, EditHandler> = {
  add_clips: addClips,
  add_text: addText,
  add_layer: addLayer,
  apply_preset: applyPreset,
  move_clips: move,
  trim_clip: trim,
  set_speed: setSpeed,
  split_clips: split,
  delete_clips: deleteClips,
  close_gaps: closeGaps,
  duplicate_clips: duplicate,
  set_properties: setProperties,
  set_keyframes: setKeyframes,
  add_effect: addEffects,
  edit_effect: editEffect,
  copy_effects: copyEffectsTo,
  set_transition: setTransition,
  add_track: addTrackTool,
  edit_track: editTrack,
  set_project: setProject,
  style_captions: styleCaptions,
  merge_captions: mergeCaptions,
  make_subclips: makeSubclips,
  edit_subclips: editSubclips,
  batch,
};

/** What an edit did to the clips: new ones, changed ones (by reference), and how many went. */
export function clipChanges(before: Project, after: Project): { added: string[]; changed: string[]; removed: number } {
  const old = new Map(before.clips.map((c) => [c.id, c]));
  const added: string[] = [];
  const changed: string[] = [];
  for (const c of after.clips) {
    const prev = old.get(c.id);
    if (!prev) added.push(c.id);
    else if (prev !== c) changed.push(c.id);
    old.delete(c.id);
  }
  return { added, changed, removed: old.size };
}
