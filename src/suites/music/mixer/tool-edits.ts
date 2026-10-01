/**
 * The assistant's mixer edits (`shared/music/tools.ts`): pure `(song, input, env) => { song, text }`,
 * like the rest of `tool-edits.ts`, and what `get_mixer` says. Errors go to the model: they say what
 * exists and what would work.
 */
import { isFiniteNumber } from "@shared/math";
import type { EngineEffects } from "@shared/music/engine";
import {
  addMixerTracks,
  canSend,
  channelsOn,
  getMixerTrack,
  isFreeTrack,
  moveEffect,
  moveMixerTracks,
  removeMixerTracks,
  routeChannels,
  routeToFreeTracks,
  sendOnly,
  setEffect,
  setSend,
  soloMixerTrack,
  trackName,
  trackNumber,
  updateEffect,
  updateMixerTrack,
  type MixerTrackPatch,
} from "@shared/music/mixer";
import { EFFECT_SLOTS, MASTER_TRACK_ID, MAX_LATENCY_OFFSET, TRACK_COLORS, createMixerTrack } from "@shared/music/project";
import type { MixerTrack, MusicProject } from "@shared/music/types";
import { type SongEdit, findChannel } from "../tool-edits";
import { faderAt, faderDb } from "./meter";

type Input = Record<string, unknown>;

/** The track colours by name, as the tool's description lists them (`TRACK_COLORS`' order). */
export const COLOR_NAMES = ["red", "orange", "yellow", "lime", "green", "teal", "blue", "indigo", "purple", "pink", "brown", "grey"] as const;

/** A track the model named: its id, its number (0, "M" or "master" for the master), or its name ("Insert 3" too). */
export function findTrack(song: MusicProject, ref: unknown): MixerTrack {
  const text = typeof ref === "number" ? String(ref) : typeof ref === "string" ? ref.trim() : "";
  const lower = text.toLowerCase();
  const tracks = song.mixer.tracks;
  const byNumber = /^\d+$/.test(text) ? tracks[Number(text)] : lower === "m" || lower === "master" ? tracks[0] : undefined;
  const found =
    tracks.find((t) => t.id === text) ??
    byNumber ??
    tracks.find((t, i) => trackName(song, t.id).toLowerCase() === lower || (i > 0 && `insert ${i}` === lower));
  if (found) return found;
  const named = tracks.filter((t) => t.name !== null).map((t) => `"${trackName(song, t.id)}" (${tracks.indexOf(t)})`);
  throw new Error(
    `There's no mixer track "${text}". The mixer has the master (0) and inserts 1 to ${tracks.length - 1}` +
      (named.length ? `; the named ones: ${named.join(", ")}` : "") +
      ". Use a number, an id or a name from get_mixer.",
  );
}

const label = (song: MusicProject, track: MixerTrack) => {
  const number = trackNumber(song, track.id);
  return number === 0 ? "the master" : `insert ${number} ("${trackName(song, track.id)}")`;
};

const numberIn = (input: Input, key: string, min: number, max: number): number | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!isFiniteNumber(value) || value < min || value > max) throw new Error(`"${key}" must be a number from ${min} to ${max}.`);
  return value;
};

function slotOf(input: Input): number {
  const value = input.slot;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > EFFECT_SLOTS) throw new Error(`"slot" must be a slot number from 1 to ${EFFECT_SLOTS}.`);
  return (value as number) - 1;
}

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** A track's own controls, in a line. */
export function describeTrack(song: MusicProject, track: MixerTrack): string {
  const parts = [
    `level ${faderDb(track.volume)}`,
    track.pan ? `pan ${percent(Math.abs(track.pan))} ${track.pan < 0 ? "left" : "right"}` : null,
    track.muted ? "muted" : null,
    track.invert ? "phase inverted" : null,
    track.swap ? "sides swapped" : null,
    track.stereo ? `stereo ${percent(Math.abs(track.stereo))} ${track.stereo > 0 ? "narrower" : "wider"}` : null,
    track.latencyOffset ? `delay offset ${track.latencyOffset} ms` : null,
    track.color ? `colour ${COLOR_NAMES[TRACK_COLORS.indexOf(track.color as (typeof TRACK_COLORS)[number])] ?? track.color}` : null,
  ];
  return `${label(song, track)} (id ${track.id}): ${parts.filter(Boolean).join(", ")}`;
}

/** The mixer as text (`get_mixer`). `effects` is what the engine says of the effects, when it's known (the song open in the editor). */
export function describeMixer(song: MusicProject, effects: EngineEffects | null): string {
  const lines = ["The mixer (a channel plays into its track; a track's sound goes through its effects, its fader and pan, then to the tracks it sends to):"];
  const quiet: number[] = [];
  song.mixer.tracks.forEach((track, number) => {
    if (number > 0 && isUntouched(song, track)) {
      quiet.push(number);
      return;
    }
    lines.push(`- ${describeTrack(song, track)}`);
    const channels = channelsOn(song, track.id);
    if (channels.length) lines.push(`    channels: ${channels.map((c) => `"${c.name}"`).join(", ")}`);
    track.effects.forEach((effect, slot) => {
      if (!effect) return;
      const loaded = effects?.loaded.find((e) => e.effect === effect.id);
      const failed = effects?.failed.find((e) => e.effect === effect.id);
      const state = failed ? `couldn't be loaded: ${failed.error}` : effects?.loading.includes(effect.id) ? "loading" : loaded?.latency ? `delays its sound ${loaded.latency} samples` : null;
      lines.push(`    slot ${slot + 1}: ${effect.plugin.name} (${effect.plugin.format})${effect.enabled ? "" : ", bypassed"}${effect.mix < 1 ? `, mix ${percent(effect.mix)}` : ""}${state ? `, ${state}` : ""}`);
    });
    if (number > 0) {
      const sends = track.sends.map((s) => `${label(song, getMixerTrack(song, s.to)!)}${s.level < 1 ? ` at ${percent(s.level)}` : ""}${s.level === 0 ? " (sidechain only)" : ""}`);
      lines.push(`    sends to: ${sends.length ? sends.join(", ") : "nothing (it isn't heard)"}`);
    }
  });
  if (quiet.length) lines.push(`- Inserts ${ranges(quiet)}: unused (no channels, effects or name; at 0 dB, sending to the master).`);
  return lines.join("\n");
}

/** An insert as it was made: nothing plays into it, no effects, name or colour, its controls as they came, sending to the master. */
function isUntouched(song: MusicProject, track: MixerTrack): boolean {
  const fresh = createMixerTrack(track.id);
  return (
    isFreeTrack(song, track) &&
    track.color === null &&
    (["volume", "pan", "muted", "invert", "swap", "stereo", "latencyOffset"] as const).every((key) => track[key] === fresh[key]) &&
    track.sends.length === 1 &&
    track.sends[0].to === MASTER_TRACK_ID &&
    track.sends[0].level === 1
  );
}

/** "3–5, 8, 10–16". */
function ranges(numbers: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
    out.push(i === j ? `${numbers[i]}` : `${numbers[i]}–${numbers[j]}`);
    i = j;
  }
  return out.join(", ");
}

export const routeChannelsTool: SongEdit = (song, input) => {
  if (!Array.isArray(input.channels) || !input.channels.length) throw new Error('"channels" must be a list of channels (ids or names from get_song).');
  const channels = input.channels.map((ref) => findChannel(song, ref));
  const ids = channels.map((c) => c.id);
  if (typeof input.track === "string" && input.track.trim().toLowerCase() === "free") {
    const next = routeToFreeTracks(song, ids);
    const where = channels.map((c) => {
      const track = getMixerTrack(next, next.channels.find((n) => n.id === c.id)!.mixerTrack)!;
      return `"${c.name}" to ${label(next, track)}`;
    });
    return { song: next, text: `Routed ${where.join(", ")}.` };
  }
  const track = findTrack(song, input.track);
  const next = routeChannels(song, ids, track.id);
  return { song: next, text: `${channels.map((c) => `"${c.name}"`).join(", ")} ${channels.length === 1 ? "plays" : "play"} into ${label(next, track)}.` };
};

export const updateMixerTrackTool: SongEdit = (song, input) => {
  const track = findTrack(song, input.track);
  const patch: MixerTrackPatch = {};
  if (typeof input.name === "string") patch.name = input.name;
  if (input.color !== undefined) {
    const text = typeof input.color === "string" ? input.color.trim().toLowerCase() : "";
    const named = COLOR_NAMES.indexOf(text as (typeof COLOR_NAMES)[number]);
    if (text === "none") patch.color = null;
    else if (named >= 0) patch.color = TRACK_COLORS[named];
    else if (/^#[0-9a-f]{6}$/.test(text)) patch.color = text;
    else throw new Error(`"color" must be one of ${COLOR_NAMES.join(", ")}, a "#rrggbb", or "none".`);
  }
  const level = numberIn(input, "level", -Infinity, 5.8);
  if (level !== undefined) patch.volume = level <= -60 ? 0 : faderAt(level);
  const pan = numberIn(input, "pan", -1, 1);
  if (pan !== undefined) patch.pan = pan;
  for (const key of ["muted", "invert", "swap"] as const) if (typeof input[key] === "boolean") patch[key] = input[key] as boolean;
  const stereo = numberIn(input, "stereo", -1, 1);
  if (stereo !== undefined) patch.stereo = stereo;
  const offset = numberIn(input, "latencyOffset", -MAX_LATENCY_OFFSET, MAX_LATENCY_OFFSET);
  if (offset !== undefined) patch.latencyOffset = offset;
  const next = updateMixerTrack(song, track.id, patch);
  const now = getMixerTrack(next, track.id)!;
  return { song: next, text: next === song ? `${label(song, track)} is already like that.` : `Changed ${describeTrack(next, now)}.` };
};

export const setSendTool: SongEdit = (song, input) => {
  const from = findTrack(song, input.from);
  const to = findTrack(song, input.to);
  const sends = (s: MusicProject) => {
    const sending = getMixerTrack(s, from.id)!.sends;
    return sending.length ? sending.map((x) => `${label(s, getMixerTrack(s, x.to)!)}${x.level < 1 ? ` at ${percent(x.level)}` : ""}`).join(", ") : "nothing (it isn't heard)";
  };
  if (input.remove === true) {
    const next = setSend(song, from.id, to.id, null);
    return { song: next, text: `${label(next, from)} sends to ${sends(next)}.` };
  }
  const level = numberIn(input, "level", 0, 1) ?? from.sends.find((s) => s.to === to.id)?.level ?? 1;
  if (from.id === MASTER_TRACK_ID) throw new Error("The master sends nowhere: it's what's heard. Send other tracks to it.");
  if (!from.sends.some((s) => s.to === to.id) && !canSend(song, from.id, to.id)) {
    throw new Error(`${label(song, from)} can't send to ${label(song, to)}: ${from.id === to.id ? "a track can't send to itself" : `${label(song, to)}'s sound already reaches it, so it would loop`}.`);
  }
  let next = setSend(song, from.id, to.id, level);
  if (input.only === true) next = sendOnly(next, from.id, to.id);
  return { song: next, text: `${label(next, from)} sends to ${sends(next)}.` };
};

export const soloMixerTrackTool: SongEdit = (song, input) => {
  const track = findTrack(song, input.track);
  const next = soloMixerTrack(song, track.id, input.withRouted === true);
  const muted = next.mixer.tracks.filter((t) => t.muted).length;
  return { song: next, text: muted ? `${label(next, track)} is soloed (${muted} other track${muted === 1 ? " is" : "s are"} muted).` : "Nothing is soloed now: every track is unmuted." };
};

export const addMixerTrackTool: SongEdit = (song, input) => {
  const after = input.after === undefined ? null : findTrack(song, input.after).id;
  let next = addMixerTracks(song, after, 1);
  if (next === song) throw new Error("The mixer is full (500 insert tracks).");
  const index = after === null ? next.mixer.tracks.length - 1 : next.mixer.tracks.findIndex((t) => t.id === after) + 1;
  const added = next.mixer.tracks[index];
  if (typeof input.name === "string" && input.name.trim()) next = updateMixerTrack(next, added.id, { name: input.name });
  return { song: next, text: `Added ${label(next, getMixerTrack(next, added.id)!)} (id ${added.id}), sending to the master.` };
};

export const removeMixerTrackTool: SongEdit = (song, input) => {
  const track = findTrack(song, input.track);
  if (track.id === MASTER_TRACK_ID) throw new Error("The master can't be removed.");
  const moved = channelsOn(song, track.id).map((c) => `"${c.name}"`);
  return { song: removeMixerTracks(song, [track.id]), text: `Removed ${label(song, track)}.${moved.length ? ` ${moved.join(", ")} now ${moved.length === 1 ? "plays" : "play"} into the master.` : ""}` };
};

export const moveMixerTrackTool: SongEdit = (song, input) => {
  const track = findTrack(song, input.track);
  if (input.direction !== "left" && input.direction !== "right") throw new Error('"direction" must be "left" or "right".');
  if (track.id === MASTER_TRACK_ID) throw new Error("The master stays first.");
  const next = moveMixerTracks(song, [track.id], input.direction === "left" ? -1 : 1);
  return { song: next, text: next === song ? `${label(song, track)} can't go further ${input.direction}.` : `It's ${label(next, getMixerTrack(next, track.id)!)} now.` };
};

/** The effect in a slot the model named, or why there isn't one. */
function effectIn(song: MusicProject, track: MixerTrack, slot: number) {
  const effect = track.effects[slot];
  if (effect) return effect;
  const used = track.effects.flatMap((e, i) => (e ? [`${i + 1} (${e.plugin.name})`] : []));
  throw new Error(`Slot ${slot + 1} of ${label(song, track)} is empty. ${used.length ? `Its effects are in slots ${used.join(", ")}.` : "It has no effects."}`);
}

export const updateMixerEffectTool: SongEdit = (song, input) => {
  const track = findTrack(song, input.track);
  const slot = slotOf(input);
  const effect = effectIn(song, track, slot);
  const mix = numberIn(input, "mix", 0, 1);
  let next = updateEffect(song, track.id, slot, { ...(typeof input.enabled === "boolean" && { enabled: input.enabled }), ...(mix !== undefined && { mix }) });
  let at = slot;
  if (input.move !== undefined) {
    if (input.move !== "up" && input.move !== "down") throw new Error('"move" must be "up" or "down".');
    const to = slot + (input.move === "up" ? -1 : 1);
    if (to < 0 || to >= EFFECT_SLOTS) throw new Error(`Slot ${slot + 1} is the ${input.move === "up" ? "first" : "last"}: it can't move ${input.move}.`);
    next = moveEffect(next, track.id, slot, input.move === "up" ? -1 : 1);
    at = to;
  }
  const now = getMixerTrack(next, track.id)!.effects[at]!;
  return { song: next, text: `${effect.plugin.name} in slot ${at + 1} of ${label(next, track)}: ${now.enabled ? "on" : "bypassed"}, mix ${percent(now.mix)}.` };
};

export const removeMixerEffectTool: SongEdit = (song, input) => {
  const track = findTrack(song, input.track);
  const slot = slotOf(input);
  const effect = effectIn(song, track, slot);
  return { song: setEffect(song, track.id, slot, null), text: `Removed ${effect.plugin.name} from slot ${slot + 1} of ${label(song, track)}.` };
};

/** The slot an effect goes in: the one asked for, or the track's first empty one. */
export function slotForEffect(song: MusicProject, track: MixerTrack, input: Input): number {
  if (input.slot !== undefined) return slotOf(input);
  const free = track.effects.findIndex((e) => e === null);
  if (free < 0) throw new Error(`${label(song, track)}'s ${EFFECT_SLOTS} slots are full. Give a "slot" to replace one, or use another track (send this one to it).`);
  return free;
}

export { label as trackLabel };
