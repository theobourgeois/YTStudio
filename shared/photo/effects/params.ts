/**
 * The photo suite's parameter specs (docs/photo/effects/system.md, "Definition and instance"): what a parameter is,
 * its unit, range and default, and how an untrusted value is checked. Validated here once, for the panel, the
 * assistant and `normalizePhotoProject` alike. Photo's own: the video editor's `shared/params.ts` is another suite's.
 */
import { isBlendMode } from "../blending.ts";
import { sanitizeContour } from "../style/contours.ts";
import { sanitizeGradient } from "../style/gradients.ts";
import type { BlendMode, Contour, CurvePoints, CurveSet, EffectParamValue, Gradient } from "../types.ts";

/**
 * Where a parameter goes on a Layer Style page (Photoshop's groups: Structure, Elements, Quality…), and when it shows
 * (only while another parameter has a value: Outer Glow's gradient with its Gradient radio).
 */
interface Placement {
  group?: string;
  showIf?: { key: string; is: string | boolean };
}

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

/** A colour, sRGB "#rrggbb" (a swatch). */
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

/** A gradient (the gradient picker and its editor). */
export interface GradientParam extends Placement {
  kind: "gradient";
  key: string;
  label: string;
  default: Gradient;
  description: string;
}

export type ParamSpec = NumberParam | CurvesParam | ChoiceParam | BooleanParam | ColourParam | BlendParam | ContourParam | GradientParam;

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

/** A parameter's value checked against its spec: a bad one goes back to its default, an out-of-range one is held. */
export function sanitizeParam(spec: ParamSpec, value: unknown): Sanitized<EffectParamValue> {
  switch (spec.kind) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return { value: spec.default, repaired: true };
      const held = Math.max(spec.min, Math.min(spec.max, value));
      return { value: held, repaired: held !== value };
    }
    case "choice":
      return spec.options.some((o) => o.value === value) ? { value: value as string, repaired: false } : { value: spec.default, repaired: true };
    case "boolean":
      return typeof value === "boolean" ? { value, repaired: false } : { value: spec.default, repaired: true };
    case "colour":
      return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? { value: value.toLowerCase(), repaired: value !== value.toLowerCase() } : { value: spec.default, repaired: true };
    case "blend":
      return isBlendMode(value) ? { value, repaired: false } : { value: spec.default, repaired: true };
    case "contour":
      return value === undefined ? { value: structuredClone(spec.default), repaired: true } : sanitizeContour(value);
    case "gradient":
      return value === undefined ? { value: structuredClone(spec.default), repaired: true } : sanitizeGradient(value);
    case "curves":
      if (value === undefined) return { value: structuredClone(spec.default), repaired: true };
      return sanitizeCurveSet(value);
  }
}

export const defaultParams = (specs: readonly ParamSpec[]): Record<string, EffectParamValue> =>
  Object.fromEntries(specs.map((s) => [s.key, typeof s.default === "object" ? structuredClone(s.default) : s.default]));

/** Whether two parameter values are the same (deeply: curves, contours and gradients are objects). */
export function sameValue(a: EffectParamValue | undefined, b: EffectParamValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
