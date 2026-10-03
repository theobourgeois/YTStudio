/**
 * The Reverb's modes and eras as data (`docs/reverb/reverb.md` 6.4, 6.10): one engine, and each mode a
 * table of numbers for it, as each EchoBoy style is a table for EchoBoy's. The engine is told numbers
 * (`engineReverb`), never a mode's name.
 *
 * Only types and constants are imported, so `project.ts` can use this to normalise a song.
 */
import type { ReverbEra, ReverbMode } from "./types.ts";

/** The octave bands the decay is set at (Hz), 31.5 Hz to 16 kHz: what the engine's absorption filters are designed for. */
export const REVERB_OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
/** Index of 1 kHz in `REVERB_OCTAVES`: Decay is the RT60 there. */
export const KHZ_BAND = 5;

/** How the network is wired: Dattorro's figure-eight, it doubled, or a 16-line feedback delay network. */
export type ReverbTopology = "plate" | "smoothPlate" | "fdn";

export interface ReverbModeSpec {
  name: string;
  /** In one line, what it sounds like (its menu's text). */
  detail: string;
  topology: ReverbTopology;
  /** The scale of every length at Size 0 and 100% (`lo · (hi / lo)^Size`). */
  scale: [number, number];
  /** Each line's all-pass then delay, ms at scale 1; whether its delay (or its all-pass) is modulated. (Smooth Plate's are mixed by a Hadamard, the FDN's by A4 ⊗ A4, Plate's go round Dattorro's ring.) */
  lines: { allpass: number; delay: number; apGain: number; modDelay: boolean; modAllpass: boolean }[];
  /** The Late Diffusion knob's value as the mode is made (its in-line gains are `apGain` there). */
  lateDiffusion: number;
  /** Stereo in (each side its own lines) when Input is Auto; else mono, as a plate is driven. */
  stereo: boolean;
  /**
   * The early energy (velvet taps): from `start` to `end` ms at scale 1, `density` pulses a second
   * (at Diffusion 60%; `startDensity` at its start if it thins, Hall's slow build), heard at `level` dB
   * (-Infinity: only into the loop, as a plate's).
   */
  early: { start: number; end: number; density: number; startDensity?: number; level: number } | null;
  /** The late sound's level (dB), before calibration. */
  lateLevel: number;
  /** Decay times the natural curve at 125 Hz, 1 kHz, 4 kHz and 10 kHz (Plate's follows Decay: `plateCurve`). */
  natural: [number, number, number, number];
  /** The longest the top (10 kHz and up) rings, seconds, whatever Decay. */
  topCap: number | null;
  /** The longest the late tail rings (Ambience: almost none). */
  decayCap: number | null;
  /** Modulation as the mode's presets start it. */
  mod: { shape: "chorus" | "random"; rate: number; depth: number };
  /** The engine's own level for this mode (dB), so modes sound as loud at Decay 1.8 s: measured (`reverb.integration.test.ts`). */
  calibration: number;
}

/** Dattorro's plate ("Effect Design, Part 1", JAES 1997, Table 1) at its rate, 29 761 Hz: samples to ms. */
const D = (samples: number) => (samples / 29761) * 1000;

/** Geometric FDN line sets (ms at scale 1), jittered so no two share a ratio (6.4's table). */
/** Room's (and Ambience's) lines: 0.39 s of memory, half again the first design's 0.26 s, so a short tail's modes overlap (its closeness is the early energy's). */
const ROOM_LINES = [10.6, 11.9, 12.9, 14.1, 16.0, 16.8, 19.5, 20.7, 22.6, 25.0, 28.0, 31.8, 33.9, 38.2, 42.5, 46.2];
/** Chamber's: 0.68 s, a quarter longer than the first design's 0.55 s (a held note's tail beat through its fewer modes). */
const CHAMBER_LINES = [17.0, 18.0, 19.5, 21.4, 23.9, 25.6, 27.7, 30.5, 32.9, 35.4, 39.7, 42.8, 45.3, 50.2, 54.4, 60.3].map((ms) => Math.round(ms * 12.5) / 10);
const HALL_LINES = [36.6, 39.0, 43.3, 45.1, 49.9, 53.2, 56.3, 62.3, 65.2, 72.0, 75.9, 81.8, 90.0, 99.3, 102.5, 111.1];

/**
 * In-line all-passes from `lo` to `hi` ms over 16 lines, spread so each line's all-pass isn't in step
 * with its delay (an order unlike the delays': the longest all-pass on a middle line).
 */
function allpasses(lo: number, hi: number): number[] {
  const order = [5, 12, 2, 9, 15, 0, 7, 13, 3, 10, 1, 14, 6, 11, 4, 8];
  return order.map((k) => Math.round(lo * (hi / lo) ** (k / 15) * 100 * (1 + 0.023 * Math.sin(k * 2.39996))) / 100);
}

function fdnLines(delays: number[], aps: number[], gain: number) {
  return delays.map((delay, i) => ({ allpass: aps[i], delay, apGain: gain, modDelay: i % 2 === 0, modAllpass: false }));
}

export const REVERB_MODE_SPECS: Record<ReverbMode, ReverbModeSpec> = {
  smoothPlate: {
    name: "Smooth Plate",
    detail: "The plate without the metal: silky, even, the vocal default",
    topology: "smoothPlate",
    scale: [0.5, 1.6],
    // Dattorro's sections' memory (about 1.4 s, twice his tank's: the smoothness), as sixteen lines of 75 to
    // 105 ms, each all-pass short (3–9 ms): mixed by A4 ⊗ A4, every pass multiplies the echoes by sixteen, so
    // the onset is dense at once and no line's echo is heard as a flutter. Half of them modulated.
    lines: [
      { allpass: 3.1, delay: 76.1, apGain: -0.5, modDelay: true, modAllpass: true },
      { allpass: 4.7, delay: 88.3, apGain: 0.55, modDelay: false, modAllpass: false },
      { allpass: 3.9, delay: 94.4, apGain: -0.52, modDelay: true, modAllpass: true },
      { allpass: 6.3, delay: 80.9, apGain: 0.58, modDelay: false, modAllpass: false },
      { allpass: 3.4, delay: 71.7, apGain: -0.5, modDelay: true, modAllpass: true },
      { allpass: 5.6, delay: 82.5, apGain: 0.55, modDelay: false, modAllpass: false },
      { allpass: 4.4, delay: 95.0, apGain: -0.52, modDelay: true, modAllpass: true },
      { allpass: 7.7, delay: 80.5, apGain: 0.58, modDelay: false, modAllpass: false },
      { allpass: 3.6, delay: 75.6, apGain: -0.5, modDelay: true, modAllpass: true },
      { allpass: 6.9, delay: 86.1, apGain: 0.55, modDelay: false, modAllpass: false },
      { allpass: 4.1, delay: 99.5, apGain: -0.52, modDelay: true, modAllpass: true },
      { allpass: 8.6, delay: 83.3, apGain: 0.58, modDelay: false, modAllpass: false },
      { allpass: 3.3, delay: 73.2, apGain: -0.5, modDelay: true, modAllpass: true },
      { allpass: 5.2, delay: 84.7, apGain: 0.55, modDelay: false, modAllpass: false },
      { allpass: 4.9, delay: 89.3, apGain: -0.52, modDelay: true, modAllpass: true },
      { allpass: 7.1, delay: 76.5, apGain: 0.58, modDelay: false, modAllpass: false },
    ],
    lateDiffusion: 0.7,
    stereo: false,
    early: { start: 0, end: 30, density: 3500, level: -Infinity },
    lateLevel: 0,
    natural: [0.85, 1, 0.9, 0.5],
    topCap: 1.5,
    decayCap: null,
    mod: { shape: "chorus", rate: 0.8, depth: 0.4 },
    calibration: 0.74,
  },
  plate: {
    name: "Plate",
    detail: "Dattorro's Lexicon-style plate: instant, dense, a little sheen; static, its curve an EMT 140's",
    topology: "plate",
    scale: [0.5, 1.6],
    lines: [
      { allpass: D(672), delay: D(4453), apGain: -0.7, modDelay: false, modAllpass: true },
      { allpass: D(1800), delay: D(3720), apGain: 0.5, modDelay: false, modAllpass: true },
      { allpass: D(908), delay: D(4217), apGain: -0.7, modDelay: false, modAllpass: true },
      { allpass: D(2656), delay: D(3163), apGain: 0.5, modDelay: false, modAllpass: true },
    ],
    lateDiffusion: 0.7,
    stereo: false,
    early: null,
    lateLevel: 0,
    natural: [1, 1, 1, 1],
    topCap: 1.3,
    decayCap: null,
    mod: { shape: "chorus", rate: 0.9, depth: 0 },
    calibration: -2.47,
  },
  room: {
    name: "Room",
    detail: "A real close room: walls you can hear, a short tail",
    topology: "fdn",
    scale: [0.5, 2],
    lines: fdnLines(ROOM_LINES, allpasses(3, 7.5), 0.4),
    lateDiffusion: 0.4 / 0.7,
    stereo: true,
    early: { start: 0, end: 40, density: 2500, level: -2 },
    lateLevel: -2,
    natural: [1, 1, 0.65, 0.4],
    topCap: null,
    decayCap: null,
    mod: { shape: "random", rate: 0.6, depth: 0.3 },
    calibration: -4.66,
  },
  chamber: {
    name: "Chamber",
    detail: "A dense echo chamber: quick, warm, no distinct echoes",
    topology: "fdn",
    scale: [0.5, 2],
    lines: fdnLines(CHAMBER_LINES, allpasses(3, 9), 0.5),
    lateDiffusion: 0.5 / 0.7,
    stereo: true,
    early: { start: 5, end: 60, density: 3500, level: -6 },
    lateLevel: 0,
    natural: [0.9, 1, 0.8, 0.45],
    topCap: null,
    decayCap: null,
    mod: { shape: "random", rate: 0.5, depth: 0.4 },
    calibration: -2.62,
  },
  hall: {
    name: "Hall",
    detail: "A big hall: a slow bloom, lush chorus in the tail",
    topology: "fdn",
    scale: [0.4, 2.5],
    lines: fdnLines(HALL_LINES, allpasses(5, 15), 0.5),
    lateDiffusion: 0.5 / 0.7,
    stereo: true,
    early: { start: 10, end: 120, density: 3000, startDensity: 800, level: -7 },
    lateLevel: 0,
    natural: [1.2, 1, 0.75, 0.4],
    topCap: 1.5,
    decayCap: null,
    mod: { shape: "chorus", rate: 0.7, depth: 0.55 },
    calibration: -1.0,
  },
  ambience: {
    name: "Ambience",
    detail: "Early energy and air, almost no tail: felt, not heard",
    topology: "fdn",
    scale: [0.5, 2],
    lines: fdnLines(ROOM_LINES, allpasses(3, 7.5), 0.45),
    lateDiffusion: 0.45 / 0.7,
    stereo: true,
    early: { start: 0, end: 80, density: 3000, level: 0 },
    lateLevel: -10,
    natural: [0.9, 1, 0.85, 0.5],
    topCap: null,
    decayCap: 0.8,
    mod: { shape: "random", rate: 0.4, depth: 0.28 },
    calibration: -4.82,
  },
};

/** Dattorro's input diffusers (Table 1): their lengths (ms) and gains at Diffusion 100%. Plate's alone. */
export const PLATE_DIFFUSERS = [
  { length: D(142), gain: 0.75 },
  { length: D(107), gain: 0.75 },
  { length: D(379), gain: 0.625 },
  { length: D(277), gain: 0.625 },
];

/**
 * Dattorro's output taps (Table 2), "a synthetic stereo image" from the mono input: the line (0: AP 672
 * + 4453, 1: AP 1800 + 3720, 2: AP 908 + 4217, 3: AP 2656 + 3163), inside its delay or its all-pass, ms
 * back from that part's input, the sign, and the side (0 left, 1 right). Each × 0.6.
 */
export const PLATE_TAPS: { line: number; where: "delay" | "allpass"; at: number; sign: 1 | -1; side: 0 | 1 }[] = [
  { line: 2, where: "delay", at: D(266), sign: 1, side: 0 },
  { line: 2, where: "delay", at: D(2974), sign: 1, side: 0 },
  { line: 3, where: "allpass", at: D(1913), sign: -1, side: 0 },
  { line: 3, where: "delay", at: D(1996), sign: 1, side: 0 },
  { line: 0, where: "delay", at: D(1990), sign: -1, side: 0 },
  { line: 1, where: "allpass", at: D(187), sign: -1, side: 0 },
  { line: 1, where: "delay", at: D(1066), sign: -1, side: 0 },
  { line: 0, where: "delay", at: D(353), sign: 1, side: 1 },
  { line: 0, where: "delay", at: D(3627), sign: 1, side: 1 },
  { line: 1, where: "allpass", at: D(1228), sign: -1, side: 1 },
  { line: 1, where: "delay", at: D(2673), sign: 1, side: 1 },
  { line: 2, where: "delay", at: D(2111), sign: -1, side: 1 },
  { line: 3, where: "allpass", at: D(335), sign: -1, side: 1 },
  { line: 3, where: "delay", at: D(121), sign: -1, side: 1 },
];

/**
 * The EMT 140's reverberation time against frequency at three damper settings, from EMT's 1971 brochure
 * (6.4; ±0.2 s): its 1 kHz time, and the times at 100 Hz .. 10 kHz.
 */
const EMT_FREQUENCIES = [100, 200, 500, 1000, 2000, 4000, 10000];
const EMT_CURVES: { at1k: number; times: number[] }[] = [
  { at1k: 1.05, times: [0.75, 0.8, 0.85, 1.05, 1.1, 1.2, 0.85] },
  { at1k: 2.15, times: [1.7, 1.55, 1.8, 2.15, 2.15, 2.0, 1.2] },
  { at1k: 4.0, times: [10.2, 6.8, 4.7, 4.0, 3.2, 2.5, 1.3] },
];

/** A curve through points (log frequency across), held past either end. */
function logInterp(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++)
    if (x <= xs[i]) {
      const t = Math.log(x / xs[i - 1]) / Math.log(xs[i] / xs[i - 1]);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
    }
  return ys[ys.length - 1];
}

/**
 * Plate's natural curve at a frequency, as a multiplier of Decay: EMT's three, as ratios to 1 kHz,
 * interpolated in log time by Decay (below the closed damper's time the closed curve, above the open
 * one's the open curve).
 */
export function plateCurve(decay: number, frequency: number): number {
  const ratios = EMT_CURVES.map((c) => logInterp(EMT_FREQUENCIES, c.times.map((t) => t / c.at1k), frequency));
  const ats = EMT_CURVES.map((c) => Math.log(c.at1k));
  const x = Math.log(Math.max(decay, 1e-3));
  if (x <= ats[0]) return ratios[0];
  if (x >= ats[2]) return ratios[2];
  const k = x < ats[1] ? 0 : 1;
  const t = (x - ats[k]) / (ats[k + 1] - ats[k]);
  return ratios[k] + (ratios[k + 1] - ratios[k]) * t;
}

/**
 * A mode's natural curve at a frequency (×Decay): Plate's follows Decay; the others' four points
 * (125 Hz, 1 kHz, 4 kHz, 10 kHz) joined in log frequency, the top continuing the 4 → 10 kHz slope.
 */
export function naturalCurve(mode: ReverbMode, decay: number, frequency: number): number {
  const spec = REVERB_MODE_SPECS[mode];
  if (spec.topology === "plate") return plateCurve(decay, frequency);
  const [lo, mid, hi, top] = spec.natural;
  // Smooth Plate (the M7's VOX Plate, its LF ×0.85): the whole bass shorter, back to Decay by 1 kHz.
  if (mode === "smoothPlate" && frequency <= 1000) return frequency <= 600 ? lo : logInterp([600, 1000], [lo, mid], frequency);
  if (frequency <= 10000) return logInterp([125, 1000, 4000, 10000], [lo, mid, hi, top], frequency);
  const slope = Math.log(top / hi) / Math.log(10000 / 4000);
  return Math.max(0.2, top * (frequency / 10000) ** slope);
}

/** What an era does (6.10): its band limit, converter, modulation's quantisation and noise; and the loop's darkening (×T60 at 8 and 16 kHz). */
export interface ReverbEraSpec {
  name: string;
  detail: string;
  /** Hz, 0: none. */
  bandLimit: number;
  /** A +2 dB shelf at 5 kHz before the band limit (the 224's aperture filter). */
  aperture: boolean;
  /** +6 dB above 3 kHz before the converter, the inverse after (the converter's noise darker). */
  emphasis: boolean;
  /** The converter's word length (0: none), whether it ranges its gain in 6 dB steps, and where the loop saturates (× full scale). */
  bits: number;
  gainRanging: boolean;
  clip: number;
  /** Read positions quantised to 1/this of a sample (0: not). */
  quantise: number;
  /** dBFS of noise (gain-ranged: it follows the sound). */
  noise: number;
  /** ×T60 at 8 kHz and 16 kHz: the low sample rate's interpolation darkening each pass. */
  darken: [number, number];
}

export const REVERB_ERA_SPECS: Record<ReverbEra, ReverbEraSpec> = {
  now: { name: "Now", detail: "Full bandwidth, clean float, smooth modulation", bandLimit: 0, aperture: false, emphasis: false, bits: 0, gainRanging: false, clip: 0, quantise: 0, noise: -Infinity, darken: [1, 1] },
  "1980s": {
    name: "1980s",
    detail: "The 480L / 224XL / RMX16 era: 18 kHz, 16-bit in the loop, a hardware sheen",
    bandLimit: 18000,
    aperture: false,
    emphasis: false,
    bits: 16,
    gainRanging: false,
    clip: 4,
    quantise: 64,
    noise: -96,
    darken: [1, 0.85],
  },
  "1970s": {
    name: "1970s",
    detail: "The 224 / EMT 250: 9 kHz, a gain-ranging 12-bit converter, dark and grainy",
    bandLimit: 9000,
    aperture: true,
    emphasis: true,
    bits: 12,
    gainRanging: true,
    clip: 2,
    quantise: 32,
    noise: -80,
    darken: [0.75, 0.45],
  },
};
