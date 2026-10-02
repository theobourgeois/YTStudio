/**
 * The assistant's automation (`shared/music/tools.ts`: get_automation, add_automation, update_automation):
 * pure `(song, input) => { song, text }` edits like the rest of `tool-edits.ts`. Bars for the model (a
 * point's `at` is bars from the curve's start), ticks inside; values as the control's knob has them (a
 * pan -1..1), turned into the curve's 0..1 here. Errors say what's wrong and what would work.
 */
import { isFiniteNumber } from "@shared/math";
import {
  AUTOMATION_COLOR,
  CURVE_NAMES,
  controlName,
  controlOf,
  createAutomation,
  normalizePointLevels,
  removeAutomations,
  scalePoints,
  updateAutomation,
  decimatePoints,
  flipPoints,
  smoothPoints,
  editPoints,
} from "@shared/music/automation";
import { clipContext, clipLength, songTicks } from "@shared/music/playlist";
import { MAX_PLAYLIST_TRACKS, normalizePoints } from "@shared/music/project";
import { type Automation, type AutomationPoint, type AutomationTarget, CURVE_TYPES, type CurveType, type MusicProject } from "@shared/music/types";
import { findTrack, trackLabel } from "../mixer/tool-edits";
import { type EditResult, findChannel } from "../tool-edits";

type Input = Record<string, unknown>;

const round = (n: number) => Math.round(n * 1000) / 1000;

/** An automation clip, by id or name; the error lists the ones there are. */
export function findAutomation(song: MusicProject, ref: unknown): Automation {
  const text = typeof ref === "string" ? ref.trim() : "";
  const found = song.automations.find((a) => a.id === text) ?? song.automations.find((a) => a.name.toLowerCase() === text.toLowerCase());
  if (!found) {
    const there = song.automations.map((a) => `"${a.name}" (${a.id})`).join(", ");
    throw new Error(`There's no automation clip "${text}". ${there ? `The automation clips are: ${there}.` : "The song has none: add_automation makes one."}`);
  }
  return found;
}

export const CONTROLS = ["volume", "pan", "stereo", "send", "mix", "main volume", "parameter", "time slot", "volume slot", "time mix", "volume mix", "eq frequency", "eq gain", "eq q", "eq range", "eq output"] as const;

/** A Pro-Q's controls, as the tool names them. */
const EQ_TOOL_CONTROLS = { "eq frequency": "frequency", "eq gain": "gain", "eq q": "q", "eq range": "range", "eq output": "output" } as const;

/** A Gross Beat's controls, as the tool names them. */
const GROSS_CONTROLS = { "time slot": "timeSlot", "volume slot": "volumeSlot", "time mix": "timeMix", "volume mix": "volumeMix" } as const;

/** A mixer effect's slot, 1 to 10, on a track: the effect there, or an error saying which slots hold one. */
function effectAt(song: MusicProject, input: Input) {
  const track = findTrack(song, input.track);
  const slot = Number.isInteger(input.slot) ? (input.slot as number) - 1 : -1;
  const effect = track.effects[slot];
  if (!effect) {
    const used = track.effects.flatMap((e, i) => (e ? [`${i + 1} (${e.plugin.name})`] : []));
    throw new Error(`${trackLabel(song, track)} has no effect in slot ${String(input.slot)}. ${used.length ? `Its effects are in slots ${used.join(", ")}.` : "It has none."}`);
  }
  return { track, effect };
}

/**
 * The control an input names (`control` and what it belongs to), but a plugin's parameter, whose id only
 * the engine knows: for one, the plugin's owner (`owner`, `id`) and the parameter as named (`parameter`).
 */
export function resolveControl(song: MusicProject, input: Input): AutomationTarget | { owner: "channel" | "effect"; id: string; parameter: string; ownerName: string } {
  const control = input.control;
  switch (control) {
    case "volume":
    case "pan":
    case "stereo": {
      if (input.channel !== undefined && input.channel !== "") {
        if (control === "stereo") throw new Error('A channel has no stereo separation: that\'s a mixer track\'s ("track").');
        return { kind: "channel", channel: findChannel(song, input.channel).id, control };
      }
      if (input.track === undefined) throw new Error(`Say whose ${control}: a "channel" or a mixer "track".`);
      return { kind: "mixer", track: findTrack(song, input.track).id, control };
    }
    case "send": {
      const from = findTrack(song, input.track);
      const to = findTrack(song, input.to);
      if (!from.sends.some((s) => s.to === to.id))
        throw new Error(`${trackLabel(song, from)} doesn't send to ${trackLabel(song, to)}. Its sends go to: ${from.sends.map((s) => trackLabel(song, findTrack(song, s.to))).join(", ") || "nowhere"}. set_send makes one.`);
      return { kind: "send", track: from.id, to: to.id };
    }
    case "mix":
      return { kind: "effect", effect: effectAt(song, input).effect.id };
    case "main volume":
      return { kind: "main" };
    case "time slot":
    case "volume slot":
    case "time mix":
    case "volume mix": {
      const { track, effect } = effectAt(song, input);
      if (!effect.grossBeat) throw new Error(`Slot ${String(input.slot)} of ${trackLabel(song, track)} holds ${effect.plugin.name}, not a Gross Beat: a "${control}" is Gross Beat's.`);
      return { kind: "grossBeat", effect: effect.id, control: GROSS_CONTROLS[control] };
    }
    case "eq frequency":
    case "eq gain":
    case "eq q":
    case "eq range":
    case "eq output": {
      const { track, effect } = effectAt(song, input);
      if (!effect.proQ) throw new Error(`Slot ${String(input.slot)} of ${trackLabel(song, track)} holds ${effect.plugin.name}, not a Pro-Q: an "${control}" is Pro-Q's.`);
      if (control === "eq output") return { kind: "proQ", effect: effect.id, band: 0, control: "output" };
      const band = effect.proQ.bands.find((b) => b.id === Number(input.band));
      if (!band) throw new Error(`Give the Pro-Q's "band" (its number): it has ${effect.proQ.bands.map((b) => b.id).join(", ") || "no bands yet (set_pro_q_bands adds them)"}.`);
      return { kind: "proQ", effect: effect.id, band: band.id, control: EQ_TOOL_CONTROLS[control] };
    }
    case "parameter": {
      if (typeof input.parameter !== "string" || !input.parameter.trim()) throw new Error('"parameter" must be the plugin parameter\'s name or id, from list_controls.');
      if (input.channel !== undefined && input.channel !== "") {
        const channel = findChannel(song, input.channel);
        if (channel.kind !== "plugin") throw new Error(`"${channel.name}" isn't a plugin channel: its controls are its volume and pan.`);
        return { owner: "channel", id: channel.id, parameter: input.parameter.trim(), ownerName: channel.name };
      }
      const { track, effect } = effectAt(song, input);
      return { owner: "effect", id: effect.id, parameter: input.parameter.trim(), ownerName: `${effect.plugin.name} on ${trackLabel(song, track)}` };
    }
    default:
      throw new Error(`"control" must be one of: ${CONTROLS.join(", ")}.`);
  }
}

/** The points an input gives (`at` in bars from the curve's start, values as the control has them), as a curve's. */
function pointsOf(raw: unknown, target: AutomationTarget, song: MusicProject, length: number, range: { min: number; max: number } = { min: 0, max: 1 }): AutomationPoint[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('"points" must be a list of { at, value }: at in bars from the clip\'s start, value as the control has it.');
  const { barTicks } = clipContext(song);
  const info = controlOf(song, target);
  const points = raw.map((item, i) => {
    const p = (item && typeof item === "object" ? item : {}) as Input;
    if (!isFiniteNumber(p.at) || p.at < 0) throw new Error(`Point ${i + 1}: "at" must be bars from the clip's start, 0 or more.`);
    if (!isFiniteNumber(p.value)) throw new Error(`Point ${i + 1}: "value" must be a number (${valueHint(target)}).`);
    if (p.curve !== undefined && !CURVE_TYPES.includes(p.curve as CurveType)) throw new Error(`Point ${i + 1}: "curve" must be one of: ${CURVE_TYPES.join(", ")}.`);
    if (p.tension !== undefined && (!isFiniteNumber(p.tension) || Math.abs(p.tension) > 1)) throw new Error(`Point ${i + 1}: "tension" must be -1 to 1.`);
    // The control's value as a fraction of its range, then of the clip's (its Min / Max). A Gross Beat's
    // slots are numbered from 1 for the model, from 0 inside.
    const slots = target.kind === "grossBeat" && (target.control === "timeSlot" || target.control === "volumeSlot");
    const span = range.max - range.min;
    const fraction = span === 0 ? 0 : (info.fromControl(slots ? p.value - 1 : p.value) - range.min) / span;
    return { tick: Math.round(p.at * barTicks), value: Math.min(1, Math.max(0, fraction)), tension: (p.tension as number | undefined) ?? 0, curve: (p.curve as CurveType | undefined) ?? "single" };
  });
  if (points.some((p) => p.tick > length)) throw new Error(`A point is past the clip's end (${round(length / barTicks)} bars): give a longer "length".`);
  return normalizePoints(points, length);
}

const valueHint = (target: AutomationTarget) =>
  target.kind === "plugin"
    ? "0 to 1 of the parameter's range"
    : target.kind === "grossBeat" && target.control.endsWith("Slot")
      ? "a slot, 1 to 36"
    : target.kind === "proQ"
      ? target.control === "frequency"
        ? "a frequency in Hz, 10 to 30000"
        : target.control === "q"
          ? "a Q, 0.025 to 40"
          : "a level in dB"
    : target.kind === "channel" && target.control === "pan"
      ? "a pan, -1 left to 1 right"
      : target.kind === "mixer" && target.control !== "volume"
        ? "-1 to 1"
        : "0 to 1, as its knob or fader has it";

/**
 * add_automation: an automation clip of a control over `bar` .. `bar + length` (default: the time the
 * song has, four bars at least), flat at the control's value now (`value`: a plugin parameter's, which
 * only the engine knows) or along `points`, on a playlist track below the others (or `track`).
 */
export function addAutomationEdit(song: MusicProject, input: Input, target: AutomationTarget, value?: number): EditResult & { automationId: string } {
  const ctx = clipContext(song);
  const info = controlOf(song, target);
  if (input.bar !== undefined && (!isFiniteNumber(input.bar) || input.bar < 1)) throw new Error('"bar" must be a bar number, 1 or more.');
  if (input.length !== undefined && (!isFiniteNumber(input.length) || input.length <= 0)) throw new Error('"length" must be a number of bars, more than 0.');
  const start = Math.round((((input.bar as number | undefined) ?? 1) - 1) * ctx.barTicks);
  const length = input.length !== undefined ? Math.round((input.length as number) * ctx.barTicks) : Math.max(songTicks(song) - start, ctx.barTicks * 4);
  const playlistTrack = input.playlistTrack;
  if (playlistTrack !== undefined && (!Number.isInteger(playlistTrack) || (playlistTrack as number) < 1 || (playlistTrack as number) > MAX_PLAYLIST_TRACKS))
    throw new Error(`"playlistTrack" must be a playlist track's number, 1 to ${MAX_PLAYLIST_TRACKS}.`);
  const points = input.points !== undefined ? pointsOf(input.points, target, song, length) : null;
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : undefined;
  const made = createAutomation(song, target, { start, length, track: playlistTrack !== undefined ? (playlistTrack as number) - 1 : undefined }, { value, name });
  if (made.song === song) throw new Error(info.exists ? "No more automation clips fit in this song." : `${info.owner} isn't in the song.`);
  const next = points ? editPoints(made.song, made.automationId, () => points) : made.song;
  const automation = next.automations.find((a) => a.id === made.automationId)!;
  return {
    song: next,
    automationId: made.automationId,
    text: `Made the automation clip "${automation.name}" (id ${automation.id}). ${describeAutomation(next, automation)}\nIt plays in song mode only; before it the control is its own value, after it it holds its last value.`,
  };
}

const TOOLS = { flip: flipPoints, normalize: normalizePointLevels, louder: (p: AutomationPoint[]) => scalePoints(p, 1.25), quieter: (p: AutomationPoint[]) => scalePoints(p, 0.8), decimate: decimatePoints, smooth: smoothPoints };
export const AUTOMATION_TOOL_NAMES = Object.keys(TOOLS) as (keyof typeof TOOLS)[];

/** update_automation: rename, recolour, Min / Max, the LFO, the length, the curve (`points`), a Tool, or delete it. */
export function updateAutomationTool(song: MusicProject, input: Input): EditResult {
  const automation = findAutomation(song, input.automation);
  const id = automation.id;
  if (input.remove === true) return { song: removeAutomations(song, new Set([id])), text: `Deleted the automation clip "${automation.name}" and its clips.` };
  const ctx = clipContext(song);
  const fraction = (key: "min" | "max") => {
    const value = input[key];
    if (value === undefined) return undefined;
    if (!isFiniteNumber(value) || value < 0 || value > 1) throw new Error(`"${key}" must be 0 to 1: a fraction of the control's range.`);
    return value;
  };
  let lfo: Partial<Automation["lfo"]> | undefined;
  if (input.lfo !== undefined) {
    if (!input.lfo || typeof input.lfo !== "object") throw new Error('"lfo" must be { enabled, speed, tension, skew, level, multiply }.');
    lfo = {};
    const raw = input.lfo as Input;
    for (const key of ["speed", "tension", "skew", "level"] as const) if (raw[key] !== undefined) {
      if (!isFiniteNumber(raw[key])) throw new Error(`"lfo.${key}" must be a number.`);
      lfo[key] = raw[key];
    }
    for (const key of ["enabled", "multiply"] as const) if (raw[key] !== undefined) lfo[key] = raw[key] === true;
  }
  if (input.length !== undefined && (!isFiniteNumber(input.length) || input.length <= 0)) throw new Error('"length" must be a number of bars, more than 0.');
  let next = updateAutomation(song, id, {
    name: typeof input.name === "string" ? input.name : undefined,
    color: input.color === undefined ? undefined : input.color === "" ? null : String(input.color),
    min: fraction("min"),
    max: fraction("max"),
    length: input.length === undefined ? undefined : Math.round((input.length as number) * ctx.barTicks),
    lfo,
  });
  if (input.points !== undefined) {
    const now = next.automations.find((a) => a.id === id)!;
    const points = pointsOf(input.points, now.target, next, now.length, now);
    next = editPoints(next, id, () => points);
  }
  if (input.tool !== undefined) {
    const tool = TOOLS[input.tool as keyof typeof TOOLS];
    if (!tool) throw new Error(`"tool" must be one of: ${AUTOMATION_TOOL_NAMES.join(", ")}.`);
    next = editPoints(next, id, tool);
  }
  const after = next.automations.find((a) => a.id === id)!;
  return { song: next, text: next === song ? "Nothing changed: it's already like that." : `Now: ${describeAutomation(next, after)}` };
}

/** An automation clip in a few lines, for the model. */
export function describeAutomation(song: MusicProject, automation: Automation): string {
  const ctx = clipContext(song);
  const info = controlOf(song, automation.target);
  const bars = (ticks: number) => round(ticks / ctx.barTicks);
  const drives = info.exists ? `${info.name} of ${info.owner}` : `nothing (what it drove, ${info.owner}, is gone)`;
  const shown = automation.points.slice(0, 48).map((p, i) => {
    const shape = i === 0 ? "" : ` (${CURVE_NAMES[p.curve].toLowerCase()}${p.tension ? `, tension ${round(p.tension)}` : ""})`;
    return `${bars(p.tick)}: ${info.format(automation.min + p.value * (automation.max - automation.min))}${shape}`;
  });
  const more = automation.points.length > shown.length ? `, … ${automation.points.length - shown.length} more` : "";
  const { lfo } = automation;
  const clips = song.playlist.clips.filter((c) => c.kind === "automation" && c.ref === automation.id);
  const lines = [
    `Drives ${drives}. Its curve is ${bars(automation.length)} bars; its points (bars from its start: value): ${shown.join("; ")}${more}.`,
    `Range: ${info.format(automation.min)} to ${info.format(automation.max)}. LFO: ${lfo.enabled && lfo.level ? `on, ${round(lfo.speed)} cycles a bar, level ${round(lfo.level)}, ${lfo.multiply ? "multiplying" : "added"}` : "off"}.${automation.color && automation.color !== AUTOMATION_COLOR ? ` Colour ${automation.color}.` : ""}`,
    clips.length
      ? `Its clips: ${clips.map((c) => `clip ${c.id} on track ${c.track + 1} at bar ${round(c.start / ctx.barTicks + 1)}, ${bars(clipLength(c, ctx))} bars${c.muted ? " (muted)" : ""}`).join("; ")}.`
      : "It has no clips on the playlist (place_clips puts one there).",
  ];
  return lines.join("\n");
}

/** get_automation: every automation clip (or one), for the model. */
export function describeAutomations(song: MusicProject, ref?: unknown): string {
  const header = "Automation clips play in song mode only. Before a control's first clip it's its own value (its knob); after a clip, it holds the clip's last value; where clips of one control overlap, the one that started latest wins.";
  if (ref !== undefined && ref !== "") {
    const automation = findAutomation(song, ref);
    return `${header}\n\n"${automation.name}" (id ${automation.id}):\n${describeAutomation(song, automation)}`;
  }
  if (!song.automations.length) return `${header}\n\nThe song has none yet: add_automation makes one (list_controls says what can be automated).`;
  return [header, ...song.automations.map((a) => `\n"${a.name}" (id ${a.id}):\n${describeAutomation(song, a)}`)].join("\n");
}

/** The default name for a plugin parameter's clip. */
export const parameterClipName = (parameter: string, ownerName: string) => controlName({ name: parameter, owner: ownerName } as Parameters<typeof controlName>[0]);
