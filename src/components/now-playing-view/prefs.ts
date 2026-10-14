import { create } from "zustand";
import { LIVE_LOOKS, liveLook } from "@shared/live-looks";

/** When the visualizer changes looks by itself: never, with each song, or every so many bars (and with each song). */
export type AutoSwitch = "off" | "song" | "bars8" | "bars16" | "bars32";

export const AUTO_SWITCHES: { id: AutoSwitch; label: string; bars?: number }[] = [
  { id: "off", label: "Stay on this look" },
  { id: "song", label: "A new look each song" },
  { id: "bars8", label: "Every 8 bars", bars: 8 },
  { id: "bars16", label: "Every 16 bars", bars: 16 },
  { id: "bars32", label: "Every 32 bars", bars: 32 },
];

/** How many pixels it draws: sharp (the screen's), balanced, or fast (for slower computers and big screens). */
export type Quality = "sharp" | "balanced" | "fast";

export const QUALITIES: { id: Quality; label: string; scale: number }[] = [
  { id: "sharp", label: "Sharp", scale: 1 },
  { id: "balanced", label: "Balanced", scale: 0.66 },
  { id: "fast", label: "Fast", scale: 0.45 },
];

const LOOK_KEY = "editor-visualizer-look";
const AUTO_KEY = "editor-visualizer-auto";
const QUALITY_KEY = "editor-visualizer-quality";

interface VisualizerPrefs {
  look: string;
  auto: AutoSwitch;
  quality: Quality;
  /** A look asked for from outside the visualizer (the assistant): it shows it (`n` counts the asks). */
  requested: { look: string; n: number } | null;
  setLook(look: string): void;
  request(look: string): void;
  setAuto(auto: AutoSwitch): void;
  setQuality(quality: Quality): void;
}

const stored = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  const v = localStorage.getItem(key);
  return allowed.includes(v as T) ? (v as T) : fallback;
};

/** The visualizer's choices, kept in this browser. */
export const useVisualizerPrefs = create<VisualizerPrefs>((set) => ({
  look: liveLook(localStorage.getItem(LOOK_KEY) ?? "")?.id ?? LIVE_LOOKS[0].id,
  auto: stored(AUTO_KEY, AUTO_SWITCHES.map((a) => a.id), "song"),
  quality: stored(QUALITY_KEY, QUALITIES.map((q) => q.id), "balanced"),
  requested: null,
  setLook(look) {
    localStorage.setItem(LOOK_KEY, look);
    set({ look });
  },
  request(look) {
    localStorage.setItem(LOOK_KEY, look);
    set((s) => ({ look, requested: { look, n: (s.requested?.n ?? 0) + 1 } }));
  },
  setAuto(auto) {
    localStorage.setItem(AUTO_KEY, auto);
    set({ auto });
  },
  setQuality(quality) {
    localStorage.setItem(QUALITY_KEY, quality);
    set({ quality });
  },
}));
