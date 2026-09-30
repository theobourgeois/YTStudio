/**
 * Drawing the Piano roll: its grid (with the notes), ruler, keyboard and event editor, each a canvas.
 * Only what's in view is drawn (the notes by `visibleRange`), so a pattern of thousands of notes draws
 * in about the time of a screenful. The component calls these once per frame when something changed.
 */
import type { Note } from "@shared/music/types";
import { type PianoView, gridTicks, isBlackKey, pitchName, pitchToY, tickToX, visibleRange, xToTick, yToPitch } from "./geometry";
import type { LaneProperty, PianoDrag, TimeRange } from "./store";

/** The theme's colours, read from the page's CSS variables (so light and dark both work). */
export interface Palette {
  background: string;
  foreground: string;
  muted: string;
  border: string;
  note: string;
  selected: string;
  time: string;
}

export function readPalette(element: Element): Palette {
  const css = getComputedStyle(element);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: get("--background", "#16181c"),
    foreground: get("--foreground", "#e6e6e6"),
    muted: get("--muted", "#2a2d33"),
    border: get("--border", "#33363d"),
    note: get("--brand", "#6aacf0"),
    selected: "#f0606d",
    time: "#e5484d",
  };
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
  barTicks: number;
  beatTicks: number;
  /** Where the pattern ends: past it the grid is dimmed. */
  patternTicks: number;
  time: TimeRange | null;
  drag: PianoDrag | null;
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

function drawNotes(ctx: CanvasRenderingContext2D, scene: Scene, notes: readonly Note[], style: "notes" | "ghosts") {
  const { view, width, height, selected, palette } = scene;
  const [from, to] = visibleRange(notes, xToTick(view, 0), xToTick(view, width));
  const low = yToPitch(view, height) - 1;
  const high = yToPitch(view, 0) + 1;
  const h = Math.max(2, view.rowHeight - 1);
  const labels = style === "notes" && view.rowHeight >= 11;
  ctx.font = `${Math.min(11, view.rowHeight - 4)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  for (let i = from; i < to; i++) {
    const note = notes[i];
    if (note.pitch < low || note.pitch > high) continue;
    const x = tickToX(view, note.start);
    const w = Math.max(2, note.length * view.pxPerTick - 1);
    if (x > width || x + w < 0) continue;
    const y = pitchToY(view, note.pitch) + 0.5;
    if (style === "ghosts") {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = palette.foreground;
      ctx.fillRect(x, y, w, h);
      continue;
    }
    const isSelected = selected.has(note.id);
    ctx.globalAlpha = note.muted ? 0.35 : 1;
    ctx.fillStyle = isSelected ? palette.selected : palette.note;
    ctx.fillRect(x, y, w, h);
    // A darker end, so notes that touch read as separate.
    ctx.globalAlpha = note.muted ? 0.2 : 0.35;
    ctx.fillStyle = "#000";
    ctx.fillRect(x + w - 1, y, 1, h);
    if (labels && w > 26) {
      ctx.globalAlpha = note.muted ? 0.5 : 0.85;
      ctx.fillText(pitchName(note.pitch), x + 3, y + h / 2, w - 5);
    }
  }
  ctx.globalAlpha = 1;
}

export function drawGrid(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { view, width, height, palette, barTicks, beatTicks, patternTicks, time, drag } = scene;
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);

  // Rows: the black keys' darker, a line under every C.
  const top = yToPitch(view, 0);
  const bottom = yToPitch(view, height);
  for (let pitch = top; pitch >= bottom; pitch--) {
    const y = pitchToY(view, pitch);
    if (isBlackKey(pitch)) {
      ctx.fillStyle = palette.muted;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(0, y, width, view.rowHeight);
    }
    ctx.globalAlpha = pitch % 12 === 0 ? 0.5 : 0.18;
    ctx.fillStyle = palette.border;
    ctx.fillRect(0, y + view.rowHeight - 1, width, 1);
  }

  for (const [tick, weight] of gridLines(view, width, barTicks, beatTicks)) {
    ctx.globalAlpha = weight === 2 ? 0.9 : weight === 1 ? 0.45 : 0.2;
    ctx.fillStyle = palette.border;
    ctx.fillRect(Math.round(tickToX(view, tick)), 0, 1, height);
  }

  // Past the pattern's end: what doesn't play (yet).
  const end = tickToX(view, patternTicks);
  if (end < width) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    ctx.fillRect(Math.max(0, end), 0, width - Math.max(0, end), height);
  }

  if (time) {
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = palette.time;
    ctx.fillRect(tickToX(view, time.start), 0, (time.end - time.start) * view.pxPerTick, height);
  }
  ctx.globalAlpha = 1;

  for (const ghosts of scene.ghosts) drawNotes(ctx, scene, ghosts, "ghosts");
  drawNotes(ctx, scene, scene.notes, "notes");

  if (drag?.kind === "rect") {
    const x = tickToX(view, Math.min(drag.from, drag.to));
    const y = pitchToY(view, Math.max(drag.low, drag.high));
    const w = Math.abs(drag.to - drag.from) * view.pxPerTick;
    const h = (Math.abs(drag.high - drag.low) + 1) * view.rowHeight;
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = palette.selected;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = palette.selected;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }
  if (drag?.kind === "slice") {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.foreground;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(tickToX(view, drag.a.tick), (view.topPitch - drag.a.pitch) * view.rowHeight);
    ctx.lineTo(tickToX(view, drag.b.tick), (view.topPitch - drag.b.pitch) * view.rowHeight);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

/** The stretch handle of a selection: a small square past its end, level with its middle. */
export function stretchHandle(view: PianoView, bounds: { end: number; low: number; high: number }) {
  const x = tickToX(view, bounds.end) + 3;
  const y = (pitchToY(view, bounds.high) + pitchToY(view, bounds.low) + view.rowHeight) / 2 - 5;
  return { x, y, size: 10 };
}

export function drawHandle(ctx: CanvasRenderingContext2D, handle: { x: number; y: number; size: number }, palette: Palette) {
  ctx.fillStyle = palette.selected;
  ctx.fillRect(handle.x, handle.y, handle.size, handle.size);
  ctx.fillStyle = palette.background;
  ctx.fillRect(handle.x + 3, handle.y + 3, handle.size - 6, handle.size - 6);
}

export function drawRuler(ctx: CanvasRenderingContext2D, scene: Scene, startTick: number) {
  const { view, width, height, palette, barTicks, beatTicks, time, patternTicks } = scene;
  ctx.fillStyle = palette.muted;
  ctx.fillRect(0, 0, width, height);
  if (time) {
    ctx.fillStyle = palette.time;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(tickToX(view, time.start), height - 7, (time.end - time.start) * view.pxPerTick, 7);
    ctx.globalAlpha = 1;
  }
  // Bar numbers, as many as fit.
  const barPx = barTicks * view.pxPerTick;
  const every = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, 28 / barPx))));
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.foreground;
  for (const [tick, weight] of gridLines(view, width, barTicks, beatTicks)) {
    const x = Math.round(tickToX(view, tick));
    ctx.globalAlpha = weight === 2 ? 0.7 : 0.3;
    ctx.fillRect(x, weight === 2 ? 0 : height - 5, 1, weight === 2 ? height : 5);
    const bar = tick / barTicks;
    if (weight === 2 && bar % every === 0) {
      ctx.globalAlpha = 0.8;
      ctx.fillText(String(bar + 1), x + 3, 3);
    }
  }
  // Where the pattern ends, and where play starts.
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = palette.note;
  ctx.fillRect(Math.round(tickToX(view, patternTicks)) - 1, 0, 2, height);
  const start = tickToX(view, startTick);
  ctx.fillStyle = palette.foreground;
  ctx.beginPath();
  ctx.moveTo(start - 5, 0);
  ctx.lineTo(start + 5, 0);
  ctx.lineTo(start, 7);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawKeys(ctx: CanvasRenderingContext2D, view: PianoView, width: number, height: number, palette: Palette, held: number | null) {
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  ctx.font = `${Math.min(10, view.rowHeight - 3)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  for (let pitch = yToPitch(view, 0); pitch >= yToPitch(view, height); pitch--) {
    const y = pitchToY(view, pitch);
    const black = isBlackKey(pitch);
    ctx.fillStyle = pitch === held ? palette.note : black ? "#1d1f24" : "#e9eaec";
    ctx.fillRect(0, y, black ? width * 0.62 : width, view.rowHeight - 1);
    if (!black && pitch % 12 === 0 && view.rowHeight >= 9) {
      ctx.fillStyle = "#4a4f57";
      ctx.fillText(pitchName(pitch), width - 24, y + view.rowHeight / 2);
    }
  }
}

/** The event editor: a stem per note, from the bottom (velocity) or the middle (pan), with its length as a tail. */
export function drawLane(ctx: CanvasRenderingContext2D, scene: Scene, property: LaneProperty) {
  const { view, width, height, palette, notes, selected, barTicks, beatTicks } = scene;
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  for (const [tick, weight] of gridLines(view, width, barTicks, beatTicks)) {
    if (weight < 1) continue;
    ctx.globalAlpha = weight === 2 ? 0.7 : 0.3;
    ctx.fillStyle = palette.border;
    ctx.fillRect(Math.round(tickToX(view, tick)), 0, 1, height);
  }
  const pad = 6;
  const span = height - pad * 2;
  const base = property === "pan" ? pad + span / 2 : height - pad;
  if (property === "pan") {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = palette.border;
    ctx.fillRect(0, base, width, 1);
  }
  const [from, to] = visibleRange(notes, xToTick(view, 0), xToTick(view, width));
  for (let i = from; i < to; i++) {
    const note = notes[i];
    const x = Math.round(tickToX(view, note.start)) + 0.5;
    if (x < -2 || x > width + 2) continue;
    const y = property === "pan" ? base - (note.pan * span) / 2 : base - note.velocity * span;
    const color = selected.has(note.id) ? palette.selected : palette.note;
    ctx.globalAlpha = note.muted ? 0.35 : 1;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, y);
    ctx.lineTo(x + Math.max(3, note.length * view.pxPerTick - 2), y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
