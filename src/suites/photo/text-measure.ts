/**
 * Text measured and drawn by the browser's own text engine (docs/photo/tools/type.md): a 2D canvas set in a text's
 * font, letter spacing and stretch. The layout (`shared/photo/text.ts`), the frames the edits keep, the editing
 * `<textarea>` and the renderer's rasters all measure here, so what's typed lines up with what's drawn.
 */
import { type FrameText, type TextMeasurer, type TextSpec, cssFont, layoutText, letterSpacingOf, shownText, textFrame, textScale } from "@shared/photo/text";
import type { TextCharacter } from "@shared/photo/types";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let shared: Ctx | null = null;
function measureContext(): Ctx {
  shared ??= typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("2d")! : document.createElement("canvas").getContext("2d")!;
  return shared;
}

/** What a measurer and the drawing set a context by. */
type FontSpec = Pick<TextSpec, "font" | "tracking"> & TextCharacter;

/** Sets a 2D context to draw or measure a text: its font, stretch, letter spacing, kerning and small caps. */
export function setTextFont(ctx: Ctx, spec: FontSpec) {
  ctx.font = cssFont(spec.font);
  ctx.fontStretch = (spec.font.stretch ?? "normal") as CanvasFontStretch;
  ctx.letterSpacing = `${letterSpacingOf(spec)}px`;
  ctx.fontKerning = spec.kerning === "none" ? "none" : "normal";
  ctx.fontVariantCaps = spec.caps === "small" ? "small-caps" : "normal";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

/**
 * A measurer for a text's font, its glyphs scaled (horizontal and vertical scale) and in capitals for All Caps. Its
 * ascent and descent are whole pixels before the scale, as Chrome's CSS layout rounds a font's (so a `<textarea>` set
 * unscaled and scaled as a whole has its baseline where the layout puts it).
 */
export function measurerFor(spec: FontSpec, ctx: Ctx = measureContext()): TextMeasurer {
  setTextFont(ctx, spec);
  const sample = ctx.measureText("Hg");
  const widths = new Map<string, number>();
  const scale = textScale(spec);
  return {
    ascent: Math.round(sample.fontBoundingBoxAscent ?? spec.font.size * 0.8) * scale.y,
    descent: Math.round(sample.fontBoundingBoxDescent ?? spec.font.size * 0.2) * scale.y,
    width(text) {
      let w = widths.get(text);
      if (w === undefined) {
        setTextFont(ctx, spec);
        w = ctx.measureText(shownText(spec, text)).width * scale.x;
        widths.set(text, w);
      }
      return w;
    },
    ink(text) {
      setTextFont(ctx, spec);
      const m = ctx.measureText(shownText(spec, text));
      return { left: m.actualBoundingBoxLeft * scale.x, right: m.actualBoundingBoxRight * scale.x, ascent: m.actualBoundingBoxAscent * scale.y, descent: m.actualBoundingBoxDescent * scale.y };
    },
  };
}

/** A text's frame as this computer's fonts set it: what the edits keep (`FrameText`). */
export const frameText: FrameText = (spec) => textFrame(spec, measurerFor(spec));

/** A text laid out with this computer's fonts. */
export const layoutWithFonts = (spec: TextSpec) => layoutText(spec, measurerFor(spec));
