import { create } from "zustand";
import { LIVE_LOOKS, liveLook } from "@shared/live-looks";

/**
 * When the visualizer changes looks by itself: never, following the music (looks that suit it, changed on songs,
 * drops and breakdowns: `chooser.ts`), or every beat or so many bars (`beats` apart), each a look that suits the music.
 */
export type AutoSwitch = "off" | "song" | "beat" | "bars1" | "bars2" | "bars4" | "bars8" | "bars16" | "bars32";

export const AUTO_SWITCHES: { id: AutoSwitch; label: string; beats?: number }[] = [
  { id: "off", label: "Stay on this look" },
  { id: "song", label: "Follow the music" },
  { id: "beat", label: "Every beat", beats: 1 },
  { id: "bars1", label: "Every bar", beats: 4 },
  { id: "bars2", label: "Every 2 bars", beats: 8 },
  { id: "bars4", label: "Every 4 bars", beats: 16 },
  { id: "bars8", label: "Every 8 bars", beats: 32 },
  { id: "bars16", label: "Every 16 bars", beats: 64 },
  { id: "bars32", label: "Every 32 bars", beats: 128 },
];
/** Switching this often (in beats) or more, a look cuts in on the beat: there's no time for a transition. */
export const CUT_BEATS = 4;

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
  /**
   * A look asked for from outside the visualizer (the assistant): it shows it (`n` counts the asks), or rolls chaos
   * or mutates it (`roll`, as = and - do).
   */
  requested: { look: string; n: number; roll?: "chaos" | "mutate" } | null;
  setLook(look: string): void;
  request(look: string): void;
  requestRoll(roll: "chaos" | "mutate"): void;
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
  requestRoll(roll) {
    set((s) => {
      // Chaos is another recipe's look, kept as the look: a visualizer opening for it starts on it.
      const pool = LIVE_LOOKS.filter((l) => l.kind === "chaos" && l.id !== s.look);
      const look = roll === "chaos" ? pool[Math.floor(Math.random() * pool.length)].id : s.look;
      localStorage.setItem(LOOK_KEY, look);
      return { look, requested: { look, n: (s.requested?.n ?? 0) + 1, roll } };
    });
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
