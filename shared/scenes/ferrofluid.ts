/**
 * Ferrofluid (docs/visualizer/scenes.md): a blob of liquid metal in a studio that grows spikes as a magnet would
 * pull them, on the music. The spikes sit on a spherical Fibonacci lattice (evenly spread, no grid); each stands
 * as high as its band of the spectrum (the lows at one pole, the highs at the other: it hears the sound itself),
 * and every kick pulls them all up at once. Stepped: the blob's slow turn, the kick's pull (a fast rise, a slower
 * sink), its ripple clock, and the camera's orbit.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraUniforms, float, sceneDt, smoothTo, soundUniforms } from "./kit.ts";

interface FerroState {
  time: number;
  turn: number;
  pull: number;
  ripple: number;
  orbit: number;
  lift: number;
}

export const FERROFLUID: SceneSpec<FerroState> = {
  type: "ferrofluid",
  label: "Ferrofluid",
  params: [
    {
      kind: "choice",
      key: "finish",
      label: "Finish",
      default: "oil",
      options: [
        { value: "oil", label: "Black Oil" },
        { value: "chrome", label: "Chrome" },
        { value: "gold", label: "Gold" },
      ],
    },
    { kind: "number", key: "spikes", label: "Spikes", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "ripple", label: "Ripple", default: 1, min: 0, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  audio: () => ({ rows: 1, span: 0, fall: 0.25, window: 0 }),
  glsl: /* glsl */ `
uniform float ffTurn;
uniform float ffPull;
uniform float ffRipple;
const float PHI = 1.61803398875;
const float SPIKES = 220.0;
mat3 turnAxis(float a) {
  // About a tilted axis, so the poles wander.
  vec3 k = normalize(vec3(0.3, 1.0, 0.15));
  float c = cos(a);
  float s = sin(a);
  return mat3(c + k.x * k.x * (1.0 - c), k.y * k.x * (1.0 - c) + k.z * s, k.z * k.x * (1.0 - c) - k.y * s,
              k.x * k.y * (1.0 - c) - k.z * s, c + k.y * k.y * (1.0 - c), k.z * k.y * (1.0 - c) + k.x * s,
              k.x * k.z * (1.0 - c) + k.y * s, k.y * k.z * (1.0 - c) - k.x * s, c + k.z * k.z * (1.0 - c));
}
// The nearest of n spherical Fibonacci points to direction p (z up): Keinert et al.'s inverse mapping.
// Returns the point, and its index in w.
vec4 nearestFibonacci(vec3 p, float n) {
  float phi = min(atan(p.y, p.x), PI);
  float cosTheta = p.z;
  float k = max(2.0, floor(log(n * PI * sqrt(5.0) * (1.0 - cosTheta * cosTheta)) / log(PHI * PHI)));
  float Fk = pow(PHI, k) / sqrt(5.0);
  vec2 F = vec2(floor(Fk + 0.5), floor(Fk * PHI + 0.5));
  vec2 ka = 2.0 * F / n;
  vec2 kb = 2.0 * PI * (fract((F + 1.0) * PHI) - (PHI - 1.0));
  mat2 iB = mat2(ka.y, -ka.x, kb.y, -kb.x) / (ka.y * kb.x - ka.x * kb.y);
  vec2 c = floor(iB * vec2(phi, cosTheta - (1.0 - 1.0 / n)));
  float best = 8.0;
  vec4 found = vec4(0.0, 0.0, 1.0, 0.0);
  for (int s = 0; s < 4; s++) {
    vec2 uv = vec2(float(s - 2 * (s / 2)), float(s / 2));
    float i = clamp(dot(F, uv + c), 0.0, n - 1.0);
    float phi2 = 2.0 * PI * fract(i * (PHI - 1.0));
    float cosTheta2 = 1.0 - (2.0 * i + 1.0) / n;
    float sinTheta2 = sqrt(max(0.0, 1.0 - cosTheta2 * cosTheta2));
    vec3 q = vec3(cos(phi2) * sinTheta2, sin(phi2) * sinTheta2, cosTheta2);
    float d = dot(q - p, q - p);
    if (d < best) { best = d; found = vec4(q, i); }
  }
  return found;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
// The fluid: a rippling sphere, and spikes pulled out of it (each as high as its band), merged smoothly.
float fluid(vec3 p, out float spikeness) {
  vec3 q = turnAxis(ffTurn) * p;
  float r = length(q);
  vec3 dir = q / max(r, 1e-5);
  float rip = (vnoise3(q * 2.2 + vec3(0.0, ffRipple, 0.0)) - 0.5) * 0.09 * ripple * (0.6 + sLevel);
  float body = r - 1.0 - rip;
  vec4 nf = nearestFibonacci(dir.xzy, SPIKES);
  vec3 n = nf.xzy;
  // Lows at one pole, highs at the other.
  float band = clamp(0.5 - 0.5 * n.y, 0.0, 1.0);
  float h = spikes * (0.02 + 0.28 * pow(spectrum(band * 0.85 + 0.05), 1.6) + 0.22 * ffPull);
  float along = dot(q, n);
  float rho = length(q - n * along);
  // A sharp cone from inside the body to its tip.
  float tip = 1.0 + h;
  float t = clamp((along - 0.9) / max(tip - 0.9, 1e-3), 0.0, 1.0);
  float cone = (rho - 0.14 * pow(1.0 - t, 1.25)) * 0.75 + max(0.0, along - tip);
  spikeness = smoothstep(0.02, 0.0, cone) * smoothstep(0.6, 1.0, t);
  return smin(body, cone, 0.08);
}
float fluidD(vec3 p) { float s; return fluid(p, s); }
vec3 fluidNormal(vec3 p) {
  vec2 k = vec2(1.0, -1.0) * 0.0015;
  return normalize(k.xyy * fluidD(p + k.xyy) + k.yyx * fluidD(p + k.yyx) + k.yxy * fluidD(p + k.yxy) + k.xxx * fluidD(p + k.xxx));
}
float marchFluid(vec3 ro, vec3 rd, float tmax) {
  // Only near the blob: start at its bounding sphere.
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 9.0;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float t = max(0.0, -b - sqrt(disc));
  int steps = int(mix(60.0, 140.0, quality));
  for (int i = 0; i < 140; i++) {
    if (i >= steps || t > tmax) break;
    float d = fluidD(ro + rd * t);
    if (d < 0.0008 * (1.0 + t)) return t;
    t += d * 0.7;
  }
  return -1.0;
}
// The studio: a dark room, soft boxes above and to the sides, a warm kicker behind.
vec3 studio(vec3 rd, bool seen) {
  vec3 col = mix(vec3(0.012, 0.013, 0.016), vec3(0.03, 0.032, 0.04), smoothstep(-0.3, 0.6, rd.y));
  // A big soft box overhead, two strips at the sides, a warm one behind.
  float top = smoothstep(0.55, 0.62, rd.y) * (1.0 - smoothstep(0.5, 0.58, abs(rd.x)));
  col += vec3(3.0) * top;
  vec3 s1 = normalize(vec3(1.0, 0.25, 0.35));
  vec3 s2 = normalize(vec3(-1.0, 0.1, 0.5));
  float strip1 = smoothstep(0.95, 0.965, dot(normalize(vec3(rd.x, 0.0, rd.z)), normalize(vec3(s1.x, 0.0, s1.z)))) * smoothstep(0.6, 0.5, abs(rd.y - s1.y));
  float strip2 = smoothstep(0.95, 0.965, dot(normalize(vec3(rd.x, 0.0, rd.z)), normalize(vec3(s2.x, 0.0, s2.z)))) * smoothstep(0.6, 0.5, abs(rd.y - s2.y));
  col += vec3(2.4, 2.5, 2.8) * strip1 + vec3(1.2, 1.5, 2.2) * strip2;
  vec3 kick = normalize(vec3(0.0, 0.3, -1.0));
  // (Only in reflections: seen straight, it would be a lamp in the shot.)
  if (!seen) col += vec3(1.6, 0.8, 0.4) * smoothstep(0.985, 0.995, dot(rd, kick)) * (0.4 + 1.6 * ffPull);
  return col;
}
vec3 finishColor() {
  if (finish == 1) return vec3(0.95, 0.96, 1.0);
  if (finish == 2) return vec3(1.0, 0.72, 0.32);
  return vec3(0.06, 0.06, 0.065);
}
const float FLOOR = -1.55;
vec3 shadeFluid(vec3 p, vec3 rd, float spikeness) {
  vec3 n = fluidNormal(p);
  vec3 r = reflect(rd, n);
  float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 5.0);
  vec3 f0 = finishColor();
  vec3 spec = f0 + (1.0 - f0) * fres;
  // What it reflects: the studio, or the floor (its glow under the blob).
  vec3 env = studio(r, false);
  if (r.y < 0.0) {
    float tf = (FLOOR - p.y) / r.y;
    vec3 fp = p + r * tf;
    env = vec3(0.01) + vec3(0.25, 0.27, 0.32) * exp(-length(fp.xz) * 1.4) * 0.15;
  }
  vec3 col = env * spec;
  // Oil is a little bluish where it's thin, and its spikes' tips catch the kick light.
  col += finishColor() * 0.02 + vec3(1.0, 0.55, 0.25) * spikeness * ffPull * 0.12;
  return col;
}

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  // The room: dark, a soft pool of light on the floor under the blob.
  vec3 col = studio(rd, true) * 0.25;
  float tFloor = rd.y < 0.0 ? (FLOOR - ro.y) / rd.y : 1e9;
  float t = marchFluid(ro, rd, min(tFloor, 30.0));
  if (t > 0.0) {
    vec3 p = ro + rd * t;
    float sp;
    fluid(p, sp);
    col = shadeFluid(p, rd, sp);
  } else if (tFloor < 1e8) {
    vec3 fp = ro + rd * tFloor;
    float pool = exp(-length(fp.xz) * 0.9);
    // The floor: dark and glossy, the blob mirrored in it.
    vec3 r = reflect(rd, vec3(0.0, 1.0, 0.0));
    float tr = marchFluid(fp, r, 8.0);
    vec3 refl = studio(r, true) * 0.03;
    if (tr > 0.0) {
      vec3 q = fp + r * tr;
      float sp;
      fluid(q, sp);
      refl = shadeFluid(q, r, sp);
    }
    // A soft shadow under it.
    float shadow = smoothstep(0.4, 1.6, length(fp.xz));
    col = vec3(0.008, 0.009, 0.011) * (0.4 + 0.6 * shadow) + vec3(0.06, 0.065, 0.08) * pool * shadow + refl * 0.35;
    col = mix(col, vec3(0.006), smoothstep(6.0, 14.0, tFloor));
  }
  return col;
}
`,
  init: () => ({ time: 0, turn: 0, pull: 0, ripple: 0, orbit: 0, lift: 0.4 }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    s.time += dt;
    s.turn += dt * (0.12 + 0.25 * a.level);
    s.ripple += dt * (0.5 + 1.5 * a.mid);
    if (a.onBeat) s.pull = Math.max(s.pull, 0.6 + 0.4 * frame.hit);
    // Up fast on a kick, down slower, as fluid would.
    s.pull = smoothTo(s.pull, a.punch * 0.4, frame.dt, s.pull > a.punch * 0.4 ? 0.22 : 0.05);
    s.orbit += dt * (0.1 + 0.12 * a.level);
    s.lift = smoothTo(s.lift, 0.35 + 0.6 * Math.sin(s.time * 0.13), frame.dt, 1);
  },
  uniforms(s, frame) {
    const r = 3.6;
    const pos: Vec3 = [Math.cos(s.orbit) * r, s.lift, Math.sin(s.orbit) * r];
    return [...cameraUniforms(pos, [0, 0.0, 0], 0, 50), ...soundUniforms(frame), float("ffTurn", s.turn), float("ffPull", s.pull), float("ffRipple", s.ripple)];
  },
};
