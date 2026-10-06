/**
 * 3D scenes (V8): vaudio's three.js worlds as effects (see `EffectShader.scene` and `shared/scenes/`). Each
 * is stepped from its clip's first frame on what it hears, rendered at the layer's size and put on the
 * clip by its Blend Mode, like a generator. Their afterimage (vaudio's frame persistence) is a simulation:
 * the picture a frame ago, faded, under the new one.
 */
import type { EffectDefinition } from "../effects.ts";
import type { ChoiceSpec, ParamSpec } from "../params.ts";
import type { ParamValues } from "../types.ts";
import { BLEND_GLSL, blending, percent, videoEffect } from "./common.ts";

const num = (v: ParamValues, key: string, fallback: number) => {
  const n = Number(v[key]);
  return Number.isFinite(n) ? n : fallback;
};

const HITS: ChoiceSpec = {
  kind: "choice",
  key: "hits",
  label: "Hits",
  default: "kicks",
  options: [
    { value: "any", label: "Any" },
    { value: "kicks", label: "Kicks" },
    { value: "snares", label: "Snares and notes" },
    { value: "hats", label: "Hats" },
  ],
};

/** What every scene has: what it hears and how hard it reacts, its pace, detail, look and colours. */
const sceneParams = (afterimage: number, colors: [string, string]): ParamSpec[] => [
  { kind: "source", key: "source", label: "Listens To", default: "master" },
  HITS,
  { kind: "number", key: "reactivity", label: "Reactivity", default: 0.8, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  { kind: "number", key: "speed", label: "Speed", default: 1, min: 0, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  percent("detail", "Detail", 0.7),
  percent("afterimage", "Afterimage", afterimage),
  { kind: "number", key: "bloom", label: "Bloom", default: 1, min: 0, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  { kind: "number", key: "exposure", label: "Exposure", default: 1, min: 0.25, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  // vaudio's palette: its two colours, mixed into the scene's own by Colorize.
  percent("colorize", "Colorize", 0),
  { kind: "color", key: "colorA", label: "Color A", default: colors[0] },
  { kind: "color", key: "colorB", label: "Color B", default: colors[1] },
  ...blending("replace"),
];

/**
 * A scene's effect: `look` is its afterimage at 100% (vaudio's persistence per frame at 60 fps), so its
 * memory is how long a bright pixel takes to fade under its 10% cut.
 */
function sceneEffect(type: string, label: string, look: { afterimage: number }, colors: [string, string]): EffectDefinition {
  const damp = (v: ParamValues) => Math.min(0.96, look.afterimage * Math.max(0, num(v, "afterimage", 1)));
  return videoEffect({
    type,
    label,
    tags: ["scene", "audio", "generate"],
    animated: true,
    params: sceneParams(1, colors),
    scene: type,
    simulation: {
      memory: (v, fps) => {
        const d = damp(v);
        return d > 0.02 ? Math.log(0.1) / Math.log(d) / 60 + 1 / fps : 1 / fps;
      },
    },
    glsl: `${BLEND_GLSL}
vec4 effect(vec2 uv) {
  vec4 s = getScene(uv);
  // vaudio's afterimage: last frame's picture, faded at its per-frame rate (at 60 fps), cut below a tenth.
  float damp = min(0.96, ${look.afterimage.toFixed(3)} * afterimage);
  if (hasState && damp > 0.02) {
    vec4 old = getState(uv) * pow(damp, 60.0 * simStep);
    old *= step(vec4(0.1), old);
    s = max(s, old);
  }
  return blendGenerated(s, getColor(uv), opacity);
}`,
  });
}

export const SCENE_EFFECTS: EffectDefinition[] = [
  sceneEffect("tesseract", "Tesseract", { afterimage: 0.85 }, ["#36e4ff", "#ff4d9d"]),
  sceneEffect("singularity", "Singularity", { afterimage: 0.7 }, ["#ffb15c", "#5c8bff"]),
  sceneEffect("cathedral", "Cathedral", { afterimage: 0.78 }, ["#9fd0ff", "#ffcf8a"]),
  sceneEffect("leviathan", "Leviathan", { afterimage: 0.8 }, ["#3cf0d0", "#ff7a4d"]),
];
