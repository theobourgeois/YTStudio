/**
 * The assistant's text edits (`add_text_layer`, `set_text`; docs/photo/tools/type.md, "The assistant"), pure as the
 * rest of `tool-edits.ts`: `(doc, input, env) => { doc, text }`. A text's frame is measured by `env.frameText` (this
 * computer's fonts in the tab; a fixed-width measurer in tests). Errors say what's wrong and what to give.
 */
import { createId } from "@shared/ids";
import { DEFAULT_TEXT_FONT, type FrameText, MAX_FONT_SIZE, MIN_FONT_SIZE, type TextPatch, addTextLayer, leadingOf, makeTextLayer, setText } from "@shared/photo/text";
import type { TextAlign, TextFont, TextLayer } from "@shared/photo/types";
import { faceFromName, findFamily, resolveFace, useFonts } from "@/stores/fonts";
import { type PhotoEdit, type PhotoEditEnv, findLayerRef } from "./tool-edits";

type Input = Record<string, unknown>;

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const ALIGNS: readonly TextAlign[] = ["left", "center", "right", "justify"];

/** A text layer as `get_photo` tells it: its words, setting and kind (its place and box follow in the description). */
export function describeTextLayer(layer: TextLayer): string {
  const f = layer.font;
  const words = layer.text.length > 300 ? `${layer.text.slice(0, 300)}…` : layer.text;
  const kind = layer.box ? `paragraph text in a ${round(layer.box.width)}×${round(layer.box.height)} box` : "point text";
  const leading = layer.leading === null ? `auto (${round(leadingOf(layer))} px)` : `${round(layer.leading)} px`;
  return `text layer (${kind}): ${JSON.stringify(words)}, ${f.family} ${f.style} ${round(f.size)} px, colour ${layer.colour}, align ${layer.align}, leading ${leading}, tracking ${round(layer.tracking)}`;
}

function frameOf(env: PhotoEditEnv): FrameText {
  if (!env.frameText) throw new Error("Text can only be set in the open editor tab (it measures the fonts): ask the user to open the photo.");
  return env.frameText;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The font a call names: a family (the installed one's spelling) and a style, at a size; what isn't given stays `base`'s. */
function fontFrom(input: Input, base: TextFont, notes: string[]): Partial<TextFont> | undefined {
  const patch: Partial<TextFont> = {};
  if (input.font !== undefined) {
    if (typeof input.font !== "string" || !input.font.trim()) throw new Error('font is a family\'s name, e.g. "Helvetica Neue".');
    const known = findFamily(input.font.trim());
    patch.family = known?.family ?? input.font.trim();
    if (!known && useFonts.getState().status === "ready") notes.push(`"${input.font}" isn't installed on this computer: it's drawn in the fallback font until it is.`);
  }
  if (input.style !== undefined || patch.family) {
    const name = typeof input.style === "string" && input.style.trim() ? input.style.trim() : base.style;
    const face = resolveFace(patch.family ?? base.family, name) ?? faceFromName(name);
    patch.style = face.name;
    patch.weight = face.weight;
    patch.italic = face.italic;
    patch.stretch = face.stretch;
  }
  if (input.size !== undefined) {
    if (!finite(input.size) || input.size < MIN_FONT_SIZE || input.size > MAX_FONT_SIZE) throw new Error(`size is the font's size in pixels, ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE}.`);
    patch.size = input.size;
  }
  return Object.keys(patch).length ? patch : undefined;
}

/** The setting a call gives (any of colour, align, leading, tracking, the font). */
function patchFrom(input: Input, base: TextFont, notes: string[]): TextPatch {
  const patch: TextPatch = {};
  if (input.text !== undefined) {
    if (typeof input.text !== "string") throw new Error('text is the words, with "\\n" between lines.');
    patch.text = input.text;
  }
  const font = fontFrom(input, base, notes);
  if (font) patch.font = font;
  if (input.colour !== undefined) {
    if (typeof input.colour !== "string" || !/^#[0-9a-f]{6}$/i.test(input.colour)) throw new Error('colour is "#rrggbb".');
    patch.colour = input.colour.toLowerCase();
  }
  if (input.align !== undefined) {
    if (!ALIGNS.includes(input.align as TextAlign)) throw new Error(`align is one of ${ALIGNS.join(", ")} (justify: paragraph text only).`);
    patch.align = input.align as TextAlign;
  }
  if (input.leading !== undefined) {
    if (input.leading === "auto" || input.leading === null) patch.leading = null;
    else if (finite(input.leading) && input.leading >= 1 && input.leading <= 10_000) patch.leading = input.leading;
    else throw new Error('leading is the pixels between baselines (1 to 10000), or "auto" (120% of the size).');
  }
  if (input.tracking !== undefined) {
    if (!finite(input.tracking) || input.tracking < -1000 || input.tracking > 10_000) throw new Error("tracking is in thousandths of an em, -1000 to 10000.");
    patch.tracking = input.tracking;
  }
  return patch;
}

function boxFrom(v: unknown): { x?: number; y?: number; width: number; height: number } {
  const b = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (!finite(b.width) || !finite(b.height) || b.width < 1 || b.height < 1) throw new Error("box is { x, y, width, height } in canvas pixels (width and height at least 1).");
  return { x: finite(b.x) ? b.x : undefined, y: finite(b.y) ? b.y : undefined, width: b.width, height: b.height };
}

export const addTextLayerTool: PhotoEdit = (doc, input, env) => {
  const measure = frameOf(env);
  if (typeof input.text !== "string" || !input.text.length) throw new Error('text is required: the words, with "\\n" between lines.');
  const notes: string[] = [];
  const patch = patchFrom(input, DEFAULT_TEXT_FONT, notes);
  const font = { ...DEFAULT_TEXT_FONT, ...patch.font };
  let at: { x: number; y: number };
  let box: { width: number; height: number } | null = null;
  if (input.box !== undefined && input.box !== null) {
    const b = boxFrom(input.box);
    if (b.x === undefined || b.y === undefined) throw new Error("A paragraph box needs its top-left too: box { x, y, width, height }.");
    at = { x: b.x, y: b.y };
    box = { width: b.width, height: b.height };
  } else {
    // Point text: the first line's baseline at (x, y); by default a third of the way down the canvas, centred.
    const x = finite(input.x) ? input.x : patch.align === "center" ? doc.canvas.width / 2 : doc.canvas.width / 10;
    const y = finite(input.y) ? input.y : doc.canvas.height / 3;
    at = { x, y };
  }
  const above = input.above === undefined ? null : findLayerRef(doc, input.above).id;
  const layer = makeTextLayer(
    { id: createId("layer"), text: patch.text, font, colour: patch.colour ?? "#000000", align: patch.align, leading: patch.leading, tracking: patch.tracking, box, at, name: typeof input.name === "string" ? input.name : undefined },
    measure,
  );
  const next = addTextLayer(doc, layer, above);
  return { doc: next, layerId: layer.id, text: [`Added text layer ${layer.id} "${layer.name}": ${describeTextLayer(layer)}.`, ...notes].join("\n") };
};

export const setTextTool: PhotoEdit = (doc, input, env) => {
  const measure = frameOf(env);
  const found = findLayerRef(doc, input.layer);
  if (found.kind !== "text") throw new Error(`"${found.name}" isn't a text layer (it's a ${found.kind} layer). Text layers: ${doc.layers.filter((l) => l.kind === "text").map((l) => `${l.id} ("${l.name}")`).join(", ") || "none: add one with add_text_layer"}.`);
  const notes: string[] = [];
  const patch = patchFrom(input, found.font, notes);
  if (input.box === null || input.box === "point") patch.box = null;
  else if (input.box !== undefined) patch.box = { width: boxFrom(input.box).width, height: boxFrom(input.box).height };
  if (!Object.keys(patch).length) throw new Error("Give something to change: text, font, style, size, colour, align, leading, tracking or box.");
  const next = setText(doc, found.id, patch, measure);
  const layer = next.layers.find((l) => l.id === found.id) as TextLayer;
  return { doc: next, layerId: layer.id, text: [next === doc ? `"${layer.name}" already is that.` : `"${layer.name}": ${describeTextLayer(layer)}.`, ...notes].join("\n") };
};
