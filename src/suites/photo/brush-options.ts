/**
 * The Brush's and the Eraser's options (Photoshop's options bar), kept in this browser as Photoshop keeps them
 * across documents. The colours are every tool's (`colours.ts`). Pure helpers turn them into what a stroke needs.
 */
import { create } from "zustand";
import type { BrushSettings } from "@shared/photo/brush";
import { srgbToLinear } from "@shared/photo/colour";

const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
const KEY = "photo-brush";

export const MIN_BRUSH = 1;
export const MAX_BRUSH = 5000;

export interface BrushOptions {
  /** Diameter in document pixels. */
  size: number;
  /** 0..1: Photoshop's Hardness. */
  hardness: number;
  /** 0..1: how much a dab covers at its centre (Photoshop's Opacity, for one dab: Flow waits for its equations). */
  strength: number;
}

const DEFAULTS: BrushOptions = { size: 60, hardness: 0.8, strength: 1 };

function load(): BrushOptions {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? "{}") as Partial<BrushOptions>;
    return sanitizeBrush({ ...DEFAULTS, ...raw });
  } catch {
    return DEFAULTS;
  }
}

const unit = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback);

export function sanitizeBrush(o: Partial<BrushOptions>): BrushOptions {
  const size = typeof o.size === "number" && Number.isFinite(o.size) ? Math.max(MIN_BRUSH, Math.min(MAX_BRUSH, Math.round(o.size))) : DEFAULTS.size;
  return { size, hardness: unit(o.hardness, DEFAULTS.hardness), strength: unit(o.strength, DEFAULTS.strength) };
}

interface BrushStore extends BrushOptions {
  set: (patch: Partial<BrushOptions>) => void;
}

export const useBrush = create<BrushStore>((set, get) => {
  const save = (patch: Partial<BrushOptions>) => {
    const { size, hardness, strength } = get();
    const next = sanitizeBrush({ size, hardness, strength, ...patch });
    storage.setItem(KEY, JSON.stringify(next));
    set(next);
  };
  return { ...load(), set: save };
});

/**
 * The next size for [ and ] (Photoshop's steps: finer when small): 1 px under 10, 10 under 100, 25 under 200, 50
 * under 300, 100 above.
 */
export function stepBrushSize(size: number, direction: 1 | -1): number {
  const step = (s: number) => (s < 10 ? 1 : s < 100 ? 10 : s < 200 ? 25 : s < 300 ? 50 : 100);
  const next = direction > 0 ? size + step(size) : size - step(size - 1);
  return Math.max(MIN_BRUSH, Math.min(MAX_BRUSH, next));
}

/** The stroke's geometry: dabs every tenth of a diameter (Photoshop's default Spacing). */
export const brushSettings = (o: Pick<BrushOptions, "size" | "hardness" | "strength">): BrushSettings => ({ radius: o.size / 2, hardness: o.hardness, strength: o.strength, spacing: 0.1 });

const channels = (colour: string) => [1, 3, 5].map((i) => Number.parseInt(colour.slice(i, i + 2), 16) / 255);

/** What a stroke paints, premultiplied linear light: the colour on pixels; on a mask its grey (as Photoshop's), in every channel. */
export function strokeColour(colour: string, target: "pixels" | "mask"): [number, number, number, number] {
  const [r, g, b] = channels(colour);
  if (target === "mask") {
    // A mask's value is its grey level as encoded (128 hides half), as Photoshop's 8-bit masks are.
    const grey = (299 * r + 587 * g + 114 * b) / 1000;
    return [grey, grey, grey, 1];
  }
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), 1];
}
