import { describe, expect, it } from "vitest";
import { addImageLayer, addPixelLayer, findLayer, setMask } from "@shared/photo/edits";
import { createPhotoProject } from "@shared/photo/project";
import { effectLayerError, eraseRequest, regionOf, toningRequest } from "./effect-requests";

const canvas = { width: 400, height: 300 };

describe("tone_area's request", () => {
  it("reads Dodge and Burn with their range and exposure, Photoshop's defaults otherwise", () => {
    expect(toningRequest({ tool: "dodge" })).toEqual({ effect: { tool: "dodge", range: "midtones", protect: true }, amount: 0.5, part: "content" });
    expect(toningRequest({ tool: "burn", range: "shadows", exposure: 20, protect_tones: false, target: "mask" })).toEqual({ effect: { tool: "burn", range: "shadows", protect: false }, amount: 0.2, part: "mask" });
  });

  it("reads the Sponge with its mode and flow", () => {
    expect(toningRequest({ tool: "sponge", mode: "saturate", flow: 30 })).toEqual({ effect: { tool: "sponge", mode: "saturate", vibrance: true }, amount: 0.3, part: "content" });
  });

  it("says what's wrong", () => {
    expect(() => toningRequest({})).toThrow(/tool is required/);
    expect(() => toningRequest({ tool: "dodge", range: "darks" })).toThrow(/shadows, midtones, highlights/);
    expect(() => toningRequest({ tool: "dodge", exposure: 0 })).toThrow(/1 to 100/);
  });
});

describe("remove_colour's request", () => {
  it("samples at a point and floods from it by default", () => {
    const r = eraseRequest({ point: [10, 20] });
    expect(r).toMatchObject({ sample: null, point: { x: 10, y: 20 }, options: { limits: "contiguous", tolerance: 50 }, protect: null });
  });

  it("takes a colour everywhere, and a protected colour", () => {
    const r = eraseRequest({ colour: "#FFFFFF", tolerance: 20, protect: "#ff0000" });
    expect(r).toMatchObject({ sample: [255, 255, 255], options: { limits: "discontiguous", tolerance: 20, protectForeground: true }, protect: [255, 0, 0] });
    expect(eraseRequest({ colour: "#00ff00", point: [1, 1], limits: "find_edges" }).options.limits).toBe("edges");
  });

  it("says what's missing", () => {
    expect(() => eraseRequest({})).toThrow(/colour to remove/);
    expect(() => eraseRequest({ colour: "#fff", limits: "contiguous" })).toThrow(/like "#ffffff"/);
    expect(() => eraseRequest({ colour: "#ffffff", limits: "contiguous" })).toThrow(/give "point"/);
  });
});

describe("where a call acts", () => {
  it("is a box, feathered, else the selection there, else the whole layer", () => {
    expect(regionOf({ box: { x: 10, y: 10, width: 50, height: 40 } }, null, canvas)).toMatchObject({ kind: "rect", x: 10, y: 10, width: 50, height: 40 });
    expect(regionOf({ box: { x: 10, y: 10, width: 50, height: 40 }, feather: 5 }, null, canvas)?.kind).toBe("mask");
    const selection = { kind: "rect" as const, x: 0, y: 0, width: 5, height: 5 };
    expect(regionOf({}, selection, canvas)).toBe(selection);
    expect(regionOf({}, null, canvas)).toBeNull();
    expect(() => regionOf({ box: { x: 900, y: 900, width: 5, height: 5 } }, null, canvas)).toThrow(/off the canvas/);
  });
});

describe("which layers take it", () => {
  let doc = createPhotoProject("Effects", canvas);
  doc = addImageLayer(doc, { id: "img", mediaId: "m", name: "Photo", size: canvas });
  doc = addPixelLayer(doc, { id: "px", name: "Paint" });
  it("pixel layers, masks for toning, and placed images only converted", () => {
    expect(effectLayerError(findLayer(doc, "px")!, "content", "tone")).toBeNull();
    expect(effectLayerError(findLayer(doc, "img")!, "content", "erase")).toMatch(/convert: true/);
    expect(effectLayerError(findLayer(doc, "px")!, "mask", "tone")).toMatch(/no mask/);
    expect(effectLayerError(findLayer(setMask(doc, "px", null), "px")!, "mask", "tone")).toBeNull();
    expect(effectLayerError(findLayer(setMask(doc, "px", null), "px")!, "mask", "erase")).toMatch(/not its mask/);
  });
});
