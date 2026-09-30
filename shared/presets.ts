/**
 * Presets, like After Effects' Animation Presets: ready-made moves and looks
 * built from the editor's own pieces (Motion, Opacity and video effects, with
 * keyframes), so everything a preset does stays editable afterwards.
 *
 * - A transition preset is an adjustment layer centred on a cut. Its Motion
 *   and effects animate across the cut and change both clips below it, which
 *   is how edit-style zoom, spin, whip and glitch transitions are made in After
 *   Effects: the picture speeds away from the outgoing shot (motion blurred,
 *   its edges mirrored) and settles into the incoming one.
 * - An effect preset is a move or a look put on clips (their own Motion and
 *   effects), or, where there's no clip, on an adjustment layer.
 *
 * Keyframe times are fractions of the preset's length (`PresetKey.at`), placed
 * on the clip by its `anchor`. Definitions are in `preset-library/`.
 */
import { MOTION, OPACITY, addEffect, defaultEffects, effectDefinition, findEffect, paramSpec, setParams, updateEffect } from "./effects.ts";
import { DEFAULT_INFLUENCE } from "./keyframes.ts";
import { tidy } from "./math.ts";
import { sanitizeValue } from "./params.ts";
import { PRESET_LIBRARY } from "./preset-library/index.ts";
import { addLayerClip, clipDuration, getClip, newLayerClip, sourceAt } from "./timeline.ts";
import type { Clip, Easing, Keyframe, ParamValue, ParamValues, Project } from "./types.ts";

export type PresetKind = "transition" | "effect";

/** Categories of presets, in the order the Effects tab's filter shows them. */
export const PRESET_TAGS = ["zoom", "spin", "slide", "shake", "distort", "glitch", "light", "blur", "look", "reveal"] as const;

export type PresetTag = (typeof PRESET_TAGS)[number];

export const PRESET_TAG_LABELS: Record<PresetTag, string> = {
  zoom: "Zoom",
  spin: "Spin",
  slide: "Slide",
  shake: "Shake",
  distort: "Distort",
  glitch: "Glitch",
  light: "Light",
  blur: "Blur",
  look: "Look",
  reveal: "Reveal",
};

/** A keyframe of a preset: at a fraction of its length. */
export interface PresetKey {
  /** 0..1 of the preset's length. */
  at: number;
  value: ParamValue;
  easing?: Easing;
  /** See `Keyframe.influence`. */
  influence?: number;
  /** Seconds to move it by, e.g. a hair before the cut for a value that jumps there. */
  nudge?: number;
}

/** One effect a preset sets: a built-in one (motion, opacity) or a video effect it adds. */
export interface PresetEffect {
  type: string;
  params?: ParamValues;
  keys?: Record<string, PresetKey[]>;
}

export interface PresetDefinition {
  type: string;
  label: string;
  kind: PresetKind;
  /** The first tag is its category. */
  tags: PresetTag[];
  /** Seconds: a transition's layer is this long, centred on the cut; an effect's keys span this much of the clip. */
  duration: number;
  /**
   * Where an effect preset's keys go on a clip: from its start (an entrance or a punch-in),
   * ending at its end (an exit), or stretched over the whole clip (a slow push-in). A
   * transition's always span its layer.
   */
  anchor?: "start" | "end" | "stretch";
  effects: PresetEffect[];
}

export const PRESETS: readonly PresetDefinition[] = PRESET_LIBRARY;

const byType = new Map(PRESETS.map((p) => [p.type, p]));

export function presetDefinition(type: string): PresetDefinition | undefined {
  return byType.get(type);
}

/** Every effect type a preset uses exists, and every value and key fits its parameter (checked by tests). */
export function presetProblems(def: PresetDefinition): string[] {
  const problems: string[] = [];
  for (const fx of def.effects) {
    const effect = effectDefinition(fx.type);
    if (!effect || (!effect.shader && effect !== MOTION && effect !== OPACITY)) {
      problems.push(`${def.type}: unknown effect ${fx.type}`);
      continue;
    }
    for (const [key, v] of Object.entries(fx.params ?? {})) {
      const spec = paramSpec(effect, key);
      if (!spec || sanitizeValue(spec, v) === undefined) problems.push(`${def.type}: ${fx.type}.${key} = ${JSON.stringify(v)}`);
    }
    for (const [key, keys] of Object.entries(fx.keys ?? {})) {
      const spec = paramSpec(effect, key);
      if (!spec || (spec.kind !== "number" && spec.kind !== "vec2")) problems.push(`${def.type}: ${fx.type}.${key} can't be keyframed`);
      else for (const k of keys) if (sanitizeValue(spec, k.value) === undefined || k.at < 0 || k.at > 1) problems.push(`${def.type}: ${fx.type}.${key} key ${JSON.stringify(k)}`);
    }
  }
  return problems;
}

/**
 * Put a preset's effects and keyframes on a clip, its keys over timeline span
 * [from, from + length). Motion and Opacity are set on the clip's own; video
 * effects are added after its others. A parameter the preset animates loses
 * its own keyframes.
 */
function applyEffects(project: Project, clipId: string, def: PresetDefinition, from: number, length: number): Project {
  let p = project;
  for (const fx of def.effects) {
    const clip = getClip(p, clipId);
    if (!clip) return p;
    let effectId = fx.type;
    if (fx.type !== MOTION.type && fx.type !== OPACITY.type) {
      const res = addEffect(p, [clipId], fx.type);
      const id = res.added.get(clipId);
      if (!id) continue;
      p = res.project;
      effectId = id;
    } else if (!findEffect(clip, fx.type)) {
      continue;
    }
    if (fx.params) p = setParams(p, clipId, effectId, fx.params);
    const keys = fx.keys;
    if (!keys) continue;
    const at = getClip(p, clipId)!;
    p = updateEffect(p, clipId, effectId, (effect, effectDef) => {
      const animated: Record<string, Keyframe[]> = { ...effect.keyframes };
      for (const [key, presetKeys] of Object.entries(keys)) {
        const spec = paramSpec(effectDef, key);
        if (!spec) continue;
        const list: Keyframe[] = [];
        for (const k of presetKeys) {
          const value = sanitizeValue(spec, k.value);
          if (value === undefined) continue;
          const time = tidy(sourceAt(at, from + k.at * length + (k.nudge ?? 0)));
          const keyframe: Keyframe = { time, value, easing: k.easing ?? "linear" };
          if (k.influence !== undefined && Math.abs(k.influence - DEFAULT_INFLUENCE) > 1e-6) keyframe.influence = k.influence;
          list.push(keyframe);
        }
        list.sort((a, b) => a.time - b.time);
        if (list.length) animated[key] = list;
      }
      return { ...effect, keyframes: animated };
    });
  }
  return p;
}

/**
 * Put an effect preset on clips: its keys from each clip's start, ending at its end, or
 * over all of it (`anchor`). Returns the project (the same one when nothing could take it).
 */
export function applyPresetToClips(project: Project, clipIds: readonly string[], type: string): Project {
  const def = presetDefinition(type);
  if (!def) return project;
  const videoTracks = new Set(project.tracks.filter((t) => t.kind === "video").map((t) => t.id));
  let p = project;
  for (const id of clipIds) {
    const clip = getClip(p, id);
    if (!clip || !videoTracks.has(clip.trackId)) continue;
    const length = def.kind === "transition" || def.anchor === "stretch" ? clipDuration(clip) : Math.min(def.duration, clipDuration(clip));
    const from = def.anchor === "end" ? clip.start + clipDuration(clip) - length : clip.start;
    p = applyEffects(p, id, def, from, length);
  }
  return p;
}

/**
 * Add a preset on an adjustment layer: a transition centred on the cut at timeline time
 * `at`, an effect from `at`; on video track `trackId` when it's free there, else on top.
 * Returns the layer's id (null when the preset doesn't exist).
 */
export function addPresetLayer(
  project: Project,
  type: string,
  at: number,
  trackId?: string,
  duration?: number,
): { project: Project; clipId: string | null } {
  const def = presetDefinition(type);
  if (!def) return { project, clipId: null };
  const length = duration ?? def.duration;
  const start = Math.max(0, def.kind === "transition" ? at - length / 2 : at);
  const layer = newLayerClip("adjustment", start, def.kind === "transition" ? at + length / 2 - start : length);
  let p = addLayerClip(project, layer, trackId).project;
  // A transition cut short at the start of the timeline keeps its cut in the middle of its move.
  const from = def.kind === "transition" ? at - length / 2 : start;
  p = applyEffects(p, layer.id, def, from, length);
  return { project: p, clipId: layer.id };
}

/**
 * A clip (on no project) wearing a preset from time 0, for drawing its card and its
 * sheet: an adjustment layer for a transition, else a stand-in for a media clip.
 */
export function presetClip(def: PresetDefinition): Clip {
  const clip: Clip =
    def.kind === "transition"
      ? { ...newLayerClip("adjustment", 0, def.duration), trackId: "t" }
      : { id: "preset", assetId: "preset", trackId: "t", start: 0, in: 0, out: def.duration, effects: defaultEffects() };
  const project: Project = {
    version: 1,
    name: "",
    settings: { aspectRatio: "9:16", fps: 30 },
    tracks: [{ id: "t", kind: "video", name: "", muted: false }],
    clips: [clip],
  };
  return applyEffects(project, clip.id, def, 0, def.duration).clips[0];
}
