import { describe, expect, it } from "vitest";
import {
  activeFilters,
  addElement,
  addFilter,
  addGeneratorLayer,
  addImageLayer,
  duplicateLayer,
  filtersOf,
  handlePoint,
  moveElement,
  moveFilter,
  moveLayersBy,
  removeElement,
  removeFilter,
  setEffectParams,
  setElement,
  setFilter,
  setFiltersEnabled,
  setGeneratorBlend,
  setHandle,
} from "./edits.ts";
import { unavailableReason } from "./effects/index.ts";
import { createPhotoProject, normalizePhotoProject } from "./project.ts";
import type { EffectElement, GeneratorLayer, ImageLayer, PhotoProject } from "./types.ts";

const withImage = (): PhotoProject => addImageLayer(createPhotoProject("Light", { width: 1000, height: 800 }), { id: "img", mediaId: "m1", name: "Photo", size: { width: 1000, height: 800 } });
const image = (doc: PhotoProject) => doc.layers.find((l) => l.id === "img") as ImageLayer;
const flare = (doc: PhotoProject, id = "fl") => doc.layers.find((l) => l.id === id) as GeneratorLayer;

describe("filters (version 5)", () => {
  it("are added on top of a layer's list, set, bypassed, reordered and removed, each a no-op when nothing changes", () => {
    let doc = addFilter(withImage(), "img", { id: "g1", type: "glow", params: { radius: 200 } });
    doc = addFilter(doc, "img", { id: "g2", type: "glow" });
    expect(filtersOf(image(doc)).map((f) => [f.id, f.params.radius])).toEqual([["g1", 200], ["g2", 60]]);
    // Not a filter, a taken id, or a layer without content: nothing.
    expect(addFilter(doc, "img", { id: "x", type: "exposure" })).toBe(doc);
    expect(addFilter(doc, "img", { id: "g1", type: "glow" })).toBe(doc);
    const set = setFilter(doc, "img", "g2", { params: { radius: 9000, threshold: 120 } });
    expect(filtersOf(image(set))[1].params).toMatchObject({ radius: 4000, threshold: 120 });
    expect(setFilter(set, "img", "g2", { params: { radius: 4000 } })).toBe(set);
    const off = setFilter(doc, "img", "g1", { enabled: false });
    expect(activeFilters(image(off)).map((f) => f.id)).toEqual(["g2"]);
    const allOff = setFiltersEnabled(doc, "img", false);
    expect(image(allOff).filtersEnabled).toBe(false);
    expect(activeFilters(image(allOff))).toEqual([]);
    expect(filtersOf(image(allOff)).every((f) => f.enabled)).toBe(true);
    expect("filtersEnabled" in image(setFiltersEnabled(allOff, "img", true))).toBe(false);
    expect(setFiltersEnabled(doc, "img", true)).toBe(doc);
    const moved = moveFilter(doc, "img", "g2", 0);
    expect(filtersOf(image(moved)).map((f) => f.id)).toEqual(["g2", "g1"]);
    expect(moveFilter(moved, "img", "g2", 0)).toBe(moved);
    const gone = removeFilter(removeFilter(doc, "img", "g1"), "img", "g2");
    expect("filters" in image(gone)).toBe(false);
  });

  it("are normalised: kept in order, a wrong kind kept as unavailable, the switch kept only when off", () => {
    const problems: string[] = [];
    const doc = normalizePhotoProject(
      {
        version: 5,
        layers: [
          {
            kind: "image",
            id: "a",
            mediaId: "m",
            filtersEnabled: false,
            filters: [
              { id: "f1", type: "glow", version: 1, params: { radius: -5, tint: "red" } },
              { id: "f2", type: "exposure", version: 1, params: {} },
              { id: "f3", type: "sparkle", version: 2, params: { n: 1 } },
              "nonsense",
            ],
          },
          { kind: "pixel", id: "b", filters: [] },
        ],
      },
      (p) => problems.push(p),
    );
    const a = doc.layers[0] as ImageLayer;
    expect(a.filters!.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(a.filters![0].params).toMatchObject({ radius: 1, tint: "#ffb070" });
    expect(unavailableReason(a.filters![1], "filter")).toMatch(/isn't a filter/);
    expect(unavailableReason(a.filters![2], "filter")).toMatch(/isn't an effect/);
    expect(a.filtersEnabled).toBe(false);
    expect("filters" in doc.layers[1]).toBe(false);
    expect(problems.join("\n")).toMatch(/exposure isn't a filter/);
    expect(problems.join("\n")).toMatch(/weren't effects/);
  });

  it("go with a duplicated layer, with ids of their own", () => {
    const doc = duplicateLayer(addFilter(withImage(), "img", { id: "g1", type: "glow" }), "img", "copy");
    const copy = doc.layers.find((l) => l.id === "copy") as ImageLayer;
    expect(copy.filters!.map((f) => f.id)).toEqual(["copy_f1"]);
    expect(normalizePhotoProject(JSON.parse(JSON.stringify(doc))).layers.flatMap((l) => filtersOf(l).map((f) => f.id))).toEqual(["g1", "copy_f1"]);
  });
});

describe("generator layers (version 5)", () => {
  it("make a lens flare for this canvas: its source on the upper third, the preset's elements, adding in linear light", () => {
    const doc = addGeneratorLayer(withImage(), { id: "fl", type: "lens-flare" }, "img");
    const f = flare(doc);
    expect(doc.layers.map((l) => l.id)).toEqual(["img", "fl"]);
    expect(f).toMatchObject({ kind: "generator", name: "Lens Flare", blend: "linear-dodge", blendSpace: "linear", effect: { id: "fl_fx", type: "lens-flare" } });
    expect(f.effect.params.source).toEqual([300, 272]);
    expect(f.effect.params.centre).toBeNull();
    const elements = f.effect.params.elements as EffectElement[];
    expect(elements.length).toBeGreaterThan(3);
    // Sizes are fractions of the diagonal: a halo of 0.38 frame heights.
    expect(elements[1].size).toBeCloseTo((0.38 / 2.04) * Math.hypot(1000, 800), 0);
    expect(addGeneratorLayer(doc, { id: "x", type: "glow" })).toBe(doc);
    expect(addGeneratorLayer(doc, { id: "fl", type: "lens-flare" })).toBe(doc);
    expect(normalizePhotoProject(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it("move their handles, by the handle or with the Move tool, and keep the optical centre on the canvas's until it's set", () => {
    const doc = addGeneratorLayer(withImage(), { id: "fl", type: "lens-flare" });
    expect(handlePoint(doc, flare(doc), "centre")).toEqual([500, 400]);
    const moved = moveLayersBy(doc, ["fl"], 10, -5);
    expect(flare(moved).effect.params.source).toEqual([310, 267]);
    expect(flare(moved).effect.params.centre).toBeNull();
    const centred = setHandle(doc, "fl", "centre", [100, 100]);
    expect(flare(moveLayersBy(centred, ["fl"], 1, 1)).effect.params.centre).toEqual([101, 101]);
    expect(setHandle(doc, "fl", "source", null)).toBe(doc);
    expect(setHandle(doc, "fl", "nope", [1, 1])).toBe(doc);
    expect(flare(setHandle(centred, "fl", "centre", null)).effect.params.centre).toBeNull();
    expect(moveLayersBy(doc, ["fl"], 0, 0)).toBe(doc);
  });

  it("set their own parameters and blend, and are normalised", () => {
    let doc = addGeneratorLayer(withImage(), { id: "fl", type: "lens-flare" });
    doc = setEffectParams(doc, "fl", { intensity: 2, colour: "#FF0000" });
    expect(flare(doc).effect.params).toMatchObject({ intensity: 2, colour: "#ff0000" });
    const normal = setGeneratorBlend(doc, "fl", "normal", "document");
    expect("blend" in flare(normal) || "blendSpace" in flare(normal)).toBe(false);
    expect(setGeneratorBlend(doc, "fl", "linear-dodge")).toBe(doc);
    const problems: string[] = [];
    const n = normalizePhotoProject(
      {
        version: 5,
        layers: [
          { kind: "generator", id: "g", blend: "dissolve", blendSpace: "wide", effect: { id: "g_fx", type: "lens-flare", version: 1, params: { source: [5, "x"], elements: [{ type: "ghost", id: "e1", size: -4 }, { type: "nope" }] } } },
          { kind: "generator", id: "h" },
          { kind: "generator", id: "i", effect: { id: "i_fx", type: "glow", version: 1, params: {} } },
        ],
      },
      (p) => problems.push(p),
    );
    expect(n.layers.map((l) => l.id)).toEqual(["g", "i"]);
    const g = n.layers[0] as GeneratorLayer;
    expect("blend" in g || "blendSpace" in g).toBe(false);
    expect(g.effect.params.source).toEqual([0, 0]);
    expect((g.effect.params.elements as EffectElement[]).map((e) => [e.id, e.size])).toEqual([["e1", 0.1]]);
    expect(unavailableReason((n.layers[1] as GeneratorLayer).effect, "generator")).toMatch(/isn't a generator/);
    expect(problems.join("\n")).toMatch(/without an effect/);
  });
});

describe("a flare's elements", () => {
  const doc = () => addGeneratorLayer(withImage(), { id: "fl", type: "lens-flare", preset: "subtle" });
  const elements = (d: PhotoProject) => flare(d).effect.params.elements as EffectElement[];

  it("are added at their defaults, set, hidden, reordered and removed, keeping their ids", () => {
    const before = elements(doc()).map((e) => e.id);
    let d = addElement(doc(), "fl", "elements", "streak", "s1", { size: 900 });
    expect(elements(d).map((e) => e.id)).toEqual([...before, "s1"]);
    expect(elements(d).at(-1)).toMatchObject({ id: "s1", type: "streak", enabled: true, size: 900, thickness: 3 });
    expect(addElement(d, "fl", "elements", "streak", "s1")).toBe(d);
    expect(addElement(d, "fl", "elements", "sparkle", "x")).toBe(d);
    d = setElement(d, "fl", "elements", "s1", { angle: 400, enabled: false, id: "hijack" });
    expect(elements(d).at(-1)).toMatchObject({ id: "s1", angle: 180, enabled: false });
    expect(setElement(d, "fl", "elements", "s1", { angle: 180 })).toBe(d);
    d = moveElement(d, "fl", "elements", "s1", 0);
    expect(elements(d)[0].id).toBe("s1");
    expect(moveElement(d, "fl", "elements", "s1", 0)).toBe(d);
    d = removeElement(d, "fl", "elements", "s1");
    expect(elements(d).map((e) => e.id)).toEqual(before);
    expect(removeElement(d, "fl", "elements", "s1")).toBe(d);
  });
});
