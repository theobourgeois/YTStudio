/**
 * Transitions, like Premiere's: a transition sits on a clip edge. Between two
 * clips that touch it plays across the cut (from the outgoing clip to the
 * incoming one); on a free edge it plays inside the clip, from or to nothing
 * (whatever is underneath: lower tracks or the black canvas).
 *
 * Every transition is a GLSL shader (see `transition-gl.ts`) that mixes two
 * pictures, the outgoing and the incoming clip as placed on the canvas, by
 * `progress` (0..1). The preview and the export run the same shader, so they
 * look the same. Parameters are `ParamSpec`s (`params.ts`) like the effects', so
 * the properties panel draws them for free.
 *
 * To add a transition, add a definition to one of the `transition-library`
 * files. Where transitions are on the timeline (and how to edit them) is in
 * `transition-windows.ts`.
 */
import { roundTime } from "./math.ts";
import {
  type BooleanSpec,
  type ChoiceSpec,
  type NumberSpec,
  type Vec2Spec,
  defaultParams,
  sameValue,
  sanitizeParams,
  sanitizeValue,
} from "./params.ts";
import type { ParamValues, Transition, TransitionAlignment } from "./types.ts";
import { BLURS_AND_ZOOMS } from "./transition-library/camera.ts";
import { DISSOLVES } from "./transition-library/dissolve.ts";
import { DISTORTIONS } from "./transition-library/distort.ts";
import { GLITCHES } from "./transition-library/glitch.ts";
import { LIGHTS } from "./transition-library/light.ts";
import { SLIDES } from "./transition-library/slide.ts";
import { THREE_D } from "./transition-library/three-d.ts";
import { WIPES } from "./transition-library/wipe.ts";

/** Tags, in the order the library's filter shows them. */
export const TRANSITION_TAGS = [
  "dissolve",
  "slide",
  "wipe",
  "shape",
  "zoom",
  "3d",
  "glitch",
  "light",
  "distort",
  "blur",
  "stylize",
] as const;

export type TransitionTag = (typeof TRANSITION_TAGS)[number];

export const TAG_LABELS: Record<TransitionTag, string> = {
  dissolve: "Dissolve",
  slide: "Slide",
  wipe: "Wipe",
  shape: "Shape",
  zoom: "Zoom",
  "3d": "3D",
  glitch: "Glitch",
  light: "Light",
  distort: "Distort",
  blur: "Blur",
  stylize: "Stylize",
};

/** The kinds of parameter a shader can take as a uniform. */
export type TransitionParamSpec = NumberSpec | BooleanSpec | ChoiceSpec | Vec2Spec;

export interface TransitionDefinition {
  type: string;
  label: string;
  /** What kind of transition it is; the first tag is its category. */
  tags: TransitionTag[];
  /** Length of a new one, in seconds. */
  duration: number;
  /**
   * Parameters, available to the shader as uniforms named by their key:
   * numbers and switches as `float` (switches are 0 or 1), choices as `int`
   * (the option's index), points as `vec2` (canvas fractions, y down: use `toUv`).
   */
  params: TransitionParamSpec[];
  /**
   * GLSL ES 3.00 defining `vec4 transition(vec2 uv)`: the colour at `uv`
   * ((0, 0) = bottom left) for the current `progress`. It must show exactly
   * the outgoing picture at progress 0 and the incoming one at 1. See the
   * prelude in `transition-gl.ts` for what's available.
   */
  glsl: string;
}

/** Every transition, in the order the library shows them. */
export const TRANSITIONS: readonly TransitionDefinition[] = [
  ...DISSOLVES,
  ...SLIDES,
  ...WIPES,
  ...BLURS_AND_ZOOMS,
  ...THREE_D,
  ...GLITCHES,
  ...LIGHTS,
  ...DISTORTIONS,
];

/** What ⌘D / the Apply button add when nothing else is asked for (Premiere's default). */
export const DEFAULT_TRANSITION = "cross-dissolve";

const byType = new Map(TRANSITIONS.map((d) => [d.type, d]));

export function transitionDefinition(type: string): TransitionDefinition | undefined {
  return byType.get(type);
}

// ---------------------------------------------------------------------------
// Timing, shown above a transition's own parameters in the properties panel
// ---------------------------------------------------------------------------

export const MIN_TRANSITION_DURATION = 0.1;
export const MAX_TRANSITION_DURATION = 5;

export const DURATION_SPEC: NumberSpec = {
  kind: "number",
  key: "duration",
  label: "Duration",
  default: 0.5,
  min: MIN_TRANSITION_DURATION,
  max: MAX_TRANSITION_DURATION,
  unit: "s",
  step: 0.01,
  decimals: 2,
};

export const ALIGNMENT_SPEC: ChoiceSpec = {
  kind: "choice",
  key: "alignment",
  label: "Alignment",
  default: "center",
  options: [
    { value: "center", label: "Center" },
    { value: "start", label: "Start" },
    { value: "end", label: "End" },
  ],
};

const ALIGNMENTS: readonly TransitionAlignment[] = ["center", "start", "end"];

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export function defaultTransitionParams(def: TransitionDefinition): ParamValues {
  return defaultParams(def.params);
}

/** A new transition of a known type with its default values. */
export function createTransition(type: string, duration?: number): Transition {
  const def = byType.get(type);
  if (!def) throw new Error(`Unknown transition "${type}"`);
  return {
    type,
    duration: clampDuration(duration ?? def.duration),
    alignment: "center",
    params: defaultTransitionParams(def),
  };
}

export const clampDuration = (d: number) =>
  roundTime(Math.min(MAX_TRANSITION_DURATION, Math.max(MIN_TRANSITION_DURATION, d)));

/** A valid transition from untrusted storage, or undefined for unknown types and junk. */
export function sanitizeTransition(raw: unknown): Transition | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Partial<Transition>;
  const def = typeof t.type === "string" ? byType.get(t.type) : undefined;
  if (!def) return undefined;
  const duration = typeof t.duration === "number" && Number.isFinite(t.duration) ? t.duration : def.duration;
  const params = sanitizeParams(def.params, t.params);
  return {
    type: def.type,
    duration: clampDuration(duration),
    alignment: ALIGNMENTS.includes(t.alignment as TransitionAlignment) ? t.alignment! : "center",
    params,
  };
}

/**
 * The same transition switched to another type (dropping one transition on
 * another replaces it): the length and alignment stay, parameters the new
 * type shares keep their values when still valid.
 */
export function replaceTransitionType(t: Transition, type: string): Transition {
  const def = byType.get(type);
  if (!def) return t;
  return { ...t, type, params: sanitizeParams(def.params, t.params) };
}

/** Change timing or parameters (clamped); keys that aren't the definition's are ignored. */
export function patchTransition(t: Transition, patch: ParamValues): Transition {
  const def = byType.get(t.type);
  if (!def) return t;
  let next = t;
  for (const [key, raw] of Object.entries(patch)) {
    if (key === DURATION_SPEC.key) {
      const d = sanitizeValue(DURATION_SPEC, raw);
      if (d !== undefined && d !== next.duration) next = { ...next, duration: clampDuration(d as number) };
    } else if (key === ALIGNMENT_SPEC.key) {
      if (ALIGNMENTS.includes(raw as TransitionAlignment) && raw !== next.alignment) {
        next = { ...next, alignment: raw as TransitionAlignment };
      }
    } else {
      const spec = def.params.find((p) => p.key === key);
      const value = spec && sanitizeValue(spec, raw);
      if (value !== undefined && !sameValue(next.params[key], value)) {
        next = { ...next, params: { ...next.params, [key]: value } };
      }
    }
  }
  return next;
}
