/** Light: flashes, burns and leaks. */
import type { TransitionDefinition } from "../transitions.ts";

export const LIGHTS: TransitionDefinition[] = [
  {
    type: "flash",
    label: "Flash",
    tags: ["light"],
    duration: 0.4,
    params: [],
    glsl: `
// A camera flash on the cut: the picture overexposes and blooms, punches in a
// touch, cuts to B under pure white, and B comes down out of it (a fast rise
// and a slower fall).
vec4 bloomed(vec2 uv, float radius, bool incoming) {
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 24; i++) {
    float f = float(i);
    float r = sqrt((f + 0.5) / 24.0) * radius;
    vec2 o = vec2(cos(f * 2.39996), sin(f * 2.39996)) * r * vec2(1.0 / ratio, 1.0);
    vec4 c = incoming ? getToColor(uv + o) : getFromColor(uv + o);
    // Bright pass: only the highlights glow.
    sum += c * smoothstep(0.35, 0.9, c.a > 0.0 ? luma(c) / c.a : 0.0);
  }
  return sum / 24.0;
}
vec4 transition(vec2 uv) {
  bool incoming = progress >= 0.5;
  float k = incoming ? pow(2.0 - 2.0 * progress, 1.8) : pow(2.0 * progress, 3.5);
  vec2 q = 0.5 + (uv - 0.5) / (1.0 + 0.035 * k);
  vec4 c = incoming ? getToColor(q) : getFromColor(q);
  vec4 glow = bloomed(q, 0.09 * k, incoming);
  // Exposure plus a white lift, so colours wash out towards white instead of clipping saturated.
  vec3 rgb = c.rgb * (1.0 + 1.6 * k) + glow.rgb * 2.5 * k + 0.3 * k * c.a;
  vec4 lit = vec4(rgb, max(c.a, glow.a * k));
  return mix(lit, vec4(1.0), smoothstep(0.4, 1.0, k));
}`,
  },
  {
    type: "film-burn",
    label: "Film Burn",
    tags: ["light", "dissolve"],
    duration: 1.2,
    params: [
      { kind: "number", key: "intensity", label: "Intensity", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    ],
    glsl: `
// Film catching fire in the gate: an organic (domain-warped fbm) burn front
// spreads from one corner, white hot at its core through yellow and orange to
// deep red, overexposing the picture around it and revealing B behind it.
vec3 heatColor(float h) {
  vec3 c = mix(vec3(0.35, 0.02, 0.0), vec3(1.0, 0.3, 0.02), smoothstep(0.0, 0.35, h));
  c = mix(c, vec3(1.0, 0.72, 0.2), smoothstep(0.3, 0.65, h));
  return mix(c, vec3(1.0, 0.97, 0.88), smoothstep(0.65, 1.0, h));
}
vec4 transition(vec2 uv) {
  vec2 p = aspect(uv);
  float env = 4.0 * progress * (1.0 - progress);
  vec2 w = vec2(fbm(p * 1.6 + vec2(0.0, progress * 0.5)), fbm(p * 1.6 + vec2(5.2, 1.3) - progress * 0.4));
  float n = clamp((fbm(p * 2.4 + w * 1.6) - 0.2) / 0.6, 0.0, 1.0);
  float bias = 0.55 * uv.x + 0.45 * (1.0 - uv.y);
  float field = mix(n, bias, 0.5);
  float front = mix(-0.3, 1.3, progress);
  float d = front - field;

  float reveal = smoothstep(-0.02, 0.1, d);
  vec4 base = mix(getFromColor(uv), getToColor(uv), reveal);
  // Heat: a hot core on the front and a wide glow around it; a warm wash over the frame.
  float core = exp(-pow(d / 0.06, 2.0));
  float glow = exp(-pow(d / 0.3, 2.0));
  float k = min(1.0, env * 1.4) * intensity;
  float heat = clamp((core * 0.85 + glow * 0.45) * k, 0.0, 1.2);
  float wash = min(1.0, glow * 0.6 + env * 0.5) * k;
  // Grade the picture hot (orange, overexposed), then add the burn's own light.
  vec3 graded = base.rgb * mix(vec3(1.0), vec3(1.6, 0.85, 0.4), wash) + vec3(0.18, 0.05, 0.0) * wash * base.a;
  vec3 light = heatColor(min(heat, 1.0)) * heat * 1.2;
  vec3 rgb = graded + light - graded * min(light, vec3(1.0)) * 0.6;
  return vec4(rgb, max(base.a, min(1.0, heat)));
}`,
  },
  {
    type: "light-leak",
    label: "Light Leak",
    tags: ["light", "dissolve"],
    duration: 1.2,
    params: [
      { kind: "number", key: "intensity", label: "Intensity", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    ],
    glsl: `
// Soft warm leaks (amber, magenta, gold) drift across at different speeds and
// add light over a crossfade, like light hitting the film at the end of a roll.
// Blobs are sized in frame fractions, so they read as tall leaks in 9:16 and
// wide ones in 16:9.
vec3 leakBlob(vec2 uv, vec2 c, vec2 r, vec3 col) {
  vec2 v = (uv - c) / r;
  return col * exp(-dot(v, v));
}
vec4 transition(vec2 uv) {
  float env = pow(4.0 * progress * (1.0 - progress), 1.3) * intensity;
  float t = progress;
  float wob = fbm(vec2(uv.y * 2.5, t * 1.5)) - 0.5;
  vec2 q = uv + vec2(wob * 0.15, 0.0);
  vec3 L = vec3(0.0);
  L += leakBlob(q, vec2(mix(-0.5, 1.3, t), 0.75), vec2(0.45, 0.6), vec3(1.0, 0.42, 0.08));
  L += leakBlob(q, vec2(mix(-0.2, 1.1, t * 1.1), 0.2), vec2(0.35, 0.5), vec3(0.95, 0.18, 0.42));
  L += leakBlob(q, vec2(mix(-0.7, 1.6, t), 0.45), vec2(0.28, 0.9), vec3(1.0, 0.78, 0.3));
  L += leakBlob(q, vec2(mix(1.3, -0.3, t), 0.95), vec2(0.5, 0.3), vec3(0.9, 0.25, 0.1));
  // Organic texture and an overall warm lift.
  L *= 0.7 + 0.6 * fbm(aspect(uv) * 2.0 + vec2(t * 1.2, 0.0));
  L = L * 0.55 + vec3(0.16, 0.05, 0.015);
  L *= env;

  vec4 base = mix(getFromColor(uv), getToColor(uv), smoothstep(0.25, 0.75, progress));
  vec3 lum = base.rgb * (1.0 + 0.25 * env);
  vec3 rgb = lum + L - lum * min(L, vec3(1.0));
  // Where leaks overlap they burn towards white.
  rgb += vec3(max(0.0, max(L.r, max(L.g, L.b)) - 0.85)) * 0.35;
  return vec4(rgb, max(base.a, min(1.0, max(L.r, max(L.g, L.b)))));
}`,
  },
  {
    type: "light-sweep",
    label: "Light Sweep",
    tags: ["light", "wipe"],
    duration: 0.8,
    params: [
      { kind: "number", key: "angle", label: "Angle", default: 60, min: -180, max: 180, unit: "°", step: 1, decimals: 0 },
    ],
    glsl: `
// A bright glint band sweeps across at an angle: a thin hot core with a soft
// halo and faint streaks, B revealed behind it and briefly overexposed.
vec4 transition(vec2 uv) {
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 p = aspect(uv);
  float s = dot(p, dir);
  float along = dot(p, vec2(-dir.y, dir.x));
  float extent = 0.5 * (abs(dir.x) * ratio + abs(dir.y));
  float m = 0.32;
  float t = mix(progress, ease(progress), 0.3);
  float front = mix(-extent - m, extent + m, t);
  float d = s - front;

  float reveal = smoothstep(0.02, -0.02, d);
  vec4 base = mix(getFromColor(uv), getToColor(uv), reveal);
  float env = smoothstep(0.0, 0.12, progress) * smoothstep(1.0, 0.88, progress);
  float streaks = 0.75 + 0.5 * noise(vec2(along * 14.0, 3.0));
  float core = exp(-pow(d / 0.012, 2.0));
  float halo = exp(-pow(d / 0.1, 2.0)) * streaks;
  float trail = d < 0.0 ? exp(d / 0.25) : 0.0;
  float light = (core * 1.2 + halo * 0.55) * env;
  vec3 tint = vec3(1.0, 0.96, 0.88);
  vec3 rgb = base.rgb * (1.0 + 1.2 * halo * env + 0.35 * trail * env) + tint * light;
  return vec4(rgb, max(base.a, min(1.0, light)));
}`,
  },
];
