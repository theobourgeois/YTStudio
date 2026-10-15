import { create } from "zustand";
import { type Frame, LIVE_LOOKS, type LiveFx, NO_FX, liveLook, normalizeFx } from "@shared/live-looks";
import { EFFECTS_MODES, type EffectsMode } from "./effects-engine";

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
const FX_KEY = "editor-visualizer-fx";
const EFFECTS_KEY = "editor-visualizer-effects";

interface VisualizerPrefs {
  look: string;
  auto: AutoSwitch;
  quality: Quality;
  /** The player's distortions and feedback over every look, by hand (the D panel, Q W E). */
  fx: LiveFx;
  /** Who plays the effects over the looks: the engine (following the music, every beat or bar), or you (by hand). */
  effects: EffectsMode;
  /**
   * A look asked for from outside the visualizer (the assistant): it shows it (`n` counts the asks), or rolls chaos
   * or mutates it (`roll`, as = and - do).
   */
  requested: { look: string; n: number; roll?: "chaos" | "mutate"; frame?: Partial<Frame> | "reset" } | null;
  setLook(look: string): void;
  request(look: string): void;
  requestRoll(roll: "chaos" | "mutate"): void;
  /** Reframe the picture (some of a frame, over what it is), or back as it was. */
  requestFrame(frame: Partial<Frame> | "reset"): void;
  setAuto(auto: AutoSwitch): void;
  setQuality(quality: Quality): void;
  /** Some of the player's values changed (the rest kept), or all back as they were (`"wash"`). */
  setFx(fx: Partial<LiveFx> | "wash"): void;
  setEffects(mode: EffectsMode): void;
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
  effects: stored(EFFECTS_KEY, EFFECTS_MODES.map((m) => m.id), "music"),
  fx: (() => {
    try {
      return normalizeFx(JSON.parse(localStorage.getItem(FX_KEY) ?? "null"));
    } catch {
      return NO_FX;
    }
  })(),
  requested: null,
  setLook(look) {
    localStorage.setItem(LOOK_KEY, look);
    set({ look });
  },
  request(look) {
    localStorage.setItem(LOOK_KEY, look);
    set((s) => ({ look, requested: { look, n: (s.requested?.n ?? 0) + 1 } }));
  },
  requestFrame(frame) {
    set((s) => ({ requested: { look: s.look, n: (s.requested?.n ?? 0) + 1, frame } }));
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
  setFx(change) {
    set((s) => {
      const fx = change === "wash" ? NO_FX : normalizeFx({ ...s.fx, ...change });
      localStorage.setItem(FX_KEY, JSON.stringify(fx));
      return { fx };
    });
  },
  setEffects(effects) {
    localStorage.setItem(EFFECTS_KEY, effects);
    set({ effects });
  },
  setQuality(quality) {
    localStorage.setItem(QUALITY_KEY, quality);
    set({ quality });
  },
}));
