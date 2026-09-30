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
 * nothing itself: its effects, Motion and Opacity apply to what's below it. A
 * camera (the Camera effect) draws nothing either: 3D layers are seen through
 * it while it lasts (`camera.ts`).
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
import { SHAKE_EFFECTS } from "./effect-library/shake.ts";
import { TIME_EFFECTS } from "./effect-library/time.ts";
import { PARTICLE_EFFECTS } from "./effect-library/particles.ts";
import { MASK } from "./effect-library/mask.ts";
import { SHAPE, SHAPE_EFFECTS } from "./effect-library/shape.ts";
import { TEXT_ANIMATOR } from "./effect-library/text-animator.ts";
import { BLEND_MODES } from "./compositor.ts";
import { type ExprValue, expressionError, expressionValue, evaluateExpression, parseExpression } from "./expressions.ts";
import { keyframeValue, sanitizeKeyframes, setKeyframe } from "./keyframes.ts";
// (A cycle with this file, which is fine: neither uses the other until a function is called.)
import { type TextAnimation, animatorReach, textAnimationsAt } from "./text-animators.ts";
import { tidy } from "./math.ts";
import { PERCENT, PIXELS, type ParamSpec, defaultParams, sameValue, sanitizeParams, sanitizeValue } from "./params.ts";
import type { Clip, Effect, FitMode, Keyframe, ParamValue, ParamValues, Project, Vec2 } from "./types.ts";

/**
 * What a clip shows: media (video, image or sound), text, a solid colour, or
 * nothing of its own (an adjustment layer, which changes what's below it).
 */
export type ClipKind = "media" | "text" | "solid" | "shape" | "adjustment" | "camera" | "null";

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
  /**
   * Added by the user like a video effect (any number of them, removable, in an order that
   * matters) without being a shader: a mask, a shape layer's shapes and their operators, a
   * text's animators. Says which of those it is: each kind is listed (and applied) together.
   */
  stackable?: "shape" | "animator" | "mask";
}

/** Categories of video effects, in the order the Effects tab's filter shows them. */
export const EFFECT_TAGS = ["color", "blur", "light", "stylize", "distort", "camera", "time", "glitch", "generate", "keying"] as const;

export type EffectTag = (typeof EFFECT_TAGS)[number];

export const EFFECT_TAG_LABELS: Record<EffectTag, string> = {
  color: "Color",
  blur: "Blur",
  light: "Light",
  stylize: "Stylize",
  distort: "Distort",
  camera: "Camera",
  time: "Time",
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
  /**
   * A time effect (After Effects' Echo, Posterize Time...): it reads its input at earlier
   * moments (`getFrameAgo`, up to `reach` seconds back), and optionally its own output a frame
   * ago (`feedback`: `getFeedback`) and how the picture moved since the last frame (`flow`:
   * `getFlow`, optical flow). Earlier frames exist while a video plays and in the export,
   * which draws every frame in order; paused on a frame, the preview only has that frame.
   */
  history?: { reach: (values: ParamValues, fps: number) => number; feedback?: boolean; flow?: boolean };
  /**
   * A particle effect (see `particles.ts`): `glsl` (its `effect(uv)`) draws the layer under
   * the particles (as it is, faded, dissolving...), and `particles.glsl` defines
   * `Particle particle(int id)` for the vertex shader that places them. `count` is how many
   * to draw for these values (at most as many as can be alive at once), `blend` how they
   * mix in (0 over, 1 add, 2 screen).
   */
  particles?: { glsl: string; count: (values: ParamValues) => number; blend: (values: ParamValues) => number };
  /**
   * Room past the clip's frame this effect needs, as a fraction of its height on every side
   * (After Effects' Grow Bounds), so what it draws there isn't cut off: see `EffectPass.grow`.
   * Positions then go through `frameUv`.
   */
  grow?: (values: ParamValues) => number;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const MOTION: EffectDefinition = {
  type: "motion",
  label: "Motion",
  builtIn: true,
  appliesTo: (c) => c.visual && c.kind !== "camera",
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
    // After Effects' 3D layer switch: a card in space, with a depth and turns about X and Y, seen through the camera.
    { kind: "boolean", key: "threeD", label: "3D Layer", default: false },
    {
      kind: "number",
      key: "positionZ",
      label: "Position Z",
      default: 0,
      min: -100_000,
      max: 100_000,
      ...PIXELS,
      disabledFor: (v) => v.threeD !== true,
    },
    {
      kind: "number",
      key: "rotationX",
      label: "X Rotation",
      default: 0,
      min: -36_000,
      max: 36_000,
      unit: "°",
      step: 1,
      decimals: 1,
      disabledFor: (v) => v.threeD !== true,
    },
    {
      kind: "number",
      key: "rotationY",
      label: "Y Rotation",
      default: 0,
      min: -36_000,
      max: 36_000,
      unit: "°",
      step: 1,
      decimals: 1,
      disabledFor: (v) => v.threeD !== true,
    },
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
  appliesTo: (c) => c.visual && c.kind !== "camera",
  params: [
    { kind: "number", key: "opacity", label: "Opacity", default: 1, min: 0, max: 1, slider: true, ...PERCENT },
    // How the clip mixes with what's below it (Premiere's and After Effects' blend modes).
    { kind: "choice", key: "blendMode", label: "Blend Mode", default: "normal", options: BLEND_MODES.map(({ value, label }) => ({ value, label })) },
    // After Effects' TrkMat: shown only through the clip on the video track right above it, which isn't drawn itself.
    {
      kind: "choice",
      key: "trackMatte",
      label: "Track Matte",
      default: "none",
      options: [
        { value: "none", label: "None" },
        { value: "alpha", label: "Alpha Matte" },
        { value: "alpha-inverted", label: "Alpha Inverted" },
        { value: "luma", label: "Luma Matte" },
        { value: "luma-inverted", label: "Luma Inverted" },
      ],
    },
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

/**
 * A camera clip's lens and where it looks (After Effects' camera, as an orbit around a point
 * of interest): 3D layers are seen through the topmost camera under the playhead (`camera.ts`).
 */
export const CAMERA: EffectDefinition = {
  type: "camera",
  label: "Camera",
  builtIn: false,
  alwaysOn: true,
  appliesTo: (c) => c.kind === "camera",
  params: [
    // Vertical; 40° is the default camera, which shows depth 0 as it is in 2D.
    { kind: "number", key: "angleOfView", label: "Angle of View", default: 40, min: 1, max: 170, unit: "°", step: 0.5, decimals: 1 },
    { kind: "vec2", key: "pointOfInterest", label: "Point of Interest", default: [0.5, 0.5], space: "canvas", min: -10, max: 10, step: 1, decimals: 1 },
    { kind: "number", key: "interestZ", label: "Point of Interest Z", default: 0, min: -100_000, max: 100_000, ...PIXELS },
    // Dolly: 100% shows depth 0 at its size; less is closer.
    { kind: "number", key: "distance", label: "Distance", default: 1, min: 0.01, max: 20, ...PERCENT },
    { kind: "number", key: "orbitX", label: "Orbit X", default: 0, min: -36_000, max: 36_000, unit: "°", step: 1, decimals: 1 },
    { kind: "number", key: "orbitY", label: "Orbit Y", default: 0, min: -36_000, max: 36_000, unit: "°", step: 1, decimals: 1 },
    { kind: "number", key: "roll", label: "Roll", default: 0, min: -36_000, max: 36_000, unit: "°", step: 1, decimals: 1 },
    { kind: "boolean", key: "depthOfField", label: "Depth of Field", default: false },
    {
      kind: "number",
      key: "focusDistance",
      label: "Focus Distance",
      default: 1,
      min: 0.01,
      max: 20,
      ...PERCENT,
      disabledFor: (v) => v.depthOfField !== true,
    },
    {
      kind: "number",
      key: "aperture",
      label: "Blur Level",
      default: 0.02,
      min: 0,
      max: 0.2,
      slider: true,
      ...PERCENT,
      disabledFor: (v) => v.depthOfField !== true,
    },
  ],
};

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
/**
 * Time Remapping (After Effects'; Premiere's speed keyframes): with keyframes on `time`, the
 * clip shows the source time they say at each moment of its own clock, so its speed can
 * ramp, freeze or run backwards within the clip (see `shared/time-remap.ts`). The clip's
 * other keyframes, and its in and out points, are then in that clock (which runs at 1×),
 * not in its media's time. Only clips that play media, added when remapping is turned on.
 */
export const TIME_REMAP: EffectDefinition = {
  type: "time-remap",
  label: "Time Remapping",
  builtIn: false,
  alwaysOn: true,
  appliesTo: (c) => c.kind === "media",
  params: [
    {
      kind: "number",
      key: "time",
      label: "Source Time",
      default: 0,
      min: 0,
      max: 1_000_000,
      unit: "s",
      step: 0.03,
      decimals: 2,
      // The Speed Graph: source seconds per second, as a percentage (100% plays at normal speed).
      speed: { scale: 100, unit: "%" },
    },
  ],
};

export const VIDEO_EFFECTS: readonly EffectDefinition[] = [
  ...COLOR_EFFECTS,
  ...BLUR_EFFECTS,
  ...LIGHT_EFFECTS,
  ...STYLIZE_EFFECTS,
  ...DISTORT_EFFECTS,
  ...MOTION_EFFECTS,
  ...SHAKE_EFFECTS,
  ...TIME_EFFECTS,
  ...GLITCH_EFFECTS,
  ...GENERATE_EFFECTS,
  ...PARTICLE_EFFECTS,
  ...KEYING_EFFECTS,
];

/** Every effect definition; built-in ones in the order they're listed (and applied). */
export const EFFECTS: readonly EffectDefinition[] = [MOTION, OPACITY, VOLUME, TEXT, APPEARANCE, SOLID, CAMERA, TIME_REMAP, ...SHAPE_EFFECTS, TEXT_ANIMATOR, MASK, ...VIDEO_EFFECTS];

export { MASK, SHAPE, TEXT_ANIMATOR };

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
  const expressions: Record<string, string> = {};
  for (const spec of def.params) {
    const source = raw?.expressions?.[spec.key];
    if (typeof source === "string" && source.trim() && source.length <= MAX_EXPRESSION && canExpress(def, spec)) expressions[spec.key] = source;
  }
  if (Object.keys(expressions).length) effect.expressions = expressions;
  return effect;
}

/** The longest an expression can be (characters). */
export const MAX_EXPRESSION = 5000;

/**
 * Whether a parameter can have an expression: numbers and points, except a clip's volume (the
 * export mixes sound with ffmpeg, which can't run one) and Time Remapping's source time.
 */
export function canExpress(def: EffectDefinition, spec: ParamSpec): boolean {
  return (spec.kind === "number" || spec.kind === "vec2") && def !== VOLUME && def !== TIME_REMAP;
}

/** The built-in effects with default values (a new clip's). */
export function defaultEffects(): Effect[] {
  return EFFECTS.filter((d) => d.builtIn).map((d) => sanitizeEffect(d, undefined, d.type));
}

/** A new solid's effects: the built-in ones, then Solid (with `params` over the defaults). */
export function solidEffects(params: ParamValues = {}): Effect[] {
  return [...defaultEffects(), sanitizeEffect(SOLID, { params }, SOLID.type)];
}

/** A new shape layer's effects: the built-in ones, then one Shape (with `params` over the defaults). */
export function shapeEffects(params: ParamValues = {}): Effect[] {
  return [...defaultEffects(), sanitizeEffect(SHAPE, { params }, SHAPE.type)];
}

/** A new camera's effects: the built-in ones, then Camera (with `params` over the defaults). */
export function cameraEffects(params: ParamValues = {}): Effect[] {
  return [...defaultEffects(), sanitizeEffect(CAMERA, { params }, CAMERA.type)];
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
  // Text clips carry Text and Appearance once each (Appearance added when missing); a clip is text, a shape layer or a solid.
  const isText = stored.some((e) => e.type === TEXT.type);
  const isShape = !isText && stored.some((e) => e.type === SHAPE.type);
  if (isText && !stored.some((e) => e.type === APPEARANCE.type)) stored.push({ type: APPEARANCE.type });
  const once = new Set<string>();
  for (const e of stored) {
    const def = byType.get(e.type)!;
    if (def.builtIn) continue;
    if ((def === SOLID || def === CAMERA) && (isText || isShape)) continue;
    // A shape layer's contents only go on shape layers, and animators on text.
    if (def.stackable === "shape" && !isShape) continue;
    if (def.stackable === "animator" && !isText) continue;
    if (def === CAMERA && stored.some((x) => x.type === SOLID.type)) continue;
    // Like built-ins, these are addressed by their type (`setParams(p, clipId, TEXT.type, ...)`).
    if (def === TEXT || def === APPEARANCE || def === SOLID || def === CAMERA || def === TIME_REMAP) {
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
  return orderEffects([...builtIns, ...extras]);
}

/** Where an effect is listed among a clip's: the built-in ones, what the clip is, Time Remapping, then what the user added, kind by kind. */
function effectRank(effect: Pick<Effect, "type">): number {
  const def = byType.get(effect.type);
  if (!def) return 9;
  if (def.builtIn) return 0;
  if (def === TIME_REMAP) return 2;
  if (def.stackable === "shape" || def.stackable === "animator") return 3;
  if (def.stackable === "mask") return 4;
  return def.shader ? 5 : 1;
}

/**
 * A clip's effects in the order they're listed and applied (see `effectRank`): each kind
 * together, in the order they were added within it. The same array when already so.
 */
export function orderEffects(effects: Effect[]): Effect[] {
  const ranked = effects.map((e, i) => ({ e, i, rank: effectRank(e) }));
  if (ranked.every((r, i) => i === 0 || ranked[i - 1].rank <= r.rank)) return effects;
  return ranked.sort((a, b) => a.rank - b.rank || a.i - b.i).map((r) => r.e);
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

/** Frame rate expressions are told when nobody says (they only use it for stepped time and `random`). */
const EXPRESSION_FPS = 30;

/** A number for each property, so their wiggles and random numbers differ but are the same on every draw. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Properties being worked out for an expression's `prop()`, to stop two that read each other. */
const reading = new Set<string>();

/**
 * What one expression sees: its own property's value without it (at any time), its keyframe
 * times, and the other properties of its clip (`prop("motion.position")`, with their own
 * expressions applied). `time` is the clip's source time, the clock its keyframes are in: for
 * text, shapes and solids seconds since the clip's start; for media the time in the file.
 */
function expressionScope(def: EffectDefinition, effect: Effect, key: string, time: number, clip: Pick<Clip, "id" | "effects"> | undefined, fps: number) {
  const spec = paramSpec(def, key)!;
  const keys = effect.keyframes?.[key];
  const own = (t: number) => (keys?.length ? keyframeValue(keys, t) : (effect.params[key] ?? spec.default)) as number | number[];
  return {
    time,
    fps,
    value: own(time),
    valueAtTime: own,
    keyTimes: keys?.map((k) => k.time) ?? [],
    seed: seedOf(`${clip?.id ?? ""}/${effect.id}/${key}`),
    prop(path: string, t = time): ExprValue | undefined {
      const dot = path.indexOf(".");
      const other = clip?.effects.find((e) => e.id === path.slice(0, dot)) ?? clip?.effects.find((e) => e.type === path.slice(0, dot));
      const otherDef = other && byType.get(other.type);
      const otherSpec = otherDef && paramSpec(otherDef, path.slice(dot + 1));
      if (!other || !otherDef || !otherSpec || dot < 0) return undefined;
      const id = `${clip!.id}/${other.id}/${otherSpec.key}`;
      // A property that (in the end) reads itself gets its plain value.
      const v = reading.has(id) ? storedValuesAt(otherDef, other, t)[otherSpec.key] : effectValuesAt(otherDef, other, t, clip, fps)[otherSpec.key];
      return typeof v === "object" && !Array.isArray(v) ? undefined : (v as ExprValue);
    },
  };
}

/**
 * The values an effect draws with at source time `time`: its stored values (`storedValuesAt`)
 * with its expressions run over them. `clip` is the clip it's on, for expressions that read
 * its other properties. An expression that fails leaves its property as it is without it.
 */
export function effectValuesAt(def: EffectDefinition, effect: Effect, time: number, clip?: Pick<Clip, "id" | "effects">, fps = EXPRESSION_FPS): ParamValues {
  const values = storedValuesAt(def, effect, time);
  if (!effect.expressions) return values;
  for (const [key, source] of Object.entries(effect.expressions)) {
    const spec = paramSpec(def, key);
    if (!spec || !canExpress(def, spec)) continue;
    const id = `${clip?.id ?? ""}/${effect.id}/${key}`;
    if (reading.has(id)) continue;
    reading.add(id);
    try {
      const result = expressionValue(source, expressionScope(def, effect, key, time, clip, fps), values[key] as number | number[]);
      const clean = result === undefined ? undefined : sanitizeValue(spec, result);
      if (clean !== undefined) values[key] = clean;
    } finally {
      reading.delete(id);
    }
  }
  return values;
}

/**
 * What's wrong with one of an effect's expressions at source time `time` (it doesn't parse, it
 * names something that isn't there, its result isn't a number or a point...), or null when it
 * runs: for showing under the expression while it's written.
 */
export function expressionProblem(def: EffectDefinition, effect: Effect, key: string, time: number, clip?: Pick<Clip, "id" | "effects">): string | null {
  const source = effect.expressions?.[key];
  const spec = paramSpec(def, key);
  if (source === undefined || !spec) return null;
  const parse = expressionError(source);
  if (parse) return parse;
  try {
    const result = evaluateExpression(parseExpression(source), expressionScope(def, effect, key, time, clip, EXPRESSION_FPS));
    const point = spec.kind === "vec2";
    if (typeof result === "string" || (point && typeof result === "boolean")) return point ? "The result must be a point, like [x, y]" : "The result must be a number";
    if (Array.isArray(result) && result.length < (point ? 2 : 1)) return point ? "The result must be a point, like [x, y]" : "The result must be a number";
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Whether an effect has an expression on any of its parameters (its values can then change at every frame). */
export const hasExpressions = (effect: Pick<Effect, "expressions">) => !!effect.expressions && Object.keys(effect.expressions).length > 0;

/**
 * The values an effect applies at source time `time`: its keyframed or static
 * values with its expressions run (see `effectValuesAt`), or the defaults when
 * it's off (or missing).
 */
export function valuesAt(def: EffectDefinition, effect: Effect | undefined, time: number, clip?: Pick<Clip, "id" | "effects">): ParamValues {
  return effect?.enabled ? effectValuesAt(def, effect, time, clip) : defaultParams(def.params);
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
  /** A 3D layer (see `camera.ts`): its depth (px at 1080p) and turns about X and Y count. */
  threeD?: boolean;
  z?: number;
  rotationX?: number;
  rotationY?: number;
}

/** A clip's motion at source time `time`. */
export function motionAt(clip: Clip, time: number): Motion {
  const v = valuesAt(MOTION, findEffect(clip, MOTION.type), time, clip);
  const scale = v.scale as number;
  return {
    fit: v.fit as FitMode,
    position: v.position as Vec2,
    scaleX: v.uniformScale === false ? (v.scaleWidth as number) : scale,
    scaleY: scale,
    rotation: v.rotation as number,
    anchor: v.anchor as Vec2,
    threeD: v.threeD === true,
    z: v.positionZ as number,
    rotationX: v.rotationX as number,
    rotationY: v.rotationY as number,
  };
}

/** A clip's opacity (0..1) at source time `time`. */
export function opacityAt(clip: Clip, time: number): number {
  return valuesAt(OPACITY, findEffect(clip, OPACITY.type), time, clip).opacity as number;
}

/** Whether a clip's time is remapped: it has Time Remapping keyframes (see `TIME_REMAP`). */
export function isRemapped(clip: Pick<Clip, "effects">): boolean {
  return !!remapKeys(clip);
}

/** A remapped clip's Time Remapping keyframes (clip clock -> source time), else undefined. */
export function remapKeys(clip: Pick<Clip, "effects">): Keyframe[] | undefined {
  const keys = clip.effects.find((e) => e.type === TIME_REMAP.type)?.keyframes?.time;
  return keys?.length ? keys : undefined;
}

/** Whether a clip is text (drawn from its Text effect) rather than media. */
export function isTextClip(clip: Pick<Clip, "effects">): boolean {
  return clip.effects.some((e) => e.type === TEXT.type);
}

/** Whether a clip is a solid (drawn from its Solid effect). */
export function isSolidClip(clip: Pick<Clip, "effects">): boolean {
  return clip.effects.some((e) => e.type === SOLID.type);
}

/** Whether a clip is a shape layer (drawn from its Shape effects). */
export function isShapeClip(clip: Pick<Clip, "effects">): boolean {
  return clip.effects.some((e) => e.type === SHAPE.type);
}

/** Whether a clip is a camera (carries the Camera effect). */
export function isCameraClip(clip: Pick<Clip, "effects">): boolean {
  return clip.effects.some((e) => e.type === CAMERA.type);
}

/** What a clip shows (see `ClipKind`). */
export function clipKind(clip: Pick<Clip, "effects" | "adjustment" | "nullObject">): ClipKind {
  if (isTextClip(clip)) return "text";
  if (isShapeClip(clip)) return "shape";
  if (isSolidClip(clip)) return "solid";
  if (isCameraClip(clip)) return "camera";
  if (clip.nullObject) return "null";
  return clip.adjustment ? "adjustment" : "media";
}

/** Whether a clip plays a media file (rather than text, a solid, an adjustment layer or a camera, which have none). */
export const hasMedia = (clip: Pick<Clip, "effects" | "adjustment" | "nullObject">) => clipKind(clip) === "media";

/** Whether a clip has no picture of its own to draw or transition (an adjustment layer or a camera). */
export const drawsNothing = (clip: Pick<Clip, "effects" | "adjustment" | "nullObject">) => {
  const kind = clipKind(clip);
  return kind === "adjustment" || kind === "camera" || kind === "null";
};

/** How a clip is mixed into the frame at source time `time`: See `Placed` in `compositor.ts`. */
export interface Look {
  opacity: number;
  /** A `BLEND_MODES` value. */
  blendMode: string;
  /** A `MATTE_MODES` value: how the clip on the track above cuts it out. */
  trackMatte: string;
  edges: EdgeMode;
  /** Shutter angle in degrees when motion blur is on, else 0. */
  shutter: number;
}

export type EdgeMode = "none" | "mirror" | "tile" | "extend";

/** A clip's opacity, blend mode, edges and motion blur at source time `time`. */
export function lookAt(clip: Clip, time: number): Look {
  const o = valuesAt(OPACITY, findEffect(clip, OPACITY.type), time, clip);
  const m = valuesAt(MOTION, findEffect(clip, MOTION.type), time, clip);
  return {
    opacity: o.opacity as number,
    blendMode: o.blendMode as string,
    trackMatte: o.trackMatte as string,
    edges: m.edges as EdgeMode,
    shutter: m.motionBlur === true ? (m.shutterAngle as number) : 0,
  };
}

/** A solid's colour as premultiplied RGBA (0..1) at source time `time`. */
export function solidColorAt(clip: Clip, time: number): [number, number, number, number] {
  const v = valuesAt(SOLID, findEffect(clip, SOLID.type), time, clip);
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
  /** Its animators' values at this moment (absent without any): the text is then drawn letter by letter. */
  animators?: TextAnimation[];
  /** Room (reference px) the text's frame keeps around it for what its animators do (see `animatorReach`). */
  reach?: number;
}

/** How a text's letters are cased when drawn. */
export type TextCase = "none" | "upper" | "lower";

/** The text as drawn in a case. */
export function applyTextCase(text: string, textCase: TextCase): string {
  return textCase === "upper" ? text.toLocaleUpperCase() : textCase === "lower" ? text.toLocaleLowerCase() : text;
}

/** A text clip's text and look at source time `time`. */
export function textStyleAt(clip: Clip, time: number): TextStyle {
  const text = valuesAt(TEXT, findEffect(clip, TEXT.type), time, clip);
  const look = valuesAt(APPEARANCE, findEffect(clip, APPEARANCE.type), time, clip);
  const style = { ...text, ...look } as unknown as TextStyle;
  const animators = textAnimationsAt(clip, time);
  if (animators.length) {
    style.animators = animators;
    const reach = animatorReach(clip, style.size);
    if (reach > 0) style.reach = reach;
  }
  return style;
}

/** A clip's linear gain (0..1) at source time `time`. */
export function volumeAt(clip: Clip, time: number): number {
  return valuesAt(VOLUME, findEffect(clip, VOLUME.type), time).level as number;
}

/** Whether any parameter of the clip is animated (by keyframes, or by an expression). */
export function hasKeyframes(clip: Clip): boolean {
  return clip.effects.some((e) => (e.keyframes && Object.keys(e.keyframes).length > 0) || hasExpressions(e));
}

/**
 * Give a parameter an expression (or with null or "", take it away). The same project when
 * nothing changes; a parameter that can't have one is left alone.
 */
export function setExpression(project: Project, clipId: ClipIds, effectId: string, key: string, source: string | null): Project {
  return updateEffect(project, clipId, effectId, (effect, def) => {
    const spec = paramSpec(def, key);
    if (!spec || !canExpress(def, spec)) return effect;
    const text = source?.trim() ? source.slice(0, MAX_EXPRESSION) : null;
    if ((effect.expressions?.[key] ?? null) === text) return effect;
    const { [key]: _, ...others } = effect.expressions ?? {};
    const expressions = text === null ? others : { ...others, [key]: text };
    const next: Effect = { ...effect };
    if (Object.keys(expressions).length) next.expressions = expressions;
    else delete next.expressions;
    return next;
  });
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
    // Back to the defaults: their expressions go too.
    const kept = Object.entries(effect.expressions ?? {}).filter(([key]) => !reset.some((p) => p.key === key));
    const expressions = kept.length === Object.keys(effect.expressions ?? {}).length ? effect.expressions : kept.length ? Object.fromEntries(kept) : undefined;
    if (params === effect.params && keyframes === effect.keyframes && expressions === effect.expressions) return effect;
    const next: Effect = { ...effect, params };
    if (keyframes) next.keyframes = keyframes;
    else delete next.keyframes;
    if (expressions) next.expressions = expressions;
    else delete next.expressions;
    return next;
  });
}

// ---------------------------------------------------------------------------
// Video effects: adding, removing and reordering them
// ---------------------------------------------------------------------------

/** Whether an effect is a video effect (drawn by a shader over the clip's picture). */
export function isVideoEffect(effect: Pick<Effect, "type">): boolean {
  return !!byType.get(effect.type)?.shader;
}

/** Whether an effect is one the user added (a video effect, a mask, a shape, an animator...), which can be removed and moved. */
export function isAddedEffect(effect: Pick<Effect, "type">): boolean {
  const def = byType.get(effect.type);
  return !!def && (!!def.shader || !!def.stackable);
}

/**
 * What to call one of a clip's effects: its definition's label, numbered when the clip has
 * several of it ("Mask 2").
 */
export function effectLabel(clip: Pick<Clip, "effects">, effect: Pick<Effect, "id" | "type">): string {
  const def = byType.get(effect.type);
  if (!def) return effect.type;
  const same = clip.effects.filter((e) => e.type === effect.type);
  return same.length > 1 ? `${def.label} ${same.findIndex((e) => e.id === effect.id) + 1}` : def.label;
}

/** A clip's masks, in the order they combine. */
export function maskEffects(clip: Pick<Clip, "effects">): Effect[] {
  return clip.effects.filter((e) => e.type === MASK.type);
}

/** A clip's video effects, in the order they're drawn. */
export function videoEffects(clip: Clip): Effect[] {
  return clip.effects.filter(isVideoEffect);
}

/**
 * Add a video effect (or a mask, a shape, an animator...: anything the user adds), with its
 * default values (and `params` over them), after each clip's others of its kind, so it's
 * drawn over what's there; clips it doesn't apply to (not on a video track, a shape
 * operator on a video...) are skipped. Returns the new effects' ids by clip.
 */
export function addEffect(project: Project, clipIds: string[], type: string, params?: ParamValues): { project: Project; added: Map<string, string> } {
  const def = byType.get(type);
  const added = new Map<string, string>();
  if (!def || !(def.shader || def.stackable)) return { project, added };
  const videoTracks = new Set(project.tracks.filter((t) => t.kind === "video").map((t) => t.id));
  const clips = project.clips.map((clip) => {
    if (!clipIds.includes(clip.id) || !videoTracks.has(clip.trackId) || isCameraClip(clip)) return clip;
    if (!def.appliesTo({ visual: true, audible: false, kind: clipKind(clip) })) return clip;
    const ids = new Set(clip.effects.map((e) => e.id));
    let id = def.type;
    for (let n = 2; ids.has(id); n++) id = `${def.type}_${n}`;
    added.set(clip.id, id);
    return { ...clip, effects: orderEffects([...clip.effects, sanitizeEffect(def, params ? { params } : undefined, id)]) };
  });
  return added.size ? { project: { ...project, clips }, added } : { project, added };
}

/** Remove one of a clip's added effects (built-in ones and what the clip is, like its text, can't be). */
export function removeEffect(project: Project, clipId: string, effectId: string): Project {
  const clip = project.clips.find((c) => c.id === clipId);
  const effect = clip?.effects.find((e) => e.id === effectId);
  if (!clip || !effect || !isAddedEffect(effect)) return project;
  // A shape layer keeps at least one shape (it's what the clip is).
  if (byType.get(effect.type)?.alwaysOn && clip.effects.filter((e) => e.type === effect.type).length < 2) return project;
  const next = { ...clip, effects: clip.effects.filter((e) => e !== effect) };
  return { ...project, clips: project.clips.map((c) => (c === clip ? next : c)) };
}

/** The ids of the effects `effectId` can change places with: the clip's added effects of its kind, in order. */
export function effectPeers(clip: Pick<Clip, "effects">, effectId: string): string[] {
  const effect = clip.effects.find((e) => e.id === effectId);
  if (!effect || !isAddedEffect(effect)) return [];
  const rank = effectRank(effect);
  return clip.effects.filter((e) => isAddedEffect(e) && effectRank(e) === rank).map((e) => e.id);
}

/** Swap an added effect with the one of its kind applied before (-1) or after (+1) it. */
export function moveEffect(project: Project, clipId: string, effectId: string, by: -1 | 1): Project {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return project;
  const peers = effectPeers(clip, effectId);
  const order = clip.effects.flatMap((e, i) => (peers.includes(e.id) ? [i] : []));
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
        if (source.expressions) next.expressions = source.expressions;
        else delete next.expressions;
        return JSON.stringify(next) === JSON.stringify(effect) ? effect : next;
      });
    }
    const missing = videoTracks.has(clip.trackId)
      ? pasted.filter(
          (e) =>
            isAddedEffect(e) &&
            !clip.effects.some((own) => own.id === e.id) &&
            byType.get(e.type)!.appliesTo({ visual: true, audible: false, kind: clipKind(clip) }),
        )
      : [];
    if (missing.length === 0) continue;
    const added = missing.map((e): Effect => {
      const next: Effect = { ...e, params: { ...e.params } };
      if (e.keyframes) next.keyframes = Object.fromEntries(Object.entries(e.keyframes).map(([key, keys]) => [key, moved(keys)]));
      return next;
    });
    p = { ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, effects: orderEffects([...c.effects, ...added]) } : c)) };
  }
  return p;
}
