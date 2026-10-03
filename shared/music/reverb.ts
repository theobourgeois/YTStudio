/**
 * The Reverb (`docs/reverb/reverb.md`): its edits, the curves its window draws (`decayCurve`: T60 against
 * frequency; `postCurve`; `shapeEnvelope`: the energy against time), and what the engine plays
 * (`engineReverb`). Pure and tested.
 *
 * The rule the other effects follow: what a knob means is decided here, the engine runs numbers. So the
 * window's Decay display, the assistant's `get_reverb` and the engine all take T60 from `reverbT60`.
 * The engine (`engine/src/Reverb.cpp`) rounds the lengths to primes at its rate, designs each line's
 * absorption from the ten T60s (Jot's shelf, then a ten-band graphic EQ), and runs the network.
 */
import { clamp } from "../math.ts";
import { findEffect } from "./automation.ts";
import { canSend, setSend } from "./mixer.ts";
import {
  ATTACK_RANGE,
  BAND_FREQ_RANGE,
  BAND_Q_RANGE,
  DE_ESS_FREQ_RANGE,
  DEFAULT_DECAY_BAND,
  HIGH_CUT_RANGE,
  HIGH_SHELF_RANGE,
  LEVEL_RANGE,
  LOW_CUT_RANGE,
  LOW_SHELF_RANGE,
  MAX_AUTO_DECAY,
  MAX_DE_ESS,
  MAX_DUCK,
  MAX_HOLD,
  MAX_PREDELAY,
  MAX_SHELF_GAIN,
  MAX_VLF_CUT,
  MAX_WIDTH,
  MOD_RATE_RANGE,
  MONO_BELOW_RANGE,
  MULTIPLIER_RANGE,
  PREDELAY_OFFSET_RANGE,
  RECOVERY_RANGE,
  RELEASE_RANGE,
  REVERB_BANDS,
  REVERB_DECAY_RANGE,
  REVERB_INFINITE,
  REVERB_PRESETS,
  THRESHOLD_RANGE,
  heardReverb,
  isInfinite,
  normalizeReverb,
  presetSetsMix,
  reverbPresetState,
} from "./reverb-presets.ts";
import { KHZ_BAND, PLATE_DIFFUSERS, PLATE_TAPS, REVERB_ERA_SPECS, REVERB_MODE_SPECS, REVERB_OCTAVES, naturalCurve } from "./reverb-modes.ts";
import type { MusicProject, Reverb, ReverbControl, ReverbDecayBand, ReverbNote, ReverbState } from "./types.ts";

// ---------------------------------------------------------------------------
// Finding and editing
// ---------------------------------------------------------------------------

/** A Reverb of the song, by its effect's id: its track, slot and settings. */
export function findReverb(song: MusicProject, effectId: string) {
  const found = findEffect(song, effectId);
  if (!found?.effect?.reverb) return null;
  return { track: found.track, slot: found.track.effects.indexOf(found.effect), effect: found.effect, reverb: found.effect.reverb };
}

/** The song's Reverbs, each with its track. */
export function reverbs(song: MusicProject) {
  return song.mixer.tracks.flatMap((track) => track.effects.flatMap((effect, slot) => (effect?.reverb ? [{ track, slot, effect, reverb: effect.reverb }] : [])));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const soundChanged = (a: ReverbState, b: ReverbState) => !same(heardReverb(a), heardReverb(b));

/** Change a Reverb (`change` returning equal settings: the same song). What it returns is validated. */
export function editReverb(song: MusicProject, effectId: string, change: (reverb: Reverb) => Reverb): MusicProject {
  const found = findReverb(song, effectId);
  if (!found) return song;
  const changed = change(found.reverb);
  if (changed === found.reverb) return song;
  const next = normalizeReverb(changed);
  if (same(next, found.reverb)) return song;
  const effects = found.track.effects.map((e) => (e === found.effect ? { ...e, reverb: next } : e));
  return { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t === found.track ? { ...t, effects } : t)) } };
}

type Nested = "input" | "early" | "late" | "ducking" | "output" | "view";
export type ReverbPatch = Partial<Omit<Reverb, Nested | "other" | "slot">> & {
  input?: Partial<Reverb["input"]>;
  early?: Partial<Reverb["early"]>;
  late?: Partial<Reverb["late"]>;
  ducking?: Partial<Reverb["ducking"]>;
  output?: Partial<Omit<Reverb["output"], "lowShelf" | "highShelf">> & { lowShelf?: Partial<Reverb["output"]["lowShelf"]>; highShelf?: Partial<Reverb["output"]["highShelf"]> };
  view?: Partial<Reverb["view"]>;
};

/** Merge a patch into settings (nested parts merged, not replaced). */
export function patchedReverb(r: Reverb, patch: ReverbPatch): Reverb {
  const { input, early, late, ducking, output, view, ...rest } = patch;
  return {
    ...r,
    ...rest,
    input: input ? { ...r.input, ...input } : r.input,
    early: early ? { ...r.early, ...early } : r.early,
    late: late ? { ...r.late, ...late } : r.late,
    ducking: ducking ? { ...r.ducking, ...ducking } : r.ducking,
    output: output
      ? {
          ...r.output,
          ...output,
          lowShelf: output.lowShelf ? { ...r.output.lowShelf, ...output.lowShelf } : r.output.lowShelf,
          highShelf: output.highShelf ? { ...r.output.highShelf, ...output.highShelf } : r.output.highShelf,
        }
      : r.output,
    view: view ? { ...r.view, ...view } : r.view,
  };
}

/** Change the Reverb's settings. A preset chosen stays named until the sound is changed. */
export function updateReverb(song: MusicProject, effectId: string, patch: ReverbPatch): MusicProject {
  return editReverb(song, effectId, (r) => {
    const next = patchedReverb(r, patch);
    return patch.preset === undefined && soundChanged(r, next) ? { ...next, preset: null } : next;
  });
}

/** Load a preset (by name): everything it sets; Mix left alone while Mix Lock is on (or the preset says nothing of it); the window's view and A/B kept. */
export function chooseReverbPreset(song: MusicProject, effectId: string, name: string): MusicProject {
  const state = reverbPresetState(name);
  if (!state) return song;
  return editReverb(song, effectId, (r) => ({ ...r, ...state, mix: r.mixLock || !presetSetsMix(name) ? r.mix : state.mix, ducking: { ...state.ducking, key: r.ducking.key }, preset: name }));
}

/** A/B: swap to the other state (the first switch copies this one there). Mix Lock keeps the Mix. */
export function switchReverbAB(song: MusicProject, effectId: string): MusicProject {
  return editReverb(song, effectId, (r) => {
    const here = heardReverb(r);
    const there = r.other ?? here;
    return { ...r, ...there, mix: r.mixLock ? r.mix : there.mix, other: here, slot: r.slot === "a" ? "b" : "a" };
  });
}

/** A/B's Copy: this state to the other. */
export const copyReverbAB = (song: MusicProject, effectId: string) => editReverb(song, effectId, (r) => ({ ...r, other: heardReverb(r) }));

/** Paste a whole Reverb's sound (Copy / Paste, from any track): this one's Mix kept while it's locked, its key and view kept. */
export function pasteReverb(song: MusicProject, effectId: string, copied: ReverbState): MusicProject {
  return editReverb(song, effectId, (r) => {
    const state = heardReverb(copied);
    return { ...r, ...state, mix: r.mixLock ? r.mix : state.mix, ducking: { ...state.ducking, key: r.ducking.key }, preset: null };
  });
}

// ---------------------------------------------------------------------------
// The Decay EQ's bands
// ---------------------------------------------------------------------------

/** The next free band number (1..6), or null. */
export function freeDecayBand(bands: readonly ReverbDecayBand[]): number | null {
  for (let id = 1; id <= REVERB_BANDS; id++) if (!bands.some((b) => b.id === id)) return id;
  return null;
}

/** Add a band (a double-click on the display): its number, or null when all six are used. */
export function addDecayBand(song: MusicProject, effectId: string, band: Partial<Omit<ReverbDecayBand, "id">>): { song: MusicProject; id: number | null } {
  const found = findReverb(song, effectId);
  const id = found ? freeDecayBand(found.reverb.bands) : null;
  if (!found || id === null) return { song, id: null };
  const made: ReverbDecayBand = { ...DEFAULT_DECAY_BAND, ...band, id };
  return { song: updateReverb(song, effectId, { bands: [...found.reverb.bands, made].sort((a, b) => a.id - b.id) }), id };
}

/** Change bands (by number) with `change`, or remove them (`change` null). */
export function editDecayBands(song: MusicProject, effectId: string, ids: Iterable<number>, change: ((band: ReverbDecayBand) => ReverbDecayBand) | null): MusicProject {
  const wanted = new Set(ids);
  const found = findReverb(song, effectId);
  if (!found) return song;
  const bands = change === null ? found.reverb.bands.filter((b) => !wanted.has(b.id)) : found.reverb.bands.map((b) => (wanted.has(b.id) ? { ...change(b), id: b.id } : b));
  return updateReverb(song, effectId, { bands });
}

/** The Ducking key from another track (FL's sidechain, as Pro-C's): that track, and a send at 0% from it if it doesn't send here yet. */
export function setReverbKey(song: MusicProject, effectId: string, trackId: string | null): MusicProject {
  const found = findReverb(song, effectId);
  if (!found) return song;
  if (trackId === null) return updateReverb(song, effectId, { ducking: { key: null } });
  if (trackId === found.track.id) return song;
  const source = song.mixer.tracks.find((t) => t.id === trackId);
  if (!source) return song;
  let next = song;
  if (!source.sends.some((s) => s.to === found.track.id)) {
    if (!canSend(song, trackId, found.track.id)) return song;
    next = setSend(song, trackId, found.track.id, 0);
  }
  return updateReverb(next, effectId, { ducking: { key: trackId } });
}

/** Whether a Reverb's ducking key track sends to it (if not, it ducks under nothing). */
export function keyConnected(song: MusicProject, effectId: string): boolean {
  const found = findReverb(song, effectId);
  const source = found?.reverb.ducking.key ? song.mixer.tracks.find((t) => t.id === found.reverb.ducking.key) : null;
  return !!found && !!source && source.sends.some((s) => s.to === found.track.id);
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/** A note value's length in seconds at a tempo: 1/4 is a beat; dotted ×1.5, triplet ×2/3. */
export function noteSeconds(n: ReverbNote, bpm: number): number {
  const beats = (4 / n.note) * (n.feel === "dotted" ? 1.5 : n.feel === "triplet" ? 2 / 3 : 1);
  return (beats * 60) / Math.max(1, bpm);
}

/** A note value said: "1/16", "1/8 dot", "1/32 tri". */
export const formatNote = (n: ReverbNote) => `1/${n.note}${n.feel === "dotted" ? " dot" : n.feel === "triplet" ? " tri" : ""}`;

/** "1/8", "1/8 dot" ("1/8d", "1/8."), "1/16 tri" ("1/16t") as a note value, or null. */
export function parseNote(text: string): ReverbNote | null {
  const m = /^1\s*\/\s*(\d+)\s*(\.|d|dot|dotted|t|tri|trip|triplet)?$/.exec(text.trim().toLowerCase());
  if (!m) return null;
  const note = Number(m[1]);
  if (![64, 32, 16, 8, 4, 2].includes(note)) return null;
  return { note: note as ReverbNote["note"], feel: !m[2] ? "straight" : m[2].startsWith("t") ? "triplet" : "dotted" };
}

/** The pre-delay heard (s): the time, or the note value at the tempo times Offset (within 0..1 s). */
export const predelaySeconds = (r: ReverbState, bpm: number) => (r.sync ? clamp(noteSeconds(r.predelayNote, bpm) * r.predelayOffset, 0, 1) : r.predelay);
/** The ducker's release heard (s). */
export const releaseSeconds = (r: ReverbState, bpm: number) => (r.ducking.releaseSync ? clamp(noteSeconds(r.ducking.releaseNote, bpm), RELEASE_RANGE[0], RELEASE_RANGE[1]) : r.ducking.release);

/** Milliseconds or seconds, as the window shows a time. */
export function formatSeconds(s: number): string {
  if (s < 1) return `${(s * 1000).toFixed(s < 0.01 ? 1 : 0)} ms`;
  return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`;
}
/** Decay said ("1.80 s", "∞"). */
export const formatDecay = (s: number) => (isInfinite(s) ? "∞" : formatSeconds(s));
/** A frequency said ("200 Hz", "6.5 kHz"). */
export const formatHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : hz % 1000 === 0 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);

// ---------------------------------------------------------------------------
// How long each frequency rings
// ---------------------------------------------------------------------------

/** A Decay EQ band's multiplier at a frequency (its log multiplier shaped across frequency). */
export function bandMultiplier(band: ReverbDecayBand, frequency: number): number {
  if (!band.enabled) return 1;
  const x = Math.log2(frequency / band.frequency);
  const q = clamp(band.q, BAND_Q_RANGE[0], BAND_Q_RANGE[1]);
  const amount = Math.log(band.shape === "notch" ? Math.min(1, band.multiplier) : band.multiplier);
  let shape: number;
  switch (band.shape) {
    case "lowShelf":
      shape = 1 / (1 + 2 ** (4 * q * x));
      break;
    case "highShelf":
      shape = 1 / (1 + 2 ** (-4 * q * x));
      break;
    case "notch": {
      const r = frequency / band.frequency - band.frequency / frequency;
      shape = 1 / (1 + (2 * q * r) ** 2);
      break;
    }
    default: {
      const r = frequency / band.frequency - band.frequency / frequency;
      shape = 1 / (1 + (q * r) ** 2);
    }
  }
  return Math.exp(amount * shape);
}

/** Every band's multiplier at a frequency (1 with the EQ bypassed). */
export function decayEq(r: ReverbState, frequency: number): number {
  if (r.bandsBypass) return 1;
  let m = 1;
  for (const b of r.bands) m *= bandMultiplier(b, frequency);
  return m;
}

/** What the bands and the mode ask for at a frequency, unsmoothed (seconds). */
export function askedT60(r: ReverbState, frequency: number): number {
  return r.decay * naturalCurve(r.mode, r.decay, frequency) * decayEq(r, frequency);
}

/** The mode's natural curve under Decay, no bands (seconds): the display's thin line. */
export const naturalT60 = (r: ReverbState, frequency: number) => r.decay * naturalCurve(r.mode, r.decay, frequency);

/** Neighbouring bands within this factor of each other: what an octave-band EQ can make. */
const NEIGHBOUR = 2.5;
/** The T60 an infinite decay sends (the engine holds the loop at unity from 999 s up). */
export const INFINITE_T60 = 1e4;

/**
 * The T60 at each octave band (`REVERB_OCTAVES`, seconds): Decay × the mode's natural curve × the Decay
 * EQ, each band's EQ averaged over its octave (a narrow notch becomes as deep a dip as an octave band can
 * make), the era's darkening and the mode's caps, neighbours kept within ×2.5, clamped to 0.05 .. 100 s.
 * What the engine designs its absorption for, and what the display draws.
 */
export function reverbT60(r: ReverbState): number[] {
  if (isInfinite(r.decay)) return REVERB_OCTAVES.map(() => INFINITE_T60);
  const spec = REVERB_MODE_SPECS[r.mode];
  const era = REVERB_ERA_SPECS[r.era];
  const t = REVERB_OCTAVES.map((f, b) => {
    // The EQ averaged in log over the octave around the band.
    let sum = 0;
    for (let k = -4; k <= 4; k++) sum += Math.log(decayEq(r, f * 2 ** (k / 8)));
    let v = r.decay * naturalCurve(r.mode, r.decay, f) * Math.exp(sum / 9);
    if (b === 8) v *= era.darken[0];
    if (b === 9) v *= era.darken[1];
    if (spec.topCap !== null && f >= 8000) v = Math.min(v, spec.topCap * Math.sqrt(10000 / f));
    if (spec.decayCap !== null) v = Math.min(v, spec.decayCap * naturalCurve(r.mode, r.decay, f));
    return clamp(v, 0.05, 100);
  });
  // Outwards from 1 kHz, each band within ×2.5 of the one nearer it.
  for (let b = KHZ_BAND + 1; b < t.length; b++) t[b] = clamp(t[b], t[b - 1] / NEIGHBOUR, t[b - 1] * NEIGHBOUR);
  for (let b = KHZ_BAND - 1; b >= 0; b--) t[b] = clamp(t[b], t[b + 1] / NEIGHBOUR, t[b + 1] * NEIGHBOUR);
  return t.map((v) => Math.round(v * 1e4) / 1e4);
}

/**
 * The decay curve the engine plays at any frequency (seconds): through the octave bands' T60s (a
 * Catmull-Rom in log time against log frequency, held past either end).
 */
export function decayCurve(t60: readonly number[], frequency: number): number {
  const x = Math.log2(frequency / REVERB_OCTAVES[0]);
  if (x <= 0) return t60[0];
  if (x >= t60.length - 1) return t60[t60.length - 1];
  const i = Math.floor(x);
  const f = x - i;
  const y = (k: number) => Math.log(t60[clamp(k, 0, t60.length - 1)]);
  const y0 = y(i - 1),
    y1 = y(i),
    y2 = y(i + 1),
    y3 = y(i + 2);
  const v = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
  return Math.exp(v);
}

// ---------------------------------------------------------------------------
// The Post EQ (what the wet sound's level is across frequency)
// ---------------------------------------------------------------------------

/** A Butterworth cut's response (dB) at a frequency: `order` 2 (12 dB/oct) or 4 (24). */
const butterworth = (high: boolean, cutoff: number, order: number, f: number) => {
  const ratio = high ? cutoff / f : f / cutoff;
  return -10 * Math.log10(1 + ratio ** (2 * order));
};
/** A first-order shelf's response (dB) at a frequency: `gain` dB below (low) or above (high) `corner`, half of it at the corner. */
const shelf = (high: boolean, corner: number, gain: number, f: number) => {
  const g = 10 ** (gain / 20);
  const w2 = (f / corner) ** 2;
  const power = high ? (g * w2 + 1) / (w2 / g + 1) : (w2 + g) / (w2 + 1 / g);
  return 10 * Math.log10(power);
};

/** The Post EQ's response at a frequency (dB): the cuts, the shelves and Studio's filters. */
export function postCurve(r: ReverbState, frequency: number): number {
  let db = 0;
  if (r.lowCut > LOW_CUT_RANGE[0] + 0.5) db += butterworth(true, r.lowCut, r.lowCutSlope === 24 ? 4 : 2, frequency);
  if (r.highCut < HIGH_CUT_RANGE[1] - 1) db += butterworth(false, r.highCut, r.highCutSlope === 24 ? 4 : 2, frequency);
  if (r.output.studio) db += butterworth(true, 600, 4, frequency) + butterworth(false, 10000, 4, frequency);
  if (Math.abs(r.output.lowShelf.gain) > 1e-3) db += shelf(false, r.output.lowShelf.frequency, r.output.lowShelf.gain, frequency);
  if (Math.abs(r.output.highShelf.gain) > 1e-3) db += shelf(true, r.output.highShelf.frequency, r.output.highShelf.gain, frequency);
  return db;
}

// ---------------------------------------------------------------------------
// The early energy: velvet taps
// ---------------------------------------------------------------------------

/** A 32-bit seed from a string (FNV-1a). */
export function reverbSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32: uniform 0..1, the same every time for a seed. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The most early taps a side has (6.7's cap). */
export const MAX_EARLY_TAPS = 400;

/** One early tap: seconds after the pre-delay (at scale 1), its gain (signed), its rank (it plays while the density's fraction is above it), its side. */
export interface EarlyTap {
  at: number;
  gain: number;
  rank: number;
  side: 0 | 1;
}

/** The early density (pulses a second) at a Diffusion: the mode's at 60%, ×2.3 at 100%, ×0.29 at 0, within 300 .. 4000. */
export const earlyDensity = (modeDensity: number, diffusion: number) => clamp(modeDensity * 2 ** ((diffusion - 0.6) * 3), 300, 4000);

/**
 * The velvet taps (6.7): a ±1 pulse at a random place in each cell, laid at the most density the
 * pattern can have, each with a rank so the Diffusion's density (a fraction of the cells) picks which
 * play; shaped by Distance (near: falling from a strong first tap; far: rising then falling, its first
 * fifth thinned). Seeded by the effect and Variation; a sequence a side.
 */
export function earlyTaps(r: ReverbState, seed: number): { taps: EarlyTap[]; most: number } {
  const spec = REVERB_MODE_SPECS[r.mode].early;
  if (!spec) return { taps: [], most: 1 };
  const start = spec.start / 1000;
  const length = Math.max(0.001, (spec.end - spec.start) / 1000);
  const most = Math.min(4000, MAX_EARLY_TAPS / length);
  const cells = Math.max(1, Math.floor(length * most));
  const cell = length / cells;
  const taps: EarlyTap[] = [];
  const d = clamp(r.distance, 0, 1);
  for (const side of [0, 1] as const) {
    const next = random((seed ^ (side ? 0x9e3779b9 : 0x85ebca6b) ^ Math.imul(r.late.variation, 0x27d4eb2d)) >>> 0);
    for (let k = 0; k < cells; k++) {
      const position = (k + next()) * cell;
      const sign = next() < 0.5 ? -1 : 1;
      let rank = next();
      const u = position / length;
      // Hall's slow build: thinner at its start.
      if (spec.startDensity) rank /= (spec.startDensity + (spec.density - spec.startDensity) * u) / spec.density;
      // Far: the first fifth thinned.
      if (u < 0.2) rank /= 1 - 0.75 * d * (1 - u / 0.2);
      const near = Math.exp(-3 * u) * (k === 0 ? 2 : 1);
      const peak = 0.6;
      const far = (u / peak) * Math.exp(1 - u / peak);
      const env = near * (1 - d) + far * d;
      taps.push({ at: Math.round((start + position) * 1e6) / 1e6, gain: Math.round(sign * env * 1e4) / 1e4, rank: Math.round(rank * 1e4) / 1e4, side });
    }
  }
  return { taps, most };
}

/** The most density a mode's pattern is laid at (pulses a second). */
export function earlyMost(r: ReverbState): number {
  const spec = REVERB_MODE_SPECS[r.mode].early;
  return spec ? Math.min(4000, MAX_EARLY_TAPS / Math.max(0.001, (spec.end - spec.start) / 1000)) : 1;
}

/** The fraction of the cells that play at this Diffusion (the density lane). */
export function earlyFraction(r: ReverbState, most: number): number {
  const spec = REVERB_MODE_SPECS[r.mode].early;
  return spec ? clamp(earlyDensity(spec.density, r.diffusion) / most, 0, 1) : 0;
}

// ---------------------------------------------------------------------------
// The network
// ---------------------------------------------------------------------------

/** A line of the late network (6.5): an all-pass then a delay (seconds at scale 1), what it takes from each input side. */
export interface EngineReverbLine {
  allpass: number;
  delay: number;
  apGain: number;
  modDelay: boolean;
  modAllpass: boolean;
  inLeft: number;
  inRight: number;
}

/** An output tap: a line, inside its delay (0) or its all-pass (1), seconds back from that part's input (at scale 1), its gain, its side. */
export interface EngineReverbTap {
  line: number;
  where: 0 | 1;
  at: number;
  gain: number;
  side: 0 | 1;
}

/** The late network as the engine builds it: a change to any of it is a new network (the old one rings out beside it). */
export interface EngineReverbNetwork {
  matrix: "ring" | "hadamard";
  lines: EngineReverbLine[];
  taps: EngineReverbTap[];
  /** Plate's input diffusers (seconds at scale 1, gains at Diffusion 100%). */
  diffusers: { length: number; gain: number }[];
  /** Read positions quantised to 1/this of a sample (an era's), 0: not. */
  quantise: number;
  /** The loop's converter (an era's): bits (0: none), saturating at `clip` × full scale. */
  bits: number;
  clip: number;
}

/** A Hadamard row's sign at a column (16 × 16, Sylvester's). */
const hadamard = (row: number, column: number) => {
  let x = row & column,
    n = 0;
  while (x) {
    n += x & 1;
    x >>= 1;
  }
  return n % 2 ? -1 : 1;
};

/** Each tap's gain shaped so the early output follows the 1 kHz exponential (Costello's "shaping the reverb output taps"). */
const shaped = (gain: number, at: number, t60: number) => gain * 10 ** ((-3 * at) / Math.max(0.1, t60));

function network(r: ReverbState, t60: number): EngineReverbNetwork {
  const spec = REVERB_MODE_SPECS[r.mode];
  const era = REVERB_ERA_SPECS[r.era];
  const ms = (v: number) => Math.round(v * 1e3) / 1e6;
  const common = { quantise: era.quantise, bits: era.bits, clip: era.clip };
  if (spec.topology === "plate") {
    // Dattorro's figure-eight: line i feeds i + 1; the diffused input into both halves (lines 0 and 2).
    const lines = spec.lines.map((l, i) => ({ allpass: ms(l.allpass), delay: ms(l.delay), apGain: l.apGain, modDelay: false, modAllpass: l.modAllpass, inLeft: i % 2 === 0 ? 0.5 : 0, inRight: i % 2 === 0 ? 0.5 : 0 }));
    // Decay diffusion 2 follows the decay ("= decay + 0.15, floor 0.25, ceiling 0.50"): his decay gain at this T60.
    const half = (spec.lines[0].allpass + spec.lines[0].delay + spec.lines[1].allpass + spec.lines[1].delay) / 1000;
    const dd2 = clamp(10 ** ((-1.5 * half) / Math.max(0.1, t60)) + 0.15, 0.25, 0.5);
    for (const i of [1, 3]) lines[i].apGain = Math.round(dd2 * 1e4) / 1e4;
    const taps = PLATE_TAPS.map((t) => ({ line: t.line, where: t.where === "delay" ? (0 as const) : (1 as const), at: ms(t.at), gain: Math.round(shaped(0.6 * t.sign, t.at / 1000, t60) * 1e4) / 1e4, side: t.side }));
    return { matrix: "ring", lines, taps, diffusers: PLATE_DIFFUSERS.map((d) => ({ length: ms(d.length), gain: d.gain })), ...common };
  }
  if (spec.topology === "smoothPlate") {
    // The figure-eight doubled: eight sections in a ring, the input at four points, signs alternating.
    const lines = spec.lines.map((l, i) => ({ allpass: ms(l.allpass), delay: ms(l.delay), apGain: l.apGain, modDelay: false, modAllpass: l.modAllpass, inLeft: i % 2 === 0 ? (i % 4 === 0 ? 0.5 : -0.5) : 0, inRight: i % 2 === 0 ? (i % 4 === 0 ? 0.5 : -0.5) : 0 }));
    const next = random(0x51a7e);
    const taps: EngineReverbTap[] = [];
    lines.forEach((l, i) => {
      for (const side of [0, 1] as const) {
        // Three in the delay (spread over it), one in the all-pass; signs from two Hadamard rows.
        const fractions = [0.08 + 0.2 * next(), 0.38 + 0.2 * next(), 0.7 + 0.25 * next()];
        fractions.forEach((f, k) => {
          const at = l.delay * f;
          taps.push({ line: i, where: 0, at: Math.round(at * 1e6) / 1e6, gain: Math.round(shaped(0.3 * hadamard(side ? 6 + k : 3 + k, i), at, t60) * 1e4) / 1e4, side });
        });
        const at = l.allpass * (0.3 + 0.4 * next());
        taps.push({ line: i, where: 1, at: Math.round(at * 1e6) / 1e6, gain: Math.round(-0.22 * hadamard(side ? 12 : 9, i) * 1e4) / 1e4, side });
      }
    });
    return { matrix: "ring", lines, taps, diffusers: [], ...common };
  }
  // A 16-line FDN: L into lines 0..7 and R into 8..15, with a Hadamard row's signs (Input Cross mixes them in the engine).
  const n = spec.lines.length;
  const norm = 1 / Math.sqrt(n / 2);
  const lines = spec.lines.map((l, i) => {
    const sign = hadamard(5, i) * norm;
    return { allpass: ms(l.allpass), delay: ms(l.delay), apGain: l.apGain, modDelay: l.modDelay, modAllpass: false, inLeft: i < n / 2 ? sign : 0, inRight: i < n / 2 ? 0 : sign };
  });
  const next = random(0xfd0 + n);
  const taps: EngineReverbTap[] = [];
  const g = 1 / Math.sqrt(2 * n);
  lines.forEach((l, i) => {
    for (const side of [0, 1] as const) {
      const at = l.delay * (0.15 + 0.8 * next());
      taps.push({ line: i, where: 0, at: Math.round(at * 1e6) / 1e6, gain: Math.round(shaped(g * hadamard(side ? 6 : 3, i), at, t60) * 1e4) / 1e4, side });
      const ap = l.allpass * (0.3 + 0.5 * next());
      taps.push({ line: i, where: 1, at: Math.round(ap * 1e6) / 1e6, gain: Math.round(0.7 * g * hadamard(side ? 10 : 9, i) * 1e4) / 1e4, side });
    }
  });
  return { matrix: "hadamard", lines, taps, diffusers: [], ...common };
}

/** The most a line may lose a pass (dB) at its shortest band, 500 Hz .. 8 kHz: past it the decay is a staircase of passes, not an exponential. */
const MOST_LOSS = 24;

/**
 * Every length's scale at a Size: `lo · (hi / lo)^Size`, lowered as Decay shortens so the longest line
 * never has to lose more than 24 dB a pass (6.6: a big network can't make a very short decay).
 */
export const sizeScale = (r: ReverbState) => {
  const spec = REVERB_MODE_SPECS[r.mode];
  const [lo, hi] = spec.scale;
  const scale = lo * (hi / lo) ** clamp(r.size, 0, 1);
  if (isInfinite(r.decay)) return scale;
  const t60 = reverbT60(r).slice(4, 9);
  const longest = Math.max(...spec.lines.map((l) => l.allpass + l.delay)) / 1000;
  return Math.min(scale, (MOST_LOSS * Math.min(...t60)) / 60 / longest);
};

// ---------------------------------------------------------------------------
// What the engine plays
// ---------------------------------------------------------------------------

/** The Reverb as the engine plays it (section 9.2): numbers, no mode names. */
export interface EngineReverb {
  network: EngineReverbNetwork;
  /** Every length's scale (Size). */
  scale: number;
  /** T60 at the ten octave bands, seconds (`INFINITE_T60`: held). */
  t60: number[];
  freeze: boolean;
  toneLock: boolean;
  /** Seconds. */
  predelay: number;
  early: {
    /** Flat: at, gain, rank per tap; `left` taps then `right`. */
    left: number[];
    right: number[];
    /** Linear: as heard (0: only into the loop), and what's sent into the late network (rather than the input). */
    level: number;
    send: number;
    cross: number;
    /** Hz: the early sound's air absorption. */
    air: number;
    /** 0..1: the fraction of the cells that play. */
    density: number;
    /** Plate: its input diffusers' gains × this (Diffusion). */
    diffuse: number;
    /** dB: the onset's shelf under 200 Hz. */
    vlf: number;
  };
  late: { level: number; apScale: number };
  mod: { rate: number; depth: number; shape: 0 | 1 };
  input: { mono: boolean; cross: number; lowCut: number; highCut: number; bandwidth: number };
  deEss: { amount: number; frequency: number };
  duck: { depth: number; threshold: number | null; attack: number; release: number; hold: number; tailOnly: boolean; key: number; autoDecay: number; recovery: number };
  post: {
    lowCut: number;
    lowSlope: 12 | 24;
    highCut: number;
    highSlope: 12 | 24;
    lowShelf: number;
    lowShelfGain: number;
    highShelf: number;
    highShelfGain: number;
    studio: boolean;
    monoBelow: number;
    width: number;
    level: number;
  };
  mix: { dry: number; wet: number };
  era: { bandLimit: number; aperture: boolean; emphasis: boolean; bits: number; gainRanging: boolean; noise: number };
  seed: number;
}

const dbGain = (db: number) => (Number.isFinite(db) ? 10 ** (db / 20) : 0);
/** Equal-power dry and wet. */
export const reverbMixGains = (mix: number): { dry: number; wet: number } => ({ dry: Math.cos((clamp(mix, 0, 1) * Math.PI) / 2), wet: Math.sin((clamp(mix, 0, 1) * Math.PI) / 2) });
const round = (v: number, digits = 1e5) => Math.round(v * digits) / digits;

/**
 * What the engine plays for a Reverb at a tempo, seeded by its effect's id (the velvet taps and the
 * random modulation are the same every time for the same effect). `key`: the ducking key's track index
 * (compile's; -1 this track's input).
 */
export function engineReverb(r: ReverbState, bpm: number, seed: number, key = -1, lanesOnly = false): EngineReverb {
  const spec = REVERB_MODE_SPECS[r.mode];
  const era = REVERB_ERA_SPECS[r.era];
  const t60 = reverbT60(r);
  // (An automation lane's values need neither the network nor the taps: `lanesOnly` leaves them out.)
  const net = lanesOnly ? { matrix: "ring" as const, lines: [], taps: [], diffusers: [], quantise: 0, bits: 0, clip: 0 } : network(r, isInfinite(r.decay) ? 10 : t60[KHZ_BAND]);
  const { taps, most } = lanesOnly ? { taps: [], most: earlyMost(r) } : earlyTaps(r, seed);
  const flat = (side: 0 | 1) => taps.filter((t) => t.side === side).flatMap((t) => [t.at, t.gain, t.rank]);
  const d = clamp(r.distance, 0, 1);
  const earlyHeard = spec.early && Number.isFinite(spec.early.level) ? dbGain(spec.early.level + 3 - 15 * d) : 0;
  const air = round(18000 * (6000 / 18000) ** d, 10);
  const lateDiffusion = r.late.diffusion ?? spec.lateDiffusion;
  return {
    network: net,
    scale: round(sizeScale(r)),
    t60,
    freeze: r.freeze,
    toneLock: r.late.toneLock,
    predelay: round(predelaySeconds(r, bpm), 1e6),
    early: {
      left: flat(0),
      right: flat(1),
      level: round(earlyHeard),
      send: r.early.send,
      cross: r.early.cross,
      air,
      density: round(earlyFraction(r, most), 1e4),
      diffuse: r.diffusion,
      vlf: r.input.vlfCut,
    },
    late: { level: round(dbGain(spec.lateLevel - 3 * (1 - d) + spec.calibration)), apScale: round(lateDiffusion / spec.lateDiffusion, 1e4) },
    mod: { rate: r.modRate, depth: round(0.001 * r.modDepth * r.modDepth, 1e7), shape: r.late.modShape === "random" ? 1 : 0 },
    input: {
      mono: r.input.mode === "mono" || (r.input.mode === "auto" && !spec.stereo),
      cross: r.input.cross,
      lowCut: r.input.lowCut,
      highCut: r.input.highCut,
      // Plate's input low-pass (Dattorro's bandwidth): Distance darkens what reaches the plate.
      bandwidth: spec.topology === "plate" ? air : HIGH_CUT_RANGE[1],
    },
    deEss: { amount: r.deEss, frequency: r.input.deEssFreq },
    duck: {
      depth: r.duck,
      threshold: r.ducking.threshold,
      attack: r.ducking.attack,
      release: round(releaseSeconds(r, bpm), 1e5),
      hold: r.ducking.hold,
      tailOnly: r.ducking.what === "tail",
      key,
      autoDecay: r.ducking.autoDecay,
      recovery: r.ducking.recovery,
    },
    post: {
      lowCut: r.lowCut,
      lowSlope: r.lowCutSlope,
      highCut: r.highCut,
      highSlope: r.highCutSlope,
      lowShelf: r.output.lowShelf.frequency,
      lowShelfGain: r.output.lowShelf.gain,
      highShelf: r.output.highShelf.frequency,
      highShelfGain: r.output.highShelf.gain,
      studio: r.output.studio,
      monoBelow: r.output.monoBelow,
      width: r.width,
      level: round(dbGain(r.output.level)),
    },
    mix: (({ dry, wet }) => ({ dry: round(dry), wet: round(wet) }))(reverbMixGains(r.mix)),
    era: { bandLimit: era.bandLimit, aperture: era.aperture, emphasis: era.emphasis, bits: era.bits, gainRanging: era.gainRanging, noise: Number.isFinite(era.noise) ? era.noise : -200 },
    seed,
  };
}

// ---------------------------------------------------------------------------
// The Shape display: the reverb over time
// ---------------------------------------------------------------------------

/** What the settings mean over time (not a measurement): the pre-delay, the early taps heard, the late build and each band's slope. */
export interface ShapeEnvelope {
  predelay: number;
  /** Seconds from the dry sound, dB (relative to the late sound's start). */
  early: { at: number; db: number; side: 0 | 1 }[];
  /** When the late sound starts and when it's built (seconds from the dry sound), its level then (dB). */
  lateStart: number;
  lateBuilt: number;
  lateDb: number;
  /** T60 at each octave band. */
  t60: number[];
}

export function shapeEnvelope(r: ReverbState, bpm: number, seed = 1): ShapeEnvelope {
  const spec = REVERB_MODE_SPECS[r.mode];
  const pre = predelaySeconds(r, bpm);
  const scale = sizeScale(r);
  const { taps, most } = earlyTaps(r, seed);
  const fraction = earlyFraction(r, most);
  const d = clamp(r.distance, 0, 1);
  const heard = spec.early && Number.isFinite(spec.early.level) ? spec.early.level + 3 - 15 * d : -Infinity;
  const active = taps.filter((t) => t.rank < fraction);
  const power = active.reduce((sum, t) => sum + t.gain * t.gain, 0) || 1;
  const early = Number.isFinite(heard)
    ? active.map((t) => ({ at: pre + t.at * scale, db: 20 * Math.log10(Math.max(1e-6, Math.abs(t.gain) / Math.sqrt(power))) + heard + 10, side: t.side }))
    : [];
  const shortest = Math.min(...spec.lines.map((l) => l.allpass + l.delay)) / 1000;
  const earlyEnd = spec.early ? spec.early.end / 1000 : 0;
  const lateStart = pre + (spec.topology === "plate" ? 0.005 : (spec.early?.start ?? 0) / 1000) * scale;
  return {
    predelay: pre,
    early,
    lateStart,
    lateBuilt: pre + Math.max(shortest, earlyEnd) * scale,
    lateDb: spec.lateLevel - 3 * (1 - d),
    t60: reverbT60(r),
  };
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

/** What an automation lane of the Reverb's sets in the engine (`EngineLaneTarget` "verb"): its values, from the settings at a moment. */
export const REVERB_LANES = {
  mix: (e: EngineReverb) => [e.mix.dry, e.mix.wet],
  t60: (e: EngineReverb) => e.t60,
  freeze: (e: EngineReverb) => [e.freeze ? 1 : 0],
  predelay: (e: EngineReverb) => [e.predelay],
  scale: (e: EngineReverb) => [e.scale],
  distance: (e: EngineReverb) => [e.early.level, e.late.level, e.early.air, e.input.bandwidth],
  density: (e: EngineReverb) => [e.early.density, e.early.diffuse],
  modRate: (e: EngineReverb) => [e.mod.rate],
  modDepth: (e: EngineReverb) => [e.mod.depth],
  width: (e: EngineReverb) => [e.post.width],
  postCuts: (e: EngineReverb) => [e.post.lowCut, e.post.highCut],
  deEss: (e: EngineReverb) => [e.deEss.amount, e.deEss.frequency],
  duck: (e: EngineReverb) => [e.duck.depth],
  inputCross: (e: EngineReverb) => [e.input.cross],
  inputCuts: (e: EngineReverb) => [e.input.lowCut, e.input.highCut],
  vlf: (e: EngineReverb) => [e.early.vlf],
  earlySend: (e: EngineReverb) => [e.early.send],
  earlyCross: (e: EngineReverb) => [e.early.cross],
  lateDiffusion: (e: EngineReverb) => [e.late.apScale],
  // Threshold Auto travels as 1 (above any threshold's range).
  duckTimes: (e: EngineReverb) => [e.duck.threshold ?? 1, e.duck.attack, e.duck.release, e.duck.hold],
  autoDecay: (e: EngineReverb) => [e.duck.autoDecay, e.duck.recovery],
  shelves: (e: EngineReverb) => [e.post.lowShelf, e.post.lowShelfGain, e.post.highShelf, e.post.highShelfGain],
  monoBelow: (e: EngineReverb) => [e.post.monoBelow],
  level: (e: EngineReverb) => [e.post.level],
} as const;
export type ReverbLane = keyof typeof REVERB_LANES;
/** The lanes in the engine's order (`verb::Lane`). */
export const REVERB_LANE_NAMES = Object.keys(REVERB_LANES) as ReverbLane[];

/** Which engine lanes each automatable control moves. */
export const REVERB_LANES_OF: Record<ReverbControl, readonly ReverbLane[]> = {
  mix: ["mix"],
  decay: ["t60"],
  freeze: ["freeze"],
  predelay: ["predelay"],
  size: ["scale"],
  distance: ["distance"],
  diffusion: ["density"],
  modRate: ["modRate"],
  modDepth: ["modDepth"],
  width: ["width"],
  lowCut: ["postCuts"],
  highCut: ["postCuts"],
  deEss: ["deEss"],
  duck: ["duck"],
  inputCross: ["inputCross"],
  inputLowCut: ["inputCuts"],
  inputHighCut: ["inputCuts"],
  deEssFreq: ["deEss"],
  vlfCut: ["vlf"],
  predelayOffset: ["predelay"],
  earlySend: ["earlySend"],
  earlyCross: ["earlyCross"],
  lateDiffusion: ["lateDiffusion"],
  threshold: ["duckTimes"],
  attack: ["duckTimes"],
  release: ["duckTimes"],
  hold: ["duckTimes"],
  autoDecay: ["autoDecay"],
  recovery: ["autoDecay"],
  lowShelfFreq: ["shelves"],
  lowShelfGain: ["shelves"],
  highShelfFreq: ["shelves"],
  highShelfGain: ["shelves"],
  monoBelow: ["monoBelow"],
  level: ["level"],
};

/**
 * An automatable control: its name, its value in the song (`get`, `set`), an automation clip's fraction
 * (0..1) as that value and back (the knob's taper, which its knob turns by too), its default, and its
 * value said. As OTT's (`OttControlSpec`).
 */
export interface ReverbControlSpec {
  name: string;
  get: (r: ReverbState) => number;
  set: (r: ReverbState, value: number) => ReverbState;
  toControl: (fraction: number) => number;
  fromControl: (value: number) => number;
  defaultValue: number;
  format: (value: number) => string;
}

const linear = (min: number, max: number) => ({ toControl: (f: number) => min + clamp(f, 0, 1) * (max - min), fromControl: (v: number) => clamp((v - min) / (max - min), 0, 1) });
const logTaper = (min: number, max: number) => ({
  toControl: (f: number) => min * (max / min) ** clamp(f, 0, 1),
  fromControl: (v: number) => clamp(Math.log(Math.max(v, min) / min) / Math.log(max / min), 0, 1),
});
/** Mix's taper: 10–40 % across the middle of the knob, where an insert lives (f²). */
const mixTaper = { toControl: (f: number) => clamp(f, 0, 1) ** 2, fromControl: (v: number) => Math.sqrt(clamp(v, 0, 1)) };
/** Pre-delay's: more travel under 100 ms (31 ms at a quarter, 125 ms at half). */
const predelayTaper = { toControl: (f: number) => MAX_PREDELAY * clamp(f, 0, 1) ** 2, fromControl: (v: number) => Math.sqrt(clamp(v / MAX_PREDELAY, 0, 1)) };
/** Decay's: log 0.1 .. 60 s over 97% of the knob, ∞ at its very top. */
const DECAY_TOP = 0.97;
const decayTaper = {
  toControl: (f: number) => (f >= 0.985 ? REVERB_INFINITE : REVERB_DECAY_RANGE[0] * (REVERB_DECAY_RANGE[1] / REVERB_DECAY_RANGE[0]) ** (Math.min(clamp(f, 0, 1), DECAY_TOP) / DECAY_TOP)),
  fromControl: (v: number) => (isInfinite(v) ? 1 : (DECAY_TOP * Math.log(clamp(v, REVERB_DECAY_RANGE[0], REVERB_DECAY_RANGE[1]) / REVERB_DECAY_RANGE[0])) / Math.log(REVERB_DECAY_RANGE[1] / REVERB_DECAY_RANGE[0])),
};
/** Mono Below's: off at the bottom, then 20 .. 500 Hz. */
const monoTaper = {
  toControl: (f: number) => (f < 0.02 ? 0 : MONO_BELOW_RANGE[0] * (MONO_BELOW_RANGE[1] / MONO_BELOW_RANGE[0]) ** ((clamp(f, 0, 1) - 0.02) / 0.98)),
  fromControl: (v: number) => (v < MONO_BELOW_RANGE[0] ? 0 : 0.02 + (0.98 * Math.log(clamp(v, MONO_BELOW_RANGE[0], MONO_BELOW_RANGE[1]) / MONO_BELOW_RANGE[0])) / Math.log(MONO_BELOW_RANGE[1] / MONO_BELOW_RANGE[0])),
};
const toggle = { toControl: (f: number) => (f >= 0.5 ? 1 : 0), fromControl: (v: number) => (v >= 0.5 ? 1 : 0) };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const lowCutText = (v: number) => (v <= LOW_CUT_RANGE[0] + 0.5 ? "Off" : formatHz(v));
const highCutText = (v: number) => (v >= HIGH_CUT_RANGE[1] - 1 ? "Off" : formatHz(v));

const top = <K extends keyof ReverbState>(key: K): Pick<ReverbControlSpec, "get" | "set"> => ({ get: (r) => r[key] as number, set: (r, v) => ({ ...r, [key]: v }) });
const inside = <G extends "input" | "early" | "ducking", K extends keyof ReverbState[G]>(group: G, key: K): Pick<ReverbControlSpec, "get" | "set"> => ({
  get: (r) => (r[group] as Record<string, number>)[key as string],
  set: (r, v) => ({ ...r, [group]: { ...r[group], [key]: v } }),
});
const shelfField = (which: "lowShelf" | "highShelf", key: "frequency" | "gain"): Pick<ReverbControlSpec, "get" | "set"> => ({
  get: (r) => r.output[which][key],
  set: (r, v) => ({ ...r, output: { ...r.output, [which]: { ...r.output[which], [key]: v } } }),
});

export const REVERB_CONTROL_SPECS: Record<ReverbControl, ReverbControlSpec> = {
  mix: { name: "Mix", ...top("mix"), ...mixTaper, defaultValue: 0.18, format: pct },
  decay: { name: "Decay", ...top("decay"), ...decayTaper, defaultValue: 1.8, format: formatDecay },
  freeze: { name: "Freeze", get: (r) => (r.freeze ? 1 : 0), set: (r, v) => ({ ...r, freeze: v >= 0.5 }), ...toggle, defaultValue: 0, format: (v) => (v >= 0.5 ? "On" : "Off") },
  predelay: { name: "Pre-delay", ...top("predelay"), ...predelayTaper, defaultValue: 0.02, format: formatSeconds },
  size: { name: "Size", ...top("size"), ...linear(0, 1), defaultValue: 0.5, format: pct },
  distance: { name: "Distance", ...top("distance"), ...linear(0, 1), defaultValue: 0.25, format: pct },
  diffusion: { name: "Diffusion", ...top("diffusion"), ...linear(0, 1), defaultValue: 0.6, format: pct },
  modRate: { name: "Mod Rate", ...top("modRate"), ...logTaper(MOD_RATE_RANGE[0], MOD_RATE_RANGE[1]), defaultValue: 0.8, format: (v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} Hz` },
  modDepth: { name: "Mod Depth", ...top("modDepth"), ...linear(0, 1), defaultValue: 0.4, format: pct },
  width: { name: "Width", ...top("width"), ...linear(0, MAX_WIDTH), defaultValue: 1, format: pct },
  lowCut: { name: "Low Cut", ...top("lowCut"), ...logTaper(LOW_CUT_RANGE[0], LOW_CUT_RANGE[1]), defaultValue: LOW_CUT_RANGE[0], format: lowCutText },
  highCut: { name: "High Cut", ...top("highCut"), ...logTaper(HIGH_CUT_RANGE[0], HIGH_CUT_RANGE[1]), defaultValue: HIGH_CUT_RANGE[1], format: highCutText },
  deEss: { name: "De-ess", ...top("deEss"), ...linear(0, MAX_DE_ESS), defaultValue: 0, format: (v) => `${v.toFixed(1)} dB` },
  duck: { name: "Duck", ...top("duck"), ...linear(-MAX_DUCK, 0), defaultValue: 0, format: db },
  inputCross: { name: "Input Cross", ...inside("input", "cross"), ...linear(0, 1), defaultValue: 0.3, format: pct },
  inputLowCut: { name: "Input Low Cut", ...inside("input", "lowCut"), ...logTaper(LOW_CUT_RANGE[0], LOW_CUT_RANGE[1]), defaultValue: LOW_CUT_RANGE[0], format: lowCutText },
  inputHighCut: { name: "Input High Cut", ...inside("input", "highCut"), ...logTaper(HIGH_CUT_RANGE[0], HIGH_CUT_RANGE[1]), defaultValue: HIGH_CUT_RANGE[1], format: highCutText },
  deEssFreq: { name: "De-ess Freq", ...inside("input", "deEssFreq"), ...logTaper(DE_ESS_FREQ_RANGE[0], DE_ESS_FREQ_RANGE[1]), defaultValue: 6500, format: formatHz },
  vlfCut: { name: "VLF Cut", ...inside("input", "vlfCut"), ...linear(-MAX_VLF_CUT, 0), defaultValue: 0, format: db },
  predelayOffset: { name: "Pre-delay Offset", ...top("predelayOffset"), ...logTaper(PREDELAY_OFFSET_RANGE[0], PREDELAY_OFFSET_RANGE[1]), defaultValue: 1, format: pct },
  earlySend: { name: "Early Send", ...inside("early", "send"), ...linear(0, 1), defaultValue: 1, format: pct },
  earlyCross: { name: "Early Cross", ...inside("early", "cross"), ...linear(0, 1), defaultValue: 0.5, format: pct },
  lateDiffusion: {
    name: "Late Diffusion",
    get: (r) => r.late.diffusion ?? REVERB_MODE_SPECS[r.mode].lateDiffusion,
    set: (r, v) => ({ ...r, late: { ...r.late, diffusion: v } }),
    ...linear(0, 1),
    defaultValue: 0.7,
    format: pct,
  },
  threshold: {
    name: "Threshold",
    get: (r) => r.ducking.threshold ?? -30,
    set: (r, v) => ({ ...r, ducking: { ...r.ducking, threshold: v } }),
    ...linear(THRESHOLD_RANGE[0], THRESHOLD_RANGE[1]),
    defaultValue: -30,
    format: (v) => `${v.toFixed(1)} dB`,
  },
  attack: { name: "Attack", ...inside("ducking", "attack"), ...logTaper(ATTACK_RANGE[0], ATTACK_RANGE[1]), defaultValue: 0.01, format: formatSeconds },
  release: { name: "Release", ...inside("ducking", "release"), ...logTaper(RELEASE_RANGE[0], RELEASE_RANGE[1]), defaultValue: 0.25, format: formatSeconds },
  hold: { name: "Hold", ...inside("ducking", "hold"), ...linear(0, MAX_HOLD), defaultValue: 0.05, format: formatSeconds },
  autoDecay: { name: "Auto-Decay", ...inside("ducking", "autoDecay"), ...linear(0, MAX_AUTO_DECAY), defaultValue: 0, format: pct },
  recovery: { name: "Recovery", ...inside("ducking", "recovery"), ...logTaper(RECOVERY_RANGE[0], RECOVERY_RANGE[1]), defaultValue: 0.1, format: formatSeconds },
  lowShelfFreq: { name: "Low Shelf Freq", ...shelfField("lowShelf", "frequency"), ...logTaper(LOW_SHELF_RANGE[0], LOW_SHELF_RANGE[1]), defaultValue: 200, format: formatHz },
  lowShelfGain: { name: "Low Shelf Gain", ...shelfField("lowShelf", "gain"), ...linear(-MAX_SHELF_GAIN, MAX_SHELF_GAIN), defaultValue: 0, format: db },
  highShelfFreq: { name: "High Shelf Freq", ...shelfField("highShelf", "frequency"), ...logTaper(HIGH_SHELF_RANGE[0], HIGH_SHELF_RANGE[1]), defaultValue: 8000, format: formatHz },
  highShelfGain: { name: "High Shelf Gain", ...shelfField("highShelf", "gain"), ...linear(-MAX_SHELF_GAIN, MAX_SHELF_GAIN), defaultValue: 0, format: db },
  monoBelow: {
    name: "Mono Below",
    get: (r) => r.output.monoBelow,
    set: (r, v) => ({ ...r, output: { ...r.output, monoBelow: v < MONO_BELOW_RANGE[0] ? 0 : v } }),
    ...monoTaper,
    defaultValue: 0,
    format: (v) => (v < MONO_BELOW_RANGE[0] ? "Off" : formatHz(v)),
  },
  level: { name: "Output", get: (r) => r.output.level, set: (r, v) => ({ ...r, output: { ...r.output, level: v } }), ...linear(LEVEL_RANGE[0], LEVEL_RANGE[1]), defaultValue: 0, format: db },
};

/** Set a Reverb's control to a value in its own units (a knob turned, an assistant's edit). */
export const setReverbControl = (song: MusicProject, effectId: string, control: ReverbControl, value: number) =>
  editReverb(song, effectId, (r) => {
    const next = { ...r, ...REVERB_CONTROL_SPECS[control].set(r, value) } as Reverb;
    return soundChanged(r, next) ? { ...next, preset: null } : r;
  });

/** The preset list's names in the menu's order (← → step through it). */
export const REVERB_PRESET_NAMES = REVERB_PRESETS.map((p) => p.name);

/** The ends of each knob a band's multiplier, as Pro-R 2's Decay Rate EQ shows it. */
export const MULTIPLIER_TEXT = (m: number) => `×${m < 1 ? m.toFixed(2) : m.toFixed(m < 10 ? 2 : 1)}`;

export { MULTIPLIER_RANGE, BAND_FREQ_RANGE };
