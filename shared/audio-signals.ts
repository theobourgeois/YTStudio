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
import { hasMedia, isRemapped, provideSignalScopes, volumeAt } from "./effects.ts";
import { DB_SCALARS, type Hit, ONSET_SCALARS, type OnsetName, type ScalarName, type SignalData } from "./signals/format.ts";
import { bandEnergyAt, bandReferenceEnergy, dbPower, powerDb, scalarAt, scalarMax } from "./signals/sample.ts";
import { isNestedClip, sequenceView } from "./sequences.ts";
import { mediaTime } from "./time-remap.ts";
import { clipDuration, clipEnd, clipSpeed, sourceTime, timelineTime, trackClips } from "./timeline.ts";
import type { Clip, MusicSection, Project, Track } from "./types.ts";

/** Loaded signals by media id. */
export type SignalStore = ReadonlyMap<string, SignalData>;

/** Where signals are read from: a video (the document, with its nested sequences) and its files' signals. */
export interface SignalReader {
  readonly document: Project;
  readonly store: SignalStore;
}

/** What a signal is read from, in a sequence. */
export type SignalSource = { kind: "master" } | { kind: "track"; trackId: string } | { kind: "clip"; clipId: string };

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

/** The energy between two frequencies of `source` at `t`, 0..1 (against the files' own loud parts there). */
export function bandValue(reader: SignalReader, sequenceId: string | null, source: SignalSource, low: number, high: number, t: number): number {
  const sounds: Sounding[] = [];
  soundsAt(reader, viewOf(reader, sequenceId), source, t, 1, sounds);
  let energy = 0;
  let reference = 0;
  for (const s of sounds) {
    energy += s.gain * s.gain * bandEnergyAt(s.data, low, high, s.time);
    reference += bandReferenceEnergy(s.data, low, high);
  }
  return fromDb(energy, reference);
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
  return {
    audio(name, source, t) {
      checkName(name, "audio");
      return signalValue(reader, sequenceId, resolveSource(view, source, clip), name, at(t), frame);
    },
    band(low, high, source, t) {
      return bandValue(reader, sequenceId, resolveSource(view, source, clip), Math.min(low, high), Math.max(low, high), at(t));
    },
    hits(name, source, t) {
      if (!isOnsetName(name)) throw new ExpressionError(`There are no hits called "${name}": use ${ONSET_SCALARS.map((n) => `"${n}"`).join(", ")}`);
      const hits = sourceHits(reader, sequenceId, resolveSource(view, source, clip), name);
      const i = lastHit(hits, at(t));
      return i < 0 ? { since: NEVER, count: 0, velocity: 0 } : { since: at(t) - hits[i][0], count: i + 1, velocity: hits[i][1] };
    },
    beat: (t) => beatAt(reader, sequenceId, at(t)),
  };
}

provideSignalScopes(signalScope);

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
const SOUND_CALL = /\b(audio|audioAt|band|sinceHit|hitCount|hitVelocity|beat|bar|beatPhase|sinceBeat|bpm|section|sinceDrop)\s*\(/;

/** Whether anything in a video reacts to sound (so the export needs its files' signals). */
export function usesSignals(document: Project): boolean {
  for (const clip of [...document.clips, ...(document.sequences ?? []).flatMap((s) => s.clips)]) {
    for (const effect of clip.effects) {
      for (const source of Object.values(effect.expressions ?? {})) if (SOUND_CALL.test(source)) return true;
    }
  }
  return false;
}
