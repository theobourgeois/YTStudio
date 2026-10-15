/**
 * How the user's clips and pictures go into MilkDrop's feedback (docs/now-playing.md, "Your media"; drawn by
 * `media-feed.ts`): which of each (all of it, only its light, only its edges), how much a frame, and which clip, by the
 * music. A little goes in all the time and more on each kick, so the clip pulses into the preset's motion on the beat
 * rather than sitting in it; calm, more of it, steadily; intense, only its light and edges, flashing in on kicks (all of
 * a clip's mid-tones fed in turn a look muddy, which Théo bins).
 * Pure, and tested.
 */
import type { Mood } from "@shared/signals/mood";
import { isSlow } from "@shared/signals/mood";

/** Which of the clip goes in: all of it, its light (the dark parts left to the preset), or its edges (as light). */
export type MediaMode = "whole" | "light" | "edges";

export interface MediaMix {
  mode: MediaMode;
  /** Of the clip painted in a 60th of a second, between kicks. */
  base: number;
  /** More at the top of a kick (its hit, falling away). */
  kick: number;
  /** The brightness (or, for edges, the edge's strength) let through: none under the first, all over the second. */
  key: [number, number];
  /** Into the clip's middle (1: filling the frame). */
  zoom: number;
  /** Its colours made this much richer (1: as they are). */
  saturation: number;
}

/** Under this intensity it's calm, over the other intense. */
const CALM = 0.35;
const INTENSE = 0.7;
/** Richer colours, as Théo likes them (docs/now-playing.md, Your taste). */
const SATURATION = 1.3;

/** Each mode's share, by the moment: calm lets more of the clip in, intense mostly its light and its outlines. */
const MODES: Record<"calm" | "groove" | "intense", [MediaMode, number][]> = {
  calm: [
    ["whole", 0.25],
    ["light", 0.75],
  ],
  groove: [
    ["whole", 0.1],
    ["light", 0.65],
    ["edges", 0.25],
  ],
  intense: [
    ["light", 0.55],
    ["edges", 0.45],
  ],
};

/** How much a frame, between kicks and on one, by the moment: calm steadier, intense mostly on the kicks. */
const AMOUNTS: Record<"calm" | "groove" | "intense", { base: number; kick: number }> = {
  calm: { base: 0.025, kick: 0.025 },
  groove: { base: 0.015, kick: 0.06 },
  intense: { base: 0.01, kick: 0.1 },
};

const momentOf = (mood: Pick<Mood, "intensity" | "slow">) => (isSlow(mood) || mood.intensity < CALM ? "calm" : mood.intensity >= INTENSE ? "intense" : "groove");

/** How the clip goes in while a look shows, for the moment it's shown at (`random`: the look's own). */
export function mixFor(mood: Pick<Mood, "intensity" | "slow">, random: () => number): MediaMix {
  const moment = momentOf(mood);
  let left = random();
  let mode: MediaMode = MODES[moment][0][0];
  for (const [m, share] of MODES[moment]) {
    mode = m;
    if ((left -= share) <= 0) break;
  }
  const { base, kick } = AMOUNTS[moment];
  // Whole, less of it a frame (it's all of it); edges, more (they're thin).
  const scale = mode === "whole" ? 0.7 : mode === "edges" ? 1.6 : 1;
  return {
    mode,
    base: base * scale,
    kick: kick * scale,
    key: mode === "edges" ? [0.12, 0.55] : mode === "light" ? [0.3, 0.75] : [0, 0],
    zoom: Math.round((1 + random() * 0.25) * 100) / 100,
    saturation: SATURATION,
  };
}

/** How much of the clip goes in over `seconds` (Butterchurn's frame), `hit` into a kick: the same at any frame rate. */
export function amountOver(mix: MediaMix, hit: number, seconds: number): number {
  const perFrame = Math.min(0.9, mix.base + mix.kick * Math.max(0, Math.min(1, hit)));
  return 1 - (1 - perFrame) ** Math.max(0, seconds * 60);
}

/** How fast a kick's hit falls away (to a tenth in this many seconds). */
const KICK_FALLS = 0.25;

/** A kick's hit: up at once with each onset, falling away after. */
export class KickHit {
  private value = 0;

  /** The hit now, after `seconds`, with the kick onset heard since (0..1). */
  step(onset: number, seconds: number): number {
    this.value *= 0.1 ** (Math.max(0, seconds) / KICK_FALLS);
    this.value = Math.max(this.value, Math.max(0, Math.min(1, onset)));
    return this.value;
  }
}

/** A clip or picture of the user's, as it's picked from. */
export interface MediaChoice {
  id: string;
  kind: "video" | "image";
  /** Seconds long (a picture: 0). */
  duration: number;
}

/**
 * The clip for a look being shown: one not shown lately while there's another (`recent`, newest last), at random,
 * from a moment of it at random (not its first seconds or last, where clips fade). Null: there's none.
 */
export function pickMedia(media: readonly MediaChoice[], recent: readonly string[], random: () => number): { id: string; from: number } | null {
  if (!media.length) return null;
  const fresh = media.filter((m) => !recent.includes(m.id));
  const pool = fresh.length ? fresh : media.filter((m) => m.id !== recent.at(-1));
  const from = (pool.length ? pool : media)[Math.floor(random() * (pool.length ? pool : media).length)];
  const room = from.kind === "video" ? Math.max(0, from.duration - 2) : 0;
  return { id: from.id, from: room > 2 ? Math.round((1 + random() * (room - 1)) * 10) / 10 : 0 };
}
