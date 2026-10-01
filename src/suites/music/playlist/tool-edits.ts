/**
 * The assistant's edits of the playlist (`shared/music/tools.ts`): each a pure `(song, input, env) =>
 * { song, text }`, like the rest of `tool-edits.ts`. Times are bars for the model (1 is the first bar,
 * fractions are part of a bar), ticks inside. Errors say what's wrong and what would work.
 */
import { isFiniteNumber } from "@shared/math";
import {
  type ClipContext,
  type NewClip,
  addClips,
  chopClips,
  clipContext,
  clipLength,
  editClips,
  makeUnique,
  moveClips,
  removeClips,
  resizeClips,
  setClipProps,
  sliceClips,
  soloTrack,
  songTicks,
  splitByChannel,
  trackAt,
  trackName,
  updateTrack,
  deleteTrack,
  insertTrack,
  moveTrack,
} from "@shared/music/playlist";
import { MAX_PLAYLIST_TRACKS } from "@shared/music/project";
import { type Channel, type MusicProject, PPQ, type PlaylistClip, STEP_TICKS } from "@shared/music/types";
import { type EditEnv, type EditResult, findPattern } from "../tool-edits";
import { findAutomation } from "../automation/tool-edits";

type Input = Record<string, unknown>;

const round = (n: number) => Math.round(n * 1000) / 1000;
/** "bar 3", "bar 3.5": a tick as a bar for the model. */
const barOf = (tick: number, ctx: ClipContext) => round(tick / ctx.barTicks + 1);
const barsOf = (ticks: number, ctx: ClipContext) => round(ticks / ctx.barTicks);

function trackIndex(value: unknown, key = "track"): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_PLAYLIST_TRACKS) throw new Error(`"${key}" must be a track's number, 1 to ${MAX_PLAYLIST_TRACKS}.`);
  return (value as number) - 1;
}

function barTick(value: unknown, ctx: ClipContext, key = "bar"): number {
  if (!isFiniteNumber(value) || value < 1) throw new Error(`"${key}" must be a bar number, 1 or more (1 is the song's start; 2.5 is halfway through bar 2).`);
  return Math.round((value - 1) * ctx.barTicks);
}

function barsTicks(value: unknown, ctx: ClipContext, key: string, min = 0): number {
  if (!isFiniteNumber(value) || value < min) throw new Error(`"${key}" must be a number of bars, ${min} or more.`);
  return Math.round(value * ctx.barTicks);
}

/** An audio clip's channel, by id or name. */
function findAudio(song: MusicProject, ref: unknown): Channel {
  const text = typeof ref === "string" ? ref.trim() : "";
  const audio = song.channels.filter((c) => c.kind === "audio");
  const found = audio.find((c) => c.id === text) ?? audio.find((c) => c.name.toLowerCase() === text.toLowerCase());
  if (!found) throw new Error(`There's no audio clip "${text}". ${audio.length ? `The audio clips are: ${audio.map((c) => `"${c.name}"`).join(", ")}.` : "The song has none: add_audio_clip brings a file in."}`);
  return found;
}

function findClips(song: MusicProject, ids: unknown): Set<number> {
  if (!Array.isArray(ids) || !ids.length) throw new Error('"ids" must be a list of clip ids, from get_playlist.');
  const there = new Set(song.playlist.clips.map((c) => c.id));
  const missing = ids.filter((id) => !there.has(id as number));
  if (missing.length) throw new Error(`There's no clip ${missing.join(", ")} on the playlist. Read the clips' ids with get_playlist.`);
  return new Set(ids as number[]);
}

/** A clip in a line, for the model. */
function describeClip(song: MusicProject, clip: PlaylistClip, ctx: ClipContext): string {
  const what =
    clip.kind === "pattern"
      ? `pattern "${song.patterns.find((p) => p.id === clip.ref)?.name ?? clip.ref}"`
      : clip.kind === "automation"
        ? `automation "${song.automations.find((a) => a.id === clip.ref)?.name ?? clip.ref}" (id ${clip.ref})`
        : `audio "${song.channels.find((c) => c.id === clip.ref)?.name ?? clip.ref}"`;
  const length = clipLength(clip, ctx);
  const content = clip.kind === "automation" ? "curve" : "pattern";
  const offset = clip.kind === "audio" ? (clip.offset ? `, from ${round(clip.offset)}s into its file` : "") : clip.offset ? `, from ${barsOf(clip.offset, ctx)} bars into its ${content}` : "";
  const follows = clip.kind !== "audio" && clip.length === null ? ` (its ${content}'s length)` : "";
  return `- clip ${clip.id}: ${what} at bar ${barOf(clip.start, ctx)}, ${barsOf(length, ctx)} bars${follows}${offset}${clip.muted ? ", muted" : ""}`;
}

/** The playlist as text, for the model (`get_playlist`). `mode` is what the editor plays now. */
export function describePlaylist(song: MusicProject, mode: "pattern" | "song" | null): string {
  const ctx = clipContext(song);
  const { clips } = song.playlist;
  const tracks = new Map<number, PlaylistClip[]>();
  for (const clip of clips) tracks.set(clip.track, [...(tracks.get(clip.track) ?? []), clip]);
  // The tracks with clips, and those that have been named, coloured, muted or resized.
  const changed = song.playlist.tracks.flatMap((t, i) => (t.name || t.color || t.muted || t.size !== 1 ? [i] : []));
  const numbers = [...new Set([...tracks.keys(), ...changed])].sort((a, b) => a - b);
  const lines = [
    `Playlist: ${clips.length} clip${clips.length === 1 ? "" : "s"}; the song is ${barsOf(songTicks(song), ctx)} bars long (it goes round at the end of the last clip's bar).` +
      (mode ? ` The editor plays ${mode === "song" ? "the song (song mode)" : "the pattern shown, looped (pattern mode)"}.` : ""),
  ];
  if (!numbers.length) lines.push("Nothing is on it yet: place_clips puts patterns on it, add_audio_clip audio files.");
  for (const index of numbers) {
    const track = trackAt(song, index);
    const notes = [track.muted ? "muted" : null, track.color ? `colour ${track.color}` : null, track.size !== 1 ? `height ${track.size}×` : null].filter(Boolean);
    lines.push("", `Track ${index + 1}${track.name ? ` "${track.name}"` : ""}${notes.length ? ` (${notes.join(", ")})` : ""}:`);
    const on = tracks.get(index) ?? [];
    if (!on.length) lines.push("- (empty)");
    for (const clip of on) lines.push(describeClip(song, clip, ctx));
  }
  const audio = song.channels.filter((c) => c.kind === "audio");
  if (audio.length) lines.push("", `Audio clips (their channels): ${audio.map((c) => `"${c.name}" (id ${c.id})`).join(", ")}.`);
  if (song.automations.length) lines.push("", `Automation clips: ${song.automations.map((a) => `"${a.name}" (id ${a.id})`).join(", ")} (get_automation has their curves; they play in song mode).`);
  return lines.join("\n");
}

/** The playlist in short, for get_song. */
export function playlistSummary(song: MusicProject): string {
  const ctx = clipContext(song);
  const { clips } = song.playlist;
  if (!clips.length) return "Playlist: empty (get_playlist, place_clips).";
  const used = new Set(clips.map((c) => c.track)).size;
  return `Playlist: ${clips.length} clip${clips.length === 1 ? "" : "s"} on ${used} track${used === 1 ? "" : "s"}, ${barsOf(songTicks(song), ctx)} bars (get_playlist has them).`;
}

export function placeClipsTool(song: MusicProject, input: Input, env: EditEnv): EditResult {
  const ctx = clipContext(song);
  if (!Array.isArray(input.clips) || !input.clips.length) throw new Error('"clips" must be a list of clips: { pattern or audio, track, bar }.');
  const placed: NewClip[] = [];
  input.clips.forEach((raw, i) => {
    const clip = (raw && typeof raw === "object" ? raw : {}) as Input;
    const at = `Clip ${i + 1}: `;
    try {
      const hasPattern = clip.pattern !== undefined && clip.pattern !== "";
      const hasAudio = clip.audio !== undefined && clip.audio !== "";
      const hasAutomation = clip.automation !== undefined && clip.automation !== "";
      if (Number(hasPattern) + Number(hasAudio) + Number(hasAutomation) !== 1) throw new Error('give one of "pattern", "audio" or "automation".');
      const track = trackIndex(clip.track);
      const start = barTick(clip.bar, ctx);
      const repeat = clip.repeat === undefined ? 1 : Number.isInteger(clip.repeat) && (clip.repeat as number) >= 1 && (clip.repeat as number) <= 256 ? (clip.repeat as number) : -1;
      if (repeat < 0) throw new Error('"repeat" must be a whole number from 1 to 256.');
      const muted = clip.muted === true;
      if (hasPattern) {
        const pattern = findPattern(song, clip.pattern, env);
        const offset = clip.offset === undefined ? 0 : barsTicks(clip.offset, ctx, "offset");
        const length = clip.length === undefined ? null : barsTicks(clip.length, ctx, "length", 1 / 64);
        const each = length ?? Math.max(1, ctx.patternTicks(pattern.id) - offset);
        for (let n = 0; n < repeat; n++) placed.push({ kind: "pattern", ref: pattern.id, track, start: start + n * each, length, offset, muted });
      } else if (hasAutomation) {
        const automation = findAutomation(song, clip.automation);
        const offset = clip.offset === undefined ? 0 : barsTicks(clip.offset, ctx, "offset");
        const length = clip.length === undefined ? null : barsTicks(clip.length, ctx, "length", 1 / 64);
        const each = length ?? Math.max(1, automation.length - offset);
        for (let n = 0; n < repeat; n++) placed.push({ kind: "automation", ref: automation.id, track, start: start + n * each, length, offset, muted });
      } else {
        const channel = findAudio(song, clip.audio);
        const like = song.playlist.clips.find((c) => c.kind === "audio" && c.ref === channel.id);
        const offset = clip.offset === undefined ? (like?.offset ?? 0) : barsTicks(clip.offset, ctx, "offset") * ctx.fileSecondsPerTick(channel.id);
        const length = clip.length === undefined ? (like ? clipLength(like, ctx) : ctx.barTicks) : barsTicks(clip.length, ctx, "length", 1 / 64);
        for (let n = 0; n < repeat; n++) placed.push({ kind: "audio", ref: channel.id, track, start: start + n * length, length, offset, muted });
      }
    } catch (err) {
      throw new Error(at + (err instanceof Error ? err.message : String(err)));
    }
  });
  const result = addClips(song.playlist.clips, placed);
  if (!result.created.length) throw new Error("The playlist is full: no more clips fit on it.");
  const next = { ...song, playlist: { ...song.playlist, clips: result.clips } };
  const made = result.clips.filter((c) => result.created.includes(c.id));
  return { song: next, text: [`Placed ${made.length} clip${made.length === 1 ? "" : "s"}:`, ...made.map((c) => describeClip(next, c, ctx))].join("\n") };
}

export function updateClipsTool(song: MusicProject, input: Input): EditResult {
  const ctx = clipContext(song);
  const ids = findClips(song, input.ids);
  let next = song;
  if (input.bar !== undefined || input.track !== undefined) {
    if (ids.size !== 1) throw new Error('"bar" and "track" place a single clip: for several, use "move_bars" and "move_tracks".');
    const clip = song.playlist.clips.find((c) => ids.has(c.id))!;
    const ticks = input.bar === undefined ? 0 : barTick(input.bar, ctx) - clip.start;
    const tracks = input.track === undefined ? 0 : trackIndex(input.track) - clip.track;
    next = editClips(next, (clips, c) => moveClips(clips, ids, ticks, tracks, c));
  }
  if (input.move_bars !== undefined || input.move_tracks !== undefined) {
    if (input.move_bars !== undefined && !isFiniteNumber(input.move_bars)) throw new Error('"move_bars" must be a number of bars.');
    if (input.move_tracks !== undefined && !Number.isInteger(input.move_tracks)) throw new Error('"move_tracks" must be a whole number of tracks.');
    const ticks = Math.round(((input.move_bars as number | undefined) ?? 0) * ctx.barTicks);
    next = editClips(next, (clips, c) => moveClips(clips, ids, ticks, (input.move_tracks as number | undefined) ?? 0, c));
  }
  if (input.length !== undefined) {
    const length = barsTicks(input.length, ctx, "length", 1 / 64);
    next = editClips(next, (clips, c) => {
      let list = clips;
      for (const clip of clips.filter((x) => ids.has(x.id))) list = resizeClips(list, new Set([clip.id]), "end", length - clipLength(clip, c), c);
      return list;
    });
  }
  if (input.offset !== undefined) {
    const offset = barsTicks(input.offset, ctx, "offset");
    next = editClips(next, (clips) =>
      clips.map((clip) => {
        if (!ids.has(clip.id)) return clip;
        const value = clip.kind === "audio" ? offset * ctx.fileSecondsPerTick(clip.ref) : offset;
        // Its length stays where it ends now.
        return value === clip.offset ? clip : { ...clip, offset: value, length: clipLength(clip, ctx) };
      }),
    );
  }
  if (typeof input.muted === "boolean") next = editClips(next, (clips) => setClipProps(clips, ids, { muted: input.muted as boolean }));
  const after = clipContext(next);
  const now = next.playlist.clips.filter((c) => ids.has(c.id));
  return { song: next, text: next === song ? "Nothing changed: the clips are already like that." : ["Now:", ...now.map((c) => describeClip(next, c, after))].join("\n") };
}

export function removeClipsTool(song: MusicProject, input: Input, env: EditEnv): EditResult {
  const gone = new Set<number>();
  const { clips } = song.playlist;
  if (input.ids !== undefined) for (const id of findClips(song, input.ids)) gone.add(id);
  if (input.track !== undefined) {
    const track = trackIndex(input.track);
    for (const c of clips) if (c.track === track) gone.add(c.id);
  }
  if (input.pattern !== undefined) {
    const pattern = findPattern(song, input.pattern, env);
    for (const c of clips) if (c.kind === "pattern" && c.ref === pattern.id) gone.add(c.id);
  }
  if (input.audio !== undefined) {
    const channel = findAudio(song, input.audio);
    for (const c of clips) if (c.kind === "audio" && c.ref === channel.id) gone.add(c.id);
  }
  if (input.automation !== undefined) {
    const automation = findAutomation(song, input.automation);
    for (const c of clips) if (c.kind === "automation" && c.ref === automation.id) gone.add(c.id);
  }
  if (input.ids === undefined && input.track === undefined && input.pattern === undefined && input.audio === undefined && input.automation === undefined) {
    throw new Error('Say which clips: "ids", a "track", a "pattern", an "audio" clip or an "automation" clip.');
  }
  const next = editClips(song, (list) => removeClips(list, gone));
  return { song: next, text: gone.size ? `Removed ${gone.size} clip${gone.size === 1 ? "" : "s"}; ${next.playlist.clips.length} left.` : "No clips matched: nothing was removed." };
}

export function sliceClipsTool(song: MusicProject, input: Input): EditResult {
  const ctx = clipContext(song);
  const at = barTick(input.bar, ctx);
  const tracks = Array.isArray(input.tracks) && input.tracks.length ? input.tracks.map((t) => trackIndex(t, "tracks")) : null;
  let clips = song.playlist.clips;
  let made = 0;
  for (const [top, bottom] of tracks ? tracks.map((t) => [t, t]) : [[0, MAX_PLAYLIST_TRACKS - 1]]) {
    const result = sliceClips(clips, at, top, bottom, ctx);
    clips = result.clips;
    made += result.created.length;
  }
  if (!made) return { song, text: `No clip crosses bar ${barOf(at, ctx)}${tracks ? " on those tracks" : ""}: nothing was cut.` };
  return { song: { ...song, playlist: { ...song.playlist, clips } }, text: `Cut ${made} clip${made === 1 ? "" : "s"} at bar ${barOf(at, ctx)}.` };
}

export function chopClipsTool(song: MusicProject, input: Input): EditResult {
  const ctx = clipContext(song);
  const ids = findClips(song, input.ids);
  const every = input.every === "bar" ? ctx.barTicks : input.every === "beat" ? (PPQ * 4) / song.settings.timeSignature[1] : input.every === "step" ? STEP_TICKS : null;
  if (every === null) throw new Error('"every" must be "bar", "beat" or "step".');
  const result = chopClips(song.playlist.clips, ids, every, ctx);
  if (!result.created.length) return { song, text: `No ${input.every} line falls inside those clips: nothing was cut.` };
  return {
    song: { ...song, playlist: { ...song.playlist, clips: result.clips } },
    text: `Chopped ${ids.size} clip${ids.size === 1 ? "" : "s"} into ${ids.size + result.created.length} pieces; the new ones are ${result.created.join(", ")}.`,
  };
}

export function splitByChannelTool(song: MusicProject, input: Input, env: EditEnv): EditResult {
  const pattern = findPattern(song, input.pattern, env);
  const next = splitByChannel(song, pattern.id);
  if (next === song) throw new Error(`"${pattern.name}" has no notes: there's nothing to split.`);
  const parts = next.patterns.filter((p) => !song.patterns.some((q) => q.id === p.id));
  const clips = next.playlist.clips.length - song.playlist.clips.length;
  return {
    song: next,
    text: `Split "${pattern.name}" into ${parts.length} patterns: ${parts.map((p) => `"${p.name}" (id ${p.id})`).join(", ")}.${clips > 0 ? ` Its clips on the playlist became one per channel (${clips} more clips): read get_playlist.` : ""}`,
    showPattern: parts[0]?.id,
  };
}

export function makeClipUniqueTool(song: MusicProject, input: Input): EditResult {
  const id = input.id;
  const clip = song.playlist.clips.find((c) => c.id === id);
  if (!clip) throw new Error(`There's no clip ${String(id)}. Read the clips' ids with get_playlist.`);
  const next = makeUnique(song, clip.id);
  if (clip.kind === "audio") {
    const made = next.channels.find((c) => !song.channels.some((d) => d.id === c.id))!;
    return { song: next, text: `Clip ${clip.id} has an audio clip channel of its own now: "${made.name}" (id ${made.id}), playing the same file; change its pitch or volume with update_channel.` };
  }
  const made = next.patterns.find((p) => !song.patterns.some((q) => q.id === p.id))!;
  return { song: next, text: `Clip ${clip.id} plays a pattern of its own now: "${made.name}" (id ${made.id}).` };
}

export function updatePlaylistTrackTool(song: MusicProject, input: Input): EditResult {
  const index = trackIndex(input.track);
  let next = song;
  if (typeof input.name === "string") next = updateTrack(next, index, { name: input.name });
  if (typeof input.color === "string") {
    if (input.color && !/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error('"color" must be "#rrggbb", or "" for none.');
    next = updateTrack(next, index, { color: input.color || null });
  }
  if (typeof input.muted === "boolean") next = updateTrack(next, index, { muted: input.muted });
  if (input.size !== undefined) {
    if (!isFiniteNumber(input.size) || input.size < 0.25 || input.size > 4) throw new Error('"size" must be from 0.25 to 4.');
    next = updateTrack(next, index, { size: input.size });
  }
  if (input.solo === true) next = soloTrack(next, index);
  let where = index;
  if (input.insert === true) next = insertTrack(next, index);
  if (input.move === "up" || input.move === "down") {
    next = moveTrack(next, index, input.move === "up" ? -1 : 1);
    where = Math.max(0, index + (input.move === "up" ? -1 : 1));
  } else if (input.move !== undefined) throw new Error('"move" must be "up" or "down".');
  if (input.delete === true) {
    next = deleteTrack(next, index);
    return { song: next, text: `Deleted track ${index + 1} and its clips; the tracks below moved up.` };
  }
  if (input.insert === true) return { song: next, text: `Inserted an empty track ${index + 1}; the tracks from there moved down.` };
  const track = trackAt(next, where);
  return {
    song: next,
    text: `Track ${where + 1} is "${trackName(next, where)}"${track.muted ? ", muted" : ""}${track.color ? `, colour ${track.color}` : ""}${track.size !== 1 ? `, height ${track.size}×` : ""}.`,
  };
}
