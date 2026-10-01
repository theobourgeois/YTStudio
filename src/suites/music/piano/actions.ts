/**
 * What the Piano roll's keys, menus and drags do (`docs/fl-studio/piano-roll.md`): each reads the
 * stores and makes one edit of the open channel's notes, with the operations of `shared/music/notes.ts`.
 * As in FL Studio, a command acts on the selected notes, or on all of them when none are selected.
 */
import { clamp } from "@shared/math";
import { DEFAULT_CHOP_PATTERN, chopPattern, chopPieces, chopToPattern } from "@shared/music/chop";
import { lengthOf } from "@shared/music/edits";
import {
  type Created,
  chopNotes,
  copyNotes,
  discardLengths,
  duplicateNotes,
  editNotes,
  glueNotes,
  legatoNotes,
  moveNotes,
  noteBounds,
  notesInTime,
  orAll,
  pasteNotes,
  quantizeNotes,
  removeNotes,
  rotateNotes,
  setNoteProps,
} from "@shared/music/notes";
import { stepsPerBar } from "@shared/music/project";
import { type Channel, type MusicProject, type Note, PPQ, type Pattern, STEP_TICKS } from "@shared/music/types";
import { currentPattern, useMusic } from "../store";
import { patternPositionNow } from "../playhead";
import { useTransport } from "../transport";
import { useMusicUi, useMusicWindows } from "../ui";
import { applyDrag, rectSelection } from "./drag";
import { fadeOut } from "./fades";
import { MAX_PX_PER_TICK, MIN_PX_PER_TICK, snapTicks, zoomAt, zoomToRange } from "./geometry";
import { type ChopperSettings, type PianoTool, usePiano } from "./store";

const EMPTY: Note[] = [];

export interface PianoContext {
  song: MusicProject;
  pattern: Pattern;
  channel: Channel;
  notes: Note[];
  /** A bar and a beat of the song, in ticks. */
  barTicks: number;
  beatTicks: number;
  /** The snap's grid, in ticks. */
  grid: number;
  /** The selected notes that are still there (an undo may have taken some away). */
  selected: Set<number>;
  /** How long the pattern is, in ticks. */
  patternTicks: number;
}

/**
 * The channel the Piano roll shows: the one chosen, else the rack's selected one, else the first. Never an
 * audio clip's channel: it plays from the playlist, not from notes.
 */
export function pianoChannel(song: MusicProject, channelId: string | null, rackSelection: readonly string[]): Channel | null {
  const playable = (c: Channel) => c.kind !== "audio";
  return song.channels.find((c) => c.id === channelId && playable(c)) ?? song.channels.find((c) => rackSelection.includes(c.id) && playable(c)) ?? song.channels.find(playable) ?? null;
}

/** Everything a command needs, as things are now; null with no song or no channel. */
export function pianoContext(): PianoContext | null {
  const { history, patternId } = useMusic.getState();
  if (!history) return null;
  const song = history.doc;
  const piano = usePiano.getState();
  const channel = pianoChannel(song, piano.channelId, useMusicUi.getState().selectedChannelIds);
  if (!channel) return null;
  const pattern = currentPattern(song, patternId);
  const notes = pattern.notes[channel.id] ?? EMPTY;
  const [, unit] = song.settings.timeSignature;
  const barTicks = stepsPerBar(song.settings.timeSignature) * STEP_TICKS;
  const beatTicks = (PPQ * 4) / unit;
  const there = new Set(notes.map((n) => n.id));
  return {
    song,
    pattern,
    channel,
    notes,
    barTicks,
    beatTicks,
    grid: snapTicks(piano.snap, piano.view.pxPerTick, barTicks, beatTicks),
    selected: new Set([...piano.selected].filter((id) => there.has(id))),
    patternTicks: lengthOf(song, pattern) * STEP_TICKS,
  };
}

/** Make an edit of the channel's notes (one undo step). */
function edit(ctx: PianoContext, update: (notes: Note[]) => Note[]) {
  useMusic.getState().commit((song) => editNotes(song, ctx.pattern.id, ctx.channel.id, update));
}

/** Make an edit that adds notes, and select the ones it made. */
function editCreating(ctx: PianoContext, change: (notes: Note[]) => Created): number[] {
  const result = change(ctx.notes);
  if (result.notes === ctx.notes) return [];
  // The edit is worked out on the notes as they are now, which is what `commit` will be given too.
  edit(ctx, () => result.notes);
  usePiano.getState().select(result.created);
  return result.created;
}

/** Finish the drag in progress: its edit is made (one undo step), or its rectangle becomes the selection. */
export function commitDrag() {
  const piano = usePiano.getState();
  const { drag } = piano;
  const ctx = pianoContext();
  usePiano.setState({ drag: null });
  if (!drag || !ctx) return;
  if (drag.kind === "rect") return piano.select(rectSelection(ctx.notes, drag, ctx.selected));
  if (drag.kind === "playback") return;
  const result = applyDrag(ctx.notes, drag);
  if (result.notes === ctx.notes) return;
  edit(ctx, () => result.notes);
  // Copies take the selection with them; so do the halves a slice made of selected notes.
  if (drag.kind === "move" && drag.clone) piano.select(result.created);
  if (drag.kind === "erase") piano.select([...ctx.selected].filter((id) => !drag.ids.has(id)));
}

export const cancelDrag = () => usePiano.setState({ drag: null });

// ---------------------------------------------------------------------------
// Selecting
// ---------------------------------------------------------------------------

export function selectAll() {
  const ctx = pianoContext();
  if (ctx) usePiano.getState().select(ctx.notes.map((n) => n.id));
}

/** Deselect: the notes, and the time selection with them. */
export const deselect = () => usePiano.setState({ selected: new Set(), time: null });

export function invertSelection() {
  const ctx = pianoContext();
  if (ctx) usePiano.getState().select(ctx.notes.filter((n) => !ctx.selected.has(n.id)).map((n) => n.id));
}

/** Select a range of time (the red range on the ruler) and the notes that start in it. */
export function selectTime(start: number, end: number) {
  const ctx = pianoContext();
  if (!ctx) return;
  const range = { start: Math.max(0, Math.min(start, end)), end: Math.max(start, end) };
  if (range.end <= range.start) return usePiano.setState({ time: null });
  usePiano.setState({ time: range, selected: new Set(notesInTime(ctx.notes, range.start, range.end)) });
}

/** Ctrl+Enter: the time selection becomes the bars the selected notes span. */
export function selectTimeAroundNotes() {
  const ctx = pianoContext();
  const bounds = ctx && noteBounds(ctx.notes, orAll(ctx.notes, ctx.selected));
  if (!ctx || !bounds) return;
  usePiano.setState({ time: { start: bounds.start, end: bounds.end } });
}

/** Ctrl+← / →: the time selection moves by its own length, taking the selection to the notes there. */
export function shiftTime(direction: -1 | 1) {
  const { time } = usePiano.getState();
  if (!time) return;
  const by = (time.end - time.start) * direction;
  if (time.start + by < 0) return;
  selectTime(time.start + by, time.end + by);
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export function deleteSelected() {
  const ctx = pianoContext();
  if (!ctx?.selected.size) return;
  fadeOut(ctx.notes.filter((n) => ctx.selected.has(n.id)), ctx.selected);
  edit(ctx, (notes) => removeNotes(notes, ctx.selected));
  usePiano.getState().select([]);
}

export function copy() {
  const ctx = pianoContext();
  if (ctx?.selected.size) usePiano.setState({ copied: copyNotes(ctx.notes, ctx.selected) });
}

export function cut() {
  copy();
  deleteSelected();
}

/** Paste at the first bar in view, as FL Studio does; what's pasted is selected. */
export function paste() {
  const ctx = pianoContext();
  const { copied, view } = usePiano.getState();
  if (!ctx || !copied?.length) return;
  const at = Math.ceil(view.scrollTick / ctx.barTicks - 1e-9) * ctx.barTicks;
  editCreating(ctx, (notes) => pasteNotes(notes, copied, at));
}

/**
 * Ctrl+B: duplicate to the right. The copies are selected, and the time selection (which sets how far
 * they go, when there is one) moves along with them: pressing it again adds another repeat.
 */
export function duplicate() {
  const ctx = pianoContext();
  if (!ctx) return;
  const { time } = usePiano.getState();
  const result = duplicateNotes(ctx.notes, ctx.selected, ctx.grid, time ? time.end - time.start : undefined);
  if (!result.created.length) return;
  edit(ctx, () => result.notes);
  usePiano.setState({ selected: new Set(result.created), time: time && { start: time.start + result.interval, end: time.end + result.interval } });
}

/** Shift+arrows: a snap unit left or right, a semitone up or down. Alt+arrows: a tick. Ctrl+↑/↓: an octave. */
export function nudge(ticks: number, semitones: number) {
  const ctx = pianoContext();
  if (ctx) edit(ctx, (notes) => moveNotes(notes, orAll(notes, ctx.selected), ticks, semitones));
}
export const nudgeBySnap = (direction: -1 | 1) => {
  const ctx = pianoContext();
  if (ctx) nudge(direction * ctx.grid, 0);
};

export function rotate(direction: -1 | 1) {
  const ctx = pianoContext();
  if (ctx) edit(ctx, (notes) => rotateNotes(notes, ctx.selected, direction * ctx.grid, ctx.patternTicks));
}

export function glue() {
  const ctx = pianoContext();
  if (ctx) edit(ctx, (notes) => glueNotes(notes, ctx.selected));
}

export function chop() {
  const ctx = pianoContext();
  if (ctx) editCreating(ctx, (notes) => chopNotes(notes, ctx.selected, ctx.grid));
}

/**
 * What the Chopper (Alt+U) would make of the notes now, with its settings: the selection, or every note,
 * cut to its pattern (Default: the snap). Null when the pattern can't be that fast at this snap.
 */
export function chopperResult(ctx: PianoContext, settings: ChopperSettings): Created | null {
  const pattern = chopPattern(settings.patternId) ?? DEFAULT_CHOP_PATTERN;
  const pieces = chopPieces(pattern, settings.timeMul, ctx.grid);
  if (!pieces) return null;
  return chopToPattern(ctx.notes, ctx.selected, { pieces, absolute: settings.absolute, velocity: settings.velocity, pan: settings.pan });
}

/**
 * The song as the engine should play it while the Chopper is open: with its chop, so what's shown is
 * heard before it's accepted. The song itself is unchanged until then.
 */
export function withChopPreview(song: MusicProject): MusicProject {
  const piano = usePiano.getState();
  if (!piano.chopping) return song;
  const ctx = pianoContext();
  const result = ctx && chopperResult(ctx, piano.chopper);
  if (!ctx || !result || result.notes === ctx.notes) return song;
  return editNotes(song, ctx.pattern.id, ctx.channel.id, () => result.notes);
}

/** Alt+U: the Chopper's window, in front. The Piano roll shows the notes chopped while it's open. */
export function openChopper() {
  usePiano.setState({ chopping: true });
  useMusicWindows.getState().focus("chopper");
}

/** The Chopper's Accept: its chop becomes an edit (one undo step), and the pieces are selected. */
export function acceptChop() {
  const ctx = pianoContext();
  usePiano.setState({ chopping: false });
  if (!ctx) return;
  const result = chopperResult(ctx, usePiano.getState().chopper);
  if (result) editCreating(ctx, () => result);
}

/** Quick quantize: to the snap's grid (a step, when snap is off). */
export function quantize(mode: "both" | "starts") {
  const ctx = pianoContext();
  if (ctx) edit(ctx, (notes) => quantizeNotes(notes, ctx.selected, ctx.grid > 1 ? ctx.grid : STEP_TICKS, mode));
}

export function legato() {
  const ctx = pianoContext();
  if (ctx) edit(ctx, (notes) => legatoNotes(notes, ctx.selected));
}

export function discard() {
  const ctx = pianoContext();
  if (ctx) edit(ctx, (notes) => discardLengths(notes, ctx.selected, ctx.grid));
}

export function setMuted(muted: boolean) {
  const ctx = pianoContext();
  if (ctx) edit(ctx, (notes) => setNoteProps(notes, orAll(notes, ctx.selected), { muted }));
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export const setTool = (tool: PianoTool) => usePiano.getState().setTool(tool);

/** Open the Piano roll on a channel (the rack's button, its menu, F7). */
export function openPianoRoll(channelId?: string) {
  if (channelId) usePiano.getState().setChannel(channelId);
  useMusicUi.getState().setPianoOpen(true);
}

/**
 * G / K: the channel above / below in the rack; H / J: the next one that has notes in this pattern.
 */
export function stepChannel(direction: -1 | 1, withNotes: boolean) {
  const ctx = pianoContext();
  if (!ctx) return;
  const { channels } = ctx.song;
  for (let i = channels.indexOf(ctx.channel) + direction; i >= 0 && i < channels.length; i += direction) {
    if (channels[i].kind === "audio") continue;
    if (!withNotes || ctx.pattern.notes[channels[i].id]?.length) return usePiano.getState().setChannel(channels[i].id);
  }
}

/** Page Up / Down: zoom about the middle of the grid. */
export function zoomBy(factor: number) {
  const { view, gridWidth, setView } = usePiano.getState();
  setView(zoomAt(view, gridWidth / 2, clamp(view.pxPerTick * factor, MIN_PX_PER_TICK, MAX_PX_PER_TICK)));
}

/** Shift+1…3: one, four and sixteen bars across. Shift+4: everything. Shift+5: the time selection. */
export function zoomPreset(preset: 1 | 2 | 3 | 4 | 5) {
  const ctx = pianoContext();
  const { view, gridWidth, time, setView } = usePiano.getState();
  if (!ctx) return;
  if (preset === 5) return time ? setView(zoomToRange(view, time.start, time.end, gridWidth)) : undefined;
  if (preset === 4) return setView(zoomToRange(view, 0, Math.max(ctx.patternTicks, noteBounds(ctx.notes)?.end ?? 0), gridWidth));
  const bars = [1, 4, 16][preset - 1];
  const from = Math.floor(view.scrollTick / ctx.barTicks) * ctx.barTicks;
  setView(zoomToRange(view, from, from + bars * ctx.barTicks, gridWidth));
}

/** Shift+0: scroll so the playhead (or where play starts) is in the middle. */
export function centreOnPlayhead() {
  const ctx = pianoContext();
  const { view, gridWidth, setView } = usePiano.getState();
  if (!ctx) return;
  const transport = useTransport.getState();
  const tick = patternPositionNow() ?? transport.startTick;
  setView({ ...view, scrollTick: Math.max(0, tick - gridWidth / view.pxPerTick / 2) });
}

export const toggleLane = () => usePiano.setState({ laneHeight: usePiano.getState().laneHeight ? 0 : usePiano.getState().laneSize });
export const toggleGhosts = () => usePiano.setState({ ghosts: !usePiano.getState().ghosts });
export const nextLane = () => usePiano.setState({ lane: usePiano.getState().lane === "velocity" ? "pan" : "velocity" });
