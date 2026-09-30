/**
 * Text animators (After Effects'): a range over a text's characters, words or lines, and
 * what happens to the ones inside it (moved, scaled, turned, faded, blurred, spaced out,
 * recoloured). Animating the range sweeps the change across the text: letters fading in
 * one after another, words popping up, a highlight running along a caption. A text can
 * have several; how they're applied is in `shared/text-animators.ts`, and drawn by
 * `src/lib/text-render.ts`.
 */
import type { EffectDefinition } from "../effects.ts";
import { PERCENT, PIXELS } from "../params.ts";

export const TEXT_ANIMATOR: EffectDefinition = {
  type: "text-animator",
  label: "Animator",
  builtIn: false,
  stackable: "animator",
  appliesTo: (c) => c.kind === "text",
  params: [
    {
      kind: "choice",
      key: "basedOn",
      label: "Based On",
      default: "characters",
      options: [
        { value: "characters", label: "Characters" },
        { value: "words", label: "Words" },
        { value: "lines", label: "Lines" },
      ],
    },
    // The part of the text it acts on: from Start to End of its characters (or words, or lines), both moved along by Offset.
    { kind: "number", key: "start", label: "Start", default: 0, min: 0, max: 1, slider: true, ...PERCENT },
    { kind: "number", key: "end", label: "End", default: 1, min: 0, max: 1, slider: true, ...PERCENT },
    { kind: "number", key: "offset", label: "Offset", default: 0, min: -1, max: 1, slider: true, ...PERCENT },
    // How the change falls off across the range: all of it at once, or building up, fading out, or peaking in the middle.
    {
      kind: "choice",
      key: "shape",
      label: "Shape",
      default: "square",
      options: [
        { value: "square", label: "Square" },
        { value: "ramp-up", label: "Ramp Up" },
        { value: "ramp-down", label: "Ramp Down" },
        { value: "triangle", label: "Triangle" },
        { value: "round", label: "Round" },
        { value: "smooth", label: "Smooth" },
      ],
    },
    { kind: "boolean", key: "randomOrder", label: "Random Order", default: false },
    // What a fully selected character gets (the rest get none of it, partly selected ones part of it).
    { kind: "vec2", key: "position", label: "Position", default: [0, 0], space: "px", min: -10_000, max: 10_000, step: 1, decimals: 1 },
    { kind: "number", key: "scale", label: "Scale", default: 1, min: 0, max: 20, ...PERCENT },
    { kind: "number", key: "rotation", label: "Rotation", default: 0, min: -36_000, max: 36_000, unit: "°", step: 1, decimals: 1 },
    { kind: "number", key: "opacity", label: "Opacity", default: 1, min: 0, max: 1, slider: true, ...PERCENT, decimals: 0 },
    { kind: "number", key: "blur", label: "Blur", default: 0, min: 0, max: 500, ...PIXELS, decimals: 1 },
    // Thousandths of an em, added after each character (like Text's Tracking).
    { kind: "number", key: "tracking", label: "Tracking", default: 0, min: -1000, max: 5000, step: 5, decimals: 0 },
    { kind: "boolean", key: "recolor", label: "Fill Color", default: false },
    { kind: "color", key: "fill", label: "Color", default: "#ffe14d", disabledFor: (v) => v.recolor !== true },
  ],
};
