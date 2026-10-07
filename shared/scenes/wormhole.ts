/**
 * Wormhole (docs/visualizer/scenes.md, "Five more, again"): falling down a tunnel of luminous plasma that spirals
 * round the flight, lightning crawling along its walls on the hits, and now and then a jump into hyperspace. Made of
 * light on black (nothing but the plasma, its sparks and the stars is drawn), so Screen or Add lays it over a clip.
 * The plasma is a shell round a winding path, between radii `R - W` and `R + W`, and only that shell is marched:
 * the ray crosses the hollow to the inner skin (stepping no faster than it can move away from the axis), then meets
 * thin cylinders from there out in turn, each its slice of the volume (emission and absorption, front to back), so
 * every slice is a crisp surface whose noise is seen at the detail its pixel holds (no step banding, no grain), and
 * far down the throat, where even the broadest filament is finer than a pixel, the plasma blurs to its average and
 * glows. Its density is ridged fbm in the tube's coordinates, twisted into spiral filaments and stretched along the
 * flight; it's hottest at the inner skin and down the throat, coloured through the palette by both and a slow drift;
 * a light at the far end (where the line of sight leaves the hollow, `throatOf`) pulls the eye. Inside: streaks of
 * stars on cylinders round the lens, as long as the speed, and sparks off the skin on the highs.
 * The world repeats along the flight every `PERIOD` units (path, noise and a twist of whole turns), so the camera's
 * place wraps and never runs out of precision. Stepped: how far it's flown (faster on the bass), its roll with the
 * twist, the plasma's spin and glow (the level), the radius breathing on the low end's punch, a shake on each hit,
 * the bolts (each hit strikes one along the wall, following a filament, jagged, a branch splitting off, lighting the
 * plasma round it, flickering out in a quarter-second) and the jump: every few bars of hits, or when the level leaps
 * after a quiet stretch, a flash, then the speed and the lens rise, the field stretches into long streaks and its
 * hues turn, easing back. The wall's light round the tube is the spectrum in the GLSL (by angle, mirrored: the bass
 * at the bottom, the highs at the top), heard later the further off, so each kick runs away down the tunnel.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraLooking, clamp01, float, normalize, num, random, sceneDt, smoothTo, smoothstep, soundUniforms, sub, vec3, vec4 } from "./kit.ts";

/** The world's period along the flight (units): its path, noise and twist all repeat in it. */
const PERIOD = 1536;
/** Bolts of lightning at once, at most. */
const BOLTS = 4;
/** The tube's radius at rest (units). */
const RADIUS = 3;
/** Twist at 100%: radians a unit of depth. */
const TWIST = 0.22;

const TAU = Math.PI * 2;
const w = (n: number) => (TAU * n) / PERIOD;
/** Where the tube's axis runs at depth z (the GLSL's `whPath`). */
const pathXY = (z: number): [number, number] => [
  6 * Math.sin(z * w(6)) + 2.5 * Math.sin(z * w(15) + 1),
  4.5 * Math.sin(z * w(5) + 2) + 2 * Math.sin(z * w(13)),
];
const pathAt = (z: number): Vec3 => [...pathXY(z), z];

/** Twist (radians a unit) whole turns over the period, so the spiral repeats with the world. */
const twistOf = (twist: number) => (TAU * Math.round((twist * TWIST * PERIOD) / TAU)) / PERIOD;

/**
 * Where the tube's far end is seen from `pos` (at depth z): the furthest point of its axis the line of sight still
 * reaches down the hollow (bending away, the walls hide the rest), so its light sits where the walls converge.
 */
function throatOf(pos: Vec3, z: number, radius: number): Vec3 {
  let best = pathAt(z + 12);
  for (let ahead = 16; ahead <= 160; ahead += 4) {
    const end = pathAt(z + ahead);
    let clear = true;
    for (let k = 1; k < 16 && clear; k++) {
      const f = k / 16;
      const [x, y] = pathXY(pos[2] + (end[2] - pos[2]) * f);
      clear = Math.hypot(pos[0] + (end[0] - pos[0]) * f - x, pos[1] + (end[1] - pos[1]) * f - y) < radius;
    }
    if (!clear) break;
    best = end;
  }
  return best;
}

interface Bolt {
  /** Its start: an angle round the tube and a depth; how far it reaches along the flight. */
  a: number;
  z: number;
  len: number;
  age: number;
  power: number;
  seed: number;
}

interface WormholeState {
  time: number;
  /** How far along the path (wrapped into the world's period), and how fast. */
  z: number;
  speed: number;
  roll: number;
  /** The plasma's spin round the flight (an angle) and its colour's slow drift. */
  spin: number;
  hue: number;
  glow: number;
  radius: number;
  spark: number;
  /** The jump: seconds since it started (large: none), hits since the last, and a quiet stretch's length. */
  jumpAge: number;
  hitsSince: number;
  quiet: number;
  /** The shake the hits give the camera: its age, size and direction. */
  shakeAge: number;
  shakeAmp: number;
  shakeDir: number;
  bolts: Bolt[];
  rng: { seed: number };
}

/** The jump's envelope at an age: rushing in, held, easing back. */
const warpAt = (age: number) => smoothstep(0, 0.35, age) * (1 - smoothstep(1.5, 3.2, age));
/** The flash at a jump's start. */
const flashAt = (age: number) => (age < 0 ? 0 : Math.exp(-age / 0.08) * smoothstep(0, 0.03, age + 1 / 60));
/** A bolt's brightness at an age: a strike, a re-strike or two, gone in a quarter-second. */
const boltLight = (age: number) => (age < 0 ? 0 : Math.exp(-age * 9) * (age < 0.05 ? 1.5 : 0.6 + 0.4 * Math.sign(Math.sin(age * 57 + 0.7))));

/** Hits between jumps on a steady beat (bars of four), by the Jumps choice (0: only on drops; null: never). */
const JUMP_HITS: Record<string, number | null> = { bars4: 16, bars8: 32, drops: 0, off: null };
const jumpHits = (jumps: unknown) => (String(jumps) in JUMP_HITS ? JUMP_HITS[String(jumps)] : 16);

export const WORMHOLE: SceneSpec<WormholeState> = {
  type: "wormhole",
  label: "Wormhole",
  params: [
    {
      kind: "choice",
      key: "palette",
      label: "Palette",
      default: "stargate",
      options: [
        { value: "stargate", label: "Stargate" },
        { value: "plasma", label: "Plasma" },
        { value: "inferno", label: "Inferno" },
        { value: "toxic", label: "Toxic" },
      ],
    },
    { kind: "number", key: "twist", label: "Twist", default: 1, min: 0, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "turbulence", label: "Turbulence", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "stars", label: "Stars", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "lightning", label: "Lightning", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    {
      kind: "choice",
      key: "jumps",
      label: "Jumps",
      default: "bars4",
      options: [
        { value: "bars4", label: "Every 4 bars" },
        { value: "bars8", label: "Every 8 bars" },
        { value: "drops", label: "On drops" },
        { value: "off", label: "Off" },
      ],
    },
  ],
  audio: () => ({ rows: 32, span: 2, fall: 0.2, window: 0 }),
  glsl: /* glsl */ `
uniform float whR;
uniform float whTwist;
uniform float whSpin;
uniform float whHue;
uniform float whGlow;
uniform float whWarp;
uniform float whFlash;
uniform float whStreak;
uniform float whTravel;
uniform float whRoll;
uniform float whSpark;
uniform vec3 whFar;
uniform vec4 whBoltA0;
uniform vec4 whBoltA1;
uniform vec4 whBoltA2;
uniform vec4 whBoltA3;
uniform vec4 whBoltB0;
uniform vec4 whBoltB1;
uniform vec4 whBoltB2;
uniform vec4 whBoltB3;

const float WH_PERIOD = ${PERIOD.toFixed(1)};
const float WH_TAU = 6.28318531;
const float WH_PI = 3.14159265;

vec2 whPath(float z) {
  float w = WH_TAU / WH_PERIOD;
  return vec2(6.0 * sin(z * w * 6.0) + 2.5 * sin(z * w * 15.0 + 1.0), 4.5 * sin(z * w * 5.0 + 2.0) + 2.0 * sin(z * w * 13.0));
}

vec2 whPathD(float z) {
  float w = WH_TAU / WH_PERIOD;
  return vec2(6.0 * w * 6.0 * cos(z * w * 6.0) + 2.5 * w * 15.0 * cos(z * w * 15.0 + 1.0), 4.5 * w * 5.0 * cos(z * w * 5.0 + 2.0) + 2.0 * w * 13.0 * cos(z * w * 13.0));
}

// Value noise whose lattice repeats every per cells along z (so the world repeats along the flight).
float whNoise(vec3 x, float per) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float z0 = mod(i.z, per);
  float z1 = mod(i.z + 1.0, per);
  return mix(
    mix(mix(hash13(vec3(i.xy, z0)), hash13(vec3(i.xy + vec2(1, 0), z0)), f.x), mix(hash13(vec3(i.xy + vec2(0, 1), z0)), hash13(vec3(i.xy + vec2(1, 1), z0)), f.x), f.y),
    mix(mix(hash13(vec3(i.xy, z1)), hash13(vec3(i.xy + vec2(1, 0), z1)), f.x), mix(hash13(vec3(i.xy + vec2(0, 1), z1)), hash13(vec3(i.xy + vec2(1, 1), z1)), f.x), f.y),
    f.z);
}

// The palette from the tube's cool outside (0) to its white-hot inner skin (1).
vec3 whPalette(float x) {
  vec3 a, b, c;
  // Which way a jump turns the hues: each palette to its most striking neighbour.
  float turn;
  if (palette == 1) {
    a = vec3(0.25, 0.02, 1.0); b = vec3(1.0, 0.06, 0.6); c = vec3(1.0, 0.7, 0.95); turn = -1.1;
  } else if (palette == 2) {
    a = vec3(0.7, 0.01, 0.0); b = vec3(1.0, 0.26, 0.0); c = vec3(1.0, 0.78, 0.35); turn = -0.7;
  } else if (palette == 3) {
    a = vec3(0.0, 0.45, 0.4); b = vec3(0.25, 1.0, 0.12); c = vec3(0.85, 1.0, 0.55); turn = 1.0;
  } else {
    a = vec3(0.12, 0.03, 1.0); b = vec3(0.0, 0.5, 1.0); c = vec3(0.7, 0.95, 1.0); turn = 1.1;
  }
  x = clamp(x, 0.0, 1.0);
  vec3 col = mix(a, b, smoothstep(0.0, 0.55, x));
  col = mix(col, c, smoothstep(0.55, 1.0, x));
  // A jump turns its hues (about the grey axis: as saturated) and whitens its hottest.
  float h = whWarp * turn;
  const vec3 k = vec3(0.57735);
  col = max(col * cos(h) + cross(k, col) * sin(h) + k * dot(k, col) * (1.0 - cos(h)), 0.0);
  return mix(col, vec3(1.0), whWarp * 0.3 * x * x);
}

// The plasma at a point of the shell: at angle ang round the axis, depth z, u across the shell (-1 its inner skin, 1
// its outside), detail octaves (the last faded in by its fraction, so finer ones come and go without a seam). Its
// density, 0..1.
float whPlasma(float ang, float z, float u, float detail) {
  // In a jump the field stretches away from the lens: the rush.
  float zs = whTravel + (z - whTravel) / (1.0 + 2.5 * whWarp);
  ang += zs * whTwist + whSpin;
  // Turbulence: slow swirls that bend the filaments.
  vec3 wq = vec3(cos(ang) * 1.3, sin(ang) * 1.3, zs * 0.0625);
  float wn = whNoise(wq, WH_PERIOD * 0.0625) - 0.5;
  float wn2 = whNoise(wq * 2.0 + vec3(3.1, 7.7, 0.0), WH_PERIOD * 0.125) - 0.5;
  ang += turbulence * (wn * 1.6 + wn2 * 0.6);
  float rr = 5.5 + u * 1.5;
  vec3 p = vec3(cos(ang) * rr, sin(ang) * rr, zs * 0.5 + turbulence * wn * 2.0);
  float per = WH_PERIOD * 0.5;
  float a = 0.0;
  float b = 0.5;
  float n0 = 0.0;
  int octaves = max(int(ceil(detail)), 1);
  for (int i = 0; i < 7; i++) {
    if (i >= octaves) break;
    float n = whNoise(p, per);
    if (i == 0) n0 = n;
    // Ridges: filaments.
    n = 1.0 - abs(2.0 * n - 1.0);
    n = n * n * n;
    if (i == octaves - 1) n = mix(0.28, n, clamp(detail - float(i), 0.0, 1.0));
    a += b * n;
    p.xy = mat2(0.8, -0.6, 0.6, 0.8) * p.xy * 2.0;
    p.z *= 2.0;
    p += vec3(1.7, 9.2, 3.0);
    per *= 2.0;
    b *= 0.5;
  }
  // The octaves too fine for this pixel, as their average: far off the plasma blurs rather than thins out.
  a += 2.0 * b * 0.28;
  float d = smoothstep(0.4 + 0.12 * whWarp, 0.9, a * (0.4 + 1.2 * n0));
  // Where even its broadest filaments are finer than the pixel (far down the throat, grazing), their average.
  return mix(0.16, d, clamp(detail, 0.0, 1.0)) * (1.0 - u * u);
}

// Streaks of stars (or sparks) on a few cylinders round the lens: cells of angle and depth, each maybe a star,
// drawn as a segment along the flight as long as the speed.
vec3 whStreaks(vec3 rd, float pxA, float rmin, float rmax, float density, float len, vec3 tint, float seed) {
  vec3 l = vec3(dot(rd, camRight), dot(rd, camUp), dot(rd, camFwd));
  float lr = max(length(l.xy), 1e-4);
  float phi = fract((atan(l.y, l.x) + whRoll) / WH_TAU);
  vec3 col = vec3(0.0);
  const float CELL = 3.0;
  for (int layer = 0; layer < 4; layer++) {
    float rho = mix(rmin, rmax, (float(layer) + 0.5) / 4.0);
    float tc = rho / lr;
    float d = l.z * tc;
    if (d < 0.3 || d > 60.0) continue;
    float zw = d + whTravel;
    float n = floor(rho * 7.0);
    float fs = phi * n;
    float sector = floor(fs);
    float fa = fs - sector;
    float pw = max(pxA * tc, 0.004);
    for (int k = 0; k < 7; k++) {
      float cz = floor(zw / CELL) - float(k);
      if (float(k - 1) * CELL > len) break;
      float cm = mod(cz, WH_PERIOD / CELL);
      vec3 h = hash33(vec3(sector + seed * 13.0, cm, float(layer) + seed));
      if (h.x > density) continue;
      float sz = (cz + h.y) * CELL;
      float da = (fa - (0.2 + 0.6 * h.z)) * WH_TAU / n * rho;
      float dz = zw - sz;
      float along = dz < 0.0 ? -dz : max(dz - len, 0.0);
      // Foreshortened along the flight.
      along *= lr;
      float r2 = (da * da + along * along) / (pw * pw * 0.5);
      float b = hash13(vec3(sector, cm, 5.0 + seed));
      // Fading in from the far end, the head brightest.
      float fade = smoothstep(16.0, 5.0, d) * smoothstep(0.8, 3.5, d);
      float head = exp(-max(dz, 0.0) / max(len * 0.4, 1e-3));
      col += tint * (0.12 + b * b * b * 2.5) * fade * (head * exp(-r2) + 0.04 * b * exp(-(da * da + dz * dz * lr * lr) / (pw * pw * 30.0)));
    }
  }
  return col;
}

// A bolt of lightning on the inner skin at (angle a, depth z): its glow.
float whBolt(vec4 A, vec4 B, float a, float z, float rin, float pw) {
  if (A.w <= 0.0) return 0.0;
  float s = (z - A.y) / A.z;
  if (s < -0.02 || s > B.y + 0.02) return 0.0;
  float dz = z - A.y;
  float jag = (vnoise2d(vec2(dz * 1.1, B.x)).x - 0.5) * 0.5 + (vnoise2d(vec2(dz * 4.3, B.x + 7.0)).x - 0.5) * 0.18 + (vnoise2d(vec2(dz * 13.0, B.x + 3.0)).x - 0.5) * 0.06;
  float line = A.x - dz * whTwist + jag;
  float da = abs(mod(a - line + WH_PI, WH_TAU) - WH_PI) * rin;
  float ends = smoothstep(-0.02, 0.04, s) * smoothstep(B.y + 0.02, B.y - 0.08, s);
  float w = max(0.012, pw);
  float g = exp(-da * da / (w * w)) * 2.0 + 0.05 / (da + 0.05) * 0.5;
  // A branch splits off part-way and wanders away.
  if (s > 0.35 && s < min(0.75, B.y)) {
    float bs = (s - 0.35) / 0.4;
    float bline = line + B.z * bs * 0.9 + (vnoise2d(vec2(dz * 3.1, B.x + 11.0)).x - 0.5) * 0.25 * bs;
    float db = abs(mod(a - bline + WH_PI, WH_TAU) - WH_PI) * rin;
    float bw = w * (1.0 - 0.6 * bs);
    g += (exp(-db * db / (bw * bw)) * 1.4 + 0.03 / (db + 0.05) * 0.4) * (1.0 - bs);
  }
  return g * ends * A.w;
}

// How near a bolt a point of the shell is (its line without the jag): the light it throws on the plasma.
float whZap(vec4 A, vec4 B, float a, float z, float r) {
  if (A.w <= 0.0) return 0.0;
  float dz = z - A.y;
  float outside = max(max(-dz, dz - A.z * B.y), 0.0);
  float da = abs(mod(a - (A.x - dz * whTwist) + WH_PI, WH_TAU) - WH_PI) * r;
  return A.w * exp(-(da * da + outside * outside) * 2.5);
}

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  float pxA = 2.0 * camLens / min(resolution.x, resolution.y);
  float R = whR;
  float W = R * 0.3;
  float rin = R - W;
  float rout = R + W;
  float lat = length(rd.xy) + 0.38 * abs(rd.z) + 1e-3;
  float tmax = 140.0;
  vec3 col = vec3(0.0);

  // Stars streaking past inside the tube, and sparks off its inner skin on the highs.
  col += whStreaks(rd, pxA, 0.9, rin * 0.88, min(0.45 * stars, 0.9), whStreak, vec3(0.85, 0.92, 1.0), 0.0) * stars;
  col += whStreaks(rd, pxA, rin * 0.9, rin * 0.98, 0.05 + 0.5 * whSpark * whSpark, whStreak * 0.25, whPalette(0.6) * 1.5, 1.0) * (0.5 + 2.5 * whSpark);

  // Across the tube's hollow to its inner skin: nothing to see there, so straight there.
  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 48; i++) {
    vec3 p = ro + rd * t;
    float g = rin - length(p.xy - whPath(p.z));
    if (g < 0.02) { hit = true; break; }
    if (t > tmax) break;
    t += max(g / lat, 0.05);
  }

  float T = 1.0;
  vec3 boltGlow = vec3(0.0);
  if (hit) {
    vec3 hp = ro + rd * t;
    vec2 q = hp.xy - whPath(hp.z);
    float a = atan(q.y, q.x);
    float pw = pxA * t;
    float b = whBolt(whBoltA0, whBoltB0, a, hp.z, rin, pw) + whBolt(whBoltA1, whBoltB1, a, hp.z, rin, pw) + whBolt(whBoltA2, whBoltB2, a, hp.z, rin, pw) + whBolt(whBoltA3, whBoltB3, a, hp.z, rin, pw);
    boltGlow = vec3(0.75, 0.7, 1.0) * b * 1.6 * lightning;
  }
  {
    // Through the shell, front to back, in slices: thin cylinders from its inner skin out, each met where the ray
    // crosses it, its plasma seen at the detail its pixel holds.
    int slices = int(mix(4.0, 10.0, quality));
    float glow = (0.6 + 1.2 * whGlow) * (1.0 + 0.4 * whWarp + 0.8 * whFlash);
    for (int k = 0; k < 10; k++) {
      if (k >= slices || T < 0.02 || t > tmax) break;
      float fk = (float(k) + 0.5) / float(slices);
      float rk = mix(rin, rout, fk);
      vec3 p;
      vec2 q;
      float r;
      float drdt = 1.0;
      // Towards it no faster than the ray can move away from the axis, so never past it: smooth from pixel to
      // pixel even where the ray grazes it.
      for (int it = 0; it < 6; it++) {
        p = ro + rd * t;
        q = p.xy - whPath(p.z);
        r = length(q);
        if (r > rk - 0.01) break;
        t += (rk - r) / lat;
      }
      drdt = dot(q, rd.xy - whPathD(p.z) * rd.z) / max(r, 1e-4);
      if (t > tmax) break;
      p = ro + rd * t;
      q = p.xy - whPath(p.z);
      // How long the ray is in this slice, and how big its pixel is there (grazing, it smears along the flight).
      float slab = min((rout - rin) / float(slices) / max(drdt, 0.05), 6.0);
      float pw = pxA * t * (1.0 + 0.8 / max(drdt, 0.05));
      float detail = clamp(log2(0.3 / pw), 0.0, mix(4.0, 6.0, quality));
      float u = fk * 2.0 - 1.0;
      float ang = atan(q.y, q.x);
      float d = whPlasma(ang, p.z, u, detail);
      if (d > 0.001) {
        // The rim's light is the spectrum: round the tube by angle (mirrored), heard later the further off.
        vec2 sq = vec2(dot(vec3(q, 0.0), camRight), dot(vec3(q, 0.0), camUp));
        float band = abs(atan(sq.x, -sq.y)) / WH_PI;
        float s = spectrumAgo(mix(0.08, 0.85, band), (p.z - whTravel) / 12.0);
        float eq = 0.25 + 2.4 * s * s * s;
        float hot = 1.0 - fk;
        // Further down the throat, hotter and brighter: the tube converges on its light.
        float throat = smoothstep(6.0, 45.0, t);
        float heat = 0.05 + 0.55 * hot + 0.45 * d * d + 0.35 * throat + 0.22 * sin(ang + p.z * (WH_TAU * 12.0 / WH_PERIOD) + whHue) * sin(p.z * (WH_TAU * 8.0 / WH_PERIOD) - whHue * 0.7);
        vec3 c = whPalette(heat) * (0.4 + 1.0 * hot);
        float sigma = d * 4.0;
        vec3 emit = c * d * d * glow * eq * 4.0 * (1.0 + 2.0 * throat);
        // The bolts light the plasma round them.
        float zap = whZap(whBoltA0, whBoltB0, ang, p.z, rk) + whZap(whBoltA1, whBoltB1, ang, p.z, rk) + whZap(whBoltA2, whBoltB2, ang, p.z, rk) + whZap(whBoltA3, whBoltB3, ang, p.z, rk);
        emit += mix(vec3(0.7, 0.65, 1.0), whPalette(0.9), 0.4) * d * zap * 1.4 * lightning;
        float a = exp(-sigma * slab);
        col += T * emit * (1.0 - a) / max(sigma, 1e-4);
        T *= a;
      }
    }
  }
  col += boltGlow;
  // The far end: a light down the tube that pulls the eye.
  float c = max(dot(rd, whFar), 0.0);
  vec3 far = (vec3(1.0) * pow(c, 3000.0) * 8.0 + whPalette(0.75) * pow(c, 150.0) * 1.5 + whPalette(0.45) * pow(c, 25.0) * 0.2) * (0.6 + 0.8 * whGlow + 2.0 * whWarp);
  col += far * (0.25 + 0.75 * T);
  col += whPalette(0.8) * whFlash * (0.04 + 2.0 * pow(c, 6.0));
  return col;
}
`,
  init: () => ({
    time: 0,
    z: 0,
    speed: 6,
    roll: 0,
    spin: 0,
    hue: 0,
    glow: 0.5,
    radius: RADIUS,
    spark: 0,
    jumpAge: 100,
    hitsSince: 0,
    quiet: 0,
    shakeAge: 100,
    shakeAmp: 0,
    shakeDir: 0,
    bolts: [],
    rng: { seed: 0x77a1e5 },
  }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    const twist = twistOf(num(frame.values, "twist", 1));
    s.time += dt;
    s.jumpAge += dt;
    s.shakeAge += dt;
    const warp = warpAt(s.jumpAge);
    s.speed = smoothTo(s.speed, (5 + 5 * a.bass + 3 * a.punch) * (1 + 3.5 * warp), frame.dt, 0.4);
    s.z += s.speed * dt;
    s.spin = (s.spin + dt * (0.25 + 0.6 * a.level + 1.5 * warp)) % TAU;
    s.hue = (s.hue + dt * 0.15) % TAU;
    s.glow = smoothTo(s.glow, a.level, frame.dt, 0.12);
    s.spark = smoothTo(s.spark, a.high, frame.dt, 0.15);
    s.radius = smoothTo(s.radius, RADIUS * (1 + 0.12 * a.punch), frame.dt, 0.06);
    // Rolling with the twist (part of it: the spiral still turns), and a slow sway.
    s.roll = (s.roll + s.speed * dt * twist * 0.35) % TAU;
    for (const b of s.bolts) b.age += frame.dt;
    s.bolts = s.bolts.filter((b) => b.age < 0.5);
    // A quiet stretch, then a level that jumps: a drop. Else every few bars of hits.
    s.quiet = a.level < 0.15 ? s.quiet + frame.dt : a.level > 0.4 ? 0 : s.quiet;
    const drop = s.quiet > 1.5 && a.level > 0.4;
    if (a.onBeat) {
      s.hitsSince += 1;
      const power = 0.6 + 0.6 * clamp01(frame.hit);
      s.shakeAge = 0;
      s.shakeAmp = 0.05 + 0.08 * clamp01(frame.hit);
      s.shakeDir = random(s.rng) * TAU;
      s.bolts.push({
        a: random(s.rng) * TAU,
        z: s.z + 2 + random(s.rng) * 10,
        len: 6 + random(s.rng) * 10,
        age: 0,
        power,
        seed: random(s.rng) * 100,
      });
      if (s.bolts.length > BOLTS) s.bolts.shift();
    }
    const every = jumpHits(frame.values.jumps);
    if (every !== null && ((every > 0 && a.onBeat && s.hitsSince >= every && s.jumpAge > 4) || (drop && s.jumpAge > 2))) {
      s.jumpAge = 0;
      s.hitsSince = 0;
      s.quiet = 0;
    }
    // The world repeats every PERIOD: wrap the camera and what's about it together.
    if (s.z >= PERIOD) {
      s.z -= PERIOD;
      for (const b of s.bolts) b.z -= PERIOD;
    }
  },
  uniforms(s, frame) {
    const warp = warpAt(s.jumpAge);
    const shake = s.shakeAmp * Math.exp(-s.shakeAge / 0.12) * Math.sin(s.shakeAge * 38);
    const weave = [0.35 * Math.sin(s.time * 0.31), 0.28 * Math.sin(s.time * 0.23 + 1)];
    const [px, py] = pathXY(s.z);
    const pos: Vec3 = [px + weave[0] + shake * Math.cos(s.shakeDir), py + weave[1] + shake * Math.sin(s.shakeDir), s.z];
    const ahead = pathAt(s.z + 6);
    const fwd = normalize(sub([ahead[0] + weave[0] * 0.5, ahead[1] + weave[1] * 0.5, ahead[2]], pos));
    const farDir = normalize(sub(throatOf(pos, s.z, s.radius * 0.62), pos));
    const twist = twistOf(num(frame.values, "twist", 1));
    return [
      ...cameraLooking(pos, fwd, s.roll, 82 + 28 * warp),
      ...soundUniforms(frame),
      float("whR", s.radius),
      float("whTwist", twist),
      float("whSpin", s.spin),
      float("whHue", s.hue),
      float("whGlow", s.glow),
      float("whWarp", warp),
      float("whFlash", flashAt(s.jumpAge)),
      float("whStreak", 0.15 * s.speed + 14 * warp),
      float("whTravel", s.z),
      float("whRoll", s.roll),
      float("whSpark", s.spark),
      vec3("whFar", farDir),
      ...Array.from({ length: BOLTS }, (_, i) => {
        const b = s.bolts[i];
        return vec4(`whBoltA${i}`, b ? [b.a, b.z, b.len, boltLight(b.age) * b.power] : [0, 0, 1, 0]);
      }),
      ...Array.from({ length: BOLTS }, (_, i) => {
        const b = s.bolts[i];
        const reach = b ? Math.min(1, b.age / 0.06) : 0;
        const side = b ? (b.seed % 2 < 1 ? 1 : -1) : 1;
        return vec4(`whBoltB${i}`, b ? [b.seed, reach, side, 0] : [0, 0, 1, 0]);
      }),
    ];
  },
};
