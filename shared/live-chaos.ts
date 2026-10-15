/**
 * Chaos (docs/now-playing.md, step 4 of the plan): vaudio's nine recipes for a random look (its "archetypes",
 * `client/presets.ts`), rebuilt in the editor's effects. A recipe says what a roll can be: its world (vaudio's world
 * FX, here a World Loop: the picture bent, then laid over its own echo), the sources drawn under it (vaudio rolls the
 * layers you have; here the recipe picks them), how they're blended, the distortions on them, how much they move and
 * their colour style. A roll draws within the recipe's ranges from a look's `random` (another for each song and each
 * M), in the cover's colours, its headline effect growing with the music's intensity (vaudio's `energy`, but live).
 * A roll is kept in vaudio's units, so `-` mutates it as vaudio does (`mutateWorld`). Guard rails (`guarded`,
 * `chaosRoll`) keep a roll from washing out to white. Pure, and tested.
 */
import {
  BASS,
  INTENSITY,
  KICK,
  LEVEL,
  type LayerMotion,
  type LookContext,
  type LookLayer,
  SNARE,
  adjust,
  backdrop,
  coverLayer,
  drawing,
  follow,
  fx,
  pick,
  punch,
  seededRandom,
  solid,
} from "./live-kit.ts";
import type { Energy, LiveLook, LookSuits } from "./live-looks.ts";
import { type AlbumPalette, rgbToOklab } from "./palette.ts";
import type { Effect, ParamLink } from "./types.ts";

/**
 * A world in vaudio's units: most 0..1, `fbZoom` and `fbRotate` -1..1, `saturation`, `contrast` and `speed` 0..2
 * (1 is none). `flowSwirl` and `flowWarp` (-1..1, 0..1) are MilkDrop's, which vaudio hasn't: the echo itself
 * swirled and warped, so trails keep flowing.
 */
export interface ChaosWorld {
  zoom: number;
  swirl: number;
  kaleido: number;
  ripple: number;
  warp: number;
  mirror: number;
  chroma: number;
  hueOrbit: number;
  feedback: number;
  trails: number;
  fbZoom: number;
  fbRotate: number;
  fbHue: number;
  flowSwirl: number;
  flowWarp: number;
  saturation: number;
  contrast: number;
  grain: number;
  scanlines: number;
  vignette: number;
  strobe: number;
  speed: number;
}

/** vaudio's defaults: what a recipe doesn't say. */
const DEFAULT_WORLD: ChaosWorld = {
  zoom: 0,
  swirl: 0,
  kaleido: 0,
  ripple: 0,
  warp: 0,
  mirror: 0,
  chroma: 0,
  hueOrbit: 0,
  feedback: 0,
  trails: 0.6,
  fbZoom: 0,
  fbRotate: 0,
  fbHue: 0,
  flowSwirl: 0,
  flowWarp: 0,
  saturation: 1,
  contrast: 1,
  grain: 0,
  scanlines: 0,
  vignette: 0.22,
  strobe: 0,
  speed: 1,
};

const WORLD_KEYS = Object.keys(DEFAULT_WORLD) as (keyof ChaosWorld)[];
/** Each world value's range (vaudio's). */
const range = (key: keyof ChaosWorld): [number, number] =>
  key === "saturation" || key === "contrast" || key === "speed" ? [0, 2] : key === "fbZoom" || key === "fbRotate" || key === "flowSwirl" ? [-1, 1] : [0, 1];

/** How a layer's colours are styled (vaudio's). */
export type ColourStyle = "vivid" | "mono" | "psycho" | "neon" | "glitch";
/** A layer's distortions (vaudio's), each an editor effect (`distortion`). */
export type Distortion = "warp" | "swirl" | "bulge" | "kaleido" | "ripple" | "mirror" | "smear";
/** What a layer draws: one of the editor's visualizers or generators, or the cover. */
export type ChaosSource =
  | "plasma"
  | "orbs"
  | "ribbons"
  | "circle"
  | "burst"
  | "tunnel"
  | "radial"
  | "ring"
  | "rings"
  | "shards"
  | "line"
  | "scope"
  | "wave-bars"
  | "lattice"
  | "cover"
  | "smoke"
  | "lissajous";
/** What's under everything (vaudio's background modes, in the cover's darkest colours). */
export type ChaosBackdrop = "void" | "gradient" | "plasma" | "tunnel";

/** Sources that fill the frame: fed back in Lighten, they add up towards white, so their echo is held back. */
const FULL_FRAME: readonly ChaosSource[] = ["plasma", "lattice", "smoke"];

export interface ChaosRecipe {
  /** Its look is `chaos-<id>`. */
  id: string;
  name: string;
  /** What its look suits (`LookSuits`). */
  suits: LookSuits;
  /** Its world, drawn from `r` (vaudio's ranges; what it doesn't say is `DEFAULT_WORLD`'s). */
  world(r: () => number): Partial<ChaosWorld>;
  /** The world values that grow with the music's intensity (vaudio's energy-scaled ones). */
  headline: (keyof ChaosWorld)[];
  /** How upper layers meet what's under them (a base layer is Normal three times in four). */
  blends: string[];
  /** A layer's distortions: one, or two (the second at 0.55), picked by weight, `min`..`max` in vaudio's units. */
  distorts: { key: Distortion; weight: number; min: number; max: number }[];
  /** How much its layers move (spin, drift, pulse, shimmer), 0..1. */
  motion: number;
  colour: ColourStyle;
  /** What the base layer may draw, and an upper one. */
  bases: ChaosSource[];
  uppers: ChaosSource[];
  backdrops: ChaosBackdrop[];
  /** How it goes off with the music, where chaos's (`ENERGY`) doesn't suit it. */
  energy?: Partial<Energy>;
}

const rand = (r: () => number, a: number, b: number) => a + (b - a) * r();
const chance = (r: () => number, p: number) => r() < p;
const sign = (r: () => number, p: number) => (chance(r, p) ? -1 : 1);

/** vaudio's nine archetypes, their ranges as vaudio has them (Séance is Rorschach here, Hyperdrive Stargate). */
export const CHAOS_RECIPES: ChaosRecipe[] = [
  {
    id: "liquid",
    name: "Liquid",
    suits: { characters: ["chill", "groove"], energy: [0.1, 0.8] },
    world: (r) => ({
      warp: rand(r, 0.35, 0.6),
      swirl: rand(r, 0.2, 0.45),
      chroma: rand(r, 0.2, 0.4),
      hueOrbit: rand(r, 0.15, 0.35),
      feedback: rand(r, 0.35, 0.55),
      trails: rand(r, 0.65, 0.8),
      fbZoom: rand(r, 0.06, 0.18),
      flowWarp: rand(r, 0.2, 0.45),
      saturation: rand(r, 1.05, 1.35),
      contrast: rand(r, 1.05, 1.2),
      grain: rand(r, 0, 0.15),
      vignette: rand(r, 0.2, 0.4),
      speed: rand(r, 0.7, 1.2),
    }),
    headline: ["warp", "swirl"],
    blends: ["normal", "screen", "soft-light", "lighten"],
    distorts: [
      { key: "warp", weight: 3, min: 0.25, max: 0.7 },
      { key: "swirl", weight: 2, min: 0.2, max: 0.6 },
      { key: "bulge", weight: 2, min: 0.3, max: 0.7 },
    ],
    motion: 0.7,
    colour: "vivid",
    bases: ["plasma", "orbs", "ribbons", "cover", "lissajous"],
    uppers: ["ribbons", "orbs", "circle", "burst", "lissajous"],
    backdrops: ["void", "gradient", "plasma"],
  },
  {
    id: "tunnel",
    name: "Tunnel",
    suits: { characters: ["groove", "hype"], energy: [0.4, 1] },
    world: (r) => ({
      zoom: rand(r, 0.25, 0.5),
      feedback: rand(r, 0.7, 0.88),
      trails: rand(r, 0.85, 0.95),
      fbZoom: rand(r, 0.2, 0.4) * sign(r, 0.3),
      fbRotate: rand(r, -0.18, 0.18),
      fbHue: rand(r, 0.05, 0.2),
      chroma: rand(r, 0.15, 0.35),
      hueOrbit: rand(r, 0.1, 0.25),
      saturation: rand(r, 0.95, 1.3),
      contrast: rand(r, 1.02, 1.15),
      vignette: rand(r, 0.35, 0.55),
      speed: rand(r, 0.6, 1.1),
    }),
    headline: ["zoom"],
    blends: ["add", "screen", "lighten"],
    distorts: [
      { key: "bulge", weight: 2.5, min: 0.3, max: 0.7 },
      { key: "warp", weight: 2, min: 0.2, max: 0.5 },
    ],
    motion: 0.6,
    colour: "vivid",
    bases: ["tunnel", "radial", "circle"],
    uppers: ["ring", "burst", "rings", "lissajous"],
    backdrops: ["void", "gradient"],
  },
  {
    // Kaleido fed back through zoom and turn: petals growing out of petals.
    id: "fractal-bloom",
    name: "Fractal Bloom",
    suits: { characters: ["chill", "groove", "hype"], energy: [0.2, 1] },
    world: (r) => ({
      kaleido: rand(r, 0.5, 0.85),
      ripple: rand(r, 0.08, 0.22),
      feedback: rand(r, 0.6, 0.8),
      trails: rand(r, 0.8, 0.92),
      fbZoom: rand(r, 0.12, 0.3) * sign(r, 0.35),
      fbRotate: rand(r, 0.06, 0.18) * sign(r, 0.5),
      fbHue: rand(r, 0.1, 0.3),
      hueOrbit: rand(r, 0.3, 0.6),
      flowSwirl: rand(r, 0.1, 0.3) * sign(r, 0.5),
      saturation: rand(r, 1.3, 1.7),
      contrast: rand(r, 1.05, 1.2),
      vignette: rand(r, 0.25, 0.4),
      speed: rand(r, 0.6, 1.05),
    }),
    headline: ["kaleido"],
    blends: ["screen", "add", "hue", "color-dodge"],
    distorts: [
      { key: "kaleido", weight: 2.5, min: 0.3, max: 0.75 },
      { key: "ripple", weight: 1.5, min: 0.12, max: 0.4 },
      { key: "bulge", weight: 1.5, min: 0.3, max: 0.6 },
    ],
    motion: 0.7,
    colour: "vivid",
    bases: ["radial", "circle", "shards", "orbs", "cover", "lissajous"],
    uppers: ["burst", "line", "ring", "lissajous"],
    backdrops: ["void", "gradient"],
  },
  {
    id: "datamosh",
    name: "Datamosh",
    suits: { characters: ["hype", "heavy"], energy: [0.45, 1], glitch: true },
    world: (r) => ({
      chroma: rand(r, 0.5, 0.85),
      scanlines: rand(r, 0.25, 0.55),
      grain: rand(r, 0.25, 0.5),
      warp: rand(r, 0.1, 0.3),
      feedback: rand(r, 0.5, 0.7),
      trails: rand(r, 0.7, 0.85),
      fbZoom: rand(r, -0.12, -0.03),
      fbRotate: chance(r, 0.4) ? rand(r, -0.08, 0.08) : 0,
      saturation: rand(r, 0.9, 1.3),
      contrast: rand(r, 1.2, 1.4),
      strobe: chance(r, 0.45) ? rand(r, 0.06, 0.15) : 0,
      vignette: rand(r, 0.25, 0.45),
      speed: rand(r, 0.9, 1.3),
    }),
    headline: ["chroma"],
    blends: ["hard-light", "difference", "exclusion", "luminosity"],
    distorts: [
      { key: "smear", weight: 3, min: 0.2, max: 0.5 },
      { key: "mirror", weight: 1.5, min: 0.2, max: 0.5 },
      { key: "warp", weight: 1.5, min: 0.15, max: 0.4 },
    ],
    motion: 0.8,
    colour: "glitch",
    bases: ["cover", "wave-bars", "lattice"],
    uppers: ["scope", "line", "wave-bars", "lissajous"],
    backdrops: ["void", "gradient"],
  },
  {
    id: "acid",
    name: "Acid",
    suits: { characters: ["groove", "hype"], energy: [0.3, 1] },
    world: (r) => ({
      warp: rand(r, 0.5, 0.8),
      ripple: rand(r, 0.25, 0.45),
      hueOrbit: rand(r, 0.5, 0.8),
      feedback: rand(r, 0.4, 0.6),
      trails: rand(r, 0.7, 0.85),
      fbHue: rand(r, 0.2, 0.4),
      flowWarp: rand(r, 0.3, 0.6),
      saturation: rand(r, 1.6, 1.95),
      contrast: rand(r, 1.05, 1.2),
      vignette: rand(r, 0.15, 0.3),
      speed: rand(r, 1, 1.4),
    }),
    headline: ["warp"],
    blends: ["difference", "exclusion", "add", "hue"],
    distorts: [
      { key: "warp", weight: 2.5, min: 0.3, max: 0.8 },
      { key: "ripple", weight: 2, min: 0.15, max: 0.45 },
      { key: "bulge", weight: 1.5, min: 0.3, max: 0.7 },
      { key: "kaleido", weight: 1, min: 0.25, max: 0.6 },
    ],
    motion: 1,
    colour: "psycho",
    bases: ["plasma", "orbs", "cover"],
    uppers: ["ribbons", "shards", "circle", "lissajous"],
    backdrops: ["void", "plasma", "gradient"],
  },
  {
    // vaudio's Séance: slow smoke folded through a mirror line, a living Rorschach.
    id: "rorschach",
    name: "Rorschach",
    suits: { characters: ["chill"], energy: [0, 0.6], minimal: true },
    world: (r) => ({
      feedback: rand(r, 0.85, 0.93),
      trails: rand(r, 0.93, 0.97),
      fbZoom: rand(r, 0.03, 0.09),
      fbRotate: rand(r, -0.07, 0.07),
      mirror: chance(r, 0.65) ? rand(r, 0.3, 0.55) : 0,
      swirl: rand(r, 0.05, 0.2),
      flowWarp: rand(r, 0.1, 0.25),
      saturation: rand(r, 0.5, 0.75),
      contrast: rand(r, 1.08, 1.2),
      grain: rand(r, 0.12, 0.3),
      vignette: rand(r, 0.45, 0.6),
      speed: rand(r, 0.4, 0.7),
    }),
    headline: ["swirl"],
    blends: ["screen", "soft-light", "luminosity", "lighten"],
    distorts: [
      { key: "warp", weight: 2, min: 0.1, max: 0.35 },
      { key: "swirl", weight: 2, min: 0.1, max: 0.35 },
      { key: "mirror", weight: 1.5, min: 0.25, max: 0.5 },
    ],
    motion: 0.3,
    colour: "mono",
    bases: ["smoke", "ribbons", "scope", "cover", "lissajous"],
    uppers: ["line", "rings", "lissajous"],
    backdrops: ["void", "gradient"],
    energy: { strobe: 0, shake: 0.15 },
  },
  {
    // Edges of what's drawn, added over black, trailing light.
    id: "neon-skeleton",
    name: "Neon Skeleton",
    suits: { characters: ["hype", "heavy"], energy: [0.45, 1] },
    world: (r) => ({
      warp: rand(r, 0.15, 0.35),
      chroma: rand(r, 0.3, 0.55),
      feedback: rand(r, 0.55, 0.75),
      trails: rand(r, 0.8, 0.9),
      fbZoom: rand(r, 0.04, 0.12),
      fbHue: rand(r, 0.15, 0.35),
      hueOrbit: rand(r, 0.25, 0.5),
      flowSwirl: rand(r, 0, 0.15) * sign(r, 0.5),
      saturation: rand(r, 1.3, 1.7),
      contrast: rand(r, 1.25, 1.45),
      grain: rand(r, 0.05, 0.2),
      vignette: rand(r, 0.35, 0.55),
      speed: rand(r, 0.8, 1.25),
    }),
    headline: ["warp"],
    blends: ["add", "color-dodge", "screen"],
    distorts: [
      { key: "warp", weight: 2.5, min: 0.15, max: 0.45 },
      { key: "swirl", weight: 2, min: 0.15, max: 0.4 },
      { key: "ripple", weight: 1.5, min: 0.1, max: 0.35 },
    ],
    motion: 0.8,
    colour: "neon",
    bases: ["lattice", "wave-bars", "radial", "cover", "lissajous"],
    uppers: ["scope", "ribbons", "line", "lissajous"],
    backdrops: ["void"],
  },
  {
    id: "vortex",
    name: "Vortex",
    suits: { characters: ["groove", "hype"], energy: [0.35, 1] },
    world: (r) => {
      const turn = sign(r, 0.5);
      return {
        swirl: rand(r, 0.55, 0.85),
        zoom: rand(r, 0.1, 0.25),
        fbRotate: rand(r, 0.12, 0.25) * turn,
        feedback: rand(r, 0.55, 0.75),
        trails: rand(r, 0.8, 0.9),
        hueOrbit: rand(r, 0.3, 0.55),
        flowSwirl: rand(r, 0.3, 0.7) * turn,
        saturation: rand(r, 1.2, 1.5),
        contrast: rand(r, 1.05, 1.2),
        vignette: rand(r, 0.3, 0.45),
        speed: rand(r, 0.8, 1.25),
      };
    },
    headline: ["swirl"],
    blends: ["screen", "overlay", "add", "difference"],
    distorts: [
      { key: "swirl", weight: 3, min: 0.25, max: 0.7 },
      { key: "warp", weight: 2, min: 0.2, max: 0.5 },
      { key: "bulge", weight: 1.5, min: 0.3, max: 0.6 },
    ],
    motion: 0.8,
    colour: "vivid",
    bases: ["radial", "ribbons", "orbs", "lattice"],
    uppers: ["circle", "burst", "shards", "lissajous"],
    backdrops: ["void", "gradient", "tunnel"],
  },
  {
    // vaudio's Hyperdrive: a violent echo zoom, light streaking out of the middle.
    id: "stargate",
    name: "Stargate",
    suits: { characters: ["hype", "heavy"], energy: [0.5, 1] },
    world: (r) => ({
      zoom: rand(r, 0.2, 0.45),
      feedback: rand(r, 0.75, 0.9),
      trails: rand(r, 0.88, 0.95),
      fbZoom: rand(r, 0.25, 0.45) * sign(r, 0.25),
      chroma: rand(r, 0.3, 0.6),
      hueOrbit: rand(r, 0.2, 0.45),
      grain: rand(r, 0.08, 0.2),
      strobe: chance(r, 0.5) ? rand(r, 0.08, 0.16) : 0,
      saturation: rand(r, 1.15, 1.5),
      contrast: rand(r, 1.1, 1.25),
      vignette: rand(r, 0.3, 0.5),
      speed: rand(r, 1.2, 1.8),
    }),
    headline: ["zoom"],
    blends: ["add", "screen", "lighten"],
    distorts: [
      { key: "warp", weight: 2.5, min: 0.2, max: 0.5 },
      { key: "bulge", weight: 2, min: 0.35, max: 0.7 },
    ],
    motion: 1,
    colour: "vivid",
    bases: ["tunnel", "radial", "burst"],
    uppers: ["shards", "ring", "burst", "lissajous"],
    backdrops: ["void", "tunnel"],
  },
];

/** A colour of the cover's that a layer draws in, by its role (never its light: near white). */
export type PaletteRole = "primary" | "secondary" | "accent";

/** A layer of a roll: what it draws, how it meets what's under it, how it's bent, coloured and moved. */
export interface ChaosLayer {
  source: ChaosSource;
  blend: string;
  opacity: number;
  /** Its two colours, by palette role. */
  colours: [PaletteRole, PaletteRole];
  distortions: { key: Distortion; value: number }[];
  /** Its colours turned (degrees) and saturated (1 is none). */
  hue: number;
  saturation: number;
  posterize: number;
  invert: number;
  edges: number;
  tint: number;
  chroma: number;
  spin: number;
  drift: number;
  pulse: number;
  shimmer: number;
  /** Where it sits (Motion: canvas fractions) and how big (1 is the frame). */
  place: { x: number; y: number; scale: number };
  /** Repeated in tiles this big (a fraction of the frame), or not (0). */
  tile: number;
}

/** A roll of a recipe: its world (vaudio's units) and its layers, the base first. */
export interface ChaosRoll {
  recipe: string;
  world: ChaosWorld;
  backdrop: ChaosBackdrop;
  layers: ChaosLayer[];
}

/**
 * vaudio's guard rails, and ours: heavy feedback with a strobe washes out to white mush, and so does a frame-filling
 * source fed back hard (in Lighten every frame keeps its brightest).
 */
export function guarded(world: ChaosWorld, layers: readonly ChaosLayer[] = []): ChaosWorld {
  const w = { ...world };
  for (const key of WORLD_KEYS) {
    const [lo, hi] = range(key);
    w[key] = Math.min(hi, Math.max(lo, Number.isFinite(w[key]) ? w[key] : DEFAULT_WORLD[key]));
  }
  w.feedback = Math.min(w.feedback, 0.93);
  w.trails = Math.min(w.trails, 0.97);
  if (w.feedback > 0.6) w.strobe = Math.min(w.strobe, 0.1);
  if (layers.some((l) => FULL_FRAME.includes(l.source))) w.feedback = Math.min(w.feedback, 0.6);
  return w;
}

/** Up to `n` of `list`, none twice, picked by weight. */
function pickDistinct<T extends { weight: number }>(r: () => number, list: readonly T[], n: number): T[] {
  const left = [...list];
  const out: T[] = [];
  while (out.length < n && left.length) {
    let at = r() * left.reduce((s, d) => s + d.weight, 0);
    const i = Math.max(0, left.findIndex((d) => (at -= d.weight) < 0));
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

/**
 * vaudio's harmonies (`createChaosTheme`, offsets of a turn from its base hue: complementary, triadic, analogous,
 * split): a roll's layers take their hues from one, its base hue the cover's.
 */
const HARMONIES = [
  [0, 0.5],
  [0, 1 / 3, 2 / 3],
  [0, 0.08, 0.92],
  [0, 0.5, 0.08],
];

/**
 * How a roll repeats what it draws: round the middle (the world's kaleido), in a pair or four (its mirror), in tiles
 * (the top layer's), or not.
 */
type Repeat = "kaleido" | "mirror" | "quarters" | "tiles" | "none";

/**
 * Where a layer may sit off the middle (a direction, radians, y up), so its repeat shows it: a kaleido takes only the
 * thin wedge just above the middle's right (0..10°, its narrowest), a mirror the right half (the top right quarter
 * when it folds both ways). Elsewhere it'd be cut away, and the frame black.
 */
function direction(r: () => number, repeat: Repeat): number {
  switch (repeat) {
    case "kaleido":
      return rand(r, 0.03, 0.17);
    case "mirror":
      return rand(r, -1.2, 1.2);
    case "quarters":
      return rand(r, 0.2, 1.37);
    default:
      return r() * Math.PI * 2;
  }
}

/** vaudio's layer roll (`randomLayerFx`), slot 0 the base, its hue from the roll's `harmony`. */
function layerRoll(recipe: ChaosRecipe, r: () => number, slot: number, source: ChaosSource, harmony: readonly number[], repeat: Repeat): ChaosLayer {
  const base = slot === 0;
  const strength = base ? 1 : rand(r, 0.45, 0.65);
  const blend = base ? (chance(r, 0.25) ? pick(r, recipe.blends) : "normal") : pick(r, recipe.blends);
  const distortions = pickDistinct(r, recipe.distorts, chance(r, 0.45) ? 2 : 1).map((d, i) => ({
    key: d.key,
    value: rand(r, d.min, d.max) * (i === 0 ? 1 : 0.55) * strength * (d.key === "bulge" && chance(r, 0.5) ? -1 : 1),
  }));
  const layer: ChaosLayer = {
    source,
    blend,
    // Added or dodged, a layer is held back (a whole one adds up to white), and so is one that fills the frame.
    opacity:
      blend === "color-dodge" ? rand(r, 0.35, 0.5) : blend === "add" ? rand(r, 0.45, 0.6) : FULL_FRAME.includes(source) ? rand(r, 0.6, 0.85) : base ? 1 : rand(r, 0.7, 1),
    // Never the cover's light (near white: white strokes fed back are white mush).
    colours: base ? ["primary", chance(r, 0.5) ? "secondary" : "accent"] : chance(r, 0.5) ? ["accent", "primary"] : ["secondary", "accent"],
    distortions,
    hue: 0,
    saturation: 1,
    posterize: 0,
    invert: 0,
    edges: 0,
    tint: 0,
    chroma: 0,
    spin: 0,
    drift: 0,
    pulse: 0,
    shimmer: 0,
    place: { x: 0.5, y: 0.5, scale: 1 },
    tile: 0,
  };
  // Its hue: the harmony's for its place (an upper layer always, as vaudio's; the base keeps the cover's but in
  // a psycho recipe, where it's turned too, most of the time). A mono recipe is the cover's alone.
  const turn = recipe.colour === "psycho" && base ? (chance(r, 0.6) ? pick(r, harmony.slice(1)) : 0) : harmony[slot % harmony.length];
  if (recipe.colour !== "mono") layer.hue = Math.round(turn * 360) % 360;
  const sparse = !FULL_FRAME.includes(source);
  // Where it sits: vaudio's layers are where they were put, off the middle and smaller, so a kaleido or a mirror
  // makes a ring or a pair of them (centred, it'd only make the same one again).
  // The cover is a thing in the frame too: its art, smaller, wherever it sits (filling the frame, it's a backdrop).
  if (source === "cover") layer.place = { x: 0.5, y: 0.5, scale: rand(r, 0.4, 0.65) };
  if (sparse && (!base || chance(r, 0.5))) {
    const away = rand(r, 0.12, 0.3);
    const angle = direction(r, repeat);
    // Motion's position is in the canvas's fractions, y down; `away` is in heights (a 16:9 width is 1.78 of them).
    layer.place = { x: 0.5 + (Math.cos(angle) * away) / 1.78, y: 0.5 - Math.sin(angle) * away, scale: source === "cover" ? rand(r, 0.35, 0.55) : rand(r, 0.55, 0.9) };
  }
  switch (recipe.colour) {
    case "vivid":
      layer.saturation = rand(r, 1.1, 1.6);
      // Posterized: pure colours, hard edges (vaudio's frames are full of them).
      if (chance(r, 0.25)) layer.posterize = rand(r, 0.25, 0.5);
      break;
    case "mono":
      layer.saturation = rand(r, 0.2, 0.55);
      layer.tint = rand(r, 0.35, 0.6);
      break;
    case "psycho":
      layer.saturation = rand(r, 1.4, 1.9);
      if (chance(r, 0.35)) layer.posterize = rand(r, 0.25, 0.6);
      else if (chance(r, 0.2) && sparse) layer.invert = rand(r, 0.6, 1);
      break;
    case "neon":
      layer.saturation = rand(r, 1.3, 1.8);
      // The base keeps some of its fill, so the frame isn't only lines (but not much: a fill added over is white).
      layer.edges = base ? rand(r, 0.5, 0.75) : rand(r, 0.6, 0.9);
      if (chance(r, 0.2)) layer.posterize = rand(r, 0.25, 0.5);
      break;
    case "glitch":
      layer.saturation = rand(r, 0.8, 1.5);
      if (chance(r, 0.6)) layer.posterize = rand(r, 0.3, 0.7);
      if (chance(r, 0.25) && sparse) layer.invert = rand(r, 0.4, 0.8);
      break;
  }
  // Colours split wide: the fringes on everything in vaudio's frames.
  if (chance(r, 0.6)) layer.chroma = rand(r, 0.25, 0.7) * strength;
  if (recipe.colour !== "mono" && chance(r, 0.2)) layer.tint = rand(r, 0.15, 0.4);
  if (!layer.posterize && !layer.edges && chance(r, 0.12) && source !== "lissajous") layer.edges = rand(r, 0.2, 0.6);
  const motion = recipe.motion * (base ? 1 : 0.7);
  if (chance(r, 0.35)) layer.spin = rand(r, 0.04, 0.3) * motion * sign(r, 0.5);
  if (chance(r, 0.5)) layer.drift = rand(r, 0.08, 0.45) * motion;
  if (chance(r, 0.4)) layer.pulse = rand(r, 0.1, 0.5) * motion;
  if (chance(r, 0.5)) layer.shimmer = rand(r, 0.15, 0.7) * motion;
  return layer;
}

/** A roll of `recipe` (vaudio's `chaosScene`: its world and every layer from one draw). */
export function rollChaos(recipe: ChaosRecipe, r: () => number): ChaosRoll {
  const world = { ...DEFAULT_WORLD, ...recipe.world(r) };
  // Mostly the void: things floating in black, as vaudio's frames are.
  const backdropKind = recipe.backdrops.includes("void") && chance(r, 0.7) ? "void" : pick(r, recipe.backdrops);
  const harmony = pick(r, HARMONIES);
  // Most of vaudio's frames repeat a few small things (its kaleido, mirror and tiles, turned up in play): a roll
  // mostly does too, round the middle, in a pair or four, or in tiles. A recipe's own kaleido or mirror counts.
  const roll = r();
  if (world.kaleido === 0 && world.mirror === 0) {
    if (roll < 0.4) world.kaleido = rand(r, 0.3, 0.75);
    else if (roll < 0.55) world.mirror = rand(r, 0.3, 0.9);
  }
  const repeat: Repeat = world.kaleido > 0 ? "kaleido" : world.mirror > 0.5 ? "quarters" : world.mirror > 0 ? "mirror" : roll < 0.7 ? "tiles" : "none";
  const base = layerRoll(recipe, r, 0, pick(r, recipe.bases), harmony, repeat);
  const layers = [base];
  if (chance(r, 0.7)) {
    const uppers = recipe.uppers.filter((s) => s !== base.source);
    layers.push(layerRoll(recipe, r, 1, pick(r, uppers.length ? uppers : recipe.uppers), harmony, repeat));
  }
  if (repeat === "tiles" && !FULL_FRAME.includes(layers.at(-1)!.source)) layers.at(-1)!.tile = pick(r, [0.5, 1 / 3, 0.25]);
  // And its colours split wide (vaudio's chroma, turned up just as often).
  if (world.chroma < 0.3 && chance(r, 0.6)) world.chroma = rand(r, 0.35, 0.8);
  return { recipe: recipe.id, world: guarded(world, layers), backdrop: backdropKind, layers };
}

/**
 * vaudio's mutate (`-`): every world value nudged by up to ±0.12 (a value at nothing may creep in), its echo held
 * under 0.9, the guard rails again. The layers stay.
 */
export function mutateWorld(roll: ChaosRoll, r: () => number): ChaosRoll {
  const world = { ...roll.world };
  for (const key of WORLD_KEYS) world[key] += (r() - 0.5) * 0.24;
  world.feedback = Math.min(guarded(world).feedback, 0.9);
  return { ...roll, world: guarded(world, roll.layers) };
}

/** A roll of `recipe` for a look's context: rolled from its random, then mutated as many times as it's been. */
export function chaosRoll(recipe: ChaosRecipe, ctx: LookContext): ChaosRoll {
  let roll = rollChaos(recipe, ctx.random);
  const seed = Math.floor(ctx.random() * 1e9);
  for (let k = 1; k <= (ctx.mutations ?? 0); k++) roll = mutateWorld(roll, seededRandom(`${seed}:${k}`));
  return roll;
}

// ---------------------------------------------------------------------------
// A roll as layers
// ---------------------------------------------------------------------------

/** Seconds for an echo to fall to a tenth, from vaudio's trails (its per-frame fade at 60 fps). */
export const trailSeconds = (trails: number) => Math.log(0.1) / (60 * Math.log(0.55 + (0.985 - 0.55) * trails));
/** The echo's zoom a second, from vaudio's per-frame one (+ grows outward, a tunnel; − sinks in). */
export const echoZoom = (fbZoom: number) => (1 - 0.045 * fbZoom) ** -60;

/** The World Loop's values for a world (vaudio's units to its), the headline ones grown by intensity. */
export function worldParams(world: ChaosWorld, recipe: ChaosRecipe) {
  // A psycho recipe's echo cycles round the wheel as vaudio's does; the others drift near the cover's colours.
  const hueRate = recipe.colour === "psycho" ? 1200 : 430;
  const grows = (key: keyof ChaosWorld, v: number) => (recipe.headline.includes(key) ? v * 0.65 : v);
  return {
    push: grows("zoom", world.zoom),
    swirl: grows("swirl", world.swirl),
    kaleido: grows("kaleido", world.kaleido),
    ripple: world.ripple,
    warp: grows("warp", world.warp),
    mirror: world.mirror,
    chroma: grows("chroma", world.chroma),
    speed: world.speed,
    // vaudio's hue orbit goes round the wheel (a magenta cover is green half a minute on): only a psycho recipe's
    // does; the others' swing about the cover's colours, in the grade (`chaosLayers`).
    orbit: recipe.colour === "psycho" ? Math.round(world.hueOrbit * 52) : 0,
    amount: world.feedback,
    trailLength: Math.round(trailSeconds(world.trails) * 100) / 100,
    echoZoom: Math.round(echoZoom(world.fbZoom) * 100) / 100,
    echoRotation: Math.round(world.fbRotate * 189),
    echoHue: Math.round(world.fbHue * hueRate),
    flowSwirl: Math.round(world.flowSwirl * 120),
    flowWarp: world.flowWarp,
    mode: "lighten",
  };
}

/** How the world moves with the music: its headline values with the intensity, the rest with the sound (vaudio's). */
function worldLinks(world: ChaosWorld, recipe: ChaosRecipe): Record<string, ParamLink> {
  const links: Record<string, ParamLink> = {};
  const param: Partial<Record<keyof ChaosWorld, string>> = { zoom: "push", swirl: "swirl", kaleido: "kaleido", warp: "warp", chroma: "chroma" };
  for (const [key, to] of Object.entries(param) as [keyof ChaosWorld, string][]) {
    if (world[key] <= 0) continue;
    if (recipe.headline.includes(key)) links[to] = follow(INTENSITY, "multiply", 0.8, 1);
    else if (key === "chroma") links[to] = punch(SNARE, "add", 0.15, 0.2);
    else if (key !== "kaleido") links[to] = follow(LEVEL, "multiply", 0.5, 0.3);
  }
  // The echo breathes on the kicks (MilkDrop's zoom pulse).
  links.echoZoom = punch(KICK, "multiply", 0.08, 0.3);
  return links;
}

/** What's under it all, in the cover's darkest colours. */
function backdropLayer(kind: ChaosBackdrop, p: AlbumPalette): LookLayer {
  switch (kind) {
    case "void":
      // vaudio's void is its darkest colour, nearly black.
      return solid(p.background, [], { opacity: { params: { opacity: 0.3 } } });
    case "gradient":
      return backdrop(p);
    case "plasma":
      return drawing("audio-plasma", { pixelSize: 0, speed: 0.6, hueSpread: 20, hueDrift: 0, color: p.background, color2: p.secondary }, [], { opacity: { params: { opacity: 0.35 } } });
    case "tunnel":
      return drawing("audio-tunnel", { rings: 12, size: 0.6, wobble: 0.8, hueDrift: 0, hueReact: 8, color: p.background, color2: p.primary }, [], { opacity: { params: { opacity: 0.4 } } });
  }
}

/** A source's drawing (values that read, from the looks), in colours `a` and `b`. */
function sourceEffect(source: Exclude<ChaosSource, "cover">, a: string, b: string): Effect {
  const replace = { blendMode: "replace" };
  switch (source) {
    case "plasma":
      return fx("audio-plasma", { ...replace, pixelSize: 0, speed: 1, hueSpread: 40, hueDrift: 0, color: a, color2: b });
    case "orbs":
      return fx("audio-orbs", { ...replace, orbs: 24, orbSize: 1.1, spread: 0.9, hueDrift: 0, hueReact: 15, color: a, color2: b });
    case "ribbons":
      return fx("audio-ribbons", { ...replace, ribbons: 6, swing: 1, thickness: 1, boost: 0.8, hueDrift: 0, hueReact: 10, color: a, color2: b });
    case "circle":
      return fx("audio-circle", { ...replace, radius: 0.2, barLength: 0.18, bars: 128, gap: 0.45, mirror: true, pulse: 0.2, color: a, color2: b });
    case "burst":
      return fx("audio-burst", { ...replace, hits: "any", count: 28, spread: 0.6, life: 0.9, particleSize: 0.008, color: a, color2: b });
    case "tunnel":
      // Smaller than the frame: its rings, zoomed by the echo, fill it soon enough.
      return fx("audio-tunnel", { ...replace, rings: 10, size: 0.4, wobble: 0.8, hueDrift: 0, hueReact: 10, color: a, color2: b });
    case "radial":
      return fx("audio-radial", { ...replace, size: 0.36, boost: 0.8, spokes: 80, spin: 20, hueSpread: 30, hueDrift: 0, thickness: 1, color: a, color2: b });
    case "ring":
      return fx("audio-ring", { ...replace, radius: 0.18, amplitude: 0.08, thickness: 0.004, pulse: 0.3, glow: 0.7, color: a });
    case "rings":
      return fx("radio-waves", { ...replace, frequency: 1, expansion: 0.35, lifespan: 2, strokeWidth: 0.005, softness: 0.4, color: a });
    case "shards":
      return fx("audio-shards", { ...replace, shards: 24, shardSize: 1.2, boost: 0.8, rest: 0.3, hueSpread: 30, hueDrift: 0, color: a, color2: b });
    case "line":
      return fx("audio-line", { ...replace, center: [0.5, 0.5], width: 0.9, height: 0.45, mirror: true, fill: 0.4, thickness: 0.005, color: a, color2: b });
    case "scope":
      return fx("audio-oscilloscope", { ...replace, center: [0.5, 0.5], width: 1.1, height: 0.4, gain: 2, thickness: 0.004, glow: 0.5, color: a });
    case "wave-bars":
      // A thick glowing fill: held back, or added over the rest it's white.
      return fx("audio-wave-bars", { ...replace, bars: 80, center: [0.5, 0.55], height: 0.36, boost: 0.6, hueSpread: 20, hueDrift: 0, hueReact: 10, glow: 0.2, color: a, color2: b });
    case "lattice":
      return fx("audio-lattice", { ...replace, columns: 18, rows: 10, boost: 0.45, hueDrift: 0, hueReact: 12, color: a, color2: b });
    case "lissajous":
      return fx("audio-lissajous", { ...replace, window: 0.04, scale: 0.34, delay: 0.18, gain: 1, thickness: 0.0035, glow: 0.6, hueDrift: 0, color: a, color2: b });
    case "smoke":
      return fx(
        "fractal-noise",
        { ...replace, colorMode: "gradient", colorA: "#000000", colorB: b, contrast: 1.3, brightness: 0.05, scale: 1.3, complexity: 5, evolveSpeed: 60 },
        { brightness: follow(LEVEL, "add", 0.35, 0.4) },
      );
  }
}

/** A distortion as an editor effect, `v` in vaudio's units (bulge's sign makes it a pinch). */
function distortion(key: Distortion, v: number): Effect {
  switch (key) {
    case "warp":
      return fx("turbulent-displace", { amount: Math.abs(v) * 0.08, size: 0.45, complexity: 2, evolveSpeed: 40 });
    case "swirl":
      return fx("twirl", { angle: Math.round(v * 240), reach: 0.6 });
    case "bulge":
      return fx("bulge", { amount: v * 0.8, reach: 0.5 });
    case "kaleido":
      return fx("kaleida", { mirroring: v < 0.4 ? "4" : v < 0.55 ? "6" : v < 0.7 ? "8" : "12", size: 1 });
    case "ripple":
      return fx("ripple", { radius: 1.2, waveHeight: Math.abs(v) * 0.03, waveWidth: 0.08, speed: 1.5 });
    case "mirror":
      return fx("mirror", { side: v < 0.35 ? "left" : "corner" });
    case "smear":
      return fx("pixel-sort", { direction: -90, reach: Math.abs(v), thresholdLow: 0.3, thresholdHigh: 1 });
  }
}

/** A layer of a roll as a look's layer: its source, bent, coloured, moving, blended. */
function chaosLayer(layer: ChaosLayer, p: AlbumPalette, seed: number): LookLayer {
  const [a, b] = [p[layer.colours[0]], p[layer.colours[1]]];
  // Repeated in tiles first, then bent (the tiles bend together).
  const more: Effect[] = layer.tile > 0 ? [fx("tile", { tileWidth: Math.round(layer.tile * 1000) / 1000, tileHeight: Math.round(layer.tile * 1000) / 1000, mirrorEdges: true })] : [];
  more.push(...layer.distortions.map((d) => distortion(d.key, d.value)));
  // Its colours: turned (and swung a little: vaudio's shimmer), saturated, then styled.
  more.push({
    ...fx("hue-saturation", { hue: ((layer.hue + 180) % 360) - 180, saturation: Math.round(layer.saturation * 100) / 100, lightness: 0 }),
    ...(layer.shimmer > 0 && { expressions: { hue: `value + Math.sin(time * 0.5) * ${Math.round(layer.shimmer * 40)}` } }),
  });
  if (layer.tint > 0) more.push(fx("tint", { mapBlack: "#000000", mapWhite: p.light, amount: Math.round(layer.tint * 100) / 100 }));
  if (layer.posterize > 0) more.push(fx("posterize", { levels: Math.round(8 - layer.posterize * 6) }));
  if (layer.invert > 0) more.push(fx("invert", { amount: Math.round(layer.invert * 100) / 100 }));
  if (layer.edges > 0) more.push(fx("glow-edges", { edgeWidth: 0.002, glow: 1.2, pictureColor: true, darken: Math.round(layer.edges * 100) / 100 }));
  if (layer.chroma > 0) more.push(fx("rgb-split", { amount: Math.round(layer.chroma * 0.05 * 1000) / 1000 }));
  // Drifting about where it sits (a kaleido's copies of it dance).
  if (layer.drift > 0) more.push(fx("wiggle", { frequency: 0.4, positionAmount: Math.round(layer.drift * 0.15 * 1000) / 1000, rotationAmount: 0, zoomAmount: Math.round(layer.drift * 0.05 * 1000) / 1000, seed, hideEdges: false }));
  const moves: LayerMotion = {
    opacity: { params: { opacity: Math.round(layer.opacity * 100) / 100, blendMode: layer.blend } },
    // Where it sits, and how big.
    motion: {
      params: {
        position: [Math.round(layer.place.x * 1000) / 1000, Math.round(layer.place.y * 1000) / 1000],
        scale: Math.round(layer.place.scale * 100) / 100,
      },
      ...(layer.pulse > 0 && { links: { scale: punch(BASS, "multiply", Math.round(layer.pulse * 0.12 * 1000) / 1000, 0.3) } }),
    },
  };
  const drawn = layer.source === "cover" ? coverLayer(more, moves) : solid("#000000", [sourceEffect(layer.source, a, b), ...more], moves);
  // Spinning (vaudio's spin, a turn every so often).
  if (layer.spin !== 0) {
    drawn.effects = drawn.effects.map((e) => (e.type === "motion" ? { ...e, expressions: { ...e.expressions, rotation: `value + time * ${Math.round(layer.spin * 120)}` } } : e));
  }
  return drawn;
}

/**
 * How much a roll glares in these colours, 0..1: its lightest colour's lightness (OKLab; a palette's colours are
 * 0.64..0.84) over 0.72. A yellow or a pale cyan fed back piles up to white where a magenta or a blue doesn't.
 */
export function glareOf(roll: ChaosRoll, p: AlbumPalette): number {
  const colours = roll.layers.flatMap((l) => (l.source === "cover" ? [p.accent] : l.colours.map((role) => p[role])));
  const lightest = Math.max(...colours.map((hex) => rgbToOklab(...([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]))[0]));
  return Math.min(1, Math.max(0, (lightest - 0.72) / 0.12));
}

/** A roll as a look's layers, top first: its grade, its world, its layers (the base last), what's under them. */
export function chaosLayers(roll: ChaosRoll, p: AlbumPalette): LookLayer[] {
  const recipe = CHAOS_RECIPES.find((c) => c.id === roll.recipe) ?? CHAOS_RECIPES[0];
  // The brighter its colours, the less it's fed back, the shorter its trails, and a little less exposed.
  const glare = glareOf(roll, p);
  const w: ChaosWorld = {
    ...roll.world,
    feedback: Math.min(roll.world.feedback, 0.93 - 0.33 * glare),
    trails: Math.min(roll.world.trails, 0.95 - 0.12 * glare),
    zoom: roll.world.zoom * (1 - 0.3 * glare),
  };
  // The grade, outside the loop (vaudio's is inside it, and why it needs its caps).
  const swing = recipe.colour === "psycho" ? 0 : Math.round(w.hueOrbit * 50);
  const grade: Effect[] = [
    {
      ...fx("hue-saturation", { hue: 0, saturation: Math.round(w.saturation * 100) / 100, lightness: 0 }),
      ...(swing > 0 && { expressions: { hue: `value + Math.sin(time * 0.35) * ${swing}` } }),
    },
    fx("brightness-contrast", { brightness: 0, contrast: Math.round(((w.contrast - 1) / 3) * 1000) / 1000 }),
  ];
  if (w.strobe > 0) grade.push(fx("audio-strobe", { hits: "kicks", mode: "flash", amount: 0, decay: 0.08 }, { amount: follow(INTENSITY, "add", Math.round(w.strobe * 2.5 * 100) / 100, 0.6, 0.6) }));
  if (w.scanlines > 0.02) grade.push(fx("vhs", { intensity: 0.2, scanlines: Math.round(w.scanlines * 100) / 100 }));
  if (w.grain > 0.02) grade.push(fx("film-grain", { amount: Math.round(w.grain * 0.8 * 100) / 100 }));
  if (glare > 0) grade.push(fx("exposure", { exposure: -Math.round(glare * 50) / 100 }));
  grade.push(fx("vignette", { amount: Math.round(w.vignette * 100) / 100 }));
  const layers = roll.layers.map((l, i) => chaosLayer(l, p, i + 1)).reverse();
  return [adjust(grade), adjust([fx("world-loop", worldParams(w, recipe), worldLinks(w, recipe))]), ...layers, backdropLayer(roll.backdrop, p)];
}

/** Every recipe as a look (kind chaos): another roll for each song and each M, mutated by `-`. */
export const CHAOS_LOOKS: LiveLook[] = CHAOS_RECIPES.map((recipe) => ({
  id: `chaos-${recipe.id}`,
  name: recipe.name,
  kind: "chaos",
  suits: recipe.suits,
  ...(recipe.energy && { energy: recipe.energy }),
  layers: (ctx) => chaosLayers(chaosRoll(recipe, ctx), ctx.palette),
}));
