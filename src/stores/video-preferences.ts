import { create } from "zustand";
import { MIN_CLIP_DURATION, STILL_DURATION } from "@shared/timeline";

const LAYER_DURATION_KEY = "editor-layer-duration";
/** The longest a new text, shape or layer can be made by default (Settings' field stops there). */
export const MAX_LAYER_DURATION = 600;

/** A stored length, if it's one Settings would have accepted. */
export function validLayerDuration(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= MIN_CLIP_DURATION && n <= MAX_LAYER_DURATION ? Math.round(n * 100) / 100 : null;
}

/**
 * The video editor's preferences that aren't the document's and aren't kept elsewhere (snapping and auto
 * ripple are the editor store's, the preview's resolution the layout's), kept in this browser and set in
 * Settings. Premiere's Still Image Default Duration is `layerDuration`.
 */
interface VideoPreferencesState {
  /** How long a new text, shape, solid or adjustment layer is, in seconds. */
  layerDuration: number;
  setLayerDuration: (seconds: number) => void;
}

export const useVideoPreferences = create<VideoPreferencesState>((set) => ({
  layerDuration: validLayerDuration(localStorage.getItem(LAYER_DURATION_KEY) ?? undefined) ?? STILL_DURATION,
  setLayerDuration(seconds) {
    const layerDuration = validLayerDuration(seconds);
    if (layerDuration === null) return;
    localStorage.setItem(LAYER_DURATION_KEY, String(layerDuration));
    set({ layerDuration });
  },
}));

/** How long a new text, shape or layer is (Settings, Video editor). */
export const newLayerDuration = () => useVideoPreferences.getState().layerDuration;
