import { describe, expect, it } from "vitest";
import { duplicateLayer } from "../edits.ts";
import { createPhotoProject, normalizePhotoProject } from "../project.ts";
import type { PhotoProject, PixelLayer } from "../types.ts";
import { addStyleEffect, describeStyle, globalLightOf, moveStyleEffect, newStyleEffect, removeStyleEffect, setGlobalLight, setLayerStyle, setStyleEffect, setStyleEnabled } from "./style.ts";

const pixel = (id: string): PixelLayer => ({ id, kind: "pixel", name: id, visible: true, opacity: 1, surface: null, size: { width: 10, height: 10 }, transform: { x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0 } });
const doc = (): PhotoProject => ({ ...createPhotoProject("t", { width: 10, height: 10 }), layers: [pixel("a"), pixel("b")] });
const add = (d: PhotoProject, type: string, id: string, params = {}) => addStyleEffect(d, "a", newStyleEffect(type, id, params)!);

describe("layer styles", () => {
  it("keep effects in drawing order, bottom first, instances in their own order", () => {
    let d = add(doc(), "stroke", "s1");
    d = add(d, "drop-shadow", "d1");
    d = add(d, "color-overlay", "c1");
    d = add(d, "drop-shadow", "d2");
    expect(d.layers[0].style!.effects.map((e) => e.id)).toEqual(["d1", "d2", "c1", "s1"]);
    // ↑ / ↓ only among their own type.
    expect(moveStyleEffect(d, "a", "d1", 1).layers[0].style!.effects.map((e) => e.id)).toEqual(["d2", "d1", "c1", "s1"]);
    expect(moveStyleEffect(d, "a", "d2", 1)).toBe(d);
  });
  it("allow ten of a multiple type and one of the others", () => {
    let d = doc();
    for (let i = 0; i < 12; i++) d = add(d, "stroke", `s${i}`);
    expect(d.layers[0].style!.effects).toHaveLength(10);
    d = add(add(d, "outer-glow", "g1"), "outer-glow", "g2");
    expect(d.layers[0].style!.effects.filter((e) => e.type === "outer-glow")).toHaveLength(1);
  });
  it("change, hide and remove effects; the last one gone takes the style", () => {
    let d = add(doc(), "drop-shadow", "d1");
    d = setStyleEffect(d, "a", "d1", { params: { distance: 12, size: 999 } });
    expect(d.layers[0].style!.effects[0].params).toMatchObject({ distance: 12, size: 250, opacity: 35 });
    expect(setStyleEffect(d, "a", "d1", { params: { distance: 12 } })).toBe(d);
    d = setStyleEnabled(d, ["a"], false);
    expect(d.layers[0].style!.enabled).toBe(false);
    expect(describeStyle(d.layers[0])).toMatch(/^all hidden: d1 Drop Shadow: Multiply #000000, 35%, 12 px at 120°/);
    d = removeStyleEffect(d, "a", "d1");
    expect(d.layers[0].style).toBeUndefined();
  });
  it("paste copies with ids of their own, and clear removes them", () => {
    let d = add(add(doc(), "drop-shadow", "d1"), "stroke", "s1");
    let n = 0;
    d = setLayerStyle(d, ["b"], d.layers[0].style!, () => `new${++n}`);
    expect(d.layers[1].style!.effects.map((e) => [e.id, e.type])).toEqual([
      ["new1", "drop-shadow"],
      ["new2", "stroke"],
    ]);
    expect(setLayerStyle(d, ["b"], null, () => "x").layers[1].style).toBeUndefined();
    // A duplicated layer's effects get ids of their own too.
    const dup = duplicateLayer(d, "a", "c");
    expect(dup.layers[1].style!.effects.map((e) => e.id)).toEqual(["c_fx1", "c_fx2"]);
  });
  it("set Global Light, wrapped and held", () => {
    const d = doc();
    expect(globalLightOf(d)).toEqual({ angle: 120, altitude: 30 });
    expect(setGlobalLight(d, { angle: 200, altitude: 120 }).globalLight).toEqual({ angle: -160, altitude: 90 });
    expect(setGlobalLight(d, { angle: 120 })).toBe(d);
  });
  it("normalise: repaired parameters, unknown effects kept, extras dropped, adjustments without effects", () => {
    const problems: string[] = [];
    const d = normalizePhotoProject(
      {
        version: 4,
        canvas: { width: 10, height: 10 },
        globalLight: { angle: 45, altitude: 20 },
        layers: [
          {
            ...pixel("a"),
            style: {
              enabled: true,
              effects: [
                { id: "s", type: "stroke", params: { size: 4, position: "sideways" } },
                { id: "z", type: "sparkles", params: { much: 1 } },
                { id: "g1", type: "outer-glow" },
                { id: "g2", type: "outer-glow" },
              ],
            },
          },
          { id: "x", kind: "adjustment", name: "x", effect: { type: "exposure" }, style: { enabled: true, effects: [{ type: "stroke" }] } },
        ],
      },
      (p) => problems.push(p),
    );
    expect(d.globalLight).toEqual({ angle: 45, altitude: 20 });
    const style = d.layers[0].style!;
    expect(style.effects.map((e) => e.id)).toEqual(["g1", "s", "z"]);
    expect(style.effects[1].params).toMatchObject({ size: 4, position: "outside" });
    expect(style.effects[2]).toMatchObject({ type: "sparkles", params: { much: 1 } });
    expect(problems.join("\n")).toMatch(/unknown type "sparkles"/);
    expect(problems.join("\n")).toMatch(/more than 1 Outer Glow/);
    expect(d.layers[1].style).toBeUndefined();
  });
});
