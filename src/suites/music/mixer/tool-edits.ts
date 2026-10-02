/**
 * The assistant's mixer edits (`shared/music/tools.ts`): pure `(song, input, env) => { song, text }`,
 * like the rest of `tool-edits.ts`, and what `get_mixer` says. Errors go to the model: they say what
 * exists and what would work.
 */
import { isFiniteNumber } from "@shared/math";
import { keyText } from "@shared/music/auto-tune";
import type { EngineEffects } from "@shared/music/engine";
import { snapped } from "@shared/music/pitch-wheel";
import {
  addMixerTracks,
  canSend,
  channelsOn,
  createGroup,
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
  ungroup,
  updateEffect,
  updateMixerTrack,
  type MixerTrackPatch,
} from "@shared/music/mixer";
import { EFFECT_SLOTS, INPUT_MONITORS, MASTER_TRACK_ID, MAX_INPUT_CHANNELS, MAX_INPUT_OFFSET, MAX_LATENCY_OFFSET, TRACK_COLORS, createMixerTrack } from "@shared/music/project";
import type { InputMonitor, MixerInput, MixerTrack, MusicProject, PitchWheel } from "@shared/music/types";
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

/** A track's input as the tools name it: "1" (mono), "1-2" (a stereo pair), by the device's numbers from 1. */
export const inputText = (input: MixerInput) => (input.stereo ? `${input.channel + 1}-${input.channel + 2}` : `${input.channel + 1}`);

/** An input as the tools give it ("1", "1-2", "none"), or an error saying how to write one. */
export function parseInput(value: unknown): MixerInput | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "none" || text === "") return null;
  const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(text);
  const first = match ? Number(match[1]) : NaN;
  const second = match?.[2] === undefined ? null : Number(match[2]);
  if (!match || first < 1 || first > MAX_INPUT_CHANNELS || (second !== null && second !== first + 1) || (second ?? first) > MAX_INPUT_CHANNELS)
    throw new Error('"input" must be an input\'s number ("1": mono), two next to each other ("1-2": a stereo pair), or "none". list_audio_inputs has the device\'s.');
  return { channel: first - 1, stereo: second !== null };
}

const MONITOR_TEXT: Record<InputMonitor, string> = { off: "never heard", armed: "heard while armed", on: "always heard" };

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
    track.input ? `records input ${inputText(track.input)} (${track.input.stereo ? "stereo" : "mono"}, ${MONITOR_TEXT[track.monitor]})` : null,
    track.inputOffset ? `input offset ${track.inputOffset} ms` : null,
    track.dock !== "middle" && track.id !== MASTER_TRACK_ID ? `docked ${track.dock}` : null,
    track.separator ? "a divider before it" : null,
    track.group ? `in the group "${song.mixer.groups.find((g) => g.id === track.group)?.name ?? track.group}"` : null,
    track.color ? `colour ${COLOR_NAMES[TRACK_COLORS.indexOf(track.color as (typeof TRACK_COLORS)[number])] ?? track.color}` : null,
  ];
  return `${label(song, track)} (id ${track.id}): ${parts.filter(Boolean).join(", ")}`;
}

/** A Pitch Wheel in a few words: the shift it plays, its Timbre, where its notes come from. */
function wheelSummary(song: MusicProject, pw: PitchWheel): string {
  const st = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100) / 100} semitones`;
  const timbre = pw.timbreOn ? (pw.timbre.value ? `, timbre ${st(snapped(pw.timbre.value, pw.timbre.snap))}` : ", formants kept") : ", formants moving with it";
  return `pitch ${st(snapped(pw.pitch.value, pw.pitch.snap))}${timbre}, ${pw.midiMode}${pw.notesFrom ? `, played by "${song.channels.find((c) => c.id === pw.notesFrom)?.name ?? pw.notesFrom}"'s notes` : ""}`;
}

/**
 * The mixer as text (`get_mixer`). `effects` is what the engine says of the effects, when it's known (the
 * song open in the editor), and `armed` the tracks armed to record there.
 */
export function describeMixer(song: MusicProject, effects: EngineEffects | null, armed: readonly string[] = []): string {
  const lines = ["The mixer (a channel plays into its track; a track's sound goes through its effects, its fader and pan, then to the tracks it sends to):"];
  const quiet: number[] = [];
  song.mixer.tracks.forEach((track, number) => {
    if (number > 0 && isUntouched(song, track)) {
      quiet.push(number);
      return;
    }
    lines.push(`- ${describeTrack(song, track)}${armed.includes(track.id) ? ", ARMED to record" : ""}`);
    const channels = channelsOn(song, track.id);
    if (channels.length) lines.push(`    channels: ${channels.map((c) => `"${c.name}"`).join(", ")}`);
    track.effects.forEach((effect, slot) => {
      if (!effect) return;
      const loaded = effects?.loaded.find((e) => e.effect === effect.id);
      const failed = effects?.failed.find((e) => e.effect === effect.id);
      const state = failed ? `couldn't be loaded: ${failed.error}` : effects?.loading.includes(effect.id) ? "loading" : loaded?.latency ? `delays its sound ${loaded.latency} samples` : null;
      const gross =
        (effect.grossBeat && `, effect ${effect.id}, playing time slot ${effect.grossBeat.timeSlot + 1} and volume slot ${effect.grossBeat.volumeSlot + 1} (get_gross_beat)`) ||
        (effect.echoBoy && `, effect ${effect.id}, ${effect.echoBoy.mode} echo, ${effect.echoBoy.custom ? "a custom style" : effect.echoBoy.style}${effect.echoBoy.preset ? `, preset "${effect.echoBoy.preset}"` : ""} (get_echo_boy)`) ||
        (effect.autoTune && `, effect ${effect.id}, ${keyText(effect.autoTune.key, effect.autoTune.scale)}, retune speed ${Math.round(effect.autoTune.retuneSpeed)} ms (get_auto_tune)`) ||
        (effect.proQ && `, effect ${effect.id}, ${effect.proQ.bands.length} band${effect.proQ.bands.length === 1 ? "" : "s"} (get_pro_q)`) ||
        (effect.ott && `, effect ${effect.id}, depth ${percent(effect.ott.depth)}${effect.ott.preset ? `, preset "${effect.ott.preset}"` : ""} (get_ott)`) ||
        (effect.panMan && `, effect ${effect.id}, ${effect.panMan.mode} mode, preset "${effect.panMan.preset}" (get_panman)`) ||
        (effect.pitchWheel && `, effect ${effect.id}, ${wheelSummary(song, effect.pitchWheel)} (get_pitch_wheel)`);
      lines.push(`    slot ${slot + 1}: ${effect.plugin.name} (${effect.plugin.format})${effect.enabled ? "" : ", bypassed"}${effect.mix < 1 ? `, mix ${percent(effect.mix)}` : ""}${state ? `, ${state}` : ""}${gross || ""}`);
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
    (["volume", "pan", "muted", "invert", "swap", "stereo", "latencyOffset", "input", "monitor", "inputOffset"] as const).every((key) => track[key] === fresh[key]) &&
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
  if (typeof input.separator === "boolean") patch.separator = input.separator;
  if (input.input !== undefined) {
    const parsed = parseInput(input.input);
    if (parsed && track.id === MASTER_TRACK_ID) throw new Error("The master can't take an input: it gets the whole song. Give an insert one.");
    patch.input = parsed;
  }
  if (input.monitor !== undefined) {
    if (!INPUT_MONITORS.includes(input.monitor as InputMonitor)) throw new Error(`"monitor" must be one of ${INPUT_MONITORS.join(", ")}.`);
    patch.monitor = input.monitor as InputMonitor;
  }
  const inputOffset = numberIn(input, "inputOffset", -MAX_INPUT_OFFSET, MAX_INPUT_OFFSET);
  if (inputOffset !== undefined) patch.inputOffset = inputOffset;
  if (input.dock !== undefined) {
    if (input.dock !== "left" && input.dock !== "middle" && input.dock !== "right") throw new Error('"dock" must be "left", "middle" or "right".');
    if (track.id === MASTER_TRACK_ID && input.dock !== "left") throw new Error("The master is always docked on the left.");
    patch.dock = input.dock;
  }
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

export const groupMixerTracksTool: SongEdit = (song, input) => {
  if (!Array.isArray(input.tracks) || !input.tracks.length) throw new Error('"tracks" must be a list of mixer tracks (numbers, ids or names).');
  const tracks = input.tracks.map((ref) => findTrack(song, ref));
  const ids = tracks.map((t) => t.id);
  const list = tracks.map((t) => label(song, t)).join(", ");
  if (input.ungroup === true) return { song: ungroup(song, ids), text: `${list} ${tracks.length === 1 ? "is" : "are"} in no group now.` };
  if (ids.includes(MASTER_TRACK_ID)) throw new Error("The master can't be in a group.");
  const next = createGroup(song, ids, typeof input.name === "string" ? input.name : undefined);
  const group = next.mixer.groups[next.mixer.groups.length - 1];
  return { song: next, text: `Grouped ${list} as "${group.name}".` };
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

/** The effect in a track's slot the model named (`track`, `slot` from 1), or why there isn't one. */
export function findEffect(song: MusicProject, input: Input) {
  const track = findTrack(song, input.track);
  return { track, effect: effectIn(song, track, slotOf(input)) };
}
