/**
 * Lays out and draws a text clip with the browser's own text engine, so any
 * installed font works. The preview draws it on a <canvas> each time it
 * changes, the export sends the same drawing at the output size, and the
 * on-canvas text editor lines a <textarea> up with the layout, so all three
 * agree.
 *
 * Text is "point text" like Photoshop's: lines only break where the text has
 * a line break. The frame (what Motion places, scales and rotates) is the
 * text block plus a margin that fits the background box, the stroke, the
 * shadow and any glyphs that reach outside their line; the margin is the same
 * on both sides, so the text stays centred on the frame whatever it grows.
 * All lengths are canvas px; `unit` is canvas px per reference px (the style's
 * sizes are px of the canvas at 1080p).
 */
import { type TextStyle, applyTextCase } from "@shared/effects";
import { type TextAnimation, glyphSelections } from "@shared/text-animators";
import { outputSize } from "@shared/timeline";
import type { AspectRatio, FontStyleInfo } from "@shared/types";
import { resolveFace } from "@/stores/fonts";

export interface TextLine {
  text: string;
  /** Left edge of the line, from the left of the text block. */
  x: number;
  width: number;
}

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

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Draw the text into `ctx` (cleared first) at `scale` device px per canvas
 * px; the drawing covers `layout.width * scale` x `layout.height * scale`.
 */
export function drawText(ctx: Ctx, style: TextStyle, layout: TextLayout, unit: number, scale: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const spacingByHand = !setFont(ctx, layout);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // The shadow falls from the first thing drawn: the box, else the stroke, else the letters.
  // Canvas shadows ignore the transform, hence the manual scaling.
  let shadowPending = style.shadow > 0;
  const castShadow = (on: boolean) => {
    if (on) {
      const d = style.shadowDistance * unit * scale * Math.SQRT1_2;
      ctx.shadowColor = rgba(style.shadowColor, style.shadow);
      ctx.shadowOffsetX = d;
      ctx.shadowOffsetY = d;
      ctx.shadowBlur = style.shadowBlur * unit * scale;
    } else {
      ctx.shadowColor = "transparent";
    }
    shadowPending = false;
  };

  const eachLine = (paint: (text: string, x: number, y: number) => void) =>
    layout.lines.forEach((line, i) => {
      if (!line.text) return;
      const x = layout.x + line.x;
      const y = layout.y + i * layout.lineHeight + layout.baseline;
      if (!spacingByHand) return paint(line.text, x, y);
      let cx = x;
      for (const ch of line.text) {
        paint(ch, cx, y);
        cx += ctx.measureText(ch).width + layout.letterSpacing;
      }
    });

  if (style.background > 0) {
    castShadow(shadowPending);
    ctx.fillStyle = rgba(style.backgroundColor, style.background);
    ctx.beginPath();
    ctx.roundRect(
      layout.x - layout.padX,
      layout.y - layout.padY,
      layout.blockWidth + 2 * layout.padX,
      layout.blockHeight + 2 * layout.padY,
      layout.fontPx * 0.15,
    );
    ctx.fill();
  }
  // With animators, each letter is drawn on its own, where and how they put it.
  const glyphs = style.animators?.length ? animatedGlyphs(ctx, style, layout, unit, style.animators, spacingByHand) : null;
  const eachGlyph = (paint: (g: AnimatedGlyph) => void) => {
    for (const g of glyphs!) {
      ctx.save();
      ctx.globalAlpha = g.opacity;
      // Canvas filters are in device px, whatever the transform.
      if (g.blur > 0 && "filter" in ctx) ctx.filter = `blur(${g.blur * scale}px)`;
      for (const t of g.transforms) {
        ctx.translate(t.dx, t.dy);
        ctx.translate(t.cx, t.cy);
        ctx.rotate((t.rotation * Math.PI) / 180);
        ctx.scale(t.scale, t.scale);
        ctx.translate(-t.cx, -t.cy);
      }
      paint(g);
      ctx.restore();
    }
  };

  if (style.strokeWidth > 0) {
    castShadow(shadowPending);
    ctx.strokeStyle = style.strokeColor;
    // Centred on the outline, half of it hidden under the fill.
    ctx.lineWidth = 2 * style.strokeWidth * unit;
    ctx.lineJoin = "round";
    if (glyphs) eachGlyph((g) => ctx.strokeText(g.text, g.x, g.y));
    else eachLine((text, x, y) => ctx.strokeText(text, x, y));
  }
  castShadow(shadowPending);
  ctx.fillStyle = style.fill;
  if (glyphs) {
    eachGlyph((g) => {
      ctx.fillStyle = g.fill;
      ctx.fillText(g.text, g.x, g.y);
    });
  } else eachLine((text, x, y) => ctx.fillText(text, x, y));
}

/** One letter of an animated text: where it's drawn, and what its animators do to it. */
interface AnimatedGlyph {
  text: string;
  x: number;
  y: number;
  opacity: number;
  /** Canvas px. */
  blur: number;
  fill: string;
  /** One per animator that acts on it, in order: moved by (dx, dy), then turned and scaled around (cx, cy). */
  transforms: { dx: number; dy: number; cx: number; cy: number; rotation: number; scale: number }[];
}

function mixColor(a: string, b: string, f: number): string {
  if (f <= 0) return a;
  const [x, y] = [Number.parseInt(a.slice(1), 16), Number.parseInt(b.slice(1), 16)];
  const ch = (shift: number) => Math.round(((x >> shift) & 255) + (((y >> shift) & 255) - ((x >> shift) & 255)) * Math.min(1, f));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/**
 * Every letter of a text with what its animators do to it (see `shared/text-animators.ts`):
 * each animator acts on its own units (characters, words or lines), turning and scaling
 * them around their middle.
 */
function animatedGlyphs(ctx: Ctx, style: TextStyle, layout: TextLayout, unit: number, animators: TextAnimation[], spacingByHand: boolean): AnimatedGlyph[] {
  const lines = layout.lines.map((l) => l.text);
  const selections = animators.map((a) => glyphSelections(lines, a));
  const em = layout.fontPx;
  // Where each letter sits in its line, from the widths of the text before it (so kerning is kept).
  const placed = layout.lines.map((line, i) => {
    const chars = [...line.text];
    const edges = [0];
    let prefix = "";
    for (const [k, ch] of chars.entries()) {
      prefix += ch;
      edges.push(ctx.measureText(prefix).width + (spacingByHand ? (k + 1) * layout.letterSpacing : 0));
    }
    // Tracking from the animators opens the line up after each letter; the line stays aligned as it was.
    const extra = chars.map((_, k) => animators.reduce((sum, a, j) => sum + selections[j][i][k].amount * (a.tracking / 1000) * em, 0));
    const total = extra.reduce((a, b) => a + b, 0);
    const lead = style.align === "left" ? 0 : style.align === "right" ? -total : -total / 2;
    let shift = lead;
    const xs = chars.map((_, k) => {
      const x = layout.x + line.x + edges[k] + shift;
      shift += extra[k];
      return x;
    });
    return { chars, xs, widths: chars.map((_, k) => edges[k + 1] - edges[k]), y: layout.y + i * layout.lineHeight + layout.baseline };
  });
  // Each animator's units: the box around their letters, to turn and scale around its middle.
  const centres = animators.map((_, j) => {
    const boxes = new Map<number, { left: number; right: number; top: number; bottom: number }>();
    placed.forEach((line, i) => {
      line.chars.forEach((_, k) => {
        const { unit: u } = selections[j][i][k];
        if (u < 0) return;
        const box = boxes.get(u) ?? { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
        box.left = Math.min(box.left, line.xs[k]);
        box.right = Math.max(box.right, line.xs[k] + line.widths[k]);
        // About the middle of the letters: between the baseline and the capitals' tops.
        box.top = Math.min(box.top, line.y - em * 0.7);
        box.bottom = Math.max(box.bottom, line.y);
        boxes.set(u, box);
      });
    });
    return boxes;
  });
  const out: AnimatedGlyph[] = [];
  placed.forEach((line, i) => {
    line.chars.forEach((text, k) => {
      if (!text.trim()) return;
      const glyph: AnimatedGlyph = { text, x: line.xs[k], y: line.y, opacity: 1, blur: 0, fill: style.fill, transforms: [] };
      animators.forEach((a, j) => {
        const { unit: u, amount } = selections[j][i][k];
        if (!(amount > 0)) return;
        glyph.opacity *= 1 + amount * (a.opacity - 1);
        glyph.blur += amount * a.blur * unit;
        if (a.fill) glyph.fill = mixColor(glyph.fill.startsWith("#") ? glyph.fill : style.fill, a.fill, amount);
        const box = centres[j].get(u)!;
        glyph.transforms.push({
          dx: amount * a.position[0] * unit,
          dy: amount * a.position[1] * unit,
          cx: (box.left + box.right) / 2,
          cy: (box.top + box.bottom) / 2,
          rotation: amount * a.rotation,
          scale: 1 + amount * (a.scale - 1),
        });
      });
      if (glyph.opacity > 0) out.push(glyph);
    });
  });
  return out;
}

/** Largest side, in device px, a drawn text may have (browsers cap canvases). */
const MAX_SIDE = 8192;

/**
 * Device px per canvas px to draw a text at: `density` (e.g. the screen's
 * pixel ratio times the clip's scale), capped so the drawing stays a sane size.
 */
export function drawingScale(layout: TextLayout, density: number): number {
  const side = Math.max(layout.width, layout.height, 1);
  return Math.max(Math.min(density, MAX_SIDE / side), 1e-3);
}

/**
 * Size `canvas` for the text drawn `density` times sharper than canvas px (see
 * `drawingScale`) and draw it. Returns false when it already showed exactly
 * that drawing (`previous` is what the last call returned as `key`).
 */
export function rasterizeText(
  canvas: HTMLCanvasElement,
  style: TextStyle,
  layout: TextLayout,
  unit: number,
  density: number,
  previous?: string,
): { drawn: boolean; key: string } {
  const scale = drawingScale(layout, density);
  const width = Math.max(1, Math.ceil(layout.width * scale));
  const height = Math.max(1, Math.ceil(layout.height * scale));
  const key = JSON.stringify([style, layout.font, layout.stretch, unit, width, height]);
  if (key === previous) return { drawn: false, key };
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't get a 2D context to draw text.");
  drawText(ctx, style, layout, unit, scale);
  return { drawn: true, key };
}

/** Canvas px per reference px (the canvas at 1080p, which text sizes are given in). */
export function textUnit(canvas: { width: number }, aspect: AspectRatio): number {
  return canvas.width / outputSize(aspect, "1080p").width;
}

/** The CSS font a style is drawn in at `unit` (to load it before laying the text out). */
export function textFont(style: TextStyle, unit: number): string {
  return fontCss(resolveFace(style.font, style.fontStyle), style.font, style.size * unit);
}
