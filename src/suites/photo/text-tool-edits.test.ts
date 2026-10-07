import { describe, expect, it } from "vitest";
import { createPhotoProject } from "@shared/photo/project";
import { type FrameText, type TextMeasurer, type TextSpec, originPoint, textFrame } from "@shared/photo/text";
import type { TextLayer } from "@shared/photo/types";
import { describePhoto } from "./tool-edits";
import { addTextLayerTool, setTextTool } from "./text-tool-edits";

/** A fixed-width font: every character half the size wide. */
const fixed = (spec: Pick<TextSpec, "font" | "tracking">): TextMeasurer => ({
  ascent: 0.8 * spec.font.size,
  descent: 0.2 * spec.font.size,
  width: (t) => [...t].length * (spec.font.size / 2 + (spec.tracking / 1000) * spec.font.size),
  ink: (t) => ({ left: 0, right: [...t].length * (spec.font.size / 2), ascent: 0.7 * spec.font.size, descent: 0.1 * spec.font.size }),
});
const frameText: FrameText = (spec) => textFrame(spec, fixed(spec));
const env = { assets: [], frameText };
const textOf = (doc: { layers: unknown[] }, i = 0) => doc.layers[i] as TextLayer;

describe("the assistant's text edits", () => {
  const empty = createPhotoProject("Post", { width: 1080, height: 1350 });

  it("adds point text where it's asked, set as it's asked, and describes it", () => {
    const { doc, text, layerId } = addTextLayerTool(empty, { text: "Big sale\nToday", x: 540, y: 300, size: 120, colour: "#FF0000", align: "center", style: "Bold", tracking: 50 }, env);
    const layer = textOf(doc);
    expect(layerId).toBe(layer.id);
    expect(layer).toMatchObject({ kind: "text", text: "Big sale\nToday", colour: "#ff0000", align: "center", tracking: 50, box: null, name: "Big sale" });
    expect(layer.font).toMatchObject({ size: 120, style: "Bold", weight: 700, italic: false });
    expect(originPoint(layer).x).toBeCloseTo(540, 9);
    expect(originPoint(layer).y).toBeCloseTo(300, 9);
    expect(text).toMatch(/point text/);
    expect(describePhoto(doc, [], [])).toMatch(/text layer \(point text\): "Big sale\\nToday", Arial Bold 120 px/);
  });

  it("adds paragraph text in a box, its top-left where it's given", () => {
    const { doc } = addTextLayerTool(empty, { text: "Words that wrap", box: { x: 100, y: 200, width: 400, height: 300 } }, env);
    const layer = textOf(doc);
    expect(layer.box).toEqual({ width: 400, height: 300 });
    expect(originPoint(layer)).toEqual({ x: 100, y: 200 });
    expect(describePhoto(doc, [], [])).toMatch(/paragraph text in a 400×300 box/);
    expect(() => addTextLayerTool(empty, { text: "x", box: { width: 10, height: 10 } }, env)).toThrow(/top-left/);
  });

  it("changes the words and setting of the whole layer, keeping its place", () => {
    const added = addTextLayerTool(empty, { text: "Hi", x: 50, y: 60 }, env).doc;
    const before = originPoint(textOf(added));
    const { doc } = setTextTool(added, { layer: "Hi", text: "Hello", size: 40, leading: "auto", align: "right", font: "Helvetica" }, env);
    const layer = textOf(doc);
    expect(layer).toMatchObject({ text: "Hello", align: "right", leading: null, name: "Hello" });
    expect(layer.font).toMatchObject({ size: 40, family: "Helvetica" });
    expect(originPoint(layer).x).toBeCloseTo(before.x, 9);
    const boxed = textOf(setTextTool(doc, { layer: layer.id, box: { width: 300, height: 100 } }, env).doc);
    expect(boxed.box).toEqual({ width: 300, height: 100 });
    expect(textOf(setTextTool(doc, { layer: layer.id, box: "point" }, env).doc).box).toBeNull();
  });

  it("says what's wrong", () => {
    const doc = addTextLayerTool(empty, { text: "Hi" }, env).doc;
    expect(() => addTextLayerTool(empty, { text: "" }, env)).toThrow(/text is required/);
    expect(() => addTextLayerTool(empty, { text: "a", size: 0 }, env)).toThrow(/size/);
    expect(() => addTextLayerTool(empty, { text: "a", colour: "red" }, env)).toThrow(/#rrggbb/);
    expect(() => setTextTool(doc, { layer: "Hi" }, env)).toThrow(/Give something to change/);
    expect(() => setTextTool(doc, { layer: "Hi", align: "middle" }, env)).toThrow(/left, center, right, justify/);
    expect(() => addTextLayerTool(empty, { text: "a" }, { assets: [] })).toThrow(/open editor tab/);
  });
});
