/**
 * Clip properties, organised like Premiere's Effect Controls: a clip carries a
 * list of effects (Motion, Opacity, Volume...), each a set of typed
 * parameters. An effect's definition drives everything generically: default
 * values, validation of stored projects, the properties panel, and evaluation
 * at a point in time (a static value, or keyframes).
 *
 * To add a property, add a spec to a definition (or a definition to
 * `EFFECTS`) and read it where clips are drawn: the preview engine and the
 * export (`server/render.ts`). Specs don't depend on clips, so other things
 * with parameters later (transitions) can reuse them and the panel rows.
 *
 * A text clip is a clip with no media (`assetId` is "") that carries the Text
 * and Appearance effects; the browser draws it (`src/lib/text-render.ts`).
 */
import type {
  Clip,
  Easing,
  Effect,
  FitMode,
  Keyframe,
  ParamValue,
  ParamValues,
  Project,
  Vec2,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Parameter specs
// ---------------------------------------------------------------------------

interface SpecBase<K extends string, V extends ParamValue> {
  kind: K;
  key: string;
  label: string;
  default: V;
  /** Label depending on the effect's other values (e.g. "Scale Height"). */
  labelFor?: (values: ParamValues) => string;
  /** Greyed out depending on the effect's other values. */
  disabledFor?: (values: ParamValues) => boolean;
  /** Only listed for some clips (e.g. framing, which text doesn't have). */
  appliesTo?: (clip: ClipTraits) => boolean;
}

export interface NumberSpec extends SpecBase<"number", number> {
  min: number;
  max: number;
  /** Shown as value × `scale` (e.g. 100 for a percentage), followed by `unit`. */
  scale?: number;
  unit?: string;
  /** Change per scrubbed pixel or arrow key press, in display units. */
  step: number;
  /** Decimals shown, in display units. */
  decimals: number;
  /** Also show a slider (short, bounded ranges). */
  slider?: boolean;
}

export interface Vec2Spec extends SpecBase<"vec2", Vec2> {
  /** The components are fractions of the canvas or of the clip's own frame; shown as pixels of it. */
  space: "canvas" | "media";
  /** Bounds of each component (as fractions). */
  min: number;
  max: number;
  step: number;
  decimals: number;
}

export type BooleanSpec = SpecBase<"boolean", boolean>;

export interface ChoiceSpec extends SpecBase<"choice", string> {
  options: { value: string; label: string }[];
}

/** Free text, possibly several lines. */
export type TextSpec = SpecBase<"text", string>;

/** A `#rrggbb` colour. */
export type ColorSpec = SpecBase<"color", string>;

/** A font family installed on this computer (see `/api/fonts`). */
export type FontSpec = SpecBase<"font", string>;

/** One of the styles ("Bold", "Light Italic"...) of the family in the `font` parameter `familyKey`. */
export interface FontStyleSpec extends SpecBase<"fontStyle", string> {
  familyKey: string;
}

export type ParamSpec = NumberSpec | Vec2Spec | BooleanSpec | ChoiceSpec | TextSpec | ColorSpec | FontSpec | FontStyleSpec;

/** Numbers and points can be animated; everything else only ever jumps. */
export const isAnimatable = (spec: ParamSpec) => spec.kind === "number" || spec.kind === "vec2";

/** What a clip is, which decides the effects it shows. */
export interface ClipTraits {
  /** Drawn on the canvas (on a video track). */
  visual: boolean;
  /** Has sound. */
  audible: boolean;
  /** A text clip (no media). */
  text: boolean;
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
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const percent = { scale: 100, unit: "%", step: 1, decimals: 1 } as const;

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
      // Text is laid out at its own size; there's no frame to fit.
      appliesTo: (c) => !c.text,
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
      ...percent,
    },
    {
      kind: "number",
      key: "scaleWidth",
      label: "Scale Width",
      disabledFor: (v) => v.uniformScale !== false,
      default: 1,
      min: 0,
      max: 100,
      ...percent,
    },
    { kind: "boolean", key: "uniformScale", label: "Uniform Scale", default: true },
    { kind: "number", key: "rotation", label: "Rotation", default: 0, min: -36_000, max: 36_000, unit: "°", step: 1, decimals: 1 },
    // The point of the clip's frame that scaling and rotation happen around.
    { kind: "vec2", key: "anchor", label: "Anchor Point", default: [0.5, 0.5], space: "media", min: -10, max: 10, step: 1, decimals: 1 },
  ],
  // While scale is uniform the width follows it, so turning uniform scale off starts from the same size.
  adjust: (current, patch) => {
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
  params: [{ kind: "number", key: "opacity", label: "Opacity", default: 1, min: 0, max: 1, slider: true, ...percent }],
};

export const VOLUME: EffectDefinition = {
  type: "volume",
  label: "Volume",
  builtIn: true,
  appliesTo: (c) => c.audible,
  params: [
    // Linear gain.
    { kind: "number", key: "level", label: "Level", default: 1, min: 0, max: 1, slider: true, ...percent, decimals: 0 },
  ],
};

/** Sizes and distances of text are px of the project's canvas at 1080p (like the Position values). */
const px = { unit: "px", step: 1, decimals: 0 } as const;

/** What a text clip says and how it's set. Text clips carry it; nothing else can. */
export const TEXT: EffectDefinition = {
  type: "text",
  label: "Text",
  builtIn: false,
  alwaysOn: true,
  appliesTo: (c) => c.text,
  params: [
    { kind: "text", key: "text", label: "Text", default: "Text" },
    { kind: "font", key: "font", label: "Font", default: "Helvetica Neue" },
    { kind: "fontStyle", key: "fontStyle", label: "Style", default: "Bold", familyKey: "font" },
    { kind: "number", key: "size", label: "Size", default: 120, min: 1, max: 2000, ...px },
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
    { kind: "number", key: "leading", label: "Line Spacing", default: 1.2, min: 0.5, max: 5, ...percent, decimals: 0 },
  ],
};

const off = (key: string) => (v: ParamValues) => !((v[key] as number) > 0);

/** How a text clip's letters are painted: fill, stroke, a box behind them and a drop shadow. */
export const APPEARANCE: EffectDefinition = {
  type: "appearance",
  label: "Appearance",
  builtIn: false,
  appliesTo: (c) => c.text,
  params: [
    { kind: "color", key: "fill", label: "Fill", default: "#ffffff" },
    { kind: "number", key: "strokeWidth", label: "Stroke", default: 0, min: 0, max: 200, ...px, step: 0.5, decimals: 1 },
    { kind: "color", key: "strokeColor", label: "Stroke Color", default: "#000000", disabledFor: off("strokeWidth") },
    { kind: "number", key: "background", label: "Background", default: 0, min: 0, max: 1, slider: true, ...percent, decimals: 0 },
    { kind: "color", key: "backgroundColor", label: "Background Color", default: "#000000", disabledFor: off("background") },
    { kind: "number", key: "shadow", label: "Shadow", default: 0, min: 0, max: 1, slider: true, ...percent, decimals: 0 },
    { kind: "color", key: "shadowColor", label: "Shadow Color", default: "#000000", disabledFor: off("shadow") },
    { kind: "number", key: "shadowDistance", label: "Shadow Distance", default: 8, min: 0, max: 500, ...px, disabledFor: off("shadow") },
    { kind: "number", key: "shadowBlur", label: "Shadow Blur", default: 12, min: 0, max: 500, ...px, disabledFor: off("shadow") },
  ],
};

/** Every effect definition; built-in ones in the order they're listed (and applied). */
export const EFFECTS: readonly EffectDefinition[] = [MOTION, OPACITY, VOLUME, TEXT, APPEARANCE];

const byType = new Map(EFFECTS.map((d) => [d.type, d]));

export function effectDefinition(type: string): EffectDefinition | undefined {
  return byType.get(type);
}

export function paramSpec(def: EffectDefinition, key: string): ParamSpec | undefined {
  return def.params.find((p) => p.key === key);
}

export function defaultValues(def: EffectDefinition): ParamValues {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

export function sameValue(a: ParamValue | undefined, b: ParamValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a[0] === b[0] && a[1] === b[1];
  return a === b;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Round away float noise (and -0) so equal values compare equal. */
const tidy = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
const EASINGS: readonly Easing[] = ["linear", "ease", "hold"];
const MAX_TEXT_LENGTH = 10_000;

/** A valid value for `spec` (clamped into range), or undefined when `raw` can't be one. */
export function sanitizeValue(spec: ParamSpec, raw: unknown): ParamValue | undefined {
  switch (spec.kind) {
    case "number":
      return isNum(raw) ? tidy(clamp(raw, spec.min, spec.max)) : undefined;
    case "vec2":
      return Array.isArray(raw) && raw.length === 2 && isNum(raw[0]) && isNum(raw[1])
        ? [tidy(clamp(raw[0], spec.min, spec.max)), tidy(clamp(raw[1], spec.min, spec.max))]
        : undefined;
    case "boolean":
      return typeof raw === "boolean" ? raw : undefined;
    case "choice":
      return spec.options.some((o) => o.value === raw) ? (raw as string) : undefined;
    case "text":
      return typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").slice(0, MAX_TEXT_LENGTH) : undefined;
    case "color":
      return typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : undefined;
    case "font":
    case "fontStyle": {
      const name = typeof raw === "string" ? raw.trim().slice(0, 200) : "";
      return name || undefined;
    }
  }
}

function sanitizeKeyframes(spec: ParamSpec, raw: unknown): Keyframe[] {
  if (!isAnimatable(spec) || !Array.isArray(raw)) return [];
  const byTime = new Map<number, Keyframe>();
  for (const k of raw) {
    if (!k || typeof k !== "object" || !isNum(k.time)) continue;
    const value = sanitizeValue(spec, k.value);
    if (value === undefined) continue;
    const time = tidy(k.time);
    byTime.set(time, { time, value, easing: EASINGS.includes(k.easing) ? k.easing : "linear" });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function sanitizeEffect(def: EffectDefinition, raw: Partial<Effect> | undefined, id: string): Effect {
  const params: ParamValues = {};
  const keyframes: Record<string, Keyframe[]> = {};
  for (const spec of def.params) {
    params[spec.key] = sanitizeValue(spec, raw?.params?.[spec.key]) ?? spec.default;
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
  // Text clips carry Text and Appearance once each (Appearance added when missing).
  const isText = stored.some((e) => e.type === TEXT.type);
  if (isText && !stored.some((e) => e.type === APPEARANCE.type)) stored.push({ type: APPEARANCE.type });
  const once = new Set<string>();
  for (const e of stored) {
    const def = byType.get(e.type)!;
    if (def.builtIn) continue;
    if (def === TEXT || def === APPEARANCE) {
      if (once.has(def.type)) continue;
      once.add(def.type);
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

const smooth = (f: number) => f * f * (3 - 2 * f);

function mix(a: ParamValue, b: ParamValue, f: number): ParamValue {
  if (isNum(a) && isNum(b)) return a + (b - a) * f;
  if (Array.isArray(a) && Array.isArray(b)) return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  return f < 1 ? a : b;
}

/** The value of sorted keyframes at `time`: held before the first and after the last. */
export function keyframeValue(keyframes: Keyframe[], time: number): ParamValue {
  const next = keyframes.findIndex((k) => k.time > time);
  if (next === 0) return keyframes[0].value;
  if (next === -1) return keyframes[keyframes.length - 1].value;
  const a = keyframes[next - 1];
  const b = keyframes[next];
  if (a.easing === "hold") return a.value;
  const f = (time - a.time) / (b.time - a.time);
  return mix(a.value, b.value, a.easing === "ease" ? smooth(f) : f);
}

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
  return effect?.enabled ? storedValuesAt(def, effect, time) : defaultValues(def);
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

/** Everything that decides how a text clip looks, at one point in time. */
export interface TextStyle {
  text: string;
  font: string;
  fontStyle: string;
  /** Font size in reference px (the canvas at 1080p). */
  size: number;
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

function updateEffect(
  project: Project,
  clipId: string,
  effectId: string,
  update: (effect: Effect, def: EffectDefinition) => Effect,
): Project {
  let changed = false;
  const clips = project.clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    const effects = clip.effects.map((e) => {
      const def = e.id === effectId ? byType.get(e.type) : undefined;
      if (!def) return e;
      const next = update(e, def);
      if (next !== e) changed = true;
      return next;
    });
    return changed ? { ...clip, effects } : clip;
  });
  return changed ? { ...project, clips } : project;
}

/**
 * Set parameters of one of a clip's effects (invalid values are clamped or
 * ignored). A parameter that has keyframes gets a keyframe at source time
 * `time` instead, when given, like changing an animated value in Premiere.
 */
export function setParams(
  project: Project,
  clipId: string,
  effectId: string,
  patch: ParamValues,
  time?: number,
): Project {
  return updateEffect(project, clipId, effectId, (effect, def) => {
    let params = effect.params;
    let keyframes = effect.keyframes;
    for (const [key, raw] of Object.entries(def.adjust?.(effect.params, patch) ?? patch)) {
      const spec = paramSpec(def, key);
      const value = spec && sanitizeValue(spec, raw);
      if (value === undefined) continue;
      const keys = keyframes?.[key];
      if (keys?.length && time !== undefined) {
        const t = tidy(time);
        const at = keys.find((k) => k.time === t);
        if (at && sameValue(at.value, value)) continue;
        const rest = keys.filter((k) => k.time !== t);
        const added: Keyframe = { time: t, value, easing: at?.easing ?? "linear" };
        keyframes = { ...keyframes, [key]: [...rest, added].sort((a, b) => a.time - b.time) };
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

/** Put parameters (all of them by default) back to their defaults, dropping their keyframes. */
export function resetParams(project: Project, clipId: string, effectId: string, keys?: string[]): Project {
  return updateEffect(project, clipId, effectId, (effect, def) => {
    const reset = def.params.filter((p) => !keys || keys.includes(p.key));
    const changed = reset.some((p) => !sameValue(effect.params[p.key], p.default) || effect.keyframes?.[p.key]);
    if (!changed) return effect;
    const params = { ...effect.params };
    const keyframes = { ...effect.keyframes };
    for (const p of reset) {
      params[p.key] = p.default;
      delete keyframes[p.key];
    }
    const next: Effect = { ...effect, params };
    if (Object.keys(keyframes).length) next.keyframes = keyframes;
    else delete next.keyframes;
    return next;
  });
}
