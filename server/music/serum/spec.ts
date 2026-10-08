/**
 * The preset spec: a Serum 2 preset as readable JSON, for people and models to write (docs/serum/preset-format.md).
 *
 * Every field is optional but `name`: what isn't said is Serum's init patch. Numbers are in the units the field
 * tables give (`fields.ts`: %, ms, Hz, dB, degrees...), choices are Serum's own option names ("MgL24", "kSync";
 * for filter types and warp modes what Serum shows, "MG Low 24" or "Sync", is accepted too). Anything the spec
 * doesn't name is still reachable: `params` / `typeParams` take a module's parameters by Serum's names
 * (kParam…, values as Serum stores them), and `raw` is a merge patch on the whole settings, which is how a preset
 * read from a file keeps everything the readable part doesn't say.
 */
import type { FxEffect, FxRack, OscillatorType } from "./catalogue.ts";
import type { JsonValue } from "./patch.ts";

/** A module's parameters by Serum's names, values as stored. */
export type Params = Record<string, number | string>;

export interface GlobalSpec {
  volume?: number;
  polyphony?: number;
  mono?: boolean;
  legato?: boolean;
  portamento?: number;
  portamentoCurve?: number;
  portaAlways?: boolean;
  portaScaled?: boolean;
  bendUp?: number;
  bendDown?: number;
  transpose?: number;
  modWheel?: number;
  swing?: number;
  directVolume?: number;
  bus1Volume?: number;
  bus2Volume?: number;
  params?: Params;
}

export interface UnisonSpec {
  voices?: number;
  detune?: number;
  blend?: number;
  width?: number;
  stack?: string;
  mode?: string;
  range?: number;
  span?: number;
  randomStart?: number;
  /** Wavetable oscillators. */
  wtPos?: number;
}

export interface WarpSpec {
  mode?: string;
  amount?: number;
  var?: number;
}

export interface OscillatorSpec {
  enabled?: boolean;
  type?: OscillatorType;
  /** A wavetable, relative to Serum's Tables folder ("S2 Tables/Default Shapes.wav"). */
  wavetable?: string;
  /** The table's name as Serum shows it (Serum names it after the file when it isn't given). */
  wavetableName?: string;
  /** A sample (sample, granular and spectral oscillators), relative to Serum's Samples folder. */
  sample?: string;
  /** A multisample's .sfz, relative to Serum's Multisamples folder. */
  multisample?: string;
  position?: number;
  level?: number;
  pan?: number;
  octave?: number;
  semi?: number;
  fine?: number;
  coarse?: number;
  pitchTrack?: boolean;
  phase?: number;
  randomPhase?: number;
  unison?: UnisonSpec;
  warp?: WarpSpec;
  warp2?: WarpSpec;
  start?: number;
  end?: number;
  loop?: { mode?: string; start?: number; end?: number; crossfade?: number };
  scanRate?: number;
  pitchMode?: string;
  /** The oscillator's other parameters. */
  params?: Params;
  /** The oscillator type's other parameters (its WTOsc, SampleOsc... module). */
  typeParams?: Params;
}

export interface NoiseSpec {
  enabled?: boolean;
  level?: number;
  pan?: number;
  pitchTrack?: boolean;
  pitch?: number;
  fine?: number;
  phase?: number;
  randomPhase?: number;
  oneShot?: boolean;
  type?: string;
  /** A noise sample, relative to Serum's Noises folder ("Organics/AC hum1.wav"). */
  sample?: string;
  params?: Params;
  typeParams?: Params;
}

export interface SubSpec {
  enabled?: boolean;
  level?: number;
  pan?: number;
  octave?: number;
  coarse?: number;
  pitchTrack?: boolean;
  shape?: string;
  phase?: number;
  params?: Params;
  typeParams?: Params;
}

export interface FilterSpec {
  enabled?: boolean;
  type?: string;
  cutoff?: number;
  resonance?: number;
  drive?: number;
  var?: number;
  mix?: number;
  stereo?: number;
  level?: number;
  params?: Params;
}

export interface RoutingSpec {
  to?: "filter" | "master" | "direct" | "none";
  filterBalance?: number;
  bus1?: number;
  bus2?: number;
  params?: Params;
}

export interface EnvelopeSpec {
  attack?: number;
  hold?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  attackCurve?: number;
  decayCurve?: number;
  releaseCurve?: number;
  params?: Params;
}

/** A point of an LFO's shape: [x, y] or [x, y, curve], all 0–1 (curve 0.5 is straight, the default). */
export type LfoPoint = [number, number] | [number, number, number];

export interface LfoShapeSpec {
  points: LfoPoint[];
  /** The shape's name in Serum's menu ("Custom"). */
  name?: string;
  /** Where a looping shape loops back to (Serum 1 shapes carry it). */
  loopback?: number;
}

export interface LfoSpec {
  /** A division ("1/4", "1/8.", "1/16 t") when synced, else Serum's rate value (Hz when free, ×10 with rate10x). */
  rate?: number | string;
  sync?: boolean;
  dotted?: boolean;
  triplets?: boolean;
  rate10x?: boolean;
  mode?: string;
  type?: string;
  smooth?: number;
  rise?: number;
  delay?: number;
  phase?: number;
  mono?: boolean;
  shape?: LfoShapeSpec;
  params?: Params;
}

/** A destination by its module, as a mod slot stores it. */
export interface ModDestination {
  module: string;
  id: number;
  param: string;
  paramId: number;
}

export interface ModulationSpec {
  /** Its slot, 1–64 (by default the next free one). */
  slot?: number;
  source: string | number;
  aux?: string | number;
  /** A control's name ("A WT Pos", "Filter 1 Freq", "Main FX 2 Wet") or a destination by module. */
  to: string | ModDestination;
  amount?: number;
  out?: number;
  bipolar?: boolean;
  auxInverted?: boolean;
  bypass?: boolean;
  params?: Params;
  /** The slot's response curve, as Serum stores it (`flex`). */
  curve?: JsonValue;
}

export interface MacroSpec {
  name?: string;
  value?: number;
}

/**
 * An effect: `effect` says which, then its parameters by name (Serum's kParam names without "kParam", first
 * letter lower case: "wet", "size", "freqB"), values as Serum stores them.
 */
export interface FxSpec {
  effect: FxEffect;
  enabled?: boolean;
  /** Convolve's impulse, relative to Serum's Impulses folder. */
  ir?: string;
  /** Parameters by Serum's own names. */
  params?: Params;
  /** The effect module's other fields (as stored). */
  module?: Record<string, JsonValue>;
  /** The rack entry's other fields (as stored). */
  entry?: Record<string, JsonValue>;
  [param: string]: unknown;
}

export const OSCILLATOR_KEYS = ["A", "B", "C"] as const;
export const ROUTING_KEYS = ["A", "B", "C", "noise", "sub", "filter1", "filter2"] as const;
export type RoutingKey = (typeof ROUTING_KEYS)[number];

export interface SerumPresetSpec {
  name: string;
  author?: string;
  description?: string;
  tags?: string[];
  /** Which Serum wrote the settings: it decides what Serum's loader converts (new presets: 11, "2.1.5"). */
  serum?: { version: number; product: string };
  global?: GlobalSpec;
  oscillators?: { A?: OscillatorSpec; B?: OscillatorSpec; C?: OscillatorSpec; noise?: NoiseSpec; sub?: SubSpec };
  filters?: { "1"?: FilterSpec; "2"?: FilterSpec };
  routing?: Partial<Record<RoutingKey, RoutingSpec>>;
  envelopes?: Partial<Record<"1" | "2" | "3" | "4", EnvelopeSpec>>;
  lfos?: Record<string, LfoSpec>;
  modulation?: ModulationSpec[];
  macros?: Record<string, MacroSpec>;
  fx?: Partial<Record<FxRack, FxSpec[]>>;
  /** A JSON merge patch (RFC 7396) on the settings, by top-level key, applied last. */
  raw?: Record<string, JsonValue>;
}
