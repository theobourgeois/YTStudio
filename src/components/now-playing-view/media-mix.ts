/**
 * How the user's clips and pictures go into MilkDrop's looks (docs/now-playing.md, "Your media"; drawn by
 * `media-feed.ts`): twice a frame, on top so it's plainly there (the dancer, the face: `show`), and into the feedback
 * (`base`, `kick`), so the preset's own motion streams trails off it. Which of it (all of it, only its light, only its
 * edges), how much, where, and which clip, by the music; more on each kick, so it punches in on the beat. A clip on a
 * flat background (white, black, a colour: `backdropOf`) has it taken out; one of the frame's shape fills it (footage
 * only its light or edges on top: the look shows through its darks), one of another floats in the middle at its own
 * shape, its edges fading. Calm, steadier; intense,
 * its light and edges more, flashing in on kicks.
 * Pure, and tested.
 */
import type { Mood } from "@shared/signals/mood";
import { isSlow } from "@shared/signals/mood";

/** Which of the clip goes in: all of it, its light (the dark parts left to the preset), or its edges (as light). */
export type MediaMode = "whole" | "light" | "edges";

export interface MediaMix {
  mode: MediaMode;
  /** How much of it shows on top (0..1), between kicks, and more at the top of one. */
  show: number;
  showKick: number;
  /** Of the clip painted into the feedback in a 60th of a second, between kicks. */
  base: number;
  /** More at the top of a kick (its hit, falling away). */
  kick: number;
  /** The brightness (or, for edges, the edge's strength) let through: none under the first, all over the second. */
  key: [number, number];
  /** Footage filling the frame: into its middle (1: as it fills it). */
  zoom: number;
  /** A clip floating in the look (on a flat background, or not the frame's shape): its height, of the frame's. */
  size: number;
  /** Its colours made this much richer (1: as they are). */
  saturation: number;
}

/** Under this intensity it's calm, over the other intense. */
const CALM = 0.35;
const INTENSE = 0.7;
/** Richer colours, as Théo likes them (docs/now-playing.md, Your taste). */
const SATURATION = 1.3;

/** Each mode's share, by the moment: all of the clip most, its light and outlines more as it gets intense. */
const MODES: Record<"calm" | "groove" | "intense", [MediaMode, number][]> = {
  calm: [
    ["whole", 0.7],
    ["light", 0.3],
  ],
  groove: [
    ["whole", 0.55],
    ["light", 0.25],
    ["edges", 0.2],
  ],
  intense: [
    ["whole", 0.35],
    ["light", 0.3],
    ["edges", 0.35],
  ],
};

/**
 * How much shows on top and goes into the feedback a frame, between kicks and on one: on top, plainly there (a preset
 * warps all of its buffer every frame: what's only in the feedback is soon unrecognisable); into it, enough for trails
 * to stream off it. Calm steadier; intense more on the kicks.
 */
const AMOUNTS: Record<"calm" | "groove" | "intense", { show: number; showKick: number; base: number; kick: number }> = {
  calm: { show: 0.8, showKick: 0.1, base: 0.15, kick: 0.1 },
  groove: { show: 0.7, showKick: 0.25, base: 0.14, kick: 0.2 },
  intense: { show: 0.55, showKick: 0.4, base: 0.12, kick: 0.3 },
};

/**
 * A screen or a window (FL Studio, docs/now-playing.md "Your screen"): mostly all of it, so it's read as itself (its
 * panels, the notes, the playhead), less on top than a clip (it fills the frame: the look shows through it), flashing
 * up on the kicks; its light and outlines more as it gets intense.
 */
const SCREEN_MODES: typeof MODES = {
  calm: [
    ["whole", 0.8],
    ["light", 0.2],
  ],
  groove: [
    ["whole", 0.6],
    ["light", 0.25],
    ["edges", 0.15],
  ],
  intense: [
    ["whole", 0.45],
    ["light", 0.25],
    ["edges", 0.3],
  ],
};
const SCREEN_AMOUNTS: typeof AMOUNTS = {
  calm: { show: 0.6, showKick: 0.15, base: 0.12, kick: 0.1 },
  groove: { show: 0.5, showKick: 0.3, base: 0.12, kick: 0.18 },
  intense: { show: 0.4, showKick: 0.45, base: 0.1, kick: 0.25 },
};

const momentOf = (mood: Pick<Mood, "intensity" | "slow">) => (isSlow(mood) || mood.intensity < CALM ? "calm" : mood.intensity >= INTENSE ? "intense" : "groove");

/**
 * How the clip goes in while a look shows, for the moment it's shown at (`random`: the look's own); a screen (`of`)
 * shown whole, not zoomed into.
 */
export function mixFor(mood: Pick<Mood, "intensity" | "slow">, random: () => number, of: "clip" | "screen" = "clip"): MediaMix {
  const moment = momentOf(mood);
  const modes = (of === "screen" ? SCREEN_MODES : MODES)[moment];
  let left = random();
  let mode: MediaMode = modes[0][0];
  for (const [m, share] of modes) {
    mode = m;
    if ((left -= share) <= 0) break;
  }
  const { show, showKick, base, kick } = (of === "screen" ? SCREEN_AMOUNTS : AMOUNTS)[moment];
  // Edges are thin: more of them a frame.
  const scale = mode === "edges" ? 1.4 : 1;
  return {
    mode,
    show,
    showKick,
    base: base * scale,
    kick: kick * scale,
    key: mode === "edges" ? [0.12, 0.55] : mode === "light" ? [0.25, 0.65] : [0, 0],
    zoom: of === "screen" ? 1 : Math.round((1 + random() * 0.2) * 100) / 100,
    size: of === "screen" ? 1 : Math.round((0.62 + random() * 0.23) * 100) / 100,
    saturation: SATURATION,
  };
}

/** How much of the clip shows on top, `hit` into a kick (0..1). */
export const shownAt = (mix: MediaMix, hit: number) => Math.min(1, mix.show + mix.showKick * Math.max(0, Math.min(1, hit)));

/** How much of the clip goes in over `seconds` (Butterchurn's frame), `hit` into a kick: the same at any frame rate. */
export function amountOver(mix: MediaMix, hit: number, seconds: number): number {
  const perFrame = Math.min(0.9, mix.base + mix.kick * Math.max(0, Math.min(1, hit)));
  return 1 - (1 - perFrame) ** Math.max(0, seconds * 60);
}

/**
 * Over a screen shared (docs/now-playing.md, "Your screen"), the clips come in now and then: for a few bars, then gone
 * for a few, each time another. In bars (`VISIT_BARS`, `AWAY_BARS`: from, to), more often as the music gets intense.
 */
const VISIT_BARS = [2, 4] as const;
const AWAY_BARS = { calm: [6, 10], intense: [3, 6] } as const;
/** A visit fades in and out over this long (seconds), so a clip never cuts in over the screen. */
const VISIT_FADE = 0.8;

/** A clip's visit over a screen: from when, until when (seconds, the picture's clock). */
export interface Visit {
  from: number;
  until: number;
}

/** The next visit, after `now`: a while away, then a few bars long (`bar`: a bar's seconds), by the music's intensity. */
export function nextVisit(now: number, bar: number, intensity: number, random: () => number): Visit {
  const t = Math.max(0, Math.min(1, (intensity - CALM) / (INTENSE - CALM)));
  const between = (lo: number, hi: number) => lo + (hi - lo) * random();
  const away = between(AWAY_BARS.calm[0] + (AWAY_BARS.intense[0] - AWAY_BARS.calm[0]) * t, AWAY_BARS.calm[1] + (AWAY_BARS.intense[1] - AWAY_BARS.calm[1]) * t);
  const from = now + Math.round(away) * bar;
  return { from, until: from + Math.round(between(VISIT_BARS[0], VISIT_BARS[1])) * bar };
}

/** How much of the clip shows at `time` of its visit (0..1): faded in at its start, out by its end. */
export function visitFade(visit: Visit, time: number): number {
  if (time <= visit.from || time >= visit.until) return 0;
  return Math.min(1, (time - visit.from) / VISIT_FADE, (visit.until - time) / VISIT_FADE);
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

/**
 * A clip's background: its colour (0..1), the share of its edge that's that colour, and whether it's flat (most of it),
 * so it can be taken out.
 */
export interface Backdrop {
  color: [number, number, number];
  share: number;
  flat: boolean;
  /** How light the whole frame is (0..1): a pale clip whose background can't be taken out washes a look out. */
  light: number;
}

/** Lighter than this on average, a clip is pale. */
export const PALE = 0.6;

/**
 * How close (RGB, 0..1 a channel) a pixel of the edge must be to its middle colour to count as the background (a pale
 * background is rarely one colour: a soft gradient, compression's noise).
 */
const NEAR = 0.22;
/**
 * The share of the edge that must be the background for it to be flat (dancers cross it; footage's edge is a fifth or so),
 * and, once it's been, how little it may fall to before it isn't (no flicker as the clip moves).
 */
export const FLAT_SHARE = 0.5;
export const STILL_FLAT = 0.35;

/**
 * A clip's background, from a small picture of a frame (RGBA, `width` × `height`): the colour of its edge (two pixels
 * deep, the median of each channel), and whether it's flat: most of the edge near that colour (a white or black or
 * coloured background; footage's edge isn't), or still most if it was (`was`).
 */
export function backdropOf(data: ArrayLike<number>, width: number, height: number, was: Backdrop | null = null): Backdrop {
  const edge: [number, number, number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x > 1 && y > 1 && x < width - 2 && y < height - 2) continue;
      const i = (y * width + x) * 4;
      edge.push([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255]);
    }
  }
  if (!edge.length) return { color: [0, 0, 0], share: 0, flat: false, light: 0 };
  let light = 0;
  for (let i = 0; i < width * height * 4; i += 4) light += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  light /= width * height;
  const median = (k: 0 | 1 | 2) => [...edge.map((c) => c[k])].sort((a, b) => a - b)[Math.floor(edge.length / 2)];
  const color: [number, number, number] = [median(0), median(1), median(2)];
  const share = edge.filter((c) => Math.hypot(c[0] - color[0], c[1] - color[1], c[2] - color[2]) <= NEAR).length / edge.length;
  return { color, share, flat: share >= (was?.flat ? STILL_FLAT : FLAT_SHARE), light };
}

/**
 * Where a clip goes: filling the frame (one of about its shape, its background taken out or not: floated, a 16:9 clip
 * read as a box in the middle, Théo found), or floating at its own shape in the middle, its edges fading (a square or
 * tall clip filling the frame would be cut and blown up). `aspect`s are width over height.
 */
export function placementOf(aspect: number, frameAspect: number): "fill" | "float" {
  return Math.abs(Math.log(aspect / frameAspect)) > 0.25 ? "float" : "fill";
}

/** A clip floating in the frame: its rectangle's width and height, as shares of the frame's, `height` tall at most. */
export function floatSize(aspect: number, frameAspect: number, height: number): [number, number] {
  const width = (height * aspect) / frameAspect;
  return width > 0.92 ? [0.92, (height * 0.92) / width] : [width, height];
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
