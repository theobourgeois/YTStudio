/**
 * Pro-Q's constants and factory presets (`docs/fabfilter/pro-q.md`): what it is as a slot's plugin, its
 * ranges and defaults (FabFilter's), and the presets its menu offers.
 *
 * Only types and constants are imported, so `project.ts` can use this to normalise a song.
 */
import { clamp, isFiniteNumber } from "../math.ts";
import { EQ_PLACEMENTS, EQ_SHAPES, type EqBand, type EqPlacement, type EqShape, type EqSlope, type PluginRef, type ProQAnalyzer, type ProQState } from "./types.ts";

/** What a Pro-Q is, as a slot's plugin: one of ours, run by the engine itself. */
export const PRO_Q_PLUGIN: PluginRef = { id: "vaudio:pro-q", name: "YT-EQ", format: "Vaudio" };
export const isProQ = (plugin: Pick<PluginRef, "id">) => plugin.id === PRO_Q_PLUGIN.id;

/** Bands at most. */
export const EQ_BANDS = 24;
export const EQ_MIN_FREQUENCY = 10;
export const EQ_MAX_FREQUENCY = 30_000;
export const EQ_MAX_GAIN = 30;
export const EQ_MIN_Q = 0.025;
export const EQ_MAX_Q = 40;
export const EQ_MIN_THRESHOLD = -60;
export const EQ_MAX_OUTPUT = 36;
/** The output's lowest level; at it, it's silent (Pro-Q's -inf). */
export const EQ_MIN_OUTPUT = -60;
export const EQ_MAX_GAIN_SCALE = 2;
export const EQ_DISPLAY_RANGES = [3, 6, 12, 30] as const;

/** The shapes with a gain (and so dynamics, gain scale, a dot that moves up and down). */
export const hasGain = (shape: EqShape) => shape === "bell" || shape === "lowShelf" || shape === "highShelf" || shape === "tiltShelf" || shape === "flatTilt";
/** The shapes that can be dynamic (Pro-Q 3: Bell and the shelves). */
export const canBeDynamic = (shape: EqShape) => shape === "bell" || shape === "lowShelf" || shape === "highShelf" || shape === "tiltShelf";
/** The slopes a shape takes (an order each): Brickwall on the cuts only, Bell and Notch from 12 (two poles), Flat Tilt none of its own. */
export const shapeSlopes = (shape: EqShape): readonly EqSlope[] =>
  shape === "lowCut" || shape === "highCut"
    ? [6, 12, 18, 24, 30, 36, 48, 72, 96, "brickwall"]
    : shape === "flatTilt"
      ? [12]
      : shape === "bell" || shape === "notch"
        ? [12, 18, 24, 30, 36, 48, 72, 96]
        : [6, 12, 18, 24, 30, 36, 48, 72, 96];
/** Q does nothing at 6 dB/oct (one pole), on a Flat Tilt, or on a Brickwall. */
export const usesQ = (band: Pick<EqBand, "shape" | "slope">) => band.slope !== 6 && band.slope !== "brickwall" && band.shape !== "flatTilt";

/** A band's settings when it's made where nothing says otherwise: a Bell at 1 kHz, Pro-Q's. */
export const DEFAULT_BAND: Omit<EqBand, "id"> = {
  enabled: true,
  shape: "bell",
  frequency: 1000,
  gain: 0,
  q: 1,
  slope: 12,
  placement: "stereo",
  range: 0,
  dynamics: true,
  threshold: null,
};

export const DEFAULT_PRO_Q_STATE: ProQState = {
  bands: [],
  mode: "zeroLatency",
  resolution: "medium",
  gainScale: 1,
  output: 0,
  pan: 0,
  panMode: "lr",
  invert: false,
  autoGain: false,
  gainQ: false,
};

export const DEFAULT_ANALYZER: ProQAnalyzer = {
  pre: true,
  post: true,
  range: 90,
  resolution: "high",
  speed: "medium",
  tilt: 4.5,
  grab: true,
  collisions: true,
  external: null,
};

/** Linear Phase's delay at each resolution, in samples at 44.1 kHz (Pro-Q's own; kept in ms at other rates). */
export const LINEAR_PHASE_LATENCY = { low: 3072, medium: 5120, high: 9216, veryHigh: 17408, maximum: 66560 } as const;
/** Dynamic bands play in Linear Phase only up to High (Pro-Q's: a warning above it). */
export const dynamicsInLinearPhase = (resolution: ProQState["resolution"]) => resolution === "low" || resolution === "medium" || resolution === "high";
/** The analyzer's FFT length at each resolution (Pro-Q's "points"), at 44.1 or 48 kHz. */
export const ANALYZER_SIZES = { low: 1024, medium: 2048, high: 4096, maximum: 8192 } as const;

// ---------------------------------------------------------------------------
// Factory presets
// ---------------------------------------------------------------------------

export interface ProQPreset {
  name: string;
  /** Its folder in the menu. */
  folder: string;
  state: Partial<ProQState>;
}

type BandSpec = Partial<Omit<EqBand, "id">> & Pick<EqBand, "frequency">;
const bands = (...list: BandSpec[]): EqBand[] => list.map((b, i) => ({ ...DEFAULT_BAND, ...b, id: i + 1 }));

/** Pro-Q's menu: a clean start, then starting points by what's being EQ'd. */
export const PRO_Q_PRESETS: readonly ProQPreset[] = [
  { name: "Default Setting", folder: "", state: {} },
  {
    name: "Flat 7 Bands",
    folder: "",
    state: {
      bands: bands(
        { shape: "lowCut", frequency: 30, q: 0.71 },
        { shape: "lowShelf", frequency: 100, q: 0.71 },
        { frequency: 250 },
        { frequency: 1000 },
        { frequency: 4000 },
        { shape: "highShelf", frequency: 10_000, q: 0.71 },
        { shape: "highCut", frequency: 20_000, q: 0.71 },
      ),
    },
  },
  {
    name: "Equalize",
    folder: "",
    state: { bands: bands({ shape: "lowCut", frequency: 25, slope: 24, q: 0.71 }, { frequency: 180, gain: -2.5, q: 1.4 }, { frequency: 2500, gain: 1.5, q: 0.8 }, { shape: "highShelf", frequency: 9000, gain: 2, q: 0.71 }) },
  },
  {
    name: "Clean Low End",
    folder: "Mixing",
    state: { bands: bands({ shape: "lowCut", frequency: 35, slope: 48, q: 0.71 }, { frequency: 250, gain: -3, q: 1.2, range: -4 }) },
  },
  {
    name: "Kick Punch",
    folder: "Drums",
    state: { bands: bands({ shape: "lowCut", frequency: 28, slope: 24, q: 0.71 }, { frequency: 60, gain: 3, q: 1.2 }, { frequency: 380, gain: -5, q: 2 }, { frequency: 4000, gain: 3.5, q: 1.5 }) },
  },
  {
    name: "Snare Crack",
    folder: "Drums",
    state: { bands: bands({ shape: "lowCut", frequency: 90, slope: 24, q: 0.71 }, { frequency: 200, gain: 2.5, q: 1.4 }, { frequency: 900, gain: -3, q: 2.5 }, { frequency: 5500, gain: 3, q: 1 }) },
  },
  {
    name: "Overheads",
    folder: "Drums",
    state: { bands: bands({ shape: "lowCut", frequency: 200, slope: 18, q: 0.71 }, { frequency: 3500, gain: -2, q: 2, range: -5 }, { shape: "highShelf", frequency: 12_000, gain: 2.5, q: 0.71 }) },
  },
  {
    name: "Bass Definition",
    folder: "Bass",
    state: { bands: bands({ shape: "lowCut", frequency: 30, slope: 36, q: 0.71 }, { frequency: 80, gain: 2, q: 1 }, { frequency: 250, gain: -3, q: 1.6 }, { frequency: 800, gain: 2, q: 1.5 }) },
  },
  {
    name: "Mono Lows",
    folder: "Bass",
    state: { bands: bands({ shape: "lowCut", frequency: 150, slope: 24, q: 0.71, placement: "side" }) },
  },
  {
    name: "Vocal Presence",
    folder: "Vocals",
    state: {
      bands: bands(
        { shape: "lowCut", frequency: 90, slope: 24, q: 0.71 },
        { frequency: 300, gain: -2.5, q: 1.4, range: -3 },
        { frequency: 3000, gain: 2.5, q: 0.9 },
        { frequency: 6500, gain: 0, q: 3, range: -6 },
        { shape: "highShelf", frequency: 11_000, gain: 2.5, q: 0.71 },
      ),
    },
  },
  {
    name: "De-Ess",
    folder: "Vocals",
    state: { bands: bands({ frequency: 6500, gain: 0, q: 2.5, range: -8, threshold: -30 }) },
  },
  {
    name: "Telephone",
    folder: "Effects",
    state: { bands: bands({ shape: "lowCut", frequency: 400, slope: 24, q: 0.71 }, { frequency: 1500, gain: 6, q: 1 }, { shape: "highCut", frequency: 3200, slope: 24, q: 0.71 }) },
  },
  {
    name: "Radio",
    folder: "Effects",
    state: { bands: bands({ shape: "bandPass", frequency: 1600, q: 0.7, slope: 24 }) },
  },
  {
    name: "Lo-Fi",
    folder: "Effects",
    state: { bands: bands({ shape: "lowCut", frequency: 150, slope: 12, q: 0.71 }, { shape: "highCut", frequency: 5500, slope: 12, q: 1.4 }, { frequency: 1000, gain: 3, q: 0.7 }) },
  },
  {
    name: "Air",
    folder: "Mastering",
    state: { bands: bands({ shape: "highShelf", frequency: 14_000, gain: 2, q: 0.71 }) },
  },
  {
    name: "Gentle Tilt",
    folder: "Mastering",
    state: { bands: bands({ shape: "tiltShelf", frequency: 1000, gain: 1.5, q: 0.71, slope: 6 }) },
  },
  {
    name: "Mastering Clean-Up",
    folder: "Mastering",
    state: {
      bands: bands(
        { shape: "lowCut", frequency: 20, slope: 48, q: 0.71 },
        { frequency: 250, gain: -0.8, q: 0.8 },
        { frequency: 3000, gain: 0, q: 2, range: -2 },
        { shape: "highShelf", frequency: 12_000, gain: 1, q: 0.71 },
        { shape: "highCut", frequency: 21_000, slope: 24, q: 0.71 },
      ),
      mode: "linearPhase",
      resolution: "medium",
    },
  },
  {
    name: "Wide Highs",
    folder: "Mastering",
    state: { bands: bands({ shape: "highShelf", frequency: 6000, gain: 2, q: 0.71, placement: "side" }, { shape: "lowCut", frequency: 120, slope: 12, q: 0.71, placement: "side" }) },
  },
];

// ---------------------------------------------------------------------------
// Controls as fractions of their range (knobs, automation)
// ---------------------------------------------------------------------------

/** How each automatable control maps to 0..1 of its knob: frequency and Q on a log scale, levels in dB. */
export const EQ_CONTROL_SCALES = {
  frequency: { toValue: (v: number) => EQ_MIN_FREQUENCY * (EQ_MAX_FREQUENCY / EQ_MIN_FREQUENCY) ** v, toFraction: (hz: number) => Math.log(hz / EQ_MIN_FREQUENCY) / Math.log(EQ_MAX_FREQUENCY / EQ_MIN_FREQUENCY) },
  gain: { toValue: (v: number) => (v * 2 - 1) * EQ_MAX_GAIN, toFraction: (db: number) => (db / EQ_MAX_GAIN + 1) / 2 },
  range: { toValue: (v: number) => (v * 2 - 1) * EQ_MAX_GAIN, toFraction: (db: number) => (db / EQ_MAX_GAIN + 1) / 2 },
  q: { toValue: (v: number) => EQ_MIN_Q * (EQ_MAX_Q / EQ_MIN_Q) ** v, toFraction: (q: number) => Math.log(q / EQ_MIN_Q) / Math.log(EQ_MAX_Q / EQ_MIN_Q) },
  output: { toValue: (v: number) => EQ_MIN_OUTPUT + v * (EQ_MAX_OUTPUT - EQ_MIN_OUTPUT), toFraction: (db: number) => (db - EQ_MIN_OUTPUT) / (EQ_MAX_OUTPUT - EQ_MIN_OUTPUT) },
  pan: { toValue: (v: number) => v * 2 - 1, toFraction: (pan: number) => (pan + 1) / 2 },
  gainScale: { toValue: (v: number) => v * EQ_MAX_GAIN_SCALE, toFraction: (scale: number) => scale / EQ_MAX_GAIN_SCALE },
} as const;

/** The frequencies the engine's analyzer reports levels at (`engine/src/Spectrum.h`'s `SpectrumGrid`). */
export const EQ_SPECTRUM_POINTS = 480;
export const EQ_SPECTRUM_LOW = 10;
export const EQ_SPECTRUM_HIGH = 30_000;
export const spectrumFrequency = (i: number) => EQ_SPECTRUM_LOW * (EQ_SPECTRUM_HIGH / EQ_SPECTRUM_LOW) ** (i / (EQ_SPECTRUM_POINTS - 1));

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const inRange = (v: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);
const oneOfList = <T>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** A Pro-Q band (or Pro-C's side chain's), or null if it isn't one. Its number must be free (`seen`) and at most `most`. */
export function normalizeEqBand(raw: unknown, seen: Set<number>, most: number = EQ_BANDS): EqBand | null {
  if (!isRecord(raw) || !Number.isInteger(raw.id) || (raw.id as number) < 1 || (raw.id as number) > most || seen.has(raw.id as number)) return null;
  const id = raw.id as number;
  seen.add(id);
  const d = DEFAULT_BAND;
  const shape: EqShape = oneOfList(EQ_SHAPES, raw.shape, d.shape);
  const slopes = shapeSlopes(shape);
  return {
    id,
    enabled: raw.enabled !== false,
    shape,
    frequency: inRange(raw.frequency, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY, d.frequency),
    gain: inRange(raw.gain, -EQ_MAX_GAIN, EQ_MAX_GAIN, d.gain),
    q: inRange(raw.q, EQ_MIN_Q, EQ_MAX_Q, d.q),
    slope: slopes.includes(raw.slope as EqSlope) ? (raw.slope as EqSlope) : slopes.includes(d.slope) ? d.slope : slopes[0],
    placement: oneOfList<EqPlacement>(EQ_PLACEMENTS, raw.placement, d.placement),
    range: inRange(raw.range, -EQ_MAX_GAIN, EQ_MAX_GAIN, 0),
    dynamics: raw.dynamics !== false,
    threshold: isFiniteNumber(raw.threshold) ? clamp(raw.threshold, EQ_MIN_THRESHOLD, 0) : null,
    ...(raw.external === true && { external: true as const }),
  };
}

