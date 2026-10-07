/**
 * The Eyedropper's options (Photoshop's options bar: docs/photo/tools/eyedropper.md), kept in this browser across
 * photos as the other tools' are. Every colour picker open in the photo editor samples the canvas through them too.
 */
import { create } from "zustand";
import { SAMPLE_SIZES } from "@shared/photo/magic-wand";

const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
const KEY = "photo-eyedropper";

export interface EyedropperOptions {
  /** The side of the square averaged, in document pixels (1: Point Sample). */
  sampleSize: number;
  /** Read the photo as it shows (Photoshop's All Layers), else the active layer alone (Current Layer). */
  sampleAll: boolean;
  /** Show the sampling ring (the new colour over the one it replaces) while the button is down. */
  ring: boolean;
}

/** Photoshop's: Point Sample, All Layers, the ring shown. */
export const EYEDROPPER_DEFAULTS: EyedropperOptions = { sampleSize: 1, sampleAll: true, ring: true };

export function sanitizeEyedropper(o: Partial<Record<keyof EyedropperOptions, unknown>>): EyedropperOptions {
  const d = EYEDROPPER_DEFAULTS;
  return {
    sampleSize: (SAMPLE_SIZES as readonly unknown[]).includes(o.sampleSize) ? (o.sampleSize as number) : d.sampleSize,
    sampleAll: typeof o.sampleAll === "boolean" ? o.sampleAll : d.sampleAll,
    ring: typeof o.ring === "boolean" ? o.ring : d.ring,
  };
}

function load(): EyedropperOptions {
  try {
    return sanitizeEyedropper(JSON.parse(storage.getItem(KEY) ?? "{}") as Partial<EyedropperOptions>);
  } catch {
    return EYEDROPPER_DEFAULTS;
  }
}

export const useEyedropperOptions = create<EyedropperOptions & { set: (patch: Partial<EyedropperOptions>) => void }>((set, get) => ({
  ...load(),
  set: (patch) => {
    const next = sanitizeEyedropper({ ...get(), ...patch });
    storage.setItem(KEY, JSON.stringify(next));
    set(next);
  },
}));
