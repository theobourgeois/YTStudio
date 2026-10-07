/**
 * The Gradient tool's options (its options bar: docs/photo/tools/gradient.md), kept in this browser as Photoshop
 * keeps them across documents, and the pure helpers that turn them into what a drag makes: the gradient (Foreground
 * to Background and Foreground to Transparent follow the colour swatches), a new Gradient Fill's parameters, a Classic
 * gradient's paint.
 */
import { create } from "zustand";
import { isBlendMode } from "@shared/photo/blending";
import { type GradientType, isGradientType } from "@shared/photo/effects/gradient";
import type { GradientPaint, GradientPaintMode } from "@shared/photo/reference/gradient";
import { GRADIENT_PRESETS, sanitizeGradient } from "@shared/photo/style/gradients";
import type { Compositing, DocPoint, EffectParamValue, Gradient } from "@shared/photo/types";
import type { Colours } from "../colours";

const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
const KEY = "photo-gradient-tool";

/** Gradient: a drag makes a Gradient Fill layer (live); Classic gradient paints the active layer's pixels or mask. */
export type GradientToolMode = "live" | "classic";

/** The presets made from the colour swatches (Photoshop's Basics), which follow them. */
export type SwatchPreset = "foreground-background" | "foreground-transparent";

export const SWATCH_PRESET_NAMES: Record<SwatchPreset, string> = { "foreground-background": "Foreground to Background", "foreground-transparent": "Foreground to Transparent" };

export interface GradientOptions {
  mode: GradientToolMode;
  style: GradientType;
  /** The gradient follows the swatches (a Basics preset), or is `gradient` (null). */
  swatches: SwatchPreset | null;
  /** The gradient picked or edited, when it isn't the swatches'. */
  gradient: Gradient;
  /** How it mixes between stops (Photoshop's options bar Method; the gradient's own is replaced by it). */
  method: Gradient["method"];
  reverse: boolean;
  dither: boolean;
  /** Classic's: how it goes onto what's there, and how much (0..1). */
  paintMode: GradientPaintMode;
  opacity: number;
  /** Classic's Transparency: off, the gradient's opacity stops are ignored (it's opaque). */
  transparency: boolean;
}

export const GRADIENT_TOOL_DEFAULTS: GradientOptions = {
  mode: "live",
  style: "linear",
  swatches: "foreground-background",
  gradient: GRADIENT_PRESETS[0],
  method: "perceptual",
  reverse: false,
  dither: true,
  paintMode: "normal",
  opacity: 1,
  transparency: true,
};

const METHODS: readonly Gradient["method"][] = ["perceptual", "linear", "classic", "smooth", "stripes"];

/** Options checked (from this browser's storage, or a patch): a bad one at its default. */
export function sanitizeGradientOptions(o: Partial<Record<keyof GradientOptions, unknown>>): GradientOptions {
  const d = GRADIENT_TOOL_DEFAULTS;
  return {
    mode: o.mode === "classic" || o.mode === "live" ? o.mode : d.mode,
    style: isGradientType(o.style) ? o.style : d.style,
    swatches: o.swatches === null || o.swatches === "foreground-background" || o.swatches === "foreground-transparent" ? o.swatches : d.swatches,
    gradient: o.gradient === undefined ? d.gradient : sanitizeGradient(o.gradient).value,
    method: METHODS.includes(o.method as Gradient["method"]) ? (o.method as Gradient["method"]) : d.method,
    reverse: typeof o.reverse === "boolean" ? o.reverse : d.reverse,
    dither: typeof o.dither === "boolean" ? o.dither : d.dither,
    paintMode: o.paintMode === "behind" || o.paintMode === "clear" || isBlendMode(o.paintMode) ? o.paintMode : d.paintMode,
    opacity: typeof o.opacity === "number" && Number.isFinite(o.opacity) ? Math.max(0, Math.min(1, o.opacity)) : d.opacity,
    transparency: typeof o.transparency === "boolean" ? o.transparency : d.transparency,
  };
}

/** A Basics preset made from the swatches now. */
export function swatchGradient(preset: SwatchPreset, colours: Colours): Gradient {
  const name = SWATCH_PRESET_NAMES[preset];
  if (preset === "foreground-background")
    return {
      name,
      method: "perceptual",
      colours: [
        { at: 0, colour: colours.foreground },
        { at: 1, colour: colours.background },
      ],
      opacities: [
        { at: 0, opacity: 1 },
        { at: 1, opacity: 1 },
      ],
    };
  return {
    name,
    method: "perceptual",
    colours: [
      { at: 0, colour: colours.foreground },
      { at: 1, colour: colours.foreground },
    ],
    opacities: [
      { at: 0, opacity: 1 },
      { at: 1, opacity: 0 },
    ],
  };
}

/** The picker's presets: Photoshop's Basics (the swatches', then Black, White), then the stock gradients. */
export function toolPresets(colours: Colours): Gradient[] {
  return [swatchGradient("foreground-background", colours), swatchGradient("foreground-transparent", colours), ...GRADIENT_PRESETS];
}

/** The gradient a drag uses: the swatches' or the one picked, with the options' Method. */
export function toolGradient(o: GradientOptions, colours: Colours): Gradient {
  const g = o.swatches ? swatchGradient(o.swatches, colours) : o.gradient;
  return g.method === o.method ? g : { ...g, method: o.method };
}

/**
 * The options after the picker chose or edited a gradient: a Basics preset follows the swatches again; any other
 * (an edit is named "Custom") is kept as it is, its method becoming the options'.
 */
export function pickGradient(o: GradientOptions, picked: Gradient): GradientOptions {
  const swatches = (Object.keys(SWATCH_PRESET_NAMES) as SwatchPreset[]).find((k) => SWATCH_PRESET_NAMES[k] === picked.name) ?? null;
  return { ...o, swatches, gradient: swatches ? o.gradient : picked, method: picked.method };
}

/** A new Gradient Fill's parameters for a drag from `start` to `end`. */
export function liveParams(o: GradientOptions, colours: Colours, start: DocPoint, end: DocPoint): Record<string, EffectParamValue> {
  return { gradient: toolGradient(o, colours), style: o.style, start, end, reverse: o.reverse, dither: o.dither };
}

/** The gradient Classic paints: Transparency off ignores its opacity stops. */
export function classicGradient(o: GradientOptions, colours: Colours): Gradient {
  const g = toolGradient(o, colours);
  return o.transparency
    ? g
    : {
        ...g,
        opacities: [
          { at: 0, opacity: 1 },
          { at: 1, opacity: 1 },
        ],
      };
}

/** Classic's paint: the options' mode and opacity, mixed as the photo mixes. */
export const classicPaint = (o: GradientOptions, compositing: Compositing): GradientPaint => ({ mode: o.paintMode, opacity: o.opacity, compositing });

interface GradientOptionsStore extends GradientOptions {
  set: (patch: Partial<GradientOptions>) => void;
}

function load(): GradientOptions {
  try {
    return sanitizeGradientOptions({ ...GRADIENT_TOOL_DEFAULTS, ...(JSON.parse(storage.getItem(KEY) ?? "{}") as Partial<GradientOptions>) });
  } catch {
    return GRADIENT_TOOL_DEFAULTS;
  }
}

export const useGradientOptions = create<GradientOptionsStore>((set, get) => ({
  ...load(),
  set: (patch) => {
    const { set: _, ...now } = get();
    const next = sanitizeGradientOptions({ ...now, ...patch });
    storage.setItem(KEY, JSON.stringify(next));
    set(next);
  },
}));
