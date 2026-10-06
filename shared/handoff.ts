/**
 * Handing work from one suite to another (docs/visualizer/README.md, Make visualizer): the music suite
 * hands a song over, rendered (its mix and stems), with what no analysis could guess (its channels'
 * notes, its exact beat, its arrangement), and the video suite makes a project of it. Neither imports
 * the other: the handoff is the platform's, the server imports its files into the new project
 * (`ProjectStore.createFromHandoff`), and the target suite's backend makes the document
 * (`SuiteBackend.fromHandoff`). Pure.
 */
import type { AspectRatio, SignalEvent, SignalRole } from "./types.ts";

/** A rendered file of the song: where it is on the server's disk (moved into the new project's media). */
export interface HandoffFile {
  file: string;
}

/** A stem: one mixer track's sound, as long as the mix and lined up with it. */
export interface HandoffStem extends HandoffFile {
  name: string;
  /** "#rrggbb". */
  color: string;
  role?: SignalRole;
}

/** A channel's notes as hits on the song's clock (seconds), each with its key, velocity and length. */
export interface HandoffNotes {
  channel: string;
  /** "#rrggbb". */
  color: string;
  role?: SignalRole;
  events: SignalEvent[];
}

/** A song handed over (the music suite's Make visualizer). Times are seconds from the song's start, where its files start. */
export interface SongHandoff {
  kind: "song";
  name: string;
  /** Seconds: the song itself (its files may ring on past it). */
  length: number;
  tempo: {
    /** The song's own tempo (it may change along: `beats` says where each one falls). */
    bpm: number;
    timeSignature: [number, number];
    /** Every beat, in seconds, from the song's first (a downbeat). */
    beats: number[];
  };
  mix: HandoffFile;
  stems: HandoffStem[];
  notes: HandoffNotes[];
  /** The arrangement: the playlist's markers and where its sections change. */
  markers: { time: number; label: string }[];
  origin: { projectId: string };
}

/** The new project's media made from a handoff's files, in the handoff's order. */
export interface HandoffMedia<Asset> {
  mix: Asset;
  stems: Asset[];
}

// ---------------------------------------------------------------------------
// What the video suite makes of a song (the window's choices)
// ---------------------------------------------------------------------------

/** The starting looks a visualizer can be made with: each binds to the song by role (the kick, the snare, the bass). */
export const VISUALIZER_LOOKS = [
  { id: "pulse", label: "Pulse", description: "A circular spectrum that punches on the kick, a waveform ring, a split on the snare." },
  { id: "bars", label: "Bars", description: "Spectrum bars along the bottom, sparks on the kick, a glow with the bass." },
  { id: "wave", label: "Wave", description: "A waveform ring breathing with the bass, flashes on the snare, sparks on the hats." },
  { id: "none", label: "Nothing yet", description: "The song, its stems and signals, and no picture: make your own." },
] as const;

export type VisualizerLook = (typeof VISUALIZER_LOOKS)[number]["id"];

export const VISUALIZER_ASPECTS: readonly AspectRatio[] = ["9:16", "16:9", "1:1", "4:5"];
export const VISUALIZER_FPS = [30, 60] as const;

/** The video's choices for a song made into a visualizer. */
export interface VisualizerOptions {
  look: VisualizerLook;
  aspectRatio: AspectRatio;
  fps: number;
}

export const DEFAULT_VISUALIZER_OPTIONS: VisualizerOptions = { look: "pulse", aspectRatio: "9:16", fps: 30 };

/** Any options (a request's, stored ones) as valid ones: what's missing or wrong is the default. */
export function normalizeVisualizerOptions(raw: unknown): VisualizerOptions {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const look = VISUALIZER_LOOKS.find((l) => l.id === v.look)?.id ?? DEFAULT_VISUALIZER_OPTIONS.look;
  const aspectRatio = VISUALIZER_ASPECTS.find((a) => a === v.aspectRatio) ?? DEFAULT_VISUALIZER_OPTIONS.aspectRatio;
  const fps = VISUALIZER_FPS.find((f) => f === v.fps) ?? DEFAULT_VISUALIZER_OPTIONS.fps;
  return { look, aspectRatio, fps };
}

/** Colours for what a song hands over without one of its own (its stems and channels), in turn. */
export const HANDOFF_COLORS = ["#f97316", "#22d3ee", "#a3e635", "#f472b6", "#facc15", "#818cf8", "#34d399", "#fb7185"];

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** What a stem or channel can be, for a look to find it ("the kick"). */
export const HANDOFF_ROLES: readonly SignalRole[] = ["kick", "snare", "hats", "bass", "vocal", "lead", "mix"];

/** Words in a channel's, a track's or a sample's name that say what it is, in the order they're tried. */
const ROLE_WORDS: [SignalRole, RegExp][] = [
  ["kick", /\b(kick|kik|bd|bass ?drum|808 ?kick)\b/],
  ["snare", /\b(snare|snr|sd|clap|clp|rim|rimshot)\b/],
  ["hats", /\b(hats?|hh|hihats?|hi[- ]hats?|oh|ch|cymbals?|ride|crash|shaker|tamb(ourine)?|perc(ussion)?)\b/],
  ["vocal", /\b(vox|vocals?|voice|vocal ?chop|chops?|acapella|adlibs?|lead ?vox|singer|sing)\b/],
  ["bass", /\b(bass|sub|808|reese|low ?end)\b/],
  ["lead", /\b(lead|synth|melody|arp|pluck|keys|piano|chords?|pad|guitar|bell)\b/],
];

/** What a channel or stem named `name` probably is (a kick, a snare, the bass...), or undefined. */
export function guessRole(...names: (string | null | undefined)[]): SignalRole | undefined {
  for (const raw of names) {
    if (!raw) continue;
    // "KickDrum_01.wav", "hi-hat" and "Snare 2" all read as words.
    const name = raw
      .replace(/\.[a-z0-9]{2,4}$/i, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_\-.]+/g, " ")
      .replace(/(\D)(\d)/g, "$1 $2")
      .toLowerCase();
    for (const [role, words] of ROLE_WORDS) if (words.test(name)) return role;
  }
  return undefined;
}
