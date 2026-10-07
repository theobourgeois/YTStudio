import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, addGeneratorLayer, addPixelLayer, setMask, updateLayer } from "@shared/photo/edits";
import { GRADIENT_FILL } from "@shared/photo/effects/gradient";
import { createPhotoProject } from "@shared/photo/project";
import { GRADIENT_PRESETS } from "@shared/photo/style/gradients";
import type { Gradient, PhotoProject } from "@shared/photo/types";
import { addStopOnLine, alongLine, constrainLine, dragMid, dragStop, gradientFillName, shownAt, widgetLayout } from "./gradient-geometry";
import { GRADIENT_TOOL_DEFAULTS, classicGradient, liveParams, pickGradient, sanitizeGradientOptions, swatchGradient, toolGradient, toolPresets } from "./gradient-options";
import { gradientPlan } from "./gradient-plan";
import { gradientPaintRequest } from "./gradient-request";
import { addGeneratorTool, describeLayer, moveHandleTool } from "../tool-edits";

const colours = { foreground: "#ff0000", background: "#0000ff" };
const three: Gradient = { name: "Three", method: "perceptual", colours: [{ at: 0, colour: "#000000" }, { at: 0.5, colour: "#ff0000" }, { at: 1, colour: "#ffffff" }], opacities: [{ at: 0, opacity: 1 }, { at: 1, opacity: 1 }] };

describe("the drag's line", () => {
  it("Shift turns it to the nearest 45°, its length kept", () => {
    expect(constrainLine([0, 0], [100, 10], 45)).toEqual([100.5, 0]);
    const diagonal = constrainLine([0, 0], [100, 90], 45);
    expect(diagonal[0]).toBeCloseTo(diagonal[1], 1);
    expect(Math.hypot(...diagonal)).toBeCloseTo(Math.hypot(100, 90), 1);
    expect(constrainLine([5, 5], [5, 5], 45)).toEqual([5, 5]);
    // 16.7° to 15°.
    expect(constrainLine([0, 0], [100, 30], 15)).toEqual([100.85, 27.02]);
  });

  it("finds a point's place along a line and its distance from it", () => {
    expect(alongLine({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ t: 0.5, distance: 10 });
    expect(alongLine({ x: -50, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }).t).toBe(-0.5);
  });
});

describe("the widget", () => {
  it("puts stops along the line (Reverse from the end) and midpoints above it", () => {
    const w = widgetLayout(three, false, { x: 0, y: 100 }, { x: 200, y: 100 });
    expect(w.stops.map((s) => s.at.x)).toEqual([0, 100, 200]);
    expect(w.mids.map((m) => [m.at.x, m.at.y])).toEqual([
      [50, 88],
      [150, 88],
    ]);
    const reversed = widgetLayout(three, true, { x: 0, y: 100 }, { x: 200, y: 100 });
    expect(reversed.stops.map((s) => s.at.x)).toEqual([200, 100, 0]);
    // A vertical line's midpoints sit to its left.
    expect(widgetLayout(three, false, { x: 10, y: 0 }, { x: 10, y: 100 }).mids[0].at.x).toBe(-2);
  });

  it("drags a stop along the line, and off it (two stay)", () => {
    const moved = dragStop(three, 1, 0.3, false, false);
    expect(moved.gradient.colours[moved.index]).toMatchObject({ at: 0.3, colour: "#ff0000" });
    expect(moved.gradient.name).toBe("Custom");
    expect(dragStop(three, 1, 0.3, true, false).gradient.colours[1].at).toBe(0.7);
    const off = dragStop(three, 1, 0.5, false, true);
    expect(off.index).toBe(-1);
    expect(off.gradient.colours.length).toBe(2);
    const two = off.gradient;
    expect(dragStop(two, 0, 0.5, false, true).gradient.colours.length).toBe(2);
  });

  it("adds a stop in the gradient's colour where the line's clicked", () => {
    const added = addStopOnLine(GRADIENT_PRESETS[0], 0.25, false);
    expect(added.gradient.colours[added.index].at).toBe(0.25);
    expect(added.gradient.colours.length).toBe(3);
    expect(addStopOnLine(GRADIENT_PRESETS[0], 0.25, true).gradient.colours[1].at).toBe(0.75);
  });

  it("moves a midpoint between its stops, 5% to 95%", () => {
    expect(dragMid(three, 0, 0.1, false).colours[0].mid).toBe(0.2);
    expect(dragMid(three, 0, 0, false).colours[0].mid).toBe(0.05);
    expect(dragMid(three, 0, 0.25, false).colours[0]).not.toHaveProperty("mid");
    expect(dragMid(three, 2, 0.5, false)).toBe(three);
    expect(shownAt(0.2, true)).toBeCloseTo(0.8);
  });

  it("names new layers as Photoshop does", () => {
    const doc = createPhotoProject("t", { width: 100, height: 100 });
    expect(gradientFillName(doc)).toBe("Gradient Fill 1");
    const one = addGeneratorLayer(doc, { id: "a", type: GRADIENT_FILL, name: "Gradient Fill 1" });
    expect(gradientFillName(addGeneratorLayer(one, { id: "b", type: GRADIENT_FILL, name: "Gradient Fill 4" }))).toBe("Gradient Fill 5");
  });
});

describe("the options", () => {
  it("are checked, a bad one at its default", () => {
    expect(sanitizeGradientOptions({})).toEqual(GRADIENT_TOOL_DEFAULTS);
    expect(sanitizeGradientOptions({ mode: "classic", style: "angle", opacity: 3, paintMode: "behind", method: "stripes", swatches: null })).toMatchObject({ mode: "classic", style: "angle", opacity: 1, paintMode: "behind", method: "stripes", swatches: null });
    expect(sanitizeGradientOptions({ style: "spiral", paintMode: "nope", method: "wobbly" })).toMatchObject({ style: "linear", paintMode: "normal", method: "perceptual" });
  });

  it("Foreground to Background and Foreground to Transparent follow the swatches", () => {
    expect(swatchGradient("foreground-background", colours).colours.map((c) => c.colour)).toEqual(["#ff0000", "#0000ff"]);
    expect(swatchGradient("foreground-transparent", colours).opacities.map((o) => o.opacity)).toEqual([1, 0]);
    expect(toolPresets(colours).slice(0, 3).map((g) => g.name)).toEqual(["Foreground to Background", "Foreground to Transparent", "Black, White"]);
    expect(toolGradient(GRADIENT_TOOL_DEFAULTS, colours)).toMatchObject({ name: "Foreground to Background", method: "perceptual" });
  });

  it("a picked gradient is kept (with its method); a Basics one follows the swatches again", () => {
    const picked = pickGradient(GRADIENT_TOOL_DEFAULTS, GRADIENT_PRESETS[4]);
    expect(picked.swatches).toBeNull();
    expect(picked.method).toBe("classic");
    expect(toolGradient(picked, colours).name).toBe(GRADIENT_PRESETS[4].name);
    const back = pickGradient(picked, swatchGradient("foreground-transparent", colours));
    expect(back.swatches).toBe("foreground-transparent");
    expect(toolGradient({ ...back, method: "linear" }, colours).method).toBe("linear");
  });

  it("make a live gradient's parameters, and Classic's without its transparency when that's off", () => {
    expect(liveParams({ ...GRADIENT_TOOL_DEFAULTS, style: "radial", reverse: true }, colours, [1, 2], [3, 4])).toMatchObject({ style: "radial", start: [1, 2], end: [3, 4], reverse: true, dither: true });
    const fade = { ...GRADIENT_TOOL_DEFAULTS, swatches: "foreground-transparent" as const };
    expect(classicGradient(fade, colours).opacities.map((o) => o.opacity)).toEqual([1, 0]);
    expect(classicGradient({ ...fade, transparency: false }, colours).opacities.map((o) => o.opacity)).toEqual([1, 1]);
  });
});

describe("the assistant", () => {
  const env = { assets: [] };
  const doc = () => setMask(addPixelLayer(addPixelLayer(createPhotoProject("t", { width: 200, height: 100 }), { id: "px", name: "Paint" }), { id: "bare", name: "Bare" }), "px", null);

  it("adds a Gradient Fill with its type, line and stops, and reads it back", () => {
    const { doc: next, layerId } = addGeneratorTool(doc(), { type: "gradient-fill", params: { style: "radial", start: [100, 50], end: [180, 50], gradient: { colours: [{ at: 0, colour: "#FFD27A" }, { at: 1, colour: "#1a0f3a" }] } } }, env);
    const layer = next.layers.find((l) => l.id === layerId)!;
    expect(layer).toMatchObject({ kind: "generator", effect: { type: GRADIENT_FILL, params: { style: "radial", start: [100, 50], end: [180, 50] } } });
    expect(layer.blend).toBeUndefined();
    const text = describeLayer(layer, [], 0);
    expect(text).toContain('gradient "Custom" (perceptual): #ffd27a at 0%, #1a0f3a at 100%; opaque');
    expect(text).toContain("start (100, 50)");
    // A preset, and a stock gradient by name.
    const preset = addGeneratorTool(doc(), { type: "gradient-fill", preset: "copper" }, env);
    expect(describeLayer(preset.doc.layers.find((l) => l.id === preset.layerId)!, [], 0)).toContain('"Copper"');
    const named = addGeneratorTool(doc(), { type: "gradient-fill", params: { gradient: "Chrome" } }, env);
    expect(describeLayer(named.doc.layers.find((l) => l.id === named.layerId)!, [], 0)).toContain('"Chrome"');
    expect(() => addGeneratorTool(doc(), { type: "gradient-fill", preset: "classic" }, env)).toThrow(/Its presets: black-white/);
    expect(() => addGeneratorTool(doc(), { type: "gradient-fill", params: { gradient: "Nope" } }, env)).toThrow(/No gradient "Nope"/);
  });

  it("moves a Gradient Fill's ends", () => {
    const added = addGeneratorTool(doc(), { type: "gradient-fill" }, env);
    const moved = moveHandleTool(added.doc, { layer: added.layerId, handle: "end", x: 20, y: 30 }, env);
    expect(moved.doc.layers.find((l) => l.id === added.layerId)).toMatchObject({ effect: { params: { end: [20, 30] } } });
  });

  it("checks a Classic gradient's request: where, what and how", () => {
    const r = gradientPaintRequest(doc(), { layer: "Paint", target: "mask", start: [0, 0], end: [200, 0], gradient: "Black, White", style: "reflected", opacity: 50, mode: "multiply" }, colours);
    expect(r).toMatchObject({ layerId: "px", part: "mask", shape: { style: "reflected", start: [0, 0], end: [200, 0], dither: true, gradient: { name: "Black, White", method: "perceptual" } }, paint: { mode: "multiply", opacity: 0.5 } });
    const swatches = gradientPaintRequest(doc(), { layer: "px", start: [0, 0], end: [1, 1], gradient: "foreground-transparent", transparency: false, method: "stripes" }, colours);
    expect(swatches.shape.gradient).toMatchObject({ method: "stripes", colours: [{ colour: "#ff0000" }, { colour: "#ff0000" }], opacities: [{ opacity: 1 }, { opacity: 1 }] });
    expect(() => gradientPaintRequest(doc(), { layer: "Bare", target: "mask", start: [0, 0], end: [1, 1] }, colours)).toThrow(/no mask/);
    expect(() => gradientPaintRequest(doc(), { layer: "px", start: [0, 0] }, colours)).toThrow(/end must be/);
    expect(() => gradientPaintRequest(doc(), { layer: "px", start: [0, 0], end: [1, 1], style: "spiral" }, colours)).toThrow(/style must be/);
    expect(() => gradientPaintRequest(doc(), { layer: "px", start: [0, 0], end: [1, 1], opacity: 150 }, colours)).toThrow(/opacity/);
    const adjusted = addAdjustmentLayer(doc(), { id: "adj", type: "exposure" });
    expect(() => gradientPaintRequest(adjusted, { layer: "adj", start: [0, 0], end: [1, 1] }, colours)).toThrow(/paint its mask/);
  });
});

describe("what a drag does", () => {
  const base = (): PhotoProject => {
    let doc = createPhotoProject("t", { width: 100, height: 100 });
    doc = addPixelLayer(doc, { id: "px" });
    doc = addAdjustmentLayer(doc, { id: "adj", type: "exposure" });
    doc = addGeneratorLayer(doc, { id: "grad", type: GRADIENT_FILL });
    doc = addGeneratorLayer(doc, { id: "flare", type: "lens-flare" });
    return doc;
  };

  it("in Gradient mode makes a new layer above the active one, or draws a Gradient Fill's line again", () => {
    const doc = base();
    expect(gradientPlan(doc, "px", "content", "live")).toEqual({ kind: "new", above: "px" });
    expect(gradientPlan(doc, null, "content", "live")).toEqual({ kind: "new", above: null });
    expect(gradientPlan(doc, "flare", "content", "live")).toEqual({ kind: "new", above: "flare" });
    expect(gradientPlan(doc, "grad", "content", "live")).toEqual({ kind: "redraw", layerId: "grad" });
    expect(gradientPlan(updateLayer(doc, "grad", { visible: false }), "grad", "content", "live").kind).toBe("error");
  });

  it("paints a targeted mask in either mode", () => {
    const masked = setMask(base(), "px", null);
    expect(gradientPlan(masked, "px", "mask", "live")).toEqual({ kind: "classic", layerId: "px", part: "mask" });
    expect(gradientPlan(masked, "px", "mask", "classic")).toEqual({ kind: "classic", layerId: "px", part: "mask" });
    const gradMask = setMask(base(), "grad", null);
    expect(gradientPlan(gradMask, "grad", "mask", "live")).toEqual({ kind: "classic", layerId: "grad", part: "mask" });
  });

  it("in Classic paints pixels, an adjustment's mask, and asks over an image; a generator refuses", () => {
    const doc = base();
    expect(gradientPlan(doc, "px", "content", "classic")).toEqual({ kind: "classic", layerId: "px", part: "content" });
    expect(gradientPlan(doc, "adj", "content", "classic")).toEqual({ kind: "classic", layerId: "adj", part: "mask", addMask: true });
    expect(gradientPlan(doc, "grad", "content", "classic").kind).toBe("error");
    expect(gradientPlan(doc, "flare", "content", "classic").kind).toBe("error");
    expect(gradientPlan(doc, null, "content", "classic").kind).toBe("error");
    const image: PhotoProject = { ...doc, layers: [...doc.layers, { id: "img", kind: "image", name: "Image", visible: true, opacity: 1, mediaId: "m", transform: { x: 50, y: 50, scaleX: 1, scaleY: 1, rotation: 0 } }] };
    expect(gradientPlan(image, "img", "content", "classic")).toEqual({ kind: "choice", layerId: "img" });
    expect(gradientPlan(updateLayer(doc, "px", { visible: false }), "px", "content", "classic").kind).toBe("error");
  });
});
