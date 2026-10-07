/**
 * The Paint Bucket's and the Magic Eraser's options (Photoshop's options bar: docs/photo/tools/paint-bucket.md,
 * magic-eraser.md), kept in this browser across photos as the brush's are. Their defaults are Photoshop's.
 */
import { create } from "zustand";
import { type FillMode, isFillMode } from "@shared/photo/fill-compose";
import { DEFAULT_PATTERN } from "@shared/photo/style/patterns";

const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };

export interface BucketOptions {
  /** What's filled: the foreground colour, or a pattern. */
  source: "foreground" | "pattern";
  /** The pattern: a built-in one's id or the photo's own. */
  pattern: string;
  mode: FillMode;
  /** 0..1. */
  opacity: number;
  /** 0..255. */
  tolerance: number;
  antiAlias: boolean;
  contiguous: boolean;
  /** Decide by the photo as it shows (else the active layer alone). */
  allLayers: boolean;
}

export interface MagicEraserOptions {
  tolerance: number;
  antiAlias: boolean;
  contiguous: boolean;
  /** Decide by the photo as it shows (else the active layer alone). */
  sampleAll: boolean;
  /** 0..1: how much is erased. */
  opacity: number;
  /** Unmix the edge from the colour clicked (ours: no rim of the old background). */
  defringe: boolean;
}

export const BUCKET_DEFAULTS: BucketOptions = { source: "foreground", pattern: DEFAULT_PATTERN, mode: "normal", opacity: 1, tolerance: 32, antiAlias: true, contiguous: true, allLayers: false };

export const ERASER_DEFAULTS: MagicEraserOptions = { tolerance: 32, antiAlias: true, contiguous: true, sampleAll: false, opacity: 1, defringe: true };

const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

export function sanitizeBucket(o: Partial<Record<keyof BucketOptions, unknown>>): BucketOptions {
  const d = BUCKET_DEFAULTS;
  return {
    source: o.source === "pattern" ? "pattern" : "foreground",
    pattern: typeof o.pattern === "string" && o.pattern ? o.pattern : d.pattern,
    mode: isFillMode(o.mode) ? o.mode : d.mode,
    opacity: num(o.opacity, 0.01, 1, d.opacity),
    tolerance: Math.round(num(o.tolerance, 0, 255, d.tolerance)),
    antiAlias: bool(o.antiAlias, d.antiAlias),
    contiguous: bool(o.contiguous, d.contiguous),
    allLayers: bool(o.allLayers, d.allLayers),
  };
}

export function sanitizeEraser(o: Partial<Record<keyof MagicEraserOptions, unknown>>): MagicEraserOptions {
  const d = ERASER_DEFAULTS;
  return {
    tolerance: Math.round(num(o.tolerance, 0, 255, d.tolerance)),
    antiAlias: bool(o.antiAlias, d.antiAlias),
    contiguous: bool(o.contiguous, d.contiguous),
    sampleAll: bool(o.sampleAll, d.sampleAll),
    opacity: num(o.opacity, 0.01, 1, d.opacity),
    defringe: bool(o.defringe, d.defringe),
  };
}

function kept<T>(key: string, sanitize: (o: Partial<Record<keyof T, unknown>>) => T) {
  const load = (): T => {
    try {
      return sanitize(JSON.parse(storage.getItem(key) ?? "{}"));
    } catch {
      return sanitize({});
    }
  };
  return create<T & { set: (patch: Partial<T>) => void }>((set, get) => ({
    ...load(),
    set: (patch) => {
      const next = sanitize({ ...get(), ...patch });
      storage.setItem(key, JSON.stringify(next));
      set(next as Partial<T & { set: (patch: Partial<T>) => void }>);
    },
  }));
}

export const useBucketOptions = kept<BucketOptions>("photo-bucket", sanitizeBucket);
export const useMagicEraserOptions = kept<MagicEraserOptions>("photo-magic-eraser", sanitizeEraser);
