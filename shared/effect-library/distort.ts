/**
 * Distortions in the style of After Effects' Distort category (lens, displacement, polar, ripple, offset, transform...).
 * Each one moves where the picture is read from, in square units (fractions of the frame's height), and reads it with
 * `getColor`, so past the frame's edges it follows the clip's Motion Edges. Strengths are keyframable numbers whose
 * zero leaves the picture alone, so on an adjustment layer across a cut they make the transitions editors build from
 * them (lens zooms, whip pans, shakes).
 */
import type { EffectDefinition } from "../effects.ts";
import { PERCENT, type ChoiceSpec, type NumberSpec, type Vec2Spec } from "../params.ts";
import { degrees, percent, videoEffect } from "./common.ts";

/** A point on the clip's frame (shown in its pixels), the middle by default. */
function point(key: string, label: string, value: [number, number] = [0.5, 0.5]): Vec2Spec {
  return { kind: "vec2", key, label, default: value, space: "media", min: -10, max: 10, step: 1, decimals: 1 };
}

function choice(key: string, label: string, options: [value: string, label: string][]): ChoiceSpec {
  return { kind: "choice", key, label, default: options[0][0], options: options.map(([value, label]) => ({ value, label })) };
}

/** An angle that can be keyframed over many turns (no slider). */
function turns(key: string, label: string, value = 0): NumberSpec {
  return { kind: "number", key, label, default: value, min: -36_000, max: 36_000, unit: "°", step: 1, decimals: 1 };
}

export const DISTORT_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "lens",
    label: "Lens",
    tags: ["distort"],
    params: [
      point("centre", "Center"),
      // The lens's radius, as a fraction of the height.
      percent("size", "Size", 0.4, { min: 0, max: 5 }),
      // Negative pinches, positive bulges; 100% is a glass ball.
      percent("convergence", "Convergence", 0.6, { min: -1, max: 1 }),
      choice("background", "Background", [
        ["original", "Original"],
        ["none", "None"],
      ]),
    ],
    // Over the sample picture's sun, so the card shows the ball.
    demo: { centre: [0.32, 0.4], size: 0.36, convergence: 1 },
    glsl: `
vec4 effect(vec2 uv) {
  vec2 c = toUv(centre);
  vec2 d = (uv - c) * vec2(ratio, 1.0);
  float radius = max(size, 1e-4);
  float r = length(d) / radius;
  vec4 outside = background == 0 ? getColor(uv) : vec4(0.0);
  // The rim is softened over a pixel and a half (or a sliver of a small lens), so it never stair-steps.
  float soft = max(1.5 / (resolution.y * radius), 0.004);
  if (r >= 1.0 + soft) return outside;
  float t = min(r, 1.0);
  // Where the lens reads from, as a fraction of how far out the pixel is. Both profiles meet the picture
  // again at the rim (so Original shows no seam) and never fold over, whatever the values.
  float k;
  if (convergence >= 0.0) {
    // A sphere: the middle magnified (4x at 100%), squeezed ever tighter towards the silhouette like a glass ball.
    float z = sqrt(max(1.0 - t * t, 0.0));
    k = 1.0 - 0.75 * convergence * z;
  } else {
    // Pinched: the middle shows up to about four times as much, easing back to 1:1 at the rim.
    float u = 1.0 - t;
    k = 1.0 - 2.9 * convergence * u * u;
  }
  vec4 inner = getColor(c + d * k / vec2(ratio, 1.0));
  return mix(inner, outside, smoothstep(1.0 - soft, 1.0 + soft, r));
}`,
  }),
  videoEffect({
    type: "optics-compensation",
    label: "Optics Compensation",
    tags: ["distort"],
    params: [
      degrees("fov", "Field of View", 90, 0, 180),
      // Off adds a fisheye's barrel; on takes one away (pincushion), e.g. straightening an action camera.
      { kind: "boolean", key: "reverse", label: "Reverse Lens Distortion", default: false },
      choice("orientation", "FOV Orientation", [
        ["horizontal", "Horizontal"],
        ["vertical", "Vertical"],
        ["diagonal", "Diagonal"],
      ]),
      point("viewCentre", "View Center"),
    ],
    demo: { fov: 130 },
    glsl: `
vec4 effect(vec2 uv) {
  vec2 c = toUv(viewCentre);
  vec2 d = (uv - c) * vec2(ratio, 1.0);
  // The field of view spans this far from the middle (the frame's half width, height or diagonal).
  float span = orientation == 0 ? 0.5 * ratio : orientation == 1 ? 0.5 : 0.5 * sqrt(ratio * ratio + 1.0);
  float h = radians(clamp(fov, 0.0, 179.0)) * 0.5;
  if (h < 1e-3) return getColor(uv);
  float rho = length(d) / span;
  // The picture as a flat (rectilinear) lens of that field of view, seen as an equidistant fisheye, or the reverse.
  // Both keep the reference edge in place; s is the source's distance over the pixel's.
  float s;
  if (reverse > 0.5) s = rho < 1e-5 ? tan(h) / h : atan(rho * tan(h)) / (h * rho);
  else s = rho < 1e-5 ? h / tan(h) : tan(min(rho * h, 1.56)) / (tan(h) * rho);
  return getColor(c + d * s / vec2(ratio, 1.0));
}`,
  }),
  videoEffect({
    type: "turbulent-displace",
    label: "Turbulent Displace",
    tags: ["distort"],
    params: [
      choice("displacement", "Displacement", [
        ["turbulent", "Turbulent"],
        ["bulge", "Bulge"],
        ["twist", "Twist"],
        ["horizontal", "Horizontal"],
        ["vertical", "Vertical"],
      ]),
      // How far the picture moves, as a fraction of the height.
      percent("amount", "Amount", 0.05, { max: 0.5, decimals: 1 }),
      // The size of the turbulence's swirls, as a fraction of the height.
      percent("size", "Size", 0.3, { min: 0.01, max: 2 }),
      { kind: "number", key: "complexity", label: "Complexity", default: 2, min: 1, max: 6, step: 0.1, decimals: 1, slider: true },
      // A full turn is one step through the turbulence, which morphs rather than slides.
      turns("evolution", "Evolution"),
      { kind: "number", key: "evolveSpeed", label: "Evolve Over Time", default: 0, min: -3600, max: 3600, unit: "°/s", step: 1, decimals: 0 },
    ],
    demo: { amount: 0.08, evolveSpeed: 120 },
    animated: true,
    glsl: `
float hash3(vec3 p) { return hash(p.xy + p.z * vec2(37.17, 59.31)); }
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  vec2 e = vec2(1.0, 0.0);
  float a = mix(mix(hash3(i), hash3(i + e.xyy), u.x), mix(hash3(i + e.yxy), hash3(i + e.xxy), u.x), u.y);
  float b = mix(mix(hash3(i + e.yyx), hash3(i + e.xyx), u.x), mix(hash3(i + e.yxx), hash3(i + e.xxx), u.x), u.y);
  return mix(a, b, u.z);
}
// Layered noise, -1..1-ish: complexity is the number of octaves (the last one fading in), each turned so the
// grid never lines up, and evolving faster than the one before.
float turbulence(vec3 p) {
  float v = 0.0;
  float a = 1.0;
  float total = 0.0;
  for (int i = 0; i < 6; i++) {
    float w = clamp(complexity - float(i), 0.0, 1.0);
    if (w <= 0.0) break;
    v += a * w * (noise3(p) - 0.5);
    total += a * w;
    p = vec3(rot(0.7) * p.xy * 2.03 + 17.1, p.z * 1.6);
    a *= 0.5;
  }
  return v / max(total, 1e-3);
}
vec4 effect(vec2 uv) {
  vec3 p = vec3(aspect(uv) / max(size, 1e-3), (evolution + time * evolveSpeed) / 360.0);
  vec2 shift;
  if (displacement == 0) {
    shift = vec2(turbulence(p), turbulence(p + vec3(31.4, 47.2, 11.0))) * 3.0;
  } else if (displacement <= 2) {
    // Along the turbulence's slopes (swelling and shrinking), or across them (swirling round its hills).
    const float e = 0.03;
    float n = turbulence(p);
    vec2 slope = vec2(turbulence(p + vec3(e, 0.0, 0.0)) - n, turbulence(p + vec3(0.0, e, 0.0)) - n) / e;
    shift = (displacement == 1 ? -slope : vec2(-slope.y, slope.x)) * 0.6;
  } else {
    float n = turbulence(p) * 3.0;
    shift = displacement == 3 ? vec2(n, 0.0) : vec2(0.0, n);
  }
  return getColor(uv + shift * amount / vec2(ratio, 1.0));
}`,
  }),
  videoEffect({
    type: "polar-coordinates",
    label: "Polar Coordinates",
    tags: ["distort"],
    params: [
      percent("interpolation", "Interpolation", 1),
      choice("conversion", "Type of Conversion", [
        ["rect-to-polar", "Rect to Polar"],
        ["polar-to-rect", "Polar to Rect"],
      ]),
    ],
    glsl: `
vec4 effect(vec2 uv) {
  // Around the middle of the frame, the ellipse touching its edges being radius 1 (as After Effects does);
  // angles from the top, clockwise. The top of the picture is the middle of the circle.
  vec2 polar;
  if (conversion == 0) {
    vec2 d = (uv - 0.5) * 2.0;
    float r = length(d);
    float a = r > 1e-6 ? atan(d.x, d.y) : 0.0;
    polar = vec2(fract(a / (2.0 * PI)), 1.0 - r);
  } else {
    float a = uv.x * 2.0 * PI;
    polar = 0.5 + 0.5 * (1.0 - uv.y) * vec2(sin(a), cos(a));
  }
  return getColor(mix(uv, polar, interpolation));
}`,
  }),
  videoEffect({
    type: "ripple",
    label: "Ripple",
    tags: ["distort"],
    params: [
      point("centre", "Center"),
      // How far the waves reach before dying out, as a fraction of the height.
      percent("radius", "Radius", 0.6, { min: 0.01, max: 3 }),
      percent("waveHeight", "Wave Height", 0.012, { max: 0.2, decimals: 1 }),
      percent("waveWidth", "Wave Width", 0.08, { min: 0.005, max: 1, decimals: 1 }),
      // Waves per second going out (negative: coming in).
      { kind: "number", key: "speed", label: "Wave Speed", default: 1, min: -10, max: 10, unit: " /s", step: 0.1, decimals: 1 },
      turns("phase", "Ripple Phase"),
    ],
    demo: { centre: [0.3, 0.34], radius: 1, waveHeight: 0.02 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  vec2 c = toUv(centre);
  vec2 d = (uv - c) * vec2(ratio, 1.0);
  float dist = length(d);
  float width = max(waveWidth, 1e-3);
  // Dying out towards the radius, and calm in the very middle, where a ring has no direction.
  float falloff = (1.0 - smoothstep(0.0, max(radius, 1e-4), dist)) * smoothstep(0.0, 0.5 * width, dist);
  float wave = sin(2.0 * PI * (dist / width - time * speed) + radians(phase));
  vec2 dir = dist > 1e-6 ? d / dist : vec2(0.0);
  return getColor(uv + dir * waveHeight * wave * falloff / vec2(ratio, 1.0));
}`,
  }),
  videoEffect({
    type: "kaleida",
    label: "Kaleida",
    tags: ["distort"],
    params: [
      point("centre", "Center"),
      // How big the reflected picture is: over 100% zooms into it.
      percent("size", "Size", 1, { min: 0.05, max: 5 }),
      {
        ...choice("mirroring", "Mirroring", [
          ["3", "3-Way"],
          ["4", "4-Way"],
          ["6", "6-Way"],
          ["8", "8-Way"],
          ["12", "12-Way"],
        ]),
        default: "6",
      },
      // Turns the picture under the mirrors, which is what makes the pattern bloom when keyframed.
      turns("rotation", "Rotation"),
    ],
    // Turned towards the sample picture's sun.
    demo: { size: 0.6, rotation: 130 },
    glsl: `
vec4 effect(vec2 uv) {
  vec2 c = toUv(centre);
  vec2 d = (uv - c) * vec2(ratio, 1.0);
  float n = mirroring == 0 ? 3.0 : mirroring == 1 ? 4.0 : mirroring == 2 ? 6.0 : mirroring == 3 ? 8.0 : 12.0;
  float r = length(d);
  // Folded into one wedge, each reflected into its neighbours, so the mirrors meet without a seam.
  float wedge = 2.0 * PI / n;
  float a = mod(r > 1e-6 ? atan(d.y, d.x) : 0.0, wedge);
  a = min(a, wedge - a) + radians(rotation);
  vec2 p = r * vec2(cos(a), sin(a)) / max(size, 1e-3);
  return getColor(c + p / vec2(ratio, 1.0));
}`,
  }),
  videoEffect({
    type: "bend",
    label: "Bend",
    tags: ["distort"],
    params: [
      // At 100% the frame's longer half turns a quarter circle; negative bends the other way.
      percent("amount", "Amount", 0.4, { min: -1, max: 1 }),
      choice("direction", "Direction", [
        ["horizontal", "Horizontal"],
        ["vertical", "Vertical"],
      ]),
      // The point that stays put.
      point("centre", "Center"),
    ],
    demo: { amount: 0.7 },
    glsl: `
vec4 effect(vec2 uv) {
  vec2 c = toUv(centre);
  vec2 d = (uv - c) * vec2(ratio, 1.0);
  bool vertical = direction == 1;
  // Worked out as bending the picture's horizontal lines; a vertical bend swaps the axes around it.
  vec2 q = vertical ? d.yx : d;
  // Relative to the longer side, so the same amount bends as gently either way and in any shape of frame.
  float k = amount * PI / max(ratio, 1.0);
  if (abs(k) < 1e-4) return getColor(uv);
  // The picture laid around a circle (below it for a positive bend), keeping its lengths along the bend. The
  // circle's centre eases out to stay past the frame's edge on that side, where the picture would pinch to a point.
  float flip = k < 0.0 ? -1.0 : 1.0;
  float reach = vertical ? (flip > 0.0 ? c.x : 1.0 - c.x) * ratio : (flip > 0.0 ? c.y : 1.0 - c.y);
  float bendRadius = length(vec2(1.0 / abs(k), 1.1 * max(reach, 0.0)));
  vec2 v = vec2(q.x, q.y * flip + bendRadius);
  float rho = length(v);
  float theta = rho > 1e-6 ? atan(v.x, v.y) : 0.0;
  vec2 src = vec2(bendRadius * theta, (rho - bendRadius) * flip);
  src = vertical ? src.yx : src;
  return getColor(c + src / vec2(ratio, 1.0));
}`,
  }),
  videoEffect({
    type: "offset",
    label: "Offset",
    tags: ["distort"],
    params: [
      // Where the picture's middle moves to; it wraps around, so keyframing it across a cut is a whip pan.
      point("shiftCentre", "Shift Center To"),
      percent("blend", "Blend With Original", 0),
    ],
    demo: { shiftCentre: [0.85, 0.25] },
    glsl: `
vec4 effect(vec2 uv) {
  vec2 shifted = fract(uv - (toUv(shiftCentre) - 0.5));
  return mix(getColor(shifted), getColor(uv), blend);
}`,
  }),
  {
    ...videoEffect({
      type: "transform",
      label: "Transform",
      tags: ["distort", "camera"],
      params: [
        point("anchor", "Anchor Point"),
        point("position", "Position"),
        { kind: "boolean", key: "uniformScale", label: "Uniform Scale", default: true },
        {
          kind: "number",
          key: "scale",
          label: "Scale",
          labelFor: (v) => (v.uniformScale === false ? "Scale Height" : "Scale"),
          default: 1,
          min: 0,
          max: 10,
          ...PERCENT,
        },
        {
          kind: "number",
          key: "scaleWidth",
          label: "Scale Width",
          disabledFor: (v) => v.uniformScale !== false,
          default: 1,
          min: 0,
          max: 10,
          ...PERCENT,
        },
        degrees("skew", "Skew", 0, -70, 70),
        degrees("skewAxis", "Skew Axis", 0),
        turns("rotation", "Rotation"),
        percent("opacity", "Opacity", 1),
        // Sampled here rather than by the clip's Motion Edges, so a Transform zooming out can tile on its own.
        choice("edges", "Edges", [
          ["none", "Transparent"],
          ["extend", "Repeat Edge"],
          ["mirror", "Mirror"],
          ["tile", "Tile"],
        ]),
      ],
      demo: { scale: 0.6, rotation: 15, skew: 12, edges: "mirror" },
      glsl: `
vec4 effect(vec2 uv) {
  vec2 sq = vec2(ratio, 1.0);
  // Back from the output to the picture: position, rotation (clockwise), skew along its axis, then scale.
  vec2 p = (uv - toUv(position)) * sq;
  p = rot(radians(rotation)) * p;
  float axis = radians(skewAxis);
  p = rot(axis) * p;
  p.x -= tan(radians(clamp(skew, -70.0, 70.0))) * p.y;
  p = rot(-axis) * p;
  float sy = scale;
  float sx = uniformScale > 0.5 ? scale : scaleWidth;
  p /= vec2(max(sx, 1e-4), max(sy, 1e-4));
  vec2 q = p / sq + toUv(anchor);
  // Pixels of output per unit of picture, for a smooth edge whatever the scale or angle.
  vec2 fw = max(fwidth(q), vec2(1e-6));
  vec2 texel = 0.5 / resolution;
  vec4 c;
  if (edges == 0) {
    vec2 inner = min(q, 1.0 - q) / fw;
    c = getColor(clamp(q, texel, 1.0 - texel)) * clamp(0.5 + min(inner.x, inner.y), 0.0, 1.0);
  } else if (edges == 1) c = getColor(clamp(q, texel, 1.0 - texel));
  else if (edges == 2) c = getColor(clamp(mirrored(q), texel, 1.0 - texel));
  else c = getColor(clamp(fract(q), texel, 1.0 - texel));
  if (sx <= 0.0 || sy <= 0.0) c = vec4(0.0);
  return c * opacity;
}`,
    }),
    // While scale is uniform the width follows it, so turning uniform scale off starts from the same size.
    adjust: (current, patch) => {
      if (patch.uniformScale === false && current.uniformScale !== false) return { ...patch, scaleWidth: current.scale };
      const uniform = (patch.uniformScale ?? current.uniformScale) !== false;
      if (!uniform || (patch.scale === undefined && patch.uniformScale === undefined)) return patch;
      return { ...patch, scaleWidth: patch.scale ?? current.scale };
    },
  },
  videoEffect({
    type: "wiggle",
    label: "Wiggle",
    tags: ["camera", "distort"],
    params: [
      // Wiggles per second.
      { kind: "number", key: "frequency", label: "Frequency", default: 3, min: 0, max: 30, unit: " /s", step: 0.1, decimals: 1, slider: true },
      // How far it drifts, as a fraction of the height.
      percent("positionAmount", "Position", 0.02, { max: 0.5, decimals: 1 }),
      degrees("rotationAmount", "Rotation", 1.5, 0, 45),
      percent("zoomAmount", "Zoom", 0.02, { max: 0.5, decimals: 1 }),
      { kind: "number", key: "seed", label: "Random Seed", default: 0, min: 0, max: 1000, step: 1, decimals: 0 },
      // Zooms in just enough that the furthest wiggle never shows past the frame (off: the clip's Edges show).
      { kind: "boolean", key: "hideEdges", label: "Hide Edges", default: true },
    ],
    demo: { frequency: 2, positionAmount: 0.06, rotationAmount: 5, zoomAmount: 0.06 },
    animated: true,
    glsl: `
// One octave of gradient noise, like After Effects' wiggle(): smooth, never pausing on the beat, about -1..1.
float wiggleAt(float t, float channel) {
  float i = floor(t);
  float f = fract(t);
  float g0 = hash(vec2(i, channel)) * 2.0 - 1.0;
  float g1 = hash(vec2(i + 1.0, channel)) * 2.0 - 1.0;
  float u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return 2.0 * mix(g0 * f, g1 * (f - 1.0), u);
}
vec4 effect(vec2 uv) {
  float t = time * frequency;
  float ch = seed * 7.31;
  vec2 shift = vec2(wiggleAt(t, ch + 1.0), wiggleAt(t, ch + 2.0)) * positionAmount;
  float turn = radians(rotationAmount) * wiggleAt(t, ch + 3.0);
  float zoom = 1.0 + zoomAmount * wiggleAt(t, ch + 4.0);
  float cover = 1.0;
  if (hideEdges > 0.5) {
    // The zoom that covers the frame at the furthest turn, drift and zoom out, held steady (never pumping).
    float a = min(radians(rotationAmount), 0.5 * PI);
    cover = (cos(a) + max(ratio, 1.0 / ratio) * sin(a)) * (1.0 + 2.0 * positionAmount / min(ratio, 1.0));
    cover /= max(1.0 - zoomAmount, 0.05);
  }
  vec2 p = rot(turn) * (aspect(uv) - shift) / max(zoom * cover, 1e-3);
  return getColor(p / vec2(ratio, 1.0) + 0.5);
}`,
  }),
  videoEffect({
    type: "spherize",
    label: "Spherize",
    tags: ["distort"],
    params: [
      // The sphere's radius, as a fraction of the height.
      percent("radius", "Radius", 0.4, { min: 0, max: 3 }),
      point("centre", "Center of Sphere"),
      // 100% wraps the picture onto the front of a sphere; negative into a bowl.
      percent("amount", "Amount", 1, { min: -1, max: 1 }),
    ],
    demo: { centre: [0.3, 0.34], radius: 0.25 },
    glsl: `
vec4 effect(vec2 uv) {
  vec2 c = toUv(centre);
  vec2 d = (uv - c) * vec2(ratio, 1.0);
  float r = length(d) / max(radius, 1e-4);
  if (r >= 1.0 || r < 1e-6) return getColor(uv);
  // Seen straight on, a point r out on a sphere is asin(r) round it: that arc is how far the picture is read from
  // (magnified 1.57x in the middle, crowded at the rim). A bowl is the inverse.
  float wrapped = amount >= 0.0 ? asin(r) / (0.5 * PI) : sin(r * 0.5 * PI);
  float s = mix(r, wrapped, abs(amount)) / r;
  return getColor(c + d * s / vec2(ratio, 1.0));
}`,
  }),
  videoEffect({
    type: "tile",
    label: "Motion Tile",
    tags: ["distort"],
    params: [
      point("tileCentre", "Tile Center"),
      percent("tileWidth", "Tile Width", 0.5, { min: 0.01, max: 1 }),
      percent("tileHeight", "Tile Height", 0.5, { min: 0.01, max: 1 }),
      // Flips every other tile so they meet without a seam.
      { kind: "boolean", key: "mirrorEdges", label: "Mirror Edges", default: false },
      // Slides every other column (or row) along by this part of a tile.
      turns("phase", "Phase"),
      { kind: "boolean", key: "horizontalPhaseShift", label: "Horizontal Phase Shift", default: false },
    ],
    demo: { tileWidth: 0.34, tileHeight: 0.34, phase: 90 },
    glsl: `
vec2 tileUv(vec2 uv) {
  vec2 q = (uv - toUv(tileCentre)) / max(vec2(tileWidth, tileHeight), vec2(1e-3)) + 0.5;
  float shift = phase / 360.0;
  if (horizontalPhaseShift > 0.5) q.x += mod(floor(q.y), 2.0) * shift;
  else q.y += mod(floor(q.x), 2.0) * shift;
  return mirrorEdges > 0.5 ? mirrored(q) : fract(q);
}
vec4 effect(vec2 uv) {
  // Four samples a pixel (a rotated grid) smooth the seams between tiles and small tiles' detail.
  vec2 px = 1.0 / resolution;
  return 0.25 * (
    getColor(tileUv(uv + px * vec2(-0.375, -0.125))) + getColor(tileUv(uv + px * vec2(0.125, -0.375))) +
    getColor(tileUv(uv + px * vec2(0.375, 0.125))) + getColor(tileUv(uv + px * vec2(-0.125, 0.375))));
}`,
  }),
];
