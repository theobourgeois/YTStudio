/**
 * Drawing an automation clip's curve (FL Studio's look, in the clip's colours): the line, the area under
 * it, its points and, where there's room, each segment's tension handle. The Playlist's clips, the
 * Picker's items and the automation window's preview all draw with this.
 */
import { automationValue, curveValue } from "@shared/music/automation";
import type { Automation } from "@shared/music/types";
import { type CurveBox, MIN_HANDLE_SEGMENT, curveTick, curveX, curveY, tensionHandle } from "./curve-geometry";

export interface CurveColours {
  /** The line, and the points' rims. */
  line: string;
  /** The points' fill (the clip's title colour). */
  point: string;
}

/**
 * Draw `automation`'s curve in `box`, from `left` to `right` px (the clip's window onto it). `detail`
 * draws the points and tension handles too (a clip tall enough to edit). `barTicks` is for the LFO,
 * drawn as a faint second line when it's on (what's heard, against the points that are edited).
 */
export function drawCurve(ctx: CanvasRenderingContext2D, automation: Automation, box: CurveBox, left: number, right: number, colours: CurveColours, detail: boolean, barTicks: number) {
  const from = Math.max(Math.floor(left), 0);
  const to = Math.ceil(right);
  if (to <= from || box.height < 4) return;
  const { points } = automation;
  const bottom = box.top + box.height;
  // The line, a column at a time (stairs, pulses and waves change faster than their points), and the area under it.
  const ys: number[] = [];
  for (let x = from; x <= to; x++) ys.push(curveY(box, curveValue(points, Math.max(0, curveTick(box, x)))));
  ctx.beginPath();
  ctx.moveTo(from, bottom);
  ys.forEach((y, i) => ctx.lineTo(from + i, y));
  ctx.lineTo(to, bottom);
  ctx.closePath();
  ctx.globalAlpha *= 0.22;
  ctx.fillStyle = colours.line;
  ctx.fill();
  ctx.globalAlpha /= 0.22;
  ctx.beginPath();
  ys.forEach((y, i) => (i ? ctx.lineTo(from + i, y) : ctx.moveTo(from, y)));
  ctx.strokeStyle = colours.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.lineWidth = 1;

  // With the LFO on: what's heard, a dotted line over the points (Min / Max squeeze it too).
  const { lfo } = automation;
  if (lfo.enabled && lfo.level !== 0) {
    ctx.save();
    ctx.setLineDash([2, 2]);
    ctx.globalAlpha *= 0.7;
    ctx.beginPath();
    const range = automation.max - automation.min;
    for (let x = from; x <= to; x++) {
      const heard = automationValue(automation, Math.max(0, curveTick(box, x)), barTicks);
      // Back to the curve's own 0..1, so it lines up with the points.
      const y = curveY(box, range === 0 ? 0.5 : (heard - automation.min) / range);
      if (x === from) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (!detail) return;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    // Tension handles: hollow, half-way along each segment wide enough to grab one.
    if (i > 0 && (point.tick - points[i - 1].tick) * box.pxPerTick > MIN_HANDLE_SEGMENT) {
      const handle = tensionHandle(points, i, box);
      if (handle && handle.x >= left - 3 && handle.x <= right + 3) {
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = colours.line;
        ctx.stroke();
      }
    }
    const x = curveX(box, point.tick);
    if (x < left - 4 || x > right + 4) continue;
    ctx.beginPath();
    ctx.arc(x, curveY(box, point.value), 3.25, 0, Math.PI * 2);
    ctx.fillStyle = colours.point;
    ctx.fill();
    ctx.strokeStyle = colours.line;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}
