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
