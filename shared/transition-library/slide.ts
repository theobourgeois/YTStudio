/** Pushes and slides: the picture moves. */
import type { TransitionDefinition } from "../transitions.ts";
import { directionParam } from "./common.ts";

/*
 * Motion blur is done by rendering the move at several instants around
 * `progress` (a shutter) and averaging them. The shutter closes at both ends,
 * so the first and last frames are exact.
 */

export const SLIDES: TransitionDefinition[] = [
  {
    type: "push",
    label: "Push",
    tags: ["slide"],
    duration: 0.5,
    params: [directionParam()],
    glsl: `
// The incoming clip pushes the outgoing one off the canvas.
vec4 frame(vec2 uv, float t) {
  vec2 d = dirVec(direction);
  vec2 p = uv - d * t;
  return inside(p) ? getFromColor(p) : getToColor(p + d);
}
vec4 transition(vec2 uv) {
  float shutter = min(0.05, 2.0 * min(progress, 1.0 - progress));
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    float s = progress + shutter * ((float(i) + 0.5) / 16.0 - 0.5);
    sum += frame(uv, ease(s));
  }
  return sum / 16.0;
}`,
  },
  {
    type: "slide",
    label: "Slide",
    tags: ["slide"],
    duration: 0.5,
    params: [directionParam()],
    glsl: `
// The incoming clip slides in over the outgoing one, which stays put.
vec4 transition(vec2 uv) {
  vec2 d = dirVec(direction);
  float shutter = min(0.05, 2.0 * min(progress, 1.0 - progress));
  vec4 b = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    float s = progress + shutter * ((float(i) + 0.5) / 16.0 - 0.5);
    b += getToColor(uv + d * (1.0 - ease(s)));
  }
  b /= 16.0;
  // A soft shadow the moving picture casts on the one underneath.
  vec2 edge = uv + d * (1.0 - ease(progress));
  float gap = max(max(-edge.x, edge.x - 1.0), max(-edge.y, edge.y - 1.0));
  float shade = 0.45 * exp(-max(gap, 0.0) * 30.0) * sin(PI * progress);
  vec4 a = getFromColor(uv);
  a.rgb *= 1.0 - shade * step(0.0, gap);
  return b + a * (1.0 - b.a);
}`,
  },
  {
    type: "uncover",
    label: "Uncover",
    tags: ["slide"],
    duration: 0.5,
    params: [directionParam()],
    glsl: `
// The outgoing clip slides away and uncovers the incoming one underneath.
vec4 transition(vec2 uv) {
  vec2 d = dirVec(direction);
  float shutter = min(0.05, 2.0 * min(progress, 1.0 - progress));
  vec4 a = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    float s = progress + shutter * ((float(i) + 0.5) / 16.0 - 0.5);
    a += getFromColor(uv - d * ease(s));
  }
  a /= 16.0;
  vec2 edge = uv - d * ease(progress);
  float gap = max(max(-edge.x, edge.x - 1.0), max(-edge.y, edge.y - 1.0));
  float shade = 0.45 * exp(-max(gap, 0.0) * 30.0) * sin(PI * progress);
  vec4 b = getToColor(uv);
  b.rgb *= 1.0 - shade * step(0.0, gap);
  return a + b * (1.0 - a.a);
}`,
  },
  {
    type: "whip",
    label: "Whip",
    tags: ["slide", "blur"],
    duration: 0.4,
    params: [directionParam()],
    glsl: `
// A whip pan: a push that slowly starts, flies through the middle with a
// heavy directional smear, and settles. The shutter samples are jittered per
// pixel so the long blur reads as a streak rather than stacked copies.
float whipEase(float t) {
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? 0.5 * pow(2.0 * t, 4.0) : 1.0 - 0.5 * pow(2.0 - 2.0 * t, 4.0);
}
vec4 frame(vec2 uv, float t) {
  vec2 d = dirVec(direction);
  vec2 p = uv - d * t;
  return inside(p) ? getFromColor(p) : getToColor(p + d);
}
vec4 transition(vec2 uv) {
  float shutter = min(0.2, 2.0 * min(progress, 1.0 - progress));
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 32; i++) {
    float s = progress + shutter * ((float(i) + jitter) / 32.0 - 0.5);
    sum += frame(uv, whipEase(s));
  }
  return sum / 32.0;
}`,
  },
  {
    type: "split",
    label: "Split",
    tags: ["slide"],
    duration: 0.6,
    params: [
      {
        kind: "choice",
        key: "orientation",
        label: "Orientation",
        default: "vertical",
        options: [
          { value: "vertical", label: "Vertical" },
          { value: "horizontal", label: "Horizontal" },
        ],
      },
    ],
    glsl: `
// The outgoing clip splits down the middle and the halves slide apart.
vec4 halves(vec2 uv, float k) {
  // x runs across the split; the halves are x < 0.5 and x >= 0.5.
  vec2 axis = orientation == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  float x = dot(uv, axis);
  if (x + k < 0.5) return getFromColor(uv + axis * k);
  if (x - k >= 0.5) return getFromColor(uv - axis * k);
  return vec4(0.0);
}
vec4 transition(vec2 uv) {
  float shutter = min(0.05, 2.0 * min(progress, 1.0 - progress));
  vec4 a = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    float s = progress + shutter * ((float(i) + 0.5) / 16.0 - 0.5);
    a += halves(uv, 0.5 * ease(s));
  }
  a /= 16.0;
  // The halves cast a soft shadow into the gap.
  float k = 0.5 * ease(progress);
  float x = orientation == 0 ? uv.x : uv.y;
  float gap = min(abs(x - (0.5 - k)), abs(x - (0.5 + k)));
  vec4 b = getToColor(uv);
  b.rgb *= 1.0 - 0.45 * exp(-gap * 30.0) * (1.0 - ease(progress));
  return a + b * (1.0 - a.a);
}`,
  },
  {
    type: "band-slide",
    label: "Band Slide",
    tags: ["slide"],
    duration: 0.8,
    params: [
      { kind: "number", key: "bands", label: "Bands", default: 6, min: 2, max: 24, step: 1, decimals: 0 },
      {
        kind: "choice",
        key: "orientation",
        label: "Direction",
        default: "horizontal",
        options: [
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
        ],
      },
    ],
    glsl: `
// Bands of the incoming clip slide in, alternately from each side, one after
// another (top to bottom, or left to right).
vec4 transition(vec2 uv) {
  float n = max(1.0, floor(bands + 0.5));
  bool across = orientation == 0;
  float x = across ? 1.0 - uv.y : uv.x;
  float i = min(floor(x * n), n - 1.0);
  float side = mod(i, 2.0) < 0.5 ? 1.0 : -1.0;
  vec2 axis = across ? vec2(side, 0.0) : vec2(0.0, -side);
  float start = 0.4 * i / max(n - 1.0, 1.0);
  float shutter = min(0.05, 2.0 * min(progress, 1.0 - progress));
  vec4 b = vec4(0.0);
  for (int k = 0; k < 16; k++) {
    float s = progress + shutter * ((float(k) + 0.5) / 16.0 - 0.5);
    float t = ease((s - start) / 0.6);
    b += getToColor(uv + axis * (1.0 - t));
  }
  b /= 16.0;
  return b + getFromColor(uv) * (1.0 - b.a);
}`,
  },
];
