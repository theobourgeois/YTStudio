/** Keying and mattes: cut out a colour or brightness, and tidy the edges of the alpha. */
import type { EffectDefinition } from "../effects.ts";
import { degrees, percent, videoEffect } from "./common.ts";

/** Colour to (Cb, Cr), BT.709: where hue and saturation live, apart from brightness. */
const CHROMA_GLSL = `
const vec3 LUMA709 = vec3(0.2126, 0.7152, 0.0722);
vec2 chromaOf(vec3 c) { float y = dot(c, LUMA709); return vec2((c.b - y) / 1.8556, (c.r - y) / 1.5748); }
vec3 fromYcc(float y, vec2 c) {
  float r = y + 1.5748 * c.y;
  float b = y + 1.8556 * c.x;
  return vec3(r, (y - 0.2126 * r - 0.0722 * b) / 0.7152, b);
}
`;

export const KEYING_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "chroma-key",
    label: "Chroma Key",
    tags: ["keying"],
    params: [
      { kind: "color", key: "keyColor", label: "Key Color", default: "#00b140" },
      percent("tolerance", "Tolerance", 0.45),
      percent("softness", "Softness", 0.35),
      percent("edgeFeather", "Edge Feather", 0, { max: 0.05, decimals: 1 }),
      percent("spill", "Spill Suppression", 0.6),
      {
        kind: "choice",
        key: "matteView",
        label: "View",
        default: "final",
        options: [
          { value: "final", label: "Final Result" },
          { value: "matte", label: "Matte" },
        ],
      },
    ],
    demo: { keyColor: "#ff6a70", tolerance: 0.6 },
    glsl: `${CHROMA_GLSL}
// How much of the screen colour a colour holds, like Keylight's screen matte: 1 for the key colour,
// less where it's darker or paler, and nothing for greys or other hues. Measured along the key's
// direction in the chroma plane, docked for straying off it, so shaded screen still keys.
float screenOf(vec3 rgb) {
  vec2 k = chromaOf(keyColor);
  float kl = max(length(k), 1e-3);
  vec2 kd = k / kl;
  vec2 c = chromaOf(rgb);
  return (dot(c, kd) - 2.0 * abs(dot(c, vec2(-kd.y, kd.x)))) / kl;
}
// What stays (1) at a point: gone from 1 - Tolerance of the screen colour, softened over Softness below it.
float keepAt(vec2 uv) {
  float gone = 1.0 - tolerance;
  return 1.0 - smoothstep(gone - max(softness, 1e-3), gone, screenOf(unpremultiply(getColor(uv))));
}
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  float keep = keepAt(uv);
  if (edgeFeather > 0.0) {
    // Averaged over a disc, which smooths a jagged (or noisy) matte's edge.
    const int N = 16;
    for (int i = 0; i < N; i++) {
      float r = sqrt((float(i) + 0.5) / float(N));
      float a = float(i) * 2.39996;
      keep += keepAt(uv + vec2(cos(a) / ratio, sin(a)) * r * edgeFeather);
    }
    keep /= float(N + 1);
  }
  float alpha = c.a * keep;
  if (matteView == 1) return vec4(vec3(alpha), 1.0);
  // Spill: take the key's hue out of what's left (keeping its brightness), so edges and reflections aren't green.
  vec3 rgb = unpremultiply(c);
  vec2 kd = normalize(chromaOf(keyColor) + 1e-6);
  vec2 ch = chromaOf(rgb);
  ch -= kd * max(dot(ch, kd), 0.0) * spill;
  return vec4(clamp(fromYcc(dot(rgb, LUMA709), ch), 0.0, 1.0) * alpha, alpha);
}`,
  }),
  videoEffect({
    type: "luma-key",
    label: "Luma Key",
    tags: ["keying"],
    params: [
      {
        kind: "choice",
        key: "keyType",
        label: "Key Type",
        default: "darker",
        options: [
          { value: "darker", label: "Key Out Darker" },
          { value: "brighter", label: "Key Out Brighter" },
          { value: "similar", label: "Key Out Similar" },
          { value: "dissimilar", label: "Key Out Dissimilar" },
        ],
      },
      percent("threshold", "Threshold", 0.1),
      { ...percent("tolerance", "Tolerance", 0.1), disabledFor: (v) => v.keyType !== "similar" && v.keyType !== "dissimilar" },
      percent("softness", "Edge Softness", 0.05),
      { kind: "boolean", key: "invert", label: "Invert", default: false },
    ],
    demo: { keyType: "darker", threshold: 0.45, softness: 0.1 },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  float y = dot(unpremultiply(c), vec3(0.2126, 0.7152, 0.0722));
  float s = max(softness, 1e-3) * 0.5;
  float keep;
  if (keyType == 0) keep = smoothstep(threshold - s, threshold + s, y);
  else if (keyType == 1) keep = 1.0 - smoothstep(threshold - s, threshold + s, y);
  else {
    // Similar: within Tolerance of the Threshold's brightness.
    float away = smoothstep(tolerance - s, tolerance + s, abs(y - threshold));
    keep = keyType == 2 ? away : 1.0 - away;
  }
  if (invert > 0.5) keep = 1.0 - keep;
  return c * keep;
}`,
  }),
  videoEffect({
    type: "matte-choker",
    label: "Matte Choker",
    tags: ["keying"],
    params: [
      // Up to 3% of the height; negative spreads the matte instead.
      percent("choke", "Choke", 0.2, { min: -1, max: 1 }),
      percent("softness", "Softness", 0.1),
    ],
    demo: { choke: 1, softness: 0.6 },
    // Shrink (or grow), then soften.
    passes: 2,
    glsl: `
const int N = 48;
vec2 discOffset(int i, float reach) {
  float r = sqrt((float(i) + 0.5) / float(N));
  float a = float(i) * 2.39996;
  return vec2(cos(a) / ratio, sin(a)) * r * reach;
}
vec4 effect(vec2 uv) {
  // Past the frame is transparent, as in AE: a layer's edges are edges of its matte too.
  vec4 c = getColorOrClear(uv);
  if (pass == 0) {
    float reach = abs(choke) * 0.03;
    if (reach <= 0.0) return c;
    // The least (choking) or most (spreading) alpha in a disc.
    vec4 best = c;
    for (int i = 0; i < N; i++) {
      vec4 s = getColorOrClear(uv + discOffset(i, reach));
      if (choke > 0.0 ? s.a < best.a : s.a > best.a) best = s;
    }
    // Keeps its own colour where it has one; new edges spread take their colour from what they grew from.
    vec3 rgb = c.a > 0.02 && c.a >= best.a * 0.5 ? unpremultiply(c) : unpremultiply(best);
    return vec4(rgb * best.a, best.a);
  }
  float reach = softness * 0.03;
  if (reach <= 0.0) return c;
  vec4 sum = c;
  float total = 1.0;
  for (int i = 0; i < N; i++) {
    float r = sqrt((float(i) + 0.5) / float(N));
    float w = exp(-3.0 * r * r);
    sum += getColorOrClear(uv + discOffset(i, reach)) * w;
    total += w;
  }
  sum /= total;
  // Only the alpha softens; the picture stays sharp inside.
  vec3 rgb = c.a >= 0.25 ? unpremultiply(c) : unpremultiply(sum);
  return vec4(rgb * sum.a, sum.a);
}`,
  }),
  videoEffect({
    type: "invert-alpha",
    label: "Invert Alpha",
    tags: ["keying"],
    params: [],
    glsl: `
vec4 effect(vec2 uv) {
  // What was transparent becomes opaque (black, as it had no colour) and the other way round: a cut-out's hole.
  vec4 c = getColor(uv);
  float a = 1.0 - c.a;
  return vec4(unpremultiply(c) * a, a);
}`,
  }),
  videoEffect({
    type: "fill",
    label: "Fill",
    tags: ["keying"],
    params: [
      { kind: "color", key: "color", label: "Color", default: "#ff0000" },
      percent("opacity", "Opacity", 1),
    ],
    demo: { color: "#ffcc33" },
    glsl: `
vec4 effect(vec2 uv) {
  // One colour wherever the layer is, keeping its alpha: tints text, cut-outs and silhouettes.
  vec4 c = getColor(uv);
  return mix(c, vec4(color * c.a, c.a), clamp(opacity, 0.0, 1.0));
}`,
  }),
  videoEffect({
    type: "drop-shadow",
    label: "Drop Shadow",
    tags: ["keying", "stylize"],
    params: [
      { kind: "color", key: "shadowColor", label: "Shadow Color", default: "#000000" },
      percent("shadowOpacity", "Opacity", 0.5),
      // 0° casts it up, clockwise like AE: 135° is down and to the right.
      degrees("direction", "Direction", 135, 0, 360),
      percent("shadowDistance", "Distance", 0.01, { max: 0.3, decimals: 1 }),
      percent("softness", "Softness", 0.01, { max: 0.2, decimals: 1 }),
      { kind: "boolean", key: "shadowOnly", label: "Shadow Only", default: false },
    ],
    demo: { shadowOnly: true, shadowColor: "#ffffff", shadowOpacity: 0.7, shadowDistance: 0.1, softness: 0.08 },
    // The shifted alpha blurred across, then down and put under the layer.
    passes: 2,
    glsl: `
vec4 effect(vec2 uv) {
  bool across = pass == 0;
  float a = radians(direction);
  vec2 shift = across ? vec2(sin(a) / ratio, cos(a)) * shadowDistance : vec2(0.0);
  vec2 from = uv - shift;
  // Softness is the blur's reach (3 sigma), as a fraction of the height.
  vec2 reach = across ? vec2(softness / ratio, 0.0) : vec2(0.0, softness);
  float shade = 0.0;
  if (softness <= 0.0) shade = getColorOrClear(from).a;
  else {
    const int N = 24;
    float total = 0.0;
    for (int i = -N; i <= N; i++) {
      float x = float(i) / float(N);
      float w = exp(-4.5 * x * x);
      shade += getColorOrClear(from + reach * x).a * w;
      total += w;
    }
    shade /= total;
  }
  if (across) return vec4(0.0, 0.0, 0.0, shade);
  vec4 shadow = vec4(shadowColor, 1.0) * shade * clamp(shadowOpacity, 0.0, 1.0);
  if (shadowOnly > 0.5) return shadow;
  vec4 c = getInput(uv);
  return c + shadow * (1.0 - c.a);
}`,
  }),
  videoEffect({
    type: "stroke-outline",
    label: "Outline",
    tags: ["keying", "stylize"],
    params: [
      { kind: "color", key: "color", label: "Color", default: "#ffffff" },
      percent("thickness", "Width", 0.01, { min: 0.001, max: 0.08, decimals: 1 }),
      percent("softness", "Softness", 0),
      {
        kind: "choice",
        key: "position",
        label: "Position",
        default: "outside",
        options: [
          { value: "outside", label: "Outside" },
          { value: "center", label: "Center" },
          { value: "inside", label: "Inside" },
        ],
      },
      { kind: "boolean", key: "outlineOnly", label: "Outline Only", default: false },
    ],
    demo: { position: "inside", thickness: 0.06, color: "#ffe14d", softness: 0.3 },
    // A distance field of the alpha's edge, found across (per row), then down (per column).
    passes: 2,
    glsl: `
const int N = 24;
vec4 effect(vec2 uv) {
  float px = 1.0 / resolution.y;
  float soft = 0.75 * px + softness * thickness * 0.5;
  // How far to look (height units), and the step between looks.
  float reach = thickness + soft + 2.0 * px;
  float stride = reach / float(N);
  if (pass == 0) {
    // Per row: the distance to the nearest opaque and the nearest transparent pixel, each nudged by
    // the sample's alpha for sub-pixel edges; stored as 1 - distance / reach (0 = none found).
    float toOpaque = reach;
    float toClear = reach;
    for (int i = -N; i <= N; i++) {
      float x = float(i) * stride;
      float a = getColorOrClear(uv + vec2(x / ratio, 0.0)).a;
      if (a > 0.004) toOpaque = min(toOpaque, max(abs(x) + (0.5 - a) * px, 0.0));
      if (a < 0.996) toClear = min(toClear, max(abs(x) + (a - 0.5) * px, 0.0));
    }
    return vec4(1.0 - toOpaque / reach, 1.0 - toClear / reach, 0.0, 1.0);
  }
  // Per column: the nearest of those, by Pythagoras.
  float out2 = reach * reach;
  float in2 = reach * reach;
  for (int j = -N; j <= N; j++) {
    float y = float(j) * stride;
    vec2 at = uv + vec2(0.0, y);
    // Past the frame is transparent.
    vec2 h = inside(at) ? (1.0 - getColor(at).rg) * reach : vec2(reach, 0.0);
    out2 = min(out2, y * y + h.x * h.x);
    in2 = min(in2, y * y + h.y * h.y);
  }
  // Signed distance to the edge: negative inside.
  float sd = sqrt(out2) - sqrt(in2);
  vec4 c = getInput(uv);
  vec4 line = vec4(color, 1.0);
  if (position == 2) {
    float band = smoothstep(-thickness - soft, -thickness + soft, sd);
    return outlineOnly > 0.5 ? line * band * c.a : mix(c, line * c.a, band);
  }
  float band = position == 0
    ? 1.0 - smoothstep(thickness - soft, thickness + soft, sd)
    : 1.0 - smoothstep(thickness * 0.5 - soft, thickness * 0.5 + soft, abs(sd));
  line *= band;
  if (outlineOnly > 0.5) return position == 0 ? line * (1.0 - c.a) : line;
  // Outside goes under the layer, Center over it.
  return position == 0 ? c + line * (1.0 - c.a) : line + c * (1.0 - band);
}`,
  }),
];
