/**
 * Now Playing's looks (docs/now-playing.md): what the visualizer draws while the computer plays music. Each look is
 * a few layers of the video editor's own effects (a world, a visualizer over it, glow and trails, punches on the
 * kicks), coloured by the song's cover (`AlbumPalette`: roles, not colours) and varied by a seed, so a look is its
 * own for every song. The view plays them in a project of its own (`liveProject`), each look a nested sequence on
 * one track, switching through the editor's transitions, over the sound heard (`LIVE_ASSET`: its signals are the
 * live ones, `shared/signals/live.ts`). Everything a look does stays an editor effect: a look could be a video's.
 * Pure, and tested.
 */
import { defaultEffects } from "./effects.ts";
import { DEFAULT_RESPONSE } from "./links.ts";
import { CHAOS_LOOKS } from "./live-chaos.ts";
import {
  BASS,
  COVER_ASSET,
  DOWNBEAT,
  INTENSITY,
  KICK,
  LEVEL,
  type LookContext,
  type LookLayer,
  SNARE,
  adjust,
  backdrop,
  between,
  coverLayer,
  drawing,
  follow,
  fx,
  intense,
  pick,
  punch,
  solid,
  tint,
  tweakBuiltIn,
  withIds,
} from "./live-kit.ts";
import type { AlbumPalette } from "./palette.ts";
import type { SongCharacter } from "./signals/mood.ts";
import { ONSET_SCALARS, type OnsetName, SIGNALS_VERSION, SIGNAL_RATE, SCALARS, bandEdges, type Hit, type SignalData } from "./signals/format.ts";
import type { AspectRatio, Clip, MediaAsset, ParamLink, ParamValues, Project, Sequence, SignalRef, Transition } from "./types.ts";

export { COVER_ASSET, type LookContext, type LookLayer, seededRandom } from "./live-kit.ts";
import { createTransition } from "./transitions.ts";

// ---------------------------------------------------------------------------
// The project the view plays
// ---------------------------------------------------------------------------

/** The sound heard: an audio clip of it plays under every look (its signals are the live ones). */
export const LIVE_ASSET = "live";
/** The keys' punches (`Pad`), as hits of a sound of their own on a muted track. */
export const PADS_ASSET = "pads";
export const PADS_TRACK = "pads";
const LOOKS_TRACK = "looks";
const PERFORM_TRACK = "perform";
const SOUND_TRACK = "sound";
export const LIVE_FPS = 60;
/** How long clips last: longer than anyone listens without a song changing (sessions restart on one). */
export const FOREVER = 6 * 3600;

/** The song's cover as media (an image; `url` is Spotify's, served with CORS), for looks that show it. */
export function coverAsset(url: string): MediaAsset {
  return {
    id: COVER_ASSET,
    projectId: null,
    name: "Cover",
    kind: "image",
    duration: FOREVER,
    width: 640,
    height: 640,
    fps: null,
    hasVideo: true,
    hasAudio: false,
    size: 0,
    createdAt: 0,
    status: "ready",
    src: url,
    poster: null,
    filmstrip: null,
    waveform: null,
  };
}

/** A look being shown: its sequence, and the clip playing it on the looks track. */
export interface Showing {
  look: string;
  sequence: Sequence;
  clip: Clip;
}

const soundClip: Clip = { id: "sound", assetId: LIVE_ASSET, trackId: SOUND_TRACK, start: 0, in: 0, out: FOREVER, effects: defaultEffects() };
const padsClip: Clip = { id: "pads", assetId: PADS_ASSET, trackId: PADS_TRACK, start: 0, in: 0, out: FOREVER, effects: defaultEffects() };

/** The visualizer's project: the perform layer over the looks shown (one after another), over the sound heard. */
export function liveProject(shows: readonly Showing[], perform: Clip, aspectRatio: AspectRatio = "16:9"): Project {
  return {
    version: 1,
    name: "Now Playing",
    settings: { aspectRatio, fps: LIVE_FPS },
    tracks: [
      { id: PERFORM_TRACK, kind: "video", name: "Perform", muted: false },
      { id: LOOKS_TRACK, kind: "video", name: "Looks", muted: false },
      { id: SOUND_TRACK, kind: "audio", name: "Sound", muted: false },
      { id: PADS_TRACK, kind: "audio", name: "Pads", muted: true },
    ],
    clips: [perform, ...shows.map((s) => s.clip), soundClip, padsClip],
    sequences: shows.map((s) => s.sequence),
  };
}

/** A look as a nested sequence: its layers on tracks of their own, top first, each as long as a session. */
export function lookSequence(look: LiveLook, ctx: LookContext, id: string): Sequence {
  // The look's own layers under its energy (how it goes off when the music does).
  const layers = [energyLayer({ ...ENERGY[look.kind], ...look.energy }), ...look.layers(ctx)];
  const tracks = layers.map((_, i) => ({ id: `${id}:t${i}`, kind: "video" as const, name: `Layer ${layers.length - i}`, muted: false }));
  const clips: Clip[] = layers.map((layer, i) => ({
    id: `${id}:c${i}`,
    assetId: layer.assetId ?? "",
    trackId: tracks[i].id,
    start: 0,
    in: 0,
    out: FOREVER,
    effects: layer.effects,
    ...(layer.adjustment && { adjustment: true as const }),
  }));
  return { id, name: look.name, settings: { aspectRatio: "16:9", fps: LIVE_FPS }, tracks, clips, duration: FOREVER };
}

/** The clip showing `sequence` from `start`, coming in through `transition` (none: a cut). */
export function showClip(sequence: Sequence, start: number, transition: Transition | null): Clip {
  // A transition centred on the cut shows the look half its length before it starts: room for that.
  const lead = transition ? transition.duration : 0;
  return {
    id: `show:${sequence.id}`,
    assetId: sequence.id,
    trackId: LOOKS_TRACK,
    start,
    in: lead,
    out: FOREVER,
    effects: defaultEffects(),
    ...(transition && { transitionIn: { ...transition, alignment: "center" as const } }),
  };
}

/** A shown look's clip ending at `time` (where the next one takes over). */
export function endShow(clip: Clip, time: number): Clip {
  return { ...clip, out: clip.in + Math.max(0.1, time - clip.start) };
}

/** The transitions looks switch through: quick, and made for music videos. */
export const SWITCHES = ["cross-zoom", "flash", "glitch", "datamosh", "swirl", "liquid", "kaleidoscope", "light-leak", "additive-dissolve", "rgb-split", "whip", "zoom-out"] as const;

/** A switch's transition, `seconds` long. */
export function switchTransition(type: string, seconds: number): Transition {
  return createTransition(type, seconds);
}

// ---------------------------------------------------------------------------
// The keys' punches (Perform)
// ---------------------------------------------------------------------------

/** What a key can hit: the picture punching in, a flash, the colours splitting, a twist. */
export type Pad = "zoom" | "flash" | "split" | "twist";
const PAD_SIGNAL: Record<Pad, OnsetName> = { zoom: "onsetLow", flash: "onset", split: "onsetMid", twist: "onsetHigh" };
const padRef = (pad: Pad): SignalRef => ({ name: PAD_SIGNAL[pad], source: { kind: "track", trackId: PADS_TRACK } });

/** A hit of a pad: when (session seconds) and how hard. */
export interface PadHit {
  pad: Pad;
  time: number;
  velocity: number;
}

/** The pads' hits as a sound's signals (hits only), for the perform layer's links to read. */
export function padSignals(hits: readonly PadHit[]): SignalData {
  const byName = Object.fromEntries(ONSET_SCALARS.map((name) => [name, [] as Hit[]])) as Record<OnsetName, Hit[]>;
  for (const hit of hits) byName[PAD_SIGNAL[hit.pad]].push([hit.time, hit.velocity]);
  for (const name of ONSET_SCALARS) byName[name].sort((a, b) => a[0] - b[0]);
  return {
    header: {
      version: SIGNALS_VERSION,
      rate: SIGNAL_RATE,
      frames: 0,
      duration: FOREVER,
      bandEdges: bandEdges(),
      scalars: [...SCALARS],
      reference: {},
      bandReference: [],
      hits: byName,
      rhythm: null,
      waveRate: 8000,
      waveSamples: 0,
    },
    scalars: new Float32Array(0),
    bands: new Uint8Array(0),
    wave: new Int8Array(0),
  };
}

/** The perform layer (an adjustment over every look): the pads' punches, and the colours turned by `hue` degrees. */
export function performLayer(hue: number): Clip {
  const hit = (pad: Pad, mode: ParamLink["mode"], amount: number, decay: number): ParamLink => ({
    signal: padRef(pad),
    mode,
    amount,
    response: DEFAULT_RESPONSE,
    hit: { attack: 0.004, hold: 0.02, decay },
  });
  const effects = withIds([
    ...tweakBuiltIn(defaultEffects(), "motion", {}, { scale: hit("zoom", "multiply", 0.22, 0.32), rotation: hit("twist", "add", 9, 0.45) }),
    fx("twirl", { angle: 0, reach: 0.6 }, { angle: hit("twist", "add", 140, 0.5) }),
    fx("rgb-split", { amount: 0 }, { amount: hit("split", "add", 0.035, 0.3) }),
    fx("flash", { amount: 0, exposure: 1.2, bloom: 0.6 }, { amount: hit("flash", "add", 0.85, 0.22) }),
    fx("hue-saturation", { hue: ((Math.round(hue) % 360) + 540) % 360 - 180, saturation: 1, lightness: 0 }),
  ]);
  return { id: "perform", assetId: "", trackId: PERFORM_TRACK, start: 0, in: 0, out: FOREVER, effects, adjustment: true };
}

// ---------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------

export type LookKind = "spectrum" | "world" | "trip" | "chaos";

export const LOOK_KINDS: { id: LookKind; label: string }[] = [
  { id: "world", label: "Worlds" },
  { id: "spectrum", label: "Spectrums" },
  { id: "trip", label: "Trips" },
  { id: "chaos", label: "Chaos" },
];

/**
 * What a look suits (step 5 of docs/now-playing.md): the kinds of song (`LiveMood`'s characters) and the intensities
 * (0..1) it reads well at, and whether it's minimal (for between songs, and before a song's kind is known).
 */
export interface LookSuits {
  characters: SongCharacter[];
  energy: [number, number];
  minimal?: true;
}

export interface LiveLook {
  id: string;
  name: string;
  kind: LookKind;
  suits: LookSuits;
  /** Its layers, top first. */
  layers(ctx: LookContext): LookLayer[];
  /** How it goes off with the music, where its kind's (`ENERGY`) doesn't suit it. */
  energy?: Partial<Energy>;
}

/**
 * How a look goes off as the music gets intense (step 3 of docs/now-playing.md), at full intensity: the whole picture
 * punching in on kicks (`punch`, Motion's scale), the camera shaking (`shake`, once it's intense), a strobe on snares
 * (`strobe`, in drops), the colours splitting on snares (`split`), an inverted flash on each bar's first beat
 * (`invert`, at the very top only), and it brightening and saturating (`lift`). Calm, it's dimmer, still, plainer.
 */
export interface Energy {
  punch: number;
  shake: number;
  strobe: number;
  split: number;
  invert: number;
  lift: number;
}

const ENERGY: Record<LookKind, Energy> = {
  world: { punch: 0.1, shake: 0.45, strobe: 0.2, split: 0.01, invert: 0, lift: 1 },
  spectrum: { punch: 0.14, shake: 0.3, strobe: 0.3, split: 0.016, invert: 0, lift: 1 },
  trip: { punch: 0.2, shake: 0.7, strobe: 0.4, split: 0.028, invert: 0.75, lift: 1 },
  chaos: { punch: 0.14, shake: 0.4, strobe: 0.25, split: 0.016, invert: 0, lift: 1 },
};

/** A 3D scene (it draws the whole frame), coloured by the song and glowing on the bass. */
function world(type: string, params: ParamValues, p: AlbumPalette, r: () => number, opts: { tint?: number; glow?: number } = {}): LookLayer[] {
  return [
    adjust([
      tint(p, opts.tint ?? between(r, 0.35, 0.6)),
      fx("glow", { threshold: 0.6, reach: 0.04, intensity: opts.glow ?? 0.6 }, { intensity: follow(BASS, "add", 0.9) }),
      fx("vignette", { amount: 0.45, size: 0.55, feather: 0.7 }),
    ]),
    // The world moves faster and reacts harder the more intense the music is (calm: it drifts).
    solid(
      "#000000",
      [fx(type, { blendMode: "replace", speed: between(r, 0.6, 0.8), reactivity: 0.7, ...params }, { speed: follow(INTENSITY, "multiply", 1, 1), reactivity: follow(INTENSITY, "multiply", 0.6, 1) })],
      { motion: { links: { scale: punch(KICK, "multiply", 0.035, 0.3) } } },
    ),
  ];
}

/** A look's energy (`Energy`): an adjustment over all of it. */
function energyLayer(e: Energy): LookLayer {
  return adjust(
    [
      fx("camera-shake", { strength: 0, speed: 1.4 }, { strength: follow(INTENSITY, "add", e.shake, 0.6, 0.6) }),
      fx("audio-strobe", { hits: "snares", mode: "flash", amount: 0, decay: 0.08 }, { amount: follow(INTENSITY, "add", e.strobe, 0.6, 0.72) }),
      fx("rgb-split", { amount: 0 }, { amount: punch(SNARE, "add", e.split, 0.18, intense(0, 0.4)) }),
      ...(e.invert > 0 ? [fx("invert", { amount: 0 }, { amount: punch(DOWNBEAT, "add", e.invert, 0.12, intense(0, 0.85)) })] : []),
      // In stops (a gain, not an offset): calm, the faint trails are dimmer but still there; a drop isn't pushed to white.
      fx("exposure", { exposure: -0.4 }, { exposure: follow(INTENSITY, "add", 0.5 * e.lift, 0.8) }),
      fx("hue-saturation", { hue: 0, saturation: 0.8, lightness: 0 }, { saturation: follow(INTENSITY, "add", 0.5 * e.lift, 0.8) }),
    ],
    { motion: { links: { scale: punch(KICK, "multiply", e.punch, 0.28, intense(0.1, 0.25)) } } },
  );
}

export const LIVE_LOOKS: LiveLook[] = [
  // Worlds: the 3D scenes, in the song's colours.
  {
    id: "nebula",
    name: "Nebula",
    kind: "world",
    suits: { characters: ["chill", "groove"], energy: [0, 0.7] },
    layers: ({ palette: p, random: r }) => world("nebula", { palette: pick(r, ["hubble", "cosmic", "natural"]), density: between(r, 0.8, 1.2) }, p, r),
  },
  {
    id: "wormhole",
    name: "Wormhole",
    kind: "world",
    suits: { characters: ["hype", "heavy"], energy: [0.45, 1] },
    layers: ({ palette: p, random: r }) => world("wormhole", { palette: pick(r, ["stargate", "plasma", "inferno"]), jumps: pick(r, ["bars4", "bars8", "drops"]) }, p, r),
  },
  {
    id: "neon-city",
    name: "Neon City",
    kind: "world",
    suits: { characters: ["groove", "hype"], energy: [0.3, 1] },
    layers: ({ palette: p, random: r }) => world("neon-city", { palette: pick(r, ["cyberpunk", "bladerunner", "tokyo"]), rain: between(r, 0.6, 1.2) }, p, r, { tint: between(r, 0.25, 0.45) }),
  },
  {
    id: "event-horizon",
    name: "Event Horizon",
    kind: "world",
    suits: { characters: ["groove", "heavy"], energy: [0.25, 0.9] },
    layers: ({ palette: p, random: r }) => world("event-horizon", { disk: pick(r, ["gargantua", "blue", "ember"]), inclination: between(r, 12, 30, 0) }, p, r),
  },
  {
    id: "galaxy",
    name: "Galaxy",
    kind: "world",
    suits: { characters: ["chill", "groove"], energy: [0, 0.7] },
    layers: ({ palette: p, random: r }) => [
      drawing("audio-circle", { radius: 0.26, barLength: 0.08, bars: 160, mirror: true, pulse: 0.1, gap: 0.5, color: p.light, color2: p.accent }, [], { opacity: { params: { opacity: 0.55, blendMode: "screen" } } }),
      ...world("galaxy", { palette: pick(r, ["hubble", "andromeda", "neon"]), arms: pick(r, ["two", "three", "four"]) }, p, r),
    ],
  },
  {
    id: "aurora",
    name: "Aurora",
    kind: "world",
    suits: { characters: ["chill"], energy: [0, 0.6] },
    layers: ({ palette: p, random: r }) => world("aurora", { colors: pick(r, ["classic", "violet", "fire"]), height: between(r, 0.8, 1.2) }, p, r, { tint: between(r, 0.4, 0.65) }),
  },
  {
    id: "ridgeline",
    name: "Ridgeline",
    kind: "world",
    suits: { characters: ["groove", "hype"], energy: [0.3, 1] },
    layers: ({ palette: p, random: r }) => world("ridgeline", { style: pick(r, ["dusk", "neon", "night"]), sunHeight: between(r, 0.25, 0.4) }, p, r),
  },
  {
    id: "abyss",
    name: "Abyss",
    kind: "world",
    suits: { characters: ["chill", "groove"], energy: [0, 0.65] },
    layers: ({ palette: p, random: r }) => world("abyss", { glow: pick(r, ["cyan", "magenta", "gold", "rainbow"]), jellies: Math.round(between(r, 5, 9)) }, p, r),
  },
  {
    id: "cyberspace",
    name: "Cyberspace",
    kind: "world",
    suits: { characters: ["groove", "hype"], energy: [0.4, 1] },
    layers: ({ palette: p, random: r }) => world("cyberspace", { style: pick(r, ["tron", "matrix", "synthwave", "redalert"]) }, p, r, { tint: between(r, 0.3, 0.55) }),
  },
  {
    id: "ferrofluid",
    name: "Ferrofluid",
    kind: "world",
    suits: { characters: ["groove", "heavy"], energy: [0.3, 1] },
    layers: ({ palette: p, random: r }) => world("ferrofluid", { finish: pick(r, ["oil", "chrome", "gold"]), spikes: between(r, 0.9, 1.3) }, p, r, { tint: between(r, 0.45, 0.7) }),
  },
  {
    id: "monoliths",
    name: "Monoliths",
    kind: "world",
    suits: { characters: ["heavy"], energy: [0.35, 1] },
    layers: ({ palette: p, random: r }) => world("monoliths", { style: pick(r, ["obsidian", "synth"]) }, p, r, { glow: 0.35 }),
  },
  {
    id: "storm-sea",
    name: "Storm Sea",
    kind: "world",
    suits: { characters: ["chill", "heavy"], energy: [0, 0.75] },
    layers: ({ palette: p, random: r }) => world("storm-sea", { weather: "storm", waveHeight: between(r, 0.9, 1.3) }, p, r, { tint: between(r, 0.3, 0.5), glow: 0.35 }),
  },
  {
    id: "cosmic-web",
    name: "Cosmic Web",
    kind: "world",
    suits: { characters: ["chill", "groove"], energy: [0.1, 0.8] },
    layers: ({ palette: p, random: r }) => world("cosmic-web", { style: pick(r, ["cosmic", "neural", "dark"]) }, p, r),
  },
  {
    id: "infinite-dive",
    name: "Infinite Dive",
    kind: "world",
    suits: { characters: ["hype", "heavy"], energy: [0.5, 1] },
    layers: ({ palette: p, random: r }) => world("infinite-dive", { form: pick(r, ["portals", "lattice", "spires"]), palette: pick(r, ["iridescent", "gold", "ice", "ember"]) }, p, r),
  },
  {
    id: "collider",
    name: "Collider",
    kind: "world",
    suits: { characters: ["hype", "heavy"], energy: [0.5, 1] },
    layers: ({ palette: p, random: r }) => world("collider", { style: pick(r, ["display", "neon", "bubble"]) }, p, r, { tint: between(r, 0.4, 0.6) }),
  },

  // Spectrums: the sound drawn plainly, made to glow.
  {
    id: "album",
    name: "Album",
    kind: "spectrum",
    suits: { characters: ["chill", "groove", "hype", "heavy"], energy: [0, 0.65], minimal: true },
    energy: { shake: 0.15, strobe: 0.15 },
    layers: ({ palette: p, random: r }) => [
      adjust([fx("deep-glow", { reach: 0.18, exposure: 0.6, threshold: 0.7, tint: p.accent, tintAmount: 0.3 }, { exposure: follow(BASS, "add", 0.6) }), fx("vignette", { amount: 0.45 })]),
      drawing("audio-circle", { radius: 0.235, barLength: 0.14, bars: 144, gap: 0.45, mirror: true, pulse: 0.06, color: p.primary, color2: p.accent }, [], {
        motion: { links: { scale: punch(KICK, "multiply", 0.05, 0.25) } },
      }),
      coverLayer([fx("drop-shadow", { shadowOpacity: 0.7, shadowDistance: 0.012, softness: 0.03 })], { motion: { params: { scale: 0.42 }, links: { scale: punch(KICK, "multiply", 0.05, 0.25) } } }),
      // The cover again, behind everything: huge, blurred, dark, turning slowly.
      coverLayer(
        [fx("gaussian-blur", { blurriness: 0.06 }), fx("brightness-contrast", { brightness: -0.35, contrast: 0.1 }), fx("hue-saturation", { hue: 0, saturation: 1.35, lightness: 0 })],
        { motion: { params: { scale: 2.1, rotation: between(r, -20, 20, 0) }, links: { scale: follow(BASS, "multiply", 0.06, 0.4) } } },
      ),
    ],
  },
  {
    id: "halo",
    name: "Halo",
    kind: "spectrum",
    suits: { characters: ["chill", "groove"], energy: [0, 0.7], minimal: true },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("deep-glow", { reach: 0.22, exposure: 0.8, threshold: 0.5, tint: p.accent, tintAmount: 0.35 }, { exposure: follow(BASS, "add", 0.9) }),
        fx("vignette", { amount: 0.5 }),
      ]),
      drawing("audio-burst", { hits: "kicks", count: 40, spread: 0.62, life: 1.1, particleSize: 0.005, gravity: 0.05, color: p.light, color2: p.accent }),
      drawing("audio-ring", { radius: 0.15, amplitude: 0.05, thickness: 0.004, pulse: 0.3, glow: 0.8, color: p.light }),
      drawing("audio-circle", { radius: 0.19, barLength: 0.2, bars: 128, gap: 0.4, mirror: true, pulse: 0.25, spin: between(r, -12, 12, 0), color: p.primary, color2: p.accent }, [], {
        motion: { links: { scale: punch(KICK, "multiply", 0.07, 0.28) } },
      }),
      backdrop(p),
    ],
  },
  {
    id: "skyline",
    name: "Skyline",
    kind: "spectrum",
    suits: { characters: ["groove", "hype"], energy: [0.25, 1] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("light-rays", { centre: [0.5, 0.5], intensity: 0.35, reach: 0.25, threshold: 0.7, rayColor: p.accent }, { intensity: follow(BASS, "add", 0.5) }),
        fx("glow", { threshold: 0.6, reach: 0.03, intensity: 0.5 }),
      ]),
      drawing("audio-bars", { center: [0.5, 0.5], width: 0.9, height: 0.42, boost: 0.7, bars: Math.round(between(r, 48, 72)), gap: 0.4, mirror: true, peaks: true, rounded: true, color: p.primary, color2: p.accent }, [], {
        motion: { links: { scale: punch(KICK, "multiply", 0.03, 0.2) } },
      }),
      backdrop(p),
    ],
  },
  {
    id: "equalizer",
    name: "Equalizer",
    kind: "spectrum",
    suits: { characters: ["groove", "hype", "heavy"], energy: [0.3, 1] },
    layers: ({ palette: p, random: r }) => [
      adjust([fx("glow", { threshold: 0.65, reach: 0.03, intensity: 0.4 }, { intensity: follow(BASS, "add", 0.5) }), fx("feedback", { amount: 0.45, trailLength: 0.25, zoom: 1, rotation: 0, drift: [0, -0.3], mode: "lighten" })]),
      drawing("audio-wave-bars", { bars: Math.round(between(r, 64, 96)), center: [0.5, 0.6], height: 0.42, boost: 0.75, hueSpread: between(r, 0, 25, 0), hueDrift: 0, hueReact: 10, glow: 0.35, color: p.primary, color2: p.accent }),
      backdrop(p),
    ],
  },
  {
    id: "sunburst",
    name: "Sunburst",
    kind: "spectrum",
    suits: { characters: ["groove", "hype"], energy: [0.35, 1] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("deep-glow", { reach: 0.22, exposure: 0.45, threshold: 0.75, tint: p.secondary, tintAmount: 0.3 }),
        fx("feedback", { amount: 0.6, trailLength: 0.3, zoom: 1.12, rotation: between(r, 10, 25, 0), hueShift: 0, mode: "lighten" }),
      ]),
      drawing("audio-radial", { size: 0.4, boost: 0.8, spokes: Math.round(between(r, 60, 96)), spin: between(r, 10, 30, 0), hueSpread: between(r, 0, 40, 0), hueDrift: 0, thickness: 1, color: p.secondary, color2: p.primary }, [], {
        motion: { links: { scale: punch(KICK, "multiply", 0.06, 0.25) } },
      }),
      solid("#000000"),
    ],
  },
  {
    id: "ribbons",
    name: "Ribbons",
    kind: "spectrum",
    suits: { characters: ["chill", "groove"], energy: [0.05, 0.75] },
    layers: ({ palette: p, random: r }) => [
      adjust([fx("glow", { threshold: 0.55, reach: 0.03, intensity: 0.6 }), fx("feedback", { amount: 0.6, trailLength: 0.45, zoom: 1.03, rotation: 0, drift: [0, 0.12], mode: "lighten" })]),
      drawing("audio-ribbons", { ribbons: Math.round(between(r, 5, 8)), swing: between(r, 0.7, 1.2), thickness: 0.8, boost: 0.8, hueDrift: 0, hueReact: 10, color: p.primary, color2: p.secondary }),
      backdrop(p),
    ],
  },
  {
    id: "scope",
    name: "Scope",
    kind: "spectrum",
    suits: { characters: ["chill", "groove"], energy: [0, 0.55], minimal: true },
    energy: { shake: 0.15 },
    layers: ({ palette: p }) => [
      adjust([fx("crt", { scanlines: 0.4, curvature: 0.2, mask: 0.3, glow: 0.6, flicker: 0.1 }), fx("glow", { threshold: 0.4, reach: 0.03, intensity: 1.1 })]),
      drawing("audio-oscilloscope", { center: [0.5, 0.72], width: 0.95, height: 0.22, gain: 1.6, thickness: 0.004, glow: 0.7, color: p.secondary }),
      drawing("audio-vectorscope", { center: [0.5, 0.38], scale: 0.3, gain: 1.6, thickness: 0.003, glow: 0.9, color: p.primary }, [fx("feedback", { amount: 1, trailLength: 0.25, zoom: 1, rotation: 0, mode: "lighten" })]),
      solid(p.background),
    ],
  },
  {
    id: "ridges",
    name: "Ridges",
    kind: "spectrum",
    suits: { characters: ["chill", "groove", "heavy"], energy: [0.15, 0.85] },
    energy: { shake: 0.2 },
    layers: ({ palette: p, random: r }) => [
      adjust([fx("glow", { threshold: 0.55, reach: 0.03, intensity: 0.6 }), fx("vignette", { amount: 0.55 })]),
      // The spectrum's line, its past drifting up behind it: a range of ridges, the newest in front.
      drawing("audio-line", { center: [0.5, 0.86], width: 0.7, height: 0.22, boost: 0.85, thickness: 0.003, fill: 0, mirror: false, color: p.light, color2: p.primary }, [
        fx("feedback", { amount: 1, trailLength: between(r, 1.6, 2.4), zoom: 0.92, rotation: 0, drift: [0, -0.32], mode: "lighten" }),
        tint(p, 0.55, p.primary),
      ]),
      backdrop(p),
    ],
  },
  {
    id: "lattice",
    name: "Lattice",
    kind: "spectrum",
    suits: { characters: ["hype", "heavy"], energy: [0.45, 1] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("glow", { threshold: 0.5, reach: 0.04, intensity: 0.8 }),
        fx("rgb-split", { amount: 0.002 }, { amount: punch(SNARE, "add", 0.02, 0.2) }),
        fx("vignette", { amount: 0.5 }),
      ]),
      drawing("audio-lattice", { columns: Math.round(between(r, 14, 22)), rows: Math.round(between(r, 8, 12)), boost: 0.6, hueDrift: 0, hueReact: 12, color: p.primary, color2: p.secondary }),
      solid("#000000"),
    ],
  },

  // Trips: vaudio's world presets, a visualizer fed back into itself.
  {
    id: "liquid-chrome",
    name: "Liquid Chrome",
    kind: "trip",
    suits: { characters: ["groove", "hype"], energy: [0.3, 1] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("twirl", { angle: between(r, 40, 90, 0), reach: 0.7 }, { angle: follow(BASS, "add", 90, 0.3) }),
        fx("wave-warp", { amplitude: 0.012, wavelength: 0.35, speed: 0.8 }),
        fx("chromatic-aberration", { amount: 0.006 }, { amount: punch(SNARE, "add", 0.02, 0.2) }),
        fx("audio-hue", { drive: "beat", amount: 40, saturation: 0.3 }),
        fx("feedback", { amount: 0.75, trailLength: 0.5, zoom: 1.12, rotation: 6, hueShift: 15, mode: "lighten" }),
        fx("glow", { threshold: 0.65, reach: 0.03, intensity: 0.5 }),
      ]),
      drawing("audio-radial", { size: 0.34, boost: 0.8, spokes: 90, spin: 25, hueSpread: 30, hueDrift: 0, thickness: 1.2, color: p.primary, color2: p.secondary }),
      solid("#000000"),
    ],
  },
  {
    id: "echo-tunnel",
    name: "Echo Tunnel",
    kind: "trip",
    suits: { characters: ["hype", "heavy"], energy: [0.4, 1] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx(
          "feedback",
          { amount: 1, trailLength: between(r, 1, 1.6), zoom: between(r, 1.4, 1.8), rotation: between(r, 15, 35, 0) * (r() < 0.5 ? -1 : 1), hueShift: between(r, 6, 16, 0), mode: "lighten" },
          { zoom: follow(INTENSITY, "multiply", 0.5, 1), rotation: follow(INTENSITY, "multiply", 0.8, 1) },
        ),
        fx("chromatic-aberration", { amount: 0.006 }, { amount: punch(SNARE, "add", 0.02, 0.2) }),
        fx("glow", { threshold: 0.5, reach: 0.04, intensity: 0.8 }),
        fx("vignette", { amount: 0.5 }),
      ]),
      drawing("audio-tunnel", { rings: 14, size: 0.7, wobble: 1.2, hueDrift: 0, hueReact: 12, color: p.primary, color2: p.accent }, [], { motion: { links: { scale: punch(KICK, "multiply", 0.12, 0.3) } } }),
      solid("#000000"),
    ],
  },
  {
    id: "kaleido-cathedral",
    name: "Kaleido Cathedral",
    kind: "trip",
    suits: { characters: ["chill", "groove"], energy: [0.15, 0.8] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("kaleida", { mirroring: pick(r, ["6", "8", "12"]), size: between(r, 0.8, 1.3) }, { rotation: punch(DOWNBEAT, "add", 30, 1.2) }),
        fx("feedback", { amount: 0.85, trailLength: 0.8, zoom: 1.3, rotation: 8, hueShift: 12, mode: "lighten" }, { rotation: follow(INTENSITY, "multiply", 1.5, 1) }),
        fx("glow", { threshold: 0.5, reach: 0.04, intensity: 0.9 }),
      ]),
      drawing("audio-burst", { hits: "any", count: 24, spread: 0.5, life: 0.8, particleSize: 0.01, color: p.light, color2: p.accent }),
      drawing("audio-line", { center: [0.5, 0.5], width: 0.9, height: 0.5, mirror: true, fill: 0.5, thickness: 0.006, color: p.primary, color2: p.secondary }),
      solid(p.background),
    ],
  },
  {
    id: "shard-storm",
    name: "Shard Storm",
    kind: "trip",
    suits: { characters: ["hype", "heavy"], energy: [0.45, 1] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        // Under 100%, so the mirrors take in more of the shards (over it, a quiet moment's few are outside).
        fx("kaleida", { mirroring: pick(r, ["4", "6"]), size: between(r, 0.7, 0.95) }),
        fx("feedback", { amount: 0.5, trailLength: 0.6, zoom: 1.4, rotation: between(r, -40, 40, 0), hueShift: 20, mode: "lighten" }),
        fx("vignette", { amount: 0.5 }),
      ]),
      // A quiet shard would be a faint sliver: at rest they're still there, drifting.
      drawing("audio-shards", { shards: 30, shardSize: between(r, 1.1, 1.4), boost: 0.8, rest: 0.3, hueSpread: between(r, 0, 60, 0), hueDrift: 0, color: p.primary, color2: p.secondary }),
      solid("#000000"),
    ],
  },
  {
    id: "vhs-seance",
    name: "VHS Séance",
    kind: "trip",
    suits: { characters: ["chill", "groove"], energy: [0.05, 0.75] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("vhs", { intensity: 0.5, scanlines: 0.5 }),
        fx("rgb-split", { amount: 0.004 }, { amount: punch(SNARE, "add", 0.02, 0.2) }),
        fx("film-grain", { amount: 0.2 }),
        fx("feedback", { amount: 0.75, trailLength: 0.7, zoom: 1.06, rotation: between(r, -6, 6, 0), mode: "lighten" }),
        fx("vignette", { amount: 0.6 }),
      ]),
      drawing("audio-ribbons", { ribbons: 5, swing: 1.4, thickness: 1.6, hueDrift: 0, hueReact: 10, color: p.primary, color2: p.light }),
      solid(p.background),
    ],
  },
  {
    id: "acid-bath",
    name: "Acid Bath",
    kind: "trip",
    suits: { characters: ["chill", "groove"], energy: [0.1, 0.65] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("wave-warp", { amplitude: 0.02, wavelength: 0.3, speed: 1.2 }),
        fx("ripple", { radius: 0.8, waveHeight: 0.01, waveWidth: 0.1, speed: 1.4 }),
        fx("audio-hue", { drive: "beat", amount: 40, saturation: 0.2 }),
        fx("feedback", { amount: 0.35, trailLength: 0.4, zoom: 1.15, rotation: between(r, -25, 25, 0), hueShift: 40, mode: "lighten" }),
      ]),
      // The whole frame, so its hot colour is the secondary: the accent everywhere is white in a drop.
      // Held back: on a loud song the plasma is at its hottest everywhere, one flat colour.
      drawing("audio-plasma", { boost: 0.55, pixelSize: pick(r, [0, 0.008, 0.014]), speed: between(r, 0.8, 1.3), hueSpread: 40, hueDrift: 0, color: p.primary, color2: p.secondary }, [], {
        motion: { links: { scale: punch(KICK, "multiply", 0.05, 0.3) } },
      }),
      solid(p.background),
    ],
    energy: { lift: 0.4 },
  },
  {
    id: "ghost-trails",
    name: "Ghost Trails",
    kind: "trip",
    suits: { characters: ["chill"], energy: [0, 0.55], minimal: true },
    energy: { strobe: 0, invert: 0, shake: 0.3 },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("feedback", { amount: 1, trailLength: between(r, 2.5, 4), zoom: 1.04, rotation: between(r, -5, 5, 0), mode: "lighten" }),
        fx("hue-saturation", { hue: 0, saturation: 0.7, lightness: 0 }),
        fx("film-grain", { amount: 0.2 }),
        fx("vignette", { amount: 0.6 }),
      ]),
      drawing("audio-ring", { radius: 0.24, amplitude: 0.12, thickness: 0.003, pulse: 0.15, glow: 0.4, color: p.light }),
      drawing("audio-oscilloscope", { center: [0.5, 0.5], width: 1.1, height: 0.4, gain: 2, thickness: 0.003, glow: 0.4, color: p.primary }),
      solid("#000000"),
    ],
  },
  {
    id: "neon-autopsy",
    name: "Neon Autopsy",
    kind: "trip",
    suits: { characters: ["groove", "heavy"], energy: [0.3, 0.9] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("glow-edges", { edgeWidth: 0.0025, glow: 1.2, edgeColor: p.accent, darken: 0.85 }),
        fx("kaleida", { mirroring: "4", size: between(r, 1, 1.6) }),
        fx("rgb-split", { amount: 0.004 }, { amount: punch(SNARE, "add", 0.03, 0.2) }),
      ]),
      drawing("cell-pattern", { cellType: "crystals", cellSize: between(r, 0.12, 0.22), contrast: 1.6 }, [tint(p, 1)], { motion: { links: { scale: punch(KICK, "multiply", 0.1, 0.3) } } }),
    ],
  },
  {
    id: "prism-storm",
    name: "Prism Storm",
    kind: "trip",
    suits: { characters: ["hype"], energy: [0.45, 1] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("chromatic-aberration", { amount: 0.01, mode: "radial" }, { amount: punch(SNARE, "add", 0.04, 0.25) }),
        fx("feedback", { amount: 0.9, trailLength: 0.9, zoom: 1.5, rotation: between(r, 25, 60, 0), hueShift: 15, mode: "add" }),
        fx("glow", { threshold: 0.5, reach: 0.05, intensity: 1 }),
      ]),
      drawing("audio-burst", { hits: "hats", count: 18, spread: 0.7, life: 0.5, particleSize: 0.004, color: p.light, color2: p.secondary }),
      drawing("audio-circle", { radius: 0.05, barLength: 0.3, bars: 48, gap: 0.6, mirror: false, spin: 60, color: p.accent, color2: p.primary }),
      solid("#000000"),
    ],
  },
  {
    id: "solar-flare",
    name: "Solar Flare",
    kind: "trip",
    suits: { characters: ["groove", "hype"], energy: [0.3, 1] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("light-rays", { intensity: 1.1, reach: 0.45, threshold: 0.5, rayColor: p.accent }, { intensity: follow(BASS, "add", 1) }),
        fx("deep-glow", { reach: 0.3, exposure: 0.8, threshold: 0.6, tint: p.primary, tintAmount: 0.4 }),
        fx("feedback", { amount: 0.7, trailLength: 0.5, zoom: 1.2, rotation: between(r, -10, 10, 0), mode: "lighten" }),
      ]),
      drawing("audio-orbs", { orbs: 24, orbSize: 1.1, spread: 0.9, hueDrift: 0, hueReact: 15, color: p.primary, color2: p.accent }, [], { motion: { links: { scale: punch(KICK, "multiply", 0.08, 0.3) } } }),
      backdrop(p),
    ],
  },
  {
    id: "hyperdrive",
    name: "Hyperdrive",
    kind: "trip",
    suits: { characters: ["hype", "heavy"], energy: [0.5, 1] },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("zoom-blur", { amount: 0.15 }, { amount: punch(KICK, "add", 0.25, 0.3) }),
        fx("feedback", { amount: 0.85, trailLength: 0.6, zoom: between(r, 1.8, 2.4), rotation: between(r, -20, 20, 0), hueShift: 10, mode: "lighten" }, { zoom: follow(INTENSITY, "multiply", 0.25, 1) }),
        fx("rgb-split", { amount: 0.003 }, { amount: punch(KICK, "add", 0.02, 0.2) }),
        fx("vignette", { amount: 0.4 }),
      ]),
      drawing("audio-tunnel", { rings: 10, size: 0.35, wobble: 0.6, hueDrift: 0, hueReact: 10, color: p.accent, color2: p.primary }),
      solid("#000000"),
    ],
    energy: { lift: 0.5 },
  },
  {
    id: "deep-void",
    name: "Deep Void",
    kind: "trip",
    suits: { characters: ["chill", "heavy"], energy: [0, 0.6], minimal: true },
    energy: { strobe: 0.1, invert: 0 },
    layers: ({ palette: p, random: r }) => [
      adjust([
        fx("feedback", { amount: 1, trailLength: 3, zoom: 1.35, rotation: between(r, -8, 8, 0), hueShift: 8, mode: "lighten" }),
        fx("vignette", { amount: 0.8, size: 0.35, feather: 0.8 }),
      ]),
      drawing("radio-waves", { frequency: 0.5, expansion: 0.25, lifespan: 3, strokeWidth: 0.004, softness: 0.4, color: p.primary }, [], { opacity: { links: { opacity: follow(LEVEL, "multiply", 0.5) } } }),
      drawing("audio-ring", { radius: 0.06, amplitude: 0.04, thickness: 0.003, pulse: 0.6, glow: 0.9, color: p.accent }),
      solid("#000000"),
    ],
  },
];

// Chaos: vaudio's recipes, a roll of one each song and each M (`live-chaos.ts`).
LIVE_LOOKS.push(...CHAOS_LOOKS);

const byId = new Map(LIVE_LOOKS.map((l) => [l.id, l]));
export const liveLook = (id: string): LiveLook | undefined => byId.get(id);
