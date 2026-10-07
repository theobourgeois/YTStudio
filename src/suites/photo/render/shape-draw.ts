/**
 * Shape layers on a 2D canvas (docs/photo/tools/shapes.md): what `shared/photo/shape-drawing.ts` says a shape draws,
 * played as paths. A shape is a canvas layer (`canvas-content.ts`): its raster is drawn here in its own colours, at
 * document resolution, wherever it's rendered.
 */
import type { ShapeContent } from "@shared/photo/canvas-content";
import { type DrawItem, type PathCommand, shapeDrawing } from "@shared/photo/shape-drawing";

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** A path as the 2D canvas's. */
export function toPath2D(path: readonly PathCommand[]): Path2D {
  const p = new Path2D();
  for (const c of path) {
    if (c[0] === "M") p.moveTo(c[1], c[2]);
    else if (c[0] === "L") p.lineTo(c[1], c[2]);
    else if (c[0] === "C") p.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else p.closePath();
  }
  return p;
}

/** What a shape draws, on a 2D context already placed (its transform maps document pixels to the context's). */
export function drawItems(ctx: Ctx2D, items: readonly DrawItem[]) {
  for (const item of items) {
    const path = toPath2D(item.path);
    if (item.kind === "fill") {
      ctx.fillStyle = item.colour;
      ctx.fill(path, "nonzero");
      continue;
    }
    ctx.save();
    if (item.clip) {
      const clip = toPath2D(item.clip.path);
      if (item.clip.outside) {
        // Everything but the outline: a huge rectangle around it, the outline taken out by the even-odd rule.
        const outside = new Path2D();
        outside.rect(-1e7, -1e7, 2e7, 2e7);
        outside.addPath(clip);
        ctx.clip(outside, "evenodd");
      } else ctx.clip(clip);
    }
    ctx.strokeStyle = item.colour;
    ctx.lineWidth = item.width;
    ctx.lineCap = item.cap;
    ctx.lineJoin = item.join;
    ctx.miterLimit = 10;
    ctx.setLineDash(item.dash);
    ctx.stroke(path);
    ctx.restore();
  }
}

/**
 * A shape into a raster whose top-left is document point (x, y): its drawing is in document pixels (strokes keep
 * their width whatever the transform), so only that offset places it. Its own colours: no tint.
 */
export function drawShape(ctx: Ctx2D, content: ShapeContent, x: number, y: number): { tint: null } {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, -x, -y);
  drawItems(ctx, shapeDrawing(content).items);
  ctx.restore();
  return { tint: null };
}
