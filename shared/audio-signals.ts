/**
 * Signals on the timeline: what the sound of a sequence, one of its tracks or one clip is doing at a
 * timeline moment, read from its files' signals (`shared/signals/`), for pictures that react to sound
 * (expressions' `audio()`, `sinceHit()`, `beat()`...; docs/visualizer/README.md).
 *
 * A track's or the whole mix's value isn't a mixdown: it's its clips' energies summed, each read at its
 * own media time and times its Volume squared. That's exact for levels and bands of separate sounds,
 * costs nothing when clips move, and is the same in the tab and in the export, which reads the same
 * files (`SignalReader`). Values are 0..1 against each file's own loud parts (auto-gain: the 95th
 * percentile of a level reads 1), so a quiet song reacts as much as a loud one; Volume still counts.
 */
import { ExpressionError, type SignalScope } from "./expressions.ts";
import { TIME_REMAP, VOLUME, findEffect, hasLinks, hasMedia, isRemapped, provideLinks, provideSignalScopes, volumeAt } from "./effects.ts";
import { BEAT_SIGNALS, DEFAULT_HIT, findSignal, follow, hitLevel, hitSpan, isHitSignal, shapeValue } from "./links.ts";
import { BAND_COUNT, DB_SCALARS, type Hit, ONSET_SCALARS, type OnsetName, SIGNAL_RATE, type ScalarName, type SignalData, byteDb } from "./signals/format.ts";
import { bandEnergyAt, bandReferenceEnergy, dbPower, powerDb, scalarAt, scalarMax } from "./signals/sample.ts";
import { isNestedClip, sequenceView } from "./sequences.ts";
import { mediaTime } from "./time-remap.ts";
import { clipDuration, clipEnd, clipSpeed, sourceTime, timelineTime, trackClips } from "./timeline.ts";
import type { Clip, HitShape, MusicSection, ParamLink, Project, SignalDef, SignalRef, SignalSource, Track } from "./types.ts";

export type { SignalSource };

/** Loaded signals by media id. */
export type SignalStore = ReadonlyMap<string, SignalData>;

/** Where signals are read from: a video (the document, with its nested sequences) and its files' signals. */
export interface SignalReader {
  readonly document: Project;
  readonly store: SignalStore;
}

export const MASTER: SignalSource = { kind: "master" };

/** The signals every sound has, by the name expressions and the assistant use. */
export const BUILT_IN_SIGNALS: { name: ScalarName; description: string }[] = [
  { name: "level", description: "how loud, 0..1 (1: as loud as its loud parts)" },
  { name: "peak", description: "its largest samples, 0..1" },
  { name: "sub", description: "20–60 Hz, 0..1" },
  { name: "bass", description: "60–250 Hz (kicks, bass), 0..1" },
  { name: "lowMid", description: "250–500 Hz, 0..1" },
  { name: "mid", description: "500 Hz–2 kHz (voices, most instruments), 0..1" },
  { name: "upperMid", description: "2–4 kHz, 0..1" },
  { name: "presence", description: "4–6 kHz, 0..1" },
  { name: "air", description: "6–20 kHz (cymbals, breath), 0..1" },
  { name: "onset", description: "how sharply the sound starts: an impulse at each hit, 0..1" },
  { name: "onsetLow", description: "hits below 150 Hz (kicks), 0..1" },
  { name: "onsetMid", description: "hits between 150 Hz and 4 kHz (snares, notes), 0..1" },
  { name: "onsetHigh", description: "hits above 4 kHz (hats), 0..1" },
  { name: "width", description: "stereo width: 0 mono, 0.5 wide, 1 out of phase" },
  { name: "balance", description: "left (-1) to right (1)" },
  { name: "brightness", description: "where its energy is: 0 dull (100 Hz) to 1 bright (10 kHz)" },
];
const NAMES = new Set<string>(BUILT_IN_SIGNALS.map((s) => s.name));
export const isSignalName = (name: string): name is ScalarName => NAMES.has(name);
export const isOnsetName = (name: string): name is OnsetName => (ONSET_SCALARS as readonly string[]).includes(name);

/** dB under its loud parts at which a level reads 0. */
export const AUTO_RANGE_DB = 24;
/** What "never" is in seconds (since a hit, before the first): long enough that any envelope has ended. */
export const NEVER = 10_000;
const DB_NAMES = new Set<string>(DB_SCALARS);

// ---------------------------------------------------------------------------
// Which reader: the open video's in the tab, the export's on the server
// ---------------------------------------------------------------------------

let fallback: SignalReader | null = null;
let scoped: SignalReader | null = null;

/** The reader used when no `withSignals` says otherwise (the tab sets the open video's). */
export function setSignalReader(reader: SignalReader | null): void {
  fallback = reader;
}

/** Work out values with signals read from `reader` (an export, a video drawn in the background). */
export function withSignals<T>(reader: SignalReader | null, work: () => T): T {
  const before = scoped;
  scoped = reader;
  try {
    return work();
  } finally {
    scoped = before;
  }
}

export const currentSignalReader = () => scoped ?? fallback;

// ---------------------------------------------------------------------------
// Where clips are, and what sounds at a moment
// ---------------------------------------------------------------------------

const clipIndexes = new WeakMap<Project, Map<string, { sequenceId: string | null; clip: Clip }>>();

/** The clip with this id in any of the video's sequences, and which sequence it's in. */
export function findClip(document: Project, clipId: string): { sequenceId: string | null; clip: Clip } | undefined {
  let index = clipIndexes.get(document);
  if (!index) {
    index = new Map();
    for (const clip of document.clips) index.set(clip.id, { sequenceId: null, clip });
    for (const seq of document.sequences ?? []) for (const clip of seq.clips) index.set(clip.id, { sequenceId: seq.id, clip });
    clipIndexes.set(document, index);
  }
  return index.get(clipId);
}

/** A sound playing at a moment: whose signals, where in the file, how loud (amplitude). */
interface Sounding {
  data: SignalData;
  time: number;
  gain: number;
  clip: Clip;
}

/** The clip of `clips` (sorted by start) playing at `t`, if any. */
function clipAt(clips: readonly Clip[], t: number): Clip | undefined {
  let lo = 0;
  let hi = clips.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clips[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const clip = found >= 0 ? clips[found] : undefined;
  return clip && t < clipEnd(clip) ? clip : undefined;
}

/** Tracks a source hears: the unmuted ones for the mix, the one named, or the clip's. */
function tracksOf(view: Project, source: SignalSource): Track[] {
  if (source.kind === "master") return view.tracks.filter((t) => !t.muted);
  if (source.kind === "track") return view.tracks.filter((t) => t.id === source.trackId);
  return view.tracks;
}

/** What sounds in `view` at timeline time `t` for `source` (into `out`), each at `gain` times its own. */
function soundsAt(reader: SignalReader, view: Project, source: SignalSource, t: number, gain: number, out: Sounding[], depth = 0): void {
  if (depth > 8) return;
  for (const track of tracksOf(view, source)) {
    const clip = source.kind === "clip" ? undefined : clipAt(trackClips(view, track.id), t);
    const clips = source.kind === "clip" ? trackClips(view, track.id).filter((c) => c.id === source.clipId && c.start <= t && t < clipEnd(c)) : clip ? [clip] : [];
    for (const c of clips) {
      if (!hasMedia(c)) continue;
      const s = sourceTime(c, t);
      const g = gain * volumeAt(c, s);
      if (isNestedClip(c)) {
        const inner = sequenceView(reader.document, c.assetId);
        if (inner !== reader.document) soundsAt(reader, inner, MASTER, mediaTime(c, s), g, out, depth + 1);
        continue;
      }
      const data = reader.store.get(c.assetId);
      if (data) out.push({ data, time: mediaTime(c, s), gain: g, clip: c });
    }
  }
}

/** The view of a sequence (null: the main one). */
const viewOf = (reader: SignalReader, sequenceId: string | null) => sequenceView(reader.document, sequenceId);

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A dB energy against a reference energy, as 0..1 (`AUTO_RANGE_DB` under it is 0). */
const fromDb = (energy: number, reference: number) =>
  energy > 0 && reference > 0 ? Math.min(1, Math.max(0, 1 + (powerDb(energy) - powerDb(reference)) / AUTO_RANGE_DB)) : 0;

/**
 * A built-in signal of `source` at timeline time `t` of a sequence, 0..1 (balance -1..1). `frame` is
 * how long a frame lasts: an onset is its strongest since the frame before, so none falls between frames.
 */
export function signalValue(reader: SignalReader, sequenceId: string | null, source: SignalSource, name: ScalarName, t: number, frame = 0): number {
  const sounds: Sounding[] = [];
  soundsAt(reader, viewOf(reader, sequenceId), source, t, 1, sounds);
  if (!sounds.length) return 0;
  if (DB_NAMES.has(name)) {
    let energy = 0;
    let reference = 0;
    for (const s of sounds) {
      energy += s.gain * s.gain * dbPower(scalarAt(s.data, name, s.time));
      reference += dbPower(s.data.header.reference[name] ?? 0);
    }
    return fromDb(energy, reference);
  }
  if (isOnsetName(name)) {
    let flux = 0;
    let reference = 0;
    for (const s of sounds) {
      const from = frame > 0 ? mediaTime(s.clip, sourceTime(s.clip, t - frame)) : s.time;
      flux += s.gain * scalarMax(s.data, name, Math.min(from, s.time), Math.max(from, s.time));
      reference += s.data.header.reference[name] ?? 1;
    }
    return reference > 0 ? Math.min(1, flux / reference) : 0;
  }
  // Width, balance and brightness: each sound's, weighted by its energy.
  let weight = 0;
  let sum = 0;
  for (const s of sounds) {
    const w = s.gain * s.gain * dbPower(scalarAt(s.data, "level", s.time));
    let v = scalarAt(s.data, name, s.time);
    if (name === "brightness") v = v > 0 ? Math.min(1, Math.max(0, Math.log(v / 100) / Math.log(100))) : 0;
    weight += w;
    sum += w * v;
  }
  return weight > 0 ? sum / weight : 0;
}

/** dB under full scale at which an absolute level (a band signal without auto-gain) reads 0. */
export const ABSOLUTE_RANGE_DB = 60;

/**
 * The energy between two frequencies of `source` at `t`, 0..1: against the files' own loud parts
 * there (auto-gain), or with `absolute` against full scale (`ABSOLUTE_RANGE_DB` under it is 0).
 * `gainDb` is added first.
 */
export function bandValue(reader: SignalReader, sequenceId: string | null, source: SignalSource, low: number, high: number, t: number, absolute = false, gainDb = 0): number {
  const sounds: Sounding[] = [];
  soundsAt(reader, viewOf(reader, sequenceId), source, t, 1, sounds);
  let energy = 0;
  let reference = 0;
  for (const s of sounds) {
    energy += s.gain * s.gain * bandEnergyAt(s.data, low, high, s.time);
    reference += bandReferenceEnergy(s.data, low, high);
  }
  if (gainDb) energy *= 10 ** (gainDb / 10);
  if (!absolute) return fromDb(energy, reference);
  return energy > 0 ? Math.min(1, Math.max(0, 1 + powerDb(energy) / ABSOLUTE_RANGE_DB)) : 0;
}

/**
 * What `source` sounds like at `t`: each of the 96 bands' level in dB (a full-scale sine is 0), the sounds'
 * energies summed, and the bands' edges in Hz. Null where nothing is loaded that sounds.
 */
export function spectrumAt(reader: SignalReader, sequenceId: string | null, source: SignalSource, t: number): { edges: number[]; db: Float32Array } | null {
  const where = heard(reader, sequenceId, source, t);
  const sounds: Sounding[] = [];
  soundsAt(reader, viewOf(reader, where.sequenceId), source, where.t, 1, sounds);
  if (!sounds.length) return null;
  const energy = new Float64Array(BAND_COUNT);
  for (const s of sounds) {
    const frame = Math.round(s.time * s.data.header.rate);
    if (frame < 0 || frame >= s.data.header.frames) continue;
    for (let b = 0; b < BAND_COUNT; b++) energy[b] += s.gain * s.gain * dbPower(byteDb(s.data.bands[frame * BAND_COUNT + b]));
  }
  const db = new Float32Array(BAND_COUNT);
  for (let b = 0; b < BAND_COUNT; b++) db[b] = powerDb(energy[b]);
  return { edges: sounds[0].data.header.bandEdges, db };
}

// ---------------------------------------------------------------------------
// Hits and the beat
// ---------------------------------------------------------------------------

/** Hits closer than this on the timeline (from two clips at once) are one. */
const SAME_HIT = 0.03;

const hitCache = new WeakMap<SignalStore, WeakMap<readonly Clip[], WeakMap<readonly Track[], Map<string, Hit[]>>>>();

function cached<T>(reader: SignalReader, view: Project, key: string, make: () => T): T {
  let byClips = hitCache.get(reader.store);
  if (!byClips) hitCache.set(reader.store, (byClips = new WeakMap()));
  let byTracks = byClips.get(view.clips);
  if (!byTracks) byClips.set(view.clips, (byTracks = new WeakMap()));
  let map = byTracks.get(view.tracks);
  if (!map) byTracks.set(view.tracks, (map = new Map()));
  if (!map.has(key)) map.set(key, make() as Hit[]);
  return map.get(key) as T;
}

/** A clip's hits on the timeline: its file's, inside what it plays, at its Volume. Remapped clips have none (yet). */
function clipHits(reader: SignalReader, clip: Clip, name: OnsetName, depth: number): Hit[] {
  if (!hasMedia(clip) || isRemapped(clip)) return [];
  const inner = isNestedClip(clip) ? sequenceView(reader.document, clip.assetId) : null;
  const hits = inner
    ? inner === reader.document || depth > 8 ? [] : viewHits(reader, inner, MASTER, name, depth + 1)
    : reader.store.get(clip.assetId)?.header.hits[name] ?? [];
  const out: Hit[] = [];
  for (const [time, velocity] of hits) {
    if (time < clip.in || time >= clip.out) continue;
    out.push([timelineTime(clip, time), velocity * volumeAt(clip, time)]);
  }
  return out;
}

function viewHits(reader: SignalReader, view: Project, source: SignalSource, name: OnsetName, depth = 0): Hit[] {
  const key = `${source.kind === "master" ? "" : source.kind === "track" ? source.trackId : source.clipId}/${name}`;
  return cached(reader, view, key, () => {
    const all: Hit[] = [];
    for (const track of tracksOf(view, source)) {
      for (const clip of trackClips(view, track.id)) {
        if (source.kind === "clip" && clip.id !== source.clipId) continue;
        all.push(...clipHits(reader, clip, name, depth));
      }
    }
    all.sort((a, b) => a[0] - b[0]);
    const merged: Hit[] = [];
    for (const hit of all) {
      const last = merged.at(-1);
      if (last && hit[0] - last[0] < SAME_HIT) last[1] = Math.max(last[1], hit[1]);
      else merged.push([...hit]);
    }
    return merged;
  });
}

/** Every hit of `source` in a sequence, on its timeline, in order. */
export const sourceHits = (reader: SignalReader, sequenceId: string | null, source: SignalSource, name: OnsetName) =>
  viewHits(reader, viewOf(reader, sequenceId), source, name);

/** The index of the last of `count` sorted times (`timeOf(i)`) at or before `t`, or -1. */
function lastAt(count: number, timeOf: (i: number) => number, t: number): number {
  let lo = 0;
  let hi = count - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeOf(mid) <= t + 1e-9) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The last hit at or before `t` (its index in `hits`, or -1). */
export const lastHit = (hits: readonly Hit[], t: number) => lastAt(hits.length, (i) => hits[i][0], t);

/** A song's beat on the timeline. */
export interface BeatGrid {
  /** The clip it's the beat of. */
  clipId: string;
  bpm: number;
  beats: number[];
  downbeats: number[];
  sections: MusicSection[];
  drops: number[];
}

const gridCache = new WeakMap<SignalStore, WeakMap<Clip, BeatGrid | null>>();

/** A clip's beat, on the timeline (null when its file has none). */
function clipGrid(reader: SignalReader, clip: Clip): BeatGrid | null {
  let byClip = gridCache.get(reader.store);
  if (!byClip) gridCache.set(reader.store, (byClip = new WeakMap()));
  if (byClip.has(clip)) return byClip.get(clip)!;
  const rhythm = isRemapped(clip) || isNestedClip(clip) ? null : reader.store.get(clip.assetId)?.header.rhythm;
  let grid: BeatGrid | null = null;
  if (rhythm?.bpm) {
    const inside = (t: number) => t >= clip.in && t < clip.out;
    const place = (times: number[]) => times.filter(inside).map((t) => timelineTime(clip, t)).sort((a, b) => a - b);
    grid = {
      clipId: clip.id,
      bpm: rhythm.bpm * clipSpeed(clip),
      beats: place(rhythm.beats),
      downbeats: place(rhythm.downbeats),
      sections: rhythm.sections
        .filter((s) => s.end > clip.in && s.start < clip.out)
        .map((s) => {
          const [a, b] = [timelineTime(clip, Math.max(clip.in, s.start)), timelineTime(clip, Math.min(clip.out, s.end))];
          return { ...s, start: Math.min(a, b), end: Math.max(a, b) };
        })
        .sort((a, b) => a.start - b.start),
      drops: place(rhythm.drops.map((d) => d.time)),
    };
  }
  byClip.set(clip, grid);
  return grid;
}

/**
 * The beat at `t` in a sequence: the beat of the song playing then (the longest clip heard at `t`
 * whose file has a steady beat), or null.
 */
export function beatGridAt(reader: SignalReader, sequenceId: string | null, t: number): BeatGrid | null {
  const view = viewOf(reader, sequenceId);
  let best: { grid: BeatGrid; length: number } | null = null;
  for (const track of tracksOf(view, MASTER)) {
    const clip = clipAt(trackClips(view, track.id), t);
    if (!clip || !hasMedia(clip)) continue;
    const grid = clipGrid(reader, clip);
    if (grid && (!best || clipDuration(clip) > best.length)) best = { grid, length: clipDuration(clip) };
  }
  return best?.grid ?? null;
}

/** Where `t` is among `times`: the index of the last at or before it plus how far to the next (beats count up from 0). */
export function countAt(times: readonly number[], t: number): number {
  if (!times.length) return 0;
  const i = lastAt(times.length, (k) => times[k], t);
  if (i < 0) return (t - times[0]) / (times.length > 1 ? times[1] - times[0] : 1);
  const next = times[i + 1];
  const period = next !== undefined ? next - times[i] : times.length > 1 ? times[i] - times[i - 1] : 1;
  return i + (t - times[i]) / (period > 0 ? period : 1);
}

/** What a sequence's beat is at `t`, for expressions. */
export function beatAt(reader: SignalReader, sequenceId: string | null, t: number) {
  const grid = beatGridAt(reader, sequenceId, t);
  if (!grid || !grid.beats.length) return { beat: 0, bar: 0, since: NEVER, bpm: 0, section: 0, sinceDrop: NEVER };
  const beat = lastAt(grid.beats.length, (i) => grid.beats[i], t);
  const drop = lastAt(grid.drops.length, (i) => grid.drops[i], t);
  const section = lastAt(grid.sections.length, (i) => grid.sections[i].start, t);
  return {
    beat: countAt(grid.beats, t),
    bar: grid.downbeats.length ? countAt(grid.downbeats, t) : countAt(grid.beats, t) / 4,
    since: beat < 0 ? NEVER : t - grid.beats[beat],
    bpm: grid.bpm,
    section: Math.max(0, section),
    sinceDrop: drop < 0 ? NEVER : t - grid.drops[drop],
  };
}

// ---------------------------------------------------------------------------
// Hearing: a nested sequence hears the mix of the sequence it's placed in
// ---------------------------------------------------------------------------

/**
 * What "the mix" is for clips of sequence `from`: the mix of `sequenceId` (the outermost sequence
 * drawn), at `at(t)` when `from`'s time is `t`. So a look made in a nest reacts to the song of the
 * video it's placed in, wherever it's placed (docs/visualizer/README.md). Tracks, clips and "self"
 * are still the nest's own.
 */
export interface Hearing {
  from: string | null;
  sequenceId: string | null;
  at(t: number): number;
}

const ownHearing = (id: string | null): Hearing => ({ from: id, sequenceId: id, at: (t) => t });

/** Inside `clip`, a nested clip of a sequence heard as `outer`. */
const insideOf = (outer: Hearing, clip: Clip): Hearing => ({ from: clip.assetId, sequenceId: outer.sequenceId, at: (t) => outer.at(timelineTime(clip, t)) });

/** The hearing of the nest being drawn now (the preview's and the export's levels say: `withHearing`). */
let drawing: Hearing | null = null;

/** Work out values with nested clips hearing as `hearing` says (null: as nothing is drawing). */
export function withHearing<T>(hearing: Hearing | null, work: () => T): T {
  const before = drawing;
  drawing = hearing;
  try {
    return work();
  } finally {
    drawing = before;
  }
}

const usedHearings = new WeakMap<Project, Map<string | null, Hearing>>();

/** How sequence `id` hears when nothing is drawing it: where it's first used (in the main sequence first), else itself. */
function defaultHearing(document: Project, id: string | null, depth = 0): Hearing {
  if (id === null || depth > 8) return ownHearing(id);
  let map = usedHearings.get(document);
  if (!map) usedHearings.set(document, (map = new Map()));
  const known = map.get(id);
  if (known) return known;
  let hearing = ownHearing(id);
  const main = document.clips.find((c) => c.assetId === id);
  if (main) hearing = insideOf(ownHearing(null), main);
  else {
    for (const seq of document.sequences ?? []) {
      const use = seq.id !== id && seq.clips.find((c) => c.assetId === id);
      if (use) {
        hearing = insideOf(defaultHearing(document, seq.id, depth + 1), use);
        break;
      }
    }
  }
  map.set(id, hearing);
  return hearing;
}

/** How clips of sequence `sequenceId` hear the mix. */
export function hearingFor(reader: SignalReader, sequenceId: string | null): Hearing {
  return drawing && drawing.from === sequenceId ? drawing : defaultHearing(reader.document, sequenceId);
}

/** The hearing inside nested clip `clip`, drawn where `outer` is heard (null: where nothing says). */
export function nestedHearing(clip: Clip, outer: Hearing | null): Hearing | null {
  const reader = currentSignalReader();
  const found = reader && findClip(reader.document, clip.id);
  if (!reader || !found) return null;
  return insideOf(outer && outer.from === found.sequenceId ? outer : defaultHearing(reader.document, found.sequenceId), clip);
}

/** Where a source of sequence `sequenceId` is read at its time `t`: the mix where it's heard, anything else where it is. */
function heard(reader: SignalReader, sequenceId: string | null, source: SignalSource, t: number): { sequenceId: string | null; t: number } {
  if (source.kind !== "master") return { sequenceId, t };
  const h = hearingFor(reader, sequenceId);
  return { sequenceId: h.sequenceId, t: h.at(t) };
}

const trackSequences = new WeakMap<Project, Map<string, string | null>>();

/** The sequence a track is in (null: the main one), or undefined when there's no such track. */
function trackSequence(document: Project, trackId: string): string | null | undefined {
  let map = trackSequences.get(document);
  if (!map) {
    map = new Map();
    for (const t of document.tracks) map.set(t.id, null);
    for (const seq of document.sequences ?? []) for (const t of seq.tracks) map.set(t.id, seq.id);
    trackSequences.set(document, map);
  }
  return map.get(trackId);
}

/**
 * Where a custom signal's source is read, from a clip of `sequenceId` at its time `t`: the mix where
 * it's heard; a track or clip in its own sequence (at the clip's time when it's the clip's sequence,
 * else where the mix is heard).
 */
function placeSource(reader: SignalReader, sequenceId: string | null, source: SignalSource, t: number): { sequenceId: string | null; t: number } {
  const h = hearingFor(reader, sequenceId);
  const home = source.kind === "master" ? h.sequenceId : source.kind === "track" ? trackSequence(reader.document, source.trackId) : findClip(reader.document, source.clipId)?.sequenceId;
  if (home === undefined) return { sequenceId, t };
  return home === sequenceId && source.kind !== "master" ? { sequenceId, t } : { sequenceId: home, t: h.at(t) };
}

// ---------------------------------------------------------------------------
// Series: signals with an attack and a release, worked out at 200 a second
// ---------------------------------------------------------------------------

const RATE = SIGNAL_RATE;
const STEP = 1 / RATE;

/**
 * A signal shaped (threshold, curve) and followed (attack, release) at `SIGNAL_RATE`, in blocks.
 * Each block starts its follower eight time constants before it (from silence at 0), so a value
 * never depends on what was read before it: scrubbing, playing and exporting agree (to within a
 * ten-thousandth of what following from the start would give).
 */
class Series {
  private readonly blocks = new Map<number, { values: Float32Array; hits: Hit[] }>();
  private readonly size: number;
  private readonly warm: number;

  constructor(
    private readonly raw: (t: number) => number,
    private readonly shape: { threshold: number; curve: number; attack: number; release: number },
    private readonly findsHits = false,
  ) {
    this.warm = Math.ceil(Math.min(60, 8 * Math.max(shape.attack, shape.release)) * RATE);
    this.size = Math.max(RATE, this.warm);
  }

  private shaped(i: number) {
    return i < 0 ? 0 : shapeValue(this.raw(i * STEP), this.shape.threshold, this.shape.curve);
  }

  private block(k: number) {
    let block = this.blocks.get(k);
    if (block) return block;
    const { attack, release } = this.shape;
    const start = k * this.size;
    const from = Math.max(0, start - this.warm);
    let v = from === 0 ? 0 : this.shaped(from);
    for (let i = from; i < start; i++) v = follow(v, this.shaped(i), attack, release, STEP);
    const values = new Float32Array(this.size);
    const hits: Hit[] = [];
    let before = this.findsHits ? this.shaped(start - 1) : 0;
    for (let j = 0; j < this.size; j++) {
      const x = this.shaped(start + j);
      v = follow(v, x, attack, release, STEP);
      values[j] = v;
      // A hit where it rises out of silence, as hard as its highest in the next 40 ms.
      if (this.findsHits && before <= 0 && x > 0) {
        let peak = x;
        for (let n = 1; n <= 8; n++) peak = Math.max(peak, this.shaped(start + j + n));
        hits.push([(start + j) * STEP, peak]);
      }
      before = x;
    }
    if (this.blocks.size > 2048) this.blocks.clear();
    this.blocks.set(k, (block = { values, hits }));
    return block;
  }

  private sample(i: number): number {
    if (i < 0) return 0;
    const k = Math.floor(i / this.size);
    return this.block(k).values[i - k * this.size];
  }

  /** Its value at `t` (between two samples, the line between them). */
  at(t: number): number {
    if (!(t >= 0)) return 0;
    const x = t * RATE;
    const i = Math.floor(x);
    const a = this.sample(i);
    return a + (this.sample(i + 1) - a) * (x - i);
  }

  /** Its hits between two times, in order. */
  hits(from: number, to: number): Hit[] {
    if (!(to >= 0)) return [];
    const out: Hit[] = [];
    const first = Math.floor(Math.max(0, from) * RATE / this.size);
    const last = Math.floor(to * RATE / this.size);
    for (let k = first; k <= last; k++) for (const h of this.block(k).hits) if (h[0] >= from && h[0] <= to) out.push(h);
    return out;
  }
}

/** What changes what a video sounds like: its sounds' clips (where, which part, how loud) and its tracks' mutes. */
const soundPrints = new WeakMap<Project, string>();
function soundPrint(document: Project): string {
  let print = soundPrints.get(document);
  if (print !== undefined) return print;
  const parts: string[] = [];
  for (const view of [document, ...(document.sequences ?? [])]) {
    parts.push("id" in view ? String(view.id) : "", view.tracks.map((t) => `${t.id}${t.muted ? "-" : "+"}`).join(","));
    for (const c of view.clips) {
      if (!hasMedia(c)) continue;
      parts.push(JSON.stringify([c.id, c.trackId, c.assetId, c.start, c.in, c.out, c.speed, c.reversed, findEffect(c, VOLUME.type), findEffect(c, TIME_REMAP.type)]));
    }
  }
  soundPrints.set(document, (print = parts.join("|")));
  return print;
}

const seriesCache = new WeakMap<SignalStore, { print: string; map: Map<string, Series> }[]>();

/** The series under `key` for this video's sound (made by `make` the first time). */
function seriesFor(reader: SignalReader, key: string, make: () => Series): Series {
  const print = soundPrint(reader.document);
  let list = seriesCache.get(reader.store);
  if (!list) seriesCache.set(reader.store, (list = []));
  let entry = list.find((e) => e.print === print);
  if (!entry) {
    list.unshift((entry = { print, map: new Map() }));
    list.length = Math.min(list.length, 3);
  }
  let series = entry.map.get(key);
  if (!series) {
    if (entry.map.size > 512) entry.map.clear();
    entry.map.set(key, (series = make()));
  }
  return series;
}

const sourceKey = (source: SignalSource) => (source.kind === "master" ? "master" : source.kind === "track" ? `t:${source.trackId}` : `c:${source.clipId}`);

/** A band signal's series (its own shaping, and its hits when it has them), read on sequence `sequenceId`. */
function bandSeries(reader: SignalReader, def: Extract<SignalDef, { kind: "band" }>, sequenceId: string | null): Series {
  const { source, low, high, autoGain, gain, threshold, curve, attack, release, onsets } = def;
  const key = `band|${sequenceId}|${sourceKey(source)}|${low}|${high}|${autoGain}|${gain}|${threshold}|${curve}|${attack}|${release}|${onsets}`;
  return seriesFor(reader, key, () => new Series((t) => bandValue(reader, sequenceId, source, low, high, t, !autoGain, gain), { threshold, curve, attack, release }, onsets));
}

/** A hit list's level at `t` with `shape`: the highest of the hits still sounding, each times its velocity. */
function hitsLevel(hits: readonly Hit[], t: number, shape: HitShape): number {
  const span = hitSpan(shape);
  let best = 0;
  for (let i = lastHit(hits, t); i >= 0 && hits[i][0] >= t - span; i--) best = Math.max(best, hits[i][1] * hitLevel(t - hits[i][0], shape));
  return best;
}

/** An events signal's level at `t`: each event held as long as it lasts (a note's length), else as `shape` says. */
function eventsLevel(def: Extract<SignalDef, { kind: "events" }>, t: number, shape: HitShape): number {
  const events = def.events;
  let lo = 0;
  let hi = events.length - 1;
  let i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].time <= t + 1e-9) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  let best = 0;
  const reach = hitSpan(shape) + longestEvent(def);
  for (; i >= 0 && events[i].time >= t - reach; i--) {
    const e = events[i];
    best = Math.max(best, e.velocity * hitLevel(t - e.time, { ...shape, hold: Math.max(shape.hold, e.length ?? 0) }));
  }
  return best;
}

const longest = new WeakMap<SignalDef, number>();
/** How long an events signal's longest event is held. */
function longestEvent(def: Extract<SignalDef, { kind: "events" }>): number {
  let n = longest.get(def);
  if (n === undefined) longest.set(def, (n = def.events.reduce((m, e) => Math.max(m, e.length ?? 0), 0)));
  return n;
}

/** A curve signal's value at `t` (straight lines between its points, held past its ends). */
function curveLevel(def: Extract<SignalDef, { kind: "curve" }>, t: number): number {
  const p = def.points;
  if (!p.length) return 0;
  const i = lastAt(p.length, (k) => p[k].time, t);
  if (i < 0) return p[0].value;
  if (i >= p.length - 1) return p[i].value;
  const [a, b] = [p[i], p[i + 1]];
  return b.time > a.time ? a.value + ((b.value - a.value) * (t - a.time)) / (b.time - a.time) : b.value;
}

/** The custom signal a reference names, if it's one (by id, or a built-in name that's a custom one's). */
function customOf(reader: SignalReader, ref: SignalRef): SignalDef | undefined {
  return "id" in ref ? reader.document.signals?.find((d) => d.id === ref.id) : undefined;
}

/**
 * A custom signal's value from a clip of `sequenceId` at its timeline time `t`, 0..1 (an events
 * signal's hits shaped by `shape`).
 */
export function customSignalLevel(reader: SignalReader, def: SignalDef, sequenceId: string | null, t: number, shape: HitShape = DEFAULT_HIT): number {
  if (def.kind === "band") {
    const where = placeSource(reader, sequenceId, def.source, t);
    return bandSeries(reader, def, where.sequenceId).at(where.t);
  }
  const at = hearingFor(reader, sequenceId).at(t);
  return def.kind === "events" ? eventsLevel(def, at, shape) : curveLevel(def, at);
}

/** A custom signal's hits (events, or a band's onsets) around a clip's time `t`, on the timeline they're on, and where `t` is there. */
function customHits(reader: SignalReader, def: SignalDef, sequenceId: string | null, t: number, span: number): { hits: Hit[]; t: number } | null {
  if (def.kind === "events") return { hits: hitsOfEvents(def), t: hearingFor(reader, sequenceId).at(t) };
  if (def.kind === "band" && def.onsets) {
    const where = placeSource(reader, sequenceId, def.source, t);
    return { hits: bandSeries(reader, def, where.sequenceId).hits(where.t - span, where.t), t: where.t };
  }
  return null;
}

/** A custom signal's hits between two times of the main timeline (events, or a band's onsets; none for others). */
export function customSignalHits(reader: SignalReader, def: SignalDef, from: number, to: number): Hit[] {
  if (def.kind === "events") return hitsOfEvents(def).filter(([t]) => t >= from && t <= to);
  if (def.kind !== "band" || !def.onsets) return [];
  const where = placeSource(reader, null, def.source, 0);
  return bandSeries(reader, def, where.sequenceId).hits(from, to);
}

const eventHits = new WeakMap<SignalDef, Hit[]>();
/** An events signal's hits as `Hit`s (kept per signal). */
function hitsOfEvents(def: Extract<SignalDef, { kind: "events" }>): Hit[] {
  let hits = eventHits.get(def);
  if (!hits) eventHits.set(def, (hits = def.events.map((e) => [e.time, e.velocity] as Hit)));
  return hits;
}

/** A built-in hit signal's hits (onsets, the beat) of `source`, and where `t` is on their timeline. */
function builtInHits(reader: SignalReader, sequenceId: string | null, name: string, source: SignalSource, t: number): { hits: readonly Hit[]; t: number } {
  const where = heard(reader, sequenceId, source, t);
  if ((BEAT_SIGNALS as readonly string[]).includes(name)) {
    const grid = beatGridAt(reader, where.sequenceId, where.t);
    const times = !grid ? [] : name === "beat" ? grid.beats : grid.downbeats;
    return { hits: beatHits(times), t: where.t };
  }
  return { hits: sourceHits(reader, where.sequenceId, source, name as OnsetName), t: where.t };
}

const beatHitCache = new WeakMap<readonly number[], Hit[]>();
function beatHits(times: readonly number[]): Hit[] {
  let hits = beatHitCache.get(times);
  if (!hits) beatHitCache.set(times, (hits = times.map((time) => [time, 1] as Hit)));
  return hits;
}

/**
 * What a link's signal reads from a clip of `sequenceId` at its timeline time `t`: 0..1 after the
 * link's response (threshold, curve, attack and release, invert). Hits (onsets with a hit shape,
 * the beat, events) make the shape each time; everything else is followed at 200 a second.
 */
export function linkLevel(reader: SignalReader, sequenceId: string | null, link: Pick<ParamLink, "signal" | "response" | "hit">, t: number): number {
  const { signal: ref, response: r } = link;
  const custom = customOf(reader, ref);
  if ("id" in ref && !custom) return 0;
  let level: number;
  if (custom && (custom.kind === "events" || (custom.kind === "band" && custom.onsets && link.hit))) {
    const shape = link.hit ?? DEFAULT_HIT;
    if (custom.kind === "events") level = eventsLevel(custom, hearingFor(reader, sequenceId).at(t), shape);
    else {
      const found = customHits(reader, custom, sequenceId, t, hitSpan(shape));
      level = found ? hitsLevel(found.hits, found.t, shape) : 0;
    }
    level = shapeValue(level, r.threshold, r.curve);
  } else if (!custom && "name" in ref && isHitSignal(ref.name) && (link.hit || (BEAT_SIGNALS as readonly string[]).includes(ref.name))) {
    const { hits, t: at } = builtInHits(reader, sequenceId, ref.name, ref.source ?? MASTER, t);
    level = shapeValue(hitsLevel(hits, at, link.hit ?? DEFAULT_HIT), r.threshold, r.curve);
  } else {
    const shape = { threshold: r.threshold, curve: r.curve, attack: r.attack, release: r.release };
    const shapeKey = `${r.threshold}|${r.curve}|${r.attack}|${r.release}`;
    if (custom) {
      // On the timeline the custom signal is read on (where its source is heard).
      const home = custom.kind === "band" ? placeSource(reader, sequenceId, custom.source, t) : { sequenceId: hearingFor(reader, sequenceId).sequenceId, t: hearingFor(reader, sequenceId).at(t) };
      const key = `link|${home.sequenceId}|${custom.id}|${JSON.stringify(custom)}|${shapeKey}`;
      const own = custom.kind === "band" ? bandSeries(reader, custom, home.sequenceId) : null;
      const series = seriesFor(reader, key, () => new Series((x) => (own ? own.at(x) : custom.kind === "curve" ? curveLevel(custom, x) : 0), shape));
      level = series.at(home.t);
    } else {
      const name = (ref as { name: string }).name as ScalarName;
      const source = ("name" in ref && ref.source) || MASTER;
      const where = heard(reader, sequenceId, source, t);
      const key = `link|${where.sequenceId}|${sourceKey(source)}|${name}|${shapeKey}`;
      level = seriesFor(reader, key, () => new Series((x) => signalValue(reader, where.sequenceId, source, name, x, STEP), shape)).at(where.t);
    }
  }
  return r.invert ? 1 - level : level;
}

/** A link on a clip at its source time `time` (what `effects.ts` asks; 0 where signals can't be read). */
function readLink(clipId: string, link: ParamLink, time: number): number {
  const reader = currentSignalReader();
  const found = reader && findClip(reader.document, clipId);
  if (!reader || !found) return 0;
  return linkLevel(reader, found.sequenceId, link, timelineTime(found.clip, time));
}

provideLinks(readLink);

// ---------------------------------------------------------------------------
// Naming sources, and what an expression sees
// ---------------------------------------------------------------------------

/**
 * The source an expression or a tool names: nothing or "master" (the whole mix), "self" (the clip's own
 * sound), a track by name, id or number (1 is the first audio track), or a clip by id.
 */
export function resolveSource(view: Project, text: string | number | undefined, self?: Clip): SignalSource {
  if (text === undefined || text === "" || (typeof text === "string" && text.toLowerCase() === "master")) return MASTER;
  if (typeof text === "number") {
    const track = view.tracks.filter((t) => t.kind === "audio")[text - 1];
    if (track) return { kind: "track", trackId: track.id };
  } else {
    const lower = text.toLowerCase();
    if (lower === "self" && self) return { kind: "clip", clipId: self.id };
    const track = view.tracks.find((t) => t.id === text) ?? view.tracks.find((t) => t.name.toLowerCase() === lower);
    if (track) return { kind: "track", trackId: track.id };
    if (view.clips.some((c) => c.id === text)) return { kind: "clip", clipId: text };
  }
  const names = view.tracks.map((t) => `"${t.name}"`).join(", ");
  throw new ExpressionError(
    `There's no track or clip ${JSON.stringify(text)}: use "master", "self", a track's name (${names}), an audio track's number or a clip's id`,
  );
}

function checkName(name: string, fn: string): asserts name is ScalarName {
  if (!isSignalName(name)) throw new ExpressionError(`${fn}(): there's no signal "${name}". Signals: ${BUILT_IN_SIGNALS.map((s) => s.name).join(", ")}`);
}

/** The signals an expression on a clip sees (null when signals can't be read: no reader, or a clip it doesn't know). */
export function signalScope(clipId: string, fps: number): SignalScope | undefined {
  const reader = currentSignalReader();
  const found = reader && findClip(reader.document, clipId);
  if (!reader || !found) return undefined;
  const { sequenceId, clip } = found;
  const view = viewOf(reader, sequenceId);
  const frame = fps > 0 ? 1 / fps : 0;
  const at = (t: number) => timelineTime(clip, t);
  const custom = (name: string, fn: string) => {
    const def = findSignal(reader.document, name);
    if (def) return def;
    const names = (reader.document.signals ?? []).map((d) => `"${d.name}"`);
    throw new ExpressionError(`${fn}(): there's no signal "${name}". ${names.length ? `This video's signals: ${names.join(", ")}` : "This video has no signals of its own yet"}`);
  };
  return {
    audio(name, source, t) {
      checkName(name, "audio");
      const src = resolveSource(view, source, clip);
      const where = heard(reader, sequenceId, src, at(t));
      return signalValue(reader, where.sequenceId, src, name, where.t, frame);
    },
    band(low, high, source, t) {
      const src = resolveSource(view, source, clip);
      const where = heard(reader, sequenceId, src, at(t));
      return bandValue(reader, where.sequenceId, src, Math.min(low, high), Math.max(low, high), where.t);
    },
    hits(name, source, t) {
      let found: { hits: readonly Hit[]; t: number } | null;
      if (isOnsetName(name)) found = builtInHits(reader, sequenceId, name, resolveSource(view, source, clip), at(t));
      else {
        const def = findSignal(reader.document, name);
        if (!def) {
          const own = (reader.document.signals ?? []).filter((d) => d.kind === "events" || (d.kind === "band" && d.onsets)).map((d) => `"${d.name}"`);
          throw new ExpressionError(`There are no hits called "${name}": use ${[...ONSET_SCALARS.map((n) => `"${n}"`), ...own].join(", ")}`);
        }
        // A band's onsets are found as far back as needed to count them.
        found = customHits(reader, def, sequenceId, at(t), Infinity);
        if (!found) throw new ExpressionError(`"${def.name}" has no hits: it's a ${def.kind} signal${def.kind === "band" ? " without onsets" : ""}`);
      }
      const { hits, t: when } = found;
      const i = lastHit(hits, when);
      return i < 0 ? { since: NEVER, count: 0, velocity: 0 } : { since: when - hits[i][0], count: i + 1, velocity: hits[i][1] };
    },
    beat(t) {
      const h = hearingFor(reader, sequenceId);
      return beatAt(reader, h.sequenceId, h.at(at(t)));
    },
    signal: (name, t) => customSignalLevel(reader, custom(name, "signal"), sequenceId, at(t)),
  };
}

provideSignalScopes(signalScope);

/**
 * The moments of a kind of event in a stretch of a sequence: beats, bars, drops (each song's own along the
 * stretch) or a kind of hit of `source`.
 */
export function eventTimes(reader: SignalReader, sequenceId: string | null, source: SignalSource, kind: string, from: number, to: number): number[] {
  const inside = (t: number) => t >= from && t <= to;
  if (kind === "beats" || kind === "bars" || kind === "drops") {
    const times: number[] = [];
    const seen = new Set<string>();
    for (let t = from; t <= to; t += 1) {
      const grid = beatGridAt(reader, sequenceId, t);
      if (!grid || seen.has(grid.clipId)) continue;
      seen.add(grid.clipId);
      times.push(...(kind === "beats" ? grid.beats : kind === "bars" ? grid.downbeats : grid.drops).filter(inside));
    }
    return [...new Set(times)].sort((a, b) => a - b);
  }
  if (isOnsetName(kind)) return sourceHits(reader, sequenceId, source, kind).map(([t]) => t).filter(inside);
  throw new ExpressionError(`There are no "${kind}": use "beats", "bars", "drops" or a kind of hit: ${ONSET_SCALARS.map((n) => `"${n}"`).join(", ")}.`);
}

/** A reader of a video's signals. */
export const createSignalReader = (document: Project, store: SignalStore): SignalReader => ({ document, store });

/** Media ids whose signals a video can use: every file with sound its clips play, in any sequence. */
export function signalAssets(document: Project, hasAudio: (assetId: string) => boolean): string[] {
  const ids = new Set<string>();
  for (const clip of [...document.clips, ...(document.sequences ?? []).flatMap((s) => s.clips)]) {
    if (clip.assetId && !isNestedClip(clip) && hasAudio(clip.assetId)) ids.add(clip.assetId);
  }
  return [...ids];
}

/** The expression functions that read the sound. */
const SOUND_CALL = /\b(audio|audioAt|band|sinceHit|hitCount|hitVelocity|beat|bar|beatPhase|sinceBeat|bpm|section|sinceDrop|signal|signalAt)\s*\(/;

const uses = new WeakMap<Project, boolean>();

/** Whether anything in a video reacts to sound (so the export needs its files' signals). */
export function usesSignals(document: Project): boolean {
  let known = uses.get(document);
  if (known !== undefined) return known;
  known = false;
  search: for (const clip of [...document.clips, ...(document.sequences ?? []).flatMap((s) => s.clips)]) {
    for (const effect of clip.effects) {
      if (hasLinks(effect)) {
        known = true;
        break search;
      }
      for (const source of Object.values(effect.expressions ?? {})) {
        if (SOUND_CALL.test(source)) {
          known = true;
          break search;
        }
      }
    }
  }
  uses.set(document, known);
  return known;
}
