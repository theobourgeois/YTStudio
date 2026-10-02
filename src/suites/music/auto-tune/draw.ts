/**
 * Drawing Auto-Tune's pitch graph: a row per note (the scale's notes lit, removed ones dark, bypassed ones
 * tinted), a keyboard down the left (its keys as the scale has them, the note sung lit), and the last
 * seconds of the voice: what was sung (a thin line) and what it was tuned to (the accent, glowing), the
 * correction between them shaded sharp or flat. Its grid takes the Piano roll's theme colours
 * (`readPalette`); the rest `--tune-*`.
 */
import { NOTE_NAMES } from "@shared/music/auto-tune-presets";
import type { AutoTuneNote } from "@shared/music/types";
import type { Palette } from "../piano/draw";
import { type GraphView, KEYS_WIDTH, agoX, isBlackKey, noteY, pitchClass, visibleNotes } from "./geometry";
import { type PitchHistory, readingAt } from "./pitch-history";

export interface TuneColours {
  tuned: string;
  sung: string;
  sharp: string;
  flat: string;
  bypass: string;
}

let cached: { key: string; colours: TuneColours } | null = null;
/** Auto-Tune's colours for the theme the element is in (read again when the theme changes). */
export function tuneColours(element: Element): TuneColours {
  const key = `${document.documentElement.className}|${element.closest(".dark") !== null}`;
  if (cached?.key === key) return cached.colours;
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(`--tune-${name}`).trim();
  const colours = { tuned: read("tuned"), sung: read("sung"), sharp: read("sharp"), flat: read("flat"), bypass: read("bypass") };
  cached = { key, colours };
  return colours;
}

export interface GraphScene {
  view: GraphView;
  notes: readonly AutoTuneNote[];
  history: PitchHistory | undefined;
  /** `performance.now()` the graph shows up to (held still while Hold is on). */
  now: number;
  /** The note sung now and its target (lit on the keyboard), or null. */
  sung: number | null;
  target: number | null;
  /** A keyboard key under the pointer. */
  hover: number | null;
  palette: Palette;
  colours: TuneColours;
}

/** A colour with an alpha, from "#rrggbb" (anything else as it is). */
function alpha(colour: string, a: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return colour;
  const n = Number.parseInt(colour.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function drawGraph(ctx: CanvasRenderingContext2D, scene: GraphScene) {
  const { view, palette, colours, notes } = scene;
  const { width, height } = view;
  const row = height / 19;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.outside;
  ctx.fillRect(0, 0, width, height);

  // The rows: a scale note's lit, a removed one dark, a bypassed one tinted.
  for (const note of visibleNotes(view)) {
    const y = noteY(view, note) - row / 2;
    const state = notes[pitchClass(note)];
    ctx.fillStyle = state === "remove" ? palette.outside : isBlackKey(note) ? palette.blackRow : palette.row;
    ctx.fillRect(KEYS_WIDTH, y, width - KEYS_WIDTH, row);
    if (state === "bypass") {
      ctx.fillStyle = alpha(colours.bypass, 0.12);
      ctx.fillRect(KEYS_WIDTH, y, width - KEYS_WIDTH, row);
    }
    if (note === scene.target) {
      ctx.fillStyle = alpha(colours.tuned, 0.14);
      ctx.fillRect(KEYS_WIDTH, y, width - KEYS_WIDTH, row);
    }
    ctx.strokeStyle = pitchClass(note) === 0 ? palette.barLine : palette.line;
    ctx.beginPath();
    ctx.moveTo(KEYS_WIDTH, Math.round(y + row) + 0.5);
    ctx.lineTo(width, Math.round(y + row) + 0.5);
    ctx.stroke();
  }
  // A line a second.
  ctx.strokeStyle = palette.beatLine;
  for (let s = 1; s < 5; s++) {
    const x = Math.round(agoX(view, s * 1000)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  drawVoice(ctx, scene);
  drawKeyboard(ctx, scene, row);
}

/** The readings as lines: sung, and tuned, with the correction between them shaded. */
function drawVoice(ctx: CanvasRenderingContext2D, scene: GraphScene) {
  const { view, history, colours, now } = scene;
  if (!history || !history.readings.length) return;
  const points = history.readings
    .map((r) => ({ ...r, x: agoX(view, now - readingAt(history, r.n)) }))
    .filter((r) => r.x >= KEYS_WIDTH - 4 && r.x <= view.width + 4);
  if (!points.length) return;

  // The correction: between the two lines, orange where the voice is brought down, blue where up.
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.sung < 0 || b.sung < 0) continue;
    const down = b.tuned < b.sung;
    ctx.fillStyle = alpha(down ? colours.sharp : colours.flat, 0.28);
    ctx.beginPath();
    ctx.moveTo(a.x, noteY(view, a.sung));
    ctx.lineTo(b.x, noteY(view, b.sung));
    ctx.lineTo(b.x, noteY(view, b.tuned));
    ctx.lineTo(a.x, noteY(view, a.tuned));
    ctx.closePath();
    ctx.fill();
  }

  const line = (field: "sung" | "tuned", colour: string, lineWidth: number, glow: number) => {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (glow) {
      ctx.shadowColor = colour;
      ctx.shadowBlur = glow;
    }
    ctx.beginPath();
    let drawing = false;
    for (const p of points) {
      if (p[field] < 0) {
        drawing = false;
        continue;
      }
      const y = noteY(view, p[field]);
      if (drawing) ctx.lineTo(p.x, y);
      else ctx.moveTo(p.x, y);
      drawing = true;
    }
    ctx.stroke();
    ctx.restore();
  };
  line("sung", colours.sung, 1.25, 0);
  line("tuned", colours.tuned, 2.25, 8);

  // The newest reading: a dot where the voice is now.
  const last = points[points.length - 1];
  if (last.sung >= 0 && now - readingAt(history, last.n) < 250) {
    ctx.fillStyle = colours.tuned;
    ctx.beginPath();
    ctx.arc(last.x, noteY(view, last.tuned), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The keyboard down the left: each key as the scale has it, the note sung lit, C's named. */
function drawKeyboard(ctx: CanvasRenderingContext2D, scene: GraphScene, row: number) {
  const { view, palette, colours, notes } = scene;
  ctx.fillStyle = palette.keys;
  ctx.fillRect(0, 0, KEYS_WIDTH, view.height);
  ctx.font = "9px var(--font-sans), sans-serif";
  ctx.textBaseline = "middle";
  for (const note of visibleNotes(view)) {
    const y = noteY(view, note) - row / 2;
    const state = notes[pitchClass(note)];
    const black = isBlackKey(note);
    const sung = scene.sung !== null && Math.round(scene.sung) === note;
    // Piano keys are content (white and black in every theme, as the Piano roll's are); a removed key greyed.
    let fill = black ? "#4a515c" : "#eef1f4";
    if (state === "remove") fill = black ? "#2a2e35" : "#7d858f";
    if (state === "bypass") fill = colours.bypass;
    if (sung) fill = colours.flat;
    ctx.fillStyle = fill;
    const inset = black ? 12 : 0;
    ctx.fillRect(0, y + 0.5, KEYS_WIDTH - 2 - inset, row - 1);
    if (note === scene.hover) {
      ctx.fillStyle = alpha(colours.tuned, 0.35);
      ctx.fillRect(0, y + 0.5, KEYS_WIDTH - 2 - inset, row - 1);
    }
    if (pitchClass(note) === 0 || sung || note === scene.hover) {
      ctx.fillStyle = black && !sung ? "#eef1f4" : sung ? "#ffffff" : "#2a2e35";
      ctx.fillText(`${NOTE_NAMES[pitchClass(note)]}${Math.floor(note / 12) - 1}`, 3, y + row / 2);
    }
  }
  ctx.strokeStyle = palette.barLine;
  ctx.beginPath();
  ctx.moveTo(KEYS_WIDTH - 0.5, 0);
  ctx.lineTo(KEYS_WIDTH - 0.5, view.height);
  ctx.stroke();
}
