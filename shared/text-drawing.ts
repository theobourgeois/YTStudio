/**
 * A text clip's picture, in two steps. The browser tab lays the text out (`TextLayout`,
 * `src/lib/text-render.ts`): only it knows the user's fonts and can measure them. From a
 * layout and the text's style at a moment, `textDrawing` says what to draw (pure, so the
 * export's plan makes it too), and the compositor draws that with the 2D canvas at whatever
 * size the text is shown (`TextDrawing` in `compositor.ts`), in the preview and in the
 * export's page alike.
 */
import type { TextDrawing } from "./compositor.ts";
import type { TextStyle } from "./effects.ts";
import { isFiniteNumber } from "./math.ts";
import { glyphSelections } from "./text-animators.ts";
import { outputSize } from "./timeline.ts";
import type { AspectRatio } from "./types.ts";

export interface TextLine {
  text: string;
  /** Left edge of the line, from the left of the text block. */
  x: number;
  width: number;
}

/**
 * How a text is laid out. Text is "point text" like Photoshop's: lines only break where
 * the text has a line break. The frame (what Motion places, scales and rotates) is the
 * text block plus a margin that fits the background box, the stroke, the shadow, what its
 * animators do and any glyphs that reach outside their line; the margin is the same on
 * both sides, so the text stays centred on the frame whatever it grows. All lengths are
 * canvas px.
 */
export interface TextLayout {
  /** The frame at 100%. */
  width: number;
  height: number;
  /** Top-left of the text block in the frame (the margin on each side). */
  x: number;
  y: number;
  blockWidth: number;
  blockHeight: number;
  lines: TextLine[];
  lineHeight: number;
  /** First baseline, from the top of the block. */
  baseline: number;
  /** How far the background box reaches past the block. */
  padX: number;
  padY: number;
  /** CSS `font` shorthand, plus the width (not part of the shorthand in canvas). */
  font: string;
  stretch: string;
  fontPx: number;
  letterSpacing: number;
}

/** Canvas px per reference px (the canvas at 1080p, which text sizes are given in). */
export function textUnit(canvas: { width: number }, aspect: AspectRatio): number {
  return canvas.width / outputSize(aspect, "1080p").width;
}

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * What the compositor draws for a text with this style, laid out like this, at `unit`
 * canvas px per reference px (the style's sizes are px of the canvas at 1080p).
 */
export function textDrawing(style: TextStyle, layout: TextLayout, unit: number): TextDrawing {
  const lines = layout.lines.map((line, i) => ({ text: line.text, x: layout.x + line.x, y: layout.y + i * layout.lineHeight + layout.baseline }));
  const texts = lines.map((l) => l.text);
  return {
    width: layout.width,
    height: layout.height,
    font: layout.font,
    stretch: layout.stretch,
    fontPx: layout.fontPx,
    letterSpacing: layout.letterSpacing,
    align: style.align,
    lines,
    fill: style.fill,
    ...(style.strokeWidth > 0 && { stroke: { color: style.strokeColor, width: style.strokeWidth * unit } }),
    ...(style.background > 0 && {
      box: {
        color: rgba(style.backgroundColor, style.background),
        x: layout.x - layout.padX,
        y: layout.y - layout.padY,
        width: layout.blockWidth + 2 * layout.padX,
        height: layout.blockHeight + 2 * layout.padY,
        radius: layout.fontPx * 0.15,
      },
    }),
    ...(style.shadow > 0 && {
      shadow: { color: rgba(style.shadowColor, style.shadow), offset: style.shadowDistance * unit * Math.SQRT1_2, blur: style.shadowBlur * unit },
    }),
    ...(style.animators?.length && {
      animators: style.animators.map((a) => ({
        position: [a.position[0] * unit, a.position[1] * unit] as [number, number],
        scale: a.scale,
        rotation: a.rotation,
        opacity: a.opacity,
        blur: a.blur * unit,
        tracking: (a.tracking / 1000) * layout.fontPx,
        fill: a.fill,
        glyphs: glyphSelections(texts, a),
      })),
    }),
  };
}

const MAX_LINES = 2000;
const MAX_SIDE = 100_000;

/** A layout from an export request (the tab measured it), or null when it isn't a sane one. */
export function sanitizeTextLayout(raw: unknown): TextLayout | null {
  const l = raw as Partial<TextLayout> | null;
  if (!l || typeof l !== "object") return null;
  const size = (v: unknown, min = 0) => isFiniteNumber(v) && v >= min && v <= MAX_SIDE;
  const any = (v: unknown) => isFiniteNumber(v) && Math.abs(v) <= MAX_SIDE;
  if (!size(l.width, 1e-6) || !size(l.height, 1e-6) || !size(l.blockWidth) || !size(l.blockHeight) || !size(l.lineHeight) || !size(l.fontPx)) return null;
  if (!any(l.x) || !any(l.y) || !any(l.baseline) || !any(l.padX) || !any(l.padY) || !any(l.letterSpacing)) return null;
  if (typeof l.font !== "string" || !l.font || l.font.length > 500 || typeof l.stretch !== "string" || l.stretch.length > 50) return null;
  if (!Array.isArray(l.lines) || l.lines.length > MAX_LINES) return null;
  const lines: TextLine[] = [];
  for (const line of l.lines as Partial<TextLine>[]) {
    if (!line || typeof line.text !== "string" || line.text.length > 10_000 || !any(line.x) || !size(line.width)) return null;
    lines.push({ text: line.text, x: line.x!, width: line.width! });
  }
  return {
    width: l.width!, height: l.height!, x: l.x!, y: l.y!, blockWidth: l.blockWidth!, blockHeight: l.blockHeight!, lines,
    lineHeight: l.lineHeight!, baseline: l.baseline!, padX: l.padX!, padY: l.padY!, font: l.font, stretch: l.stretch, fontPx: l.fontPx!, letterSpacing: l.letterSpacing!,
  };
}
