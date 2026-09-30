/**
 * Colour: brightness and contrast, hue and saturation, white balance, black & white, looks, vignette,
 * levels and curves, exposure, tints and gradient maps, colour balance, channel mixing, Leave Color, threshold.
 */
import type { EffectDefinition } from "../effects.ts";
import type { ChoiceSpec, NumberSpec } from "../params.ts";
import { percent, videoEffect } from "./common.ts";

/** Which channels an effect changes (Levels, Curves). */
const channelChoice = (): ChoiceSpec => ({
  kind: "choice",
  key: "channel",
  label: "Channel",
  default: "rgb",
  options: [
    { value: "rgb", label: "RGB" },
    { value: "red", label: "Red" },
    { value: "green", label: "Green" },
    { value: "blue", label: "Blue" },
  ],
});

/** GLSL: 1 for each channel the `channel` choice changes. */
const CHANNEL_MASK = `vec3 channelMask() { return channel == 0 ? vec3(1.0) : vec3(equal(ivec3(channel - 1), ivec3(0, 1, 2))); }`;

/** A point of Curves, moved up or down. */
const curvePoint = (key: string, label: string): NumberSpec => ({
  kind: "number",
  key,
  label,
  default: 0,
  min: -1,
  max: 1,
  scale: 100,
  step: 1,
  decimals: 0,
  slider: true,
});

/** How much of an input channel goes into an output one (Channel Mixer), -200..200%. */
const mixerWeight = (key: string, label: string, value: number): NumberSpec => percent(key, label, value, { min: -2, max: 2 });

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
  videoEffect({
    type: "levels",
    label: "Levels",
    tags: ["color"],
    params: [
      percent("inBlack", "Input Black", 0),
      percent("inWhite", "Input White", 1),
      { kind: "number", key: "gamma", label: "Gamma", default: 1, min: 0.1, max: 5, step: 0.01, decimals: 2, slider: true },
      percent("outBlack", "Output Black", 0),
      percent("outWhite", "Output White", 1),
      channelChoice(),
    ],
    demo: { inBlack: 0.14, inWhite: 0.82, gamma: 1.35 },
    glsl: `
${CHANNEL_MASK}
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  // Input White below Input Black inverts, as in Premiere.
  float span = inWhite - inBlack;
  span = abs(span) < 1e-4 ? 1e-4 : span;
  vec3 t = clamp((rgb - inBlack) / span, 0.0, 1.0);
  t = pow(t, vec3(1.0 / gamma));
  vec3 leveled = mix(vec3(outBlack), vec3(outWhite), t);
  return withRgb(c, mix(rgb, leveled, channelMask()));
}`,
  }),
  videoEffect({
    type: "curves",
    label: "Curves",
    tags: ["color"],
    params: [
      curvePoint("shadows", "Shadows"),
      curvePoint("darks", "Darks"),
      curvePoint("midtones", "Midtones"),
      curvePoint("lights", "Lights"),
      curvePoint("highlights", "Highlights"),
      channelChoice(),
    ],
    demo: { shadows: -0.15, darks: -0.55, lights: 0.55 },
    glsl: `
${CHANNEL_MASK}
// Where the curve goes at x, through points at 0, 25, 50, 75 and 100% (y) with slopes m.
float curveAt(float x, float y[5], float m[5]) {
  float s = clamp(x, 0.0, 1.0) * 4.0;
  int k = min(int(s), 3);
  float t = s - float(k);
  float t2 = t * t;
  float t3 = t2 * t;
  return (2.0 * t3 - 3.0 * t2 + 1.0) * y[k] + (t3 - 2.0 * t2 + t) * 0.25 * m[k]
    + (3.0 * t2 - 2.0 * t3) * y[k + 1] + (t3 - t2) * 0.25 * m[k + 1];
}
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  // Each point moves up or down by up to a quarter, and the curve is kept rising.
  float v[5] = float[5](shadows, darks, midtones, lights, highlights);
  float y[5];
  for (int i = 0; i < 5; i++) y[i] = float(i) * 0.25 + 0.25 * v[i];
  for (int i = 1; i < 5; i++) y[i] = max(y[i], y[i - 1]);
  // Monotone cubic (Fritsch-Butland slopes), so it never overshoots or bends back.
  float d[4];
  for (int i = 0; i < 4; i++) d[i] = (y[i + 1] - y[i]) * 4.0;
  float m[5];
  m[0] = d[0];
  m[4] = d[3];
  for (int i = 1; i < 4; i++) m[i] = d[i - 1] * d[i] > 0.0 ? 2.0 * d[i - 1] * d[i] / (d[i - 1] + d[i]) : 0.0;
  vec3 curved = vec3(curveAt(rgb.r, y, m), curveAt(rgb.g, y, m), curveAt(rgb.b, y, m));
  return withRgb(c, mix(rgb, curved, channelMask()));
}`,
  }),
  videoEffect({
    type: "exposure",
    label: "Exposure",
    tags: ["color"],
    params: [
      { kind: "number", key: "exposure", label: "Exposure", default: 0, min: -5, max: 5, step: 0.01, decimals: 2, slider: true },
      { kind: "number", key: "offset", label: "Offset", default: 0, min: -0.5, max: 0.5, step: 0.001, decimals: 3, slider: true },
      { kind: "number", key: "gammaCorrection", label: "Gamma Correction", default: 1, min: 0.1, max: 5, step: 0.01, decimals: 2, slider: true },
    ],
    demo: { exposure: 1 },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  // In linear light, like a camera's stops: one stop doubles the light.
  vec3 lin = pow(max(unpremultiply(c), 0.0), vec3(2.2));
  lin = max(lin * exp2(exposure) + offset, 0.0);
  vec3 rgb = pow(lin, vec3(1.0 / 2.2));
  return withRgb(c, pow(clamp(rgb, 0.0, 1.0), vec3(1.0 / gammaCorrection)));
}`,
  }),
  videoEffect({
    type: "vibrance",
    label: "Vibrance",
    tags: ["color"],
    params: [percent("vibrance", "Vibrance", 0.5, { min: -1 }), percent("saturation", "Saturation", 0, { min: -1 })],
    demo: { vibrance: 1 },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  float hi = max(rgb.r, max(rgb.g, rgb.b));
  float lo = min(rgb.r, min(rgb.g, rgb.b));
  float sat = hi - lo;
  // Skin: red above green above blue, at an orange hue (spared, like Lightroom's vibrance).
  float hue = (rgb.g - rgb.b) / max(rgb.r - rgb.b, 1e-4);
  float skin = clamp((rgb.r - rgb.g) * 12.0, 0.0, 1.0) * clamp((rgb.g - rgb.b) * 12.0, 0.0, 1.0)
    * smoothstep(0.05, 0.3, hue) * smoothstep(0.85, 0.55, hue);
  // Dull colours gain the most; ones already saturated hardly move.
  float k = vibrance * (1.0 - sat) * (1.0 - sat) * (1.0 - 0.7 * skin);
  rgb = mix(vec3(y), rgb, 1.0 + 1.5 * k);
  rgb = mix(vec3(y), rgb, 1.0 + saturation);
  return withRgb(c, rgb);
}`,
  }),
  videoEffect({
    type: "tint",
    label: "Tint",
    tags: ["color"],
    params: [
      { kind: "color", key: "mapBlack", label: "Map Black To", default: "#000000" },
      { kind: "color", key: "mapWhite", label: "Map White To", default: "#ffffff" },
      percent("amount", "Amount to Tint", 1),
    ],
    demo: { mapBlack: "#1d1340", mapWhite: "#ffe1a8" },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  return withRgb(c, mix(rgb, mix(mapBlack, mapWhite, y), amount));
}`,
  }),
  videoEffect({
    type: "gradient-map",
    label: "Gradient Map",
    tags: ["color"],
    params: [
      { kind: "color", key: "shadows", label: "Shadows", default: "#120c5c" },
      { kind: "color", key: "midtones", label: "Midtones", default: "#d4247a" },
      { kind: "color", key: "highlights", label: "Highlights", default: "#ffb547" },
      percent("midpoint", "Midpoint", 0.5, { min: 0.05, max: 0.95 }),
      percent("amount", "Amount", 1),
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  float y = clamp(dot(rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  vec3 mapped = y < midpoint
    ? mix(shadows, midtones, smoothstep(0.0, 1.0, y / midpoint))
    : mix(midtones, highlights, smoothstep(0.0, 1.0, (y - midpoint) / (1.0 - midpoint)));
  return withRgb(c, mix(rgb, mapped, amount));
}`,
  }),
  videoEffect({
    type: "color-balance",
    label: "Color Balance",
    tags: ["color"],
    params: [
      { kind: "color", key: "shadowTint", label: "Shadow Tint", default: "#1f7fd6" },
      percent("shadowAmount", "Shadow Amount", 0.3, { min: -1 }),
      { kind: "color", key: "midtoneTint", label: "Midtone Tint", default: "#d69a5c" },
      percent("midtoneAmount", "Midtone Amount", 0, { min: -1 }),
      { kind: "color", key: "highlightTint", label: "Highlight Tint", default: "#ffae4a" },
      percent("highlightAmount", "Highlight Amount", 0.3, { min: -1 }),
      { kind: "boolean", key: "preserveLuminosity", label: "Preserve Luminosity", default: true },
    ],
    demo: { shadowAmount: 0.8, highlightAmount: 0.6, midtoneTint: "#2fb8a0", midtoneAmount: 0.35 },
    glsl: `
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// A tint's colour without its brightness: greys push nowhere.
vec3 hueOf(vec3 t) { return t - lumaOf(t); }
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  float y = lumaOf(rgb);
  // Three overlapping ranges that always add up to one.
  float ws = 1.0 - smoothstep(0.0, 0.55, y);
  float wh = smoothstep(0.45, 1.0, y);
  float wm = max(0.0, 1.0 - ws - wh);
  rgb += 0.5 * (ws * shadowAmount * hueOf(shadowTint) + wm * midtoneAmount * hueOf(midtoneTint) + wh * highlightAmount * hueOf(highlightTint));
  if (preserveLuminosity > 0.5) rgb += y - lumaOf(rgb);
  return withRgb(c, rgb);
}`,
  }),
  videoEffect({
    type: "channel-mixer",
    label: "Channel Mixer",
    tags: ["color"],
    params: [
      mixerWeight("redR", "Red from Red", 1),
      mixerWeight("redG", "Red from Green", 0),
      mixerWeight("redB", "Red from Blue", 0),
      mixerWeight("greenR", "Green from Red", 0),
      mixerWeight("greenG", "Green from Green", 1),
      mixerWeight("greenB", "Green from Blue", 0),
      mixerWeight("blueR", "Blue from Red", 0),
      mixerWeight("blueG", "Blue from Green", 0),
      mixerWeight("blueB", "Blue from Blue", 1),
      { kind: "boolean", key: "monochrome", label: "Monochrome", default: false },
    ],
    // Red and blue swapped.
    demo: { redR: 0, redB: 1, blueR: 1, blueB: 0 },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  vec3 mixed = vec3(dot(rgb, vec3(redR, redG, redB)), dot(rgb, vec3(greenR, greenG, greenB)), dot(rgb, vec3(blueR, blueG, blueB)));
  // Monochrome: every channel as the red one says, like Premiere's.
  return withRgb(c, monochrome > 0.5 ? vec3(mixed.r) : mixed);
}`,
  }),
  videoEffect({
    type: "look",
    label: "Look",
    tags: ["color"],
    params: [
      {
        kind: "choice",
        key: "look",
        label: "Look",
        default: "teal-orange",
        options: [
          { value: "teal-orange", label: "Teal & Orange" },
          { value: "bleach-bypass", label: "Bleach Bypass" },
          { value: "cross-process", label: "Cross Process" },
          { value: "noir", label: "Noir" },
          { value: "warm-film", label: "Warm Film" },
          { value: "cold-night", label: "Cold Night" },
          { value: "faded", label: "Faded" },
          { value: "vintage", label: "Vintage" },
        ],
      },
      percent("intensity", "Intensity", 1),
    ],
    demo: { look: "bleach-bypass" },
    glsl: `
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 saturated(vec3 c, float s) { return mix(vec3(lumaOf(c)), c, s); }
// More contrast with soft ends (k = 1: a full smoothstep).
vec3 sCurve(vec3 x, float k) { x = clamp(x, 0.0, 1.0); return mix(x, x * x * (3.0 - 2.0 * x), k); }

vec3 graded(vec3 c) {
  float y = lumaOf(c);
  if (look == 0) {
    // Teal & Orange: warm colours (skin) to orange, the rest to teal, split along the brightness too.
    vec3 g = sCurve(c, 0.45);
    float warm = clamp((c.r - c.b) * 2.5, -1.0, 1.0);
    vec3 toward = warm > 0.0 ? vec3(1.0, 0.58, 0.28) : vec3(0.1, 0.55, 0.62);
    g = mix(g, toward * lumaOf(g) / lumaOf(toward), 0.45 * abs(warm));
    g += (1.0 - y) * (1.0 - y) * vec3(-0.05, 0.02, 0.05) + y * y * vec3(0.06, 0.01, -0.06);
    return saturated(g, 1.15);
  }
  if (look == 1) {
    // Bleach Bypass: the silver left in (overlay of the luma), so harsh and washed of colour.
    vec3 lum = vec3(y);
    vec3 o = mix(2.0 * c * lum, 1.0 - 2.0 * (1.0 - c) * (1.0 - lum), step(0.5, lum));
    return saturated(sCurve(o, 0.25), 0.4);
  }
  if (look == 2) {
    // Cross Process: slide film in negative chemistry; hard reds, yellow-green highlights, blue shadows.
    c = clamp(c, 0.0, 1.0);
    return vec3(smoothstep(0.04, 0.92, c.r), mix(c.g, smoothstep(0.0, 1.0, c.g), 0.7) * 1.04, c.b * 0.62 + 0.16);
  }
  if (look == 3) {
    // Noir: black & white through a light orange filter (darker skies), hard contrast, a cold tone.
    float v = smoothstep(0.1, 0.92, dot(c, vec3(0.33, 0.57, 0.1)));
    return vec3(v) * vec3(0.96, 1.0, 1.05);
  }
  if (look == 4) {
    // Warm Film: golden, brown blacks lifted a little, creamy highlights.
    vec3 g = sCurve(c * vec3(1.1, 1.0, 0.76) + vec3(0.02, 0.0, -0.02), 0.3);
    g = vec3(0.05, 0.035, 0.02) + g * vec3(0.93, 0.92, 0.86);
    return saturated(g, 0.88);
  }
  if (look == 5) {
    // Cold Night: day for night; dark, blue and drained of colour.
    vec3 g = saturated(c, 0.45) * vec3(0.6, 0.8, 1.12);
    g = pow(max(g, 0.0), vec3(1.35)) * 0.85;
    return g + (1.0 - y) * vec3(0.0, 0.015, 0.045);
  }
  if (look == 6) {
    // Faded: flat, milky blacks and dim whites, a touch warm.
    vec3 g = saturated(sCurve(c, 0.2), 0.72);
    return (0.1 + 0.8 * g) * vec3(1.02, 1.0, 0.95);
  }
  // Vintage: old print; yellow highlights, cyan-blue shadows, gentle colour.
  c = clamp(c, 0.0, 1.0);
  vec3 g = vec3(0.08 + 0.9 * smoothstep(-0.05, 1.0, c.r), 0.07 + 0.86 * mix(c.g, smoothstep(0.0, 1.0, c.g), 0.4), 0.2 + 0.56 * c.b);
  return saturated(g, 0.78);
}
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  return withRgb(c, mix(rgb, graded(rgb), intensity));
}`,
  }),
  videoEffect({
    type: "leave-color",
    label: "Leave Color",
    tags: ["color"],
    params: [
      { kind: "color", key: "colorToLeave", label: "Color To Leave", default: "#e0322a" },
      percent("tolerance", "Tolerance", 0.12),
      percent("edgeSoftness", "Edge Softness", 0.08),
      percent("amount", "Amount to Decolor", 1),
    ],
    demo: { colorToLeave: "#ff6a1f", tolerance: 0.06 },
    glsl: `
// Where a colour sits on the colour wheel (Cb, Cr): greys are at the centre.
vec2 chroma(vec3 c) { return vec2(dot(c, vec3(-0.1146, -0.3854, 0.5)), dot(c, vec3(0.5, -0.4542, -0.0458))); }
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  vec2 pc = chroma(rgb);
  vec2 kc = chroma(colorToLeave);
  float lp = length(pc);
  float lk = length(kc);
  // How far round the wheel it is from the colour to leave (0..1 = 0..180 degrees).
  float turn = acos(clamp(dot(pc, kc) / max(lp * lk, 1e-6), -1.0, 1.0)) / PI;
  float keep = 1.0 - smoothstep(tolerance, tolerance + edgeSoftness + 1e-3, turn);
  keep *= smoothstep(0.005, 0.04, lp) * smoothstep(0.005, 0.02, lk);
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  return withRgb(c, mix(rgb, vec3(y), amount * (1.0 - keep)));
}`,
  }),
  videoEffect({
    type: "threshold",
    label: "Threshold",
    tags: ["color"],
    params: [percent("level", "Level", 0.5), percent("softness", "Softness", 0, { max: 0.5 })],
    demo: { level: 0.66 },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  float y = dot(unpremultiply(c), vec3(0.2126, 0.7152, 0.0722));
  // At least a pixel's worth of softness, so the edges don't stair-step.
  float w = max(softness, fwidth(y)) * 0.5 + 1e-4;
  return withRgb(c, vec3(smoothstep(level - w, level + w, y)));
}`,
  }),
];
