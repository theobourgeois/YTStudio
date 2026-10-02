/**
 * Tempo automation (`docs/fl-studio/automation.md`): in song mode, tempo automation clips change how fast
 * the song goes, so its ticks and seconds no longer go hand in hand. The engine keeps one tempo, the
 * song's own, and `compileSong` sends it the song with every tick moved to where it falls in time at that
 * tempo (`engineTick`: "warped" ticks); the tab turns the engine's ticks back (`songTick`). Without a
 * tempo clip (and always in pattern mode) the two are the same. Pure, and tested.
 */
import { automationIndex, controlBreaks, controlOf, placedValue, clipAtTick, type AutomationIndex } from "./automation.ts";
import { clipContext, songTicks } from "./playlist.ts";
import { sampleLane } from "./sampling.ts";
import { type AutomationTarget, type MusicProject, PPQ } from "./types.ts";

/** Tempo's automation target: the song's. */
export const TEMPO_TARGET: AutomationTarget = { kind: "tempo" };

/** How close (BPM) the tempo map's straight lines keep to the curves. */
const TEMPO_TOLERANCE = 0.01;
/** How far past the song the map is drawn (a recording going on past its end): the last tempo holds after anyway. */
const PAST_END = PPQ * 4 * 64;

/**
 * The song's tempo over its ticks, in straight lines: from `ticks[i]` at `bpm[i]` to `ticks[i + 1]` at
 * `bpm[i + 1]` (two on one tick: a jump; the last tempo holds after the last). `warped[i]` is the engine's
 * tick (at `base`, the song's own tempo) at `ticks[i]`.
 */
export interface TempoMap {
  base: number;
  ticks: number[];
  bpm: number[];
  warped: number[];
}

const maps = new WeakMap<AutomationIndex, { base: number; map: TempoMap | null }>();

/** The song's tempo map in song mode, or null when no tempo clip plays (ticks are the engine's then). */
export function tempoMap(song: MusicProject): TempoMap | null {
  const index = automationIndex(song);
  const base = song.settings.tempo;
  const known = maps.get(index);
  if (known && known.base === base) return known.map;
  const placed = index.get("tempo");
  let map: TempoMap | null = null;
  if (placed?.length) {
    const { barTicks } = clipContext(song);
    const info = controlOf(song, TEMPO_TARGET);
    const end = Math.max(songTicks(song), ...placed.map((p) => p.end)) + PAST_END;
    const tempoAtTick = (tick: number) => {
      const found = clipAtTick(placed, tick);
      return [found ? info.toControl(placedValue(found.placed, tick, barTicks)) : base];
    };
    const lane = sampleLane(tempoAtTick, controlBreaks(placed, 0, end), 0, end, PPQ, TEMPO_TOLERANCE);
    const warped: number[] = [0];
    for (let i = 1; i < lane.ticks.length; i++) warped.push(warped[i - 1] + span(lane.ticks[i - 1], lane.values[i - 1], lane.ticks[i], lane.values[i], base));
    map = { base, ticks: lane.ticks, bpm: lane.values, warped };
  }
  maps.set(index, { base, map });
  return map;
}

/** The engine's ticks (at `base`) from tick `t0` at `b0` BPM to `t1` at `b1`, the tempo going in a straight line between. */
function span(t0: number, b0: number, t1: number, b1: number, base: number): number {
  const length = t1 - t0;
  if (length <= 0) return 0;
  // ∫ base / b(t) dt with b linear: a logarithm (or, flat, a ratio).
  const slope = (b1 - b0) / length;
  return Math.abs(slope) < 1e-9 ? (length * base) / b0 : (base / slope) * Math.log(b1 / b0);
}

/** The segment `tick` is in: the last point at or before it (of points on one tick, the last). */
function segmentAt(keys: readonly number[], at: number): number {
  let low = 0;
  let high = keys.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (keys[mid] <= at) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The engine's tick for a tick of the song: where it falls in time, counted at the song's own tempo. */
export function engineTick(map: TempoMap | null, tick: number): number {
  if (!map) return tick;
  if (tick <= 0) return (tick * map.base) / map.bpm[0];
  const i = segmentAt(map.ticks, tick);
  const last = i === map.ticks.length - 1;
  const b0 = map.bpm[i];
  const b1 = last ? b0 : map.bpm[i + 1];
  const t1 = last ? tick : map.ticks[i + 1];
  // Where the tempo is at `tick` along the segment's line.
  const at = t1 === map.ticks[i] ? b0 : b0 + ((b1 - b0) * (tick - map.ticks[i])) / (t1 - map.ticks[i]);
  return map.warped[i] + span(map.ticks[i], b0, tick, at, map.base);
}

/** The song's tick for one of the engine's (the inverse of `engineTick`). */
export function songTick(map: TempoMap | null, warped: number): number {
  if (!map) return warped;
  if (warped <= 0) return (warped * map.bpm[0]) / map.base;
  const i = segmentAt(map.warped, warped);
  const t0 = map.ticks[i];
  const b0 = map.bpm[i];
  const x = (warped - map.warped[i]) / map.base;
  const last = i === map.ticks.length - 1;
  const slope = last || map.ticks[i + 1] === t0 ? 0 : (map.bpm[i + 1] - b0) / (map.ticks[i + 1] - t0);
  // The inverse of `span`: from a ratio, or an exponential.
  const tick = Math.abs(slope) < 1e-9 ? t0 + x * b0 : t0 + (b0 * (Math.exp(slope * x) - 1)) / slope;
  return last ? tick : Math.min(tick, map.ticks[i + 1]);
}

/** The tempo at a tick of the song in song mode (its own, without a tempo clip). */
export function tempoAt(song: MusicProject, tick: number): number {
  const map = tempoMap(song);
  if (!map) return song.settings.tempo;
  const i = segmentAt(map.ticks, tick);
  if (i === map.ticks.length - 1 || tick <= map.ticks[i]) return map.bpm[i];
  return map.bpm[i] + ((map.bpm[i + 1] - map.bpm[i]) * (tick - map.ticks[i])) / (map.ticks[i + 1] - map.ticks[i]);
}

/** Seconds from the song's start to a tick of it in song mode, tempo clips and all. */
export function songSeconds(song: MusicProject, tick: number): number {
  return (engineTick(tempoMap(song), tick) * 60) / (song.settings.tempo * PPQ);
}

/**
 * How the ticks of a song sent to the engine (the song's, counted from its loop's start `from`) become the
 * engine's and back: the same without a tempo map (`warped` false).
 */
export interface SongClock {
  from: number;
  warped: boolean;
  toEngine: (tick: number) => number;
  toSong: (tick: number) => number;
}

/** The song's clock for a loop from `from` with this tempo map (`tempoMap`, null in pattern mode). */
export function songClock(map: TempoMap | null, from: number): SongClock {
  if (!map) return { from, warped: false, toEngine: (tick) => tick, toSong: (tick) => tick };
  const origin = engineTick(map, from);
  return { from, warped: true, toEngine: (tick) => engineTick(map, from + tick) - origin, toSong: (tick) => songTick(map, origin + tick) - from };
}
