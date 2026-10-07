/**
 * Depth filters (docs/photo/effects/scene-maps.md): looks that know how far away each part of the picture is, from its
 * depth map (`../../scene.ts`, read as `env.scene` / `scene_at`). Their references are
 * `../../reference/filters/depth.ts`, their WGSL `src/suites/photo/render/filters/depth.ts`.
 */
import type { Gradient } from "../../types.ts";
import type { EffectDefinition } from "../index.ts";
import { choice, gradient, kernelFilter, look, n, percent } from "../kernel.ts";
import { stops } from "./colour.ts";

/** Depth Grade's gradients, farthest first. */
export const DEPTH_GRADIENTS = {
  depthMap: stops("Depth Map", [[0, "#000000"], [1, "#ffffff"]], "classic"),
  thermal: stops("Thermal", [[0, "#05001a"], [0.25, "#3a0a9c"], [0.5, "#d4005a"], [0.75, "#ff8a00"], [1, "#fff6a8"]]),
  warmNear: stops("Warm Near", [[0, "#2c6a9e"], [0.5, "#9aa6a8"], [1, "#e8a060"]]),
  night: stops("Night", [[0, "#06123c"], [0.6, "#3b4a78"], [1, "#808080"]], "classic"),
  dusk: stops("Dusk", [[0, "#ff5fa2"], [0.55, "#b07a9a"], [1, "#808080"]], "classic"),
};

const DEPTH_GRADE = kernelFilter({
  type: "depth-grade",
  label: "Depth Grade",
  description:
    "Colours the picture by how far away each part is (its depth map, from the depth model): the gradient's left end for the farthest, its right end for the nearest, between Far and Near. Replace shows the gradient alone (the Depth Map look is the depth map itself, black far, white near); Color keeps the picture's brightness and takes the gradient's colour; Soft Light tints it (mid-grey leaves it as it is). Needs the depth model.",
  category: "Depth",
  params: [
    gradient("gradient", "Gradient", DEPTH_GRADIENTS.warmNear, "The colours along the depth: its left end for the farthest, its right end for the nearest."),
    choice("blend", "Blend", [["replace", "Replace"], ["color", "Color"], ["soft-light", "Soft Light"]], "color", "Replace: the gradient alone. Color: the picture's brightness in the gradient's colour. Soft Light: the gradient tints the picture, grey leaving it alone."),
    percent("far", "Far", 0, "The depth taking the gradient's left end (0: the farthest in the picture)."),
    percent("near", "Near", 100, "The depth taking the gradient's right end (100: the nearest)."),
  ],
  reach: () => 0,
  scene: () => ({ depth: true, subject: false }),
  summary: (p) => `${(p.gradient as Gradient).name}, ${p.blend}${n(p, "far") || n(p, "near") !== 100 ? `, ${n(p, "far")}–${n(p, "near")}%` : ""}`,
  presets: [
    look("depth-map", "Depth Map", "The depth map itself: black far away, white up close.", { gradient: DEPTH_GRADIENTS.depthMap, blend: "replace", far: 0, near: 100 }),
    look("thermal", "Thermal", "Depth as heat: violet distance, yellow-hot foreground.", { gradient: DEPTH_GRADIENTS.thermal, blend: "replace", far: 0, near: 100 }),
    look("warm-near", "Warm Near, Cool Far", "A cinematic split: warm foreground, cool blue distance.", { gradient: DEPTH_GRADIENTS.warmNear, blend: "color", far: 0, near: 100, mix: 70 }),
    look("night", "Night Fall", "The distance sinks into deep blue night; the foreground keeps its colour.", { gradient: DEPTH_GRADIENTS.night, blend: "soft-light", far: 0, near: 80 }),
    look("dusk", "Pink Dusk", "A pink haze over the distance.", { gradient: DEPTH_GRADIENTS.dusk, blend: "soft-light", far: 0, near: 85 }),
  ],
});

export const DEPTH_FILTERS: EffectDefinition[] = [DEPTH_GRADE];
