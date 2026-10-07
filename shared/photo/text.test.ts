import { describe, expect, it } from "vitest";
import { canvasContentOf, canvasRaster } from "./canvas-content.ts";
import { apply } from "./layers.ts";
import { createPhotoProject, normalizePhotoProject } from "./project.ts";
import { compileRender, hashKey } from "./render-plan.ts";
import {
  DEFAULT_TEXT_FONT,
  type FrameText,
  type TextMeasurer,
  type TextSpec,
  addTextLayer,
  caretAt,
  layoutText,
  makeTextLayer,
  nameFromText,
  originPoint,
  resizeTextBox,
  setText,
  textFrame,
  withCharacter,
} from "./text.ts";
import { PHOTO_VERSION, type TextLayer } from "./types.ts";

/** Every character half the size wide (letter spacing added after each), ascent 0.8 and descent 0.2 of it. */
function fixed(spec: Pick<TextSpec, "font" | "tracking">): TextMeasurer {
  const advance = spec.font.size / 2 + (spec.tracking / 1000) * spec.font.size;
  return {
    ascent: 0.8 * spec.font.size,
    descent: 0.2 * spec.font.size,
    width: (text) => [...text].length * advance,
    ink: (text) => ({ left: 0, right: [...text].length * advance, ascent: 0.7 * spec.font.size, descent: 0.1 * spec.font.size }),
  };
}

const frameText: FrameText = (spec) => textFrame(spec, fixed(spec));
const font = { ...DEFAULT_TEXT_FONT, size: 20 };
const spec = (patch: Partial<TextSpec> = {}): TextSpec => ({ text: "ab", font, align: "left", leading: null, tracking: 0, box: null, ...patch });

describe("layoutText", () => {
  it("puts point text's lines on its origin, by their alignment, a leading apart", () => {
    const m = fixed(spec());
    const left = layoutText(spec({ text: "ab\nabcd" }), m);
    expect(left.lineHeight).toBe(24);
    expect(left.lines.map((l) => [l.x, l.baseline, l.width])).toEqual([
      [0, 0, 20],
      [0, 24, 40],
    ]);
    // CSS's half-leading: the baseline sits (24 - 20) / 2 + 16 into the line box.
    expect(left.baselineOffset).toBe(18);
    expect(left.top).toBe(-18);
    expect(layoutText(spec({ text: "ab\nabcd", align: "center" }), m).lines.map((l) => l.x)).toEqual([-10, -20]);
    expect(layoutText(spec({ text: "ab\nabcd", align: "right" }), m).lines.map((l) => l.x)).toEqual([-20, -40]);
  });

  it("wraps paragraph text at spaces, a word too long between characters, and hides lines past the box", () => {
    const m = fixed(spec());
    // 10 px a character: "aaa bbb ccc" in a 75 px box.
    const l = layoutText(spec({ text: "aaa bbb ccc", box: { width: 75, height: 1000 } }), m);
    expect(l.lines.map((x) => x.text)).toEqual(["aaa bbb ", "ccc"]);
    expect(l.lines[0].width).toBe(70);
    expect(l.lines[0].baseline).toBe(18);
    const long = layoutText(spec({ text: "abcdefghij", box: { width: 45, height: 1000 } }), m);
    expect(long.lines.map((x) => x.text)).toEqual(["abcd", "efgh", "ij"]);
    const short = layoutText(spec({ text: "aaa bbb ccc", box: { width: 35, height: 50 } }), m);
    expect(short.lines.map((x) => x.text)).toEqual(["aaa ", "bbb "]);
  });

  it("justifies a paragraph's lines but its last, spreading the spaces", () => {
    const l = layoutText(spec({ text: "aa bb cc dd", align: "justify", box: { width: 75, height: 1000 } }), fixed(spec()));
    expect(l.lines.map((x) => x.text)).toEqual(["aa bb ", "cc dd"]);
    expect(l.lines[0].gap).toBe(75 - 50);
    expect(l.lines[1].gap).toBe(0);
  });

  it("adds tracking after every character", () => {
    const l = layoutText(spec({ text: "abcd", tracking: 100 }), fixed(spec({ tracking: 100 })));
    expect(l.lines[0].width).toBe(4 * 12);
  });
});

describe("textFrame and caretAt", () => {
  it("frames the lines and their ink, rounded out with a pixel to spare", () => {
    const f = textFrame(spec({ text: "ab" }), fixed(spec()));
    // Line box: x 0..20, y -16..4; whole pixels and one more.
    expect(f).toEqual({ size: { width: 22, height: 22 }, origin: { x: 1, y: 17 }, firstBaseline: 0 });
    const p = textFrame(spec({ text: "ab", box: { width: 100, height: 50 } }), fixed(spec()));
    expect(p.size).toEqual({ width: 102, height: 52 });
    expect(p.origin).toEqual({ x: 1, y: 1 });
  });

  it("finds the character nearest a point", () => {
    const s = spec({ text: "abcd\nef" });
    const m = fixed(s);
    const l = layoutText(s, m);
    expect(caretAt(s, l, m, 14, -5)).toBe(1);
    expect(caretAt(s, l, m, 100, -5)).toBe(4);
    expect(caretAt(s, l, m, 0, 20)).toBe(5);
    expect(caretAt(s, l, m, 21, 20)).toBe(7);
  });
});

describe("text layers", () => {
  it("are made with their origin on the point given, named after their words", () => {
    const layer = makeTextLayer({ id: "t1", text: "Hello", font, at: { x: 100, y: 200 } }, frameText);
    expect(originPoint(layer)).toEqual({ x: 100, y: 200 });
    expect(layer.name).toBe("Hello");
    expect(layer.box).toBeNull();
    const para = makeTextLayer({ id: "t2", text: "Hi", font, box: { width: 300, height: 80 }, at: { x: 10, y: 20 } }, frameText);
    expect(originPoint(para)).toEqual({ x: 10, y: 20 });
  });

  it("keep their origin where it is as the words change, the name following them until renamed", () => {
    let doc = addTextLayer(createPhotoProject("t"), makeTextLayer({ id: "t1", text: "Hi", font, align: "center", at: { x: 300, y: 400 } }, frameText));
    doc = setText(doc, "t1", { text: "Hello there\nfriend" }, frameText);
    const layer = doc.layers[0] as TextLayer;
    expect(originPoint(layer).x).toBeCloseTo(300, 9);
    expect(originPoint(layer).y).toBeCloseTo(400, 9);
    expect(layer.name).toBe("Hello there");
    expect(setText(doc, "t1", { text: "Hello there\nfriend" }, frameText)).toBe(doc);
    const renamed = { ...doc, layers: [{ ...layer, name: "Title" }] };
    expect((setText(renamed, "t1", { text: "Bye" }, frameText).layers[0] as TextLayer).name).toBe("Title");
  });

  it("keep their origin through a transform's scale and rotation", () => {
    let doc = addTextLayer(createPhotoProject("t"), makeTextLayer({ id: "t1", text: "A", font, at: { x: 0, y: 0 } }, frameText));
    const turned = { ...(doc.layers[0] as TextLayer), transform: { ...(doc.layers[0] as TextLayer).transform, scaleX: 2, scaleY: 3, rotation: 30 } };
    doc = { ...doc, layers: [turned] };
    const before = originPoint(turned);
    const after = originPoint(setText(doc, "t1", { text: "Abcdef", font: { size: 40 } }, frameText).layers[0] as TextLayer);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("turn into paragraph text and back keeping their first baseline", () => {
    let doc = addTextLayer(createPhotoProject("t"), makeTextLayer({ id: "t1", text: "Ab", font, at: { x: 50, y: 100 } }, frameText));
    doc = setText(doc, "t1", { box: { width: 200, height: 100 } }, frameText);
    const para = doc.layers[0] as TextLayer;
    // The box's first baseline is 18 below its top: the box's top is at 82.
    expect(originPoint(para).y).toBeCloseTo(82, 9);
    doc = setText(doc, "t1", { box: null }, frameText);
    expect(originPoint(doc.layers[0] as TextLayer).y).toBeCloseTo(100, 9);
  });

  it("resize their paragraph box from any edge, the words reflowing", () => {
    const layer = makeTextLayer({ id: "t1", text: "aaa bbb", font, box: { width: 100, height: 50 }, at: { x: 10, y: 20 } }, frameText);
    const doc = addTextLayer(createPhotoProject("t"), layer);
    const o = layer.origin;
    const next = resizeTextBox(doc, layer, { x0: o.x - 30, y0: o.y, x1: o.x + 100, y1: o.y + 80 }, frameText).layers[0] as TextLayer;
    expect(next.box).toEqual({ width: 130, height: 80 });
    expect(originPoint(next).x).toBeCloseTo(-20, 9);
    expect(originPoint(next).y).toBeCloseTo(20, 9);
  });

  it("name themselves after their first line", () => {
    expect(nameFromText("")).toBe("Text");
    expect(nameFromText("\n  Big title \nmore")).toBe("Big title");
    expect(nameFromText("x".repeat(60)).length).toBe(40);
  });
});

describe("normalising text layers", () => {
  it("keeps a valid one as it is, at version 7", () => {
    const doc = addTextLayer(createPhotoProject("t"), makeTextLayer({ id: "t1", text: "Hi\nthere", font, colour: "#ff0000", align: "right", leading: 30, tracking: 50, at: { x: 1, y: 2 } }, frameText));
    const problems: string[] = [];
    const back = normalizePhotoProject(JSON.parse(JSON.stringify(doc)), (p) => problems.push(p));
    expect(PHOTO_VERSION).toBe(7);
    expect(back).toEqual(doc);
    expect(problems).toEqual([]);
  });

  it("repairs what's wrong to its default, saying so", () => {
    const problems: string[] = [];
    const back = normalizePhotoProject(
      { version: 7, canvas: { width: 100, height: 100 }, output: { highlights: "film" }, layers: [{ id: "t", kind: "text", text: 5, font: { family: "", size: -3, weight: 9000 }, colour: "red", align: "middle", leading: 0, tracking: "x", box: { width: -1 }, size: { width: 10, height: 10 } }] },
      (p) => problems.push(p),
    );
    const layer = back.layers[0] as TextLayer;
    expect(layer.text).toBe("");
    expect(layer.font).toEqual({ family: DEFAULT_TEXT_FONT.family, style: "Regular", weight: 400, italic: false, size: DEFAULT_TEXT_FONT.size });
    expect(layer.colour).toBe("#000000");
    expect(layer.align).toBe("left");
    expect(layer.leading).toBe(AUTO(layer.font.size));
    expect(layer.tracking).toBe(0);
    expect(layer.box).toBeNull();
    expect(problems.length).toBeGreaterThan(3);
  });
});

const AUTO = (size: number) => 1.2 * size;

describe("text in the render plan", () => {
  it("is a canvas node: its words drawn in document pixels, placed on whole pixels", () => {
    const layer = makeTextLayer({ id: "t1", text: "Hello", font, at: { x: 100.3, y: 200.6 } }, frameText);
    const doc = addTextLayer(createPhotoProject("t", { width: 400, height: 400 }), layer);
    const plan = compileRender(doc, new Map());
    const node = plan.nodes[0];
    expect(node.kind).toBe("canvas");
    if (node.kind !== "canvas") return;
    expect(Number.isInteger(node.raster.x) && Number.isInteger(node.raster.y)).toBe(true);
    expect(node.matrix).toEqual([1, 0, 0, 1, node.raster.x, node.raster.y]);
    // The raster's matrix takes the layer's origin to where it is on the canvas, less the raster's place.
    const at = apply(node.raster.matrix, layer.origin.x, layer.origin.y);
    expect(at.x + node.raster.x).toBeCloseTo(100.3, 9);
    expect(at.y + node.raster.y).toBeCloseTo(200.6, 9);
    // New words, a new key.
    const other = compileRender(setText(doc, "t1", { text: "Bye" }, frameText), new Map());
    expect(other.nodes[0].key).not.toBe(node.key);
  });

  it("covers the canvas when it has a mask (its mask is in document pixels), else the box around it", () => {
    const layer = makeTextLayer({ id: "t1", text: "Hello", font, at: { x: 100, y: 200 } }, frameText);
    const doc = createPhotoProject("t", { width: 400, height: 300 });
    const facts = canvasContentOf(layer)!;
    const free = canvasRaster(doc, facts, 0, false, hashKey)!;
    expect(free.width).toBeLessThan(200);
    const masked = canvasRaster(doc, facts, 0, true, hashKey)!;
    expect([masked.x, masked.y, masked.width, masked.height]).toEqual([0, 0, 400, 300]);
    // Off the canvas by more than its reach: nothing to draw.
    expect(canvasRaster(doc, { ...facts, transform: { ...facts.transform, x: -5000 } }, 0, false, hashKey)).toBeNull();
  });

  it("covers the region rendered when it isn't the canvas (a merge renders the box around its layers, where they are)", () => {
    const layer = makeTextLayer({ id: "t1", text: "Hello", font, at: { x: 300, y: 250 } }, frameText);
    // A merge's document: a canvas the size of its box, whose top-left is document point (280, 220).
    const doc = createPhotoProject("t", { width: 120, height: 60 });
    const facts = canvasContentOf(layer)!;
    const region = { x0: 280, y0: 220, x1: 400, y1: 280 };
    // Cut to the canvas alone, it would be off it: nothing drawn.
    expect(canvasRaster(doc, facts, 0, false, hashKey)).toBeNull();
    const free = canvasRaster(doc, facts, 0, false, hashKey, region)!;
    expect(free.x).toBeGreaterThanOrEqual(278);
    expect(free.x + free.width).toBeLessThanOrEqual(402);
    // Masked: from the document's top-left (where its mask's pixels start) to the region's far corner.
    const masked = canvasRaster(doc, facts, 0, true, hashKey, region)!;
    expect([masked.x, masked.y, masked.width, masked.height]).toEqual([0, 0, 400, 280]);
  });
});

describe("character settings", () => {
  it("are stored only when they differ from the default, and cleared by their default", () => {
    expect(withCharacter({}, { kerning: "metrics", horizontalScale: 1, fauxBold: false, caps: "none" })).toEqual({});
    expect(withCharacter({}, { kerning: "none", horizontalScale: 1.5, verticalScale: 50, fauxItalic: true, caps: "small", underline: true })).toEqual({ kerning: "none", horizontalScale: 1.5, verticalScale: 10, fauxItalic: true, caps: "small", underline: true });
    expect(withCharacter({ underline: true, caps: "all" }, { underline: false, caps: "none" })).toEqual({});
  });

  it("restyle a layer, which drops what's turned off, and key its raster afresh", () => {
    const layer = makeTextLayer({ id: "t1", text: "Hello", font, at: { x: 100, y: 200 }, character: { underline: true, fauxBold: true } }, frameText);
    expect(layer).toMatchObject({ underline: true, fauxBold: true });
    const doc = addTextLayer(createPhotoProject("t", { width: 400, height: 300 }), layer);
    const plain = setText(doc, "t1", { underline: false, fauxBold: false }, frameText);
    const text = plain.layers[0] as TextLayer;
    expect("underline" in text || "fauxBold" in text).toBe(false);
    // Turned off already: the same document.
    expect(setText(plain, "t1", { underline: false }, frameText)).toBe(plain);
    expect(compileRender(plain, new Map()).nodes[0].key).not.toBe(compileRender(doc, new Map()).nodes[0].key);
    // A text without them keys as it always did: no character fields in what it draws.
    expect(Object.keys(canvasContentOf(text)!.content)).toEqual(["kind", "text", "font", "colour", "align", "leading", "tracking", "box", "origin"]);
  });

  it("widen the frame for a slant, a thickened outline, and an underline below the ink", () => {
    const base = textFrame(spec({ text: "abc" }), fixed(spec()));
    const slanted = textFrame(spec({ text: "abc", fauxItalic: true }), fixed(spec()));
    // The tops lean right by 0.2 of the ink's ascent (2.8 px), the descenders left by 0.2 of its descent (0.4 px),
    // each rounded out to whole pixels.
    expect(slanted.size.width).toBe(base.size.width + 4);
    const bold = textFrame(spec({ text: "abc", fauxBold: true }), fixed(spec()));
    expect(bold.size.width).toBeGreaterThan(base.size.width);
    const underlined = textFrame(spec({ text: "abc", underline: true }), fixed(spec()));
    expect(underlined.size.height).toBeGreaterThanOrEqual(base.size.height);
  });

  it("are checked when a photo is opened", () => {
    const layer = makeTextLayer({ id: "t1", text: "Hi", font, at: { x: 10, y: 20 } }, frameText);
    const doc = { ...createPhotoProject("t"), layers: [{ ...layer, kerning: "optical", horizontalScale: 99, fauxBold: "yes", caps: "small", underline: true }] };
    const problems: string[] = [];
    const project = normalizePhotoProject(doc, (p) => problems.push(p));
    expect(project.layers[0]).toMatchObject({ caps: "small", underline: true });
    for (const key of ["kerning", "horizontalScale", "fauxBold"]) expect(project.layers[0]).not.toHaveProperty(key);
    expect(problems.join("\n")).toMatch(/horizontal scale/);
  });
});
