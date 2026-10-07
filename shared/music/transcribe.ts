/**
 * Hearing notes in audio (docs/fl-studio/stems-and-notes.md): what the server measures of a file once, and the
 * pure picking of notes and drum hits out of it, run again whenever Convert to notes' settings move.
 *
 * Melodic notes are Spotify's Basic Pitch (Apache 2.0; Bittner et al., "A Lightweight Instrument-Agnostic Model
 * for Polyphonic Note Transcription and Multipitch Estimation", ICASSP 2022): its model (run by the server,
 * `server/music/ml-worker.mjs`) gives each frame, for each of a piano's 88 keys, how likely a note is sounding
 * and how likely one starts; `pickNotes` is its `output_to_notes_polyphonic`, ported line for line (and held to
 * the Python's output in `transcribe.test.ts`), with its "Melodia trick" made fast enough to run while a slider
 * moves.
 *
 * Drums are ours: no model. Hits are where the sound gets louder most sharply (spectral flux), and each is told
 * apart by how much power it added in three bands, a kick's, a snare's and a hat's (`pickDrumHits`).
 */
import { clamp } from "../math.ts";
import { fft, hann } from "../signals/fft.ts";

/** The rate the analysis hears at, and its frames' hop: Basic Pitch's (about 86 frames a second). */
export const ANALYSIS_RATE = 22_050;
export const FRAME_HOP = 256;
export const FRAME_SECONDS = FRAME_HOP / ANALYSIS_RATE;
/** A piano's keys: Basic Pitch's pitches, A0 (MIDI 21) to C8. */
export const KEYS = 88;
export const LOWEST_KEY = 21;
export const HIGHEST_KEY = LOWEST_KEY + KEYS - 1;

/** The drum sounds Convert to notes tells apart, lowest first. */
export const DRUMS = ["kick", "snare", "hat"] as const;
export type Drum = (typeof DRUMS)[number];

/**
 * What the server heard in a file (`POST /api/music/notes`): Basic Pitch's activations, a frame every
 * `FRAME_SECONDS` by `KEYS` keys, each 0..`ACTIVATION_SCALE` (a fraction, kept in 16 bits), and drum hearing's
 * measurements (`drumFeatures`), a frame every `FRAME_SECONDS` too.
 */
export interface HeardAudio {
  /** The file's length in seconds. */
  duration: number;
  frames: number;
  /** How likely a note is sounding: `frames × KEYS`, frame by frame. */
  notes: Uint16Array;
  /** How likely a note starts. */
  onsets: Uint16Array;
  /** `DRUM_FEATURES`, each `drumFrames` long, one after another (0..`ACTIVATION_SCALE`). */
  drums: Uint16Array;
  drumFrames: number;
}

export const ACTIVATION_SCALE = 65_535;

/** `HeardAudio` as JSON (its arrays in base64, little-endian), the way it travels. */
export interface HeardAudioJson {
  duration: number;
  frames: number;
  drumFrames: number;
  notes: string;
  onsets: string;
  drums: string;
}

/** A note heard, in the file's own seconds. */
export interface HeardNote {
  start: number;
  end: number;
  /** A MIDI note. */
  pitch: number;
  /** How strongly it sounded, 0..1 (Basic Pitch's amplitude, or a drum band's rise). */
  level: number;
}

// ---------------------------------------------------------------------------
// Melodic notes: Basic Pitch's note creation
// ---------------------------------------------------------------------------

/** How Basic Pitch turns its activations into notes (`model_output_to_notes`' arguments). */
export interface PickSettings {
  /** An onset this likely starts a note (Basic Pitch's `onset_thresh`, 0.5 by default). */
  onsetThreshold: number;
  /** A note lasts while it's this likely (its `frame_thresh`, 0.3 by default). */
  frameThreshold: number;
  /** Notes this many frames long or shorter are dropped (its `min_note_len`: 11 frames, 127.7 ms). */
  minFrames: number;
  /** The lowest and highest MIDI notes kept (inclusive). */
  lowest: number;
  highest: number;
  /** Starts inferred from sudden rises in a note's activation as well (its `infer_onsets`). */
  inferOnsets?: boolean;
  /** Notes found in what's left without an onset (its `melodia_trick`). */
  melodia?: boolean;
}

/** Below this many frames of activation under the threshold, a note isn't over yet (Basic Pitch's `energy_tol`). */
const ENERGY_TOLERANCE = 11;
/** Basic Pitch's correction for each window's frames not quite filling its 2 seconds (`model_frames_to_time`). */
const WINDOW_FRAMES = 172;
const WINDOW_OFFSET = FRAME_SECONDS * (WINDOW_FRAMES - (ANALYSIS_RATE * 2 - FRAME_HOP) / FRAME_HOP) + 0.0018;

/** A frame's time in the file (Basic Pitch's `model_frames_to_time`). */
export const frameTime = (frame: number) => frame * FRAME_SECONDS - WINDOW_OFFSET * Math.floor(frame / WINDOW_FRAMES);

/** Shortest note in frames for a length in milliseconds (Basic Pitch's rounding). */
export const minFramesOf = (ms: number) => Math.round((ms / 1000) * (ANALYSIS_RATE / FRAME_HOP));

const fractions = new WeakMap<Uint16Array, Float32Array>();
/** A 16-bit activation as fractions (worked out once a buffer). */
function asFractions(data: Uint16Array): Float32Array {
  let out = fractions.get(data);
  if (!out) {
    out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] / ACTIVATION_SCALE;
    fractions.set(data, out);
  }
  return out;
}

/** Frame indices of a note: `[start, end)`, its key (0..87) and amplitude, as Basic Pitch's `note_events`. */
export interface FrameNote {
  start: number;
  end: number;
  key: number;
  amplitude: number;
}

/**
 * Basic Pitch's `output_to_notes_polyphonic`: notes from each likely onset until the note's activation stays
 * below the threshold, then (the Melodia trick) notes grown both ways from whatever strong activation is left.
 * Times are frames; `pickNotes` gives seconds.
 */
export function pickFrameNotes(heard: Pick<HeardAudio, "frames" | "notes" | "onsets">, settings: PickSettings): FrameNote[] {
  const n = heard.frames;
  if (n < 2) return [];
  const lowKey = clamp(Math.round(settings.lowest) - LOWEST_KEY, 0, KEYS);
  const highKey = clamp(Math.round(settings.highest) - LOWEST_KEY + 1, 0, KEYS);
  const frameThreshold = settings.frameThreshold;
  // The activations, with keys outside the range silenced (`constrain_frequency`).
  const frames = new Float32Array(asFractions(heard.notes));
  const onsets = new Float32Array(asFractions(heard.onsets));
  if (lowKey > 0 || highKey < KEYS)
    for (let t = 0; t < n; t++)
      for (let k = 0; k < KEYS; k++)
        if (k < lowKey || k >= highKey) {
          frames[t * KEYS + k] = 0;
          onsets[t * KEYS + k] = 0;
        }
  if (settings.inferOnsets ?? true) inferOnsets(onsets, frames, n);

  // Onsets that are peaks in time and likely enough, latest first (and the higher key first at the same frame).
  const starts: number[] = [];
  for (let t = n - 2; t >= 1; t--)
    for (let k = KEYS - 1; k >= 0; k--) {
      const v = onsets[t * KEYS + k];
      if (v >= settings.onsetThreshold && v > onsets[(t - 1) * KEYS + k] && v > onsets[(t + 1) * KEYS + k]) starts.push(t * KEYS + k);
    }

  const remaining = new Float32Array(frames);
  const notes: FrameNote[] = [];
  const minFrames = settings.minFrames;
  const mean = (from: number, to: number, k: number) => {
    let sum = 0;
    for (let t = from; t < to; t++) sum += frames[t * KEYS + k];
    return to > from ? sum / (to - from) : 0;
  };
  const clear = (t: number, k: number) => {
    remaining[t * KEYS + k] = 0;
    if (k < KEYS - 1) remaining[t * KEYS + k + 1] = 0;
    if (k > 0) remaining[t * KEYS + k - 1] = 0;
  };

  for (const index of starts) {
    const start = Math.floor(index / KEYS);
    const k = index % KEYS;
    if (start >= n - 1) continue;
    let i = start + 1;
    let quiet = 0;
    while (i < n - 1 && quiet < ENERGY_TOLERANCE) {
      quiet = remaining[i * KEYS + k] < frameThreshold ? quiet + 1 : 0;
      i++;
    }
    i -= quiet;
    if (i - start <= minFrames) continue;
    for (let t = start; t < i; t++) clear(t, k);
    notes.push({ start, end: i, key: k, amplitude: mean(start, i, k) });
  }

  if (settings.melodia ?? true) {
    // What's left, strongest first: Basic Pitch takes the strongest remaining each time (`np.argmax`, the first of
    // equals in row order); a value only ever drops to 0, so walking them in that order is the same and fast.
    const left: number[] = [];
    for (let i = 0; i < remaining.length; i++) if (remaining[i] > frameThreshold) left.push(i);
    left.sort((a, b) => remaining[b] - remaining[a] || a - b);
    for (const index of left) {
      if (!(remaining[index] > frameThreshold)) continue;
      const mid = Math.floor(index / KEYS);
      const k = index % KEYS;
      remaining[index] = 0;
      let i = mid + 1;
      let quiet = 0;
      while (i < n - 1 && quiet < ENERGY_TOLERANCE) {
        quiet = remaining[i * KEYS + k] < frameThreshold ? quiet + 1 : 0;
        clear(i, k);
        i++;
      }
      const end = i - 1 - quiet;
      i = mid - 1;
      quiet = 0;
      while (i > 0 && quiet < ENERGY_TOLERANCE) {
        quiet = remaining[i * KEYS + k] < frameThreshold ? quiet + 1 : 0;
        clear(i, k);
        i--;
      }
      const start = i + 1 + quiet;
      if (end - start <= minFrames) continue;
      notes.push({ start, end, key: k, amplitude: mean(start, end, k) });
    }
  }
  return notes;
}

/** Basic Pitch's `get_infered_onsets`: a sudden rise in a note's activation counts as an onset too. */
function inferOnsets(onsets: Float32Array, frames: Float32Array, n: number) {
  const diff = new Float32Array(frames.length);
  let maxDiff = 0;
  let maxOnset = 0;
  for (let i = 0; i < onsets.length; i++) maxOnset = Math.max(maxOnset, onsets[i]);
  for (let t = 2; t < n; t++)
    for (let k = 0; k < KEYS; k++) {
      const at = frames[t * KEYS + k];
      const d = Math.max(0, Math.min(at - frames[(t - 1) * KEYS + k], at - frames[(t - 2) * KEYS + k]));
      diff[t * KEYS + k] = d;
      if (d > maxDiff) maxDiff = d;
    }
  if (!(maxDiff > 0)) return;
  const scale = maxOnset / maxDiff;
  for (let i = 0; i < onsets.length; i++) onsets[i] = Math.max(onsets[i], diff[i] * scale);
}

/** The melodic notes heard, in seconds (`model_output_to_notes`, without pitch bends: notes here have none). */
export const pickNotes = (heard: Pick<HeardAudio, "frames" | "notes" | "onsets">, settings: PickSettings): HeardNote[] =>
  pickFrameNotes(heard, settings)
    .map((note) => ({ start: frameTime(note.start), end: frameTime(note.end), pitch: note.key + LOWEST_KEY, level: note.amplitude }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------

/**
 * What drum hearing measures each frame (`DRUM_FEATURES.length × drumFrames` in `HeardAudio.drums`, feature by
 * feature): how sharply the sound gets louder (the onset strength, 0..1 of its largest); how much power each
 * drum's band gained across the frame (decibels from `-DRUM_RANGE_DB` up to 0, the file's largest gain in any
 * band, as 0..1), so the bands compare with each other as well as with themselves; and by how many decibels each
 * band rose (0..`DRUM_RISE_DB` as 0..1), which tells a struck drum (a jump) from one still swelling (a kick's
 * falling pitch entering its band).
 */
export const DRUM_FEATURES = ["onset", "kick", "snare", "hat", "kickRise", "snareRise", "hatRise"] as const;
export const DRUM_RISE_DB = 40;
const DRUM_FFT = 1024;
/** Each drum's band (Hz) at `ANALYSIS_RATE`: a kick's body, a snare's crack, a hat's sizzle. */
const DRUM_BANDS: Record<Drum, [number, number]> = { kick: [35, 130], snare: [1000, 4000], hat: [6000, 11_000] };
/** The span of power gains kept (dB below the largest). */
export const DRUM_RANGE_DB = 90;
/** Bins this far below the file's loudest count as silence for onsets (rises out of silence aren't hits). */
const ONSET_FLOOR_DB = 60;
/** A gain is measured from this many frames before a frame to as many after it: windows wholly before and after. */
const GAIN_REACH = 2;

/**
 * Drum hearing's measurements (the server's half, from mono samples at `ANALYSIS_RATE`, a frame every
 * `FRAME_HOP` samples): each frame's onset strength (spectral flux in decibels, every bin from a kick's to a
 * hat's) and each drum band's power gain (`DRUM_FEATURES`).
 */
export function drumFeatures(samples: Float32Array): { frames: number; features: Float32Array[] } {
  const frames = Math.max(0, Math.floor((samples.length - 1) / FRAME_HOP) + 1);
  const window = hann(DRUM_FFT);
  const bins = DRUM_FFT / 2 + 1;
  const binOf = (hz: number) => clamp(Math.round(hz / (ANALYSIS_RATE / DRUM_FFT)), 1, DRUM_FFT / 2);
  const re = new Float64Array(DRUM_FFT);
  const im = new Float64Array(DRUM_FFT);
  // Every frame's power spectrum (each frame centred on its time, as Basic Pitch's are).
  const power = new Float32Array(frames * bins);
  let loudest = 1e-12;
  for (let f = 0; f < frames; f++) {
    const centre = f * FRAME_HOP;
    for (let i = 0; i < DRUM_FFT; i++) {
      const at = centre - DRUM_FFT / 2 + i;
      re[i] = at >= 0 && at < samples.length ? samples[at] * window[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const p = re[b] * re[b] + im[b] * im[b];
      power[f * bins + b] = p;
      if (p > loudest) loudest = p;
    }
  }
  const floor = loudest * 10 ** (-ONSET_FLOOR_DB / 10);
  const db = (p: number) => 10 * Math.log10(Math.max(p, floor));
  const low = binOf(DRUM_BANDS.kick[0]);
  const high = binOf(DRUM_BANDS.hat[1]);
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    let rise = 0;
    for (let b = low; b <= high; b++) rise += Math.max(0, db(power[f * bins + b]) - db(power[(f - 1) * bins + b]));
    onset[f] = rise;
  }
  const rises: Float32Array[] = [];
  const gains = DRUMS.map((drum) => {
    const [from, to] = [binOf(DRUM_BANDS[drum][0]), binOf(DRUM_BANDS[drum][1])];
    const gain = new Float32Array(frames);
    const rise = new Float32Array(frames);
    // The band's whole power in each frame, against the file's floor (rises out of silence count from there).
    const level = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let b = from; b <= to; b++) sum += power[f * bins + b];
      level[f] = sum;
    }
    const bandFloor = floor * (to - from + 1);
    for (let f = 0; f < frames; f++) {
      const before = f - GAIN_REACH;
      const after = Math.min(frames - 1, f + GAIN_REACH);
      let sum = 0;
      for (let b = from; b <= to; b++) sum += Math.max(0, power[after * bins + b] - (before >= 0 ? power[before * bins + b] : 0));
      gain[f] = sum;
      const was = Math.max(before >= 0 ? level[before] : 0, bandFloor);
      rise[f] = clamp((10 * Math.log10(Math.max(level[after], bandFloor) / was)) / DRUM_RISE_DB, 0, 1);
    }
    rises.push(rise);
    return gain;
  });
  let maxOnset = 0;
  for (const v of onset) maxOnset = Math.max(maxOnset, v);
  if (maxOnset > 0) for (let f = 0; f < frames; f++) onset[f] /= maxOnset;
  let maxGain = 1e-20;
  for (const gain of gains) for (const v of gain) maxGain = Math.max(maxGain, v);
  for (const gain of gains) for (let f = 0; f < frames; f++) gain[f] = clamp(1 + (10 * Math.log10(Math.max(gain[f], 1e-30) / maxGain)) / DRUM_RANGE_DB, 0, 1);
  return { frames, features: [onset, ...gains, ...rises] };
}

/** An onset this strong (of the file's strongest) is a hit at 0.5 sensitivity; each 0.1 more lowers it by a fifth. */
const ONSET_THRESHOLD = 0.1;
/** ...and it stands this far above the onset strength around it (its median over about a quarter-second). */
const ONSET_LIFT = 0.05;
const MEDIAN_REACH = 12;
/** A hit is the strongest onset within this many frames either side (about 35 ms). */
const PEAK_REACH = 3;
/** A drum is in a hit when its band gained within this many dB of its loudest hit in the file, at 0.5 sensitivity. */
const PRESENT_DB = 20;
/** A hat's band outgains a snare's by this many dB when the hat is struck (a snare's sizzle stays below it). */
const HAT_OVER_SNARE_DB = 6;
/** A drum struck jumps by this many dB in its band (a kick's band also swells as its pitch falls into it). */
const STRUCK_DB = 3;
/** The same drum isn't struck twice within this many frames (about 70 ms): what's sooner is its own tail. */
const SAME_DRUM_GAP = 6;
/**
 * A kick's beater clicks in a snare's band too, some decibels below its body; with a kick, a snare is heard
 * only if its band stands this far above the song's usual click (the quieter quarter of its kicks' clicks).
 */
const OVER_CLICK_DB = 8;
/** The click assumed (dB below the kick's body) when a song has too few kicks to tell. */
const DEFAULT_CLICK_DB = -22;
/** A kick's band never gains much less than a snare's when it's struck (a snare's low end does). */
const KICK_UNDER_SNARE_DB = 10;

/**
 * Drum hits in drum hearing's measurements: an onset wherever its strength peaks above a threshold set by
 * `sensitivity` (0..1, 0.5 as made), and in each, the drums whose band gained power within reach of their
 * loudest hits (and jumped: a kick's band swells as its pitch falls into it); a hat's band must outgain the
 * snare's (a snare sizzles up there too), a snare's band must hold its own against the hat's (a hat reaches down
 * into it) and, with a kick, stand above the kick's click. Each hit's level is its band's gain against its
 * loudest. Hats struck with a snare are often heard as the snare alone.
 */
export function pickDrumHits(heard: Pick<HeardAudio, "drums" | "drumFrames">, sensitivity: number): { drum: Drum; time: number; level: number }[] {
  const n = heard.drumFrames;
  if (n < 3) return [];
  const feature = (i: number) => Float32Array.from(heard.drums.subarray(i * n, (i + 1) * n), (v) => v / ACTIVATION_SCALE);
  const onset = feature(0);
  const gains = DRUMS.map((_, d) => feature(1 + d));
  const rises = DRUMS.map((_, d) => feature(1 + DRUMS.length + d));
  const s = clamp(sensitivity, 0, 1);
  const threshold = ONSET_THRESHOLD * 2 ** ((0.5 - s) * 3);
  const reachDb = PRESENT_DB + (s - 0.5) * 30;

  // The onsets: peaks above the threshold and above what's around them.
  const times: number[] = [];
  const around: number[] = [];
  for (let t = 1; t < n - 1; t++) {
    const v = onset[t];
    if (v < threshold) continue;
    let peak = true;
    for (let i = Math.max(0, t - PEAK_REACH); i <= Math.min(n - 1, t + PEAK_REACH) && peak; i++) if (onset[i] > v || (onset[i] === v && i < t)) peak = false;
    if (!peak) continue;
    around.length = 0;
    for (let i = Math.max(0, t - MEDIAN_REACH); i <= Math.min(n - 1, t + MEDIAN_REACH); i++) around.push(onset[i]);
    around.sort((a, b) => a - b);
    if (v < around[around.length >> 1] + ONSET_LIFT) continue;
    times.push(t);
  }
  if (!times.length) return [];

  // Each band's gain and rise at each onset's frame (the gain in dB below the file's largest), and each drum's
  // loudest hit among the onsets that sound like it (a snare's sizzle would make every hat seem quiet).
  const [KICK, SNARE, HAT] = [0, 1, 2];
  const at = times.map((t) => DRUMS.map((_, d) => (gains[d][t] - 1) * DRUM_RANGE_DB));
  const hatOver = (g: number[]) => g[HAT] - g[SNARE] >= HAT_OVER_SNARE_DB;
  const loudest = DRUMS.map((_, d) => Math.max(-DRUM_RANGE_DB, ...at.filter((g) => (d === HAT ? hatOver(g) : d === SNARE ? !hatOver(g) : true)).map((g) => g[d])));
  const struck = (d: number, i: number) => at[i][d] > -DRUM_RANGE_DB + 1 && at[i][d] >= loudest[d] - reachDb && rises[d][times[i]] * DRUM_RISE_DB >= STRUCK_DB;
  const clicks = times.flatMap((_, i) => (struck(KICK, i) && at[i][KICK] >= at[i][SNARE] - KICK_UNDER_SNARE_DB ? [at[i][SNARE] - at[i][KICK]] : [])).sort((a, b) => a - b);
  const click = clicks.length >= 4 ? clicks[Math.floor(clicks.length / 4)] : DEFAULT_CLICK_DB;
  const hits: { drum: Drum; time: number; level: number }[] = [];
  const last = DRUMS.map(() => -Infinity);
  times.forEach((t, i) => {
    const g = at[i];
    const present = (d: number) => struck(d, i) && t - last[d] >= SAME_DRUM_GAP;
    const add = (d: number) => {
      last[d] = t;
      hits.push({ drum: DRUMS[d], time: t * FRAME_SECONDS, level: clamp(1 + (g[d] - loudest[d]) / 40, 0.1, 1) });
    };
    const kick = present(KICK) && g[KICK] >= g[SNARE] - KICK_UNDER_SNARE_DB;
    if (kick) add(KICK);
    if (present(SNARE) && !hatOver(g) && (!kick || g[SNARE] - g[KICK] >= click + OVER_CLICK_DB)) add(SNARE);
    if (present(HAT) && hatOver(g)) add(HAT);
  });
  return hits;
}

// ---------------------------------------------------------------------------
// Travelling
// ---------------------------------------------------------------------------

const toBase64 = (data: Uint16Array) => {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

const fromBase64 = (text: string, length: number) => {
  const raw = atob(text);
  const bytes = new Uint8Array(length * 2);
  for (let i = 0; i < bytes.length && i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Uint16Array(bytes.buffer);
};

export const heardToJson = (heard: HeardAudio): HeardAudioJson => ({
  duration: heard.duration,
  frames: heard.frames,
  drumFrames: heard.drumFrames,
  notes: toBase64(heard.notes),
  onsets: toBase64(heard.onsets),
  drums: toBase64(heard.drums),
});

export const heardFromJson = (json: HeardAudioJson): HeardAudio => ({
  duration: json.duration,
  frames: json.frames,
  drumFrames: json.drumFrames,
  notes: fromBase64(json.notes, json.frames * KEYS),
  onsets: fromBase64(json.onsets, json.frames * KEYS),
  drums: fromBase64(json.drums, json.drumFrames * DRUM_FEATURES.length),
});

/** Drum hearing's measurements (each 0..1) in 16 bits, one after another. */
export function packDrums(bands: readonly Float32Array[], frames: number): Uint16Array {
  const out = new Uint16Array(DRUM_FEATURES.length * frames);
  bands.forEach((band, d) => {
    for (let i = 0; i < frames; i++) out[d * frames + i] = Math.round(clamp(band[i], 0, 1) * ACTIVATION_SCALE);
  });
  return out;
}
