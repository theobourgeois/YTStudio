/**
 * Text animators at a moment (the Animator effect, `effect-library/text-animator.ts`): how
 * much each character, word or line of a text is selected, and what that does to it. The
 * geometry (where each glyph is) is the browser's, so the drawing itself is in
 * `src/lib/text-render.ts`; everything here is pure and shared with the tests.
 */
import { TEXT_ANIMATOR } from "./effect-library/text-animator.ts";
import { TEXT, addEffect, effectValuesAt, findEffect, updateEffect } from "./effects.ts";
import { tidy } from "./math.ts";
import type { Clip, Effect, Keyframe, ParamValues, Project, Vec2 } from "./types.ts";

export type AnimatorUnit = "characters" | "words" | "lines";
export type AnimatorShape = "square" | "ramp-up" | "ramp-down" | "triangle" | "round" | "smooth";

/** One animator's values at a moment. */
export interface TextAnimation {
  basedOn: AnimatorUnit;
  start: number;
  end: number;
  offset: number;
  shape: AnimatorShape;
  randomOrder: boolean;
  /** Reference px (the canvas at 1080p), like the text's size. */
  position: Vec2;
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  blur: number;
  /** Thousandths of an em. */
  tracking: number;
  /** A colour to turn the fill into, or null to leave it. */
  fill: string | null;
}

const animatorEffects = (clip: Pick<Clip, "effects">) => clip.effects.filter((e) => e.type === TEXT_ANIMATOR.type);

/** A text clip's enabled animators at source time `time`, in the order they apply (none: an empty list). */
export function textAnimationsAt(clip: Pick<Clip, "id" | "effects">, time: number): TextAnimation[] {
  return animatorEffects(clip)
    .filter((e) => e.enabled)
    .map((e) => {
      const v = effectValuesAt(TEXT_ANIMATOR, e, time, clip);
      return {
        basedOn: v.basedOn as AnimatorUnit,
        start: v.start as number,
        end: v.end as number,
        offset: v.offset as number,
        shape: v.shape as AnimatorShape,
        randomOrder: v.randomOrder === true,
        position: v.position as Vec2,
        scale: v.scale as number,
        rotation: v.rotation as number,
        opacity: v.opacity as number,
        blur: v.blur as number,
        tracking: v.tracking as number,
        fill: v.recolor === true ? (v.fill as string) : null,
      };
    });
}

/**
 * How far (reference px) a clip's animators can push its letters past where they're set:
 * room the text's frame keeps around it, whatever the moment, so nothing is cut off and the
 * frame doesn't change size as they animate. Worked out from the largest values they ever take.
 */
export function animatorReach(clip: Pick<Clip, "effects">, fontSize: number): number {
  let reach = 0;
  for (const e of animatorEffects(clip)) {
    if (!e.enabled) continue;
    const most = (key: string, measure: (v: unknown) => number) =>
      Math.max(measure(e.params[key]), ...(e.keyframes?.[key] ?? []).map((k) => measure(k.value)));
    const move = most("position", (v) => (Array.isArray(v) ? Math.hypot(v[0] as number, v[1] as number) : 0));
    const scale = most("scale", (v) => (typeof v === "number" ? v : 1));
    const blur = most("blur", (v) => (typeof v === "number" ? v : 0));
    const turned = most("rotation", (v) => (typeof v === "number" ? Math.abs(v) : 0)) > 0;
    // A word or a line grows from its middle: further than a letter does.
    const wide = e.params.basedOn === "characters" ? 1 : 3;
    reach = Math.max(reach, move + Math.max(0, scale - 1) * fontSize * wide + 2 * blur + (turned ? fontSize * wide * 0.5 : 0));
  }
  return Math.min(4000, Math.ceil(reach));
}

/**
 * Which unit (character, word or line) each code point of each line belongs to, numbered
 * across the whole text; -1 for white space, which belongs to none. `count` is how many
 * units there are.
 */
export function textUnits(lines: readonly string[], basedOn: AnimatorUnit): { count: number; of: number[][] } {
  let count = 0;
  const of = lines.map((line) => {
    const glyphs = [...line];
    if (basedOn === "lines") {
      const index = glyphs.some((g) => g.trim()) ? count++ : -1;
      return glyphs.map((g) => (g.trim() ? index : -1));
    }
    let inWord = false;
    return glyphs.map((g) => {
      if (!g.trim()) {
        inWord = false;
        return -1;
      }
      if (basedOn === "characters") return count++;
      if (!inWord) count++;
      inWord = true;
      return count - 1;
    });
  });
  return { count, of };
}

/** A repeatable shuffle of 0..count-1 (the same every frame, so Random Order doesn't flicker). */
export function shuffledOrder(count: number, seed = 1): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  let s = (seed * 2654435761) >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * How much (0..1) an animator acts on unit `index` of `count`. The text is laid along 0..1,
 * each unit taking an equal stretch; the range runs from `start` to `end`, both moved by
 * `offset`. A square range acts fully on what's inside it (and partly on a unit it only
 * partly covers, so sweeping it is smooth); the other shapes build up, fade out or peak
 * across the range. A ramp keeps going past the range's end: what it has passed stays changed.
 */
export function selectionAmount(a: Pick<TextAnimation, "start" | "end" | "offset" | "shape">, index: number, count: number): number {
  if (count <= 0 || index < 0) return 0;
  const lo = Math.min(a.start, a.end) + a.offset;
  const hi = Math.max(a.start, a.end) + a.offset;
  const from = index / count;
  const to = (index + 1) / count;
  if (a.shape === "square") return Math.max(0, Math.min(to, hi) - Math.max(from, lo)) * count;
  const width = hi - lo;
  const centre = (from + to) / 2;
  const t = width > 1e-9 ? (centre - lo) / width : centre >= lo ? 1 : 0;
  const inside = t >= 0 && t <= 1 && width > 1e-9;
  switch (a.shape) {
    case "ramp-up":
      return Math.min(1, Math.max(0, t));
    case "ramp-down":
      return 1 - Math.min(1, Math.max(0, t));
    case "triangle":
      return inside ? 1 - Math.abs(2 * t - 1) : 0;
    case "round":
      return inside ? Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) : 0;
    case "smooth":
      return inside ? 0.5 - 0.5 * Math.cos(2 * Math.PI * t) : 0;
  }
}

/** For one animator: each code point's unit, and how much the animator acts on it, line by line. */
export function glyphSelections(lines: readonly string[], a: TextAnimation): { unit: number; amount: number }[][] {
  const { count, of } = textUnits(lines, a.basedOn);
  const order = a.randomOrder ? shuffledOrder(count) : null;
  // (Stored fractions like a third are rounded: a hair's breadth in or out of the range is in or out.)
  const snap = (amount: number) => (amount < 1e-6 ? 0 : amount > 1 - 1e-6 ? 1 : tidy(amount));
  return of.map((line) => line.map((unit) => ({ unit, amount: unit < 0 ? 0 : snap(selectionAmount(a, order ? order[unit] : unit, count)) })));
}

// ---------------------------------------------------------------------------
// Ready-made animators (the Animator menu, and captions' animations)
// ---------------------------------------------------------------------------

export interface AnimatorPreset {
  id: string;
  label: string;
  /** Over the Animator defaults. */
  params: ParamValues;
  /** The range's keyframes, as [fraction of `duration`, value]. */
  keys: Record<string, [at: number, value: number][]>;
  /** Seconds it takes (from the clip's start), capped at the clip's length. */
  duration: number;
  /** Per unit, so long texts take longer: seconds for each character, word or line (then `duration` is the least). */
  per?: number;
}

const SWEEP_IN: AnimatorPreset["keys"] = { start: [[0, 0], [1, 1]] };

/**
 * Animators to start from. Each reveals the text from its start; the range can then be
 * re-timed or reshaped. (A soft reveal is a Ramp Up range sliding across from before the text
 * to past it: what it hasn't reached yet is fully changed, e.g. hidden.)
 */
export const ANIMATOR_PRESETS: readonly AnimatorPreset[] = [
  { id: "fade-characters", label: "Fade in by character", params: { basedOn: "characters", opacity: 0, shape: "ramp-up" }, keys: { offset: [[0, -1], [1, 1]] }, duration: 0.6, per: 0.03 },
  { id: "typewriter", label: "Typewriter", params: { basedOn: "characters", opacity: 0 }, keys: SWEEP_IN, duration: 0.6, per: 0.05 },
  { id: "pop-words", label: "Pop in by word", params: { basedOn: "words", scale: 0, opacity: 0 }, keys: SWEEP_IN, duration: 0.4, per: 0.12 },
  { id: "rise-words", label: "Rise by word", params: { basedOn: "words", position: [0, 60], opacity: 0, shape: "ramp-up" }, keys: { offset: [[0, -1], [1, 1]] }, duration: 0.5, per: 0.1 },
  { id: "slide-lines", label: "Slide up by line", params: { basedOn: "lines", position: [0, 80], opacity: 0 }, keys: SWEEP_IN, duration: 0.5, per: 0.2 },
  { id: "blur-characters", label: "Blur in by character", params: { basedOn: "characters", blur: 24, opacity: 0, shape: "ramp-up" }, keys: { offset: [[0, -1], [1, 1]] }, duration: 0.7, per: 0.03 },
  { id: "drop-characters", label: "Drop in by character", params: { basedOn: "characters", position: [0, -90], rotation: -20, opacity: 0, shape: "ramp-up" }, keys: { offset: [[0, -1], [1, 1]] }, duration: 0.6, per: 0.03 },
  { id: "tracking", label: "Tracking in", params: { basedOn: "characters", tracking: 400, opacity: 0 }, keys: { end: [[0, 1], [1, 0]] }, duration: 0.8 },
];

export function animatorPreset(id: string): AnimatorPreset | undefined {
  return ANIMATOR_PRESETS.find((p) => p.id === id);
}

/** How many units of a kind a text has. */
export const unitCount = (text: string, basedOn: AnimatorUnit) => textUnits(text.split("\n"), basedOn).count;

/**
 * A preset as an animator's values and keyframes for a clip (from its in-point), lasting as
 * long as the text needs (see `AnimatorPreset.per`) but never longer than the clip.
 */
export function presetAnimator(preset: AnimatorPreset, clip: Pick<Clip, "in" | "out">, text: string): { params: ParamValues; keyframes: Record<string, Keyframe[]> } {
  const units = unitCount(text, (preset.params.basedOn as AnimatorUnit) ?? "characters");
  const wanted = Math.max(preset.duration, (preset.per ?? 0) * units);
  const duration = Math.min(wanted, Math.max(0.05, Math.abs(clip.out - clip.in)));
  const keyframes: Record<string, Keyframe[]> = {};
  for (const [key, keys] of Object.entries(preset.keys)) {
    keyframes[key] = keys.map(([at, value]) => ({ time: tidy(clip.in + at * duration), value, easing: "linear" as const }));
  }
  return { params: preset.params, keyframes };
}

/** Put keyframes on an animator that was just added (see `presetAnimator`). */
export function setAnimatorKeyframes(project: Project, clipId: string, effectId: string, keyframes: Record<string, Keyframe[]>): Project {
  return updateEffect(project, clipId, effectId, (effect): Effect => ({ ...effect, keyframes: { ...effect.keyframes, ...keyframes } }));
}

/**
 * Add an animator to a text clip: a blank one (nothing changes until its values do), or a
 * preset with its range animated from the clip's start. Returns its effect id (null when
 * the clip isn't text).
 */
export function addAnimator(project: Project, clipId: string, presetId?: string, params?: ParamValues): { project: Project; effectId: string | null } {
  const clip = project.clips.find((c) => c.id === clipId);
  const preset = presetId ? animatorPreset(presetId) : undefined;
  if (!clip || (presetId && !preset)) return { project, effectId: null };
  const text = String(findEffect(clip, TEXT.type)?.params.text ?? "");
  const made = preset ? presetAnimator(preset, clip, text) : null;
  const added = addEffect(project, [clipId], TEXT_ANIMATOR.type, { ...made?.params, ...params });
  const effectId = added.added.get(clipId) ?? null;
  if (!effectId) return { project, effectId: null };
  return { project: made ? setAnimatorKeyframes(added.project, clipId, effectId, made.keyframes) : added.project, effectId };
}
