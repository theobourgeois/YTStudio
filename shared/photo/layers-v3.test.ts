import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, addImageLayer, addPixelLayer, duplicateLayer, nextLayerName, removeMask, replaceLayer, setMask, setSurface, setTransform } from "./edits.ts";
import { layerMatrix } from "./layers.ts";
import { createPhotoProject, normalizePhotoProject } from "./project.ts";
import { compileRender } from "./render-plan.ts";
import { allSelection, boxCoverage, layerPixelCoverage, pixelCoverage, rectSelection, sameSelection } from "./selection.ts";
import { PHOTO_VERSION, type PixelLayer, type RectSelection } from "./types.ts";

const H = (c: string) => c.repeat(64);

describe("pixel layers and masks (version 3)", () => {
  const doc = createPhotoProject("Paint", { width: 800, height: 600 });

  it("adds an empty pixel layer the canvas's size, named as Photoshop names them", () => {
    let d = addPixelLayer(doc, { id: "p1" });
    d = addPixelLayer(d, { id: "p2" });
    expect(d.layers.map((l) => l.name)).toEqual(["Layer 1", "Layer 2"]);
    expect(d.layers[0]).toMatchObject({ kind: "pixel", surface: null, size: { width: 800, height: 600 }, transform: { x: 400, y: 300, scaleX: 1, scaleY: 1, rotation: 0 } });
    expect(nextLayerName(d)).toBe("Layer 3");
    // Above the given layer.
    expect(addPixelLayer(d, { id: "p3" }, "p1").layers.map((l) => l.id)).toEqual(["p1", "p3", "p2"]);
    expect(addPixelLayer(d, { id: "p1" })).toBe(d);
  });

  it("paints (a new surface), moves, masks and unmasks; no-ops keep the document", () => {
    let d = addPixelLayer(doc, { id: "p" });
    d = setSurface(d, "p", H("a"));
    expect((d.layers[0] as PixelLayer).surface).toBe(H("a"));
    expect(setSurface(d, "p", H("a"))).toBe(d);
    expect((setTransform(d, "p", { x: 10 }).layers[0] as PixelLayer).transform.x).toBe(10);
    const masked = setMask(d, "p", null);
    expect(masked.layers[0].mask).toEqual({ surface: null });
    expect(setMask(masked, "p", null)).toBe(masked);
    expect(setMask(masked, "p", H("b")).layers[0].mask).toEqual({ surface: H("b") });
    const bare = removeMask(masked, "p");
    expect("mask" in bare.layers[0]).toBe(false);
    expect(removeMask(bare, "p")).toBe(bare);
    // A copy shares the surfaces (they never change in place).
    expect(duplicateLayer(setMask(d, "p", H("b")), "p", "q").layers[1]).toMatchObject({ surface: H("a"), mask: { surface: H("b") } });
  });

  it("replaces an image by its pixels in its place", () => {
    let d = addImageLayer(doc, { id: "i", mediaId: "m", name: "Photo", size: { width: 400, height: 300 } });
    d = addPixelLayer(d, { id: "top" });
    const pixels: PixelLayer = { id: "i", kind: "pixel", name: "Photo", visible: true, opacity: 1, surface: H("c"), size: { width: 400, height: 300 }, transform: { x: 400, y: 300, scaleX: 1, scaleY: 1, rotation: 0 } };
    const next = replaceLayer(d, "i", pixels);
    expect(next.layers.map((l) => l.kind)).toEqual(["pixel", "pixel"]);
    expect(next.layers[0]).toBe(pixels);
    expect(replaceLayer(d, "nope", pixels)).toBe(d);
  });

  it("normalises pixel layers and masks, reporting what it repairs, and reads older versions", () => {
    const problems: string[] = [];
    const d = normalizePhotoProject(
      {
        version: 3,
        canvas: { width: 800, height: 600 },
        layers: [
          { kind: "pixel", id: "p", surface: H("d"), size: { width: 100, height: 50 }, mask: { surface: H("e") } },
          { kind: "pixel", id: "q", surface: "not a hash", mask: { surface: null } },
          { kind: "image", id: "i", mediaId: "m", mask: "nope" },
        ],
      },
      (p) => problems.push(p),
    );
    expect(d.version).toBe(PHOTO_VERSION);
    expect(d.layers[0]).toMatchObject({ name: "Layer", surface: H("d"), size: { width: 100, height: 50 }, transform: { x: 50, y: 25 }, mask: { surface: H("e") } });
    expect(d.layers[1]).toMatchObject({ surface: null, size: { width: 800, height: 600 }, mask: { surface: null } });
    expect("mask" in d.layers[2]).toBe(false);
    expect(problems).toHaveLength(2);
    expect(normalizePhotoProject(d)).toEqual(d);
    expect(normalizePhotoProject({ version: 2, layers: [] }).version).toBe(PHOTO_VERSION);
  });

  it("plans pixel layers (empty ones too) and masks, keyed by their surfaces", () => {
    let d = addPixelLayer(doc, { id: "p" });
    d = addAdjustmentLayer(d, { id: "x", type: "exposure", params: { exposure: 1 } });
    const plain = compileRender(d, new Map());
    expect(plain.nodes.map((n) => n.kind)).toEqual(["pixel", "adjustment"]);
    expect(plain.nodes[0]).toMatchObject({ surface: null, mask: null });
    const painted = compileRender(setSurface(d, "p", H("a")), new Map());
    expect(painted.prefixKeys[0]).not.toBe(plain.prefixKeys[0]);
    // A mask that reveals everything isn't one; a painted one is, in the layer's pixels (an adjustment's: the canvas).
    expect(compileRender(setMask(d, "x", null), new Map()).key).toBe(plain.key);
    const masked = compileRender(setMask(setMask(d, "x", H("b")), "p", H("c")), new Map());
    expect(masked.nodes[0].mask).toEqual({ surface: H("c"), size: { width: 800, height: 600 } });
    expect(masked.nodes[1].mask).toEqual({ surface: H("b"), size: { width: 800, height: 600 } });
    expect(masked.prefixKeys[0]).not.toBe(plain.prefixKeys[0]);
    expect(masked.commutes).toBe(true);
  });
});

describe("selections", () => {
  const canvas = { width: 100, height: 80 };
  const s = rectSelection({ x: 90.5, y: 10 }, { x: 20, y: 120 }, canvas)!;

  it("is a rectangle from any two corners, clipped to the canvas", () => {
    expect(s).toEqual({ kind: "rect", x: 20, y: 10, width: 70.5, height: 70 });
    expect(rectSelection({ x: -10, y: 5 }, { x: -1, y: 50 }, canvas)).toBeNull();
    expect(allSelection(canvas)).toEqual({ kind: "rect", x: 0, y: 0, width: 100, height: 80 });
    expect(sameSelection(s, { ...s })).toBe(true);
    expect(sameSelection(s, null)).toBe(false);
  });

  it("covers pixels fractionally at its edges, exactly inside and outside", () => {
    expect(pixelCoverage(s, 30, 30)).toBe(1);
    expect(pixelCoverage(s, 19, 30)).toBe(0);
    expect(pixelCoverage(s, 90, 30)).toBe(0.5);
    expect(boxCoverage(s, { x0: 89, y0: 9, x1: 91, y1: 11 })).toBeCloseTo((1.5 * 1) / 4);
  });

  it("covers a layer's pixels through its transform: exactly at right angles, sampled when turned", () => {
    const rect: RectSelection = { kind: "rect", x: 0, y: 0, width: 50, height: 80 };
    // A 100 × 80 layer at half size, its left edge at x = 25: layer pixel 50 spans x = 50..50.5.
    const half = layerMatrix({ x: 50, y: 40, scaleX: 0.5, scaleY: 0.5, rotation: 0 }, { width: 100, height: 80 });
    expect(layerPixelCoverage(rect, half, 49, 10)).toBe(1);
    expect(layerPixelCoverage(rect, half, 50, 10)).toBe(0);
    const mirrored = layerMatrix({ x: 50, y: 40, scaleX: -1, scaleY: 1, rotation: 90 }, { width: 100, height: 80 });
    expect([0, 1]).toContain(layerPixelCoverage(rect, mirrored, 10, 10));
    // Turned 45°: a pixel straddling the edge is partly in, in 64ths.
    const turned = layerMatrix({ x: 50, y: 40, scaleX: 1, scaleY: 1, rotation: 45 }, { width: 100, height: 80 });
    const shares = Array.from({ length: 100 }, (_, u) => layerPixelCoverage(rect, turned, u, 40));
    expect(shares.some((c) => c > 0 && c < 1)).toBe(true);
    for (const c of shares) expect(Math.round(c * 64)).toBeCloseTo(c * 64, 9);
  });
});

describe("pasted pixels", () => {
  it("make a pixel layer of their own size and place", () => {
    const doc = addPixelLayer(createPhotoProject("Paste", { width: 800, height: 600 }), { id: "p", surface: "a".repeat(64), size: { width: 40, height: 30 }, transform: { x: 120, y: 95, scaleX: 1, scaleY: 1, rotation: 0 } });
    expect(doc.layers[0]).toMatchObject({ kind: "pixel", name: "Layer 1", surface: "a".repeat(64), size: { width: 40, height: 30 }, transform: { x: 120, y: 95 } });
  });
});
