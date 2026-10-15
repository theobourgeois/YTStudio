/**
 * The kit Now Playing's looks are made of (`live-looks.ts`, `live-chaos.ts`): the signals they follow, punches and
 * follows (as big as the music is intense), and layers of the editor's own effects: solids, drawings, adjustments,
 * the cover. Pure.
 */
import { defaultEffects, effectDefinition, sanitizeEffect, solidEffects } from "./effects.ts";
import { DEFAULT_RESPONSE } from "./links.ts";
import type { AlbumPalette } from "./palette.ts";
import type { NumberSpec } from "./params.ts";
import type { Effect, LinkDepth, ParamLink, ParamValues, SignalRef } from "./types.ts";

/** The song's cover, as an image a look can show (the view gives it as media: `coverAsset`). */
export const COVER_ASSET = "cover";

/** What a look is made for: a song's colours and a variation of its own. */
export interface LookContext {
  palette: AlbumPalette;
  /** 0..1, the same for the same song and look. */
  random: () => number;
  /** How many times it's been mutated (`-`), for a look that can be (chaos, `live-chaos.ts`). */
  mutations?: number;
  /** How fast it moves: 1 as made, less in slow motion (a slow song's: `SLOW_MOTION`, `inSlowMotion`). */
  pace?: number;
}

/** A layer of a look: its effects (with its Motion and Opacity), an adjustment layer or not. */
export interface LookLayer {
  effects: Effect[];
  adjustment?: true;
  assetId?: string;
}

/** A seeded random number generator: the same look for the same song (`seed` from its id). */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let s = h >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Signals are the mix's (what the computer plays).
export const KICK: SignalRef = { name: "onsetLow" };
export const SNARE: SignalRef = { name: "onsetMid" };
export const BASS: SignalRef = { name: "bass" };
export const LEVEL: SignalRef = { name: "level" };
export const DOWNBEAT: SignalRef = { name: "downbeat" };

/** How intense the music is (`mood.ts`): what a look's energy follows. */
export const INTENSITY: SignalRef = { name: "intensity" };
/** A reaction as big as the music is intense: `floor` of it when calm, none under `threshold`. */
export const intense = (floor = 0.2, threshold = 0): LinkDepth => ({ signal: INTENSITY, floor, threshold });
/**
 * A look's punches are written for a typical moment; at full intensity they're this much bigger (they follow the
 * intensity, `intense`).
 */
export const HEADROOM = 1.6;

/** Each hit punches: up at once, then down over `decay` seconds; as big as the music is intense (none: `depth` null). */
export const punch = (signal: SignalRef, mode: ParamLink["mode"], amount: number, decay = 0.25, depth: LinkDepth | null = intense()): ParamLink => ({
  signal,
  mode,
  amount: depth ? amount * HEADROOM : amount,
  response: DEFAULT_RESPONSE,
  hit: { attack: 0.005, hold: 0, decay },
  ...(depth && { depth }),
});
/** Follows a level, falling over `release` seconds (nothing under `threshold`). */
export const follow = (signal: SignalRef, mode: ParamLink["mode"], amount: number, release = 0.2, threshold = 0): ParamLink => ({
  signal,
  mode,
  amount,
  response: { ...DEFAULT_RESPONSE, release, threshold },
});

/** An effect of `type` with these values and links (its id is set by the layer). */
export function fx(type: string, params: ParamValues = {}, links?: Record<string, ParamLink>): Effect {
  const def = effectDefinition(type);
  if (!def) throw new Error(`No effect ${type}`);
  return sanitizeEffect(def, { params, ...(links && { links }) }, type);
}

/** A built-in effect's (Motion, Opacity) values and links changed. */
export function tweakBuiltIn(effects: Effect[], type: string, params: ParamValues, links?: Record<string, ParamLink>): Effect[] {
  return effects.map((e) => (e.type === type ? sanitizeEffect(effectDefinition(type)!, { ...e, params: { ...e.params, ...params }, links: { ...e.links, ...links } }, e.id) : e));
}

/** Ids unique within a layer: an effect's type, then `type_2`, `type_3`... */
export function withIds(effects: Effect[]): Effect[] {
  const seen = new Map<string, number>();
  return effects.map((e) => {
    const n = (seen.get(e.type) ?? 0) + 1;
    seen.set(e.type, n);
    return { ...e, id: n > 1 ? `${e.type}_${n}` : e.type };
  });
}

export interface LayerMotion {
  motion?: { params?: ParamValues; links?: Record<string, ParamLink> };
  opacity?: { params?: ParamValues; links?: Record<string, ParamLink> };
}

/** A layer of a solid (`color`) with `more` effects over it. */
export function solid(color: string, more: Effect[] = [], { motion, opacity }: LayerMotion = {}): LookLayer {
  let effects = solidEffects({ color });
  if (motion) effects = tweakBuiltIn(effects, "motion", motion.params ?? {}, motion.links);
  if (opacity) effects = tweakBuiltIn(effects, "opacity", opacity.params ?? {}, opacity.links);
  return { effects: withIds([...effects, ...more]) };
}

/** A layer drawing `type` alone (a visualizer or a generator, Blend Mode Replace), then `more` on it. */
export function drawing(type: string, params: ParamValues, more: Effect[] = [], moves: LayerMotion = {}): LookLayer {
  return solid("#000000", [fx(type, { blendMode: "replace", ...params }), ...more], moves);
}

/** An adjustment layer: its effects (and its Motion) apply to everything below it. */
export function adjust(effects: Effect[], { motion, opacity }: LayerMotion = {}): LookLayer {
  let base = defaultEffects();
  if (motion) base = tweakBuiltIn(base, "motion", motion.params ?? {}, motion.links);
  if (opacity) base = tweakBuiltIn(base, "opacity", opacity.params ?? {}, opacity.links);
  return { adjustment: true, effects: withIds([...base, ...effects]) };
}

/** The song's colours over a picture (its darks the background, its mids the primary, its lights the light). */
export const tint = (p: AlbumPalette, amount: number, mid: string = p.primary) =>
  fx("gradient-map", { shadows: p.background, midtones: mid, highlights: p.light, amount, midpoint: 0.45 });

/** The cover's deep colour, glowing a little in the middle. */
export const backdrop = (p: AlbumPalette, glow = p.background) =>
  solid("#000000", [fx("gradient-ramp", { rampShape: "radial", rampStart: [0.5, 0.5], rampEnd: [1.15, 1.15], startColor: glow, endColor: "#000000", blendMode: "replace" })]);

/** A number between `a` and `b`, rounded to `places`. */
export const between = (r: () => number, a: number, b: number, places = 2) => Math.round((a + (b - a) * r()) * 10 ** places) / 10 ** places;
export const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

/** A layer of the song's cover (`COVER_ASSET`), fitted to the frame's height, then `more` on it. */
export function coverLayer(more: Effect[], { motion, opacity }: LayerMotion = {}): LookLayer {
  let effects = defaultEffects();
  if (motion) effects = tweakBuiltIn(effects, "motion", motion.params ?? {}, motion.links);
  if (opacity) effects = tweakBuiltIn(effects, "opacity", opacity.params ?? {}, opacity.links);
  return { assetId: COVER_ASSET, effects: withIds([...effects, ...more]) };
}

/** A slow song's looks move this much as fast (docs/now-playing.md, "Slow"). */
export const SLOW_MOTION = 0.5;
/** In slow motion a hit rises over this long at least: a swell, not a snap. */
const SWELL = 0.12;
/** Things a second that are how many, not how fast: slow motion doesn't make fewer of them. */
const COUNTS = new Set(["birthRate"]);

/** How a number moves things by the second, as its unit says: a speed (a spin, a drift, a scroll), a growth (a zoom a second, 1 being none), or not at all. */
function rateOf(spec: NumberSpec): "speed" | "growth" | null {
  if (COUNTS.has(spec.key)) return null;
  const unit = spec.unit?.trim() ?? "";
  if (unit === "%/s") return "growth";
  return spec.key === "speed" || unit.endsWith("/s") ? "speed" : null;
}

/**
 * Effects in slow motion, at `pace` of their speed: everything that moves by the second moves `pace` as fast (a zoom a
 * second eases towards none), and each hit on the sound swells rather than snaps (rising over `SWELL` at least, falling
 * `1 / pace` as long; what follows a level, as slowly). Applied as a look is made: a shader's time × speed jumps if its
 * speed changes while it plays.
 */
export function inSlowMotion(effects: Effect[], pace: number): Effect[] {
  if (pace >= 1) return effects;
  return effects.map((e) => {
    const params = { ...e.params };
    for (const spec of effectDefinition(e.type)?.params ?? []) {
      if (spec.kind !== "number") continue;
      const rate = rateOf(spec);
      const value = params[spec.key] ?? spec.default;
      if (!rate || typeof value !== "number") continue;
      params[spec.key] = rate === "speed" ? value * pace : Math.sign(value) * Math.abs(value) ** pace;
    }
    const links = e.links && Object.fromEntries(Object.entries(e.links).map(([key, link]) => [key, slowLink(link, pace)]));
    return { ...e, params, ...(links && { links }) };
  });
}

const slowLink = (link: ParamLink, pace: number): ParamLink => ({
  ...link,
  response: { ...link.response, attack: link.response.attack / pace, release: link.response.release / pace },
  ...(link.hit && { hit: { attack: Math.max(SWELL, link.hit.attack / pace), hold: link.hit.hold / pace, decay: link.hit.decay / pace } }),
});

