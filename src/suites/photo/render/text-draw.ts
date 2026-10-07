/**
 * A text layer's words drawn into its raster (docs/photo/tools/type.md, "Drawing it"): laid out as the editing field
 * lays them out (`layoutText` with this computer's fonts), each line from its origin through the layer's matrix, its
 * coverage in white (the layer's colour is applied exactly afterwards: `tint`).
 */
import type { TextContent } from "@shared/photo/canvas-content";
import type { Affine } from "@shared/photo/layers";
import { layoutText } from "@shared/photo/text";
import { measurerFor, setTextFont } from "../text-measure";

export function drawText(ctx: OffscreenCanvasRenderingContext2D, text: TextContent, matrix: Affine): { tint: string } {
  const m = measurerFor(text, ctx);
  const layout = layoutText(text, m);
  ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
  ctx.translate(text.origin.x, text.origin.y);
  setTextFont(ctx, text);
  ctx.fillStyle = "#ffffff";
  for (const line of layout.lines) {
    const words = text.text.slice(line.start, line.end);
    if (!words) continue;
    if (!line.gap) {
      ctx.fillText(words, line.x, line.baseline);
      continue;
    }
    // Justified: each word where its spaces, widened, put it.
    let x = line.x;
    for (const part of words.split(/( )/)) {
      if (part === " ") x += m.width(" ") + line.gap;
      else if (part) {
        ctx.fillText(part, x, line.baseline);
        x += m.width(part);
      }
    }
  }
  return { tint: text.colour };
}
