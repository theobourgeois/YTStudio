import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, addFilter, addGeneratorLayer, addImageLayer, addPixelLayer, setMask } from "./edits.ts";
import { fromHalf, toHalf } from "./half.ts";
import { apply, layerMatrix } from "./layers.ts";
import { ORIENTATIONS, type Orientation, canvasOrientationLabel, orientCanvas, orientLayers, orientPoint, orientSelection, orientTransform, orientedSize, pixelSource } from "./orient.ts";
import { createPhotoProject } from "./project.ts";
import { orientedManifest, orientedTile, planOrient } from "./surface-orient.ts";
import type { SurfaceManifest } from "./surfaces.ts";
import type { GeneratorLayer, ImageLayer, LayerTransform, MaskSelection, PhotoProject } from "./types.ts";

const H = "a".repeat(64);

/** The document point a layer pixel lands on. */
const at = (t: LayerTransform, size: { width: number; height: number }, u: number, v: number) => apply(layerMatrix(t, size), u, v);

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe("flipping and turning a layer", () => {
  const size = { width: 300, height: 120 };
  const places: LayerTransform[] = [
    { x: 400, y: 300, scaleX: 1, scaleY: 1, rotation: 0 },
    { x: 120.5, y: -40, scaleX: 0.5, scaleY: 2, rotation: 30 },
    { x: 0, y: 0, scaleX: -1.25, scaleY: 0.75, rotation: -135 },
  ];

  it("carries every pixel by the map, about the given point", () => {
    const pivot = { x: 250, y: 180 };
    for (const t of places) {
      for (const o of ORIENTATIONS) {
        const next = orientTransform(t, o, pivot);
        for (const [u, v] of [[0, 0], [300, 0], [17, 99], [300, 120]]) close(at(next, size, u, v), orientPoint(o, at(t, size, u, v), pivot));
      }
    }
  });

  it("keeps the five numbers plain: a flip negates its axis's scale and the angle, a turn adds to the angle", () => {
    const t = places[0];
    expect(orientTransform(t, "flip-horizontal", t)).toEqual({ ...t, scaleX: -1 });
    expect(orientTransform(t, "flip-vertical", t)).toEqual({ ...t, scaleY: -1 });
    expect(orientTransform(t, "rotate-90-cw", t)).toEqual({ ...t, rotation: 90 });
    expect(orientTransform(t, "rotate-90-ccw", t)).toEqual({ ...t, rotation: -90 });
    expect(orientTransform(t, "rotate-180", t)).toEqual({ ...t, rotation: 180 });
    expect(orientTransform(places[1], "flip-horizontal", places[1])).toEqual({ ...places[1], scaleX: -0.5, rotation: -30 });
  });

  it("keeps a quarter-turned layer's matrix whole numbers, so it's still drawn texel for texel", () => {
    expect(layerMatrix({ x: 600, y: 800, scaleX: 1, scaleY: 1, rotation: 90 }, { width: 1600, height: 1200 })).toEqual([0, 1, -1, 0, 1200, 0]);
    expect(layerMatrix({ x: 0, y: 0, scaleX: -1, scaleY: 1, rotation: -90 }, { width: 2, height: 2 }).slice(0, 4)).toEqual([-0, 1, 1, 0]);
  });

  it("comes back exactly: twice a flip, four quarter turns", () => {
    const pivot = { x: 10, y: 20 };
    for (const t of places) {
      for (const o of ["flip-horizontal", "flip-vertical", "rotate-180"] as Orientation[]) expect(orientTransform(orientTransform(t, o, pivot), o, pivot)).toEqual(t);
      let turned = t;
      for (let i = 0; i < 4; i++) turned = orientTransform(turned, "rotate-90-cw", pivot);
      expect(turned).toEqual(t);
      expect(orientTransform(orientTransform(t, "rotate-90-cw", pivot), "rotate-90-ccw", pivot)).toEqual(t);
    }
  });
});

describe("flipping and turning the selected layers", () => {
  function photo(): PhotoProject {
    let d = createPhotoProject("Orient", { width: 1000, height: 800 });
    d = addImageLayer(d, { id: "a", mediaId: "m1", name: "A", size: { width: 200, height: 100 } }, { transform: { x: 200, y: 200, scaleX: 1, scaleY: 1, rotation: 0 } });
    d = addImageLayer(d, { id: "b", mediaId: "m2", name: "B", size: { width: 100, height: 100 } }, { transform: { x: 550, y: 250, scaleX: 1, scaleY: 1, rotation: 0 } });
    d = addAdjustmentLayer(d, { id: "adj", type: "exposure", params: { exposure: 1 } });
    d = addGeneratorLayer(d, { id: "gen", type: "lens-flare" });
    return d;
  }
  const sizes: Record<string, { width: number; height: number }> = { a: { width: 200, height: 100 }, b: { width: 100, height: 100 } };
  const sizeOf = (l: { id: string }) => sizes[l.id] ?? null;
  const place = (d: PhotoProject, id: string) => (d.layers.find((l) => l.id === id) as ImageLayer).transform;

  it("flips one layer in place", () => {
    const d = photo();
    const next = orientLayers(d, ["a"], "flip-horizontal", sizeOf);
    expect(place(next, "a")).toEqual({ x: 200, y: 200, scaleX: -1, scaleY: 1, rotation: 0 });
    expect(next.layers.find((l) => l.id === "b")).toBe(d.layers.find((l) => l.id === "b"));
  });

  it("flips several about the box around them, as one", () => {
    // A spans x 100..300, B 500..600: the box's centre is x 350.
    const next = orientLayers(photo(), ["a", "b"], "flip-horizontal", sizeOf);
    expect(place(next, "a")).toEqual({ x: 500, y: 200, scaleX: -1, scaleY: 1, rotation: 0 });
    expect(place(next, "b")).toEqual({ x: 150, y: 250, scaleX: -1, scaleY: 1, rotation: 0 });
  });

  it("carries a generator's handles, leaves adjustments, and changes nothing without a layer to move", () => {
    const d = photo();
    const flare = d.layers.find((l) => l.id === "gen") as GeneratorLayer;
    const source = flare.effect.params.source as [number, number];
    const next = orientLayers(d, ["gen", "adj"], "rotate-180", sizeOf);
    const moved = next.layers.find((l) => l.id === "gen") as GeneratorLayer;
    expect(next.layers.find((l) => l.id === "adj")).toBe(d.layers.find((l) => l.id === "adj"));
    // Its only handle with a place is the pivot itself.
    expect(moved.effect.params.source).toEqual(source);
    expect(orientLayers(d, ["adj"], "flip-vertical", sizeOf)).toBe(d);
  });
});

describe("Image Rotation (the whole canvas)", () => {
  function photo(): PhotoProject {
    let d = createPhotoProject("Rotate", { width: 1000, height: 600 });
    d = addImageLayer(d, { id: "img", mediaId: "m1", name: "Image", size: { width: 400, height: 200 } }, { transform: { x: 300, y: 200, scaleX: 1, scaleY: 1, rotation: 0 } });
    d = addPixelLayer(d, { id: "px" });
    d = addFilter(d, "px", { id: "fx", type: "twirl", params: { centre: [100, 50] } });
    d = addAdjustmentLayer(d, { id: "adj", type: "exposure", params: { exposure: 1 } });
    d = setMask(d, "adj", H);
    d = addGeneratorLayer(d, { id: "gen", type: "lens-flare" });
    return d;
  }

  it("swaps the canvas's sides on a quarter turn and carries every layer's pixels with it", () => {
    const d = photo();
    const img = d.layers[0] as ImageLayer;
    const size = { width: 400, height: 200 };
    for (const o of ORIENTATIONS) {
      const { doc } = orientCanvas({ doc: d, selection: null }, o, new Map([[H, "b".repeat(64)]]));
      expect({ width: doc.canvas.width, height: doc.canvas.height }).toEqual(orientedSize(d.canvas, o));
      const next = (doc.layers[0] as ImageLayer).transform;
      const from = { x: 500, y: 300 };
      const to = { x: doc.canvas.width / 2, y: doc.canvas.height / 2 };
      for (const [u, v] of [[0, 0], [400, 200]]) close(at(next, size, u, v), orientPoint(o, at(img.transform, size, u, v), from, to));
    }
    // A quarter turn clockwise takes the top-left corner to the top-right.
    close(orientPoint("rotate-90-cw", { x: 0, y: 0 }, { x: 500, y: 300 }, { x: 300, y: 500 }), { x: 600, y: 0 });
  });

  it("moves points in document pixels and the masks in them, and refuses a mask left behind", () => {
    const d = photo();
    const { doc } = orientCanvas({ doc: d, selection: null }, "flip-horizontal", new Map([[H, "b".repeat(64)]]));
    const px = doc.layers.find((l) => l.id === "px")!;
    expect(px.kind === "pixel" && px.filters?.[0].params.centre).toEqual([900, 50]);
    expect(doc.layers.find((l) => l.id === "adj")!.mask).toEqual({ surface: "b".repeat(64) });
    expect(() => orientCanvas({ doc: d, selection: null }, "rotate-180")).toThrow(/mask/);
  });

  it("carries the selection, a rectangle as one and a mask pixel for pixel", () => {
    const canvas = { width: 6, height: 4 };
    expect(orientSelection({ kind: "rect", x: 1, y: 0, width: 2, height: 1 }, "rotate-90-cw", canvas)).toEqual({ kind: "rect", x: 3, y: 1, width: 1, height: 2 });
    const mask: MaskSelection = { kind: "mask", x: 1, y: 1, width: 3, height: 2, data: Uint8Array.from([1, 2, 3, 4, 5, 6]) };
    for (const o of ORIENTATIONS) {
      const out = orientSelection(mask, o, canvas) as MaskSelection;
      const src = pixelSource(o, canvas);
      for (let y = 0; y < out.height; y++)
        for (let x = 0; x < out.width; x++) {
          const nx = out.x + x;
          const ny = out.y + y;
          const ox = src.ax * nx + src.bx * ny + src.cx;
          const oy = src.ay * nx + src.by * ny + src.cy;
          expect(out.data[y * out.width + x]).toBe(mask.data[(oy - mask.y) * mask.width + (ox - mask.x)]);
        }
    }
  });

  it("names the menu's items as Photoshop does", () => {
    expect(ORIENTATIONS.map(canvasOrientationLabel)).toEqual(["180°", "90° Clockwise", "90° Counter Clockwise", "Flip Canvas Horizontal", "Flip Canvas Vertical"]);
  });
});

describe("a surface in document pixels oriented with the canvas", () => {
  const T = 256;
  const size = { width: 600, height: 300 };
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  // Tile (0, 0) stored, (1, 0) a constant, (2, 1) stored, the rest the fill.
  const surface: SurfaceManifest = { v: 1, format: "r16f", tile: T, fill: [1], tiles: [[0, 0, A], [1, 0, "c:0.5"], [2, 1, B]] };
  const valueAt = (x: number, y: number) => (x * 3 + y * 5) % 2047;
  const stored = (tx: number, ty: number) => new Uint16Array(T * T).map((_, i) => toHalf(valueAt(tx * T + (i % T), ty * T + Math.floor(i / T))));
  const bytes: Record<string, Uint16Array> = { [A]: stored(0, 0), [B]: stored(2, 1) };
  const oldAt = (x: number, y: number) => {
    const ref = surface.tiles.find(([tx, ty]) => tx === Math.floor(x / T) && ty === Math.floor(y / T))?.[2];
    if (!ref) return 1;
    return ref.startsWith("c:") ? Number(ref.slice(2)) : valueAt(x, y);
  };

  it("puts every pixel where the canvas's map takes it, exactly", () => {
    for (const o of ORIENTATIONS) {
      const plan = planOrient(surface, o, size);
      const made = new Map(plan.tiles.map((t) => [`${t.tx},${t.ty}`, orientedTile(surface, o, size, t.tx, t.ty, (ref) => bytes[ref])]));
      const manifest = orientedManifest(surface, plan, plan.tiles.map((t) => `${t.tx},${t.ty}`));
      const src = pixelSource(o, size);
      const next = orientedSize(size, o);
      for (let y = 0; y < next.height; y += 7) {
        for (let x = 0; x < next.width; x += 3) {
          const ref = manifest.tiles.find(([tx, ty]) => tx === Math.floor(x / T) && ty === Math.floor(y / T))?.[2];
          const value = ref === undefined ? 1 : ref.startsWith("c:") ? Number(ref.slice(2)) : fromHalf(made.get(ref)![(y % T) * T + (x % T)]);
          expect(value, `${o} at ${x},${y}`).toBe(oldAt(src.ax * x + src.bx * y + src.cx, src.ay * x + src.by * y + src.cy));
        }
      }
    }
  });

  it("makes no tile only the fill reaches", () => {
    const empty: SurfaceManifest = { ...surface, tiles: [] };
    expect(planOrient(empty, "rotate-90-cw", size)).toEqual({ size: { width: 300, height: 600 }, entries: [], tiles: [] });
  });
});
