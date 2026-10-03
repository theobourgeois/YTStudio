/**
 * The mixer's meters, pure: where a level is on a meter (in dB) and how a meter falls between the
 * engine's reports (`EngineMeters`, about 25 a second), so it moves smoothly and a hit is seen.
 */
import { DEFAULT_FADER } from "@shared/music/project";
import { faderGain } from "@shared/music/compile";

/** The meter's top and bottom, in dB: 0 dB is near the top, as on FL Studio's. */
export const METER_TOP_DB = 6;
export const METER_FLOOR_DB = -60;
/** How fast a meter falls once the sound is gone. */
const FALL_DB_PER_SECOND = 36;
/** How long it stays red after a level over 0 dB. */
const CLIP_MS = 1500;

export const toDb = (level: number) => (level > 0 ? 20 * Math.log10(level) : -Infinity);

/** A level (0..1+) as a height on the meter, 0..1. */
export function meterFraction(level: number): number {
  const db = toDb(level);
  if (!(db > METER_FLOOR_DB)) return 0;
  return Math.min(1, (db - METER_FLOOR_DB) / (METER_TOP_DB - METER_FLOOR_DB));
}

/** Where a meter's colours change, as levels: green up to -18 dB, amber by -6, red from 0 dB. The Browser's waveform uses them too. */
export const METER_COLOUR_STOPS = [
  { level: 10 ** (-18 / 20), colour: "low" },
  { level: 10 ** (-6 / 20), colour: "mid" },
  { level: 1, colour: "high" },
] as const;

/** The lowest level the scale marks, in dB (FL's selected meter goes down to 51). */
const SCALE_FLOOR_DB = -51;
/** The closest two of the scale's labels may be, in px. */
const SCALE_MIN_GAP = 11;

/**
 * The dB scale beside a meter `height` px tall, FL Studio's: a mark every 3 dB from +3 down to -51 (shown
 * without their sign: 3, 0, 3, 6...), or every 6 or 12 when they wouldn't fit. `at` is the mark's height
 * on the meter, 0..1 from the bottom, as `meterFraction` puts a level.
 */
export function meterScale(height: number): { db: number; at: number }[] {
  const at = (db: number) => (db - METER_FLOOR_DB) / (METER_TOP_DB - METER_FLOOR_DB);
  const step = [3, 6, 12].find((s) => (at(s) - at(0)) * height >= SCALE_MIN_GAP) ?? 24;
  const marks = [];
  for (let db = step === 3 ? 3 : 0; db >= SCALE_FLOOR_DB; db -= step) marks.push({ db, at: at(db) });
  return marks;
}

export interface MeterState {
  /** What it shows now, as a level (0..1+). */
  level: number;
  /** When it last went over 0 dB (ms), or -Infinity. */
  clippedAt: number;
}

export const SILENT_METER: MeterState = { level: 0, clippedAt: -Infinity };

/**
 * The meter `dt` ms on: up at once to a level the engine reported (`heard`, or null if it said nothing
 * new), otherwise falling at a steady number of dB a second.
 */
export function stepMeter(state: MeterState, heard: number | null, dt: number, now: number): MeterState {
  const fallen = state.level * 10 ** (-(FALL_DB_PER_SECOND * Math.max(0, dt)) / 1000 / 20);
  const level = Math.max(heard ?? 0, fallen < 10 ** (METER_FLOOR_DB / 20) ? 0 : fallen);
  return { level, clippedAt: heard !== null && heard >= 1 ? now : state.clippedAt };
}

export const isClipping = (state: MeterState, now: number) => now - state.clippedAt < CLIP_MS;

/** A fader's level in dB ("−3.2 dB", "−∞"), as the hint shows it. */
export function faderDb(volume: number): string {
  const db = toDb(faderGain(volume));
  if (!Number.isFinite(db)) return "−∞ dB";
  const rounded = Math.round(db * 10) / 10;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)} dB`;
}

/** The fader's position for a level in dB (typed in), within its travel. */
export function faderAt(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, DEFAULT_FADER * (10 ** (db / 20)) ** (1 / 3)));
}

/**
 * Where faders that started at `starts` go when one of them (at `from`) is dragged to `to`: each moves by
 * as many dB as it did (Logic's and Pro Tools' way), so a mix's balance is kept. One at −∞ stays there,
 * and every one goes to −∞ with it. Positions, 0..1.
 */
export function moveFadersTogether(starts: ReadonlyMap<string, number>, from: number, to: number): Map<string, number> {
  const delta = toDb(faderGain(to)) - toDb(faderGain(from));
  return new Map(
    [...starts].map(([id, start]) => {
      if (start === from) return [id, to];
      // Dragged up from −∞, the others can't follow by dB: they stay where they are.
      if (delta === Infinity) return [id, start];
      const db = toDb(faderGain(start)) + delta;
      // One at −∞ can't be moved by dB either.
      return [id, Number.isNaN(db) ? start : faderAt(db)];
    }),
  );
}

/**
 * A fader's travel with a hold at `at` (0 dB), FL Studio's: within `width` of it either way the fader stays
 * at `at`; past that it carries on from there, the rest of the travel stretched so both ends are still
 * reached and nothing jumps. Values are 0..1.
 */
export function detent(raw: number, at: number, width: number): number {
  if (width <= 0 || Math.abs(raw - at) <= width) return width <= 0 ? raw : at;
  if (raw > at) return at + ((raw - at - width) * (1 - at)) / (1 - at - width);
  return at - ((at - width - raw) * at) / (at - width);
}
