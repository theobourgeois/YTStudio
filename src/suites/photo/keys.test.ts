import { describe, expect, it } from "vitest";
import { fitted, handlePoint, moved, rotated, scaled } from "./canvas/handles";
import { resolvePhotoKey } from "./keys";

const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("photo keys", () => {
  it("sets blend modes with Photoshop's ⇧⌥ letters, and steps through them with ⇧+ / ⇧−", () => {
    // A Mac's ⌥ letters are other characters: the physical key decides.
    expect(resolvePhotoKey({ ...press("Ó", { shiftKey: true, altKey: true }), code: "KeyM" }, true)).toEqual({ type: "blendMode", mode: "multiply" });
    expect(resolvePhotoKey(press("s", { shiftKey: true, altKey: true }), false)).toEqual({ type: "blendMode", mode: "screen" });
    expect(resolvePhotoKey({ ...press("Q", { shiftKey: true, altKey: true }), code: "KeyQ" }, true)).toBeNull();
    expect(resolvePhotoKey({ ...press("+", { shiftKey: true }), code: "Equal" }, true)).toEqual({ type: "stepBlendMode", direction: 1 });
    expect(resolvePhotoKey({ ...press("_", { shiftKey: true }), code: "Minus" }, true)).toEqual({ type: "stepBlendMode", direction: -1 });
    // ⌘+ is still the zoom.
    expect(resolvePhotoKey(press("+", { metaKey: true, shiftKey: true }), true)).toEqual({ type: "zoom", factor: 2 });
  });
  it("picks tools, undoes and zooms, with the platform's modifier", () => {
    expect(resolvePhotoKey(press("v"), true)).toEqual({ type: "tool", tool: "move" });
    expect(resolvePhotoKey(press("H"), true)).toEqual({ type: "tool", tool: "hand" });
    expect(resolvePhotoKey(press("z", { metaKey: true }), true)).toEqual({ type: "undo" });
    expect(resolvePhotoKey(press("z", { metaKey: true, shiftKey: true }), true)).toEqual({ type: "redo" });
    // Photoshop's View › Snap: ⇧⌘; (some layouts send ":" with Shift).
    expect(resolvePhotoKey(press(";", { metaKey: true, shiftKey: true }), true)).toEqual({ type: "snap" });
    expect(resolvePhotoKey(press(":", { metaKey: true, shiftKey: true }), true)).toEqual({ type: "snap" });
    expect(resolvePhotoKey(press(";", { metaKey: true }), true)).toBeNull();
    expect(resolvePhotoKey(press("y", { ctrlKey: true }), false)).toEqual({ type: "redo" });
    expect(resolvePhotoKey(press("z", { ctrlKey: true }), true)).toBeNull();
    expect(resolvePhotoKey(press("0", { metaKey: true }), true)).toEqual({ type: "fit" });
    expect(resolvePhotoKey(press("1", { metaKey: true }), true)).toEqual({ type: "actual" });
    expect(resolvePhotoKey(press("=", { metaKey: true }), true)).toEqual({ type: "zoom", factor: 2 });
  });

  it("nudges by 1, or 10 with Shift, and leaves the app's keys alone", () => {
    expect(resolvePhotoKey(press("ArrowLeft"), true)).toEqual({ type: "nudge", dx: -1, dy: 0 });
    expect(resolvePhotoKey(press("ArrowDown", { shiftKey: true }), true)).toEqual({ type: "nudge", dx: 0, dy: 10 });
    expect(resolvePhotoKey(press("w", { metaKey: true }), true)).toBeNull();
    expect(resolvePhotoKey(press(",", { metaKey: true }), true)).toBeNull();
    expect(resolvePhotoKey(press("q"), true)).toBeNull();
  });
});

describe("layer keys (Photoshop's)", () => {
  const alt = (key: string, code: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({ ...press(key, { altKey: true, ...mods }), code });

  it("select, step and run to the ends with ⌥, by the physical key (a Mac's ⌥ changes the character)", () => {
    expect(resolvePhotoKey(alt("å", "KeyA", { metaKey: true }), true)).toEqual({ type: "selectAll" });
    expect(resolvePhotoKey(alt("‘", "BracketRight"), true)).toEqual({ type: "step", direction: 1, add: false });
    expect(resolvePhotoKey(alt("”", "BracketLeft", { shiftKey: true }), true)).toEqual({ type: "step", direction: -1, add: true });
    expect(resolvePhotoKey(alt("≥", "Period"), true)).toEqual({ type: "edge", to: "top", add: false });
    expect(resolvePhotoKey(alt("¯", "Comma", { shiftKey: true }), true)).toEqual({ type: "edge", to: "bottom", add: true });
    expect(resolvePhotoKey(alt("a", "KeyA", { ctrlKey: true }), false)).toEqual({ type: "selectAll" });
  });

  it("Last Filter is Photoshop's ⌃⌘F, Ctrl+Alt+F elsewhere", () => {
    expect(resolvePhotoKey({ ...press("f", { metaKey: true, ctrlKey: true }), code: "KeyF" }, true)).toEqual({ type: "lastFilter" });
    expect(resolvePhotoKey({ ...press("f", { ctrlKey: true, altKey: true }), code: "KeyF" }, false)).toEqual({ type: "lastFilter" });
    expect(resolvePhotoKey(press("f", { metaKey: true }), true)).toBeNull();
    expect(resolvePhotoKey(press("f", { metaKey: true, ctrlKey: true, shiftKey: true }), true)).toBeNull();
  });

  it("merge and arrange with ⌘, leaving ⇧⌘[ / ⇧⌘] to the app's tabs and ⇧⌘E to Export", () => {
    expect(resolvePhotoKey(press("e", { metaKey: true }), true)).toEqual({ type: "merge" });
    expect(resolvePhotoKey(press("e", { metaKey: true, shiftKey: true }), true)).toEqual({ type: "export" });
    expect(resolvePhotoKey({ ...press("]", { metaKey: true }), code: "BracketRight" }, true)).toEqual({ type: "shift", direction: 1 });
    expect(resolvePhotoKey({ ...press("[", { metaKey: true }), code: "BracketLeft" }, true)).toEqual({ type: "shift", direction: -1 });
    expect(resolvePhotoKey({ ...press("{", { metaKey: true, shiftKey: true }), code: "BracketLeft" }, true)).toBeNull();
    expect(resolvePhotoKey(press("j", { metaKey: true }), true)).toEqual({ type: "duplicate" });
  });
});

describe("selection and brush keys (Photoshop's)", () => {
  it("picks the marquee and the brush, selects all, deselects, makes a layer", () => {
    expect(resolvePhotoKey(press("m"), true)).toEqual({ type: "toolGroup", group: "marquee", cycle: false });
    expect(resolvePhotoKey(press("B"), true)).toEqual({ type: "tool", tool: "brush" });
    expect(resolvePhotoKey(press("a", { metaKey: true }), true)).toEqual({ type: "selectCanvas" });
    expect(resolvePhotoKey(press("d", { metaKey: true }), true)).toEqual({ type: "deselect" });
    expect(resolvePhotoKey(press("n", { metaKey: true, shiftKey: true }), true)).toEqual({ type: "newLayer" });
    expect(resolvePhotoKey(press("n", { metaKey: true }), true)).toBeNull();
  });

  it("picks the selection tools' groups (Shift steps through one), inverts and feathers", () => {
    expect(resolvePhotoKey(press("M", { shiftKey: true }), true)).toEqual({ type: "toolGroup", group: "marquee", cycle: true });
    expect(resolvePhotoKey(press("l"), true)).toEqual({ type: "toolGroup", group: "lasso", cycle: false });
    expect(resolvePhotoKey(press("W", { shiftKey: true }), true)).toEqual({ type: "toolGroup", group: "wand", cycle: true });
    expect(resolvePhotoKey(press("i", { metaKey: true, shiftKey: true }), true)).toEqual({ type: "inverse" });
    expect(resolvePhotoKey(press("i", { ctrlKey: true, shiftKey: true }), false)).toEqual({ type: "inverse" });
    expect(resolvePhotoKey(press("F6", { shiftKey: true }), true)).toEqual({ type: "feather" });
  });

  it("sizes and hardens the brush with [ and ], and sets the colours with D and X", () => {
    expect(resolvePhotoKey(press("["), true)).toEqual({ type: "brushSize", direction: -1 });
    expect(resolvePhotoKey(press("]"), true)).toEqual({ type: "brushSize", direction: 1 });
    expect(resolvePhotoKey(press("{", { shiftKey: true }), true)).toEqual({ type: "brushHardness", direction: -1 });
    expect(resolvePhotoKey(press("}", { shiftKey: true }), true)).toEqual({ type: "brushHardness", direction: 1 });
    expect(resolvePhotoKey(press("d"), true)).toEqual({ type: "defaultColours" });
    expect(resolvePhotoKey(press("x"), true)).toEqual({ type: "swapColours" });
  });
});

describe("Edit keys (Photoshop's)", () => {
  it("copies, cuts, makes layers via copy and cut, fills and erases", () => {
    expect(resolvePhotoKey(press("c", { metaKey: true }), true)).toEqual({ type: "copy" });
    expect(resolvePhotoKey(press("x", { metaKey: true }), true)).toEqual({ type: "cut" });
    expect(resolvePhotoKey(press("v", { metaKey: true }), true)).toBeNull();
    expect(resolvePhotoKey(press("j", { metaKey: true }), true)).toEqual({ type: "duplicate" });
    expect(resolvePhotoKey(press("J", { metaKey: true, shiftKey: true }), true)).toEqual({ type: "layerViaCut" });
    expect(resolvePhotoKey(press("Backspace", { altKey: true }), true)).toEqual({ type: "fill", colour: "foreground" });
    expect(resolvePhotoKey(press("Backspace", { metaKey: true }), true)).toEqual({ type: "fill", colour: "background" });
    expect(resolvePhotoKey(press("Backspace"), true)).toEqual({ type: "delete" });
    expect(resolvePhotoKey(press("e"), true)).toEqual({ type: "tool", tool: "eraser" });
    expect(resolvePhotoKey(press("c", { ctrlKey: true }), false)).toEqual({ type: "copy" });
  });
});

describe("transform handles", () => {
  const size = { width: 200, height: 100 };
  const t = { x: 500, y: 300, scaleX: 1, scaleY: 1, rotation: 0 };

  it("puts handles on the layer's corners and edges, turned with it", () => {
    expect(handlePoint(t, size, { u: 0, v: 0 })).toEqual({ x: 400, y: 250 });
    const turned = handlePoint({ ...t, rotation: 90 }, size, { u: 1, v: 0.5 });
    expect(turned.x).toBeCloseTo(500);
    expect(turned.y).toBeCloseTo(400);
  });

  it("scales from the opposite corner, keeping proportions unless free", () => {
    // Bottom-right dragged from (600, 350) to (700, 350): twice as wide, so twice as tall; the top-left stays.
    const s = scaled(t, size, { u: 1, v: 1 }, { x: 700, y: 350 });
    expect([s.scaleX, s.scaleY]).toEqual([1.5, 1.5]);
    expect(handlePoint(s, size, { u: 0, v: 0 })).toEqual({ x: 400, y: 250 });
    const free = scaled(t, size, { u: 1, v: 1 }, { x: 700, y: 350 }, { free: true });
    expect([free.scaleX, free.scaleY]).toEqual([1.5, 1]);
    const edge = scaled(t, size, { u: 0.5, v: 0 }, { x: 0, y: 150 });
    expect([edge.scaleX, edge.scaleY]).toEqual([1, 2]);
    expect(handlePoint(edge, size, { u: 0.5, v: 1 }).y).toBeCloseTo(350);
  });

  it("scales from the centre with Alt, and mirrors past the far side", () => {
    const c = scaled(t, size, { u: 1, v: 1 }, { x: 700, y: 400 }, { fromCentre: true });
    expect([c.x, c.y, c.scaleX]).toEqual([500, 300, 2]);
    const mirrored = scaled(t, size, { u: 1, v: 0.5 }, { x: 300, y: 300 });
    expect(mirrored.scaleX).toBe(-0.5);
  });

  it("rotates about the centre, snapping with Shift, and moves along one axis with Shift", () => {
    expect(rotated(t, { x: 600, y: 300 }, { x: 500, y: 400 }).rotation).toBeCloseTo(90);
    expect(rotated(t, { x: 600, y: 300 }, { x: 600, y: 310 }, true).rotation).toBe(0);
    expect(moved(t, 10, 3, true)).toMatchObject({ x: 510, y: 300 });
  });

  it("fits a layer inside the canvas or over it", () => {
    const canvas = { width: 1000, height: 1000 };
    expect(fitted(t, size, canvas, "contain")).toMatchObject({ x: 500, y: 500, scaleX: 5, scaleY: 5 });
    expect(fitted({ ...t, scaleX: -1 }, size, canvas, "cover")).toMatchObject({ scaleX: -10, scaleY: 10 });
  });
});
