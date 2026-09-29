/** Distortions: ripples, swirls and warps. */
import type { TransitionDefinition } from "../transitions.ts";

/** Mirrored repeat: coordinates pushed past an edge show the picture's reflection instead of a gap. */
const MIRRORED = `vec2 mirrored(vec2 p) { return 1.0 - abs(1.0 - mod(p, 2.0)); }`;

export const DISTORTIONS: TransitionDefinition[] = [
  {
    type: "ripple",
    label: "Ripple",
    tags: ["distort"],
    duration: 1,
    params: [
      { kind: "number", key: "amplitude", label: "Amplitude", default: 1, min: 0, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
      { kind: "number", key: "waves", label: "Waves", default: 1, min: 0.3, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    ],
    glsl: `
// Rings spread out from the centre like a drop in water; B shows through behind the wave front.
vec4 transition(vec2 uv) {
  vec2 q = aspect(uv);
  float r = length(q);
  float rn = r / length(vec2(ratio, 1.0) * 0.5);  // 0 centre, 1 corners
  float front = progress * 1.6;
  float env = sin(PI * progress);
  env *= env;
  // Waves live behind the front, trailing off towards the centre as they spend themselves.
  float mask = smoothstep(front, front - 0.25, rn) * (0.35 + 0.65 * smoothstep(front - 1.2, front - 0.2, rn));
  float phase = r * 40.0 * waves - progress * 30.0;
  float strength = amplitude * env * mask;
  vec2 dir = r > 0.0 ? q / r : vec2(0.0);
  vec2 p = clamp(uv + dir * sin(phase) * 0.026 * strength / vec2(ratio, 1.0), 0.0, 1.0);
  float t = smoothstep(0.0, 1.0, clamp(progress * 2.2 - rn * 0.9 - 0.15, 0.0, 1.0));
  vec4 c = mix(getFromColor(p), getToColor(p), t);
  // A glint on the wave slopes.
  c.rgb *= 1.0 + 0.12 * cos(phase) * strength;
  return c;
}`,
  },
  {
    type: "swirl",
    label: "Swirl",
    tags: ["distort"],
    duration: 1,
    params: [
      { kind: "number", key: "strength", label: "Strength", default: 1, min: 0.2, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
      { kind: "boolean", key: "clockwise", label: "Clockwise", default: true },
    ],
    glsl: `
${MIRRORED}
// Twisted by "twist" radians at the centre (none at the edge) and drawn in towards it, blurred along the turn.
vec4 twirled(vec2 uv, float twist, float spread, float pull, bool incoming) {
  vec2 q = aspect(uv);
  float rn = length(q) / length(vec2(ratio, 1.0) * 0.5);
  float fall = 1.0 - smoothstep(0.0, 1.1, rn);
  fall *= fall;
  q *= 1.0 + pull * fall;
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 12; i++) {
    float f = (float(i) + 0.5) / 12.0 - 0.5;
    vec2 p = mirrored((rot((twist + spread * f) * fall) * q) / vec2(ratio, 1.0) + 0.5);
    sum += incoming ? getToColor(p) : getFromColor(p);
  }
  return sum / 12.0;
}
vec4 transition(vec2 uv) {
  float turn = (clockwise > 0.5 ? 1.0 : -1.0) * strength * 1.5 * PI;
  float e = ease(progress);
  // A winds up to the cut, B unwinds from it, turning the same way throughout.
  float speed = progress < 0.5 ? 12.0 * progress * progress : 12.0 * (1.0 - progress) * (1.0 - progress);
  float spread = turn * speed * 0.08;
  float pull = 0.5 * sin(PI * progress);
  float w = smoothstep(0.3, 0.7, progress);
  vec4 from = vec4(0.0);
  vec4 to = vec4(0.0);
  if (w < 1.0) from = twirled(uv, 2.0 * turn * e, spread, pull, false);
  if (w > 0.0) to = twirled(uv, 2.0 * turn * (e - 1.0), spread, pull, true);
  return mix(from, to, w);
}`,
  },
  {
    type: "warp",
    label: "Warp",
    tags: ["distort", "slide"],
    duration: 0.6,
    params: [
      {
        kind: "choice",
        key: "direction",
        label: "Direction",
        default: "left",
        options: [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
          { value: "up", label: "Up" },
          { value: "down", label: "Down" },
        ],
      },
    ],
    glsl: `
// A and B sit end to end on a strip that shoots across in "direction", stretched
// out along it mid-way: A smears off, B snaps in out of the smear, with motion blur.
vec4 onStrip(float s, float y, vec2 d, vec2 n) {
  // s: position along the strip (A is 0..1, B is -1..0), y: across it (0..1).
  vec2 p = 0.5 + n * (y - 0.5);
  if (s >= 0.0) return getFromColor(clamp(p + d * (s - 0.5), 0.0, 1.0));
  return getToColor(clamp(p + d * (s + 0.5), 0.0, 1.0));
}
vec4 transition(vec2 uv) {
  vec2 d = dirVec(direction);
  vec2 n = vec2(-d.y, d.x);
  float x = dot(uv - 0.5, d) + 0.5;  // 0 trailing edge .. 1 leading edge
  float y = dot(uv - 0.5, n) + 0.5;
  float e = ease(progress);
  float speed = progress < 0.5 ? 12.0 * progress * progress : 12.0 * (1.0 - progress) * (1.0 - progress);
  float env = sin(PI * progress);
  float stretch = 1.0 + 3.0 * env * env;  // along the strip, anchored on the seam
  float blur = speed * 0.09;
  float j = hash(uv * resolution);
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 24; i++) {
    float s = (x - e + blur * ((float(i) + j) / 24.0 - 0.5)) / stretch;
    sum += onStrip(s, y, d, n);
  }
  return sum / 24.0;
}`,
  },
  {
    type: "liquid",
    label: "Liquid",
    tags: ["distort"],
    duration: 1,
    params: [
      { kind: "number", key: "amount", label: "Amount", default: 1, min: 0, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
      { kind: "number", key: "grain", label: "Scale", default: 3, min: 0.5, max: 12, step: 0.1, decimals: 1 },
    ],
    glsl: `
// Both pictures flow in a drifting noise field while B floods in through its pools.
vec4 transition(vec2 uv) {
  vec2 q = aspect(uv) * grain;
  float env = sin(PI * progress);
  vec2 flow = vec2(fbm(q + vec2(0.0, progress * 1.5)), fbm(q + vec2(5.2, 1.3) - progress * 1.5)) - 0.5;
  vec2 disp = flow * amount * 0.22 * env / vec2(ratio, 1.0);
  float n = clamp((fbm(q * 0.6 + flow * 1.5 + 9.1) - 0.2) / 0.6, 0.0, 1.0);
  float edge = progress * 1.4 - 0.2;
  float t = smoothstep(n - 0.2, n + 0.2, edge);
  vec4 a = getFromColor(clamp(uv + disp * (0.5 + t), 0.0, 1.0));
  vec4 b = getToColor(clamp(uv - disp * (1.5 - t), 0.0, 1.0));
  vec4 c = mix(a, b, t);
  // A soft sheen where the two meet.
  c.rgb += 0.25 * t * (1.0 - t) * env * c.a;
  return c;
}`,
  },
  {
    type: "kaleidoscope",
    label: "Kaleidoscope",
    tags: ["distort", "stylize"],
    duration: 1.2,
    params: [
      { kind: "number", key: "segments", label: "Segments", default: 6, min: 2, max: 16, step: 1, decimals: 0 },
    ],
    glsl: `
${MIRRORED}
// The picture folded into mirrored wedges around the centre, turned by "angle".
vec4 folded(vec2 uv, float angle, float z, bool incoming) {
  vec2 q = aspect(uv) / z;
  float wedge = PI / max(floor(segments), 1.0);
  float a = atan(q.y, q.x) + angle;
  a = abs(mod(a, 2.0 * wedge) - wedge);
  vec2 p = mirrored(vec2(cos(a), sin(a)) * length(q) / vec2(ratio, 1.0) + 0.5);
  return incoming ? getToColor(p) : getFromColor(p);
}
vec4 transition(vec2 uv) {
  float rn = length(aspect(uv)) / length(vec2(ratio, 1.0) * 0.5);
  // The pattern opens from the centre, holds through the middle, and closes back.
  float grow = clamp(smoothstep(0.0, 0.4, progress) * 1.6 - rn * 0.6, 0.0, 1.0);
  float fade = clamp(smoothstep(1.0, 0.6, progress) * 1.6 - rn * 0.6, 0.0, 1.0);
  float k = smoothstep(0.0, 1.0, min(grow, fade));
  float angle = PI * ease(progress);
  float z = 1.0 + 0.4 * sin(PI * progress);
  float w = smoothstep(0.35, 0.65, progress);
  vec4 plain = mix(getFromColor(uv), getToColor(uv), w);
  if (k <= 0.0) return plain;
  vec4 kal = mix(folded(uv, angle, z, false), folded(uv, angle, z, true), w);
  return mix(plain, kal, k);
}`,
  },
  {
    type: "morph",
    label: "Morph",
    tags: ["distort"],
    duration: 1,
    params: [
      { kind: "number", key: "strength", label: "Strength", default: 1, min: 0, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    ],
    glsl: `
// Each picture melts along the other's light and dark shapes as they cross: pixels are
// pushed along the slope of the brightness, measured over a wide disc so the flow is smooth.
vec2 slope(vec2 uv) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < 16; i++) {
    float f = float(i);
    vec2 o = vec2(cos(f * 2.39996), sin(f * 2.39996)) * 0.08 * sqrt((f + 0.5) / 16.0);
    vec2 p = uv + o / vec2(ratio, 1.0);
    g += (luma(getFromColor(p)) + luma(getToColor(p))) * normalize(o);
  }
  return g / 16.0;
}
vec4 transition(vec2 uv) {
  float t = ease(progress);
  vec2 off = slope(uv) * strength * 0.5 / vec2(ratio, 1.0);
  vec4 a = getFromColor(clamp(uv + off * t, 0.0, 1.0));
  vec4 b = getToColor(clamp(uv - off * (1.0 - t), 0.0, 1.0));
  return mix(a, b, t);
}`,
  },
];
