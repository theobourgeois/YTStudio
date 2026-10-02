/**
 * Pro-Q (`docs/fabfilter/pro-q.md`), FabFilter's EQ, ours: finding one in the song, its edits (bands made,
 * moved, reshaped, split, inverted, made dynamic; A/B; presets) and its settings for the engine
 * (`engineProQ`). What its filters sound like is `pro-q-filters.ts`. Pure and tested.
 */
import { clamp } from "../math.ts";
import { findEffect } from "./automation.ts";
import {
  DEFAULT_BAND,
  DEFAULT_PRO_Q_STATE,
  EQ_BANDS,
  EQ_MAX_FREQUENCY,
  EQ_MAX_GAIN,
  EQ_MAX_GAIN_SCALE,
  EQ_MAX_OUTPUT,
  EQ_MAX_Q,
  EQ_MIN_FREQUENCY,
  EQ_MIN_OUTPUT,
  EQ_MIN_Q,
  EQ_MIN_THRESHOLD,
  type ProQPreset,
  canBeDynamic,
  hasGain,
  shapeSlopes,
} from "./pro-q-presets.ts";
import { autoGain } from "./pro-q-filters.ts";
import { EQ_RESOLUTIONS, EQ_SHAPES, type EqBand, type EqPlacement, type EqShape, type EqSlope, type MusicProject, type ProQ, type ProQState } from "./types.ts";

// ---------------------------------------------------------------------------
// In the song
// ---------------------------------------------------------------------------

/** A Pro-Q of the song, by its effect's id: its track, slot and settings. */
export function findProQ(song: MusicProject, effectId: string) {
  const found = findEffect(song, effectId);
  if (!found?.effect?.proQ) return null;
  return { track: found.track, slot: found.track.effects.indexOf(found.effect), effect: found.effect, proQ: found.effect.proQ };
}

/** The song's Pro-Qs, each with its track. */
export function proQs(song: MusicProject) {
  return song.mixer.tracks.flatMap((track) => track.effects.flatMap((effect, slot) => (effect?.proQ ? [{ track, slot, effect, proQ: effect.proQ }] : [])));
}

/** Change a Pro-Q's settings (`change` returning the same settings: the same song). */
export function editProQ(song: MusicProject, effectId: string, change: (pq: ProQ) => ProQ): MusicProject {
  const found = findProQ(song, effectId);
  if (!found) return song;
  const next = change(found.proQ);
  if (next === found.proQ) return song;
  const effects = found.track.effects.map((e) => (e === found.effect ? { ...e, proQ: next } : e));
  return { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t === found.track ? { ...t, effects } : t)) } };
}

/** `next`, or `was` itself when nothing in it changed (so a no-op is no undo step). */
function same<T extends object>(was: T, next: T): T {
  for (const key of Object.keys(next) as (keyof T)[]) if (next[key] !== was[key]) return next;
  return was;
}

export type ProQPatch = Partial<Omit<ProQ, "bands" | "other" | "ab" | "analyzer">> & { analyzer?: Partial<ProQ["analyzer"]> };

/** Change Pro-Q's global settings (mode, output, gain scale, analyzer, display...): values kept in range. */
export function updateProQ(song: MusicProject, effectId: string, patch: ProQPatch): MusicProject {
  return editProQ(song, effectId, (pq) => {
    const num = (v: number | undefined, was: number, min: number, max: number) => (v !== undefined && Number.isFinite(v) ? clamp(v, min, max) : was);
    const analyzer = patch.analyzer ? same(pq.analyzer, { ...pq.analyzer, ...patch.analyzer }) : pq.analyzer;
    return same(pq, {
      ...pq,
      ...patch,
      gainScale: num(patch.gainScale, pq.gainScale, 0, EQ_MAX_GAIN_SCALE),
      output: num(patch.output, pq.output, EQ_MIN_OUTPUT, EQ_MAX_OUTPUT),
      pan: num(patch.pan, pq.pan, -1, 1),
      analyzer,
    });
  });
}

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/** Bands in the order they're shown (by frequency, then number): what the band controls' arrows step through. */
export const bandsInOrder = (bands: readonly EqBand[]) => [...bands].sort((a, b) => a.frequency - b.frequency || a.id - b.id);

/** The lowest band number that's free, or null when there are 24. */
export function freeBandId(bands: readonly EqBand[]): number | null {
  const used = new Set(bands.map((b) => b.id));
  for (let id = 1; id <= EQ_BANDS; id++) if (!used.has(id)) return id;
  return null;
}

/** A band with everything in range and fitting its shape (a slope it takes, no gain on a gainless shape kept dynamic). */
export function fitBand(band: EqBand): EqBand {
  const slopes = shapeSlopes(band.shape);
  const slope = slopes.includes(band.slope) ? band.slope : band.slope === "brickwall" ? 96 : slopes.includes(12) ? 12 : slopes[0];
  const next: EqBand = {
    ...band,
    frequency: clamp(band.frequency, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY),
    gain: clamp(band.gain, -EQ_MAX_GAIN, EQ_MAX_GAIN),
    q: clamp(band.q, EQ_MIN_Q, EQ_MAX_Q),
    range: canBeDynamic(band.shape) ? clamp(band.range, -EQ_MAX_GAIN, EQ_MAX_GAIN) : 0,
    threshold: band.threshold === null ? null : clamp(band.threshold, EQ_MIN_THRESHOLD, 0),
    slope,
  };
  return same(band, next);
}

/** Add a band (its number the lowest free one). Null when there's no room (24 bands). */
export function addBand(pq: ProQ, spec: Partial<Omit<EqBand, "id">>): { proQ: ProQ; id: number } | null {
  const id = freeBandId(pq.bands);
  if (id === null) return null;
  const band = fitBand({ ...DEFAULT_BAND, ...spec, id });
  return { proQ: { ...pq, bands: [...pq.bands, band] }, id };
}

/** Change the bands in `ids` (`change` returning the same band: unchanged). Each is kept in range. */
export function editBands(pq: ProQ, ids: Iterable<number>, change: (band: EqBand) => EqBand): ProQ {
  const set = new Set(ids);
  let changed = false;
  const bands = pq.bands.map((b) => {
    if (!set.has(b.id)) return b;
    const next = change(b);
    if (next === b) return b;
    const fitted = fitBand(next);
    if (sameBand(fitted, b)) return b;
    changed = true;
    return fitted;
  });
  return changed ? { ...pq, bands } : pq;
}

const sameBand = (a: EqBand, b: EqBand) => (Object.keys(a) as (keyof EqBand)[]).every((k) => a[k] === b[k]);

export type BandPatch = Partial<Omit<EqBand, "id">>;
export const updateBands = (pq: ProQ, ids: Iterable<number>, patch: BandPatch) => editBands(pq, ids, (b) => ({ ...b, ...patch }));

export function removeBands(pq: ProQ, ids: Iterable<number>): ProQ {
  const set = new Set(ids);
  const bands = pq.bands.filter((b) => !set.has(b.id));
  return bands.length === pq.bands.length ? pq : { ...pq, bands };
}

/**
 * A drag of several bands (from `base`, the bands as the drag began): `grabbed` goes to `frequency` and
 * `gain`, the others' frequencies move by the same ratio and their gains are scaled by the grabbed
 * band's (Pro-Q's: "scaled relative to each other"; from a flat grabbed band, they move by as much).
 * Null leaves that axis alone (Alt constrains a drag to one).
 */
export function dragBands(base: readonly EqBand[], ids: ReadonlySet<number>, grabbed: number, frequency: number | null, gain: number | null): EqBand[] {
  const from = base.find((b) => b.id === grabbed);
  if (!from) return [...base];
  const ratio = frequency === null ? 1 : clamp(frequency, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY) / from.frequency;
  const scaled = gain !== null && Math.abs(from.gain) >= 0.25;
  const factor = scaled ? gain! / from.gain : 1;
  const offset = gain !== null && !scaled ? gain - from.gain : 0;
  return base.map((b) => {
    if (!ids.has(b.id)) return b;
    const next = { ...b, frequency: clamp(b.frequency * ratio, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY) };
    if (gain !== null && hasGain(b.shape)) next.gain = clamp(b.id === grabbed ? gain : scaled ? b.gain * factor : b.gain + offset, -EQ_MAX_GAIN, EQ_MAX_GAIN);
    return fitBand(next);
  });
}

/** Q times `factor` on each band in `ids` (the wheel; a gainless band's vertical drag). */
export const scaleQ = (pq: ProQ, ids: Iterable<number>, factor: number) => editBands(pq, ids, (b) => ({ ...b, q: clamp(b.q * factor, EQ_MIN_Q, EQ_MAX_Q) }));

/** Invert Gain: gain and dynamic range flipped. */
export const invertGain = (pq: ProQ, ids: Iterable<number>) => editBands(pq, ids, (b) => ({ ...b, gain: b.gain === 0 ? 0 : -b.gain, range: b.range === 0 ? 0 : -b.range }));

/** Make Dynamic: a range (cutting what's loud, as Pro-Q starts one), Auto threshold. Only where a shape can be. */
export const makeDynamic = (pq: ProQ, ids: Iterable<number>, range = -6) =>
  editBands(pq, ids, (b) => (canBeDynamic(b.shape) && b.range === 0 ? { ...b, range, dynamics: true, threshold: null } : b));

/** Clear dynamics: back to static bands. */
export const clearDynamics = (pq: ProQ, ids: Iterable<number>) => editBands(pq, ids, (b) => (b.range === 0 ? b : { ...b, range: 0 }));

/** A shape for bands, each keeping a slope it takes. */
export const setShape = (pq: ProQ, ids: Iterable<number>, shape: EqShape) => editBands(pq, ids, (b) => (b.shape === shape ? b : { ...b, shape }));

/** The next shape in Pro-Q's list (Cmd+Alt-click), round to the first. */
export const nextShape = (shape: EqShape): EqShape => EQ_SHAPES[(EQ_SHAPES.indexOf(shape) + 1) % EQ_SHAPES.length];
/** The next slope its shape takes (Alt+Shift-click), round to the first. */
export function nextSlope(band: Pick<EqBand, "shape" | "slope">): EqSlope {
  const slopes = shapeSlopes(band.shape);
  return slopes[(slopes.indexOf(band.slope) + 1) % slopes.length];
}

/**
 * Split: each band becomes two, one on the left and one on the right (or, from a Mid or Side band, one
 * on the mid and one on the side). Null if there isn't room for the copies.
 */
export function splitBands(pq: ProQ, ids: Iterable<number>): { proQ: ProQ; ids: number[] } | null {
  let bands = [...pq.bands];
  const made: number[] = [];
  for (const id of ids) {
    const band = bands.find((b) => b.id === id);
    if (!band) continue;
    const ms = band.placement === "mid" || band.placement === "side";
    const [first, second]: EqPlacement[] = ms ? ["mid", "side"] : ["left", "right"];
    const copy = freeBandId(bands);
    if (copy === null) return null;
    bands = bands.map((b) => (b.id === id ? { ...b, placement: first } : b));
    bands.push({ ...band, id: copy, placement: second });
    made.push(id, copy);
  }
  return made.length ? { proQ: { ...pq, bands }, ids: made } : null;
}

// ---------------------------------------------------------------------------
// A/B and presets
// ---------------------------------------------------------------------------

/** What A/B swaps, taken from settings. */
export function proQState(pq: ProQState): ProQState {
  const { bands, mode, resolution, gainScale, output, pan, panMode, invert, autoGain, gainQ } = pq;
  return { bands, mode, resolution, gainScale, output, pan, panMode, invert, autoGain, gainQ };
}

/** A/B: the current state is kept, the other one comes back (a new one starts as a copy of this). */
export function switchAB(pq: ProQ): ProQ {
  const current = proQState(pq);
  const other = pq.other ?? current;
  return { ...pq, ...other, ab: pq.ab === "a" ? "b" : "a", other: current };
}

/** Copy: the active state over the other one. */
export const copyAB = (pq: ProQ): ProQ => ({ ...pq, other: proQState(pq) });

/** A preset's state over this one (the analyzer and display stay as they are, as Pro-Q's do). */
export const applyPreset = (pq: ProQ, preset: ProQPreset): ProQ => ({ ...pq, ...DEFAULT_PRO_Q_STATE, ...preset.state, bands: (preset.state.bands ?? []).map(fitBand) });

// ---------------------------------------------------------------------------
// Saying it
// ---------------------------------------------------------------------------

export const SHAPE_NAMES: Record<EqShape, string> = {
  bell: "Bell",
  lowShelf: "Low Shelf",
  lowCut: "Low Cut",
  highShelf: "High Shelf",
  highCut: "High Cut",
  notch: "Notch",
  bandPass: "Band Pass",
  tiltShelf: "Tilt Shelf",
  flatTilt: "Flat Tilt",
};
export const PLACEMENT_NAMES: Record<EqPlacement, string> = { stereo: "Stereo", left: "Left", right: "Right", mid: "Mid", side: "Side" };
export const MODE_NAMES = { zeroLatency: "Zero Latency", naturalPhase: "Natural Phase", linearPhase: "Linear Phase" } as const;
export const RESOLUTION_NAMES = { low: "Low", medium: "Medium", high: "High", veryHigh: "Very High", maximum: "Maximum" } as const;

export const slopeText = (slope: EqSlope) => (slope === "brickwall" ? "Brickwall" : `${slope} dB/oct`);
/** "542.53 Hz", "1.20 kHz": as Pro-Q shows a frequency. */
export const frequencyText = (hz: number) => (hz >= 10_000 ? `${(hz / 1000).toFixed(1)} kHz` : hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(hz >= 100 ? 1 : 2)} Hz`);
/** "+9.14 dB". */
export const gainText = (db: number) => `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(2)} dB`;
export const qText = (q: number) => q.toFixed(q < 1 ? 3 : q < 10 ? 2 : 1);

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** A frequency as a note and cents ("A4", "G3 +35"): A4 is 440 Hz, C4 middle C. */
export function noteText(hz: number): string {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const nearest = Math.round(midi);
  const cents = Math.round((midi - nearest) * 100);
  const name = `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`;
  return cents === 0 ? name : `${name} ${cents > 0 ? "+" : "−"}${Math.abs(cents)}`;
}
/** The note nearest a frequency, as a frequency (the piano display's quantise). */
export const nearestNote = (hz: number) => 440 * 2 ** (Math.round(12 * Math.log2(hz / 440)) / 12);

/**
 * A frequency or level typed as Pro-Q takes them: "1k" or "2.5k" (kHz), "440", a note ("A4", "C#3+13"),
 * "2x" (times louder, in dB). Null if it isn't one.
 */
export function parseTyped(text: string, kind: "frequency" | "gain" | "q"): number | null {
  const t = text.trim().replace(",", ".").replace(/\s+/g, "");
  if (kind === "frequency") {
    const note = /^([A-Ga-g])(#|b)?(-?\d)([+-]\d+)?$/.exec(t);
    if (note) {
      const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[note[1].toLowerCase() as "c"];
      const midi = (Number(note[3]) + 1) * 12 + base + (note[2] === "#" ? 1 : note[2] === "b" ? -1 : 0) + Number(note[4] ?? 0) / 100;
      return 440 * 2 ** ((midi - 69) / 12);
    }
    const k = /^(-?[\d.]+)k(hz)?$/i.exec(t);
    if (k) return Number(k[1]) * 1000;
    const hz = /^(-?[\d.]+)(hz)?$/i.exec(t);
    return hz && Number.isFinite(Number(hz[1])) ? Number(hz[1]) : null;
  }
  if (kind === "gain") {
    const times = /^([\d.]+)x$/i.exec(t);
    if (times && Number(times[1]) > 0) return 20 * Math.log10(Number(times[1]));
    const db = /^([+-]?[\d.]+)(db)?$/i.exec(t);
    return db && Number.isFinite(Number(db[1])) ? Number(db[1]) : null;
  }
  const q = Number(t);
  return Number.isFinite(q) ? q : null;
}

// ---------------------------------------------------------------------------
// For the engine
// ---------------------------------------------------------------------------

/** A band as the engine plays it (`engine/src/ProQ.h`'s `Band`): its gain and range scaled, Brickwall a slope of 0. */
export interface EngineEqBand {
  id: number;
  shape: EqShape;
  frequency: number;
  gain: number;
  /** As set: Gain-Q interaction narrows it in the engine, from the gain it's at (dynamics included). */
  q: number;
  slope: number;
  placement: EqPlacement;
  /** dB its gain moves at most when its range is loud (0: static, or its dynamics bypassed). */
  range: number;
  /** dB, or null for Auto. */
  threshold: number | null;
}

/** A Pro-Q's settings for the engine (`EngineEffect.eq`). */
export interface EngineEq {
  bands: EngineEqBand[];
  mode: ProQ["mode"];
  resolution: number;
  gainQ: boolean;
  /** The output level in dB (Auto Gain's correction in it), its pan, which pair the pan balances, the phase. */
  output: number;
  pan: number;
  panMode: ProQ["panMode"];
  invert: boolean;
}

/** What the engine plays for a Pro-Q: its enabled bands as heard (Gain Scale applied), and the output with Auto Gain. */
export function engineProQ(pq: ProQ): EngineEq {
  const bands = pq.bands
    .filter((b) => b.enabled)
    .map((b): EngineEqBand => {
      const scaled = hasGain(b.shape) ? pq.gainScale : 1;
      return {
        id: b.id,
        shape: b.shape,
        frequency: b.frequency,
        gain: b.gain * scaled,
        q: b.q,
        slope: b.slope === "brickwall" ? 0 : b.slope,
        placement: b.placement,
        range: canBeDynamic(b.shape) && b.dynamics ? b.range * scaled : 0,
        threshold: b.threshold,
      };
    });
  return {
    bands,
    mode: pq.mode,
    resolution: EQ_RESOLUTIONS.indexOf(pq.resolution),
    gainQ: pq.gainQ,
    output: pq.output + (pq.autoGain ? autoGain(pq) : 0),
    pan: pq.pan,
    panMode: pq.panMode,
    invert: pq.invert,
  };
}
