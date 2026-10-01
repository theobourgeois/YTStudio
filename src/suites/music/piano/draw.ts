/**
 * Drawing the Piano roll: its grid (with the notes), ruler, keyboard and event editor, each a canvas.
 * Only what's in view is drawn (the notes by `visibleRange`), so a pattern of thousands of notes draws
 * in about the time of a screenful. The component calls these once per frame when something changed.
 *
 * The look is FL Studio's: a blue-grey grid whose lines are darker than its cells, pale notes (blue,
 * Théo's choice: FL's are green; red when selected) with a rounded, lit edge and their name on them, and a keyboard drawn as a real
 * one, white keys of their true sizes under the black ones. The grid's colours are the theme's
 * (`--piano-*`, `readPalette`); the notes' are content, the same in every theme (`note-colours.ts`),
 * darker the quieter a note is.
 */
import type { Note } from "@shared/music/types";
import { BLACK_KEY_WIDTH, LANE_PAD, type PianoView, gridTicks, isBlackKey, laneY, pitchName, pitchToY, tailWidth, tickToX, visibleRange, whiteKeys, xToTick, yToPitch } from "./geometry";
import { MUTED, NOTE, type NoteColours, SELECTED, velocityColours } from "./note-colours";
import type { LaneProperty, PianoDrag, TimeRange } from "./store";

export interface Palette {
  dark: boolean;
  foreground: string;
  /** The grid: rows of white keys and of black keys, and its lines, fainter to stronger. */
  row: string;
  blackRow: string;
  line: string;
  beatLine: string;
  barLine: string;
  /** What's past the pattern's end is covered with this. */
  outside: string;
  ruler: string;
  rulerText: string;
  note: NoteColours;
  selected: NoteColours;
  muted: NoteColours;
  ghost: string;
  time: string;
  /** Where play starts (the ruler's marker), and the slice and playback tools' lines. */
  start: string;
  tool: string;
  /** Behind the keyboard's keys (the gaps between them). */
  keys: string;
}

/** The palette's colours that come from the theme (`--piano-<name>` in `src/themes/`), by field. */
const THEMED = {
  row: "row",
  blackRow: "black-row",
  line: "line",
  beatLine: "beat-line",
  barLine: "bar-line",
  outside: "outside",
  ruler: "ruler",
  rulerText: "ruler-text",
  ghost: "ghost",
  time: "time",
  start: "start",
  tool: "tool",
  keys: "keys",
} as const;

let cached: { key: string; palette: Palette } | null = null;

/**
 * The palette for the theme the element is shown in: the grid's colours are the theme's (CSS variables,
 * read again only when the theme changes), the notes' are content and stay.
 */
export function readPalette(element: Element): Palette {
  const dark = element.closest(".dark") !== null;
  const key = `${document.documentElement.className}|${dark}`;
  if (cached?.key === key) return cached.palette;
  const style = getComputedStyle(element);
  const themed = Object.fromEntries(
    Object.entries(THEMED).map(([field, name]) => [field, style.getPropertyValue(`--piano-${name}`).trim()]),
  ) as Record<keyof typeof THEMED, string>;
  const palette: Palette = {
    ...themed,
    dark,
    foreground: style.getPropertyValue("--foreground").trim(),
    note: NOTE,
    selected: SELECTED,
    muted: MUTED,
  };
  cached = { key, palette };
  return palette;
}

/** A note fading away after it's deleted (`fades.ts`): how far through (0..1), and how it looked. */
export interface Vanishing {
  note: Note;
  progress: number;
  selected: boolean;
}

export interface Scene {
  view: PianoView;
  /** The canvas's size, in CSS pixels. */
  width: number;
  height: number;
  /** The channel's notes, as the drag in progress would leave them. */
  notes: readonly Note[];
  selected: ReadonlySet<number>;
  /** Other channels' notes in the pattern, drawn behind (or none). */
  ghosts: readonly (readonly Note[])[];
  /** Notes just deleted, fading out. */
  vanishing: readonly Vanishing[];
  barTicks: number;
  beatTicks: number;
  /** Where the pattern ends: past it the grid is dimmed. */
  patternTicks: number;
  time: TimeRange | null;
  drag: PianoDrag | null;
  /** The slice tool's cut, as a line on screen, while it's dragged; `full`: through the whole column (Shift). */
  slice: { x: number; y1: number; y2: number; full: boolean } | null;
  palette: Palette;
}

/** A canvas ready to draw on at the screen's resolution, in CSS pixels. */
export function prepare(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

/** The grid lines in view: `[tick, weight]`, weight 2 for bars, 1 for beats, 0 for the rest. */
function gridLines(view: PianoView, width: number, barTicks: number, beatTicks: number): [number, number][] {
  const grid = gridTicks(view.pxPerTick, barTicks, beatTicks);
  const lines: [number, number][] = [];
  const last = xToTick(view, width);
  for (let tick = Math.floor(view.scrollTick / grid) * grid; tick <= last; tick += grid) {
    if (tick < 0) continue;
    lines.push([tick, tick % barTicks === 0 ? 2 : tick % beatTicks === 0 ? 1 : 0]);
  }
  return lines;
}

/**
 * A note's body: rounded, lit from above, outlined, with a highlight along its top edge. Gradients
 * depend only on where a row is, so they're made once per row and colour and reused.
 */
function noteBody(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colours: NoteColours, gradients: Map<string, CanvasGradient>) {
  if (w < 4 || h < 5) {
    ctx.fillStyle = colours.bottom;
    ctx.fillRect(x, y, w, h);
    return;
  }
  const key = `${colours.top}${y}`;
  let fill = gradients.get(key);
  if (!fill) {
    fill = ctx.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, colours.top);
    fill.addColorStop(1, colours.bottom);
    gradients.set(key, fill);
  }
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, Math.min(3, h / 4));
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = colours.edge;
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.fillRect(x + 2, y + 1.5, w - 4, 1);
}

/** A note's colours: muted, selected or not, and darker the quieter it is (as FL Studio's are). */
function coloursOf(palette: Palette, note: Note, selected: boolean): NoteColours {
  if (note.muted) return palette.muted;
  return velocityColours(selected ? palette.selected : palette.note, note.velocity);
}

/**
 * The notes in view, in two passes over them: the others, then the selected ones, so a selected note
 * is never hidden under one it overlaps.
 */
function drawNotes(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { view, width, height, selected, palette, notes } = scene;
  const [from, to] = visibleRange(notes, xToTick(view, 0), xToTick(view, width));
  const low = yToPitch(view, height) - 1;
  const high = yToPitch(view, 0) + 1;
  const h = Math.max(2, view.rowHeight - 1);
  const labels = view.rowHeight >= 11;
  const gradients = new Map<string, CanvasGradient>();
  ctx.font = `600 ${Math.min(11, view.rowHeight - 5)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  for (const pass of [false, true]) {
    if (pass && !selected.size) break;
    for (let i = from; i < to; i++) {
      const note = notes[i];
      if (note.pitch < low || note.pitch > high || selected.has(note.id) !== pass) continue;
      const x = Math.round(tickToX(view, note.start));
      const w = Math.max(3, Math.round(note.length * view.pxPerTick));
      if (x > width || x + w < 0) continue;
      const y = Math.round(pitchToY(view, note.pitch));
      const colours = coloursOf(palette, note, pass);
      ctx.globalAlpha = note.muted ? 0.7 : 1;
      noteBody(ctx, x, y, w, h, colours, gradients);
      if (labels && w > 24) {
        ctx.fillStyle = colours.text;
        ctx.fillText(pitchName(note.pitch), x + 4, y + h / 2 + 0.5, w - 7);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawGhosts(ctx: CanvasRenderingContext2D, scene: Scene, notes: readonly Note[]) {
  const { view, width, height, palette } = scene;
  const [from, to] = visibleRange(notes, xToTick(view, 0), xToTick(view, width));
  const low = yToPitch(view, height) - 1;
  const high = yToPitch(view, 0) + 1;
  const h = Math.max(2, view.rowHeight - 1);
  ctx.fillStyle = palette.ghost;
  ctx.beginPath();
  for (let i = from; i < to; i++) {
    const note = notes[i];
    if (note.pitch < low || note.pitch > high) continue;
    const x = Math.round(tickToX(view, note.start));
    const w = Math.max(3, Math.round(note.length * view.pxPerTick) - 1);
    if (x > width || x + w < 0) continue;
    ctx.roundRect(x + 0.5, Math.round(pitchToY(view, note.pitch)) + 0.5, w - 1, h - 1, 2);
  }
  ctx.fill();
}

/** Deleted notes shrink into their middle as they fade, as FL Studio's do. */
function drawVanishing(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { view, palette } = scene;
  const gradients = new Map<string, CanvasGradient>();
  for (const { note, progress, selected } of scene.vanishing) {
    const eased = 1 - (1 - progress) ** 2;
    const w = Math.max(3, note.length * view.pxPerTick) * (1 - 0.3 * eased);
    const h = Math.max(2, view.rowHeight - 1) * (1 - 0.6 * eased);
    const cx = tickToX(view, note.start) + (note.length * view.pxPerTick) / 2;
    const cy = pitchToY(view, note.pitch) + view.rowHeight / 2;
    ctx.globalAlpha = 1 - eased;
    noteBody(ctx, Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h), coloursOf(palette, { ...note, muted: false }, selected), gradients);
  }
  ctx.globalAlpha = 1;
}

export function drawGrid(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { view, width, height, palette, barTicks, beatTicks, patternTicks, time, drag } = scene;
  ctx.fillStyle = palette.row;
  ctx.fillRect(0, 0, width, height);

  // Rows: the black keys' darker, a line between each, a stronger one under every C.
  const top = yToPitch(view, 0);
  const bottom = yToPitch(view, height);
  for (let pitch = top; pitch >= bottom; pitch--) {
    const y = Math.round(pitchToY(view, pitch));
    if (isBlackKey(pitch)) {
      ctx.fillStyle = palette.blackRow;
      ctx.fillRect(0, y, width, Math.round(view.rowHeight));
    }
    ctx.fillStyle = pitch % 12 === 0 ? palette.beatLine : palette.line;
    ctx.fillRect(0, Math.round(pitchToY(view, pitch - 1)) - 1, width, 1);
  }

  for (const [tick, weight] of gridLines(view, width, barTicks, beatTicks)) {
    ctx.fillStyle = weight === 2 ? palette.barLine : weight === 1 ? palette.beatLine : palette.line;
    ctx.fillRect(Math.round(tickToX(view, tick)) - (weight === 2 ? 1 : 0), 0, weight === 2 ? 2 : 1, height);
  }

  // Past the pattern's end: what doesn't play (yet).
  const end = tickToX(view, patternTicks);
  if (end < width) {
    ctx.fillStyle = palette.outside;
    ctx.fillRect(Math.max(0, end), 0, width - Math.max(0, end), height);
  }

  if (time) {
    ctx.globalAlpha = palette.dark ? 0.1 : 0.08;
    ctx.fillStyle = palette.time;
    ctx.fillRect(tickToX(view, time.start), 0, (time.end - time.start) * view.pxPerTick, height);
    ctx.globalAlpha = 0.6;
    ctx.fillRect(Math.round(tickToX(view, time.start)), 0, 1, height);
    ctx.fillRect(Math.round(tickToX(view, time.end)) - 1, 0, 1, height);
    ctx.globalAlpha = 1;
  }

  for (const ghosts of scene.ghosts) drawGhosts(ctx, scene, ghosts);
  drawNotes(ctx, scene);
  drawVanishing(ctx, scene);

  if (drag?.kind === "rect") {
    const x = Math.round(tickToX(view, Math.min(drag.from, drag.to)));
    const y = Math.round(pitchToY(view, Math.max(drag.low, drag.high)));
    const w = Math.round(Math.abs(drag.to - drag.from) * view.pxPerTick);
    const h = Math.round((Math.abs(drag.high - drag.low) + 1) * view.rowHeight);
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = palette.time;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.time;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }
  if (scene.slice) drawCutLine(ctx, scene.slice.x, scene.slice.y1, scene.slice.y2, palette.tool, !scene.slice.full);
  if (drag?.kind === "playback") {
    const x = Math.round(tickToX(view, drag.tick)) + 0.5;
    ctx.fillStyle = palette.tool;
    ctx.fillRect(x - 1, 0, 2, height);
  }
}

/**
 * The slice tool's line: straight down through the notes it cuts, with an arrowhead at each end
 * (`arrows`; a line through the whole column has no ends to show).
 */
function drawCutLine(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number, colour: string, arrows: boolean) {
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  ctx.strokeStyle = colour;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  if (arrows) {
    // The arrowheads point out along the line: a "Y" at the top, an upside-down one at the bottom.
    ctx.moveTo(x - 6, top - 7);
    ctx.lineTo(x, top);
    ctx.lineTo(x + 6, top - 7);
    ctx.moveTo(x - 6, bottom + 7);
    ctx.lineTo(x, bottom);
    ctx.lineTo(x + 6, bottom + 7);
  }
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";
}

/** The stretch handle of a selection: a small square past its end, level with its middle. */
export function stretchHandle(view: PianoView, bounds: { end: number; low: number; high: number }) {
  const x = tickToX(view, bounds.end) + 3;
  const y = (pitchToY(view, bounds.high) + pitchToY(view, bounds.low) + view.rowHeight) / 2 - 5;
  return { x, y, size: 10 };
}

export function drawHandle(ctx: CanvasRenderingContext2D, handle: { x: number; y: number; size: number }, palette: Palette) {
  ctx.beginPath();
  ctx.roundRect(handle.x + 0.5, handle.y + 0.5, handle.size, handle.size, 2);
  ctx.fillStyle = palette.selected.bottom;
  ctx.fill();
  ctx.strokeStyle = palette.selected.edge;
  ctx.stroke();
  // Two arrows, ⟷, say which way it goes.
  ctx.strokeStyle = palette.selected.text;
  ctx.beginPath();
  const cy = handle.y + handle.size / 2 + 0.5;
  ctx.moveTo(handle.x + 2.5, cy);
  ctx.lineTo(handle.x + handle.size - 1.5, cy);
  ctx.stroke();
}

export function drawRuler(ctx: CanvasRenderingContext2D, scene: Scene, startTick: number) {
  const { view, width, height, palette, barTicks, beatTicks, time, patternTicks } = scene;
  ctx.fillStyle = palette.ruler;
  ctx.fillRect(0, 0, width, height);
  // Past the pattern's end.
  const end = tickToX(view, patternTicks);
  if (end < width) {
    ctx.fillStyle = palette.outside;
    ctx.fillRect(Math.max(0, end), 0, width - Math.max(0, end), height);
  }
  if (time) {
    const x = tickToX(view, time.start);
    const w = (time.end - time.start) * view.pxPerTick;
    ctx.fillStyle = palette.time;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(x, 0, w, height);
    ctx.globalAlpha = 1;
    ctx.fillRect(x, height - 6, w, 6);
  }
  // Bar numbers, as many as fit, and ticks for the beats and steps.
  const barPx = barTicks * view.pxPerTick;
  const every = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, 28 / barPx))));
  ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "top";
  for (const [tick, weight] of gridLines(view, width, barTicks, beatTicks)) {
    const x = Math.round(tickToX(view, tick));
    const bar = tick / barTicks;
    ctx.fillStyle = palette.rulerText;
    ctx.globalAlpha = weight === 2 ? 0.8 : weight === 1 ? 0.5 : 0.28;
    const tall = weight === 2 ? height : weight === 1 ? 7 : 4;
    ctx.fillRect(x, height - tall, 1, tall);
    if (weight === 2 && bar % every === 0) {
      ctx.globalAlpha = 1;
      ctx.fillText(String(bar + 1), x + 4, 4);
    }
  }
  ctx.globalAlpha = 1;
  // Where the pattern ends.
  ctx.fillStyle = palette.tool;
  ctx.fillRect(Math.round(end) - 1, 0, 2, height);
  // Where play starts: FL Studio's orange marker.
  const start = Math.round(tickToX(view, startTick));
  ctx.fillStyle = palette.start;
  ctx.beginPath();
  ctx.moveTo(start, 0);
  ctx.lineTo(start + 9, 0);
  ctx.lineTo(start + 9, 5);
  ctx.lineTo(start, 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(start, 0, 1.5, height);
}

/**
 * The keyboard, drawn as a piano: white keys at their true sizes (three to the five rows from C to E,
 * four to the seven from F to B), black keys over them. Every white key is named when the rows are
 * tall enough to read, else only the Cs.
 */
export function drawKeys(ctx: CanvasRenderingContext2D, view: PianoView, width: number, height: number, palette: Palette, held: number | null) {
  ctx.fillStyle = palette.keys;
  ctx.fillRect(0, 0, width, height);
  const top = yToPitch(view, 0) + 1;
  const bottom = yToPitch(view, height) - 1;
  const blackWidth = Math.round(width * BLACK_KEY_WIDTH);
  const white = ctx.createLinearGradient(0, 0, width, 0);
  white.addColorStop(0, "#c9ccd1");
  white.addColorStop(0.12, "#eceef0");
  white.addColorStop(0.75, "#fbfbfc");
  white.addColorStop(1, "#e4e6e9");
  const shaded = ctx.createLinearGradient(0, 0, width, 0);
  shaded.addColorStop(0, "#b7bbc2");
  shaded.addColorStop(0.12, "#d9dce1");
  shaded.addColorStop(1, "#d0d4da");
  const pressed = ctx.createLinearGradient(0, 0, width, 0);
  pressed.addColorStop(0, "#79a5e4");
  pressed.addColorStop(1, "#bcd5f7");
  const names = view.rowHeight >= 12;
  ctx.font = `600 ${Math.min(10, Math.max(8, view.rowHeight - 5))}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";

  for (const key of whiteKeys(view, bottom, top)) {
    const y = Math.round(key.top);
    const h = Math.round(key.bottom) - y;
    ctx.fillStyle = key.pitch === held ? pressed : key.pitch % 12 === 0 ? shaded : white;
    ctx.fillRect(0, y, width - 1, h - 1);
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fillRect(0, y + h - 1, width - 1, 1);
    if (names || key.pitch % 12 === 0) {
      ctx.fillStyle = key.pitch % 12 === 0 ? "#2b3036" : "#6a717b";
      ctx.fillText(pitchName(key.pitch), width - 5, pitchToY(view, key.pitch) + view.rowHeight / 2 + 0.5);
    }
  }
  for (let pitch = top; pitch >= bottom; pitch--) {
    if (!isBlackKey(pitch)) continue;
    const y = Math.round(pitchToY(view, pitch));
    const h = Math.max(3, Math.round(view.rowHeight));
    // Its shadow on the white keys, its body, then its lit front face.
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(blackWidth, y + 1, 3, h);
    ctx.fillStyle = pitch === held ? "#2a4d82" : "#16181c";
    ctx.fillRect(0, y, blackWidth, h);
    if (h >= 6) {
      const face = ctx.createLinearGradient(0, 0, blackWidth, 0);
      face.addColorStop(0, pitch === held ? "#3a66a6" : "#24272c");
      face.addColorStop(1, pitch === held ? "#5d90d8" : "#454951");
      ctx.fillStyle = face;
      ctx.fillRect(1, y + 1, blackWidth - 6, h - 3);
      ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
      ctx.fillRect(blackWidth - 5, y + 1, 1, h - 3);
    }
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(width - 1, 0, 1, height);
}

/** The event editor: a stem per note, from the bottom (velocity) or the middle (pan), with its length as a tail. */
export function drawLane(ctx: CanvasRenderingContext2D, scene: Scene, property: LaneProperty) {
  const { view, width, height, palette, notes, selected, barTicks, beatTicks } = scene;
  ctx.fillStyle = palette.row;
  ctx.fillRect(0, 0, width, height);
  for (const [tick, weight] of gridLines(view, width, barTicks, beatTicks)) {
    if (weight < 1) continue;
    ctx.fillStyle = weight === 2 ? palette.barLine : palette.beatLine;
    ctx.fillRect(Math.round(tickToX(view, tick)), 0, 1, height);
  }
  const end = tickToX(view, scene.patternTicks);
  if (end < width) {
    ctx.fillStyle = palette.outside;
    ctx.fillRect(Math.max(0, end), 0, width - Math.max(0, end), height);
  }
  const span = height - LANE_PAD * 2;
  const base = property === "pan" ? LANE_PAD + span / 2 : height - LANE_PAD;
  if (property === "pan") {
    ctx.fillStyle = palette.beatLine;
    ctx.fillRect(0, base, width, 1);
  }
  const [from, to] = visibleRange(notes, xToTick(view, 0), xToTick(view, width));
  ctx.lineWidth = 2;
  // The selected notes' stems last, on top (as their notes are).
  for (const pass of [false, true]) {
    if (pass && !selected.size) break;
    for (let i = from; i < to; i++) {
      const note = notes[i];
      if (selected.has(note.id) !== pass) continue;
      const x = Math.round(tickToX(view, note.start)) + 1;
      if (x < -2 || x > width + 2) continue;
      const y = laneY(note, property, height);
      const colours = note.muted ? palette.muted : pass ? palette.selected : palette.note;
      ctx.globalAlpha = note.muted ? 0.6 : 1;
      ctx.fillStyle = colours.bottom;
      ctx.fillRect(x - 1, Math.min(y, base), 2, Math.abs(base - y));
      ctx.globalAlpha = note.muted ? 0.35 : 0.6;
      ctx.fillRect(x, y, tailWidth(view, note), 1);
      ctx.globalAlpha = note.muted ? 0.6 : 1;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = colours.top;
      ctx.fill();
      ctx.strokeStyle = colours.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
