/**
 * Signals: what a sound file is doing at every moment, worked out once on the server (see
 * `analyse.ts`) and kept beside the file (`media/<id>/signals-v<version>.bin`), so pictures can
 * react to sound frame-exactly in the preview and the export alike (docs/visualizer/README.md).
 *
 * A file of signals is a header (JSON: rates, band edges, references, hits, the rhythm) and two
 * tables, one row per frame (`SIGNAL_RATE` a second, frame `i` centred on `i / SIGNAL_RATE`):
 * `scalars` (float32, `SCALARS` in order) and `bands` (a byte per band: dB from -90 to 0); then the
 * sound itself, small (`wave`: `WAVE_RATE` stereo samples a second, a signed byte each), for
 * oscilloscopes and vectorscopes.
 */
import type { MusicAnalysis } from "../types.ts";

/** Bumped when the analysis changes: older files are made again (their name says their version). */
export const SIGNALS_VERSION = 2;
/** Samples a second of the waveform kept for oscilloscopes (each the mean of the samples it stands for). */
export const WAVE_RATE = 8000;
/** Frames a second, whatever the sequence's rate (read between frames with `scalarAt`). */
export const SIGNAL_RATE = 200;
/** Spectrum bands, log-spaced from `BAND_LOW` to `BAND_HIGH` Hz. */
export const BAND_COUNT = 96;
export const BAND_LOW = 20;
export const BAND_HIGH = 20_000;
/** The bands' range in dB (a byte each: 0 is this, 255 is 0 dB, a full-scale sine). */
export const BAND_FLOOR_DB = -90;

/**
 * What each frame measures, in order:
 * - `level`, `peak`: dB over 10 ms (0 dB is a full-scale sine's level; peak is the largest sample's).
 * - the seven bands mixing engineers name (`NAMED_BANDS`): dB of their energy.
 * - `onset`, `onsetLow`, `onsetMid`, `onsetHigh`: how sharply the sound rises (spectral flux) in all of
 *   it, below 150 Hz (kicks), between, and above 4 kHz (hats, the top of snares).
 * - `width`: the side's share of the energy (0 mono, 0.5 unrelated channels, 1 out of phase).
 * - `balance`: right minus left over their sum (-1 left, 1 right).
 * - `brightness`: the spectrum's centroid, Hz.
 */
export const SCALARS = [
  "level", "peak",
  "sub", "bass", "lowMid", "mid", "upperMid", "presence", "air",
  "onset", "onsetLow", "onsetMid", "onsetHigh",
  "width", "balance", "brightness",
] as const;
export type ScalarName = (typeof SCALARS)[number];

/** Bands as mixing engineers name them (the music suite's audio intelligence uses the same edges). */
export const NAMED_BANDS = [
  { id: "sub", low: 20, high: 60 },
  { id: "bass", low: 60, high: 250 },
  { id: "lowMid", low: 250, high: 500 },
  { id: "mid", low: 500, high: 2000 },
  { id: "upperMid", low: 2000, high: 4000 },
  { id: "presence", low: 4000, high: 6000 },
  { id: "air", low: 6000, high: 20000 },
] as const satisfies readonly { id: ScalarName; low: number; high: number }[];

/** Scalars in dB, which sum as energies and auto-gain against their reference. */
export const DB_SCALARS: readonly ScalarName[] = ["level", "peak", ...NAMED_BANDS.map((b) => b.id)];
/** Scalars of spectral flux: sums of rises, impulses at each hit. */
export const ONSET_SCALARS = ["onset", "onsetLow", "onsetMid", "onsetHigh"] as const satisfies readonly ScalarName[];
export type OnsetName = (typeof ONSET_SCALARS)[number];

/** A hit: when (seconds into the file) and how hard (0..1, against the file's own hard hits). */
export type Hit = [time: number, velocity: number];

export interface SignalsHeader {
  version: number;
  rate: number;
  frames: number;
  /** Seconds analysed (files longer than `MAX_SIGNAL_SECONDS` are analysed up to there). */
  duration: number;
  /** `BAND_COUNT + 1` edges, Hz. */
  bandEdges: number[];
  scalars: ScalarName[];
  /**
   * What counts as loud for this file, for values from 0 to 1 (auto-gain): a dB scalar's 95th
   * percentile and a flux scalar's 99th, over the frames with sound. Missing for scalars that
   * mean something on their own (width, balance, brightness).
   */
  reference: Partial<Record<ScalarName, number>>;
  /** Each band's 95th percentile, dB. */
  bandReference: number[];
  /** Peaks of each flux scalar: the hits. */
  hits: Record<OnsetName, Hit[]>;
  /** Tempo, beats, bars, sections and drops (null: not analysed, too long). */
  rhythm: MusicAnalysis | null;
  /** The waveform's samples a second, and how many there are (per channel). */
  waveRate: number;
  waveSamples: number;
}

export interface SignalData {
  header: SignalsHeader;
  /** `frames × scalars.length`, frame by frame. */
  scalars: Float32Array;
  /** `frames × BAND_COUNT` bytes (see `BAND_FLOOR_DB`). */
  bands: Uint8Array;
  /** `waveSamples × 2`, left then right, -127..127 (full scale). */
  wave: Int8Array;
}

/** Longest stretch of a file analysed (seconds): a 30 minute file's signals are about 50 MB. */
export const MAX_SIGNAL_SECONDS = 30 * 60;

const MAGIC = 0x47495356; // "VSIG", little-endian

/** The band edges, Hz (log-spaced). */
export function bandEdges(): number[] {
  const edges: number[] = [];
  for (let b = 0; b <= BAND_COUNT; b++) edges.push(BAND_LOW * (BAND_HIGH / BAND_LOW) ** (b / BAND_COUNT));
  return edges;
}

export const bandByte = (db: number) => Math.round(Math.min(255, Math.max(0, ((db - BAND_FLOOR_DB) / -BAND_FLOOR_DB) * 255)));
export const byteDb = (byte: number) => BAND_FLOOR_DB + (byte / 255) * -BAND_FLOOR_DB;

/** A file of signals: magic, version, the header's length, the header, padding to 4 bytes, the tables. */
export function encodeSignals(data: SignalData): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(data.header));
  const headEnd = 12 + head.length;
  const scalarsAt = Math.ceil(headEnd / 4) * 4;
  const bandsAt = scalarsAt + data.scalars.byteLength;
  const waveAt = bandsAt + data.bands.byteLength;
  const out = new Uint8Array(waveAt + data.wave.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, data.header.version, true);
  view.setUint32(8, head.length, true);
  out.set(head, 12);
  // Float32s little-endian whatever the platform (every one this runs on is).
  out.set(new Uint8Array(data.scalars.buffer, data.scalars.byteOffset, data.scalars.byteLength), scalarsAt);
  out.set(data.bands, bandsAt);
  out.set(new Uint8Array(data.wave.buffer, data.wave.byteOffset, data.wave.byteLength), waveAt);
  return out;
}

/** Read a file of signals (throws on anything that isn't one, or is of another version). */
export function decodeSignals(buffer: ArrayBuffer): SignalData {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== MAGIC) throw new Error("Not a signals file");
  const version = view.getUint32(4, true);
  if (version !== SIGNALS_VERSION) throw new Error(`Signals version ${version}, expected ${SIGNALS_VERSION}`);
  const headLength = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, headLength))) as SignalsHeader;
  const scalarsAt = Math.ceil((12 + headLength) / 4) * 4;
  const scalarCount = header.frames * header.scalars.length;
  const bandsAt = scalarsAt + scalarCount * 4;
  const waveAt = bandsAt + header.frames * BAND_COUNT;
  if (buffer.byteLength < waveAt + header.waveSamples * 2) throw new Error("The signals file is cut short");
  return {
    header,
    scalars: new Float32Array(buffer, scalarsAt, scalarCount),
    bands: new Uint8Array(buffer, bandsAt, header.frames * BAND_COUNT),
    wave: new Int8Array(buffer, waveAt, header.waveSamples * 2),
  };
}

/** The file's name in an asset's folder. */
export const signalsFileName = (version = SIGNALS_VERSION) => `signals-v${version}.bin`;
