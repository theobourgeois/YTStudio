/**
 * Reading a file's signals at any moment (seconds into the file): between frames linearly, outside
 * the file as silence. Values here are the file's own units (dB, flux, Hz); turning them into 0..1
 * against the file's references, and summing several files, is the reader's (`shared/audio-signals.ts`).
 */
import { BAND_COUNT, SCALARS, type ScalarName, type SignalData, byteDb } from "./format.ts";

const INDEX = Object.fromEntries(SCALARS.map((s, i) => [s, i])) as Record<ScalarName, number>;
const SILENT_DB = -120;

/** What a scalar reads where there's no sound. */
export const silentValue = (name: ScalarName) => (name === "level" || name === "peak" || isBandScalar(name) ? SILENT_DB : 0);
const isBandScalar = (name: ScalarName) =>
  name === "sub" || name === "bass" || name === "lowMid" || name === "mid" || name === "upperMid" || name === "presence" || name === "air";

/** Energy (a full-scale sine is 1) of a level in dB; and back. */
export const dbPower = (db: number) => (db <= SILENT_DB ? 0 : 10 ** (db / 10));
export const powerDb = (power: number) => (power > 1e-12 ? Math.max(SILENT_DB, 10 * Math.log10(power)) : SILENT_DB);

function raw(data: SignalData, column: number, frame: number, silent: number): number {
  if (frame < 0 || frame >= data.header.frames) return silent;
  return data.scalars[frame * data.header.scalars.length + column];
}

/** A scalar at `t` seconds into the file. */
export function scalarAt(data: SignalData, name: ScalarName, t: number): number {
  const silent = silentValue(name);
  const x = t * data.header.rate;
  if (!(x > -1 && x < data.header.frames)) return silent;
  const f = Math.floor(x);
  const p = x - f;
  const c = INDEX[name];
  const a = raw(data, c, f, silent);
  return p === 0 ? a : a + (raw(data, c, f + 1, silent) - a) * p;
}

/** The largest value of a scalar between two moments (both included): an onset can't fall between two video frames. */
export function scalarMax(data: SignalData, name: ScalarName, from: number, to: number): number {
  let best = Math.max(scalarAt(data, name, from), scalarAt(data, name, to));
  const c = INDEX[name];
  const silent = silentValue(name);
  const last = Math.min(data.header.frames - 1, Math.floor(to * data.header.rate));
  for (let f = Math.max(0, Math.ceil(from * data.header.rate)); f <= last; f++) best = Math.max(best, raw(data, c, f, silent));
  return best;
}

/** How much of each band lies between two frequencies (by their log width, as the bands are spaced). */
function bandShares(data: SignalData, low: number, high: number): [number, number][] {
  const edges = data.header.bandEdges;
  const shares: [number, number][] = [];
  if (!(high > low)) return shares;
  for (let b = 0; b < BAND_COUNT; b++) {
    const lo = Math.max(low, edges[b]);
    const hi = Math.min(high, edges[b + 1]);
    if (hi > lo) shares.push([b, Math.log(hi / lo) / Math.log(edges[b + 1] / edges[b])]);
  }
  return shares;
}

/** The energy between two frequencies at `t` seconds into the file (a full-scale sine is 1). */
export function bandEnergyAt(data: SignalData, low: number, high: number, t: number): number {
  const x = t * data.header.rate;
  if (!(x > -1 && x < data.header.frames)) return 0;
  const f = Math.floor(x);
  const p = x - f;
  const at = (frame: number, b: number) =>
    frame < 0 || frame >= data.header.frames ? 0 : dbPower(byteDb(data.bands[frame * BAND_COUNT + b]));
  let energy = 0;
  for (const [b, share] of bandShares(data, low, high)) energy += share * (at(f, b) * (1 - p) + at(f + 1, b) * p);
  return energy;
}

/** What counts as loud between two frequencies for this file: its bands' references' energy. */
export function bandReferenceEnergy(data: SignalData, low: number, high: number): number {
  let energy = 0;
  for (const [b, share] of bandShares(data, low, high)) energy += share * dbPower(data.header.bandReference[b]);
  return energy;
}
