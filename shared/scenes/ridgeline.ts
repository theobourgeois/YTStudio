/**
 * Ridgeline (docs/visualizer/scenes.md): a low, fast flight down a winding valley through mountains. The terrain
 * is eroded fractal noise with a valley carved along the flight path; it's in the GLSL, and mirrored here in
 * float32 (`ridgeHeight`) so the camera knows the ground ahead and never flies into it. Stepped: how far it's
 * flown (at a speed on the bass), how high (lifting in loud passages, dipping on kicks), its bank into the bends.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraUniforms, clamp01, float, sceneDt, smoothTo, soundUniforms } from "./kit.ts";

const f32 = Math.fround;
const fract = (x: number) => f32(x - Math.floor(x));

/** The GLSL's `hash12`, in float32. */
function hash12(x: number, y: number): number {
  let a = fract(f32(x * f32(0.1031)));
  let b = fract(f32(y * f32(0.1031)));
  let c = fract(f32(x * f32(0.1031)));
  const d = f32(f32(f32(a * f32(b + 33.33)) + f32(b * f32(c + 33.33))) + f32(c * f32(a + 33.33)));
  a = f32(a + d);
  b = f32(b + d);
  c = f32(c + d);
  return fract(f32(f32(a + b) * c));
}

/** The GLSL's `vnoise2d`: value noise and its derivatives. */
function vnoise2d(x: number, y: number): [number, number, number] {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = f32(x - ix);
  const fy = f32(y - iy);
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1);
  const duy = 30 * fy * fy * (fy * (fy - 2) + 1);
  const a = hash12(ix, iy);
  const b = hash12(ix + 1, iy);
  const c = hash12(ix, iy + 1);
  const d = hash12(ix + 1, iy + 1);
  const k = a - b - c + d;
  return [a + (b - a) * ux + (c - a) * uy + k * ux * uy, dux * (b - a + k * uy), duy * (c - a + k * ux)];
}

/** Where the valley (and the flight) runs: its x at depth z, metres. */
export const pathX = (z: number) => 260 * Math.sin(z * 0.00093) + 140 * Math.sin(z * 0.0021 + 1.3) + 60 * Math.sin(z * 0.0047 + 0.7);
/** How fast the path bends: its x's second derivative. */
const pathBend = (z: number) =>
  -260 * 0.00093 ** 2 * Math.sin(z * 0.00093) - 140 * 0.0021 ** 2 * Math.sin(z * 0.0021 + 1.3) - 60 * 0.0047 ** 2 * Math.sin(z * 0.0047 + 0.7);

/** The mountains' height (metres) at (x, z), as the GLSL's `terrain` with `octaves`. */
export function ridgeHeight(x: number, z: number, octaves = 7): number {
  let px = f32(x * 0.00055);
  let py = f32(z * 0.00055);
  let a = 0;
  let b = 1;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < octaves; i++) {
    const [n, nx, ny] = vnoise2d(px, py);
    dx += nx;
    dy += ny;
    a += (b * n) / (1 + dx * dx + dy * dy);
    b *= 0.5;
    // M2 * p * 2: mat2(0.8, -0.6, 0.6, 0.8) is column-major.
    [px, py] = [f32((0.8 * px + 0.6 * py) * 2), f32((-0.6 * px + 0.8 * py) * 2)];
  }
  const h = a * 1100;
  const v = smoothstepJs(180, 1300, Math.abs(x - pathX(z)));
  return h * 0.15 + (h - h * 0.15) * v;
}

function smoothstepJs(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

interface RidgelineState {
  /** The scene's own clock (Speed folded in). */
  time: number;
  /** How far down the path, and how fast (m, m/s). */
  z: number;
  speed: number;
  /** How far up between the valley's floor and its walls (0..1), the camera's height, and a kick's dip. */
  lift: number;
  y: number;
  dip: number;
  roll: number;
  /** A kick's flash, falling. */
  flash: number;
  /** How loud it's been lately (slow): loud passages fly higher. */
  energy: number;
}

/** Metres ahead the camera looks and checks the ground. */
const AHEAD = 420;

const groundAhead = (z: number) => {
  let most = -Infinity;
  for (let d = 0; d <= AHEAD * 1.5; d += 60) most = Math.max(most, ridgeHeight(pathX(z + d), z + d, 6));
  return most;
};

/** How high the walls either side of the valley stand, ahead (the mean of a few samples each side). */
const wallsAhead = (z: number) => {
  let sum = 0;
  let n = 0;
  for (let d = 200; d <= 1400; d += 400) {
    const x = pathX(z + d);
    for (const side of [-1, 1]) {
      sum += ridgeHeight(x + side * 1500, z + d, 5);
      n++;
    }
  }
  return sum / n;
};

export const RIDGELINE: SceneSpec<RidgelineState> = {
  type: "ridgeline",
  label: "Ridgeline",
  params: [
    {
      kind: "choice",
      key: "style",
      label: "Style",
      default: "dusk",
      options: [
        { value: "dusk", label: "Dusk" },
        { value: "neon", label: "Neon" },
        { value: "night", label: "Night" },
      ],
    },
    { kind: "number", key: "sunHeight", label: "Sun Height", default: 0.32, min: -0.1, max: 0.8, step: 0.01, decimals: 2, slider: true },
    { kind: "number", key: "haze", label: "Haze", default: 1, min: 0, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "snow", label: "Snow", default: 0.5, min: 0, max: 1, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  glsl: /* glsl */ `
uniform float rlTime;
uniform float rlFlash;
const mat2 M2 = mat2(0.8, -0.6, 0.6, 0.8);
float pathX(float z) { return 260.0 * sin(z * 0.00093) + 140.0 * sin(z * 0.0021 + 1.3) + 60.0 * sin(z * 0.0047 + 0.7); }
// Eroded fractal noise: each octave damped where the ones before are steep (sharp ridges, smooth valleys).
float terrain(vec2 x, int octaves) {
  vec2 p = x * 0.00055;
  float a = 0.0;
  float b = 1.0;
  vec2 d = vec2(0.0);
  for (int i = 0; i < 14; i++) {
    if (i >= octaves) break;
    vec3 n = vnoise2d(p);
    d += n.yz;
    a += b * n.x / (1.0 + dot(d, d));
    b *= 0.5;
    p = M2 * p * 2.0;
  }
  float h = a * 1100.0;
  return mix(h * 0.15, h, smoothstep(180.0, 1300.0, abs(x.x - pathX(x.y))));
}
vec3 sunDirection() { return normalize(vec3(0.42, sunHeight, 1.0)); }

float march(vec3 ro, vec3 rd, float tmax) {
  float t = 2.0;
  int steps = int(mix(90.0, 320.0, quality));
  float last = 0.0;
  float lastT = t;
  for (int i = 0; i < 320; i++) {
    if (i >= steps || t > tmax) break;
    vec3 p = ro + rd * t;
    float dh = p.y - terrain(p.xz, 8);
    if (dh < 0.0015 * t) {
      // Between the last step above and this one below: a few halvings find the surface.
      float a = lastT;
      float b = t;
      for (int k = 0; k < 5; k++) {
        float m = 0.5 * (a + b);
        vec3 q = ro + rd * m;
        if (q.y - terrain(q.xz, 8) < 0.0) b = m; else a = m;
      }
      return 0.5 * (a + b);
    }
    lastT = t;
    last = dh;
    t += max(0.45 * dh, 0.5 + 0.002 * t);
  }
  return -1.0;
}
vec3 terrainNormal(vec2 x, float t) {
  float e = max(0.6, 0.0012 * t);
  int oct = t < 1500.0 ? 13 : t < 5000.0 ? 10 : 8;
  return normalize(vec3(terrain(x - vec2(e, 0.0), oct) - terrain(x + vec2(e, 0.0), oct), 2.0 * e, terrain(x - vec2(0.0, e), oct) - terrain(x + vec2(0.0, e), oct)));
}
// Soft shadows: how close a ray towards the sun passes to the ground (marched on the surface's own octaves, or a
// coarser ground would shadow the finer one under it).
float softShadow(vec3 p, vec3 l) {
  float res = 1.0;
  float t = 4.0;
  for (int i = 0; i < 48; i++) {
    vec3 q = p + l * t;
    float h = q.y - terrain(q.xz, 8);
    res = min(res, 14.0 * h / t);
    t += clamp(h, 6.0, 140.0);
    if (res < 0.001 || q.y > 2600.0) break;
  }
  return smoothstep(0.0, 1.0, res);
}

vec3 skyColor(vec3 rd, vec3 sun) {
  float sd = max(dot(rd, sun), 0.0);
  float y = max(rd.y, 0.0);
  vec3 col;
  if (style == 1) {
    // Neon: violet to black, a hot horizon.
    col = mix(vec3(0.22, 0.02, 0.2), vec3(0.008, 0.0, 0.025), pow(y, 0.4));
    col += vec3(1.0, 0.2, 0.5) * exp(-y * 14.0) * 0.35;
    // A striped sun, the gaps rolling down.
    vec2 sp = vec2(dot(rd, normalize(cross(vec3(0, 1, 0), sun))), rd.y - sun.y);
    float r = length(sp);
    if (r < 0.2) {
      float stripes = step(0.0, sp.y) + step(0.32, fract(sp.y * 22.0 + rlTime * 0.6)) * step(sp.y, 0.0) * smoothstep(-0.2, 0.0, sp.y + 0.12);
      vec3 sunCol = mix(vec3(1.0, 0.85, 0.2), vec3(1.0, 0.1, 0.55), clamp(0.5 - sp.y * 3.0, 0.0, 1.0));
      col = mix(col, sunCol * (1.3 + 0.8 * sBeat), smoothstep(0.2, 0.195, r) * clamp(stripes, 0.0, 1.0));
    }
    col += vec3(1.0, 0.3, 0.6) * pow(sd, 8.0) * 0.35;
    return col;
  }
  if (style == 2) {
    // Night: deep blue, stars, a moon.
    col = mix(vec3(0.02, 0.04, 0.1), vec3(0.002, 0.004, 0.015), pow(y, 0.5));
    vec3 s = floor(rd * 900.0);
    float star = step(0.9965, hash13(s)) * hash13(s + 7.0);
    col += vec3(0.9, 0.95, 1.0) * star * 1.6 * smoothstep(0.0, 0.15, rd.y);
    col += vec3(0.8, 0.9, 1.0) * (smoothstep(0.9993, 0.9996, sd) * 6.0 + pow(sd, 120.0) * 0.4);
    return col;
  }
  // Dusk: a warm horizon under a deep blue zenith, the sun's glow.
  col = mix(vec3(1.3, 0.5, 0.18), vec3(0.14, 0.26, 0.66), pow(y, 0.35));
  col = mix(col, vec3(0.02, 0.06, 0.22), smoothstep(0.2, 0.8, y));
  col *= 0.6 + 0.4 * smoothstep(-0.15, 0.4, sun.y);
  col += vec3(1.0, 0.5, 0.2) * pow(sd, 8.0) * 0.7;
  col += vec3(1.0, 0.7, 0.4) * pow(sd, 80.0) * 1.5;
  col += vec3(1.0, 0.85, 0.6) * smoothstep(0.9990, 0.9995, sd) * 30.0;
  return col;
}

// A high deck of cloud, its parallax selling the speed.
vec4 clouds(vec3 ro, vec3 rd, vec3 sun) {
  if (rd.y < 0.01 || style == 1) return vec4(0.0);
  float t = (2800.0 - ro.y) / rd.y;
  vec2 p = (ro.xz + rd.xz * t) * 0.00035 + vec2(rlTime * 0.004, 0.0);
  float d = fbm3(vec3(p, rlTime * 0.01), 5);
  float a = smoothstep(0.5, 0.78, d) * smoothstep(0.04, 0.3, rd.y) * exp(-t * 0.00002);
  // Lit from below by the low sun: gold towards it, pink and violet away; their thin edges brightest.
  float towards = pow(max(dot(rd, sun), 0.0), 2.0);
  float edge = 1.0 - smoothstep(0.5, 0.9, d);
  vec3 lit = mix(vec3(0.42, 0.2, 0.36), vec3(1.9, 0.85, 0.38), towards) * (0.5 + 0.7 * edge);
  vec3 c = style == 1 ? vec3(0.6, 0.1, 0.5) * 0.4 : style == 2 ? vec3(0.04, 0.05, 0.09) : lit * (0.5 + 0.5 * smoothstep(-0.1, 0.3, sun.y));
  return vec4(c, a * 0.8);
}

vec3 shade(vec3 p, vec3 rd, float t, vec3 sun) {
  vec3 n = terrainNormal(p.xz, t);
  // Rock: strata and grit on the steep faces, which erosion left smooth.
  float steep = 1.0 - smoothstep(0.55, 0.85, n.y);
  if (steep > 0.0 && t < 4000.0) {
    vec3 g = vec3(vnoise3(p * 0.045) - 0.5, vnoise3(p * vec3(0.02, 0.09, 0.02) + 7.1) - 0.5, vnoise3(p * 0.045 + 3.3) - 0.5);
    g += 0.5 * vec3(vnoise3(p * 0.19) - 0.5, 0.0, vnoise3(p * 0.19 + 5.7) - 0.5);
    n = normalize(n + g * 0.55 * steep * (1.0 - smoothstep(1500.0, 4000.0, t)));
  }
  float h = p.y;
  // Snow where it's high and flat enough, rock on the slopes, dark grass and trees low down.
  float snowLine = mix(1500.0, 600.0, snow) + 140.0 * (vnoise2d(p.xz * 0.004).x - 0.5);
  float snowy = smoothstep(snowLine - 60.0, snowLine + 60.0, h) * smoothstep(0.55, 0.8, n.y);
  vec3 rock = mix(vec3(0.13, 0.12, 0.11), vec3(0.24, 0.21, 0.18), vnoise2d(p.xz * 0.02).x);
  vec3 grass = mix(vec3(0.025, 0.035, 0.018), vec3(0.05, 0.055, 0.03), vnoise2d(p.xz * 0.01).x);
  vec3 albedo = mix(rock, grass, smoothstep(0.8, 0.95, n.y) * (1.0 - smoothstep(250.0, 700.0, h)));
  albedo = mix(albedo, vec3(0.85, 0.88, 0.95), snowy);
  float dif = clamp(dot(n, sun), 0.0, 1.0);
  float sha = dif > 0.001 ? softShadow(p + n * 2.0, sun) : 0.0;
  float sky = 0.5 + 0.5 * n.y;
  vec3 col;
  if (style == 1) {
    // Neon: black ground, a glowing grid and contour lines.
    // The grid's lines widen with distance (so they stay about as wide on screen); contours by how fast the
    // height changes across a pixel (fwidth), held back where a march's neighbours disagree.
    vec2 g = abs(fract(p.xz / 120.0) - 0.5);
    float grid = 1.0 - smoothstep(0.0, 0.008 + t * 0.000006, 0.5 - max(g.x, g.y));
    float hc = h / 70.0;
    float contour = 1.0 - smoothstep(0.25, 1.0, (0.5 - abs(fract(hc) - 0.5)) / clamp(fwidth(hc), 1e-4, 0.08));
    vec3 lineCol = mix(vec3(0.1, 0.9, 1.0), vec3(1.0, 0.15, 0.7), smoothstep(150.0, 900.0, h));
    float pulse = 0.8 + 1.2 * sLevel + 2.0 * sBeat;
    col = vec3(0.01, 0.0, 0.02) * sky + lineCol * (grid * 0.9 + contour * 0.6) * pulse * exp(-t * 0.0002);
    col += vec3(0.4, 0.05, 0.3) * dif * 0.06;
    return col;
  }
  if (style == 2) {
    vec3 moon = vec3(0.35, 0.45, 0.7);
    col = albedo * (moon * dif * sha * 1.2 + vec3(0.02, 0.03, 0.06) * sky);
    return col;
  }
  vec3 sunCol = vec3(5.0, 3.1, 1.8) * (1.0 + 0.5 * rlFlash);
  float bounce = clamp(dot(n, normalize(vec3(-sun.x, 0.0, -sun.z))), 0.0, 1.0) * clamp(1.0 - h / 1500.0, 0.0, 1.0);
  // Shadows are lit by the blue sky; slopes facing away get a little warm light back off the sunlit ground.
  col = albedo * (sunCol * dif * sha + vec3(0.22, 0.32, 0.6) * sky * 0.75 + vec3(0.4, 0.24, 0.12) * bounce * 0.25);
  // Sun on snow glints.
  col += snowy * sunCol * pow(clamp(dot(reflect(rd, n), sun), 0.0, 1.0), 12.0) * sha * 0.4;
  return col;
}

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  vec3 sun = sunDirection();
  float tmax = 16000.0;
  float t = march(ro, rd, tmax);
  vec3 sky = skyColor(rd, sun);
  vec4 cl = clouds(ro, rd, sun);
  sky = mix(sky, cl.rgb, cl.a);
  vec3 col = sky;
  if (t > 0.0) {
    vec3 p = ro + rd * t;
    col = shade(p, rd, t, sun);
    // Aerial perspective: haze thick low down, coloured towards the sun.
    float sd = pow(max(dot(rd, sun), 0.0), 8.0);
    vec3 fogCol = style == 1 ? mix(vec3(0.12, 0.01, 0.12), vec3(0.6, 0.12, 0.35), sd)
      : style == 2 ? vec3(0.02, 0.035, 0.08)
      : mix(vec3(0.34, 0.45, 0.68), vec3(1.2, 0.68, 0.38), pow(max(dot(rd, sun), 0.0), 12.0)) * (0.6 + 0.4 * smoothstep(-0.1, 0.3, sun.y));
    // Haze lies in the valleys (thick low down) and builds with distance, a little per colour (blue first).
    float density = 0.00005 * haze * exp(-max(p.y, 0.0) * 0.0009);
    vec3 fog = 1.0 - exp(-t * density * vec3(0.8, 1.0, 1.35));
    col = mix(col, fogCol, fog);
  }
  return col;
}
`,
  init: () => {
    const ground = groundAhead(0);
    const y = Math.max(ground + 90, ground + (wallsAhead(0) - ground) * 0.35);
    return { time: 0, z: 0, speed: 90, lift: 0.35, y, dip: 0, roll: 0, flash: 0, energy: 0 };
  },
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    s.time += dt;
    s.energy = smoothTo(s.energy, a.level, frame.dt, 2.5);
    s.speed = smoothTo(s.speed, 70 + 120 * a.bass + 60 * a.punch, frame.dt, 0.6);
    s.z += s.speed * dt;
    if (a.onBeat) {
      s.dip = Math.min(s.dip + 22 * Math.max(0.4, frame.hit), 45);
      s.flash = 1;
      s.speed += 25;
    }
    s.dip = smoothTo(s.dip, 0, frame.dt, 0.45);
    s.flash = Math.max(0, s.flash - frame.dt * 3);
    // Between the valley's floor and its walls: low and fast in quiet passages, up over the ridges in loud ones.
    s.lift = smoothTo(s.lift, 0.35 + 0.6 * clamp01(s.energy * 1.3), frame.dt, 1.5);
    const ground = groundAhead(s.z);
    const target = Math.max(ground + 90, ground + (wallsAhead(s.z) - ground) * s.lift) - s.dip;
    // Climb fast (never into a ridge), sink slowly.
    s.y = smoothTo(s.y, target, frame.dt, target > s.y ? 0.35 : 1.4);
    const floor = ridgeHeight(pathX(s.z), s.z, 6) + 25;
    if (s.y < floor) s.y = floor;
    // Bank into the bend: the sideways acceleration of following the path.
    const lateral = pathBend(s.z + 60) * s.speed * s.speed;
    s.roll = smoothTo(s.roll, Math.max(-0.55, Math.min(0.55, -lateral * 0.045)), frame.dt, 0.5);
  },
  uniforms(s, frame) {
    const pos: Vec3 = [pathX(s.z), s.y, s.z];
    const ahead = s.z + AHEAD;
    const target: Vec3 = [pathX(ahead), s.y - 90 - s.dip * 0.6 + 40 * Math.sin(s.time * 0.21), ahead];
    return [
      ...cameraUniforms(pos, target, s.roll, 62),
      ...soundUniforms(frame),
      float("rlTime", s.time),
      float("rlFlash", s.flash),
    ];
  },
};
