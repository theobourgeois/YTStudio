/**
 * The Background Eraser's options (docs/photo/tools/background-eraser.md), Photoshop's options bar: its own brush,
 * Sampling, Limits, Tolerance and Protect Foreground Color, kept in this browser across photos.
 */
import { create } from "zustand";
import { type BackgroundEraserOptions, ERASER_DEFAULTS, type EraseLimits, type EraseSampling } from "@shared/photo/background-eraser";
import { MAX_BRUSH, MIN_BRUSH } from "../brush-options";

const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
const KEY = "photo-background-eraser";

export interface EraserToolOptions extends BackgroundEraserOptions {
  size: number;
  hardness: number;
}

/** Photoshop's defaults: Continuous, Contiguous, 50%, a hard brush. */
export const ERASER_TOOL_DEFAULTS: EraserToolOptions = { ...ERASER_DEFAULTS, size: 100, hardness: 1 };

export const SAMPLINGS: readonly EraseSampling[] = ["continuous", "once", "swatch"];
export const LIMITS: readonly EraseLimits[] = ["discontiguous", "contiguous", "edges"];

export function sanitizeEraser(o: Partial<Record<keyof EraserToolOptions, unknown>>): EraserToolOptions {
  const d = ERASER_TOOL_DEFAULTS;
  const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback);
  return {
    size: Math.round(num(o.size, MIN_BRUSH, MAX_BRUSH, d.size)),
    hardness: num(o.hardness, 0, 1, d.hardness),
    sampling: SAMPLINGS.includes(o.sampling as EraseSampling) ? (o.sampling as EraseSampling) : d.sampling,
    limits: LIMITS.includes(o.limits as EraseLimits) ? (o.limits as EraseLimits) : d.limits,
    tolerance: Math.round(num(o.tolerance, 0, 100, d.tolerance)),
    protectForeground: typeof o.protectForeground === "boolean" ? o.protectForeground : d.protectForeground,
  };
}

function load(): EraserToolOptions {
  try {
    return sanitizeEraser(JSON.parse(storage.getItem(KEY) ?? "{}"));
  } catch {
    return ERASER_TOOL_DEFAULTS;
  }
}

export const useEraserOptions = create<EraserToolOptions & { set: (patch: Partial<EraserToolOptions>) => void }>((set, get) => ({
  ...load(),
  set: (patch) => {
    const next = sanitizeEraser({ ...get(), ...patch });
    storage.setItem(KEY, JSON.stringify(next));
    set(next);
  },
}));
