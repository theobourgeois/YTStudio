/** Colour: brightness and contrast, hue and saturation, white balance, black & white, looks, vignette. */
import type { EffectDefinition } from "../effects.ts";
import { percent, videoEffect } from "./common.ts";

export const COLOR_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "brightness-contrast",
    label: "Brightness & Contrast",
    tags: ["color"],
    params: [
      percent("brightness", "Brightness", 0.1, { min: -1 }),
      percent("contrast", "Contrast", 0.25, { min: -1 }),
    ],
    demo: { brightness: 0.04, contrast: 0.4 },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c) + brightness;
  // Up to 4x steeper, or flat grey at -100%.
  float k = contrast > 0.0 ? 1.0 + 3.0 * contrast : 1.0 + contrast;
  return withRgb(c, (rgb - 0.5) * k + 0.5);
}`,
  }),
  videoEffect({
    type: "hue-saturation",
    label: "Hue & Saturation",
    tags: ["color"],
    params: [
      { kind: "number", key: "hue", label: "Hue", default: 0, min: -180, max: 180, unit: "°", step: 1, decimals: 0, slider: true },
      percent("saturation", "Saturation", 1.5, { max: 3 }),
      percent("lightness", "Lightness", 0, { min: -1 }),
    ],
    demo: { hue: 0, saturation: 2.2 },
    glsl: `
// Turns a colour around the grey axis.
vec3 turnHue(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = turnHue(unpremultiply(c), radians(hue));
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(y), rgb, saturation);
  rgb = lightness > 0.0 ? mix(rgb, vec3(1.0), lightness) : rgb * (1.0 + lightness);
  return withRgb(c, rgb);
}`,
  }),
  videoEffect({
    type: "temperature",
    label: "Temperature",
    tags: ["color"],
    params: [percent("temperature", "Temperature", 0.4, { min: -1 }), percent("tint", "Tint", 0, { min: -1 })],
    demo: { temperature: 0.8 },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  float before = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  // Warmer: more red, less blue. Tint: magenta (less green) or green.
  rgb *= vec3(1.0 + 0.25 * temperature, 1.0 - 0.2 * tint, 1.0 - 0.3 * temperature);
  // Keep the brightness.
  float after = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  if (after > 0.0) rgb *= before / after;
  return withRgb(c, rgb);
}`,
  }),
  videoEffect({
    type: "black-white",
    label: "Black & White",
    tags: ["color"],
    params: [percent("amount", "Amount", 1), percent("contrast", "Contrast", 0.15, { min: -1 })],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  y = (y - 0.5) * (contrast > 0.0 ? 1.0 + 2.0 * contrast : 1.0 + contrast) + 0.5;
  return withRgb(c, mix(rgb, vec3(y), amount));
}`,
  }),
  videoEffect({
    type: "sepia",
    label: "Sepia",
    tags: ["color"],
    params: [percent("amount", "Amount", 0.85)],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  vec3 old = vec3(
    dot(rgb, vec3(0.393, 0.769, 0.189)),
    dot(rgb, vec3(0.349, 0.686, 0.168)),
    dot(rgb, vec3(0.272, 0.534, 0.131)));
  return withRgb(c, mix(rgb, old, amount));
}`,
  }),
  videoEffect({
    type: "duotone",
    label: "Duotone",
    tags: ["color"],
    params: [
      { kind: "color", key: "shadows", label: "Shadows", default: "#23195e" },
      { kind: "color", key: "highlights", label: "Highlights", default: "#ff8fb8" },
      percent("amount", "Amount", 1),
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  float y = smoothstep(0.02, 0.98, dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
  return withRgb(c, mix(rgb, mix(shadows, highlights, y), amount));
}`,
  }),
  videoEffect({
    type: "invert",
    label: "Invert",
    tags: ["color"],
    params: [percent("amount", "Amount", 1)],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  return withRgb(c, mix(rgb, 1.0 - rgb, amount));
}`,
  }),
  videoEffect({
    type: "vignette",
    label: "Vignette",
    tags: ["color"],
    params: [
      // Negative lightens the edges instead.
      percent("amount", "Amount", 0.6, { min: -1 }),
      percent("size", "Size", 0.5),
      percent("feather", "Feather", 0.6),
    ],
    demo: { amount: 0.85, size: 0.35 },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  // 0 in the middle, 1 in the corners; follows the frame's shape like Premiere's.
  float d = length(uv - 0.5) * 1.41421;
  float from = size * 0.9;
  float v = smoothstep(from, from + feather * (1.05 - from) + 0.01, d);
  vec3 rgb = unpremultiply(c);
  rgb = amount > 0.0 ? rgb * (1.0 - amount * v) : mix(rgb, vec3(1.0), -amount * v);
  return withRgb(c, rgb);
}`,
  }),
];
