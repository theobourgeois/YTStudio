/**
 * Gross Beat (`docs/fl-studio/gross-beat.md`): its slots (each one changed by the user, or its preset), what
 * its envelopes mean (a time envelope's offset and speed), its edits, and the settings the engine plays
 * (`engineGrossBeat`). Pure and tested.
 */
import { clamp } from "../math.ts";
import { curveBreaks, curveValue, findEffect, movePoint } from "./automation.ts";
import {
  GROSS_DEPTH,
  GROSS_SLOTS,
  GROSS_SYNCS,
  GROSS_TICKS,
  GROSS_TIME_PRESETS,
  GROSS_VOLUME_PRESETS,
  MAX_GROSS_ATTACK,
  MAX_GROSS_RELEASE,
  offsetValue,
  valueOffset,
} from "./gross-beat-presets.ts";
import { MAX_NAME, normalizePoints } from "./project.ts";
import { sampleLane } from "./sampling.ts";
import { type AutomationPoint, type CurveType, type GrossBeat, type GrossBeatSlot, type GrossHold, type MusicProject, PPQ } from "./types.ts";

export type GrossKind = "time" | "volume";

/** A kind's presets. */
export const grossPresets = (kind: GrossKind) => (kind === "time" ? GROSS_TIME_PRESETS : GROSS_VOLUME_PRESETS);

/** A slot as it is: the user's, or its preset. */
export const grossSlot = (gb: GrossBeat, kind: GrossKind, index: number): GrossBeatSlot => gb[kind][index] ?? grossPresets(kind)[index] ?? grossPresets(kind)[0];

/** The slot a kind has picked. */
export const pickedSlot = (gb: GrossBeat, kind: GrossKind) => (kind === "time" ? gb.timeSlot : gb.volumeSlot);

/** An empty slot (Clear): a time envelope at now (the sound as it comes), a volume envelope at full. */
export const emptyGrossSlot = (): GrossBeatSlot => ({
  name: "Empty",
  points: [
    { tick: 0, value: 1, tension: 0, curve: "single" },
    { tick: GROSS_TICKS, value: 1, tension: 0, curve: "single" },
  ],
});

/** A slot number as said: "Slot 3: 1/2 Speed". */
export const slotText = (gb: GrossBeat, kind: GrossKind, index: number) => `Slot ${index + 1}: ${grossSlot(gb, kind, index).name}`;

// ---------------------------------------------------------------------------
// What a time envelope does
// ---------------------------------------------------------------------------

/** A time envelope's offset at a tick of its bar, in beats (0 is now, down to -8). */
export const offsetAt = (points: readonly AutomationPoint[], tick: number) => valueOffset(curveValue(points, tick));

/**
 * How fast a time envelope plays at a tick of its bar: 1 is normal, 0.5 half speed (an octave down), 0
 * paused, below 0 backwards. Measured across a sixteenth of a tick, after the tick (a jump isn't a speed).
 */
export function speedAt(points: readonly AutomationPoint[], tick: number): number {
  const span = 1 / 16;
  const at = clamp(tick, 0, GROSS_TICKS - span);
  return 1 + ((offsetAt(points, at + span) - offsetAt(points, at)) / span) * PPQ;
}

/** A speed said as a musician would: "normal", "½ speed, -12 st", "reverse ×1", "paused". */
export function speedText(speed: number): string {
  if (Math.abs(speed) < 0.005) return "paused";
  if (Math.abs(speed - 1) < 0.005) return "normal speed";
  const semitones = Math.round(12 * Math.log2(Math.abs(speed)) * 10) / 10;
  const times = `×${Math.round(Math.abs(speed) * 100) / 100}`;
  if (speed < 0) return `reverse ${times}`;
  return `${times} (${semitones > 0 ? "+" : ""}${semitones} st)`;
}

/**
 * Pitch 1 semitone up / down (the point menu's): the segment arriving at `index` plays `semitones` higher
 * (faster) or lower, by moving the point. A jump (no length) and the first point don't change.
 */
export function pitchSegment(points: AutomationPoint[], index: number, semitones: number): AutomationPoint[] {
  const to = points[index];
  const from = points[index - 1];
  if (!to || !from || to.tick === from.tick) return points;
  const beats = (to.tick - from.tick) / PPQ;
  const speed = 1 + (valueOffset(to.value) - valueOffset(from.value)) / beats;
  const pitched = speed * 2 ** (semitones / 12);
  const value = clamp(offsetValue(valueOffset(from.value) + (pitched - 1) * beats), 0, 1);
  if (value === to.value) return points;
  return points.map((p, i) => (i === index ? { ...p, value } : p));
}

// ---------------------------------------------------------------------------
// Editing an envelope's points (more than an automation clip's: `automation.ts` has those)
// ---------------------------------------------------------------------------

/**
 * Move a point with Slide remaining points on: the points after it move along by as much. The bar's end
 * holds them: a point at it stays there, and points slid into it gather on it (the last one's value wins).
 */
export function slidePoint(points: AutomationPoint[], index: number, tick: number, value: number): AutomationPoint[] {
  const point = points[index];
  if (!point || index === 0) return movePoint(points, index, tick, value, GROSS_TICKS);
  const delta = Math.round(clamp(tick, points[index - 1].tick, GROSS_TICKS) - point.tick);
  const moved = points.map((p, i) => {
    if (i < index) return p;
    if (i === index) return { ...p, tick: p.tick + delta, value: clamp(value, 0, 1) };
    return p.tick === GROSS_TICKS ? p : { ...p, tick: clamp(p.tick + delta, point.tick + delta, GROSS_TICKS) };
  });
  if (delta === 0 && moved[index].value === point.value) return points;
  // Those gathered at the end: only the last stays.
  return moved.filter((p, i) => p.tick < GROSS_TICKS || i === moved.length - 1 || i === index);
}

/**
 * Step editing: the envelope holds `value` from `from` to `to` (ticks), with a jump at each end; what
 * was between goes. With `pulse` (Shift), only the first half holds it, the second half is `rest`.
 */
export function paintStep(points: AutomationPoint[], from: number, to: number, value: number, pulse = false, rest = 0): AutomationPoint[] {
  const a = Math.round(clamp(Math.min(from, to), 0, GROSS_TICKS));
  const b = Math.round(clamp(Math.max(from, to), 0, GROSS_TICKS));
  if (b <= a) return points;
  const v = clamp(value, 0, 1);
  const before = points.filter((p) => p.tick < a);
  const after = points.filter((p) => p.tick > b);
  const next: AutomationPoint[] = [...before];
  if (a > 0) {
    // Where the curve was arriving just before the step: kept, so what's before doesn't change.
    const ending = points.find((p) => p.tick >= a);
    next.push({ tick: a, value: curveValue(points, a - 1e-6), tension: ending?.tension ?? 0, curve: ending?.curve ?? "single" });
  }
  next.push({ tick: a, value: v, tension: 0, curve: a > 0 ? "hold" : "single" });
  if (pulse) {
    const middle = Math.round((a + b) / 2);
    next.push({ tick: middle, value: clamp(rest, 0, 1), tension: 0, curve: "hold" });
  }
  // Back to what the curve was at the step's end (the last of any points there), to go on from it.
  next.push({ tick: b, value: curveValue(points, b), tension: 0, curve: "hold" });
  next.push(...after);
  return tidyJumps(next);
}

/** Points on one tick at one value are one point; a hold arriving at the same value is a plain point. */
function tidyJumps(points: AutomationPoint[]): AutomationPoint[] {
  const out: AutomationPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.tick === p.tick && Math.abs(last.value - p.value) < 1e-9) continue;
    out.push(p);
  }
  return out;
}

/** Turn all points smooth: every segment an S curve. */
export function smoothAllPoints(points: AutomationPoint[]): AutomationPoint[] {
  if (points.every((p, i) => i === 0 || (p.curve === "smooth" && p.tension === 0))) return points;
  return points.map((p, i): AutomationPoint => (i === 0 ? p : { ...p, curve: "smooth" as CurveType, tension: 0 }));
}

// ---------------------------------------------------------------------------
// Editing the song's Gross Beats
// ---------------------------------------------------------------------------

/** A Gross Beat of the song, by its effect's id: its track, slot and settings. */
export function findGrossBeat(song: MusicProject, effectId: string) {
  const found = findEffect(song, effectId);
  if (!found?.effect?.grossBeat) return null;
  return { track: found.track, slot: found.track.effects.indexOf(found.effect), effect: found.effect, grossBeat: found.effect.grossBeat };
}

/** The song's Gross Beats, each with its track. */
export function grossBeats(song: MusicProject) {
  return song.mixer.tracks.flatMap((track) => track.effects.flatMap((effect, slot) => (effect?.grossBeat ? [{ track, slot, effect, grossBeat: effect.grossBeat }] : [])));
}

/** Change a Gross Beat's settings (`change` returning the same settings: the same song). */
export function editGrossBeat(song: MusicProject, effectId: string, change: (gb: GrossBeat) => GrossBeat): MusicProject {
  const found = findGrossBeat(song, effectId);
  if (!found) return song;
  const next = change(found.grossBeat);
  if (next === found.grossBeat) return song;
  const effects = found.track.effects.map((e) => (e === found.effect ? { ...e, grossBeat: next } : e));
  return { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t === found.track ? { ...t, effects } : t)) } };
}

export type GrossBeatPatch = Partial<Omit<GrossBeat, "time" | "volume">>;

const SYNC_SET: ReadonlySet<number> = new Set(GROSS_SYNCS);
const HOLDS: readonly GrossHold[] = ["off", "last", "next"];

/** Change Gross Beat's knobs, options and picked slots (with Link slots, picking one picks the other). */
export function updateGrossBeat(song: MusicProject, effectId: string, patch: GrossBeatPatch): MusicProject {
  return editGrossBeat(song, effectId, (gb) => {
    const slot = (v: number | undefined, was: number) => (v !== undefined && Number.isInteger(v) && v >= 0 && v < GROSS_SLOTS ? v : was);
    const unit = (v: number | undefined, was: number, max = 1, min = 0) => (v !== undefined && Number.isFinite(v) ? clamp(v, min, max) : was);
    const linkSlots = patch.linkSlots ?? gb.linkSlots;
    let timeSlot = slot(patch.timeSlot, gb.timeSlot);
    let volumeSlot = slot(patch.volumeSlot, gb.volumeSlot);
    if (linkSlots && patch.timeSlot !== undefined && patch.volumeSlot === undefined) volumeSlot = timeSlot;
    if (linkSlots && patch.volumeSlot !== undefined && patch.timeSlot === undefined) timeSlot = volumeSlot;
    const next: GrossBeat = {
      ...gb,
      timeSlot,
      volumeSlot,
      timeMix: unit(patch.timeMix, gb.timeMix),
      volumeMix: unit(patch.volumeMix, gb.volumeMix),
      attack: unit(patch.attack, gb.attack, MAX_GROSS_ATTACK),
      release: unit(patch.release, gb.release, MAX_GROSS_RELEASE),
      tension: unit(patch.tension, gb.tension, 1, -1),
      linkSlots,
      oneShot: patch.oneShot ?? gb.oneShot,
      hold: patch.hold && HOLDS.includes(patch.hold) ? patch.hold : gb.hold,
      trigSync: patch.trigSync !== undefined && SYNC_SET.has(patch.trigSync) ? patch.trigSync : gb.trigSync,
      posSync: patch.posSync !== undefined && SYNC_SET.has(patch.posSync) ? patch.posSync : gb.posSync,
      clickReduction: patch.clickReduction ?? gb.clickReduction,
      attackCompensation: patch.attackCompensation ?? gb.attackCompensation,
      removeDc: patch.removeDc ?? gb.removeDc,
      hq: patch.hq ?? gb.hq,
    };
    return (Object.keys(next) as (keyof GrossBeat)[]).every((k) => next[k] === gb[k]) ? gb : next;
  });
}

/** Put a slot (a copy pasted, a cleared one), or null to give it back its preset. */
export function setGrossSlot(song: MusicProject, effectId: string, kind: GrossKind, index: number, slot: GrossBeatSlot | null): MusicProject {
  if (!Number.isInteger(index) || index < 0 || index >= GROSS_SLOTS) return song;
  return editGrossBeat(song, effectId, (gb) => {
    if (slot === null && gb[kind][index] === null) return gb;
    const tidy = slot && { name: slot.name.trim().slice(0, MAX_NAME) || "Slot", points: normalizePoints(slot.points, GROSS_TICKS) };
    const list = [...gb[kind]];
    list[index] = tidy;
    return { ...gb, [kind]: list };
  });
}

/** Change a slot's points (`change` of its points: the automation clips' point edits, or ours above). */
export function editGrossSlot(song: MusicProject, effectId: string, kind: GrossKind, index: number, change: (points: AutomationPoint[]) => AutomationPoint[]): MusicProject {
  const found = findGrossBeat(song, effectId);
  if (!found || !Number.isInteger(index) || index < 0 || index >= GROSS_SLOTS) return song;
  const slot = grossSlot(found.grossBeat, kind, index);
  const points = change(slot.points);
  if (points === slot.points) return song;
  return editGrossBeat(song, effectId, (gb) => {
    const list = [...gb[kind]];
    list[index] = { name: slot.name, points };
    return { ...gb, [kind]: list };
  });
}

/** Rename a slot (the bottom bar's name, clicked). */
export function renameGrossSlot(song: MusicProject, effectId: string, kind: GrossKind, index: number, name: string): MusicProject {
  const found = findGrossBeat(song, effectId);
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!found || !trimmed) return song;
  const slot = grossSlot(found.grossBeat, kind, index);
  if (slot.name === trimmed) return song;
  return setGrossSlot(song, effectId, kind, index, { ...slot, name: trimmed });
}

// ---------------------------------------------------------------------------
// The engine's
// ---------------------------------------------------------------------------

/** An envelope as straight lines over the bar: `ticks` (0..`GROSS_TICKS`, two on one for a jump) and their values. */
export interface EngineGrossEnvelope {
  ticks: number[];
  values: number[];
}

/**
 * A Gross Beat as the engine plays it: its picked slots and knobs, its options, and the envelopes of the
 * slots that can play (null for the rest): time ones as offsets in beats (0 down to -8), volume ones as
 * levels (0..1).
 */
export interface EngineGrossBeat {
  timeSlot: number;
  volumeSlot: number;
  timeMix: number;
  volumeMix: number;
  attack: number;
  release: number;
  tension: number;
  oneShot: boolean;
  hold: GrossHold;
  /** Ticks (0: off). */
  trigSync: number;
  posSync: number;
  /** A slot's length in ticks (4 beats), and how far back time envelopes reach (beats). */
  ticks: number;
  depth: number;
  clickReduction: boolean;
  attackCompensation: boolean;
  removeDc: boolean;
  hq: boolean;
  time: (EngineGrossEnvelope | null)[];
  volume: (EngineGrossEnvelope | null)[];
}

/**
 * How far a time envelope's lines may be from its curve, in beats: a ten-thousandth (5 µs at 120 BPM), so
 * a scratch's speed is smooth; a volume envelope's, a thousandth of full.
 */
const TIME_TOLERANCE = 1e-4;
const VOLUME_TOLERANCE = 1e-3;

/** One slot's envelope as the engine reads it: sampled within its tolerance, a jump at each of its breaks. */
export function engineEnvelope(points: readonly AutomationPoint[], kind: GrossKind): EngineGrossEnvelope {
  const time = kind === "time";
  const value = (tick: number) => [time ? valueOffset(curveValue(points, tick)) : curveValue(points, tick)];
  return sampleLane(value, curveBreaks({ points }, 0, GROSS_TICKS), 0, GROSS_TICKS, PPQ / 4, time ? TIME_TOLERANCE : VOLUME_TOLERANCE);
}

/**
 * A Gross Beat for the engine: the envelopes of `timeSlots` and `volumeSlots` (the slots that can play:
 * the picked ones, and any its automation reaches), the others null.
 */
export function engineGrossBeat(gb: GrossBeat, timeSlots: ReadonlySet<number>, volumeSlots: ReadonlySet<number>): EngineGrossBeat {
  const envelopes = (kind: GrossKind, slots: ReadonlySet<number>) => Array.from({ length: GROSS_SLOTS }, (_, i) => (slots.has(i) ? engineEnvelope(grossSlot(gb, kind, i).points, kind) : null));
  return {
    timeSlot: gb.timeSlot,
    volumeSlot: gb.volumeSlot,
    timeMix: gb.timeMix,
    volumeMix: gb.volumeMix,
    attack: gb.attack,
    release: gb.release,
    tension: gb.tension,
    oneShot: gb.oneShot,
    hold: gb.hold,
    trigSync: gb.trigSync * PPQ,
    posSync: gb.posSync * PPQ,
    ticks: GROSS_TICKS,
    depth: GROSS_DEPTH,
    clickReduction: gb.clickReduction,
    attackCompensation: gb.attackCompensation,
    removeDc: gb.removeDc,
    hq: gb.hq,
    time: envelopes("time", timeSlots),
    volume: envelopes("volume", volumeSlots),
  };
}

/** A slot number (0..35) from an automation's fraction of its range, and back. */
export const slotOfFraction = (fraction: number) => Math.round(clamp(fraction, 0, 1) * (GROSS_SLOTS - 1));
export const fractionOfSlot = (slot: number) => slot / (GROSS_SLOTS - 1);
