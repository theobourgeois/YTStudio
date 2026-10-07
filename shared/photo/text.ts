/**
 * Text layers' words laid out (docs/photo/tools/type.md, "Layout"), pure: lines broken and placed by a measurer the
 * caller gives (the tab's 2D canvas in the layer's font; a fixed-width one in tests), the frame a layer keeps, the
 * character under a point, and the edits that make and change text layers. The renderer draws what `layoutText`
 * says; the editing `<textarea>` lines up with it because both put the baseline where CSS does.
 *
 * Text space: the origin is point text's anchor (the first baseline, at the alignment's point) or paragraph text's
 * box's top-left; x right, y down, in layer pixels.
 */
import type { Size } from "./geometry.ts";
import { apply, layerMatrix } from "./layers.ts";
import type { LayerTransform, PhotoProject, TextAlign, TextFont, TextLayer } from "./types.ts";

/** What lays a text out: the words and their setting (a text layer's, or one being made). */
export type TextSpec = Pick<TextLayer, "text" | "font" | "align" | "leading" | "tracking" | "box">;

/** Measures text in one font, letter spacing included (after every character, as CSS and the canvas add it). */
export interface TextMeasurer {
  /** The advance of `text`. */
  width(text: string): number;
  /** The glyphs' ink, drawn from x = 0 on the baseline: how far it reaches left of 0, right, up and down. */
  ink(text: string): { left: number; right: number; ascent: number; descent: number };
  /** The font's ascent and descent (its line box: CSS's content area). */
  ascent: number;
  descent: number;
}

export interface TextLine {
  /** Where its characters are in the words: [start, end). */
  start: number;
  end: number;
  text: string;
  /** Where it starts (text space) and its baseline. */
  x: number;
  baseline: number;
  /** Its advance (paragraph text: trailing spaces left out, as they hang). */
  width: number;
  /** Justified lines: extra pixels after each space. */
  gap: number;
}

export interface TextLayout {
  /** Only the lines shown (a paragraph's lines below its box are hidden). */
  lines: TextLine[];
  lineHeight: number;
  /** The baseline's place in a line box, from its top (CSS's: half the leading above the ascent). */
  baselineOffset: number;
  /** The top of the first line box (text space). */
  top: number;
  /** The widest line's advance. */
  width: number;
}

const isColour = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

export const AUTO_LEADING = 1.2;
export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 5000;
export const MAX_TEXT_LENGTH = 100_000;

/** Pixels between baselines: the leading, or Auto's 120% of the size. */
export const leadingOf = (spec: Pick<TextSpec, "leading" | "font">) => spec.leading ?? AUTO_LEADING * spec.font.size;

/** Tracking as CSS letter spacing, in pixels. */
export const letterSpacingOf = (spec: Pick<TextSpec, "tracking" | "font">) => (spec.tracking / 1000) * spec.font.size;

/** The CSS `font` shorthand that selects a text's face at its size (the canvas's and the editing field's). */
export function cssFont(font: TextFont, size = font.size): string {
  const quoted = `"${font.family.replace(/["\\]/g, "\\$&")}"`;
  return `${font.italic ? "italic " : ""}${font.weight} ${size}px ${quoted}, sans-serif`;
}

/** Splits a paragraph (no "\n") into wrapped lines of at most `max` pixels: [start, end) offsets within it. */
function wrap(text: string, max: number, m: TextMeasurer): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  let end = 0;
  const tokens = text.match(/ +|[^ ]+/g) ?? [];
  let at = 0;
  for (const token of tokens) {
    const from = at;
    at += token.length;
    if (token[0] === " ") {
      // Spaces stay on the line they follow (they hang past its end).
      end = at;
      continue;
    }
    const fits = (a: number, b: number) => m.width(text.slice(a, b).trimEnd()) <= max + 1e-6;
    if (end > start && !fits(start, at)) {
      out.push([start, end]);
      start = from;
    }
    end = at;
    // A word wider than the box breaks between characters (a textarea's overflow-wrap).
    while (!fits(start, end)) {
      let cut = start + 1;
      while (cut < end && fits(start, cut + 1)) cut++;
      out.push([start, cut]);
      start = cut;
    }
  }
  out.push([start, end]);
  return out;
}

/** Lays out a text: its lines, where each starts and its baseline, in text space. */
export function layoutText(spec: TextSpec, m: TextMeasurer): TextLayout {
  const lineHeight = leadingOf(spec);
  const baselineOffset = (lineHeight - (m.ascent + m.descent)) / 2 + m.ascent;
  const box = spec.box;
  const lines: TextLine[] = [];
  let offset = 0;
  for (const paragraph of spec.text.split("\n")) {
    const ranges: [number, number][] = box ? wrap(paragraph, box.width, m) : [[0, paragraph.length]];
    ranges.forEach(([a, b], i) => {
      const raw = paragraph.slice(a, b);
      const text = box ? raw.trimEnd() : raw;
      const last = i === ranges.length - 1;
      const width = m.width(text);
      let gap = 0;
      if (box && spec.align === "justify" && !last) {
        const spaces = text.split(" ").length - 1;
        if (spaces > 0) gap = Math.max(0, (box.width - width) / spaces);
      }
      lines.push({ start: offset + a, end: offset + b, text: raw, x: 0, baseline: 0, width, gap });
    });
    offset += paragraph.length + 1;
  }
  const top = box ? 0 : -baselineOffset;
  const shown = box ? lines.filter((_, i) => i === 0 || top + (i + 1) * lineHeight <= box.height + 1e-6) : lines;
  shown.forEach((line, i) => {
    line.baseline = top + baselineOffset + i * lineHeight;
    const room = box ? box.width : 0;
    const align = !box && spec.align === "justify" ? "left" : spec.align;
    line.x = align === "center" ? (room - line.width) / 2 : align === "right" ? room - line.width : 0;
  });
  return { lines: shown, lineHeight, baselineOffset, top, width: Math.max(0, ...shown.map((l) => l.width)) };
}

/** A text's frame: its size in layer pixels, and where its origin is in it. */
export interface TextFrame {
  size: Size;
  origin: { x: number; y: number };
  /** The first baseline's y from the origin (0 for point text). Not kept: it's for converting between kinds. */
  firstBaseline?: number;
}

/**
 * The frame a text layer keeps: its lines' boxes and the glyphs' ink (paragraph text: its box too), rounded out to
 * whole pixels with one to spare for antialiasing.
 */
export function textFrame(spec: TextSpec, m: TextMeasurer, layout = layoutText(spec, m)): TextFrame {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    x0 = Math.min(x0, ax);
    y0 = Math.min(y0, ay);
    x1 = Math.max(x1, bx);
    y1 = Math.max(y1, by);
  };
  for (const line of layout.lines) {
    // A caret's width at least, so an empty line has somewhere to be.
    add(line.x, line.baseline - m.ascent, line.x + Math.max(1, line.width + line.gap * (line.text.split(" ").length - 1)), line.baseline + m.descent);
    if (line.text.trim()) {
      const ink = m.ink(line.text);
      add(line.x - ink.left, line.baseline - ink.ascent, line.x + ink.right, line.baseline + ink.descent);
    }
  }
  if (spec.box) add(0, 0, spec.box.width, spec.box.height);
  const fx = Math.floor(x0) - 1;
  const fy = Math.floor(y0) - 1;
  return { size: { width: Math.ceil(x1) + 1 - fx, height: Math.ceil(y1) + 1 - fy }, origin: { x: -fx, y: -fy }, firstBaseline: layout.lines[0]?.baseline ?? 0 };
}

/** The character offset nearest a point in text space (where a click puts the caret). */
export function caretAt(spec: TextSpec, layout: TextLayout, m: TextMeasurer, x: number, y: number): number {
  if (!layout.lines.length) return 0;
  const i = Math.max(0, Math.min(layout.lines.length - 1, Math.floor((y - layout.top) / layout.lineHeight)));
  const line = layout.lines[i];
  const text = spec.text.slice(line.start, line.end);
  let best = line.start;
  let bestDistance = Infinity;
  for (let k = 0; k <= text.length; k++) {
    const prefix = text.slice(0, k);
    const at = line.x + m.width(prefix) + line.gap * (prefix.split(" ").length - 1);
    const d = Math.abs(at - x);
    if (d < bestDistance) {
      bestDistance = d;
      best = line.start + k;
    }
  }
  // A wrapped line's hanging spaces: the caret stops before the next line's first character.
  return Math.min(best, line.end);
}

// --- making and changing text layers ---

/** Works out a text's frame (the tab measures with the browser's fonts; the assistant's edits are handed it). */
export type FrameText = (spec: TextSpec) => TextFrame;

/** A text layer's name while it follows its words (Photoshop's): its first line, shortened. */
export function nameFromText(text: string): string {
  const first = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  return first ? (first.length > 40 ? `${first.slice(0, 39)}…` : first) : "Text";
}

/** The setting new text gets when nothing says otherwise. */
export const DEFAULT_TEXT_FONT: TextFont = { family: "Arial", style: "Regular", weight: 400, italic: false, size: 72 };

/** Where a text's origin is on the canvas (document pixels). */
export function originPoint(layer: Pick<TextLayer, "transform" | "size" | "origin">) {
  return apply(layerMatrix(layer.transform, layer.size), layer.origin.x, layer.origin.y);
}

/** The transform that puts a frame's origin on document point `at`, keeping `t`'s scale and rotation. */
export function placeOrigin(t: Pick<LayerTransform, "scaleX" | "scaleY" | "rotation">, frame: TextFrame, at: { x: number; y: number }): LayerTransform {
  const r = (t.rotation * Math.PI) / 180;
  const u = (frame.origin.x - frame.size.width / 2) * t.scaleX;
  const v = (frame.origin.y - frame.size.height / 2) * t.scaleY;
  return { x: at.x - (Math.cos(r) * u - Math.sin(r) * v), y: at.y - (Math.sin(r) * u + Math.cos(r) * v), scaleX: t.scaleX, scaleY: t.scaleY, rotation: t.rotation };
}

export interface NewTextLayer {
  id: string;
  text?: string;
  font?: TextFont;
  colour?: string;
  align?: TextAlign;
  leading?: number | null;
  tracking?: number;
  /** Paragraph text's box (document pixels at 100%); absent: point text. */
  box?: { width: number; height: number } | null;
  /** Where its origin goes: point text's first baseline, a paragraph box's top-left. */
  at: { x: number; y: number };
  name?: string;
}

/** A new text layer, its frame measured, its origin on `at`. */
export function makeTextLayer(layer: NewTextLayer, frameOf: FrameText): TextLayer {
  const { stretch, ...face } = layer.font ?? DEFAULT_TEXT_FONT;
  const spec: TextSpec = {
    text: (layer.text ?? "").slice(0, MAX_TEXT_LENGTH),
    font: { ...face, ...(stretch && stretch !== "normal" ? { stretch } : {}), size: Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, face.size)) },
    align: layer.align ?? "left",
    leading: layer.leading ?? null,
    tracking: layer.tracking ?? 0,
    box: layer.box ? { width: Math.max(1, layer.box.width), height: Math.max(1, layer.box.height) } : null,
  };
  const frame = frameOf(spec);
  return {
    id: layer.id,
    kind: "text",
    name: layer.name?.trim() || nameFromText(spec.text),
    visible: true,
    opacity: 1,
    ...spec,
    colour: layer.colour && isColour(layer.colour) ? layer.colour.toLowerCase() : "#000000",
    size: frame.size,
    origin: frame.origin,
    transform: placeOrigin({ scaleX: 1, scaleY: 1, rotation: 0 }, frame, layer.at),
  };
}

/** A new text layer above `above` (an id), or on top. */
export function addTextLayer(doc: PhotoProject, layer: TextLayer, above?: string | null): PhotoProject {
  if (doc.layers.some((l) => l.id === layer.id)) return doc;
  const layers = [...doc.layers];
  const at = above ? layers.findIndex((l) => l.id === above) : -1;
  layers.splice(at >= 0 ? at + 1 : layers.length, 0, layer);
  return { ...doc, layers };
}

/** What `setText` may change. */
export type TextPatch = Partial<Pick<TextLayer, "text" | "colour" | "align" | "leading" | "tracking" | "box">> & { font?: Partial<TextFont> };

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Changes a text layer's words or setting (Photoshop's restyling of a whole layer): its frame measured again and its
 * origin kept where it was on the canvas; its name follows its words while it was theirs. The same document when
 * nothing changes, or when `id` isn't a text layer.
 */
export function setText(doc: PhotoProject, id: string, patch: TextPatch, frameOf: FrameText): PhotoProject {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== id || l.kind !== "text") return l;
    const next = patchText(l, patch, frameOf);
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

/** `setText` on several layers at once (the options bar restyling every selected text layer). */
export function setTexts(doc: PhotoProject, ids: readonly string[], patch: TextPatch, frameOf: FrameText): PhotoProject {
  return ids.reduce((d, id) => setText(d, id, patch, frameOf), doc);
}

function patchText(l: TextLayer, patch: TextPatch, frameOf: FrameText, at?: { x: number; y: number }): TextLayer {
  const spec: TextSpec = {
    text: patch.text !== undefined ? patch.text.slice(0, MAX_TEXT_LENGTH) : l.text,
    font: patch.font ? { ...l.font, ...patch.font } : l.font,
    align: patch.align ?? l.align,
    leading: patch.leading !== undefined ? patch.leading : l.leading,
    tracking: patch.tracking ?? l.tracking,
    box: patch.box !== undefined ? (patch.box ? { width: Math.max(1, patch.box.width), height: Math.max(1, patch.box.height) } : null) : l.box,
  };
  if (spec.font.size !== l.font.size) spec.font = { ...spec.font, size: Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, spec.font.size)) };
  if (spec.font.stretch === "normal" || spec.font.stretch === undefined) {
    const { stretch: _, ...rest } = spec.font;
    spec.font = rest;
  }
  const colour = patch.colour && isColour(patch.colour) ? patch.colour.toLowerCase() : l.colour;
  const same = spec.text === l.text && sameJson(spec.font, l.font) && spec.align === l.align && spec.leading === l.leading && spec.tracking === l.tracking && sameJson(spec.box, l.box);
  if (same && colour === l.colour && !at) return l;
  const name = l.name === nameFromText(l.text) ? nameFromText(spec.text) : l.name;
  if (same && !at) return { ...l, colour, name };
  const frame = frameOf(spec);
  // The origin stays where it was; turned from point text into paragraph text (or back), the first baseline does.
  let anchor = at ?? originPoint(l);
  if (!at && !l.box !== !spec.box) {
    const was = apply(layerMatrix(l.transform, l.size), l.origin.x, l.origin.y + (frameOf(l).firstBaseline ?? 0));
    const t = placeOrigin(l.transform, frame, was);
    anchor = apply(layerMatrix(t, frame.size), frame.origin.x, frame.origin.y - (frame.firstBaseline ?? 0));
  }
  const { firstBaseline: _, ...kept } = frame;
  return { ...l, ...spec, colour, name, size: kept.size, origin: kept.origin, transform: placeOrigin(l.transform, frame, anchor) };
}

/**
 * A paragraph box resized by its handles: `rect` is the new box in `from`'s frame (the layer as the drag began), so its
 * top-left can move too; the words reflow.
 */
export function resizeTextBox(doc: PhotoProject, from: TextLayer, rect: { x0: number; y0: number; x1: number; y1: number }, frameOf: FrameText): PhotoProject {
  const at = apply(layerMatrix(from.transform, from.size), Math.min(rect.x0, rect.x1), Math.min(rect.y0, rect.y1));
  const box = { width: Math.max(1, Math.abs(rect.x1 - rect.x0)), height: Math.max(1, Math.abs(rect.y1 - rect.y0)) };
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== from.id || l.kind !== "text") return l;
    const next = patchText({ ...l, transform: from.transform, size: from.size, origin: from.origin }, { box }, frameOf, at);
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

/** A text layer's fields from untrusted values, each repaired to its default when it's wrong (reported). */
export function normalizeTextFields(l: Record<string, unknown>, id: string, report: (problem: string) => void): Omit<TextLayer, "id" | "kind" | "name" | "visible" | "opacity" | "transform"> {
  const num = (v: unknown, min: number, max: number, fallback: number, what: string) => {
    if (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max) return v;
    if (v !== undefined) report(`Layer ${id}: its ${what} isn't one (${min} to ${max}); ${fallback} instead.`);
    return fallback;
  };
  const f = (l.font && typeof l.font === "object" ? l.font : {}) as Record<string, unknown>;
  const font: TextFont = {
    family: typeof f.family === "string" && f.family.trim() ? f.family.trim().slice(0, 200) : DEFAULT_TEXT_FONT.family,
    style: typeof f.style === "string" && f.style.trim() ? f.style.trim().slice(0, 100) : "Regular",
    weight: Math.round(num(f.weight, 1, 1000, 400, "font weight")),
    italic: f.italic === true,
    ...(typeof f.stretch === "string" && /^[a-z-]{1,30}$/.test(f.stretch) && f.stretch !== "normal" ? { stretch: f.stretch } : {}),
    size: num(f.size, MIN_FONT_SIZE, MAX_FONT_SIZE, DEFAULT_TEXT_FONT.size, "font size"),
  };
  const sizeOf = (v: unknown, what: string) => {
    const s = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1e6;
    if (ok(s.width) && ok(s.height)) return { width: s.width, height: s.height };
    if (v !== undefined && v !== null) report(`Layer ${id}: its ${what} isn't a size.`);
    return null;
  };
  const box = l.box === null || l.box === undefined ? null : sizeOf(l.box, "paragraph box");
  const o = (l.origin && typeof l.origin === "object" ? l.origin : {}) as Record<string, unknown>;
  const size = sizeOf(l.size, "frame") ?? { width: box?.width ?? font.size, height: box?.height ?? font.size * AUTO_LEADING };
  if (typeof l.text !== "string") report(`Layer ${id}: its words aren't text; left empty.`);
  return {
    text: typeof l.text === "string" ? l.text.slice(0, MAX_TEXT_LENGTH) : "",
    font,
    colour: isColour(l.colour) ? l.colour.toLowerCase() : "#000000",
    align: l.align === "center" || l.align === "right" || l.align === "justify" ? l.align : "left",
    leading: l.leading === null || l.leading === undefined ? null : num(l.leading, 1, 10_000, AUTO_LEADING * font.size, "leading"),
    tracking: num(l.tracking, -1000, 10_000, 0, "tracking"),
    box,
    size,
    origin: {
      x: typeof o.x === "number" && Number.isFinite(o.x) ? o.x : 0,
      y: typeof o.y === "number" && Number.isFinite(o.y) ? o.y : box ? 0 : size.height * 0.8,
    },
  };
}
