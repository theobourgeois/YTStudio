/**
 * The Piano roll's maths: where ticks and pitches are on screen, the grid and snapping, which note is
 * under the pointer, which notes are in view. Pure, so it's tested; the canvas and the pointer
 * handlers are thin over it. (`docs/fl-studio/piano-roll.md` says how each should behave.)
 */
import { clamp } from "@shared/math";
import { HIGHEST_PITCH, LOWEST_PITCH, MAX_TICK } from "@shared/music/notes";
import { type Note, PPQ, STEP_TICKS } from "@shared/music/types";

/** How the grid is scrolled and zoomed. */
export interface PianoView {
  /** The tick at the grid's left edge, and how wide a tick is. */
  scrollTick: number;
  pxPerTick: number;
  /** The pitch whose row's top is at the grid's top edge (a fraction scrolls part of a row), and a row's height. */
  topPitch: number;
  rowHeight: number;
}

export const MIN_PX_PER_TICK = 0.02;
export const MAX_PX_PER_TICK = 8;
export const MIN_ROW_HEIGHT = 6;
export const MAX_ROW_HEIGHT = 40;
/**
 * How close to a note's right edge (px) the pointer resizes rather than moves it (never more than half of
 * a short note), and how far past its end it still takes the edge: generous, as FL Studio's, so a
 * note's end is caught without aiming.
 */
export const RESIZE_ZONE = 12;
export const RESIZE_REACH = 5;
/**
 * How far (px) a press may wander before it's a drag: a trackpad's click rolls a few pixels under the
 * finger as it goes down, which mustn't move the note clicked (or the one drawn) to the next row.
 */
export const PRESS_SLOP = 4;

export const tickToX = (view: PianoView, tick: number) => (tick - view.scrollTick) * view.pxPerTick;
export const xToTick = (view: PianoView, x: number) => x / view.pxPerTick + view.scrollTick;
/** The top of a pitch's row. Higher pitches are further up. */
export const pitchToY = (view: PianoView, pitch: number) => (view.topPitch - pitch) * view.rowHeight;
/** The pitch whose row a y is in. */
export const yToPitch = (view: PianoView, y: number) => clamp(Math.ceil(view.topPitch - y / view.rowHeight), LOWEST_PITCH, HIGHEST_PITCH);

const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
export const isBlackKey = (pitch: number) => BLACK[((pitch % 12) + 12) % 12];
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** "C5" for 60: FL Studio's octaves (its root note, MIDI 60, is C5). */
export const pitchName = (pitch: number) => `${NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12)}`;
/** A pitch from its name ("C5", "f#4", "Bb3"), or null. */
export function pitchFromName(name: string): number | null {
  const match = /^([a-g])([#b]?)(-?\d+)$/i.exec(name.trim());
  if (!match) return null;
  const base = NAMES.indexOf(match[1].toUpperCase());
  const pitch = base + (match[2] === "#" ? 1 : match[2].toLowerCase() === "b" ? -1 : 0) + Number(match[3]) * 12;
  return pitch >= LOWEST_PITCH && pitch <= HIGHEST_PITCH ? pitch : null;
}

// ---------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------

/** How much of the keyboard's width its black keys take. */
export const BLACK_KEY_WIDTH = 0.6;

/**
 * An octave's white keys as a piano has them: three share the five rows from C to E, four the seven
 * from F to B. `[semitone, from, to]`, in rows up from the bottom of the octave's C.
 */
const WHITE_KEYS: [number, number, number][] = [
  [0, 0, 5 / 3],
  [2, 5 / 3, 10 / 3],
  [4, 10 / 3, 5],
  [5, 5, 5 + 7 / 4],
  [7, 5 + 7 / 4, 5 + 14 / 4],
  [9, 5 + 14 / 4, 5 + 21 / 4],
  [11, 5 + 21 / 4, 12],
];

export interface WhiteKey {
  pitch: number;
  /** Its top and bottom edges on screen. */
  top: number;
  bottom: number;
}

/** The white keys of the pitches from `low` to `high`, drawn at their true sizes. */
export function whiteKeys(view: PianoView, low: number, high: number): WhiteKey[] {
  const keys: WhiteKey[] = [];
  for (let octave = Math.floor(low / 12); octave <= Math.floor(high / 12); octave++) {
    // The bottom of the octave's C row.
    const base = pitchToY(view, octave * 12) + view.rowHeight;
    for (const [semitone, from, to] of WHITE_KEYS) {
      const pitch = octave * 12 + semitone;
      if (pitch < low || pitch > high) continue;
      keys.push({ pitch, top: base - to * view.rowHeight, bottom: base - from * view.rowHeight });
    }
  }
  return keys;
}

/**
 * The key under a point of the keyboard (`blackWidth` px of it are black keys' width): a black key
 * where one is drawn, else the white key whose true shape the point is in.
 */
export function keyAt(view: PianoView, x: number, y: number, blackWidth: number): number {
  const pitch = yToPitch(view, y);
  if (isBlackKey(pitch) && x < blackWidth) return pitch;
  // Rows up from the bottom of pitch 0's row.
  const rows = view.topPitch + 1 - y / view.rowHeight;
  const octave = Math.floor(rows / 12);
  const within = rows - octave * 12;
  const key = WHITE_KEYS.find(([, from, to]) => within >= from && within < to) ?? WHITE_KEYS[6];
  return clamp(octave * 12 + key[0], LOWEST_PITCH, HIGHEST_PITCH);
}

// ---------------------------------------------------------------------------
// Grid and snap
// ---------------------------------------------------------------------------

export const SNAPS = ["line", "cell", "none", "step/6", "step/4", "step/3", "step/2", "step", "beat/6", "beat/4", "beat/3", "beat/2", "beat", "bar"] as const;
/** The Piano roll's snap setting (FL Studio's magnet menu). */
export type Snap = (typeof SNAPS)[number];

export const SNAP_LABELS: Record<Snap, string> = {
  line: "Line",
  cell: "Cell",
  none: "(none)",
  "step/6": "1/6 step",
  "step/4": "1/4 step",
  "step/3": "1/3 step",
  "step/2": "1/2 step",
  step: "Step",
  "beat/6": "1/6 beat",
  "beat/4": "1/4 beat",
  "beat/3": "1/3 beat",
  "beat/2": "1/2 beat",
  beat: "Beat",
  bar: "Bar",
};

/** The least a grid line is from the next, in pixels: closer, and the grid goes a level coarser. */
const MIN_LINE_GAP = 9;

/**
 * The finest division of the bar whose lines are far enough apart to draw at this zoom: a step (never
 * finer, however far in: four to a beat is fine enough to work in, Théo), half a beat, a beat, a bar,
 * then bars in twos, fours... This is the grid shown, and what "Line" and "Cell" snap to; the finer
 * snaps are in the magnet's menu.
 */
export function gridTicks(pxPerTick: number, barTicks: number, beatTicks = PPQ): number {
  const levels = [STEP_TICKS, beatTicks / 2, beatTicks, barTicks];
  for (const level of levels) if (level * pxPerTick >= MIN_LINE_GAP) return level;
  let bars = barTicks * 2;
  while (bars * pxPerTick < MIN_LINE_GAP) bars *= 2;
  return bars;
}

/** The size of a snap's grid in ticks (1 for none). */
export function snapTicks(snap: Snap, pxPerTick: number, barTicks: number, beatTicks = PPQ): number {
  if (snap === "none") return 1;
  if (snap === "line" || snap === "cell") return gridTicks(pxPerTick, barTicks, beatTicks);
  if (snap === "bar") return barTicks;
  const [unit, part] = snap.split("/");
  return (unit === "step" ? STEP_TICKS : beatTicks) / (part ? Number(part) : 1);
}

/**
 * The ticks between the grid's lines with this snap: the zoom's grid (`gridTicks`), unless the snap has
 * points between its lines (a triplet's, a quarter step's): then the snap's own divisions, every one or
 * every few (each a whole part of the bar) as the zoom allows, so what's snapped to is what's drawn.
 */
export function lineTicks(snap: Snap, pxPerTick: number, barTicks: number, beatTicks = PPQ): number {
  const grid = gridTicks(pxPerTick, barTicks, beatTicks);
  if (snap === "line" || snap === "cell" || snap === "none" || snap === "bar") return grid;
  const unit = snapTicks(snap, pxPerTick, barTicks, beatTicks);
  if (unit % grid === 0) return grid;
  for (let every = 1; unit * every < barTicks; every++) {
    const ticks = unit * every;
    if (barTicks % ticks === 0 && ticks * pxPerTick >= MIN_LINE_GAP) return ticks;
  }
  return grid;
}

/**
 * Where a position lands on the grid. A new note goes at the start of the cell the pointer is in
 * ("cell"); a moved edge goes to the nearest line ("line").
 */
export function snapTick(tick: number, grid: number, how: "cell" | "line"): number {
  const snapped = (how === "cell" ? Math.floor(tick / grid + 1e-9) : Math.round(tick / grid)) * grid;
  return clamp(Math.round(snapped), 0, MAX_TICK - 1);
}

/** How far a drag moves things on the grid: whole cells, so notes off the grid keep their offset. */
export const snapDelta = (ticks: number, grid: number) => Math.round(Math.round(ticks / grid) * grid);

/** "3:02:00": a position as bar, step and tick, counting bars and steps from 1 (the properties dialog). */
export function formatPosition(tick: number, barTicks: number): string {
  const bar = Math.floor(tick / barTicks);
  const inBar = tick - bar * barTicks;
  return `${bar + 1}:${String(Math.floor(inBar / STEP_TICKS) + 1).padStart(2, "0")}:${String(inBar % STEP_TICKS).padStart(2, "0")}`;
}

/** "0:03:00": a length as bars, steps and ticks. */
export function formatLength(ticks: number, barTicks: number): string {
  const bars = Math.floor(ticks / barTicks);
  const rest = ticks - bars * barTicks;
  return `${bars}:${String(Math.floor(rest / STEP_TICKS)).padStart(2, "0")}:${String(rest % STEP_TICKS).padStart(2, "0")}`;
}

/** Ticks from "bar:step:tick" (a position, counted from 1, or a length, from 0), or null. */
export function parseTime(text: string, barTicks: number, position: boolean): number | null {
  const parts = text.trim().split(":").map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p) || p < 0)) return null;
  const [bar, step, tick] = parts;
  const ticks = position ? (bar - 1) * barTicks + (step - 1) * STEP_TICKS + tick : bar * barTicks + step * STEP_TICKS + tick;
  return ticks >= 0 ? ticks : null;
}

// ---------------------------------------------------------------------------
// Notes on screen
// ---------------------------------------------------------------------------

/** Each note list's longest note: a note that starts before the view may still reach into it. */
const longest = new WeakMap<readonly Note[], number>();

function longestNote(notes: readonly Note[]): number {
  let length = longest.get(notes);
  if (length === undefined) {
    length = 0;
    for (const note of notes) if (note.length > length) length = note.length;
    longest.set(notes, length);
  }
  return length;
}

/** The index of the first note that starts at or after `tick` (the list is in order of start). */
function firstFrom(notes: readonly Note[], tick: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (notes[mid].start < tick) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The slice of the list that can show between two ticks: `[from, to)` indexes. Every note in view is
 * in it; a few just outside may be too (notes shorter than the longest that start before the view).
 */
export function visibleRange(notes: readonly Note[], fromTick: number, toTick: number): [number, number] {
  return [firstFrom(notes, fromTick - longestNote(notes)), firstFrom(notes, toTick)];
}

export interface NoteHit {
  note: Note;
  /** The pointer is on its right edge: a drag resizes it. */
  edge: boolean;
}

/**
 * The note under a point, if any. Where several overlap, a selected one wins, then the one drawn last
 * (on top). The right `RESIZE_ZONE` pixels of a note are its edge, but never more than half of it.
 * With `reach` (px), a point just past a note's end, on nothing else, is on that note's edge too (the
 * tools that resize; the ones that delete or mute only take what's under the pointer).
 */
export function hitNote(notes: readonly Note[], view: PianoView, x: number, y: number, selected?: ReadonlySet<number>, reach = 0): NoteHit | null {
  const tick = xToTick(view, x);
  const pitch = yToPitch(view, y);
  const past = reach / view.pxPerTick;
  const [from, to] = visibleRange(notes, tick - past, tick + 1);
  let best: Note | null = null;
  /** The note whose end is nearest before the point, within `reach`. */
  let tail: Note | null = null;
  for (let i = from; i < to; i++) {
    const note = notes[i];
    if (note.pitch !== pitch || tick < note.start) continue;
    const end = note.start + note.length;
    if (tick >= end) {
      if (tick - end < past && (!tail || end > tail.start + tail.length)) tail = note;
      continue;
    }
    if (!best || selected?.has(note.id) || !selected?.has(best.id)) best = note;
  }
  if (!best) return tail && { note: tail, edge: true };
  const width = best.length * view.pxPerTick;
  const fromEnd = tickToX(view, best.start + best.length) - x;
  return { note: best, edge: fromEnd <= Math.min(RESIZE_ZONE, width / 2) };
}

// ---------------------------------------------------------------------------
// The event editor
// ---------------------------------------------------------------------------

/** The event editor's margin above and below its values' range, in pixels. */
export const LANE_PAD = 6;
/** How near (px) a note's stem the pointer takes it by its stem rather than its tail. */
export const STEM_ZONE = 4;
/** How far above or below a note's tail (px) a press still takes it. */
export const TAIL_REACH = 4;

/** Where a note's value is drawn in an event editor `height` px tall: velocity up from the bottom, pan either side of the middle. */
export function laneY(note: Note, property: "velocity" | "pan", height: number): number {
  const span = height - LANE_PAD * 2;
  return Math.round(property === "pan" ? LANE_PAD + span / 2 - (note.pan * span) / 2 : height - LANE_PAD - note.velocity * span);
}

/** How long a note's tail is drawn in the event editor: its length, less a little gap before the next. */
export const tailWidth = (view: PianoView, note: Note) => Math.max(3, note.length * view.pxPerTick - 3);

/**
 * The note whose tail (the line from the top of its stem along its length) is under a point of the
 * event editor, if any; the stem itself (`STEM_ZONE`) is left to the press that takes notes by their
 * stems. Where tails cross, a selected note wins (it's drawn on top), then the one drawn last.
 */
export function laneTailAt(
  notes: readonly Note[],
  view: PianoView,
  x: number,
  y: number,
  property: "velocity" | "pan",
  height: number,
  selected?: ReadonlySet<number>,
): Note | null {
  const tick = xToTick(view, x);
  const [from, to] = visibleRange(notes, tick, tick + 1);
  let best: Note | null = null;
  for (let i = from; i < to; i++) {
    const note = notes[i];
    // Where the lane draws it: the stem one pixel right of the note's start (`drawLane`).
    const start = Math.round(tickToX(view, note.start)) + 1;
    if (x < start + STEM_ZONE || x > start + tailWidth(view, note) + 1) continue;
    if (Math.abs(y - laneY(note, property, height)) > TAIL_REACH) continue;
    if (!best || selected?.has(note.id) || !selected?.has(best.id)) best = note;
  }
  return best;
}

/**
 * The starts of the notes a paint stroke lays down from `from` to the pointer at `to`: one every
 * `length` ticks (but never closer than a grid cell), filling the span.
 */
export function paintStarts(from: number, to: number, length: number, grid: number): number[] {
  const every = Math.max(grid, Math.ceil(length / grid) * grid);
  const first = snapTick(Math.min(from, to), grid, "cell");
  const last = snapTick(Math.max(from, to), grid, "cell");
  const starts: number[] = [];
  // Anchored at where the stroke began, so painting leftwards keeps the first note in place.
  const anchor = snapTick(from, grid, "cell");
  for (let at = anchor - Math.ceil((anchor - first) / every) * every; at <= last; at += every) if (at >= 0) starts.push(at);
  return starts;
}

/** Zoom horizontally about a point: the tick under `x` stays under it. */
export function zoomAt(view: PianoView, x: number, pxPerTick: number): PianoView {
  const next = clamp(pxPerTick, MIN_PX_PER_TICK, MAX_PX_PER_TICK);
  return { ...view, pxPerTick: next, scrollTick: Math.max(0, xToTick(view, x) - x / next) };
}

/** Zoom the rows (the keys' height) about a point: the pitch under `y` stays under it. */
export function zoomRowsAt(view: PianoView, y: number, rowHeight: number): PianoView {
  const next = clamp(rowHeight, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
  const under = view.topPitch - y / view.rowHeight;
  return { ...view, rowHeight: next, topPitch: Math.min(128, under + y / next) };
}

/**
 * The zoom tool's rectangle (FL's Z): the view showing ticks `from`..`to` across `width` px and the
 * pitches `low`..`high` down `height` px, as near as the zoom's limits allow.
 */
export function zoomToRect(view: PianoView, from: number, to: number, low: number, high: number, width: number, height: number): PianoView {
  const ticks = Math.max(STEP_TICKS, Math.abs(to - from));
  const rows = Math.abs(high - low) + 1;
  const pxPerTick = clamp(width / ticks, MIN_PX_PER_TICK, MAX_PX_PER_TICK);
  const rowHeight = clamp(height / rows, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
  // The rows' middle in the middle, when they don't fill it.
  const middle = (Math.max(low, high) + Math.min(low, high) + 1) / 2;
  return { ...view, pxPerTick, rowHeight, scrollTick: Math.max(0, Math.min(from, to)), topPitch: Math.min(128, middle + height / rowHeight / 2) };
}

/** Pixels of vertical drag that double (up) or halve (down) the rows' height, in a zoom drag. */
export const ROW_ZOOM_DRAG = 120;

/** The view showing `[from, to)` ticks across `width` pixels, with a little room either side. */
export function zoomToRange(view: PianoView, from: number, to: number, width: number): PianoView {
  const span = Math.max(STEP_TICKS, to - from);
  const pxPerTick = clamp((width * 0.92) / span, MIN_PX_PER_TICK, MAX_PX_PER_TICK);
  return { ...view, pxPerTick, scrollTick: Math.max(0, from - (width / pxPerTick - span) / 2) };
}

/** How near the grid's edge (px) a drag starts scrolling it, and how fast (px a frame) it scrolls right at the edge. */
export const EDGE_ZONE = 32;
export const EDGE_SPEED = 8;

/**
 * How fast a drag scrolls the grid, in px a frame, with the pointer at `pos` along a side `size` px
 * long: towards the edge it's near (negative: the start), faster the nearer and faster still past it.
 */
export function edgeSpeed(pos: number, size: number): number {
  const zone = Math.min(EDGE_ZONE, size / 4);
  if (zone <= 0) return 0;
  if (pos < zone) return -EDGE_SPEED * clamp((zone - pos) / zone, 0, 4);
  if (pos > size - zone) return EDGE_SPEED * clamp((pos - (size - zone)) / zone, 0, 4);
  return 0;
}

/**
 * The view scrolled by `dx` px along time and `dy` px down the keys, kept where the wheel keeps it (no
 * earlier than 0, the keyboard's ends in reach of a grid `height` px tall). The same view if it can't move.
 */
export function scrollViewBy(view: PianoView, dx: number, dy: number, height: number): PianoView {
  const scrollTick = clamp(view.scrollTick + dx / view.pxPerTick, 0, Math.max(view.scrollTick, MAX_TICK));
  const topPitch = clamp(view.topPitch - dy / view.rowHeight, Math.min(view.topPitch, height / view.rowHeight - 1), Math.max(view.topPitch, 128));
  return scrollTick === view.scrollTick && topPitch === view.topPitch ? view : { ...view, scrollTick, topPitch };
}
