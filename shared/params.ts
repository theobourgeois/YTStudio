/**
 * Typed parameters: the building block of every property in the app. Effects
 * (`effects.ts`) and transitions (`transitions.ts`) are lists of parameter
 * specs, and one spec drives a value's default, its validation, its row in
 * the properties panel (`src/components/properties/param-rows.tsx`) and
 * whether it can be keyframed (`keyframes.ts`).
 *
 * To add a kind of parameter: add a spec type here, a case to `sanitizeValue`,
 * and a row for it in `param-rows.tsx`.
 */
import type { ClipTraits } from "./effects.ts";
import { clamp, isFiniteNumber, tidy } from "./math.ts";
import type { ParamValue, ParamValues, Vec2 } from "./types.ts";

interface SpecBase<K extends string, V extends ParamValue> {
  kind: K;
  key: string;
  label: string;
  default: V;
  /** Label depending on the other values (e.g. "Scale Height"). */
  labelFor?: (values: ParamValues) => string;
  /** Greyed out depending on the other values. */
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

/** Common number formats. */
export const PERCENT = { scale: 100, unit: "%", step: 1, decimals: 1 } as const;
/** Sizes and distances in px of the project's canvas at 1080p (like the Position values). */
export const PIXELS = { unit: "px", step: 1, decimals: 0 } as const;

const MAX_TEXT_LENGTH = 10_000;

/** A valid value for `spec` (clamped into range), or undefined when `raw` can't be one. */
export function sanitizeValue(spec: ParamSpec, raw: unknown): ParamValue | undefined {
  switch (spec.kind) {
    case "number":
      return isFiniteNumber(raw) ? tidy(clamp(raw, spec.min, spec.max)) : undefined;
    case "vec2":
      return Array.isArray(raw) && raw.length === 2 && isFiniteNumber(raw[0]) && isFiniteNumber(raw[1])
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

/** Every spec's default value, by key. */
export function defaultParams(specs: readonly ParamSpec[]): ParamValues {
  return Object.fromEntries(specs.map((p) => [p.key, p.default]));
}

/** One valid value per spec from untrusted `raw` values (defaults where they're missing or invalid). */
export function sanitizeParams(specs: readonly ParamSpec[], raw: unknown): ParamValues {
  const values = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const params: ParamValues = {};
  for (const spec of specs) params[spec.key] = sanitizeValue(spec, values[spec.key]) ?? spec.default;
  return params;
}

export function sameValue(a: ParamValue | undefined, b: ParamValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a[0] === b[0] && a[1] === b[1];
  return a === b;
}
