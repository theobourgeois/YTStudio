/**
 * Aurora (docs/visualizer/scenes.md): a frozen lake under a sky full of northern lights, mirrored in the ice;
 * mountains in silhouette, stars, the Milky Way. The curtains are marched through slabs of sky (each slab shows
 * a curtain as a thin glowing line; stacked, they're sheets with rays up them) and hear the sound themselves:
 * each part of a curtain is as bright as its band of the spectrum. Stepped: the curtains' clock (faster when
 * it's loud), a slow pan and drift across the ice, the hem's height on the bass, and a hit's surge.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraLooking, float, normalize, sceneDt, smoothTo, soundUniforms } from "./kit.ts";

interface AuroraState {
  time: number;
  /** The curtains' own clock. */
  flow: number;
  yaw: number;
  vYaw: number;
  x: number;
  z: number;
  /** The hem's lift, and a hit's surge (falling) and where along the curtains it travels. */
  lift: number;
  surge: number;
  wave: number;
}

export const AURORA: SceneSpec<AuroraState> = {
  type: "aurora",
  label: "Aurora",
  params: [
    {
      kind: "choice",
      key: "colors",
      label: "Colors",
      default: "classic",
      options: [
        { value: "classic", label: "Classic" },
        { value: "violet", label: "Violet" },
        { value: "fire", label: "Fire" },
      ],
    },
    { kind: "number", key: "height", label: "Curtain Height", default: 1, min: 0.4, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "stars", label: "Stars", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  audio: () => ({ rows: 1, span: 0, fall: 0.18, window: 0 }),
  glsl: /* glsl */ `
uniform float auFlow;
uniform float auLift;
uniform float auSurge;
uniform float auWave;

// The curtains, low (hem) to high: three palettes.
vec3 curtainColor(float h) {
  if (colors == 1) return mix(vec3(0.35, 0.2, 1.0), vec3(1.0, 0.2, 0.75), smoothstep(0.1, 0.8, h));
  if (colors == 2) return mix(vec3(1.0, 0.55, 0.1), vec3(0.9, 0.05, 0.15), smoothstep(0.1, 0.7, h));
  return mix(mix(vec3(0.1, 1.0, 0.45), vec3(0.15, 0.85, 0.7), smoothstep(0.0, 0.3, h)), vec3(0.75, 0.15, 0.6), smoothstep(0.35, 0.9, h));
}
// Where curtain i runs: a wavy line across the sky, at depth z0 ahead.
float curtainZ(float x, float i) {
  float z0 = 2.4 + i * 2.3;
  // Big slow swirls, folds, and a ripple running along it.
  float swirl = 1.8 * sin(x * 0.19 + auFlow * 0.11 + i * 2.1) + 0.9 * sin(x * 0.47 - auFlow * 0.17 + i);
  float fold = 1.1 * (vnoise3(vec3(x * 0.42, auFlow * 0.07, i * 3.7)) - 0.5) + 0.35 * sin(x * 1.7 + auFlow * 0.9 + i * 4.0);
  return z0 + swirl + fold;
}
vec3 aurora(vec3 ro, vec3 rd, int layers) {
  if (rd.y <= 0.0) return vec3(0.0);
  vec3 sum = vec3(0.0);
  float hem = 0.55 - 0.2 * auLift;
  float top = hem + 3.4 * height;
  // A jitter per pixel, so the slabs don't show as bands.
  float jitter = hash12(gl_FragCoord.xy);
  for (int k = 0; k < 64; k++) {
    if (k >= layers) break;
    float f = (float(k) + jitter) / float(layers);
    float alt = mix(hem, top, f);
    float t = (alt - ro.y) / rd.y;
    if (t > 60.0) break;
    vec3 p = ro + rd * t;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float cz = curtainZ(p.x, fi);
      float d = abs(p.z - cz);
      float sheet = exp(-d * 11.0) + 0.2 * exp(-d * 2.5);
      if (sheet < 0.01) continue;
      // Seen edge-on (where it folds), a curtain's light adds up along the view: bright fold lines.
      float slope = (curtainZ(p.x + 0.05, fi) - cz) / 0.05;
      vec2 nrm = normalize(vec2(-slope, 1.0));
      float edgeOn = 1.0 / (abs(dot(normalize(rd.xz), nrm)) + 0.22);
      // Rays up the curtain, and the sound: each part of it as bright as its band.
      float rays = 0.3 + 0.7 * pow(vnoise3(vec3(p.x * 7.0, auFlow * 0.6, fi * 5.0)), 1.5);
      float bandX = clamp((p.x - camPos.x) * 0.045 + 0.5 + fi * 0.07, 0.0, 1.0);
      float sound = 0.35 + 1.4 * spectrum(bandX);
      // A hit's surge travels along the curtain.
      float surge = auSurge * exp(-abs(p.x - camPos.x - auWave) * 0.25);
      // Brightest at the hem, which is sharp; fading upwards.
      float fade = smoothstep(0.0, 0.03, f) * exp(-f * 2.6) * (1.0 - smoothstep(0.85, 1.0, f));
      sum += curtainColor(f) * sheet * rays * edgeOn * (sound + 2.0 * surge) * fade * exp(-t * 0.025);
    }
  }
  return sum * 2.8 / float(layers);
}
vec3 starfield(vec3 rd) {
  vec3 col = vec3(0.0);
  // The Milky Way: a band of soft light across the sky, with dark lanes.
  vec3 axis = normalize(vec3(0.3, 0.55, -0.78));
  float band = exp(-pow(dot(rd, axis) * 7.0, 2.0));
  float lanes = fbm3(rd * 14.0, 6);
  col += vec3(0.03, 0.035, 0.055) * band * smoothstep(0.45, 0.85, lanes);
  // Stars, a few bright, twinkling.
  vec3 c = floor(rd * 520.0);
  float h = hash13(c);
  float s = step(0.9975 - band * 0.002, h);
  float tw = 0.7 + 0.3 * sin(auFlow * 3.0 + h * 80.0);
  col += vec3(0.85, 0.9, 1.0) * s * pow(hash13(c + 3.1), 4.0) * 3.0 * tw;
  return col * stars;
}
// The skyline: mountains' height (radians above the horizon) by direction.
float skyline(vec3 rd) {
  float a = atan(rd.x, rd.z);
  return 0.05 + 0.24 * pow(vnoise3(vec3(a * 1.4, 0.0, 0.0)), 1.5) + 0.05 * vnoise3(vec3(a * 6.0, 1.0, 0.0)) + 0.012 * vnoise3(vec3(a * 30.0, 2.0, 0.0));
}
vec3 sky(vec3 ro, vec3 rd, int layers) {
  vec3 col = mix(vec3(0.004, 0.008, 0.02), vec3(0.0005, 0.001, 0.004), smoothstep(0.0, 0.6, rd.y));
  col += starfield(rd);
  col += aurora(ro, rd, layers);
  // The aurora's own light in the air near the horizon.
  col += curtainColor(0.1) * 0.012 * (1.0 + auSurge) * exp(-max(rd.y, 0.0) * 8.0);
  return col;
}

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  int layers = int(mix(24.0, 64.0, quality));
  float e = asin(clamp(rd.y, -1.0, 1.0));
  float ridge = skyline(rd);
  if (e > ridge) return sky(ro, rd, layers);
  if (e > 0.0) {
    // The mountains: dark, their snow catching the aurora's light from above, a rim along the ridge.
    float rim = exp(-(ridge - e) * 120.0);
    vec3 glow = curtainColor(0.1) * (0.04 + 0.06 * auSurge);
    float snow = smoothstep(0.4, 0.7, vnoise3(vec3(atan(rd.x, rd.z) * 40.0, e * 90.0, 0.0)));
    return vec3(0.002, 0.003, 0.006) + glow * (rim * 0.8 + snow * 0.25 * (e / ridge));
  }
  // The ice: a mirror, slightly rough, with cracks and drifts of snow.
  float t = -ro.y / rd.y;
  vec3 p = ro + rd * t;
  vec2 q = p.xz;
  vec3 n = normalize(vec3((vnoise3(vec3(q * 2.0, 0.0)) - 0.5) * 0.06, 1.0, (vnoise3(vec3(q * 2.0, 5.0)) - 0.5) * 0.06));
  vec3 r = reflect(rd, n);
  float fres = 0.02 + 0.5 * pow(1.0 - max(-rd.y, 0.0), 5.0);
  vec3 col = sky(p, r, layers * 3 / 4) * (0.12 + fres);
  // Cracks: thin bright lines where the ice split.
  vec2 g = q * 0.9;
  float cracks = abs(vnoise3(vec3(g, 0.0)) - vnoise3(vec3(g * 1.7 + 3.0, 0.0)));
  col += curtainColor(0.1) * 0.02 * smoothstep(0.03, 0.0, cracks);
  // Snow in drifts on the ice, lit by the sky.
  float drift = smoothstep(0.55, 0.75, fbm3(vec3(q * 0.35, 1.0), 4));
  col = mix(col, curtainColor(0.1) * 0.015 + vec3(0.01, 0.012, 0.02), drift * 0.8);
  // Far ice fades into the haze under the mountains.
  col = mix(col, vec3(0.003, 0.005, 0.01) + curtainColor(0.1) * 0.006, 1.0 - exp(-t * 0.04));
  return col;
}
`,
  init: () => ({ time: 0, flow: 0, yaw: 0, vYaw: 0.02, x: 0, z: 0, lift: 0, surge: 0, wave: 0 }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    s.time += dt;
    s.flow += dt * (0.6 + 1.6 * a.level);
    s.vYaw = smoothTo(s.vYaw, 0.025 + 0.05 * Math.sin(s.time * 0.05), frame.dt, 3);
    s.yaw += s.vYaw * dt;
    s.x += Math.sin(s.yaw) * 0.08 * dt;
    s.z += Math.cos(s.yaw) * 0.08 * dt;
    s.lift = smoothTo(s.lift, a.bass, frame.dt, 0.25);
    if (frame.follow.onBeat) {
      s.surge = Math.min(1.5, s.surge + 0.8 * Math.max(0.5, frame.hit));
      s.wave = -18;
    }
    s.surge = smoothTo(s.surge, 0, frame.dt, 0.6);
    s.wave += dt * 30;
  },
  uniforms(s, frame) {
    const pos: Vec3 = [s.x, 0.012, s.z];
    // Looking ahead and up at the sky, the horizon low in the frame.
    const fwd = normalize([Math.sin(s.yaw), 0.55, Math.cos(s.yaw)]);
    return [
      ...cameraLooking(pos, fwd, 0, 62),
      ...soundUniforms(frame),
      float("auFlow", s.flow),
      float("auLift", s.lift),
      float("auSurge", s.surge),
      float("auWave", s.wave),
    ];
  },
};
