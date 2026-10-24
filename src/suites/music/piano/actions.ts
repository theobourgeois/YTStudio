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
  HIGHEST_PITCH,
  LOWEST_PITCH,
  type NewNote,
  addNotes,
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
  quantizeWith,
  removeNotes,
  resizeNotes,
  rotateNotes,
  setNoteProps,
  setNoteValues,
} from "@shared/music/notes";
import type { MidiPlayed } from "@shared/music/engine";
import { snapToScale, stampPitches } from "@shared/music/scales";
import { stepsPerBar } from "@shared/music/project";
import { type Channel, type MusicProject, type Note, PPQ, type Pattern, STEP_TICKS } from "@shared/music/types";
import { currentPattern, useMusic } from "../store";
import { patternPositionNow } from "../playhead";
import { useTransport } from "../transport";
import { selectedIn, useMusicUi, useMusicWindows } from "../ui";
import { applyDrag, rectSelection } from "./drag";
import { type PianoCursor, cursorAlong, cursorUpDown, noteAtCursor, noteBeside, startingCursor, viewShowing } from "./cursor";
import { fadeOut } from "./fades";
import { MAX_PX_PER_TICK, MIN_PX_PER_TICK, snapTicks, zoomAt, zoomToRange } from "./geometry";
import { type ChopperSettings, type PianoTool, type QuantizerSettings, usePiano } from "./store";

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
 * The channel the Piano roll shows: the one chosen, else the rack's selected one, else the first. An audio
 * clip's channel too, as in FL Studio: its file plays from notes as a sampler's does.
 */
export function pianoChannel(song: MusicProject, channelId: string | null, rackSelection: readonly string[]): Channel | null {
  return song.channels.find((c) => c.id === channelId) ?? song.channels.find((c) => rackSelection.includes(c.id)) ?? song.channels[0] ?? null;
}

/** The selected notes still there, worked out again only when the notes or the selection change (the pointer asks on every move). */
let selectedCache: { notes: readonly Note[]; selected: ReadonlySet<number>; result: Set<number> } | null = null;
function liveSelection(notes: readonly Note[], selected: ReadonlySet<number>): Set<number> {
  if (selectedCache?.notes === notes && selectedCache.selected === selected) return selectedCache.result;
  const there = new Set(notes.map((n) => n.id));
  const result = new Set([...selected].filter((id) => there.has(id)));
  selectedCache = { notes, selected, result };
  return result;
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
  return {
    song,
    pattern,
    channel,
    notes,
    barTicks,
    beatTicks,
    grid: snapTicks(piano.snap, piano.view.pxPerTick, barTicks, beatTicks),
    selected: liveSelection(notes, piano.selected),
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

/**
 * The song with the drag in progress applied, for the engine: a note drawn while the song plays is
 * heard as soon as it's pressed (FL's), not only once it's let go; the document still gets one edit.
 */
export function withDragPreview(song: MusicProject): MusicProject {
  const { drag } = usePiano.getState();
  if (!drag) return song;
  const ctx = pianoContext();
  if (!ctx) return song;
  const result = applyDrag(ctx.notes, drag);
  return result.notes === ctx.notes ? song : editNotes(song, ctx.pattern.id, ctx.channel.id, () => result.notes);
}

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
  if (!ctx) return;
  // Nothing selected, the keyboard's cursor on a note: that note.
  const { cursor } = usePiano.getState();
  const under = !ctx.selected.size && cursor ? noteAtCursor(ctx.notes, cursor) : null;
  if (under) {
    fadeOut([under], new Set([under.id]));
    return edit(ctx, (notes) => removeNotes(notes, new Set([under.id])));
  }
  if (!ctx.selected.size) return;
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
  if (!ctx) return;
  const { cursor } = usePiano.getState();
  const carried = cursor && noteAtCursor(ctx.notes, cursor);
  edit(ctx, (notes) => moveNotes(notes, orAll(notes, ctx.selected), ticks, semitones));
  // The cursor on a note that moved goes with it, as a text editor's caret stays in the word it's in.
  const moved = carried && pianoContext()?.notes.find((n) => n.id === carried.id);
  if (cursor && carried && moved && (moved.start !== carried.start || moved.pitch !== carried.pitch)) {
    placeCursor({ tick: cursor.tick + moved.start - carried.start, pitch: moved.pitch });
  }
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

/** The Quantizer's grid: its own snap, or (Line, Cell, none) the Piano roll's, else a step. */
function quantizerGrid(ctx: PianoContext, settings: QuantizerSettings): number {
  const own = settings.snap === "line" || settings.snap === "cell" || settings.snap === "none" ? 0 : snapTicks(settings.snap, usePiano.getState().view.pxPerTick, ctx.barTicks, ctx.beatTicks);
  return own > 1 ? own : ctx.grid > 1 ? ctx.grid : STEP_TICKS;
}

/** What the Quantizer (Alt+Q) would make of the notes now: the selection, or every note. */
export function quantizerResult(ctx: PianoContext, settings: QuantizerSettings): Note[] {
  return quantizeWith(ctx.notes, ctx.selected, { ...settings, grid: quantizerGrid(ctx, settings) });
}

/** The song as the engine should play it while the Quantizer is open: quantized, so what's shown is heard. */
export function withQuantizePreview(song: MusicProject): MusicProject {
  const piano = usePiano.getState();
  if (!piano.quantizing) return song;
  const ctx = pianoContext();
  if (!ctx) return song;
  const notes = quantizerResult(ctx, piano.quantizer);
  return notes === ctx.notes ? song : editNotes(song, ctx.pattern.id, ctx.channel.id, () => notes);
}

/** Alt+Q: the Quantizer's window, in front. The Piano roll shows the notes quantized while it's open. */
export function openQuantizer() {
  usePiano.setState({ quantizing: true, chopping: false });
  useMusicWindows.getState().focus("quantizer");
}

/** The Quantizer's Accept: its quantizing becomes an edit (one undo step). */
export function acceptQuantize() {
  const ctx = pianoContext();
  usePiano.setState({ quantizing: false });
  if (ctx) edit(ctx, () => quantizerResult(ctx, usePiano.getState().quantizer));
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

/**
 * Open the Piano roll on a channel (the rack's button, its menu), or without one (the toolbar's button,
 * F7) on the rack's selected channel, if one is: what was picked last is what's shown.
 */
export function openPianoRoll(channelId?: string) {
  const song = useMusic.getState().history?.doc;
  const selected = song && selectedIn(song, useMusicUi.getState().selectedChannelIds)[0];
  const id = channelId ?? selected?.id;
  if (id) usePiano.getState().setChannel(id);
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

// ---------------------------------------------------------------------------
// The keyboard's cursor (`cursor.ts`) and step edit
// ---------------------------------------------------------------------------

/** The cursor's grid: the snap's, or a step with no snap (a tick at a time would take for ever). */
const cursorGrid = (ctx: PianoContext) => (ctx.grid <= 1 ? STEP_TICKS : ctx.grid);

/** How far right the cursor goes: well past the last note, never off the end of time. */
const lastCursorTick = (ctx: PianoContext) => Math.max(ctx.patternTicks, noteBounds(ctx.notes)?.end ?? 0) + ctx.barTicks * 64;

/** The cursor now, or where it starts (the first selected note, else the view's left edge) if it isn't shown. */
function cursorNow(ctx: PianoContext): PianoCursor {
  const piano = usePiano.getState();
  return piano.cursor ?? startingCursor(piano.view, ctx.notes, ctx.selected, cursorGrid(ctx), piano.gridHeight);
}

/** Put the cursor somewhere, the view scrolled to keep it in sight. */
export function placeCursor(cursor: PianoCursor) {
  const ctx = pianoContext();
  const piano = usePiano.getState();
  const view = ctx ? viewShowing(piano.view, cursor, cursorGrid(ctx), piano.gridWidth, piano.gridHeight) : piano.view;
  usePiano.setState({ cursor, view });
}

/** A short sound of pitches on the channel, as a click on the keyboard makes: the cursor's row, heard. */
function sound(ctx: PianoContext, pitches: readonly number[], velocity?: number) {
  const transport = useTransport.getState();
  for (const pitch of pitches) transport.preview(ctx.channel.id, pitch, true, velocity);
  window.setTimeout(() => {
    for (const pitch of pitches) useTransport.getState().preview(ctx.channel.id, pitch, false);
  }, 180);
}

/** ← → ↑ ↓ (Ctrl+Shift+↑ ↓: an octave): the cursor moved (the first press only shows it). A new pitch is heard. */
export function moveCursor(move: "along" | "pitch" | "octave", steps: -1 | 1) {
  const ctx = pianoContext();
  if (!ctx) return;
  const from = cursorNow(ctx);
  if (!usePiano.getState().cursor) return placeCursor(from);
  const to =
    move === "along" ? cursorAlong(from, steps, cursorGrid(ctx))
    : move === "octave" ? { ...from, pitch: clamp(from.pitch + steps * 12, LOWEST_PITCH, HIGHEST_PITCH) }
    : cursorUpDown(from, steps, ctx.song.settings.scale);
  placeCursor(to);
  if (to.pitch !== from.pitch) sound(ctx, [to.pitch]);
}

/** Home / End: the cursor to the pattern's start, or its last cell. */
export function cursorToEdge(edge: "start" | "end") {
  const ctx = pianoContext();
  if (!ctx) return;
  const grid = cursorGrid(ctx);
  const end = Math.max(ctx.patternTicks, noteBounds(ctx.notes)?.end ?? 0);
  placeCursor({ ...cursorNow(ctx), tick: edge === "start" ? 0 : Math.max(0, Math.ceil(end / grid) * grid - grid) });
}

/** The pitches a note put at `pitch` makes, as Draw's click: the Stamp's chord, else the one note (on the scale, with one). */
function pitchesAt(ctx: PianoContext, pitch: number): number[] {
  const { stamp } = usePiano.getState();
  const scale = ctx.song.settings.scale;
  if (stamp) return stampPitches(stamp, pitch, scale);
  return [scale ? snapToScale(scale, pitch) : pitch];
}

/**
 * Enter: a note at the cursor (the Stamp's chord, if one is chosen) as long as the last drawn, heard and
 * selected; then (`advance`) the cursor past it, so a melody is typed one Enter after another.
 */
export function placeAtCursor(advance: boolean) {
  const ctx = pianoContext();
  if (!ctx) return;
  const { cursor, noteLength } = usePiano.getState();
  if (!cursor) return placeCursor(cursorNow(ctx));
  const pitches = pitchesAt(ctx, cursor.pitch);
  editCreating(ctx, (notes) => addNotes(notes, pitches.map((pitch): NewNote => ({ start: cursor.tick, length: noteLength, pitch }))));
  sound(ctx, pitches);
  if (advance) placeCursor({ ...cursor, tick: Math.min(cursor.tick + noteLength, lastCursorTick(ctx)) });
}

/** Tab / Shift+Tab: the cursor to the next (previous) note in score order, it alone selected and heard. */
export function cursorToNote(direction: -1 | 1) {
  const ctx = pianoContext();
  if (!ctx) return;
  const note = noteBeside(ctx.notes, cursorNow(ctx), direction);
  if (!note) return;
  placeCursor({ tick: note.start, pitch: note.pitch });
  usePiano.getState().select([note.id]);
  sound(ctx, [note.pitch], note.velocity);
}

/** X: the note under the cursor into the selection, or out of it. */
export function toggleAtCursor() {
  const ctx = pianoContext();
  const { cursor } = usePiano.getState();
  const note = ctx && cursor ? noteAtCursor(ctx.notes, cursor) : null;
  if (!ctx || !note) return;
  const selected = new Set(ctx.selected);
  if (selected.has(note.id)) selected.delete(note.id);
  else selected.add(note.id);
  usePiano.getState().select(selected);
}

/** Shift+X: every note on the cursor's row selected. */
export function selectRowAtCursor() {
  const ctx = pianoContext();
  const { cursor } = usePiano.getState();
  if (ctx && cursor) usePiano.getState().select(ctx.notes.filter((n) => n.pitch === cursor.pitch).map((n) => n.id));
}

/** I / O: the time selection's start (or end) at the cursor, the other end kept if it still makes a range. */
export function markAtCursor(end: "in" | "out") {
  const ctx = pianoContext();
  const { cursor, time } = usePiano.getState();
  if (!ctx || !cursor) return;
  const grid = cursorGrid(ctx);
  if (end === "in") selectTime(cursor.tick, time && time.end > cursor.tick ? time.end : cursor.tick + grid);
  else selectTime(time && time.start < cursor.tick + grid ? time.start : cursor.tick, cursor.tick + grid);
}

/** The notes the keyboard's edits act on: the selected ones, else the one under the cursor. */
function keyboardTargets(ctx: PianoContext): Set<number> {
  if (ctx.selected.size) return ctx.selected;
  const { cursor } = usePiano.getState();
  const note = cursor ? noteAtCursor(ctx.notes, cursor) : null;
  return new Set(note ? [note.id] : []);
}

/** Alt+Shift+← →: the notes shorter or longer by the grid (never shorter than it); the next note drawn as long. */
export function changeLength(direction: -1 | 1) {
  const ctx = pianoContext();
  if (!ctx) return;
  const ids = keyboardTargets(ctx);
  if (!ids.size) return;
  const grid = cursorGrid(ctx);
  edit(ctx, (notes) => resizeNotes(notes, ids, direction * grid, grid));
  const first = pianoContext()?.notes.find((n) => ids.has(n.id));
  if (first) usePiano.setState({ noteLength: first.length });
}

/** Alt+Shift+↑ ↓: the notes louder or softer by 5%, the first heard as it now is. */
export function changeVelocity(direction: -1 | 1) {
  const ctx = pianoContext();
  if (!ctx) return;
  const ids = keyboardTargets(ctx);
  if (!ids.size) return;
  const chosen = ctx.notes.filter((n) => ids.has(n.id));
  const values = new Map(chosen.map((n) => [n.id, { velocity: clamp(Math.round((n.velocity + direction * 0.05) * 100) / 100, 0, 1) }]));
  edit(ctx, (notes) => setNoteValues(notes, values));
  sound(ctx, [chosen[0].pitch], values.get(chosen[0].id)!.velocity);
}

/** F2: the properties of the first selected note, else of the one under the cursor. */
export function openNoteProperties() {
  const ctx = pianoContext();
  if (!ctx) return;
  const [id] = keyboardTargets(ctx);
  if (id !== undefined) usePiano.setState({ editing: id });
}

/** The keys step edit has heard go down and not yet up: a chord's notes all go at the cursor, which moves on once they're let go. */
const stepHeld = new Set<number>();
let stepLength = 0;

/** Ctrl+E: step edit on (the Piano roll opened, its cursor shown) or off. */
export function toggleStepEdit() {
  const on = !usePiano.getState().stepEdit;
  usePiano.setState({ stepEdit: on });
  stepHeld.clear();
  if (!on) return;
  if (!useMusicUi.getState().pianoOpen) openPianoRoll();
  const ctx = pianoContext();
  if (ctx && !usePiano.getState().cursor) placeCursor(cursorNow(ctx));
}

/**
 * Step edit (FL's): what's played on the Piano roll's channel (a MIDI keyboard, the typing keyboard) while
 * the song is stopped is written at the cursor, as long as the last note drawn, at the velocity played; once
 * every key is let go the cursor moves past it. Playing, it's Record's to take.
 */
export function stepEditPlayed(played: readonly MidiPlayed[]) {
  const piano = usePiano.getState();
  if (!piano.stepEdit || useTransport.getState().playing) return;
  const ctx = pianoContext();
  if (!ctx) return;
  const cursor = piano.cursor ?? cursorNow(ctx);
  const ons = played.filter((n) => n.on && n.channel === ctx.channel.id);
  if (ons.length) {
    // A chord's first key: the notes it starts are as long as the last drawn; the others join them.
    const chord = stepHeld.size > 0;
    if (!chord) stepLength = piano.noteLength;
    for (const n of ons) stepHeld.add(n.key);
    const result = addNotes(ctx.notes, ons.map((n): NewNote => ({ start: cursor.tick, length: stepLength, pitch: n.key, velocity: n.velocity })));
    edit(ctx, () => result.notes);
    const selected = chord ? [...ctx.selected, ...result.created] : result.created;
    usePiano.setState({ cursor: { ...cursor, pitch: ons[ons.length - 1].key }, selected: new Set(selected) });
  }
  const offs = played.filter((n) => !n.on && stepHeld.has(n.key));
  for (const n of offs) stepHeld.delete(n.key);
  if (offs.length && !stepHeld.size) {
    const now = usePiano.getState().cursor ?? cursor;
    placeCursor({ ...now, tick: Math.min(now.tick + stepLength, lastCursorTick(ctx)) });
  }
}
