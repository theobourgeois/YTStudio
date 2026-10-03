/**
 * Drawing Gross Beat's mapping panel (FL's look, our colours): the bar's grid (each snap step, each
 * beat, and on a time envelope each beat back, labelled), the safety line and the reverse guides, the
 * envelope (its line, the area under it, its points and tension handles) and the playback locator. The
 * grid takes the Piano roll's theme colours (`readPalette`); the envelope its kind's (`--gross-time`,
 * `--gross-volume`).
 */
import { curveValue } from "@shared/music/automation";
import type { GrossKind } from "@shared/music/gross-beat";
import { GROSS_BEATS, GROSS_TICKS } from "@shared/music/gross-beat-presets";
import { type AutomationPoint, PPQ } from "@shared/music/types";
import { type CurveBox, MIN_HANDLE_SEGMENT, curveTick, curveX, curveY, tensionHandle } from "../automation/curve-geometry";
import type { Palette } from "../piano/draw";
import { type GrossSnap, beatRows, gridLines, guides } from "./geometry";

export interface GrossScene {
  width: number;
  height: number;
  box: CurveBox;
  kind: GrossKind;
  points: readonly AutomationPoint[];
  snap: GrossSnap;
  /** Where the envelope is (ticks into its bar), while the song plays; null otherwise. */
  locator: number | null;
  /** A point to ring (the one under the pointer, or being dragged). */
  hot: number | null;
  frozen: boolean;
  palette: Palette;
  /** The envelope's colour (its kind's). */
  colour: string;
  /** The locator's. */
  playhead: string;
}

/** The colours that aren't the Piano roll's: each kind's, and the playhead's (read again when the theme changes). */
let cached: { key: string; colours: { time: string; volume: string; playhead: string } } | null = null;
export function grossColours(element: Element) {
  const key = `${document.documentElement.className}|${element.closest(".dark") !== null}`;
  if (cached?.key === key) return cached.colours;
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const colours = { time: read("--gross-time"), volume: read("--gross-volume"), playhead: read("--playhead") };
  cached = { key, colours };
  return colours;
}

export function drawPanel(ctx: CanvasRenderingContext2D, scene: GrossScene) {
  const { width, height, box, palette, kind } = scene;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.row;
  ctx.fillRect(0, 0, width, height);
  // Every second beat a shade darker, as the Piano roll's black rows are: the beats read at a glance.
  ctx.fillStyle = palette.blackRow;
  for (let beat = 1; beat < GROSS_BEATS; beat += 2) ctx.fillRect(Math.round(curveX(box, beat * PPQ)), 0, Math.round(PPQ * box.pxPerTick), height);

  // The grid: each snap step, each beat stronger, the bar's ends strongest.
  for (const line of gridLines(scene.snap)) {
    const x = Math.round(curveX(box, line.tick)) + 0.5;
    ctx.strokeStyle = line.tick === 0 || line.tick === GROSS_TICKS ? palette.barLine : line.beat ? palette.beatLine : palette.line;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  ctx.font = "10px var(--font-sans), sans-serif";
  ctx.textBaseline = "top";
  if (kind === "time") {
    // Each beat back, labelled at the left as FL's are.
    for (const row of beatRows()) {
      const y = Math.round(curveY(box, row.value)) + 0.5;
      ctx.strokeStyle = palette.beatLine;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillStyle = palette.rulerText;
      ctx.fillText(String(row.beats), box.x0 + 3, y + 2);
    }
    drawGuides(ctx, scene);
  } else {
    for (const level of [0.25, 0.5, 0.75]) {
      const y = Math.round(curveY(box, level)) + 0.5;
      ctx.strokeStyle = level === 0.5 ? palette.beatLine : palette.line;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  // The name, faint in the corner, as FL's panel has it.
  ctx.save();
  ctx.font = "600 22px var(--font-sans), sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = palette.foreground;
  ctx.fillText("YT-Time", width - 10, height - 6);
  ctx.restore();

  drawEnvelope(ctx, scene);

  if (scene.locator !== null) {
    const x = Math.round(curveX(box, scene.locator)) + 0.5;
    ctx.strokeStyle = scene.playhead;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

/** The safety line (dark, solid) and the reverse guides (faint, dashed). */
function drawGuides(ctx: CanvasRenderingContext2D, scene: GrossScene) {
  const { box, palette } = scene;
  const { safety, reverse } = guides();
  const line = ([t0, v0, t1, v1]: [number, number, number, number]) => {
    ctx.beginPath();
    ctx.moveTo(curveX(box, t0), curveY(box, v0));
    ctx.lineTo(curveX(box, t1), curveY(box, v1));
    ctx.stroke();
  };
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = palette.beatLine;
  for (const guide of reverse) line(guide);
  ctx.restore();
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = palette.barLine;
  line(safety);
  ctx.restore();
}

function drawEnvelope(ctx: CanvasRenderingContext2D, scene: GrossScene) {
  const { box, points, height, colour } = scene;
  const from = Math.floor(curveX(box, 0));
  const to = Math.ceil(curveX(box, GROSS_TICKS));
  // A column at a time: stairs, pulses and waves change faster than their points, and a jump is drawn
  // as a straight drop within its column.
  const ys: number[] = [];
  for (let x = from; x <= to; x++) ys.push(curveY(box, curveValue(points, Math.min(GROSS_TICKS, Math.max(0, curveTick(box, x))))));
  ctx.save();
  if (scene.frozen) ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(from, height);
  ys.forEach((y, i) => ctx.lineTo(from + i, y));
  ctx.lineTo(to, height);
  ctx.closePath();
  ctx.globalAlpha *= 0.2;
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.globalAlpha /= 0.2;
  ctx.beginPath();
  ys.forEach((y, i) => (i ? ctx.lineTo(from + i, y) : ctx.moveTo(from, y)));
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.lineWidth = 1;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    // Tension handles: hollow, half-way along each segment wide enough to grab one.
    if (i > 0 && (point.tick - points[i - 1].tick) * box.pxPerTick > MIN_HANDLE_SEGMENT) {
      const handle = tensionHandle(points, i, box);
      if (handle) {
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, 3, 0, Math.PI * 2);
        ctx.strokeStyle = colour;
        ctx.stroke();
      }
    }
    const hot = scene.hot === i;
    ctx.beginPath();
    ctx.arc(curveX(box, point.tick), curveY(box, point.value), hot ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = hot ? colour : scene.palette.row;
    ctx.fill();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  ctx.restore();
}
