/**
 * Recording into the song (FL Studio's, `docs/fl-studio/recording.md`): what the engine recorded on an
 * armed mixer track becomes an audio clip, on its own audio clip channel routed back into that track
 * (it was recorded dry, so it's heard through the same effects it was monitored through). Where the
 * clip goes and how the latency is left out are decided here; the engine only says where a take began.
 */
import { createId } from "../ids.ts";
import { addPattern } from "./edits.ts";
import { trackName as mixerTrackName } from "./mixer.ts";
import { type NewNote, addNotes, editNotes } from "./notes.ts";
import { type NewClip, addClips, clipContext, clipEnd, clipLength, updateTracks } from "./playlist.ts";
import { MASTER_TRACK_ID, MAX_PLAYLIST_TRACKS, createAudioChannel, stepsPerBar } from "./project.ts";
import { type MusicProject, type PlaylistClip, STEP_TICKS } from "./types.ts";

/** A take the engine recorded (`EngineTakeEvent`), made the project's media. */
export interface Take {
  /** The mixer track that recorded it. */
  track: string;
  /** Its file (project media) and how long it is, in seconds. */
  sampleId: string;
  seconds: number;
  /** The song's tick at sample `skip` of the file; what's before it is latency, left out. */
  startTick: number;
  skip: number;
  sampleRate: number;
  /** Which pass round the loop it is (0: the first), and whether it's the recording's last. */
  pass: number;
  final: boolean;
}

/** What to do with takes: hear earlier passes of a loop recording (FL's Blend), or mute all but the last. */
export interface TakeOptions {
  blend: boolean;
}

/**
 * Where a take's clip plays, in the song: from `start` (ticks), `offset` seconds into its file, `length`
 * ticks. The file's first `skip` samples are the device's and the song's latency, and the track's input
 * offset (ms) moves it earlier still (or later, when it's negative: then it starts later instead).
 */
export function takeWindow(take: Pick<Take, "startTick" | "skip" | "sampleRate" | "seconds">, inputOffsetMs: number, secondsPerTick: number) {
  const offset = take.skip / take.sampleRate + inputOffsetMs / 1000;
  const late = Math.max(0, -offset);
  const start = Math.max(0, Math.round(take.startTick + late / secondsPerTick));
  const from = Math.max(0, offset);
  return { start, offset: from, length: Math.max(1, Math.round((take.seconds - from) / secondsPerTick)) };
}

/** The playlist track linked to a mixer track (FL's audio track), or -1. */
export function audioTrackOf(song: MusicProject, mixerTrackId: string): number {
  return song.playlist.tracks.findIndex((t) => t.mixerTrack === mixerTrackId);
}

/** Whether `[start, end)` on `track` is free of clips. */
function isFree(clips: readonly PlaylistClip[], track: number, start: number, end: number, ctx: ReturnType<typeof clipContext>): boolean {
  return !clips.some((c) => c.track === track && c.start < end && c.start + clipLength(c, ctx) > start);
}

/**
 * The playlist track a take of `mixerTrackId` from `start`, `length` ticks long, lands on among `clips`:
 * its audio track if it has one, else the first track; then down to the first where it fits that isn't
 * another insert's audio track (`linked`: the inserts that have one).
 */
function takeTrack(song: MusicProject, clips: readonly PlaylistClip[], linked: ReadonlySet<string>, mixerTrackId: string, start: number, length: number): number {
  const ctx = clipContext(song);
  let track = Math.max(0, audioTrackOf(song, mixerTrackId));
  const taken = (t: number) => {
    const other = song.playlist.tracks[t]?.mixerTrack;
    return other !== undefined && other !== null && other !== mixerTrackId && linked.has(other);
  };
  while (track < MAX_PLAYLIST_TRACKS - 1 && (taken(track) || !isFree(clips, track, start, start + length, ctx))) track++;
  return track;
}

/** A take still being recorded: which mixer track, and where it is so far (ticks). */
export interface LiveTake {
  track: string;
  start: number;
  end: number;
}

/**
 * Where takes still being recorded show on the playlist, as they grow: the tracks `addTakes` would put
 * them on if they ended now (each after the others, so two don't share a track).
 */
export function liveTakeTracks(song: MusicProject, takes: readonly LiveTake[]): number[] {
  const linked = new Set(song.playlist.tracks.flatMap((t) => (t.mixerTrack ? [t.mixerTrack] : [])));
  let clips: PlaylistClip[] = song.playlist.clips;
  return takes.map((take) => {
    const length = Math.max(1, Math.round(take.end - take.start));
    const start = Math.max(0, Math.round(take.start));
    const track = takeTrack(song, clips, linked, take.track, start, length);
    clips = addClips(clips, [{ kind: "audio", ref: "@live", track, start, length }]).clips;
    return track;
  });
}

/**
 * Takes as audio clips (FL's Auto-create audio clips): a channel of its own for each, in the rack's
 * Audio group, routed into the mixer track that recorded it, and a clip where it was recorded. The
 * clip goes on the track's audio track if it has one, else on the first playlist track it fits on
 * (FL's); without room there, on the next free one below (never another insert's audio track). With
 * Loop record's takes, each pass goes below the last, and all but the recording's last are muted
 * unless `blend`. Returns the song and the clips' ids.
 */
export function addTakes(
  song: MusicProject,
  takes: readonly Take[],
  options: TakeOptions,
  channelIds: () => string = () => createId("chan"),
): { song: MusicProject; clipIds: number[] } {
  if (!takes.length) return { song, clipIds: [] };
  const ctx = clipContext(song);
  const linked = new Set(song.playlist.tracks.flatMap((t) => (t.mixerTrack ? [t.mixerTrack] : [])));
  let clips = song.playlist.clips;
  const channels = [...song.channels];
  const clipIds: number[] = [];
  for (const take of takes) {
    const mixerTrack = song.mixer.tracks.find((t) => t.id === take.track);
    if (!mixerTrack || mixerTrack.id === MASTER_TRACK_ID) continue;
    const label = mixerTrackName(song, take.track);
    const channel = { ...createAudioChannel(take.pass > 0 ? `${label} take ${take.pass + 1}` : label, take.sampleId, channelIds()), mixerTrack: take.track };
    channels.push(channel);
    const { start, offset, length } = takeWindow(take, mixerTrack.inputOffset, ctx.secondsPerTick);
    const track = takeTrack(song, clips, linked, take.track, start, length);
    const clip: NewClip = { kind: "audio", ref: channel.id, track, start, length, offset, muted: !options.blend && !take.final };
    const added = addClips(clips, [clip]);
    clips = added.clips;
    clipIds.push(...added.created);
  }
  return { song: { ...song, channels, playlist: { ...song.playlist, clips } }, clipIds };
}

/**
 * Link playlist tracks to mixer tracks (FL's Track mode → Audio track → Insert N): the first of
 * `indexes` to `mixerTrackId`, each next one to the next insert along. Null unlinks them. A mixer
 * track has one audio track: one it had before is an ordinary track again.
 */
export function linkAudioTracks(song: MusicProject, indexes: readonly number[], mixerTrackId: string | null): MusicProject {
  const sorted = [...new Set(indexes)].filter((i) => Number.isInteger(i) && i >= 0 && i < MAX_PLAYLIST_TRACKS).sort((a, b) => a - b);
  if (!sorted.length) return song;
  if (mixerTrackId === null) return updateTracks(song, sorted, { mixerTrack: null });
  const inserts = song.mixer.tracks.filter((t) => t.id !== MASTER_TRACK_ID).map((t) => t.id);
  const first = inserts.indexOf(mixerTrackId);
  if (first < 0) return song;
  let next = song;
  sorted.forEach((index, i) => {
    const id = inserts[first + i];
    if (!id) return;
    const before = audioTrackOf(next, id);
    if (before >= 0 && before !== index) next = updateTracks(next, [before], { mixerTrack: null });
    next = updateTracks(next, [index], { mixerTrack: id });
  });
  return next;
}

/**
 * FL's Assign to new audio track(s) (the mixer track's menu): each mixer track without an audio track
 * gets one, the first empty playlist tracks below everything in use, named after it.
 */
export function assignAudioTracks(song: MusicProject, mixerTrackIds: readonly string[]): MusicProject {
  const wanted = mixerTrackIds.filter((id, i) => id !== MASTER_TRACK_ID && mixerTrackIds.indexOf(id) === i && song.mixer.tracks.some((t) => t.id === id) && audioTrackOf(song, id) < 0);
  if (!wanted.length) return song;
  const used = (i: number) => {
    const track = song.playlist.tracks[i];
    return song.playlist.clips.some((c) => c.track === i) || (track !== undefined && (track.name !== null || track.mixerTrack !== null));
  };
  let last = -1;
  for (let i = 0; i < Math.max(song.playlist.tracks.length, 1 + song.playlist.clips.reduce((m, c) => Math.max(m, c.track), -1)); i++) if (used(i)) last = i;
  let next = song;
  wanted.forEach((id, i) => {
    const index = last + 1 + i;
    if (index >= MAX_PLAYLIST_TRACKS) return;
    const named = song.mixer.tracks.find((t) => t.id === id)?.name ?? null;
    next = updateTracks(next, [index], { mixerTrack: id, name: named ?? mixerTrackName(song, id) });
  });
  return next;
}

// ---------------------------------------------------------------------------
// Recording notes (`docs/fl-studio/midi.md`)
// ---------------------------------------------------------------------------

/** A key pressed or let go while recording, as the engine told it (`MidiPlayed`, while playing). */
export interface PlayedEvent {
  channel: string;
  key: number;
  velocity: number;
  on: boolean;
  /** The engine's tick: into the loop (or past its end, recording without Loop record). */
  tick: number;
  /** In the count-in: the transport held where play starts. */
  counting: boolean;
  /** Times round the loop since play started. */
  pass: number;
}

/** A note recorded: on a channel, in the song's ticks. */
export interface RecordedNote {
  channel: string;
  pitch: number;
  velocity: number;
  start: number;
  length: number;
}

/**
 * How recorded notes are quantized (FL's, Record's right-click menu, on the Piano roll's snap): not
 * at all, their starts, their ends, both, or their starts with their lengths kept (the note moved).
 */
export const NOTE_QUANTIZE = ["none", "start", "end", "both", "startKeepLength"] as const;
export type NoteQuantize = (typeof NOTE_QUANTIZE)[number];
export const isNoteQuantize = (value: unknown): value is NoteQuantize => NOTE_QUANTIZE.includes(value as NoteQuantize);

export interface RecordedNotesOptions {
  /** The loop's start in the song (the engine's ticks count from it) and its length. */
  loopStart: number;
  loopTicks: number;
  /** Recording without Loop record: play went on past the loop's end, never round it. */
  through: boolean;
  /** Where recording started, in the song's ticks: notes played in the count-in land there. */
  startTick: number;
  /** How late what was heard came out (the output's latency, in ticks): what was played along to it is moved back by as much. */
  latencyTicks: number;
  /** Where play stopped (engine's tick and pass): notes still held end there. Unknown: a step long. */
  stop?: { tick: number; pass: number } | null;
  quantize: NoteQuantize;
  /** The grid quantizing uses, in ticks (below 1: none). */
  grid: number;
}

/**
 * What was played while recording, as notes in the song: each key from where it went down to where it
 * was let go (or play stopped), moved back by the latency (a pass's first notes played late land at the
 * end of the loop instead), each loop pass on top of the others, then quantized.
 */
export function recordedNotes(events: readonly PlayedEvent[], options: RecordedNotesOptions): RecordedNote[] {
  const { loopStart, loopTicks, latencyTicks, grid } = options;
  const loopEnd = loopStart + loopTicks;
  // Where each event is along the whole recording, round the loop as many times as it went.
  const along = (e: Pick<PlayedEvent, "tick" | "pass">) => e.pass * loopTicks + e.tick;
  const held = new Map<string, PlayedEvent>();
  const notes: RecordedNote[] = [];
  const close = (on: PlayedEvent, endAlong: number | null) => {
    // Played in the count-in: from where recording starts.
    const from = on.counting ? { tick: options.startTick - loopStart, pass: on.pass } : on;
    let start = loopStart + from.tick - (on.counting ? 0 : latencyTicks);
    // A pass's first notes, played a little late: the end of the loop they were played along to.
    if (!on.counting && !options.through && on.pass > 0 && start < loopStart) start += loopTicks;
    start = Math.max(0, Math.round(start));
    let length = endAlong === null ? STEP_TICKS : Math.round(endAlong - along(from));
    // A note held round the loop ends at its end (the next pass plays over it).
    if (!options.through) length = Math.min(length, loopEnd - start);
    notes.push({ channel: on.channel, pitch: on.key, velocity: on.velocity, start, length: Math.max(1, length) });
  };
  for (const event of events) {
    const id = `${event.channel}:${event.key}`;
    const open = held.get(id);
    if (event.on) {
      // The same key again before it was let go: the first ends here.
      if (open) close(open, along(event));
      held.set(id, event);
    } else if (open) {
      held.delete(id);
      close(open, along(event));
    }
  }
  for (const open of held.values()) close(open, options.stop ? along(options.stop) : null);
  const quantized = options.quantize === "none" || !(grid >= 1) ? notes : notes.map((note) => quantizeRecorded(note, options.quantize, grid));
  return quantized.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** A recorded note quantized as Record's menu says. */
function quantizeRecorded(note: RecordedNote, mode: NoteQuantize, grid: number): RecordedNote {
  const snap = (tick: number) => Math.round(tick / grid) * grid;
  const end = note.start + note.length;
  let start = note.start;
  let to = end;
  if (mode === "start" || mode === "both" || mode === "startKeepLength") start = Math.max(0, snap(note.start));
  if (mode === "startKeepLength") to = start + note.length;
  if (mode === "end" || mode === "both") to = snap(end);
  return { ...note, start, length: to > start ? to - start : grid };
}

/**
 * Recorded notes into the song (FL's song mode recording): into a clip of the selected pattern
 * already playing where recording started, if there is one; else into the selected pattern if it isn't
 * on the playlist yet, or a new pattern if it is (so recording never changes clips already placed),
 * with a clip of it from the bar recording started in, on the first track it fits on. Returns the song,
 * the pattern the notes went into, and the clip made (or null).
 */
export function addRecordedNotes(
  song: MusicProject,
  notes: readonly RecordedNote[],
  at: { patternId: string; startTick: number },
  newPatternId: () => string = () => createId("pat"),
): { song: MusicProject; patternId: string | null; clipId: number | null } {
  const played = notes.filter((n) => song.channels.some((c) => c.id === n.channel));
  if (!played.length) return { song, patternId: null, clipId: null };
  const ctx = clipContext(song);
  const bar = stepsPerBar(song.settings.timeSignature) * STEP_TICKS;
  const into = song.playlist.clips.find((c) => c.kind === "pattern" && c.ref === at.patternId && c.start <= at.startTick && clipEnd(c, ctx) > at.startTick);
  let patternId = at.patternId;
  let base: number;
  let next = song;
  if (into) base = into.start - into.offset;
  else {
    base = Math.floor(Math.max(0, Math.min(at.startTick, ...played.map((n) => n.start))) / bar) * bar;
    const placed = song.playlist.clips.some((c) => c.kind === "pattern" && c.ref === patternId) || !song.patterns.some((p) => p.id === patternId);
    if (placed) {
      patternId = newPatternId();
      next = addPattern(next, { id: patternId });
    }
  }
  // Each channel's notes, from the clip's content start.
  for (const channel of new Set(played.map((n) => n.channel))) {
    const added: NewNote[] = played
      .filter((n) => n.channel === channel && n.start >= base)
      .map((n) => ({ start: n.start - base, length: n.length, pitch: n.pitch, velocity: n.velocity }));
    next = editNotes(next, patternId, channel, (list) => addNotes(list, added).notes);
  }
  if (into) return { song: next, patternId, clipId: null };
  // Its clip, as long as the pattern now is, on the first track it fits on.
  const length = clipLength({ id: 0, kind: "pattern", ref: patternId, track: 0, start: base, length: null, offset: 0, muted: false }, clipContext(next));
  let track = 0;
  while (track < MAX_PLAYLIST_TRACKS - 1 && !isFree(next.playlist.clips, track, base, base + length, clipContext(next))) track++;
  const { clips, created } = addClips(next.playlist.clips, [{ kind: "pattern", ref: patternId, track, start: base }]);
  return { song: { ...next, playlist: { ...next.playlist, clips } }, patternId, clipId: created[0] ?? null };
}
