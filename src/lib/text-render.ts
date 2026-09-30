/**
 * Lays out a text clip with the browser's own text engine, so any installed font works.
 * The layout is what the preview, the export and the on-canvas text editor (which lines a
 * <textarea> up with it) share; the drawing itself is the compositor's (`TextDrawing`, made
 * from a layout by `shared/text-drawing.ts`), so the preview and the export's page draw the
 * same text.
 *
 * All lengths are canvas px; `unit` is canvas px per reference px (the style's sizes are px
 * of the canvas at 1080p).
 */
import { type TextStyle, applyTextCase } from "@shared/effects";
import { type TextLayout, textUnit } from "@shared/text-drawing";
import type { FontStyleInfo } from "@shared/types";
import { resolveFace } from "@/stores/fonts";

export { textUnit };
export type { TextLayout, TextLine } from "@shared/text-drawing";

/** CSS `font` for a style at `px`. */
export function fontCss(face: FontStyleInfo, family: string, px: number): string {
  const quoted = `"${family.replace(/["\\]/g, "\\$&")}"`;
  return `${face.italic ? "italic " : ""}${face.weight} ${px}px ${quoted}, sans-serif`;
}

let measurer: CanvasRenderingContext2D | null | undefined;
function measureContext(): CanvasRenderingContext2D | null {
  if (measurer === undefined) measurer = document.createElement("canvas").getContext("2d");
  return measurer;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Canvas letter spacing (not in every browser yet); false when it has to be done by hand. */
function setFont(ctx: Ctx, layout: Pick<TextLayout, "font" | "stretch" | "letterSpacing">): boolean {
  ctx.font = layout.font;
  if ("fontStretch" in ctx) ctx.fontStretch = layout.stretch as CanvasFontStretch;
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = `${layout.letterSpacing}px`;
    return true;
  }
  return false;
}

const cache = new Map<string, TextLayout>();
const CACHE_SIZE = 200;

export function layoutText(style: TextStyle, unit: number): TextLayout {
  const face = resolveFace(style.font, style.fontStyle);
  // What the animators do at this moment changes the drawing, never the layout.
  const { animators: _, ...laidOut } = style;
  const key = JSON.stringify([laidOut, unit, face]);
  const hit = cache.get(key);
  if (hit) return hit;
  const layout = measure(style, unit, face);
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, layout);
  return layout;
}

function measure(style: TextStyle, unit: number, face: FontStyleInfo): TextLayout {
  const fontPx = style.size * unit;
  const lineHeight = fontPx * style.leading;
  const base = {
    font: fontCss(face, style.font, fontPx),
    stretch: face.stretch,
    fontPx,
    letterSpacing: (style.tracking / 1000) * fontPx,
  };
  const texts = applyTextCase(style.text, style.textCase).split("\n");
  const ctx = measureContext();
  const spacingByHand = ctx ? !setFont(ctx, base) : true;

  // Where CSS puts the baseline in a line (so the on-canvas editor lines up); canvas
  // metrics are an estimate of the same when there's no page to measure in.
  const sample = ctx?.measureText("Hg");
  const ascent = sample?.fontBoundingBoxAscent ?? fontPx * 0.8;
  const descent = sample?.fontBoundingBoxDescent ?? fontPx * 0.2;
  const baseline = cssBaseline(base.font, base.stretch, lineHeight) ?? (lineHeight - (ascent + descent)) / 2 + ascent;

  const measured = texts.map((text) => {
    const m = ctx?.measureText(text);
    const chars = [...text].length;
    const width = (m?.width ?? chars * fontPx * 0.6) + (spacingByHand ? chars * base.letterSpacing : 0);
    return { text, width, left: m?.actualBoundingBoxLeft ?? 0, right: m?.actualBoundingBoxRight ?? width,
      up: m?.actualBoundingBoxAscent ?? ascent, down: m?.actualBoundingBoxDescent ?? descent };
  });
  const blockWidth = Math.max(1, ...measured.map((l) => l.width));
  const blockHeight = texts.length * lineHeight;
  const lines = measured.map((l) => ({
    text: l.text,
    width: l.width,
    x: style.align === "left" ? 0 : style.align === "right" ? blockWidth - l.width : (blockWidth - l.width) / 2,
  }));

  // Glyphs reaching outside the block (italics, tight line spacing, big accents).
  let overX = 0;
  let overY = 0;
  measured.forEach((l, i) => {
    if (!l.text) return;
    const x = lines[i].x;
    const y = i * lineHeight + baseline;
    overX = Math.max(overX, -(x - l.left), x + l.right - blockWidth);
    overY = Math.max(overY, -(y - l.up), y + l.down - blockHeight);
  });

  const padX = fontPx * 0.3;
  const padY = fontPx * 0.12;
  const stroke = style.strokeWidth * unit;
  const shadow = style.shadow > 0 ? (style.shadowDistance + style.shadowBlur) * unit : 0;
  // Room for letters its animators move, grow or blur.
  const reach = (style.reach ?? 0) * unit;
  const x = Math.max(padX, overX + stroke) + shadow + reach;
  const y = Math.max(padY, overY + stroke) + shadow + reach;
  return {
    ...base,
    width: blockWidth + 2 * x,
    height: blockHeight + 2 * y,
    x,
    y,
    blockWidth,
    blockHeight,
    lines,
    lineHeight,
    baseline,
    padX,
    padY,
  };
}

/** The baseline of a line of text laid out by CSS, from the top of the line; null without a page. */
function cssBaseline(font: string, stretch: string, lineHeight: number): number | null {
  if (typeof document === "undefined" || !document.body) return null;
  const line = document.createElement("div");
  line.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden;white-space:pre";
  line.style.font = font;
  line.style.fontStretch = stretch;
  line.style.lineHeight = `${lineHeight}px`;
  const marker = document.createElement("span");
  marker.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  line.append("Hg", marker);
  document.body.append(line);
  const y = marker.getBoundingClientRect().top - line.getBoundingClientRect().top;
  line.remove();
  return Number.isFinite(y) ? y : null;
}

/** The CSS font a style is drawn in at `unit` (to load it before laying the text out). */
export function textFont(style: TextStyle, unit: number): string {
  return fontCss(resolveFace(style.font, style.fontStyle), style.font, style.size * unit);
}
