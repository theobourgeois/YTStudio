/**
 * A text layer's words drawn into its raster (docs/photo/tools/type.md, "Drawing it"): laid out as the editing field
 * lays them out (`layoutText` with this computer's fonts), each line from its origin through the layer's matrix, its
 * coverage in white (the layer's colour is applied exactly afterwards: `tint`).
 */
import type { TextContent } from "@shared/photo/canvas-content";
import type { Affine } from "@shared/photo/layers";
import { FAUX_BOLD_WIDTH, FAUX_ITALIC_SLANT, decorations, layoutText, lineAdvance, shownText, textScale } from "@shared/photo/text";
import { measurerFor, setTextFont } from "../text-measure";

/**
 * Its character settings are drawn here too: each piece of a line is drawn at its place on the baseline through its
 * glyphs' own map (horizontal and vertical scale, Faux Italic's slant about the baseline), Faux Bold strokes the
 * glyphs' outline as it fills them, and underline and strike-through are bars along the line.
 */
export function drawText(ctx: OffscreenCanvasRenderingContext2D, text: TextContent, matrix: Affine): { tint: string } {
  const m = measurerFor(text, ctx);
  const layout = layoutText(text, m);
  const scale = textScale(text);
  const slant = text.fauxItalic ? FAUX_ITALIC_SLANT : 0;
  const placed = () => {
    ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
    ctx.translate(text.origin.x, text.origin.y);
  };
  setTextFont(ctx, text);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = FAUX_BOLD_WIDTH * text.font.size;
  ctx.lineJoin = "round";
  const glyphs = (words: string, x: number, baseline: number) => {
    placed();
    ctx.translate(x, baseline);
    ctx.transform(scale.x, 0, -slant * scale.y, scale.y, 0, 0);
    const shown = shownText(text, words);
    ctx.fillText(shown, 0, 0);
    if (text.fauxBold) ctx.strokeText(shown, 0, 0);
  };
  const bars = decorations(text);
  for (const line of layout.lines) {
    const words = text.text.slice(line.start, line.end);
    if (!words) continue;
    if (!line.gap) glyphs(words, line.x, line.baseline);
    else {
      // Justified: each word where its spaces, widened, put it.
      let x = line.x;
      for (const part of words.split(/( )/)) {
        if (part === " ") x += m.width(" ") + line.gap;
        else if (part) {
          glyphs(part, x, line.baseline);
          x += m.width(part);
        }
      }
    }
    if (!bars.length || !words.trim()) continue;
    placed();
    for (const bar of bars) ctx.fillRect(line.x, line.baseline + bar.offset - bar.thickness / 2, lineAdvance(line), bar.thickness);
  }
  return { tint: text.colour };
}
