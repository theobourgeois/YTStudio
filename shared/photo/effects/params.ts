/**
 * The photo suite's parameter specs (docs/photo/effects/system.md, "Definition and instance"): what a parameter is,
 * its unit, range and default, and how an untrusted value is checked. Validated here once, for the panel, the
 * assistant and `normalizePhotoProject` alike. Photo's own: the video editor's `shared/params.ts` is another suite's.
 */
import { createId } from "../../ids.ts";
import { isBlendMode } from "../blending.ts";
import { sanitizeContour } from "../style/contours.ts";
import { sanitizeGradient } from "../style/gradients.ts";
import type { BlendMode, Contour, CurvePoints, CurveSet, DocPoint, EffectElement, EffectParamValue, Gradient } from "../types.ts";

/**
 * Where a parameter goes on a Layer Style page (Photoshop's groups: Structure, Elements, Quality…), and when it shows
 * (only while another parameter has a value: Outer Glow's gradient with its Gradient radio).
 */
interface Placement {
  group?: string;
  /** Shown while `key` is `is` (or one of them). */
  showIf?: { key: string; is: string | boolean | readonly (string | boolean)[] };
}

/** Whether a spec shows for these values (its `showIf`). */
export const specShows = (spec: { showIf?: Placement["showIf"] }, values: Record<string, unknown>) => {
  if (!spec.showIf) return true;
  const is = spec.showIf.is;
  const v = values[spec.showIf.key];
  return Array.isArray(is) ? is.includes(v as string | boolean) : v === is;
};

/** A number with a unit, a range and a step (what the panel's slider and field show). */
export interface NumberParam extends Placement {
  kind: "number";
  key: string;
  label: string;
  /** What it's measured in, said after the value ("stops"), or "" for a plain number. */
  unit: string;
  min: number;
  max: number;
  /** The slider's step; typed values may be finer. */
  step: number;
  /** Decimals shown. */
  decimals: number;
  default: number;
  /** For the assistant and the panel's tooltip. */
  description: string;
}

/** Curves: a composite curve and one per channel, as points on 0..255. */
export interface CurvesParam extends Placement {
  kind: "curves";
  key: string;
  label: string;
  default: CurveSet;
  description: string;
}

/** One of a few named values (a menu or radio buttons). */
export interface ChoiceParam extends Placement {
  kind: "choice";
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
  /** Radio buttons rather than a menu (Photoshop's for two or three). */
  radio?: boolean;
  default: string;
  description: string;
}

export interface BooleanParam extends Placement {
  kind: "boolean";
  key: string;
  label: string;
  default: boolean;
  description: string;
}

/** A colour, as sRGB "#rrggbb" (a swatch; definitions convert it to linear light when they pack it). */
export interface ColourParam extends Placement {
  kind: "colour";
  key: string;
  label: string;
  default: string;
  description: string;
}

/** A blend mode (the blend-mode menu). */
export interface BlendParam extends Placement {
  kind: "blend";
  key: string;
  label: string;
  default: BlendMode;
  description: string;
}

/** A contour (the contour picker and its editor). */
export interface ContourParam extends Placement {
  kind: "contour";
  key: string;
  label: string;
  default: Contour;
  description: string;
}

/** A pattern (the pattern picker): a document pattern's id, or a built-in one's (`builtin:…`). */
export interface PatternParam extends Placement {
  kind: "pattern";
  key: string;
  label: string;
  default: string;
  description: string;
}

/** A gradient (the gradient picker and its editor). */
export interface GradientParam extends Placement {
  kind: "gradient";
  key: string;
  label: string;
  default: Gradient;
  description: string;
}

/**
 * A point in document pixels. `handle`: drawn on the canvas, where it's dragged (a flare's source). `nullable`: null
 * means the canvas's centre (a flare's optical centre), following the canvas.
 */
export interface PointParam extends Placement {
  kind: "point";
  key: string;
  label: string;
  default: DocPoint | null;
  nullable: boolean;
  handle: boolean;
  description: string;
}

/** What an element's own parameters can be. */
export type ElementParamSpec = NumberParam | ColourParam | ChoiceParam | BooleanParam;

/** A type of element: what it's called and its parameters. */
export interface ElementType {
  type: string;
  label: string;
  description: string;
  params: readonly ElementParamSpec[];
}

/** An ordered list of elements of a few types (a flare's), each with a stable id. */
export interface ElementsParam extends Placement {
  kind: "elements";
  key: string;
  label: string;
  types: readonly ElementType[];
  default: EffectElement[];
  /** At most this many. */
  max: number;
  description: string;
}

/**
 * A named starting point for a filter or generator (the Filter menu's and the Filter Gallery's entries): its
 * parameters for a canvas, with sizes in pixels scaled to it (a preset is the same look on any canvas).
 */
export interface EffectPreset {
  id: string;
  label: string;
  /** What it looks like, in a few words (the gallery's card, the assistant's catalogue). */
  description: string;
  params: (canvas: { width: number; height: number }) => Record<string, EffectParamValue>;
}

export type ParamSpec = NumberParam | CurvesParam | ColourParam | PointParam | ChoiceParam | BooleanParam | ElementsParam | BlendParam | ContourParam | GradientParam | PatternParam;

/** Photoshop's limit: 16 points on a curve, its ends included. */
export const MAX_CURVE_POINTS = 16;
/** A curve that changes nothing. */
export const IDENTITY_POINTS: CurvePoints = [
  [0, 0],
  [255, 255],
];
export const CURVE_CHANNELS = ["rgb", "red", "green", "blue"] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];

export const identityCurveSet = (): CurveSet => ({ rgb: copyPoints(IDENTITY_POINTS), red: copyPoints(IDENTITY_POINTS), green: copyPoints(IDENTITY_POINTS), blue: copyPoints(IDENTITY_POINTS) });

const copyPoints = (points: CurvePoints): CurvePoints => points.map(([x, y]) => [x, y]);

/** The value checked: the same value when it's valid, else repaired (and `repaired` says so). */
export interface Sanitized<T> {
  value: T;
  repaired: boolean;
}

/**
 * A curve's points checked: pairs of finite numbers, held to 0..255, sorted by input, one per input (the later
 * wins), at most 16. Fewer than two valid points is the identity curve.
 */
export function sanitizePoints(value: unknown): Sanitized<CurvePoints> {
  if (!Array.isArray(value)) return { value: copyPoints(IDENTITY_POINTS), repaired: true };
  let repaired = false;
  const byInput = new Map<number, number>();
  for (const p of value) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === "number" && Number.isFinite(n))) {
      repaired = true;
      continue;
    }
    const x = Math.max(0, Math.min(255, p[0]));
    const y = Math.max(0, Math.min(255, p[1]));
    if (x !== p[0] || y !== p[1] || byInput.has(x)) repaired = true;
    byInput.set(x, y);
  }
  let points = [...byInput].sort((a, b) => a[0] - b[0]) as CurvePoints;
  if (points.length < 2) return { value: copyPoints(IDENTITY_POINTS), repaired: true };
  if (points.length > MAX_CURVE_POINTS) {
    points = points.slice(0, MAX_CURVE_POINTS);
    repaired = true;
  }
  // Out of order on the way in is a repair too (the order is part of the value).
  if (!repaired && points.some((p, i) => p[0] !== (value[i] as number[])[0])) repaired = true;
  return { value: points, repaired };
}

function sanitizeCurveSet(value: unknown): Sanitized<CurveSet> {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  let repaired = v !== value;
  const out = {} as CurveSet;
  for (const channel of CURVE_CHANNELS) {
    if (v[channel] === undefined) {
      out[channel] = copyPoints(IDENTITY_POINTS);
      repaired = true;
      continue;
    }
    const s = sanitizePoints(v[channel]);
    out[channel] = s.value;
    repaired ||= s.repaired;
  }
  return { value: out, repaired };
}

export const isColourValue = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** The farthest a point may be from the canvas (as a layer's centre may). */
const POINT_LIMIT = 1e6;

const ELEMENT_ID = /^[\w-]{1,64}$/;

/** An element's own parameters checked by its type's specs (a bad one at its default, an out-of-range one held). */
function sanitizeElement(type: ElementType, raw: Record<string, unknown>, id: string): Sanitized<EffectElement> {
  let repaired = false;
  const out: EffectElement = { id, type: type.type, enabled: raw.enabled !== false };
  if (typeof raw.enabled !== "boolean") repaired ||= raw.enabled !== undefined;
  for (const spec of type.params) {
    const s = sanitizeParam(spec, raw[spec.key]);
    out[spec.key] = s.value as number | boolean | string;
    repaired ||= s.repaired;
  }
  for (const key of Object.keys(raw)) if (key !== "id" && key !== "type" && key !== "enabled" && !type.params.some((p) => p.key === key)) repaired = true;
  return { value: out, repaired };
}

function sanitizeElements(spec: ElementsParam, value: unknown): Sanitized<EffectElement[]> {
  if (!Array.isArray(value)) return { value: structuredClone(spec.default), repaired: true };
  let repaired = false;
  const seen = new Set<string>();
  const out: EffectElement[] = [];
  for (const raw of value) {
    const e = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
    const type = e ? spec.types.find((t) => t.type === e.type) : undefined;
    if (!e || !type || out.length >= spec.max) {
      repaired = true;
      continue;
    }
    let id = typeof e.id === "string" && ELEMENT_ID.test(e.id) ? e.id : "";
    if (!id || seen.has(id)) {
      id = createId("el");
      repaired = true;
    }
    seen.add(id);
    const s = sanitizeElement(type, e, id);
    out.push(s.value);
    repaired ||= s.repaired;
  }
  return { value: out, repaired };
}

/** A parameter's value checked against its spec: a bad one goes back to its default, an out-of-range one is held. */
export function sanitizeParam(spec: ParamSpec, value: unknown): Sanitized<EffectParamValue> {
  switch (spec.kind) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return { value: spec.default, repaired: true };
      const held = Math.max(spec.min, Math.min(spec.max, value));
      return { value: held, repaired: held !== value };
    }
    case "curves":
      if (value === undefined) return { value: structuredClone(spec.default), repaired: true };
      return sanitizeCurveSet(value);
    case "colour":
      return isColourValue(value) ? { value: value.toLowerCase(), repaired: value !== value.toLowerCase() } : { value: spec.default, repaired: true };
    case "choice":
      return spec.options.some((o) => o.value === value) ? { value: value as string, repaired: false } : { value: spec.default, repaired: true };
    case "boolean":
      return typeof value === "boolean" ? { value, repaired: false } : { value: spec.default, repaired: true };
    case "blend":
      return isBlendMode(value) ? { value, repaired: false } : { value: spec.default, repaired: true };
    case "pattern":
      return typeof value === "string" && /^[\w:-]{1,64}$/.test(value) ? { value, repaired: false } : { value: spec.default, repaired: true };
    case "contour":
      return value === undefined ? { value: structuredClone(spec.default), repaired: true } : sanitizeContour(value);
    case "gradient":
      return value === undefined ? { value: structuredClone(spec.default), repaired: true } : sanitizeGradient(value);
    case "point": {
      if (value === null && spec.nullable) return { value: null, repaired: false };
      if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
        return { value: spec.default === null ? null : [...spec.default], repaired: true };
      }
      const held: DocPoint = [Math.max(-POINT_LIMIT, Math.min(POINT_LIMIT, value[0])), Math.max(-POINT_LIMIT, Math.min(POINT_LIMIT, value[1]))];
      return { value: held, repaired: held[0] !== value[0] || held[1] !== value[1] };
    }
    case "elements":
      return sanitizeElements(spec, value);
  }
}

export const defaultParams = (specs: readonly ParamSpec[]): Record<string, EffectParamValue> =>
  Object.fromEntries(specs.map((s) => [s.key, typeof s.default === "object" && s.default !== null ? structuredClone(s.default) : s.default]));

/** An element of `type` at its defaults. */
export const newElement = (type: ElementType, id: string): EffectElement => ({
  id,
  type: type.type,
  enabled: true,
  ...Object.fromEntries(type.params.map((p) => [p.key, p.default])),
});

/** Whether two parameter values are the same (deeply: curves, contours, gradients, points and elements are objects). */
export function sameValue(a: EffectParamValue | undefined, b: EffectParamValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
