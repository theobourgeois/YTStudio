/**
 * Drawing PanMan's editors and its Pan Position Meter (Soundtoys' layout, our colours). The editors take
 * the Piano roll's grid colours (`readPalette`) and the accent for the pattern; the meter's LEDs are the
 * meters' theme colours (`--meter-high` in the speakers' range, `--meter-mid` past them, `--meter-off` dark).
 */
import { cycleValue, stepValue } from "@shared/music/panman";
import type { PanCurve, PanDirection, PanShapeEvent, PanStepPoint } from "@shared/music/types";
import type { Palette } from "../piano/draw";
import { type EditorBox, METER_LEDS, gridLines, isBeyond, tickX, valueY } from "./geometry";

/** The colours that aren't the Piano roll's (read again when the theme changes). */
let cached: { key: string; colours: PanColours } | null = null;
export interface PanColours {
  accent: string;
  playhead: string;
  led: string;
  beyond: string;
  off: string;
}
export function panColours(element: Element): PanColours {
  const key = `${document.documentElement.className}|${element.closest(".dark") !== null}`;
  if (cached?.key === key) return cached.colours;
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const colours = { accent: read("--brand"), playhead: read("--playhead"), led: read("--meter-high"), beyond: read("--meter-mid"), off: read("--meter-off") };
  cached = { key, colours };
  return colours;
}

export interface EditorScene {
  width: number;
  height: number;
  box: EditorBox;
  grid: number;
  /** The pattern's length (ticks): the line wraps round it. */
  length: number;
  /** Beats in a bar, for the numbers under it. */
  beatsPerBar: number;
  palette: Palette;
  colours: PanColours;
  /** Where the pattern is playing (ticks into it), or null. */
  locator: number | null;
  /** A point or event to ring (under the pointer, or dragged). */
  hot: number | null;
  /** Not the PanMan's own pattern yet (the knobs'): drawn fainter. */
  generated: boolean;
}

function drawGrid(ctx: CanvasRenderingContext2D, scene: EditorScene) {
  const { width, height, box, palette, beatsPerBar } = scene;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.row;
  ctx.fillRect(box.left, box.top, box.width, box.height);
  // Every second beat a shade darker, as the Piano roll's black rows are.
  ctx.fillStyle = palette.blackRow;
  const beat = box.barTicks / beatsPerBar;
  for (let b = 1; b < beatsPerBar; b += 2) ctx.fillRect(Math.round(tickX(box, box.barStart + b * beat)), box.top, Math.round((beat / box.barTicks) * box.width), box.height);
  for (const line of gridLines(box, scene.grid)) {
    const x = Math.round(tickX(box, line.tick)) + 0.5;
    ctx.strokeStyle = line.strength === "bar" ? palette.barLine : line.strength === "beat" ? palette.beatLine : palette.line;
    ctx.beginPath();
    ctx.moveTo(x, box.top);
    ctx.lineTo(x, box.top + box.height);
    ctx.stroke();
  }
  // The centre, faintly; the area's edge.
  ctx.strokeStyle = palette.line;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(box.left, Math.round(valueY(box, 0)) + 0.5);
  ctx.lineTo(box.left + box.width, Math.round(valueY(box, 0)) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = palette.barLine;
  ctx.strokeRect(box.left + 0.5, box.top + 0.5, box.width - 1, box.height - 1);
  // R, C, L down the right; the beats under it.
  ctx.fillStyle = palette.rulerText;
  ctx.font = "600 10px var(--font-sans, sans-serif)";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (const [label, value] of [["R", 1], ["C", 0], ["L", -1]] as const) ctx.fillText(label, box.left + box.width + 5, Math.min(box.top + box.height - 4, Math.max(box.top + 5, valueY(box, value))));
  ctx.textBaseline = "top";
  for (let b = 0; b < beatsPerBar; b++) ctx.fillText(String(b + 1), tickX(box, box.barStart + b * beat) + 2, box.top + box.height + 2);
}

function drawLocator(ctx: CanvasRenderingContext2D, scene: EditorScene) {
  const { box, locator, colours } = scene;
  if (locator === null || locator < box.barStart || locator >= box.barStart + box.barTicks) return;
  const x = Math.round(tickX(box, locator)) + 0.5;
  ctx.strokeStyle = colours.playhead;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, box.top);
  ctx.lineTo(x, box.top + box.height);
  ctx.stroke();
  ctx.lineWidth = 1;
}

/** The Rhythm Step Editor: the pattern's line (as it plays: smoothed in its curve) and its points, squares. */
export function drawStepEditor(ctx: CanvasRenderingContext2D, scene: EditorScene, points: readonly PanStepPoint[], smoothing: number, curve: PanCurve) {
  drawGrid(ctx, scene);
  const { box, colours } = scene;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, box.top, box.width, box.height);
  ctx.clip();
  ctx.globalAlpha = scene.generated ? 0.7 : 1;
  ctx.strokeStyle = colours.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let px = 0; px <= box.width; px++) {
    const tick = box.barStart + (px / box.width) * box.barTicks;
    const y = valueY(box, stepValue(points, scene.length, smoothing, curve, tick));
    if (px === 0) ctx.moveTo(box.left + px, y);
    else ctx.lineTo(box.left + px, y);
  }
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
  points.forEach((p, i) => {
    if (p.tick < box.barStart || p.tick >= box.barStart + box.barTicks) return;
    const x = Math.round(tickX(box, p.tick));
    const y = Math.round(valueY(box, p.value));
    ctx.fillStyle = colours.accent;
    ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
    if (i === scene.hot) {
      ctx.strokeStyle = scene.palette.foreground;
      ctx.strokeRect(x - 5.5, y - 5.5, 11, 11);
    }
  });
  drawLocator(ctx, scene);
}

/** The Rhythm Editor: each event a shaded cell with one cycle of the direction's shape drawn in it. */
export function drawShapeEditor(ctx: CanvasRenderingContext2D, scene: EditorScene, events: readonly PanShapeEvent[], direction: PanDirection, smoothing: number) {
  drawGrid(ctx, scene);
  const { box, colours } = scene;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, box.top, box.width, box.height);
  ctx.clip();
  events.forEach((event, i) => {
    const from = tickX(box, event.tick);
    const to = tickX(box, event.tick + event.length);
    if (to < box.left || from > box.left + box.width) return;
    ctx.globalAlpha = scene.generated ? 0.12 : 0.2;
    ctx.fillStyle = colours.accent;
    ctx.fillRect(from, box.top, to - from, box.height);
    ctx.globalAlpha = scene.generated ? 0.7 : 1;
    ctx.strokeStyle = i === scene.hot ? scene.palette.foreground : colours.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(from) + 0.5, box.top + 0.5, Math.max(1, Math.round(to - from) - 1), box.height - 1);
    ctx.strokeStyle = colours.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = Math.max(2, Math.ceil(to - from));
    for (let k = 0; k <= steps; k++) {
      const y = valueY(box, cycleValue(direction, smoothing, Math.min(k / steps, 1 - 1e-9)));
      if (k === 0) ctx.moveTo(from + ((to - from) * k) / steps, y);
      else ctx.lineTo(from + ((to - from) * k) / steps, y);
    }
    ctx.stroke();
  });
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  drawLocator(ctx, scene);
}

/** The Pan Position Meter: a row of LEDs, each as bright as `leds` says, L C R under it. */
export function drawMeter(ctx: CanvasRenderingContext2D, width: number, height: number, leds: readonly number[], colours: PanColours, palette: Palette) {
  ctx.clearRect(0, 0, width, height);
  const gap = 2;
  const ledWidth = (width - gap * (METER_LEDS - 1)) / METER_LEDS;
  const ledHeight = height - 13;
  for (let i = 0; i < METER_LEDS; i++) {
    const x = i * (ledWidth + gap);
    ctx.fillStyle = colours.off;
    ctx.fillRect(x, 0, ledWidth, ledHeight);
    const on = leds[i] ?? 0;
    if (on > 0.02) {
      ctx.globalAlpha = on;
      ctx.fillStyle = isBeyond(i) ? colours.beyond : colours.led;
      ctx.fillRect(x, 0, ledWidth, ledHeight);
      ctx.globalAlpha = 1;
    }
  }
  ctx.fillStyle = palette.rulerText;
  ctx.font = "600 10px var(--font-sans, sans-serif)";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "center";
  const at = (i: number) => i * (ledWidth + gap) + ledWidth / 2;
  ctx.fillText("L", at(2), height);
  ctx.fillText("C", at((METER_LEDS - 1) / 2), height);
  ctx.fillText("R", at(METER_LEDS - 3), height);
}
