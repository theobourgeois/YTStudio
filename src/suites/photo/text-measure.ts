/**
 * Text measured and drawn by the browser's own text engine (docs/photo/tools/type.md): a 2D canvas set in a text's
 * font, letter spacing and stretch. The layout (`shared/photo/text.ts`), the frames the edits keep, the editing
 * `<textarea>` and the renderer's rasters all measure here, so what's typed lines up with what's drawn.
 */
import { type FrameText, type TextMeasurer, type TextSpec, cssFont, layoutText, letterSpacingOf, textFrame } from "@shared/photo/text";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let shared: Ctx | null = null;
function measureContext(): Ctx {
  shared ??= typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("2d")! : document.createElement("canvas").getContext("2d")!;
  return shared;
}

/** Sets a 2D context to draw or measure a text: its font, stretch and letter spacing. */
export function setTextFont(ctx: Ctx, spec: Pick<TextSpec, "font" | "tracking">) {
  ctx.font = cssFont(spec.font);
  ctx.fontStretch = (spec.font.stretch ?? "normal") as CanvasFontStretch;
  ctx.letterSpacing = `${letterSpacingOf(spec)}px`;
  ctx.fontKerning = "normal";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

/**
 * A measurer for a text's font. Its ascent and descent are whole pixels, as Chrome's CSS layout rounds a font's (so a
 * `<textarea>`'s baseline is where the layout puts it).
 */
export function measurerFor(spec: Pick<TextSpec, "font" | "tracking">, ctx: Ctx = measureContext()): TextMeasurer {
  setTextFont(ctx, spec);
  const sample = ctx.measureText("Hg");
  const widths = new Map<string, number>();
  return {
    ascent: Math.round(sample.fontBoundingBoxAscent ?? spec.font.size * 0.8),
    descent: Math.round(sample.fontBoundingBoxDescent ?? spec.font.size * 0.2),
    width(text) {
      let w = widths.get(text);
      if (w === undefined) {
        setTextFont(ctx, spec);
        w = ctx.measureText(text).width;
        widths.set(text, w);
      }
      return w;
    },
    ink(text) {
      setTextFont(ctx, spec);
      const m = ctx.measureText(text);
      return { left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
    },
  };
}

/** A text's frame as this computer's fonts set it: what the edits keep (`FrameText`). */
export const frameText: FrameText = (spec) => textFrame(spec, measurerFor(spec));

/** A text laid out with this computer's fonts. */
export const layoutWithFonts = (spec: TextSpec) => layoutText(spec, measurerFor(spec));
