/**
 * The assistant's modulators (`docs/sidechain.md`): pure edits of the song, as the Modulators window and the
 * Modulate menu make them (`add_modulator`, `update_modulator`, `link_modulator`, `remove_modulator`), and
 * what `get_modulators` says.
 */
import { isFiniteNumber } from "@shared/math";
import { controlName, controlOf } from "@shared/music/automation";
import {
  MODULATOR_RANGES,
  type ModulatorPatch,
  addModulator,
  amountText,
  canModulate,
  findModulator,
  linkControl,
  linkRangeText,
  modulatorName,
  removeModulator,
  sourceText,
  updateModulator,
} from "@shared/music/modulation";
import { SIDECHAIN_TAP_NAMES } from "@shared/music/sidechain";
import { type AutomationTarget, type Modulator, type ModulatorSource, type MusicProject, SIDECHAIN_TAPS, type SidechainTap } from "@shared/music/types";
import { findTrack } from "../mixer/tool-edits";
import { type EditResult, findChannel } from "../tool-edits";

type Input = Record<string, unknown>;

/** A modulator the model named: its id or its name. */
export function findModulatorRef(song: MusicProject, ref: unknown): Modulator {
  const text = typeof ref === "string" ? ref.trim() : "";
  const found = findModulator(song, text) ?? song.modulators.find((m) => modulatorName(song, m).toLowerCase() === text.toLowerCase());
  if (found) return found;
  const all = song.modulators.map((m) => `"${modulatorName(song, m)}" (${m.id})`).join(", ");
  throw new Error(`There's no modulator "${text}". ${all ? `The song's: ${all}.` : "The song has none: add_modulator makes one."}`);
}

/** The source an input names: `channel` (its notes) or `track` (its level) at `tap`. Undefined when it names neither. */
function sourceOf(song: MusicProject, input: Input): ModulatorSource | undefined {
  const hasChannel = input.channel !== undefined && input.channel !== "";
  const hasTrack = input.track !== undefined && input.track !== "";
  if (hasChannel && hasTrack) throw new Error('Give a "track" (its level) or a "channel" (its notes), not both.');
  if (hasChannel) return { kind: "notes", channel: findChannel(song, input.channel).id };
  if (!hasTrack) return undefined;
  if (input.tap !== undefined && !SIDECHAIN_TAPS.includes(input.tap as SidechainTap)) throw new Error(`"tap" must be one of ${SIDECHAIN_TAPS.join(", ")}.`);
  return { kind: "track", track: findTrack(song, input.track).id, tap: (input.tap as SidechainTap | undefined) ?? "postFx" };
}

/** The follower's knobs an input sets: attack and release in milliseconds, gain in dB, tension. */
function knobsOf(input: Input): ModulatorPatch {
  const patch: ModulatorPatch = {};
  const ms = (key: "attack" | "release") => {
    const value = input[key];
    if (value === undefined) return;
    const [min, max] = MODULATOR_RANGES[key];
    if (!isFiniteNumber(value) || value < min * 1000 || value > max * 1000) throw new Error(`"${key}" must be milliseconds from ${min * 1000} to ${max * 1000}.`);
    patch[key] = value / 1000;
  };
  ms("attack");
  ms("release");
  for (const key of ["gain", "tension"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    const [min, max] = MODULATOR_RANGES[key];
    if (!isFiniteNumber(value) || value < min || value > max) throw new Error(`"${key}" must be a number from ${min} to ${max}.`);
    patch[key] = value;
  }
  if (typeof input.name === "string") patch.name = input.name;
  return patch;
}

/** `add_modulator`: a modulator following a track's level or a channel's notes. */
export function addModulatorTool(song: MusicProject, input: Input, id: string): EditResult {
  const source = sourceOf(song, input);
  if (!source) throw new Error('Say what it follows: a mixer "track" (its level, as a kick ducks a bass) or a "channel" (its notes: a gate, even muted).');
  const next = addModulator(song, source, id, knobsOf(input));
  if (!next) throw new Error("The song has as many modulators as it can hold: remove_modulator frees one, or link more controls to one that's there.");
  const made = findModulator(next, id)!;
  return { song: next, text: `Made modulator ${id} ("${modulatorName(next, made)}"), following ${sourceText(next, source)}. link_modulator links the controls it moves.\n${describeModulator(next, made)}` };
}

/** `update_modulator`: its source, name or follower. */
export function updateModulatorTool(song: MusicProject, input: Input): EditResult {
  const modulator = findModulatorRef(song, input.modulator);
  const patch: ModulatorPatch = { ...knobsOf(input) };
  const source = sourceOf(song, input);
  if (source) patch.source = source;
  else if (input.tap !== undefined) {
    if (modulator.source.kind !== "track") throw new Error(`${modulatorName(song, modulator)} follows notes: it has no tap.`);
    if (!SIDECHAIN_TAPS.includes(input.tap as SidechainTap)) throw new Error(`"tap" must be one of ${SIDECHAIN_TAPS.join(", ")}.`);
    patch.source = { ...modulator.source, tap: input.tap as SidechainTap };
  }
  const next = updateModulator(song, modulator.id, patch);
  return { song: next, text: next === song ? "Nothing changed." : describeModulator(next, findModulator(next, modulator.id)!) };
}

/** `link_modulator`: a control moved by a modulator by `amount`, or (amount null, "none") no longer. */
export function linkModulatorEdit(song: MusicProject, input: Input, target: AutomationTarget): EditResult {
  const modulator = findModulatorRef(song, input.modulator);
  if (!canModulate(target)) throw new Error("The tempo can't be modulated: automate it (add_automation).");
  const info = controlOf(song, target);
  if (!info.exists) throw new Error(`${controlName(info)} isn't in the song any more.`);
  const amount = input.amount === null || input.amount === "none" ? null : input.amount;
  if (amount !== null && (!isFiniteNumber(amount) || amount < -1 || amount > 1)) throw new Error('"amount" must be from -1 to 1 (of the control\'s range at full level; negative ducks), or "none" to unlink it.');
  const next = linkControl(song, modulator.id, target, amount as number | null);
  if (amount === null) return { song: next, text: next === song ? `${controlName(info)} wasn't linked to ${modulatorName(song, modulator)}.` : `${controlName(info)} is no longer moved by ${modulatorName(song, modulator)}.` };
  const link = findModulator(next, modulator.id)!.links.find((l) => JSON.stringify(l.target) === JSON.stringify(target));
  const range = link && target.kind !== "plugin" ? ` (${linkRangeText(next, link)} at full level)` : " (from the plugin's own value)";
  return { song: next, text: `${controlName(info)} is moved by ${modulatorName(next, modulator)}, ${amountText(amount as number)}${range}.` };
}

/** `remove_modulator`. */
export function removeModulatorTool(song: MusicProject, input: Input): EditResult {
  const modulator = findModulatorRef(song, input.modulator);
  return { song: removeModulator(song, modulator.id), text: `Removed ${modulatorName(song, modulator)}: its ${modulator.links.length} control${modulator.links.length === 1 ? "" : "s"} are their own values again.` };
}

/** One modulator, for the model: what it follows, how, and what it moves. */
export function describeModulator(song: MusicProject, m: Modulator): string {
  const source = m.source.kind === "track" ? `${sourceText(song, m.source)}'s level (${SIDECHAIN_TAP_NAMES[m.source.tap].toLowerCase()})` : sourceText(song, m.source);
  const lines = [
    `- ${m.id} "${modulatorName(song, m)}": follows ${source}; attack ${Math.round(m.attack * 1000)} ms, release ${Math.round(m.release * 1000)} ms, gain ${m.gain} dB, tension ${m.tension}`,
  ];
  if (!m.links.length) lines.push("    moves nothing yet");
  for (const link of m.links) {
    const info = controlOf(song, link.target);
    lines.push(`    moves ${controlName(info)} by ${amountText(link.amount)}${info.exists && link.target.kind !== "plugin" ? ` (${linkRangeText(song, link)})` : ""}${info.exists ? "" : " (gone)"}`);
  }
  return lines.join("\n");
}

/** `get_modulators`. */
export function describeModulators(song: MusicProject): string {
  if (!song.modulators.length) return "The song has no modulators. add_modulator makes one (a kick's level, say), link_modulator links what it moves (a bass's fader, -0.6: a duck).";
  return ["The modulators (each follows a level, and moves its controls from their own values by their amounts as it rises):", ...song.modulators.map((m) => describeModulator(song, m))].join("\n");
}
