/** Light: glows, rays, flares and lens effects, in the style of After Effects' Deep Glow, CC Light Rays and Optical Flares. */
import type { EffectDefinition } from "../effects.ts";
import type { ParamSpec } from "../params.ts";
import { degrees, percent, videoEffect } from "./common.ts";

/**
 * Light maths the effects below share. Light is added in linear light (as it
 * adds up in a lens), then turned back into display values; light past white
 * burns towards white like film instead of clipping each channel on its own
 * (an orange glow turned up goes yellow, then white). Layers passed between
 * passes are 8-bit, so what they hold is stored brightness-compressed (`enc`/
 * `dec`, a cube root) with a least-significant-bit dither, which keeps the
 * faint wide tails of a glow smooth instead of banded.
 */
const LIGHT = `
vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toDisplay(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 burn(vec3 c) {
  float over = max(max(c.r, max(c.g, c.b)) - 1.0, 0.0);
  return min(c + over * 0.3, vec3(1.0));
}
float dither() { return (hash(gl_FragCoord.xy) - 0.5) / 255.0; }
vec3 enc(vec3 v) { return pow(clamp(v, 0.0, 1.0), vec3(1.0 / 3.0)) + dither(); }
vec3 dec(vec3 e) { e = max(e, 0.0); return e * e * e; }
// Linear light g added to premultiplied c: on the picture where it's opaque, on its own where it's clear
// (as it would look over black), so a glow spills past a text's letters.
vec4 addLight(vec4 c, vec3 g) {
  vec3 over = toDisplay(burn(toLinear(unpremultiply(c)) + g));
  vec3 alone = toDisplay(burn(g));
  float ga = max(alone.r, max(alone.g, alone.b));
  vec3 rgb = over * c.a + alone * (1.0 - c.a);
  return vec4(rgb + dither() * min(ga * 64.0, 1.0), c.a + (1.0 - c.a) * ga);
}
// The same with a screen, which never quite reaches white.
vec4 screenLight(vec4 c, vec3 g) {
  vec3 s = unpremultiply(c);
  vec3 alone = toDisplay(burn(g));
  float ga = max(alone.r, max(alone.g, alone.b));
  vec3 rgb = (s + alone - s * alone) * c.a + alone * (1.0 - c.a);
  return vec4(rgb + dither() * min(ga * 64.0, 1.0), c.a + (1.0 - c.a) * ga);
}
// A rainbow: 0 red, 0.5 green, 1 violet.
vec3 spectrum(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = vec3(
    smoothstep(0.55, 0.0, abs(x - 0.1)) + 0.35 * smoothstep(0.2, 0.0, abs(x - 0.95)),
    smoothstep(0.35, 0.0, abs(x - 0.45)),
    smoothstep(0.35, 0.0, abs(x - 0.8)));
  return c / max(max(c.r, max(c.g, c.b)), 0.25);
}
`;

/** A point on the clip's frame (fractions of its width and height, from the top left). */
const point = (key: string, label: string, value: [number, number]): ParamSpec => ({
  kind: "vec2",
  key,
  label,
  default: value,
  space: "media",
  min: -10,
  max: 10,
  step: 1,
  decimals: 1,
});

const color = (key: string, label: string, value: string): ParamSpec => ({ kind: "color", key, label, default: value });

/** Where the sample picture's sun is, for the cards. */
const SUN: [number, number] = [0.3, 0.34];

export const LIGHT_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "deep-glow",
    label: "Deep Glow",
    tags: ["light"],
    params: [
      percent("reach", "Radius", 0.2, { min: 0.005, max: 0.75, decimals: 1 }),
      { kind: "number", key: "exposure", label: "Exposure", default: 1, min: 0, max: 10, step: 0.01, decimals: 2, slider: true },
      percent("threshold", "Threshold", 0.8),
      percent("softness", "Threshold Smooth", 0.25),
      color("tint", "Tint Color", "#ffb070"),
      percent("tintAmount", "Tint", 0),
      percent("aberration", "Chromatic Aberration", 0),
      {
        kind: "choice",
        key: "blend",
        label: "Blend Mode",
        default: "add",
        options: [
          { value: "add", label: "Add" },
          { value: "screen", label: "Screen" },
        ],
      },
    ],
    demo: { reach: 0.5, exposure: 1.5, threshold: 0.88, aberration: 0.5 },
    // Seven blurs from the widest down (each halving), each folding in the bright parts again, so
    // the glow is the sum of every scale: a hot core with a falloff that fades out over half the
    // frame (close to how light scatters in a lens). The last pass adds it to the picture.
    passes: 8,
    glsl: `${LIGHT}
const int PASSES = 8;
// What glows: the bright parts, in linear light (premultiplied).
vec3 bright(vec4 c) {
  vec3 s = unpremultiply(c);
  return toLinear(s) * c.a * smoothstep(threshold - softness - 1e-3, threshold, lumaOf(s));
}
float scaleWeight(int p) { return pow(0.8, float(p)); }
vec3 tap(vec2 uv) { return pass == 0 ? bright(getColor(uv)) : dec(getColor(uv).rgb); }
// A Gaussian of sigma (height units): samples spread like the curve itself (so all count the same),
// in a golden-angle spiral turned at random per pixel, which later passes smooth away.
vec3 gather(vec2 uv, float sigma) {
  float spin = hash(gl_FragCoord.xy + float(pass) * 17.3) * 6.2832;
  bool split = aberration > 0.0;
  int n = split ? 21 : 32;
  float spread = 1.0 + aberration * 2.0;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 32; i++) {
    if (i >= n) break;
    float u = (float(i) + 0.5) / float(n);
    float r = sigma * sqrt(-2.0 * log(1.0 - u));
    float a = float(i) * 2.39996 + spin;
    vec2 o = vec2(cos(a) / ratio, sin(a)) * r;
    // Chromatic aberration: red spreads further than green, blue less.
    if (split) sum += vec3(tap(uv + o * spread).r, tap(uv + o).g, tap(uv + o / spread).b);
    else sum += tap(uv + o);
  }
  return sum / float(n);
}
vec4 effect(vec2 uv) {
  float sigma = reach * 0.45 * pow(0.5, float(pass));
  vec3 g = gather(uv, sigma);
  if (pass == 0) return vec4(enc(g), 1.0);
  if (pass < PASSES - 1) {
    // This pass's scale: the picture's bright parts, blurred by the passes still to come. Wider
    // scales carry more of the light, so the falloff reaches far.
    float before = 0.0;
    for (int i = 0; i < PASSES; i++) if (i < pass) before += scaleWeight(i);
    float mine = scaleWeight(pass);
    return vec4(enc((g * before + bright(getInput(uv)) * mine) / (before + mine)), 1.0);
  }
  vec3 glow = g * exposure * 3.0;
  // A soft shoulder on the glow alone: small lights keep all theirs, broad bright areas can't flood the frame.
  glow /= 1.0 + max(glow.r, max(glow.g, glow.b)) / 2.5;
  vec3 t = toLinear(tint);
  t /= max(max(t.r, max(t.g, t.b)), 1e-3);
  glow = mix(glow, t * lumaOf(glow) * 1.4, tintAmount);
  vec4 c = getInput(uv);
  return blend == 1 ? screenLight(c, glow) : addLight(c, glow);
}`,
  }),
  videoEffect({
    type: "light-rays",
    label: "Light Rays",
    tags: ["light"],
    params: [
      point("centre", "Center", [0.5, 0.5]),
      percent("intensity", "Intensity", 1, { max: 5 }),
      percent("reach", "Radius", 0.4, { max: 1 }),
      percent("threshold", "Threshold", 0.75),
      percent("softness", "Warp Softness", 0.3),
      { kind: "boolean", key: "fromSource", label: "Color From Source", default: true },
      { ...color("rayColor", "Color", "#ffe2a8"), disabledFor: (v) => v.fromSource === true },
    ],
    demo: { centre: SUN, intensity: 1.5, reach: 0.7, threshold: 0.88 },
    // A zoom blur towards the centre of the bright parts, in three passes of 16 steps each
    // 16 times longer than the last's (4096 in all), so even long rays are smooth.
    passes: 3,
    glsl: `${LIGHT}
vec3 rayLight(vec2 p, vec2 c) {
  if (!inside(p)) return vec3(0.0);
  vec4 col = getInput(p);
  vec3 s = unpremultiply(col);
  float l = lumaOf(s);
  float k = smoothstep(threshold - 0.05 - softness * 0.3, threshold + 0.05, l) * col.a;
  // The warp: light let through in uneven shafts around the centre (as through leaves or cloud),
  // which the blur draws out into rays. Softer is more even.
  vec2 around = normalize((p - c) * vec2(ratio, 1.0) + 1e-6);
  float shafts = noise(around * 7.0 + 1.7) * 0.6 + noise(around * 19.0 + 4.1) * 0.4;
  k *= mix(smoothstep(0.25, 0.75, shafts) * 1.6, 1.0, softness * softness);
  return (fromSource > 0.5 ? toLinear(s) : toLinear(rayColor) * l) * k;
}
vec4 effect(vec2 uv) {
  const int N = 16;
  vec2 c = toUv(centre);
  // How far towards the centre a ray reaches (as a scale of the distance), and how fast it fades.
  float span = log(max(1.0 - reach * 0.98, 0.02));
  float decay = mix(2.5, 1.0, softness);
  float unit = pow(float(N), float(pass)) / float(N * N * N);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < N; i++) {
    float t = float(i) * unit;
    float w = exp(-decay * t);
    vec2 p = c + (uv - c) * exp(span * t);
    sum += (pass == 0 ? rayLight(p, c) : (inside(p) ? dec(getColor(p).rgb) : vec3(0.0))) * w;
    total += w;
  }
  vec3 rays = sum / total;
  if (pass < 2) return vec4(enc(rays), 1.0);
  return addLight(getInput(uv), rays * intensity * 2.0);
}`,
  }),
  videoEffect({
    type: "glint",
    label: "Glint",
    tags: ["light"],
    params: [
      percent("threshold", "Threshold", 0.85),
      percent("reach", "Length", 0.2, { min: 0.01, max: 1 }),
      {
        kind: "choice",
        key: "streaks",
        label: "Streaks",
        default: "4",
        options: [
          { value: "4", label: "4" },
          { value: "6", label: "6" },
          { value: "8", label: "8" },
        ],
      },
      degrees("angle", "Angle", 45),
      percent("intensity", "Intensity", 1, { max: 5 }),
      color("tint", "Color", "#fff1dc"),
    ],
    demo: { threshold: 0.9, reach: 0.5, streaks: "8", angle: 20, intensity: 1.5 },
    // Each streak is one-sided (a star of 8 has 8), an exact exponential fade in two passes (16 steps,
    // then 16 of 16). Streaks keep only their brightness, three to a layer: the first batch takes
    // three, the next ones two plus the sum so far. The last pass adds them to the picture.
    passes: 9,
    glsl: `${LIGHT}
const int N = 16;
float source(vec2 p) {
  if (!inside(p)) return 0.0;
  vec4 c = getInput(p);
  float l = lumaOf(unpremultiply(c));
  // The hotter, the more: highlights just past the threshold only just glint.
  float k = clamp((l - threshold) / max(1.0 - threshold, 0.02), 0.0, 1.0);
  return pow(l, 2.2) * c.a * k * k;
}
// Which streak a channel of this batch holds (-1: the sum so far, or none).
int streakOf(int batch, int ch) { return batch == 0 ? ch : ch == 0 ? -1 : 1 + 2 * batch + ch; }
vec4 effect(vec2 uv) {
  float count = streaks == 0 ? 4.0 : streaks == 1 ? 6.0 : 8.0;
  float stepLength = reach * 1.6 / float(N * N);
  float fade = exp(-4.0 * stepLength / reach);
  if (pass == 8) {
    vec3 e = getColor(uv).rgb;
    float total = dec(vec3(e.r)).x * 4.0 + dec(vec3(e.g)).x + dec(vec3(e.b)).x;
    return addLight(getInput(uv), toLinear(tint) * total * intensity * 6.0 / count);
  }
  int batch = pass / 2;
  bool coarse = pass % 2 == 1;
  vec3 prev = getColor(uv).rgb;
  vec3 outv = vec3(0.0);
  for (int ch = 0; ch < 3; ch++) {
    int k = streakOf(batch, ch);
    if (k < 0) {
      // Carry the streaks so far: sum them up on a batch's first pass, copy on its second.
      float sum = batch == 1 ? dec(vec3(prev.r)).x + dec(vec3(prev.g)).x + dec(vec3(prev.b)).x
        : dec(vec3(prev.r)).x * 4.0 + dec(vec3(prev.g)).x + dec(vec3(prev.b)).x;
      outv[ch] = coarse ? prev.r : enc(vec3(sum / 4.0)).x;
      continue;
    }
    if (float(k) >= count) continue;
    float a = radians(angle) + float(k) * 2.0 * PI / count;
    vec2 dir = vec2(cos(a) / ratio, sin(a)) * stepLength * (coarse ? float(N) : 1.0);
    float w = 1.0;
    float falloff = coarse ? pow(fade, float(N)) : fade;
    float sum = 0.0;
    float total = 0.0;
    for (int i = 0; i < N; i++) {
      vec2 p = uv - dir * float(i);
      sum += (coarse ? (inside(p) ? dec(vec3(getColor(p)[ch])).x : 0.0) : source(p)) * w;
      total += w;
      w *= falloff;
    }
    outv[ch] = enc(vec3(sum / total)).x;
  }
  return vec4(outv, 1.0);
}`,
  }),
  videoEffect({
    type: "lens-flare",
    label: "Lens Flare",
    tags: ["light", "generate"],
    params: [
      point("centre", "Flare Center", [0.3, 0.3]),
      percent("brightness", "Brightness", 1, { max: 3 }),
      color("flareColor", "Color", "#ffd8a8"),
      { kind: "boolean", key: "anamorphic", label: "Anamorphic Streak", default: false },
      percent("ghosts", "Ghosts", 1, { max: 2 }),
    ],
    demo: { centre: SUN, anamorphic: true, brightness: 1.2 },
    glsl: `${LIGHT}
float hexagon(vec2 p, float r) {
  p = abs(p);
  return max(p.x * 0.866025 + p.y * 0.5, p.y) - r;
}
// A lens ghost: a soft-edged disc or hexagon whose rim splits into colours.
vec3 ghost(vec2 p, vec2 at, float size, vec3 tint, float shape) {
  vec3 c = vec3(0.0);
  for (int ch = 0; ch < 3; ch++) {
    float s = size * (1.0 + (float(ch) - 1.0) * 0.04);
    vec2 q = p - at;
    float d = shape > 0.5 ? hexagon(q, s * 0.9) : length(q) - s;
    float body = 1.0 - smoothstep(-s * 0.35, s * 0.08, d);
    float rim = exp(-pow(d / (s * 0.08), 2.0));
    c[ch] = body * 0.55 + rim * 0.45;
  }
  return c * tint;
}
vec4 effect(vec2 uv) {
  vec2 p = aspect(uv);
  vec2 c = aspect(toUv(centre));
  vec2 d = p - c;
  float r = length(d);
  vec3 tint = toLinear(flareColor);
  vec3 f = vec3(0.0);
  // The source: a hot core in a wide soft glow.
  f += tint * (0.006 / (r * r + 0.006)) * 0.9;
  f += vec3(1.0) * exp(-r * r / 0.0006) * 1.5;
  // Starburst: fine streaks around it, at random lengths.
  float a = atan(d.y, d.x);
  vec2 around = vec2(cos(a), sin(a));
  float burst = pow(noise(around * 9.0 + 3.1), 4.0) * 0.8 + pow(noise(around * 23.0 + 7.7), 6.0) * 0.8;
  f += tint * burst * exp(-r * 5.0) * 0.6;
  // A thin halo whose edge splits into a rainbow.
  float halo = r - 0.38;
  f += spectrum(0.5 + halo / 0.05) * exp(-halo * halo / 0.0012) * 0.1;
  // Anamorphic: a long blue-white line across, like a cinema lens.
  if (anamorphic > 0.5) {
    float across = exp(-abs(d.y) * 180.0) * exp(-abs(d.x) * 1.4);
    float haze = exp(-abs(d.y) * 35.0) * exp(-abs(d.x) * 2.5);
    f += vec3(0.45, 0.65, 1.0) * (across * 1.1 + haze * 0.25);
  }
  // Ghosts along the line from the source through the frame's centre.
  float g = ghosts * smoothstep(0.02, 0.2, length(c) + 0.2);
  f += g * ghost(p, c * 0.55, 0.035, vec3(0.3, 0.6, 1.0), 0.0) * 0.18;
  f += g * ghost(p, c * 0.25, 0.07, vec3(0.5, 1.0, 0.55), 1.0) * 0.1;
  f += g * ghost(p, c * -0.2, 0.02, vec3(1.0, 0.8, 0.4), 0.0) * 0.3;
  f += g * ghost(p, c * -0.45, 0.11, vec3(0.9, 0.35, 0.8), 1.0) * 0.08;
  f += g * ghost(p, c * -0.7, 0.05, vec3(1.0, 0.55, 0.25), 0.0) * 0.14;
  f += g * ghost(p, c * -1.1, 0.16, vec3(0.35, 0.75, 1.0), 0.0) * 0.06;
  f += g * ghost(p, c * -1.35, 0.03, vec3(0.6, 1.0, 0.7), 1.0) * 0.2;
  return screenLight(getColor(uv), f * brightness);
}`,
  }),
  videoEffect({
    type: "light-sweep",
    label: "Light Sweep",
    tags: ["light"],
    params: [
      point("centre", "Center", [0.5, 0.5]),
      degrees("direction", "Direction", -30),
      {
        kind: "choice",
        key: "shape",
        label: "Shape",
        default: "smooth",
        options: [
          { value: "linear", label: "Linear" },
          { value: "smooth", label: "Smooth" },
          { value: "sharp", label: "Sharp" },
        ],
      },
      percent("width", "Width", 0.15, { min: 0.005, max: 1 }),
      percent("intensity", "Sweep Intensity", 0.6, { max: 3 }),
      percent("edgeIntensity", "Edge Intensity", 0.5, { max: 3 }),
      percent("edgeThickness", "Edge Thickness", 0.006, { min: 0.001, max: 0.05, decimals: 1 }),
      color("lightColor", "Light Color", "#ffffff"),
    ],
    demo: { centre: [0.4, 0.5], width: 0.25, intensity: 1 },
    glsl: `${LIGHT}
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  // Across the band, in heights; 0° is an upright band.
  float a = radians(direction);
  vec2 n = vec2(cos(a), sin(a));
  float x = abs(dot(aspect(uv) - aspect(toUv(centre)), n)) / (width * 0.5);
  float band = shape == 0 ? max(1.0 - x, 0.0) : shape == 1 ? 1.0 - smoothstep(0.0, 1.0, x) : 1.0 - smoothstep(0.8, 1.0, x);
  if (band <= 0.0) return c;
  // The layer's edges (where its alpha changes) catch more of the light.
  vec2 e = vec2(edgeThickness / ratio, edgeThickness);
  float gx = getColorOrClear(uv + vec2(e.x, 0.0)).a - getColorOrClear(uv - vec2(e.x, 0.0)).a;
  float gy = getColorOrClear(uv + vec2(0.0, e.y)).a - getColorOrClear(uv - vec2(0.0, e.y)).a;
  float edge = clamp(length(vec2(gx, gy)), 0.0, 1.0);
  vec3 light = toLinear(lightColor) * band * (intensity + edge * edgeIntensity * 2.0);
  vec3 s = toDisplay(burn(toLinear(unpremultiply(c)) + light));
  return vec4(s * c.a, c.a);
}`,
  }),
  videoEffect({
    type: "chromatic-aberration",
    label: "Chromatic Aberration",
    tags: ["light", "camera"],
    params: [
      percent("amount", "Amount", 0.012, { max: 0.15, decimals: 1 }),
      point("centre", "Center", [0.5, 0.5]),
      {
        kind: "choice",
        key: "mode",
        label: "Mode",
        default: "radial",
        options: [
          { value: "radial", label: "Radial" },
          { value: "directional", label: "Directional" },
        ],
      },
      { ...degrees("angle", "Angle", 0), disabledFor: (v) => v.mode !== "directional" },
      percent("softness", "Blur", 0.3),
    ],
    demo: { amount: 0.08, softness: 0.5 },
    glsl: `
vec4 effect(vec2 uv) {
  // How far red and blue land from green, in heights: towards the edges like a lens (the frame's
  // top at the centre's height gets the amount), or the same everywhere in one direction.
  vec2 q = (uv - toUv(centre)) * vec2(ratio, 1.0);
  vec2 shift = mode == 0 ? q * length(q) * amount * 4.0 : vec2(cos(radians(angle)), sin(radians(angle))) * amount;
  shift.x /= ratio;
  // Spread over 15 samples, each lending to the colours of the spectrum around it; blurred, the
  // fringe is a smooth rainbow, sharp it's three copies.
  float width = mix(0.04, 0.75, softness);
  vec4 r = vec4(0.0);
  vec4 g = vec4(0.0);
  vec4 b = vec4(0.0);
  vec3 total = vec3(0.0);
  for (int i = 0; i < 15; i++) {
    float t = float(i) / 7.0 - 1.0;
    vec3 w = exp(-pow((vec3(t) - vec3(1.0, 0.0, -1.0)) / width, vec3(2.0)));
    vec4 s = getColor(uv + shift * t);
    r += s * w.r;
    g += s * w.g;
    b += s * w.b;
    total += w;
  }
  r /= total.r;
  g /= total.g;
  b /= total.b;
  return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`,
  }),
  videoEffect({
    type: "flash",
    label: "Flash",
    tags: ["light"],
    params: [
      percent("amount", "Amount", 0.2),
      { kind: "number", key: "exposure", label: "Exposure", default: 1, min: 0, max: 8, unit: " stops", step: 0.05, decimals: 2, slider: true },
      color("flashColor", "Color", "#ffffff"),
      percent("bloom", "Bloom", 0.4, { max: 2 }),
    ],
    demo: { amount: 0, exposure: 0.7, bloom: 0.6 },
    // The bloom is blurred twice (small, then wide over the small one), so it's smooth with few samples.
    passes: 2,
    glsl: `${LIGHT}
vec3 exposed(vec4 c) { return toLinear(unpremultiply(c)) * c.a * exp2(exposure); }
vec3 bloomGather(vec2 uv, float reach, bool first) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    float r = sqrt((float(i) + 0.5) / 24.0) * reach;
    float a = float(i) * 2.39996 + float(pass);
    vec2 p = uv + vec2(cos(a) / ratio, sin(a)) * r;
    // What's past white spills over.
    sum += first ? max(exposed(getColor(p)) - 1.0, 0.0) * 0.25 : dec(getColor(p).rgb);
  }
  return sum / 24.0;
}
vec4 effect(vec2 uv) {
  if (pass == 0) return vec4(bloom > 0.0 ? enc(bloomGather(uv, 0.025, true)) : vec3(0.0), 1.0);
  vec4 c = getInput(uv);
  vec3 glow = bloom > 0.0 ? bloomGather(uv, 0.07, false) * 2.0 * bloom : vec3(0.0);
  // Exposed in linear light, burning to white past it, with the bloom on top (and around a text's letters).
  vec3 over = toDisplay(burn(toLinear(unpremultiply(c)) * exp2(exposure) + glow));
  vec3 alone = toDisplay(burn(glow));
  float ga = max(alone.r, max(alone.g, alone.b));
  vec4 o = vec4(over * c.a + alone * (1.0 - c.a) + dither() * min(ga * 64.0, 1.0), c.a + (1.0 - c.a) * ga);
  // A flash of colour over all of it.
  float a = max(o.a, c.a);
  return mix(o, vec4(flashColor * a, a), amount);
}`,
  }),
  videoEffect({
    type: "light-leak",
    label: "Light Leak",
    tags: ["light", "generate"],
    params: [
      percent("amount", "Amount", 0.8, { max: 2 }),
      {
        kind: "choice",
        key: "palette",
        label: "Colors",
        default: "warm",
        options: [
          { value: "warm", label: "Warm" },
          { value: "amber", label: "Amber" },
          { value: "rose", label: "Rose" },
          { value: "cool", label: "Cool" },
          { value: "custom", label: "Custom" },
        ],
      },
      { ...color("colorA", "Color 1", "#ff3b1f"), disabledFor: (v) => v.palette !== "custom" },
      { ...color("colorB", "Color 2", "#ffc46b"), disabledFor: (v) => v.palette !== "custom" },
      percent("speed", "Speed", 1, { max: 5 }),
      percent("leakScale", "Scale", 1, { min: 0.2, max: 3 }),
      { kind: "number", key: "seed", label: "Seed", default: 0, min: 0, max: 1000, step: 1, decimals: 0 },
    ],
    demo: { amount: 1.6, seed: 3 },
    animated: true,
    glsl: `${LIGHT}
vec4 effect(vec2 uv) {
  vec3 deep = palette == 0 ? vec3(1.0, 0.18, 0.05) : palette == 1 ? vec3(1.0, 0.45, 0.02) : palette == 2 ? vec3(1.0, 0.15, 0.4)
    : palette == 3 ? vec3(0.1, 0.35, 1.0) : colorA;
  vec3 hot = palette == 0 ? vec3(1.0, 0.72, 0.35) : palette == 1 ? vec3(1.0, 0.85, 0.45) : palette == 2 ? vec3(1.0, 0.65, 0.55)
    : palette == 3 ? vec3(0.5, 0.95, 1.0) : colorB;
  float t = time * speed * 0.1;
  vec2 p = aspect(uv) / leakScale;
  vec2 s = vec2(seed * 7.13, seed * 3.71);
  // Only a few big, smooth octaves (fine detail reads as smoke), warped so the shapes fold and drift.
  vec2 w = vec2(noise(p * 0.9 + s + vec2(t, 0.0)), noise(p * 0.9 + s + vec2(4.7, -t * 0.8)));
  vec2 q = p * 1.3 + w * 1.4 + s + vec2(t * 0.5, -t * 0.25);
  float n = noise(q) * 0.6 + noise(q * 2.1 + 3.3) * 0.3 + noise(q * 4.3 + 7.9) * 0.1;
  // Leaks pour in from an edge that slowly wanders round the frame.
  float side = 0.5 * t + hash(s + 0.37) * 6.2832;
  float edge = dot(aspect(uv), vec2(cos(side), sin(side))) / (0.5 * max(ratio, 1.0));
  float v = n * 0.9 + edge * 0.65 - 0.2;
  float glow = smoothstep(0.1, 1.1, v);
  float heat = smoothstep(0.55, 1.25, v);
  vec3 col = mix(toLinear(deep), toLinear(hot), heat) * glow * glow * (0.8 + heat * 1.6);
  return screenLight(getColor(uv), col * amount);
}`,
  }),
  videoEffect({
    type: "bokeh",
    label: "Bokeh Lights",
    tags: ["light", "generate"],
    params: [
      percent("amount", "Amount", 0.8, { max: 2 }),
      percent("bokehSize", "Size", 0.1, { min: 0.01, max: 0.4, decimals: 1 }),
      percent("density", "Density", 0.25),
      color("bokehColor", "Color", "#ffc27a"),
      percent("variation", "Color Variation", 0.3),
      percent("speed", "Speed", 0.5, { max: 4 }),
      {
        kind: "choice",
        key: "shape",
        label: "Shape",
        default: "circle",
        options: [
          { value: "circle", label: "Circle" },
          { value: "hexagon", label: "Hexagon" },
        ],
      },
    ],
    demo: { amount: 1, bokehSize: 0.14, density: 0.45 },
    animated: true,
    glsl: `${LIGHT}
float hexagon(vec2 p, float r) {
  p = abs(p);
  return max(p.x * 0.866025 + p.y * 0.5, p.y) - r;
}
// One layer of lights: a grid of cells, some lit, each drifting on its own.
vec3 layer(vec2 p, float size, float depth, vec3 base) {
  float cell = size * 2.4;
  vec2 drift = vec2(sin(time * 0.13 * speed + depth * 4.0) * 0.4, time * speed * (0.05 + 0.05 * depth));
  vec2 q = (p + drift) / cell;
  vec2 id = floor(q);
  vec3 sum = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 k = id + vec2(x, y) + depth * 37.0;
      vec2 h = hash2(k);
      if (hash(k + 11.3) > density) continue;
      float phase = hash(k + 5.1) * 6.2832;
      vec2 at = id + vec2(x, y) + 0.5 + (h - 0.5) * 0.7 + 0.12 * vec2(sin(time * speed * 0.7 + phase), cos(time * speed * 0.5 + phase * 1.3));
      float r = mix(0.22, 0.42, hash(k + 2.7));
      vec2 d = (q - at);
      float sd = shape == 1 ? hexagon(d, r * 0.92) : length(d) - r;
      // Soft-edged, a little brighter at the rim, like out-of-focus light through a lens.
      float soft = r * mix(0.06, 0.3, depth);
      float disc = 1.0 - smoothstep(-soft, soft, sd);
      float rim = exp(-pow((sd + soft) / (soft + 0.03), 2.0)) * 0.5;
      float glow = (disc * (0.55 + rim)) * mix(0.35, 1.0, hash(k + 9.9));
      glow *= 0.75 + 0.25 * sin(time * speed * 1.7 + phase);
      vec3 tint = base * mix(vec3(1.0), 0.5 + 0.5 * cos(6.2832 * (hash(k + 4.4) + vec3(0.0, 0.33, 0.67))), variation);
      sum += tint * glow;
    }
  }
  return sum;
}
vec4 effect(vec2 uv) {
  vec2 p = aspect(uv);
  vec3 base = toLinear(bokehColor);
  vec3 f = layer(p, bokehSize, 0.0, base) * 0.5 + layer(p, bokehSize * 0.65, 0.5, base) * 0.45 + layer(p, bokehSize * 0.4, 1.0, base) * 0.4;
  return screenLight(getColor(uv), f * amount);
}`,
  }),
];
