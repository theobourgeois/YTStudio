/**
 * Making and repairing music documents: the one place that decides what a valid `MusicProject` is.
 * It runs when a song is created, loaded and saved, so a new field must be validated here (and
 * old documents upgraded here), or it's dropped.
 */
import { clamp, isFiniteNumber } from "../math.ts";
import { DEFAULT_PROJECT_NAME } from "../timeline.ts";
import type { MusicProject } from "./types.ts";

export const DEFAULT_TEMPO = 120;
export const MIN_TEMPO = 20;
export const MAX_TEMPO = 999;
/** The notes that can get the beat. */
export const BEAT_UNITS = [1, 2, 4, 8, 16, 32] as const;

export function createMusicProject(name = DEFAULT_PROJECT_NAME): MusicProject {
  return { version: 1, name, settings: { tempo: DEFAULT_TEMPO, timeSignature: [4, 4] } };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Repair a song from untrusted storage: anything missing or out of range falls back to the default. */
export function normalizeMusicProject(input: unknown): MusicProject {
  const base = createMusicProject();
  if (!isObject(input)) return base;
  const settings = isObject(input.settings) ? input.settings : {};
  const tempo = isFiniteNumber(settings.tempo) ? Math.round(clamp(settings.tempo, MIN_TEMPO, MAX_TEMPO) * 100) / 100 : base.settings.tempo;
  const [beats, unit] = Array.isArray(settings.timeSignature) ? settings.timeSignature : [];
  const timeSignature: [number, number] =
    Number.isInteger(beats) && (beats as number) >= 1 && (beats as number) <= 32 && BEAT_UNITS.includes(unit as (typeof BEAT_UNITS)[number])
      ? [beats as number, unit as number]
      : base.settings.timeSignature;
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : base.name;
  return { version: 1, name, settings: { tempo, timeSignature } };
}
