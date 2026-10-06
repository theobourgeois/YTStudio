/**
 * The photo suite's effect definitions (docs/photo/effects/system.md): what each is, its parameters, its region
 * rule and whether it commutes with reduction (rendering.md, "The render plan"), and its CPU reference. Adding one:
 * a definition here, its GPU pass in `src/suites/photo/render/adjustments.ts`, a reference in `../reference/`.
 */
import { curvesFor, exposurePixel, type Pixel } from "../reference/adjustments.ts";
import type { CurveSet, EffectInstance, EffectParamValue } from "../types.ts";
import { isIdentityCurve, isIdentityCurveSet } from "./curve-math.ts";
import { CURVE_CHANNELS, type CurveChannel, type CurvesParam, type NumberParam, type ParamSpec, defaultParams, identityCurveSet, sanitizeParam } from "./params.ts";

/** How Photoshop names each curve. */
export const CHANNEL_LABELS: Record<CurveChannel, string> = { rgb: "RGB", red: "Red", green: "Green", blue: "Blue" };

export type EffectKind = "adjustment";

export interface EffectDefinition {
  type: string;
  /** Bumped when what its parameters mean changes; part of every cache key. */
  version: number;
  kind: EffectKind;
  label: string;
  /** What it does, for the assistant. */
  description: string;
  params: readonly ParamSpec[];
  /** Its input region for an output region: pointwise effects need the same pixels. */
  region: "pointwise";
  /** Whether these parameters change nothing (the render plan leaves it out, so identity is exact). */
  isIdentity: (params: Record<string, EffectParamValue>) => boolean;
  /** Whether evaluating it at a reduced level gives the full-resolution result reduced (it's linear). */
  commutesWithReduction: (params: Record<string, EffectParamValue>) => boolean;
  /** The CPU reference: one premultiplied linear pixel, these parameters. */
  reference: (params: Record<string, EffectParamValue>) => (pixel: Pixel) => Pixel;
  /** Its settings in a few words ("+1.5 stops"). */
  summary: (params: Record<string, EffectParamValue>) => string;
}

const exposureParams: NumberParam[] = [
  { kind: "number", key: "exposure", label: "Exposure", unit: "stops", min: -20, max: 20, step: 0.01, decimals: 2, default: 0, description: "Stops of light: each one doubles (or, negative, halves) it. Moves the highlights most." },
  { kind: "number", key: "offset", label: "Offset", unit: "", min: -0.5, max: 0.5, step: 0.0001, decimals: 4, default: 0, description: "Added to every value in linear light: lifts or sinks the shadows and midtones, the highlights hardly." },
  { kind: "number", key: "gamma", label: "Gamma Correction", unit: "", min: 0.01, max: 9.99, step: 0.01, decimals: 2, default: 1, description: "A power curve (1 / gamma) after exposure and offset: above 1 brightens the midtones, below 1 darkens them." },
];

const n = (params: Record<string, EffectParamValue>, key: string) => params[key] as number;
const signed = (v: number, decimals: number) => `${v > 0 ? "+" : ""}${Number(v.toFixed(decimals))}`;

const EXPOSURE: EffectDefinition = {
  type: "exposure",
  version: 1,
  kind: "adjustment",
  label: "Exposure",
  description: "Photoshop's Exposure, in linear light: exposure in stops, an offset, then a gamma correction.",
  params: exposureParams,
  region: "pointwise",
  isIdentity: (p) => n(p, "exposure") === 0 && n(p, "offset") === 0 && n(p, "gamma") === 1,
  // × 2^stops + offset × alpha is linear in premultiplied light; the gamma's power isn't.
  commutesWithReduction: (p) => n(p, "gamma") === 1,
  reference: (p) => (pixel) => exposurePixel(pixel, { exposure: n(p, "exposure"), offset: n(p, "offset"), gamma: n(p, "gamma") }),
  summary: (p) =>
    [
      n(p, "exposure") !== 0 && `${signed(n(p, "exposure"), 2)} stops`,
      n(p, "offset") !== 0 && `offset ${signed(n(p, "offset"), 4)}`,
      n(p, "gamma") !== 1 && `gamma ${Number(n(p, "gamma").toFixed(2))}`,
    ]
      .filter(Boolean)
      .join(", ") || "no change",
};

const curvesParam: CurvesParam = {
  kind: "curves",
  key: "curves",
  label: "Curves",
  default: identityCurveSet(),
  description:
    "Points [input, output] on 0..255 in the image's encoded (gamma) values, as Photoshop shows them: the composite curve (rgb) and one per channel (red, green, blue), each channel's applied before the composite. 2 to 16 points a curve, inputs increasing; the curve is a smooth spline through them, flat beyond its first and last.",
};

const CURVES: EffectDefinition = {
  type: "curves",
  version: 1,
  kind: "adjustment",
  label: "Curves",
  description: "Photoshop's Curves: tone curves on the encoded values, a composite one and one per channel.",
  params: [curvesParam],
  region: "pointwise",
  isIdentity: (p) => isIdentityCurveSet(p.curves as CurveSet),
  commutesWithReduction: () => false,
  reference: (p) => curvesFor(p.curves as CurveSet),
  summary: (p) => {
    const set = p.curves as CurveSet;
    const shaped = CURVE_CHANNELS.filter((c) => !isIdentityCurve(set[c]));
    return shaped.length ? `${shaped.map((c) => CHANNEL_LABELS[c]).join(", ")} shaped` : "no change";
  },
};

export const EFFECTS: readonly EffectDefinition[] = [EXPOSURE, CURVES];

export const effectDefinition = (type: string): EffectDefinition | undefined => EFFECTS.find((d) => d.type === type);

/** The adjustments the user can add, in the order menus list them. */
export const ADJUSTMENTS = EFFECTS.filter((d) => d.kind === "adjustment");

/** Why an instance can't be used here, or null when it can. */
export function unavailableReason(effect: EffectInstance): string | null {
  const def = effectDefinition(effect.type);
  if (!def) return `"${effect.type}" isn't an effect this version of the app knows.`;
  if (effect.version > def.version) return `This ${def.label} was made by a newer version of the app.`;
  return null;
}

/** A new instance of a definition, at its defaults. */
export const newEffect = (def: EffectDefinition, id: string): EffectInstance => ({ id, type: def.type, version: def.version, enabled: true, params: defaultParams(def.params) });

/**
 * Parameters checked by their definition: unknown keys dropped, missing or bad ones at their default, out-of-range
 * ones held. `problems` says what was repaired.
 */
export function validateParams(def: EffectDefinition, raw: unknown): { params: Record<string, EffectParamValue>; problems: string[] } {
  const given = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const params: Record<string, EffectParamValue> = {};
  for (const spec of def.params) {
    const s = sanitizeParam(spec, given[spec.key]);
    params[spec.key] = s.value;
    if (s.repaired && given[spec.key] !== undefined) problems.push(`${def.label} ${spec.label}: ${JSON.stringify(given[spec.key])} was repaired.`);
  }
  for (const key of Object.keys(given)) if (!def.params.some((s) => s.key === key)) problems.push(`${def.label} has no parameter "${key}".`);
  return { params, problems };
}
