/**
 * Clip properties, organised like Premiere's Effect Controls: a clip carries a
 * list of effects (Motion, Opacity, Volume...), each a set of typed
 * parameters. An effect's definition drives everything generically: default
 * values, validation of stored projects, the properties panel, and evaluation
 * at a point in time (a static value, or keyframes).
 *
 * To add a property, add a spec to a definition (or a definition to
 * `EFFECTS`) and read it where clips are drawn: the preview engine and the
 * export (`server/render.ts`). The specs themselves are in `params.ts`
 * (shared with transitions), keyframe maths in `keyframes.ts`.
 *
 * A text clip is a clip with no media (`assetId` is "") that carries the Text
 * and Appearance effects; the browser draws it (`src/lib/text-render.ts`).
 * A solid (After Effects' solid layer) has no media either: it carries the
 * Solid effect, a colour filling the canvas, which generator effects (noise,
 * gradients, light) draw over. An adjustment layer (`Clip.adjustment`) draws
 * nothing itself: its effects, Motion and Opacity apply to what's below it.
 *
 * Video effects (blur, colour, glitch...) are the ones the user adds from the
 * Effects tab, any number of times and in any order. Each is a shader
 * (`effect-gl.ts`) run over the clip's own picture before Motion places it,
 * like Premiere's standard effects; their definitions are in `effect-library/`.
 */
import { COLOR_EFFECTS } from "./effect-library/color.ts";
import { BLUR_EFFECTS } from "./effect-library/blur.ts";
import { STYLIZE_EFFECTS } from "./effect-library/stylize.ts";
import { MOTION_EFFECTS } from "./effect-library/motion.ts";
import { GLITCH_EFFECTS } from "./effect-library/glitch.ts";
import { DISTORT_EFFECTS } from "./effect-library/distort.ts";
import { LIGHT_EFFECTS } from "./effect-library/light.ts";
import { GENERATE_EFFECTS } from "./effect-library/generate.ts";
import { KEYING_EFFECTS } from "./effect-library/keying.ts";
import { BLEND_MODES } from "./compositor.ts";
import { keyframeValue, sanitizeKeyframes, setKeyframe } from "./keyframes.ts";
import { tidy } from "./math.ts";
import { PERCENT, PIXELS, type ParamSpec, defaultParams, sameValue, sanitizeParams, sanitizeValue } from "./params.ts";
import type { Clip, Effect, FitMode, Keyframe, ParamValue, ParamValues, Project, Vec2 } from "./types.ts";

/**
 * What a clip shows: media (video, image or sound), text, a solid colour, or
 * nothing of its own (an adjustment layer, which changes what's below it).
 */
export type ClipKind = "media" | "text" | "solid" | "adjustment";

/** What a clip is, which decides the effects it shows. */
export interface ClipTraits {
  /** Drawn on the canvas (on a video track). */
  visual: boolean;
  /** Has sound. */
  audible: boolean;
  kind: ClipKind;
}

export interface EffectDefinition {
  type: string;
  label: string;
  /** Every clip carries exactly one (listed only where it applies); it can't be removed. */
  builtIn: boolean;
  appliesTo: (clip: ClipTraits) => boolean;
  /** Can't be turned off (no bypass switch), e.g. the text itself. */
  alwaysOn?: boolean;
  params: ParamSpec[];
  /** Keeps linked parameters consistent: rewrites a patch about to be applied to `current` (static) values. */
  adjust?: (current: ParamValues, patch: ParamValues) => ParamValues;
  /** A video effect (added by the user, see the top of this file): how it's drawn. */
  shader?: EffectShader;
}

/** Categories of video effects, in the order the Effects tab's filter shows them. */
export const EFFECT_TAGS = ["color", "blur", "light", "stylize", "distort", "camera", "glitch", "generate", "keying"] as const;

export type EffectTag = (typeof EFFECT_TAGS)[number];

export const EFFECT_TAG_LABELS: Record<EffectTag, string> = {
  color: "Color",
  blur: "Blur",
  light: "Light",
  stylize: "Stylize",
  distort: "Distort",
  camera: "Camera",
  glitch: "Glitch",
  generate: "Generate",
  keying: "Keying",
};

export interface EffectShader {
  /**
   * GLSL ES 3.00 defining `vec4 effect(vec2 uv)`: the clip's colour at `uv`
   * ((0, 0) = bottom left of its frame). Its parameters are uniforms named by
   * their key (numbers, switches, choices, points and colours only). See the
   * prelude in `effect-gl.ts` for what's available.
   */
  glsl: string;
  /** Times the shader runs in a row, each over the last one's result (`pass` counts from 0); 1 by default. */
  passes?: number;
  /** Changes over time by itself (reads `time`): its card plays rather than compares before and after. */
  animated?: boolean;
  /** What kind of effect it is; the first tag is its category. */
  tags: EffectTag[];
  /** Values its card shows, where the defaults are too subtle to read at that size. */
  demo?: ParamValues;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const MOTION: EffectDefinition = {
  type: "motion",
  label: "Motion",
  builtIn: true,
  appliesTo: (c) => c.visual,
  params: [
    {
      kind: "choice",
      key: "fit",
      label: "Framing",
      // Only media has a frame of its own to fit (text is laid out at its own size, the rest fills the canvas).
      appliesTo: (c) => c.kind === "media",
      default: "contain",
      options: [
        { value: "contain", label: "Fit" },
        { value: "cover", label: "Fill" },
      ],
    },
    // Where the anchor point sits on the canvas.
    { kind: "vec2", key: "position", label: "Position", default: [0.5, 0.5], space: "canvas", min: -10, max: 10, step: 1, decimals: 1 },
    // Relative to the framed size: 100% = fitted to (or filling) the canvas.
    {
      kind: "number",
      key: "scale",
      label: "Scale",
      labelFor: (v) => (v.uniformScale === false ? "Scale Height" : "Scale"),
      default: 1,
      min: 0,
      max: 100,
      ...PERCENT,
    },
    {
      kind: "number",
      key: "scaleWidth",
      label: "Scale Width",
      disabledFor: (v) => v.uniformScale !== false,
      default: 1,
      min: 0,
      max: 100,
      ...PERCENT,
    },
    { kind: "boolean", key: "uniformScale", label: "Uniform Scale", default: true },
    { kind: "number", key: "rotation", label: "Rotation", default: 0, min: -36_000, max: 36_000, unit: "°", step: 1, decimals: 1 },
    // The point of the clip's frame that scaling and rotation happen around.
    { kind: "vec2", key: "anchor", label: "Anchor Point", default: [0.5, 0.5], space: "media", min: -10, max: 10, step: 1, decimals: 1 },
    // What shows past the frame's edges (After Effects' Motion Tile): nothing, or the picture
    // continued, so zooming out of or spinning a clip never shows the black behind it.
    {
      kind: "choice",
      key: "edges",
      label: "Edges",
      appliesTo: (c) => c.kind !== "text",
      default: "none",
      options: [
        { value: "none", label: "None" },
        { value: "mirror", label: "Mirror" },
        { value: "tile", label: "Tile" },
        { value: "extend", label: "Extend" },
      ],
    },
    // After Effects' layer motion blur: the frame is an average over the shutter's opening.
    { kind: "boolean", key: "motionBlur", label: "Motion Blur", default: false },
    {
      kind: "number",
      key: "shutterAngle",
      label: "Shutter Angle",
      disabledFor: (v) => v.motionBlur !== true,
      default: 180,
      min: 0,
      max: 720,
      unit: "°",
      step: 5,
      decimals: 0,
    },
  ],
  // While scale is uniform the width follows it, so turning uniform scale off starts from the same size.
  adjust: (current, patch) => {
    if (patch.uniformScale === false && current.uniformScale !== false) return { ...patch, scaleWidth: current.scale };
    const uniform = (patch.uniformScale ?? current.uniformScale) !== false;
    if (!uniform || (patch.scale === undefined && patch.uniformScale === undefined)) return patch;
    return { ...patch, scaleWidth: patch.scale ?? current.scale };
  },
};

export const OPACITY: EffectDefinition = {
  type: "opacity",
  label: "Opacity",
  builtIn: true,
  appliesTo: (c) => c.visual,
  params: [
    { kind: "number", key: "opacity", label: "Opacity", default: 1, min: 0, max: 1, slider: true, ...PERCENT },
    // How the clip mixes with what's below it (Premiere's and After Effects' blend modes).
    { kind: "choice", key: "blendMode", label: "Blend Mode", default: "normal", options: BLEND_MODES.map(({ value, label }) => ({ value, label })) },
  ],
};

export const VOLUME: EffectDefinition = {
  type: "volume",
  label: "Volume",
  builtIn: true,
  appliesTo: (c) => c.audible,
  params: [
    // Linear gain.
    { kind: "number", key: "level", label: "Level", default: 1, min: 0, max: 1, slider: true, ...PERCENT, decimals: 0 },
  ],
};

/** What a text clip says and how it's set. Text clips carry it; nothing else can. */
export const TEXT: EffectDefinition = {
  type: "text",
  label: "Text",
  builtIn: false,
  alwaysOn: true,
  appliesTo: (c) => c.kind === "text",
  params: [
    { kind: "text", key: "text", label: "Text", default: "Text" },
    { kind: "font", key: "font", label: "Font", default: "Helvetica Neue" },
    { kind: "fontStyle", key: "fontStyle", label: "Style", default: "Bold", familyKey: "font" },
    { kind: "number", key: "size", label: "Size", default: 120, min: 1, max: 2000, ...PIXELS },
    // Drawn in capitals (or small letters) whatever was typed, so it can be switched back.
    {
      kind: "choice",
      key: "textCase",
      label: "Case",
      default: "none",
      options: [
        { value: "none", label: "Aa" },
        { value: "upper", label: "AA" },
        { value: "lower", label: "aa" },
      ],
    },
    {
      kind: "choice",
      key: "align",
      label: "Align",
      default: "center",
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
        { value: "right", label: "Right" },
      ],
    },
    // Thousandths of an em, like Premiere and Photoshop.
    { kind: "number", key: "tracking", label: "Tracking", default: 0, min: -500, max: 2000, step: 5, decimals: 0 },
    // Line height as a multiple of the font size.
    { kind: "number", key: "leading", label: "Line Spacing", default: 1.2, min: 0.5, max: 5, ...PERCENT, decimals: 0 },
  ],
};

const off = (key: string) => (v: ParamValues) => !((v[key] as number) > 0);

/** A solid's fill: a colour covering the canvas (at 100%), which generator effects draw over. */
export const SOLID: EffectDefinition = {
  type: "solid",
  label: "Solid",
  builtIn: false,
  alwaysOn: true,
  appliesTo: (c) => c.kind === "solid",
  params: [
    { kind: "color", key: "color", label: "Color", default: "#000000" },
    // 0% is Premiere's Transparent Video: a clear layer for effects to draw on.
    { kind: "number", key: "fill", label: "Fill", default: 1, min: 0, max: 1, slider: true, ...PERCENT, decimals: 0 },
  ],
};

/** How a text clip's letters are painted: fill, stroke, a box behind them and a drop shadow. */
export const APPEARANCE: EffectDefinition = {
  type: "appearance",
  label: "Appearance",
  builtIn: false,
  appliesTo: (c) => c.kind === "text",
  params: [
    { kind: "color", key: "fill", label: "Fill", default: "#ffffff" },
    { kind: "number", key: "strokeWidth", label: "Stroke", default: 0, min: 0, max: 200, ...PIXELS, step: 0.5, decimals: 1 },
    { kind: "color", key: "strokeColor", label: "Stroke Color", default: "#000000", disabledFor: off("strokeWidth") },
    { kind: "number", key: "background", label: "Background", default: 0, min: 0, max: 1, slider: true, ...PERCENT, decimals: 0 },
    { kind: "color", key: "backgroundColor", label: "Background Color", default: "#000000", disabledFor: off("background") },
    { kind: "number", key: "shadow", label: "Shadow", default: 0, min: 0, max: 1, slider: true, ...PERCENT, decimals: 0 },
    { kind: "color", key: "shadowColor", label: "Shadow Color", default: "#000000", disabledFor: off("shadow") },
    { kind: "number", key: "shadowDistance", label: "Shadow Distance", default: 8, min: 0, max: 500, ...PIXELS, disabledFor: off("shadow") },
    { kind: "number", key: "shadowBlur", label: "Shadow Blur", default: 12, min: 0, max: 500, ...PIXELS, disabledFor: off("shadow") },
  ],
};

/** The video effects, in the order the Effects tab shows them. */
export const VIDEO_EFFECTS: readonly EffectDefinition[] = [
  ...COLOR_EFFECTS,
  ...BLUR_EFFECTS,
  ...LIGHT_EFFECTS,
  ...STYLIZE_EFFECTS,
  ...DISTORT_EFFECTS,
  ...MOTION_EFFECTS,
  ...GLITCH_EFFECTS,
  ...GENERATE_EFFECTS,
  ...KEYING_EFFECTS,
];

/** Every effect definition; built-in ones in the order they're listed (and applied). */
export const EFFECTS: readonly EffectDefinition[] = [MOTION, OPACITY, VOLUME, TEXT, APPEARANCE, SOLID, ...VIDEO_EFFECTS];

const byType = new Map(EFFECTS.map((d) => [d.type, d]));

export function effectDefinition(type: string): EffectDefinition | undefined {
  return byType.get(type);
}

export function paramSpec(def: EffectDefinition, key: string): ParamSpec | undefined {
  return def.params.find((p) => p.key === key);
}


// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function sanitizeEffect(def: EffectDefinition, raw: Partial<Effect> | undefined, id: string): Effect {
  const params = sanitizeParams(def.params, raw?.params);
  const keyframes: Record<string, Keyframe[]> = {};
  for (const spec of def.params) {
    const keys = sanitizeKeyframes(spec, raw?.keyframes?.[spec.key]);
    if (keys.length) keyframes[spec.key] = keys;
  }
  const effect: Effect = { id, type: def.type, enabled: def.alwaysOn || raw?.enabled !== false, params };
  if (Object.keys(keyframes).length) effect.keyframes = keyframes;
  return effect;
}

/** The built-in effects with default values (a new clip's). */
export function defaultEffects(): Effect[] {
  return EFFECTS.filter((d) => d.builtIn).map((d) => sanitizeEffect(d, undefined, d.type));
}

/** A new solid's effects: the built-in ones, then Solid (with `params` over the defaults). */
export function solidEffects(params: ParamValues = {}): Effect[] {
  return [...defaultEffects(), sanitizeEffect(SOLID, { params }, SOLID.type)];
}

/** A new text clip's effects: the built-in ones, then Text (with `params` over the defaults) and Appearance. */
export function textEffects(params: ParamValues = {}): Effect[] {
  return [
    ...defaultEffects(),
    sanitizeEffect(TEXT, { params }, TEXT.type),
    sanitizeEffect(APPEARANCE, undefined, APPEARANCE.type),
  ];
}

/**
 * Repair a clip's effects from untrusted storage: every built-in effect exactly
 * once and first, in `EFFECTS` order, then any other known effects in their
 * stored order. Unknown types are dropped (nothing could draw them) and values
 * are validated. `legacy` is a clip saved before effects existed, whose volume
 * and framing lived on the clip itself.
 */
export function normalizeEffects(raw: unknown, legacy?: { volume?: unknown; fit?: unknown }): Effect[] {
  const stored = (Array.isArray(raw) ? raw : []).filter(
    (e): e is Partial<Effect> & { type: string } =>
      !!e && typeof e === "object" && typeof e.type === "string" && byType.has(e.type),
  );
  const builtIns = EFFECTS.filter((d) => d.builtIn).map((def) => {
    const found = stored.find((e) => e.type === def.type);
    if (found || !legacy) return sanitizeEffect(def, found, def.type);
    const fromLegacy: Partial<Effect> = {
      params: def === VOLUME ? { level: legacy.volume as ParamValue } : def === MOTION ? { fit: legacy.fit as ParamValue } : {},
    };
    return sanitizeEffect(def, fromLegacy, def.type);
  });
  const ids = new Set(builtIns.map((e) => e.id));
  const extras: Effect[] = [];
  // Text clips carry Text and Appearance once each (Appearance added when missing); a clip is text or a solid.
  const isText = stored.some((e) => e.type === TEXT.type);
  if (isText && !stored.some((e) => e.type === APPEARANCE.type)) stored.push({ type: APPEARANCE.type });
  const once = new Set<string>();
  for (const e of stored) {
    const def = byType.get(e.type)!;
    if (def.builtIn) continue;
    if (def === SOLID && isText) continue;
    // Like built-ins, these are addressed by their type (`setParams(p, clipId, TEXT.type, ...)`).
    if (def === TEXT || def === APPEARANCE || def === SOLID) {
      if (once.has(def.type)) continue;
      once.add(def.type);
      ids.add(def.type);
      extras.push(sanitizeEffect(def, e, def.type));
      continue;
    }
    let id = typeof e.id === "string" && e.id ? e.id : def.type;
    for (let n = 2; ids.has(id); n++) id = `${def.type}_${n}`;
    ids.add(id);
    extras.push(sanitizeEffect(def, e, id));
  }
  return [...builtIns, ...extras];
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** An effect's own values at source time `time` (keyframed or static), whether it's on or not. */
export function storedValuesAt(def: EffectDefinition, effect: Effect, time: number): ParamValues {
  const values: ParamValues = {};
  for (const spec of def.params) {
    const keys = effect.keyframes?.[spec.key];
    values[spec.key] = keys?.length ? keyframeValue(keys, time) : (effect.params[spec.key] ?? spec.default);
  }
  return values;
}

/**
 * The values an effect applies at source time `time`: its keyframed or static
 * values, or the defaults when it's off (or missing).
 */
export function valuesAt(def: EffectDefinition, effect: Effect | undefined, time: number): ParamValues {
  return effect?.enabled ? storedValuesAt(def, effect, time) : defaultParams(def.params);
}

/** The first effect of a type on a clip (built-in effects exist once). */
export function findEffect(clip: Clip, type: string): Effect | undefined {
  return clip.effects.find((e) => e.type === type);
}

/** How a visual clip is placed on the canvas. */
export interface Motion {
  fit: FitMode;
  /** Canvas position of the anchor point, as fractions of the canvas. */
  position: Vec2;
  scaleX: number;
  scaleY: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** As fractions of the clip's frame. */
  anchor: Vec2;
}

/** A clip's motion at source time `time`. */
export function motionAt(clip: Clip, time: number): Motion {
  const v = valuesAt(MOTION, findEffect(clip, MOTION.type), time);
  const scale = v.scale as number;
  return {
    fit: v.fit as FitMode,
    position: v.position as Vec2,
    scaleX: v.uniformScale === false ? (v.scaleWidth as number) : scale,
    scaleY: scale,
    rotation: v.rotation as number,
    anchor: v.anchor as Vec2,
  };
}

/** A clip's opacity (0..1) at source time `time`. */
export function opacityAt(clip: Clip, time: number): number {
  return valuesAt(OPACITY, findEffect(clip, OPACITY.type), time).opacity as number;
}

/** Whether a clip is text (drawn from its Text effect) rather than media. */
export function isTextClip(clip: Pick<Clip, "effects">): boolean {
  return clip.effects.some((e) => e.type === TEXT.type);
}

/** Whether a clip is a solid (drawn from its Solid effect). */
export function isSolidClip(clip: Pick<Clip, "effects">): boolean {
  return clip.effects.some((e) => e.type === SOLID.type);
}

/** What a clip shows (see `ClipKind`). */
export function clipKind(clip: Pick<Clip, "effects" | "adjustment">): ClipKind {
  if (isTextClip(clip)) return "text";
  if (isSolidClip(clip)) return "solid";
  return clip.adjustment ? "adjustment" : "media";
}

/** Whether a clip plays a media file (rather than text, a solid or an adjustment layer, which have none). */
export const hasMedia = (clip: Pick<Clip, "effects" | "adjustment">) => clipKind(clip) === "media";

/** How a clip is mixed into the frame at source time `time`: See `Placed` in `compositor.ts`. */
export interface Look {
  opacity: number;
  /** A `BLEND_MODES` value. */
  blendMode: string;
  edges: EdgeMode;
  /** Shutter angle in degrees when motion blur is on, else 0. */
  shutter: number;
}

export type EdgeMode = "none" | "mirror" | "tile" | "extend";

/** A clip's opacity, blend mode, edges and motion blur at source time `time`. */
export function lookAt(clip: Clip, time: number): Look {
  const o = valuesAt(OPACITY, findEffect(clip, OPACITY.type), time);
  const m = valuesAt(MOTION, findEffect(clip, MOTION.type), time);
  return {
    opacity: o.opacity as number,
    blendMode: o.blendMode as string,
    edges: m.edges as EdgeMode,
    shutter: m.motionBlur === true ? (m.shutterAngle as number) : 0,
  };
}

/** A solid's colour as premultiplied RGBA (0..1) at source time `time`. */
export function solidColorAt(clip: Clip, time: number): [number, number, number, number] {
  const v = valuesAt(SOLID, findEffect(clip, SOLID.type), time);
  const n = Number.parseInt((v.color as string).slice(1), 16);
  const a = v.fill as number;
  return [(((n >> 16) & 255) / 255) * a, (((n >> 8) & 255) / 255) * a, ((n & 255) / 255) * a, a];
}

/** Everything that decides how a text clip looks, at one point in time. */
export interface TextStyle {
  text: string;
  font: string;
  fontStyle: string;
  /** Font size in reference px (the canvas at 1080p). */
  size: number;
  textCase: TextCase;
  align: "left" | "center" | "right";
  /** Thousandths of an em. */
  tracking: number;
  /** Line height as a multiple of the size. */
  leading: number;
  fill: string;
  /** Reference px; 0 = none. */
  strokeWidth: number;
  strokeColor: string;
  /** Opacity of the box behind the text; 0 = none. */
  background: number;
  backgroundColor: string;
  /** Opacity of the drop shadow; 0 = none. */
  shadow: number;
  shadowColor: string;
  shadowDistance: number;
  shadowBlur: number;
}

/** How a text's letters are cased when drawn. */
export type TextCase = "none" | "upper" | "lower";

/** The text as drawn in a case. */
export function applyTextCase(text: string, textCase: TextCase): string {
  return textCase === "upper" ? text.toLocaleUpperCase() : textCase === "lower" ? text.toLocaleLowerCase() : text;
}

/** A text clip's text and look at source time `time`. */
export function textStyleAt(clip: Clip, time: number): TextStyle {
  const text = valuesAt(TEXT, findEffect(clip, TEXT.type), time);
  const look = valuesAt(APPEARANCE, findEffect(clip, APPEARANCE.type), time);
  return { ...text, ...look } as unknown as TextStyle;
}

/** A clip's linear gain (0..1) at source time `time`. */
export function volumeAt(clip: Clip, time: number): number {
  return valuesAt(VOLUME, findEffect(clip, VOLUME.type), time).level as number;
}

/** Whether any parameter of the clip is animated. */
export function hasKeyframes(clip: Clip): boolean {
  return clip.effects.some((e) => e.keyframes && Object.keys(e.keyframes).length > 0);
}

// ---------------------------------------------------------------------------
// Edits (all return a new Project, or the same one when nothing changed)
// ---------------------------------------------------------------------------

/** Rewrite one effect on a clip (or several), with its definition; same project when `update` returns the same effect. */
export function updateEffect(
  project: Project,
  clipIds: ClipIds,
  effectId: string,
  update: (effect: Effect, def: EffectDefinition) => Effect,
): Project {
  const wanted = typeof clipIds === "string" ? (id: string) => id === clipIds : (id: string) => clipIds.has(id);
  let changed = false;
  const clips = project.clips.map((clip) => {
    if (!wanted(clip.id)) return clip;
    let clipChanged = false;
    const effects = clip.effects.map((e) => {
      const def = e.id === effectId ? byType.get(e.type) : undefined;
      if (!def) return e;
      const next = update(e, def);
      if (next !== e) clipChanged = true;
      return next;
    });
    if (!clipChanged) return clip;
    changed = true;
    return { ...clip, effects };
  });
  return changed ? { ...project, clips } : project;
}

/** One clip, or several (one pass over the clips, however many there are). */
export type ClipIds = string | ReadonlySet<string>;

/**
 * Set parameters of one of a clip's effects (invalid values are clamped or
 * ignored). A parameter that has keyframes gets a keyframe at source time
 * `time` instead, when given, like changing an animated value in Premiere.
 */
export function setParams(
  project: Project,
  clipId: ClipIds,
  effectId: string,
  patch: ParamValues,
  time?: number,
): Project {
  return updateEffect(project, clipId, effectId, (effect, def) => {
    let params = effect.params;
    let keyframes = effect.keyframes;
    // Linked values follow what's showing (keyframed values at `time`).
    const current = time === undefined ? effect.params : storedValuesAt(def, effect, time);
    for (const [key, raw] of Object.entries(def.adjust?.(current, patch) ?? patch)) {
      const spec = paramSpec(def, key);
      const value = spec && sanitizeValue(spec, raw);
      if (value === undefined) continue;
      const keys = keyframes?.[key];
      if (keys?.length && time !== undefined) {
        const next = setKeyframe(keys, time, value);
        if (next !== keys) keyframes = { ...keyframes, [key]: next };
      } else if (!sameValue(params[key], value)) {
        params = { ...params, [key]: value };
      }
    }
    return params === effect.params && keyframes === effect.keyframes ? effect : { ...effect, params, keyframes };
  });
}

/** Turn an effect on or off (off = bypassed). */
export function setEffectEnabled(project: Project, clipId: string, effectId: string, enabled: boolean): Project {
  return updateEffect(project, clipId, effectId, (e, def) => (e.enabled === enabled || def.alwaysOn ? e : { ...e, enabled }));
}

/**
 * Put parameters (all of them by default) back to their defaults. An
 * animated one gets a keyframe of its default at source time `time` instead,
 * when given (like Premiere's reset); otherwise its keyframes are dropped.
 */
export function resetParams(project: Project, clipId: ClipIds, effectId: string, keys?: string[], time?: number): Project {
  return updateEffect(project, clipId, effectId, (effect, def) => {
    const reset = def.params.filter((p) => !keys || keys.includes(p.key));
    let params = effect.params;
    let keyframes = effect.keyframes;
    for (const p of reset) {
      const animated = keyframes?.[p.key];
      if (animated?.length && time !== undefined) {
        const next = setKeyframe(animated, time, p.default);
        if (next !== animated) keyframes = { ...keyframes, [p.key]: next };
        continue;
      }
      if (animated) {
        const { [p.key]: _, ...rest } = keyframes!;
        keyframes = Object.keys(rest).length ? rest : undefined;
      }
      if (!sameValue(params[p.key], p.default)) params = { ...params, [p.key]: p.default };
    }
    if (params === effect.params && keyframes === effect.keyframes) return effect;
    const next: Effect = { ...effect, params };
    if (keyframes) next.keyframes = keyframes;
    else delete next.keyframes;
    return next;
  });
}

// ---------------------------------------------------------------------------
// Video effects: adding, removing and reordering them
// ---------------------------------------------------------------------------

/** Whether an effect is one the user added (a video effect), which can be removed and moved. */
export function isVideoEffect(effect: Pick<Effect, "type">): boolean {
  return !!byType.get(effect.type)?.shader;
}

/** A clip's video effects, in the order they're drawn. */
export function videoEffects(clip: Clip): Effect[] {
  return clip.effects.filter(isVideoEffect);
}

/**
 * Add a video effect (with its default values) to the end of each clip's
 * effects, so it's drawn over what's there; clips that aren't on a video
 * track are skipped. Returns the new effects' ids by clip.
 */
export function addEffect(project: Project, clipIds: string[], type: string): { project: Project; added: Map<string, string> } {
  const def = byType.get(type);
  const added = new Map<string, string>();
  if (!def?.shader) return { project, added };
  const videoTracks = new Set(project.tracks.filter((t) => t.kind === "video").map((t) => t.id));
  const clips = project.clips.map((clip) => {
    if (!clipIds.includes(clip.id) || !videoTracks.has(clip.trackId)) return clip;
    const ids = new Set(clip.effects.map((e) => e.id));
    let id = def.type;
    for (let n = 2; ids.has(id); n++) id = `${def.type}_${n}`;
    added.set(clip.id, id);
    return { ...clip, effects: [...clip.effects, sanitizeEffect(def, undefined, id)] };
  });
  return added.size ? { project: { ...project, clips }, added } : { project, added };
}

/** Remove one of a clip's video effects (built-in ones and text can't be). */
export function removeEffect(project: Project, clipId: string, effectId: string): Project {
  const clip = project.clips.find((c) => c.id === clipId);
  const effect = clip?.effects.find((e) => e.id === effectId);
  if (!clip || !effect || !isVideoEffect(effect)) return project;
  const next = { ...clip, effects: clip.effects.filter((e) => e !== effect) };
  return { ...project, clips: project.clips.map((c) => (c === clip ? next : c)) };
}

/** Swap a video effect with the one drawn before (-1) or after (+1) it. */
export function moveEffect(project: Project, clipId: string, effectId: string, by: -1 | 1): Project {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return project;
  const order = clip.effects.flatMap((e, i) => (isVideoEffect(e) ? [i] : []));
  const at = order.findIndex((i) => clip.effects[i].id === effectId);
  const other = order[at + by];
  if (at < 0 || other === undefined) return project;
  const effects = [...clip.effects];
  [effects[order[at]], effects[other]] = [effects[other], effects[order[at]]];
  return { ...project, clips: project.clips.map((c) => (c === clip ? { ...clip, effects } : c)) };
}

// ---------------------------------------------------------------------------
// Copy / paste effects (Premiere's Paste Attributes)
// ---------------------------------------------------------------------------

/** A clip's effects, copied to paste onto other clips. `in` places the keyframes (they're in source time). */
export interface CopiedEffects {
  effects: Effect[];
  in: number;
}

export function copyEffects(clip: Clip): CopiedEffects {
  return { effects: clip.effects, in: clip.in };
}

/**
 * Paste copied effects (just `types`, or all of them) onto clips. Each replaces the clip's effect
 * with the same id, so a clip only gets what it can have (no Text on a video); video effects it
 * doesn't have are added after its own, on clips on a video track (Premiere's Paste Attributes).
 * Keyframes land at the same distance from the clip's start. The words of a text stay: only its
 * look is pasted.
 */
export function pasteEffects(project: Project, clipIds: readonly string[], copied: CopiedEffects, types?: readonly string[]): Project {
  const pasted = copied.effects.filter((e) => !types || types.includes(e.type));
  const videoTracks = new Set(project.tracks.filter((t) => t.kind === "video").map((t) => t.id));
  let p = project;
  for (const clipId of clipIds) {
    const clip = p.clips.find((c) => c.id === clipId);
    if (!clip) continue;
    const shift = clip.in - copied.in;
    const moved = (keys: Keyframe[]) => keys.map((k) => ({ ...k, time: tidy(k.time + shift) }));
    for (const source of pasted) {
      p = updateEffect(p, clipId, source.id, (effect, def) => {
        // Content (a text's words) isn't style.
        const kept = def.params.filter((spec) => spec.kind === "text").map((spec) => spec.key);
        const params = { ...source.params };
        for (const key of kept) params[key] = effect.params[key];
        const keyframes: Record<string, Keyframe[]> = {};
        for (const [key, keys] of Object.entries(source.keyframes ?? {})) {
          if (!kept.includes(key)) keyframes[key] = moved(keys);
        }
        for (const key of kept) if (effect.keyframes?.[key]) keyframes[key] = effect.keyframes[key];
        const next: Effect = { ...effect, enabled: source.enabled || !!def.alwaysOn, params };
        if (Object.keys(keyframes).length) next.keyframes = keyframes;
        else delete next.keyframes;
        return JSON.stringify(next) === JSON.stringify(effect) ? effect : next;
      });
    }
    const missing = videoTracks.has(clip.trackId)
      ? pasted.filter((e) => isVideoEffect(e) && !clip.effects.some((own) => own.id === e.id))
      : [];
    if (missing.length === 0) continue;
    const added = missing.map((e): Effect => {
      const next: Effect = { ...e, params: { ...e.params } };
      if (e.keyframes) next.keyframes = Object.fromEntries(Object.entries(e.keyframes).map(([key, keys]) => [key, moved(keys)]));
      return next;
    });
    p = { ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, effects: [...c.effects, ...added] } : c)) };
  }
  return p;
}
