/**
 * The assistant's Gross Beat (`shared/music/tools.ts`: get_gross_beat, update_gross_beat,
 * set_gross_beat_slot): pure `(song, input) => { song, text }` edits like the rest of `tool-edits.ts`,
 * and what get_gross_beat says. For the model, a slot is numbered 1 to 36 (or named), times are beats
 * (0 to 4 across the bar) and a time envelope's value is how many beats back it reads (0 is now, 8 the
 * deepest); a volume envelope's is its level (0 to 1). Errors say what's wrong and what would work.
 */
import { isFiniteNumber } from "@shared/math";
import {
  type GrossKind,
  editGrossSlot,
  emptyGrossSlot,
  findGrossBeat,
  grossBeats,
  grossSlot,
  pickedSlot,
  setGrossSlot,
  speedAt,
  speedText,
  updateGrossBeat,
  type GrossBeatPatch,
} from "@shared/music/gross-beat";
import { GROSS_BEATS, GROSS_DEPTH, GROSS_SLOTS, GROSS_SYNCS, MAX_GROSS_ATTACK, MAX_GROSS_RELEASE, offsetValue, valueOffset } from "@shared/music/gross-beat-presets";
import { normalizePoints } from "@shared/music/project";
import { type AutomationPoint, CURVE_TYPES, type CurveType, type GrossBeat, type GrossHold, type MusicProject, PPQ } from "@shared/music/types";
import { findTrack, trackLabel } from "../mixer/tool-edits";
import type { EditResult } from "../tool-edits";

type Input = Record<string, unknown>;

const round = (n: number) => Math.round(n * 1000) / 1000;
const percent = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The Gross Beat an input names: by `effect` (its id), by `track` (the track's Gross Beat; with
 * `effectSlot`, the one in that slot), or the song's only one. The error lists the song's.
 */
export function findGross(song: MusicProject, input: Input) {
  const all = grossBeats(song);
  const list = () =>
    all.length ? `The song's Gross Beats: ${all.map((g) => `${g.effect.id} (${trackLabel(song, g.track)}, slot ${g.slot + 1})`).join(", ")}.` : 'The song has none: add_mixer_effect with plugin "Gross Beat" puts one on a track.';
  if (typeof input.effect === "string" && input.effect.trim()) {
    const found = findGrossBeat(song, input.effect.trim());
    if (!found) throw new Error(`There's no Gross Beat "${input.effect}". ${list()}`);
    return found;
  }
  if (input.track !== undefined && input.track !== "") {
    const track = findTrack(song, input.track);
    const on = all.filter((g) => g.track.id === track.id && (!Number.isInteger(input.effectSlot) || g.slot === (input.effectSlot as number) - 1));
    if (!on.length) throw new Error(`${trackLabel(song, track)} has no Gross Beat${Number.isInteger(input.effectSlot) ? ` in slot ${String(input.effectSlot)}` : ""}. ${list()}`);
    return on[0];
  }
  if (all.length === 1) return all[0];
  throw new Error(`Say which Gross Beat ("effect" or "track"). ${list()}`);
}

const kindOf = (value: unknown): GrossKind => {
  if (value !== "time" && value !== "volume") throw new Error('"kind" must be "time" or "volume".');
  return value;
};

/** A slot an input names: its number (1 to 36) or its name; 0-based. */
export function slotNumber(gb: GrossBeat, kind: GrossKind, ref: unknown): number {
  if (typeof ref === "number" && Number.isInteger(ref) && ref >= 1 && ref <= GROSS_SLOTS) return ref - 1;
  const text = typeof ref === "string" ? ref.trim().toLowerCase() : "";
  if (/^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= GROSS_SLOTS) return Number(text) - 1;
  const index = Array.from({ length: GROSS_SLOTS }, (_, i) => grossSlot(gb, kind, i).name.toLowerCase()).indexOf(text);
  if (index >= 0) return index;
  throw new Error(`There's no ${kind} slot "${String(ref)}". Use a number from 1 to ${GROSS_SLOTS} or a slot's name (get_gross_beat lists them).`);
}

const syncText = (beats: number) => (beats === 0 ? "off" : `${beats} beat${beats === 1 ? "" : "s"}`);

/** A slot's envelope said for the model: each point's beat, value, and how it gets there; a time envelope's speeds too. */
export function describeEnvelope(points: readonly AutomationPoint[], kind: GrossKind): string {
  return points
    .map((p, i) => {
      const beat = round(p.tick / PPQ);
      const value = kind === "time" ? `back ${round(-valueOffset(p.value))}` : `level ${round(p.value)}`;
      const how = i === 0 ? "" : `, ${p.curve}${p.tension ? ` (tension ${round(p.tension)})` : ""}`;
      const speed = kind === "time" && p.tick < GROSS_BEATS * PPQ ? `; then ${speedText(speedAt(points, p.tick))}` : "";
      return `{ beat ${beat}, ${value}${how}${speed} }`;
    })
    .join(" ");
}

/** get_gross_beat: where it is, what it plays, its knobs and options, its slots, and the envelopes asked for (the picked ones by default). */
export function describeGrossBeat(song: MusicProject, input: Input): string {
  const { track, slot, effect, grossBeat: gb } = findGross(song, input);
  const lines = [
    `Gross Beat ${effect.id}, slot ${slot + 1} of ${trackLabel(song, track)}${effect.enabled ? "" : " (bypassed)"}${effect.mix < 1 ? `, slot mix ${percent(effect.mix)}` : ""}.`,
    `Playing: time slot ${gb.timeSlot + 1} "${grossSlot(gb, "time", gb.timeSlot).name}", volume slot ${gb.volumeSlot + 1} "${grossSlot(gb, "volume", gb.volumeSlot).name}".`,
    `Knobs: time ${percent(gb.timeMix)}, volume ${percent(gb.volumeMix)}, attack ${Math.round(gb.attack * 1000)} ms, release ${Math.round(gb.release * 1000)} ms, tension ${round(gb.tension)}.`,
    `Options: link slots ${gb.linkSlots ? "on" : "off"}, one-shot ${gb.oneShot ? "on" : "off"}, HOLD ${gb.hold}, trig sync ${syncText(gb.trigSync)}, pos sync ${syncText(gb.posSync)}, ` +
      `click reduction ${gb.clickReduction ? "on" : "off"}, attack compensation ${gb.attackCompensation ? "on" : "off"}, remove DC ${gb.removeDc ? "on" : "off"}, HQ ${gb.hq ? "on" : "off"}.`,
  ];
  for (const kind of ["time", "volume"] as const) {
    const names = Array.from({ length: GROSS_SLOTS }, (_, i) => `${i + 1} ${grossSlot(gb, kind, i).name}${gb[kind][i] ? "*" : ""}`);
    lines.push(`${kind === "time" ? "Time" : "Volume"} slots (* changed from its preset): ${names.join(", ")}.`);
  }
  // The envelopes: those asked for, or the two picked.
  const asked = Array.isArray(input.slots) ? input.slots : [{ kind: "time", slot: gb.timeSlot + 1 }, { kind: "volume", slot: gb.volumeSlot + 1 }];
  for (const raw of asked) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Input;
    const kind = kindOf(item.kind);
    const index = slotNumber(gb, kind, item.slot);
    lines.push(`${kind === "time" ? "Time" : "Volume"} slot ${index + 1} "${grossSlot(gb, kind, index).name}": ${describeEnvelope(grossSlot(gb, kind, index).points, kind)}`);
  }
  lines.push(
    "A slot is a bar (4 beats) that repeats while it plays. A time envelope says how many beats back the sound is read from (0 is now, " +
      `${GROSS_DEPTH} the most): flat is normal speed, down one beat per beat is paused, down two per beat is backwards, a step is a jump (a repeat, a stutter).`,
  );
  return lines.join("\n");
}

const HOLDS: readonly GrossHold[] = ["off", "last", "next"];

/** update_gross_beat: pick slots, turn its knobs, set its options. */
export function updateGrossBeatTool(song: MusicProject, input: Input): EditResult {
  const { effect, grossBeat: gb } = findGross(song, input);
  const patch: GrossBeatPatch = {};
  if (input.timeSlot !== undefined) patch.timeSlot = slotNumber(gb, "time", input.timeSlot);
  if (input.volumeSlot !== undefined) patch.volumeSlot = slotNumber(gb, "volume", input.volumeSlot);
  const unit = (key: string, min: number, max: number, scale = 1): number | undefined => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (!isFiniteNumber(v) || v * scale < min || v * scale > max) throw new Error(`"${key}" must be a number from ${min / scale} to ${max / scale}.`);
    return v * scale;
  };
  patch.timeMix = unit("time", 0, 1);
  patch.volumeMix = unit("volume", 0, 1);
  patch.attack = unit("attack", 0, MAX_GROSS_ATTACK, 1 / 1000);
  patch.release = unit("release", 0, MAX_GROSS_RELEASE, 1 / 1000);
  patch.tension = unit("tension", -1, 1);
  for (const key of ["linkSlots", "oneShot", "clickReduction", "attackCompensation", "removeDc", "hq"] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") throw new Error(`"${key}" must be true or false.`);
    patch[key] = input[key] as boolean;
  }
  if (input.hold !== undefined) {
    if (!HOLDS.includes(input.hold as GrossHold)) throw new Error(`"hold" must be one of: ${HOLDS.join(", ")}.`);
    patch.hold = input.hold as GrossHold;
  }
  for (const key of ["trigSync", "posSync"] as const) {
    if (input[key] === undefined) continue;
    if (!GROSS_SYNCS.includes(input[key] as never)) throw new Error(`"${key}" must be one of (beats; 0 is off): ${GROSS_SYNCS.join(", ")}.`);
    patch[key] = input[key] as number;
  }
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as GrossBeatPatch;
  if (!Object.keys(defined).length) throw new Error("Nothing to change: give a slot to pick, a knob or an option.");
  const next = updateGrossBeat(song, effect.id, defined);
  const now = findGrossBeat(next, effect.id)!.grossBeat;
  return {
    song: next,
    text: `Gross Beat ${effect.id}: time slot ${now.timeSlot + 1} "${grossSlot(now, "time", now.timeSlot).name}", volume slot ${now.volumeSlot + 1} "${grossSlot(now, "volume", now.volumeSlot).name}", time ${percent(now.timeMix)}, volume ${percent(now.volumeMix)}.`,
  };
}

/** The points an input gives (`beat` 0..4, `back` beats or `level`), as a slot's. */
function pointsOf(raw: unknown, kind: GrossKind): AutomationPoint[] {
  const key = kind === "time" ? "back" : "level";
  if (!Array.isArray(raw) || !raw.length) throw new Error(`"points" must be a list of { beat, ${key} }: beat 0 to 4 across the bar, ${key === "back" ? `back 0 (now) to ${GROSS_DEPTH} beats` : "level 0 to 1"}.`);
  const points = raw.map((item, i): AutomationPoint => {
    const p = (item && typeof item === "object" ? item : {}) as Input;
    if (!isFiniteNumber(p.beat) || p.beat < 0 || p.beat > GROSS_BEATS) throw new Error(`Point ${i + 1}: "beat" must be from 0 to ${GROSS_BEATS}.`);
    const value = p[key];
    if (kind === "time" && (!isFiniteNumber(value) || value < 0 || value > GROSS_DEPTH)) throw new Error(`Point ${i + 1}: "back" must be beats back, 0 (now) to ${GROSS_DEPTH}.`);
    if (kind === "volume" && (!isFiniteNumber(value) || value < 0 || value > 1)) throw new Error(`Point ${i + 1}: "level" must be 0 (silent) to 1 (full).`);
    if (p.curve !== undefined && !CURVE_TYPES.includes(p.curve as CurveType)) throw new Error(`Point ${i + 1}: "curve" must be one of: ${CURVE_TYPES.join(", ")}.`);
    if (p.tension !== undefined && (!isFiniteNumber(p.tension) || Math.abs(p.tension) > 1)) throw new Error(`Point ${i + 1}: "tension" must be -1 to 1.`);
    return {
      tick: Math.round(p.beat * PPQ),
      value: kind === "time" ? offsetValue(-(value as number)) : (value as number),
      tension: (p.tension as number | undefined) ?? 0,
      curve: (p.curve as CurveType | undefined) ?? "single",
    };
  });
  for (let i = 1; i < points.length; i++) if (points[i].tick < points[i - 1].tick) throw new Error(`Point ${i + 1} is before point ${i}: give the points in order of "beat".`);
  return normalizePoints(points, GROSS_BEATS * PPQ);
}

/** set_gross_beat_slot: draw a slot's envelope (and name it), clear it, or give it back its preset; and pick it. */
export function setGrossBeatSlotTool(song: MusicProject, input: Input): EditResult {
  const { effect, grossBeat: gb } = findGross(song, input);
  const kind = kindOf(input.kind);
  const index = slotNumber(gb, kind, input.slot);
  let next = song;
  if (input.reset === true) next = setGrossSlot(next, effect.id, kind, index, null);
  else if (input.clear === true) next = setGrossSlot(next, effect.id, kind, index, emptyGrossSlot());
  if (input.points !== undefined) {
    const points = pointsOf(input.points, kind);
    next = editGrossSlot(next, effect.id, kind, index, () => points);
  }
  if (typeof input.name === "string" && input.name.trim()) {
    const slot = grossSlot(findGrossBeat(next, effect.id)!.grossBeat, kind, index);
    next = setGrossSlot(next, effect.id, kind, index, { ...slot, name: input.name });
  }
  if (input.pick !== false) next = updateGrossBeat(next, effect.id, kind === "time" ? { timeSlot: index } : { volumeSlot: index });
  if (next === song && input.points === undefined && input.reset !== true && input.clear !== true && !input.name) throw new Error('Nothing to change: give "points", "name", "clear" or "reset".');
  const now = findGrossBeat(next, effect.id)!.grossBeat;
  const slot = grossSlot(now, kind, index);
  return {
    song: next,
    text: `${kind === "time" ? "Time" : "Volume"} slot ${index + 1} "${slot.name}"${pickedSlot(now, kind) === index ? " (playing)" : ""}: ${describeEnvelope(slot.points, kind)}`,
  };
}
