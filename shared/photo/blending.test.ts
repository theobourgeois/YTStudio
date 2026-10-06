import { describe, expect, it } from "vitest";
import { BLEND_MODES, blendModeForKey, compositingOf, describeBlending, normalizeRange, patchBlending, stepBlendMode } from "./blending.ts";
import { setCompositing, setLayerBlending } from "./edits.ts";
import { createPhotoProject, normalizePhotoProject } from "./project.ts";
import type { PhotoProject, PixelLayer } from "./types.ts";

const pixel = (id: string, extra: Partial<PixelLayer> = {}): PixelLayer => ({
  id,
  kind: "pixel",
  name: id,
  visible: true,
  opacity: 1,
  surface: null,
  size: { width: 10, height: 10 },
  transform: { x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0 },
  ...extra,
});
const doc = (...layers: PixelLayer[]): PhotoProject => ({ ...createPhotoProject("t", { width: 10, height: 10 }), layers });

describe("the modes", () => {
  it("are Photoshop's 27, in its menu's order and groups", () => {
    expect(BLEND_MODES).toHaveLength(27);
    expect(BLEND_MODES.map((m) => m.group)).toEqual([...BLEND_MODES.map((m) => m.group)].sort((a, b) => a - b));
    expect(BLEND_MODES[3].label).toBe("Multiply");
  });
  it("step with ⇧+ / ⇧− and wrap, and answer Photoshop's letters", () => {
    expect(stepBlendMode("normal", 1)).toBe("dissolve");
    expect(stepBlendMode("normal", -1)).toBe("luminosity");
    expect(stepBlendMode("luminosity", 1)).toBe("normal");
    expect(blendModeForKey("m")).toBe("multiply");
    expect(blendModeForKey("Q")).toBeNull();
  });
});

describe("normalising", () => {
  it("keeps what differs from the defaults and drops the rest", () => {
    const d = normalizePhotoProject({
      version: 4,
      canvas: { width: 10, height: 10 },
      compositing: "photoshop",
      layers: [
        { ...pixel("a"), blend: "multiply", fill: 0.4, blending: { channels: { r: false, g: true, b: true }, blendIf: { gray: { layer: [0, 10, 200, 255], underlying: [0, 0, 255, 255] } } } },
        { ...pixel("b"), blend: "normal", fill: 1, blending: { channels: { r: true, g: true, b: true }, blendIf: { red: { layer: [0, 0, 255, 255], underlying: [0, 0, 255, 255] } } } },
        { ...pixel("c"), blend: "glow-up", fill: 7 },
      ],
    });
    expect(d.compositing).toBe("photoshop");
    expect(d.layers[0]).toMatchObject({ blend: "multiply", fill: 0.4, blending: { channels: { r: false, g: true, b: true }, blendIf: { gray: { layer: [0, 10, 200, 255] } } } });
    for (const l of d.layers.slice(1)) expect(["blend", "fill", "blending"].some((k) => k in l)).toBe(false);
  });
  it("opens an older photo in linear light, as it was made", () => {
    const d = normalizePhotoProject({ version: 3, canvas: { width: 10, height: 10 }, layers: [] });
    expect(d.compositing).toBeUndefined();
    expect(compositingOf(d)).toBe("linear");
    expect(compositingOf(createPhotoProject("new"))).toBe("photoshop");
  });
  it("orders a range's handles and keeps them on 0..255", () => {
    expect(normalizeRange([10, 5, 300, 200])).toEqual([10, 10, 255, 255]);
    expect(normalizeRange([1.4, 2.6, 3, 4])).toEqual([1, 3, 3, 4]);
    expect(normalizeRange([1, 2, 3])).toBeNull();
  });
});

describe("edits", () => {
  it("set the blending of several layers in one edit, and nothing changes without a change", () => {
    const d = doc(pixel("a"), pixel("b"), pixel("c"));
    const next = setLayerBlending(d, ["a", "c"], { blend: "screen", fill: 0.5 });
    expect(next.layers.map((l) => l.blend)).toEqual(["screen", undefined, "screen"]);
    expect(setLayerBlending(next, ["a", "c"], { blend: "screen", fill: 0.5 })).toBe(next);
    expect(setLayerBlending(next, ["a"], { blend: "normal", fill: 1 }).layers[0]).toEqual(pixel("a"));
  });
  it("set and clear Blend If entries", () => {
    let l = patchBlending(pixel("a"), { blendIf: { gray: { underlying: [0, 40, 255, 255] } } });
    expect(l.blending?.blendIf?.gray).toEqual({ layer: [0, 0, 255, 255], underlying: [0, 40, 255, 255] });
    l = patchBlending(l, { blendIf: { gray: { underlying: [0, 0, 255, 255] } } });
    expect(l.blending).toBeUndefined();
    expect(describeBlending(patchBlending(pixel("a"), { blend: "overlay", fill: 0.25, channels: { g: false } }))).toBe("Overlay, Fill 25%, channels RB");
  });
  it("switch the compositing", () => {
    const d = doc();
    expect(setCompositing(d, "photoshop")).toBe(d);
    expect(setCompositing(d, "linear").compositing).toBe("linear");
  });
});
