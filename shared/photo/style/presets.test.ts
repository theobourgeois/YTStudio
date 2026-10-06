import { describe, expect, it } from "vitest";
import { createPhotoProject } from "../project.ts";
import type { PhotoProject, PixelLayer } from "../types.ts";
import { BUILT_IN_STYLES, applyStylePreset, builtInStyle, presetFrom } from "./presets.ts";
import { styleDefinition } from "./definitions.ts";
import { addStyleEffect, newStyleEffect } from "./style.ts";

const pixel = (id: string): PixelLayer => ({ id, kind: "pixel", name: id, visible: true, opacity: 1, surface: null, size: { width: 10, height: 10 }, transform: { x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0 } });
const doc = (): PhotoProject => ({ ...createPhotoProject("t", { width: 10, height: 10 }), layers: [pixel("a"), pixel("b")] });

describe("style presets", () => {
  it("are every one made of known effects with valid parameters", () => {
    for (const p of BUILT_IN_STYLES) for (const e of p.effects) expect(styleDefinition(e.type), `${p.name}: ${e.type}`).toBeDefined();
  });
  it("replace a style, or add to it with ⇧, and bring their Blending Options", () => {
    let n = 0;
    const id = () => `fx${++n}`;
    let d = addStyleEffect(doc(), "a", newStyleEffect("stroke", "s0")!);
    d = applyStylePreset(d, ["a"], builtInStyle("builtin:soft-shadow")!, false, id);
    expect(d.layers[0].style!.effects.map((e) => e.type)).toEqual(["drop-shadow"]);
    d = applyStylePreset(d, ["a"], builtInStyle("builtin:outline")!, true, id);
    expect(d.layers[0].style!.effects.map((e) => e.type)).toEqual(["drop-shadow", "stroke"]);
    d = applyStylePreset(d, ["a", "b"], builtInStyle("builtin:glass")!, false, id);
    expect(d.layers.map((l) => l.fill)).toEqual([0, 0]);
    expect(d.layers[1].style!.effects).toHaveLength(4);
  });
  it("are made from a layer: its effects, with or without its Blending Options", () => {
    const d = applyStylePreset(doc(), ["a"], builtInStyle("builtin:glass")!, false);
    const preset = presetFrom("mine", " Mine ", d.layers[0], true);
    expect(preset).toMatchObject({ name: "Mine", blending: { blend: "normal", fill: 0 } });
    expect(preset.effects.map((e) => e.type)).toEqual(["drop-shadow", "inner-shadow", "inner-glow", "bevel-emboss"]);
    expect(presetFrom("x", "x", d.layers[0], false).blending).toBeUndefined();
  });
});
