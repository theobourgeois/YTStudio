/**
 * The vibe of what's playing (docs/now-playing.md, "The vibe"): what CLAP (LAION's audio–text model, run on this
 * computer) hears in ten seconds of it. CLAP turns sound and text into points in one space, near when they match;
 * so the sound is placed on axes, each two opposite descriptions ("calm, quiet, relaxing music" against "intense,
 * loud, energetic music"), by which end it's nearer, centred on how real music reads (a description near every sound
 * would otherwise always win), and among genres by which it's nearest. The text side was run once
 * (`scripts/clap-vibe.ts`, `vibe.json`); the app runs only the audio side. Pure.
 */
import type { ModelSpec } from "../models.ts";
import type { SongCharacter } from "./mood.ts";

/** The model: LAION's larger CLAP, trained on music and speech (Apache-2.0), as Xenova's ONNX export. */
export const VIBE_MODEL = {
  repo: "Xenova/larger_clap_music_and_speech",
  revision: "e9fd5ac1dbf3280936a7fc3ec8a020453ff184db",
} as const;

/** Its audio side, which the tab runs (`src/lib/vibe.ts`): downloaded once, when the user says yes. */
export const VIBE_MODEL_SPEC: ModelSpec = {
  command: "Hear the vibe",
  does: "hears each song's vibe (how intense, bright, aggressive and fast it is, and its genre) with an audio model (CLAP)",
  files: [
    {
      name: "CLAP's audio model (LAION's larger CLAP for music and speech)",
      file: "clap-music-speech-audio.onnx",
      url: `https://huggingface.co/${VIBE_MODEL.repo}/resolve/${VIBE_MODEL.revision}/onnx/audio_model.onnx`,
      size: 281_749_092,
      sha256: "3ecc72d27740e2a09ced20cf22fd6244122e5e506008763a0f368b3b4ff6eac8",
    },
  ],
};

/** The axes: each two opposite descriptions; a sound's place on one is -1 (the low end) to 1 (the high). */
export const VIBE_AXES = {
  energy: { low: "calm, quiet, relaxing music", high: "intense, loud, energetic music" },
  mood: { low: "sad, dark, melancholic music", high: "happy, bright, uplifting music" },
  force: { low: "soft, gentle, smooth music", high: "aggressive, harsh, distorted music" },
  pace: { low: "slow music", high: "fast music" },
  space: { low: "dry, punchy, in-your-face music", high: "dreamy, atmospheric, spacious music" },
  dance: { low: "free-flowing music with no steady beat", high: "music with a steady, danceable groove" },
} as const;
export type VibeAxis = keyof typeof VIBE_AXES;
export const VIBE_AXIS_NAMES = Object.keys(VIBE_AXES) as VibeAxis[];

/** The genres it's placed among. */
export const VIBE_GENRES: { name: string; prompt: string }[] = [
  "ambient", "lo-fi", "hip hop", "trap", "drill", "R&B", "soul", "pop", "indie", "house", "techno", "EDM", "dubstep",
  "drum and bass", "funk", "disco", "reggae", "rock", "metal", "punk", "jazz", "classical", "folk", "piano ballad",
].map((name) => ({ name, prompt: `${name} music` }));

/** What the text side made (`vibe.json`): each axis's ends and centre, each genre's point. */
export interface VibeData {
  model: string;
  axes: Record<VibeAxis, { low: number[]; high: number[]; mean: number; spread: number }>;
  genres: { name: string; embedding: number[] }[];
  /** The songs the axes were centred on. */
  calibration: string[];
}

export interface Vibe {
  /** Each axis, -1..1: towards its low or high end, against the music the axes were centred on (±1 is two spreads). */
  axes: Record<VibeAxis, number>;
  /** The genres it's nearest, nearest first (three). */
  genres: { name: string; likeness: number }[];
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** How much nearer an axis's high end a sound's point is than its low end (`embedding` of unit length). */
export const axisRaw = (embedding: ArrayLike<number>, axis: { low: number[]; high: number[] }) => dot(embedding, axis.high) - dot(embedding, axis.low);

/** What a sound's point (CLAP's audio embedding, any length) says of its vibe. */
export function hearVibe(embedding: ArrayLike<number>, data: VibeData): Vibe {
  const norm = Math.sqrt(dot(embedding, embedding)) || 1;
  const unit = Array.from(embedding, (v) => v / norm);
  const axes = Object.fromEntries(
    VIBE_AXIS_NAMES.map((a) => {
      const axis = data.axes[a];
      return [a, Math.round(clamp1((axisRaw(unit, axis) - axis.mean) / (2 * axis.spread)) * 100) / 100];
    }),
  ) as Record<VibeAxis, number>;
  const genres = data.genres
    .map((g) => ({ name: g.name, likeness: Math.round(dot(unit, g.embedding) * 100) / 100 }))
    .sort((a, b) => b.likeness - a.likeness)
    .slice(0, 3);
  return { axes, genres };
}

/** Several readings as one: the axes averaged (`weights`, most recent heaviest as the caller likes), genres by count. */
export function blendVibes(vibes: readonly Vibe[], weights: readonly number[] = vibes.map(() => 1)): Vibe | null {
  if (!vibes.length) return null;
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const axes = Object.fromEntries(
    VIBE_AXIS_NAMES.map((a) => [a, Math.round((vibes.reduce((s, v, i) => s + v.axes[a] * weights[i], 0) / total) * 100) / 100]),
  ) as Record<VibeAxis, number>;
  const likeness = new Map<string, number>();
  vibes.forEach((v, i) => v.genres.forEach((g, rank) => likeness.set(g.name, (likeness.get(g.name) ?? 0) + weights[i] * (3 - rank))));
  const genres = [...likeness.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, score]) => ({ name, likeness: Math.round((score / (3 * total)) * 100) / 100 }));
  return { axes, genres };
}

const lean = (x: number) => 1 / (1 + Math.exp(-3 * x));

/**
 * The song's kind as its vibe says (each 0..1, `mood.ts`'s characters): chill is calm, soft and slow (and spacious);
 * groove is in the middle, not harsh, with a groove; hype is intense, bright and fast; heavy is aggressive, intense and
 * dark.
 */
export function vibeCharacters({ axes: v }: Vibe): Record<SongCharacter, number> {
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    chill: round(lean(-0.7 * v.energy - 0.4 * v.force - 0.3 * v.pace + 0.2 * v.space - 0.15)),
    groove: round(lean(0.35 - 0.9 * Math.abs(v.energy) - 0.6 * Math.max(0, v.force) + 0.4 * v.dance)),
    hype: round(lean(0.7 * v.energy + 0.3 * v.mood + 0.3 * v.pace - 0.15)),
    heavy: round(lean(0.6 * v.force + 0.4 * v.energy - 0.4 * v.mood - 0.25)),
  };
}
