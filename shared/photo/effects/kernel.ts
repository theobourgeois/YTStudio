/**
 * Kernel filters (docs/photo/effects/stylized-filters.md): the stylised filters of the Filter Gallery (gradient maps,
 * halftone, glitch, grain…), each a function of the document point and its layer's content there and nearby, in
 * document pixels, so the screen, export regions and refinements all compute the same thing. A definition here says
 * its parameters, presets and `reach`; its CPU reference is in `../reference/filters/`, its WGSL in
 * `src/suites/photo/render/filters/` (the two are kept in step and checked against each other by
 * `scripts/photo-sheet.ts`). Every one has a Mix (Photoshop's Fade): its result mixed with what it was given.
 *
 * None commutes with reduction (they're not linear, or draw patterns in document pixels): a reduced view shows them
 * evaluated at its own level first, then refined from level 0 as Curves is.
 */
import type { SceneReads } from "../scene.ts";
import type { EffectParamValue, Gradient } from "../types.ts";
import type { EffectDefinition, FilterCategory } from "./index.ts";
import type { BooleanParam, ChoiceParam, ColourParam, EffectPreset, GradientParam, NumberParam, ParamSpec, PointParam } from "./params.ts";

/** What a kernel filter is (its definition says `kernel`). */
export interface KernelFilterSpec {
  type: string;
  version?: number;
  label: string;
  description: string;
  category: FilterCategory;
  /** Its own parameters (Mix is added last). */
  params: readonly ParamSpec[];
  /** How far from a point it reads its content, in document pixels (0: only the point itself). */
  reach: (params: Record<string, EffectParamValue>) => number;
  /** Its settings in a few words. */
  summary: (params: Record<string, EffectParamValue>) => string;
  presets: readonly EffectPreset[];
  /** Whether these settings leave the content as it is (besides Mix 0). */
  isIdentity?: (params: Record<string, EffectParamValue>) => boolean;
  /** The scene maps it reads besides Apply To's (`../scene.ts`): its picture's depth, its subject. */
  scene?: (params: Record<string, EffectParamValue>) => SceneReads | null;
}

/** Mix: how much of the filter's result replaces the content (Photoshop's Fade), last on every kernel filter. */
export const MIX: NumberParam = { kind: "number", key: "mix", label: "Mix", unit: "%", min: 0, max: 100, step: 1, decimals: 0, default: 100, description: "How much of the filter's result is used: 0 leaves the layer as it was." };

/**
 * Apply To: where the filter changes the layer, by its subject (`../scene.ts`): everywhere, the subject alone (the
 * background left as it was), or the background alone. Last but Mix on every kernel filter; applied by the pass.
 */
export const APPLY_TO: ChoiceParam = {
  kind: "choice",
  key: "applyTo",
  label: "Apply To",
  options: [
    { value: "all", label: "Everything" },
    { value: "subject", label: "Subject" },
    { value: "background", label: "Background" },
  ],
  radio: true,
  default: "all",
  description: "Where the filter changes the layer: everywhere, only its subject (found by Select Subject's model), or only the background around the subject.",
};

/** Apply To as the pass reads it: 0 everywhere, 1 the subject, 2 the background. */
export const applyToCode = (params: Record<string, EffectParamValue>) => (params.applyTo === "subject" ? 1 : params.applyTo === "background" ? 2 : 0);

/** A filter definition from a kernel spec. */
export function kernelFilter(spec: KernelFilterSpec): EffectDefinition {
  return {
    kernel: true,
    type: spec.type,
    version: spec.version ?? 1,
    kind: "filter",
    label: spec.label,
    description: spec.description,
    params: [...spec.params, APPLY_TO, MIX],
    category: spec.category,
    presets: spec.presets,
    region: "neighbourhood",
    // Whole document pixels, and one more for bilinear reads between them.
    reach: (p) => {
      const r = spec.reach(p);
      return r > 0 ? Math.ceil(r) + 1 : 0;
    },
    isIdentity: (p) => p.mix === 0 || !!spec.isIdentity?.(p),
    scene: (p) => {
      const own = spec.scene?.(p) ?? null;
      const subject = applyToCode(p) !== 0;
      return own || subject ? { depth: !!own?.depth, subject: subject || !!own?.subject } : null;
    },
    commutesWithReduction: () => false,
    summary: (p) => `${spec.summary(p)}${applyToCode(p) === 1 ? ", subject only" : applyToCode(p) === 2 ? ", background only" : ""}${p.mix !== 100 ? `, mix ${p.mix}%` : ""}`,
  };
}

// --- parameter specs, briefly ---

export const num = (key: string, label: string, unit: string, min: number, max: number, def: number, description: string, step = 1, decimals = 0): NumberParam => ({ kind: "number", key, label, unit, min, max, step, decimals, default: def, description });
export const percent = (key: string, label: string, def: number, description: string, min = 0, max = 100): NumberParam => num(key, label, "%", min, max, def, description);
export const pixels = (key: string, label: string, min: number, max: number, def: number, description: string): NumberParam => num(key, label, "px", min, max, def, description, 0.5, 1);
export const degrees = (key: string, label: string, def: number, description: string): NumberParam => num(key, label, "°", -180, 180, def, description);
export const colour = (key: string, label: string, def: string, description: string): ColourParam => ({ kind: "colour", key, label, default: def, description });
export const choice = (key: string, label: string, options: [string, string][], def: string, description: string, radio = options.length <= 3): ChoiceParam => ({ kind: "choice", key, label, options: options.map(([value, label]) => ({ value, label })), radio, default: def, description });
export const boolean = (key: string, label: string, def: boolean, description: string): BooleanParam => ({ kind: "boolean", key, label, default: def, description });
export const gradient = (key: string, label: string, def: Gradient, description: string): GradientParam => ({ kind: "gradient", key, label, default: def, description });
export const point = (key: string, label: string, description: string): PointParam => ({ kind: "point", key, label, default: null, nullable: true, handle: false, description });
export const seed = (description = "Which random pattern: another number, another one."): NumberParam => num("seed", "Seed", "", 0, 9999, 1, description);

/** A size as a fraction of the canvas's diagonal, in half pixels within [min, max]: presets look the same on any canvas. */
export const diag = (fraction: number, { width, height }: { width: number; height: number }, min = 0.5, max = 10_000) => Math.max(min, Math.min(max, Math.round(fraction * Math.hypot(width, height) * 2) / 2));

/** A preset of fixed values (sizes given by `sized` for the canvas). */
export const look = (id: string, label: string, description: string, values: Record<string, EffectParamValue>, sized: (canvas: { width: number; height: number }) => Record<string, EffectParamValue> = () => ({})): EffectPreset => ({
  id,
  label,
  description,
  params: (canvas) => ({ ...structuredClone(values), ...sized(canvas) }),
});

export const n = (params: Record<string, EffectParamValue>, key: string) => params[key] as number;
