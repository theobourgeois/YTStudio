/**
 * Monoliths (docs/visualizer/scenes.md, "Five more"): a forest of tall polished obelisks under a vast dusk sky,
 * rising and falling with the music, an equaliser the size of a landscape. The field is a grid of slender pillars,
 * one a cell, traversed cell by cell (a DDA under a bounding top plane: exact, and cheap); each stands as high as its
 * band of the spectrum (the frequency across the field, mirrored about the camera's path and repeating: the bass
 * stands tallest either side of an aisle along the path, a canyon the camera can fly down), heard later the further
 * it stands from the camera (the sound spreads outwards), plus the kicks' rings. Their faces mirror the sunset and
 * each other (a second DDA), the low sun casts long soft shadows (a third), and past the march's reach the field goes
 * on as coarse silhouettes, layer behind layer into the haze.
 * Stepped: how far it's glided along the path (a speed on the bass), whether it's down in the canyon or over the
 * tops (and now and then risen high to show the patterns), its turn and bank, and the rings: each kick sends one
 * out from where the camera is (faster when it's risen), several at once, lifting the pillars as it passes and
 * washing up them as light, brightest at their crowns.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraLooking, clamp01, float, normalize, num, sceneDt, smoothstep, smoothTo, soundUniforms, vec4 } from "./kit.ts";

const RINGS = 4;
/** The world repeats every this many cells along the path (the GLSL's `PERIOD`), so the camera's z can wrap. */
const PERIOD = 1024;
/** How fast a ring runs outwards (cells a second, more when risen), and where it starts. */
const RING_SPEED = 18;
const RING_START = 3;
/** Pillars whose centre is nearer the path than this (cells) aren't there: the aisle the camera flies down. */
const AISLE = 3.5;
/** The field's bands repeat across it every two of these (cells): the bass beside the aisle, the highs this far out. */
const BAND_WIDTH = 14;
/** Where along the spectrum the bands run (0 is 20 Hz, 1 is 20 kHz): from the kick's low end to the hats. */
const LOW = 0.12;
const HIGH = 0.85;

const TAU = Math.PI * 2;
/** Where the path runs: its x at z (periodic in `PERIOD`, as the GLSL's). */
const pathX = (z: number) => 16 * Math.sin((z * TAU * 3) / PERIOD) + 7 * Math.sin((z * TAU * 7) / PERIOD + 1.3);
const pathSlope = (z: number) =>
  ((16 * TAU * 3) / PERIOD) * Math.cos((z * TAU * 3) / PERIOD) + ((7 * TAU * 7) / PERIOD) * Math.cos((z * TAU * 7) / PERIOD + 1.3);

/** The spectrum's position (0..1, low to high) a pillar `u` cells from the path hears (the GLSL's `bandOf`). */
const bandOf = (u: number) => LOW + (HIGH - LOW) * (0.5 - 0.5 * Math.cos((Math.max(u - AISLE, 0) / BAND_WIDTH) * Math.PI));

const KA = (TAU * 18) / PERIOD;
const KB = (TAU * 11) / PERIOD;
/** The field's slow swells (0..1) at (x, z) at `time`: the GLSL's `swell`, so the field rolls like dunes. */
const swell = (x: number, z: number, time: number) =>
  0.5 + 0.5 * Math.sin(x * 0.09 + 1.3 * Math.sin(z * KB + x * 0.025) + time * 0.1) * Math.sin(z * KA + 0.9 * Math.sin(x * 0.05));

/** A pillar's height at `level` (0..1) of its band, with its jitter `j` (0..1) and the swell: the GLSL's `pillarHeight`. */
const standing = (level: number, height: number, rolling: number, j: number) => height * ((0.8 + 20 * level ** 2.5) * (0.9 + 0.2 * j) + 2 * rolling);

/** The level (0..1) of the spectrum's band at `x` along it, from a frame's 32 bands. */
const levelAt = (bands: number[], x: number) => {
  const f = Math.min(30.999, Math.max(0, x * 31));
  const i = Math.floor(f);
  return bands[i] + (bands[i + 1] - bands[i]) * (f - i);
};

interface Ring {
  x: number;
  z: number;
  age: number;
  /** How far out it's run (cells): faster when the camera's high, so a risen camera still sees them. */
  radius: number;
  power: number;
}

interface MonolithState {
  time: number;
  /** How far along the path (cells, never wrapped here), and how fast. */
  z: number;
  speed: number;
  /** The look's turn off the path (radians), and how far it's turned to look across the field (when it's risen). */
  turn: number;
  across: number;
  /** Down in the canyon (0) or over the tops (1); how far it's risen above that; its height. */
  over: number;
  rise: number;
  y: number;
  /** How tall the canyon's walls stand, lately (slow). */
  wall: number;
  roll: number;
  /** The heading last frame, for the bank. */
  heading: number;
  /** How loud it's been lately (slow): the horizon's light. */
  glow: number;
  rings: Ring[];
}

export const MONOLITHS: SceneSpec<MonolithState> = {
  type: "monoliths",
  label: "Monoliths",
  params: [
    {
      kind: "choice",
      key: "style",
      label: "Style",
      default: "obsidian",
      options: [
        { value: "obsidian", label: "Obsidian" },
        { value: "marble", label: "Marble" },
        { value: "synth", label: "Synth" },
      ],
    },
    { kind: "number", key: "height", label: "Height", default: 1, min: 0.3, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "spacing", label: "Spacing", default: 1, min: 0.2, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  audio: () => ({ rows: 40, span: 2.4, fall: 0.2, window: 0 }),
  glsl: /* glsl */ `
uniform float moTime;
uniform float moTop;
uniform float moGlow;
uniform vec4 moRing0;
uniform vec4 moRing1;
uniform vec4 moRing2;
uniform vec4 moRing3;

const float PERIOD = ${PERIOD.toFixed(1)};
const float BANDW = ${BAND_WIDTH.toFixed(1)};
const float AISLE = ${AISLE.toFixed(1)};

float pathX(float z) {
  float k = 6.2831853 / PERIOD;
  return 16.0 * sin(z * k * 3.0) + 7.0 * sin(z * k * 7.0 + 1.3);
}
float bandOf(float u) { return ${LOW} + ${(HIGH - LOW).toFixed(3)} * (0.5 - 0.5 * cos(max(u - AISLE, 0.0) / BANDW * PI)); }
float swell(vec2 c) {
  float ka = 6.2831853 * 18.0 / PERIOD;
  float kb = 6.2831853 * 11.0 / PERIOD;
  return 0.5 + 0.5 * sin(c.x * 0.09 + 1.3 * sin(c.y * kb + c.x * 0.025) + moTime * 0.1) * sin(c.y * ka + 0.9 * sin(c.x * 0.05));
}
float halfWidth() { return 0.5 - clamp(0.2 * spacing, 0.03, 0.42); }
vec3 sunDir() {
  if (style == 1) return normalize(vec3(0.42, 0.1, 0.9));
  return normalize(vec3(0.0, style == 2 ? 0.06 : 0.07, 1.0));
}

// A ring at a point: how far it lifts the pillars (a soft crest) and how bright the wave of light washing over them
// is there (broader, and only once it's well clear of the camera, so the nearest never fills the frame).
vec2 ringAt(vec2 c, vec4 r) {
  if (r.w <= 0.0) return vec2(0.0);
  float d = length(c - r.xy) - r.z;
  return r.w * vec2(exp(-d * d * 0.06), exp(-d * d * 0.35) * smoothstep(6.0, 22.0, r.z));
}
vec2 rings(vec2 c) { return ringAt(c, moRing0) + ringAt(c, moRing1) + ringAt(c, moRing2) + ringAt(c, moRing3); }

// The pillar in cell c (its corner): how tall (0: none, the aisle), and how loud its band is (for its light).
float pillarHeight(vec2 cell, out float loud) {
  vec2 c = cell + 0.5;
  float u = abs(c.x - pathX(c.y));
  loud = 0.0;
  if (u < AISLE) return 0.0;
  // Further from the camera, it's heard later: the sound spreads out over the field.
  float ago = length(c - camPos.xz) / 22.0;
  float s = spectrumAgo(bandOf(u), ago);
  float j = hash12(mod(cell, PERIOD));
  float ring = rings(c).x;
  float level = pow(s, 2.5);
  loud = min(1.0, level + ring * 0.5);
  return height * ((0.8 + 20.0 * level) * (0.9 + 0.2 * j) + 2.0 * swell(c) + 3.0 * ring);
}

// A ray through the grid: the first pillar it hits (t, and the face's normal), or the floor, before tmax.
// t is -1 if it leaves through the top plane, -2 if it runs out of steps or distance; \`reached\` is how far it got.
struct Hit { float t; vec3 n; vec2 cell; float h; float loud; float fogT; };
Hit traceField(vec3 ro, vec3 rd, float tmax, int steps, out float reached) {
  Hit hit;
  hit.t = -1.0;
  hit.fogT = 0.0;
  reached = tmax;
  float t = 0.0;
  if (ro.y > moTop) {
    if (rd.y >= 0.0) { reached = 0.0; return hit; }
    t = (ro.y - moTop) / -rd.y;
  }
  vec3 p = ro + rd * t;
  vec2 cell = floor(p.xz);
  vec2 dir = sign(rd.xz);
  vec2 rdxz = abs(rd.xz) + 1e-6;
  vec2 tDelta = 1.0 / rdxz;
  vec2 tNext = t + (vec2(dir.x > 0.0 ? cell.x + 1.0 - p.x : p.x - cell.x, dir.y > 0.0 ? cell.y + 1.0 - p.z : p.z - cell.y)) / rdxz;
  float w = halfWidth();
  vec3 inv = 1.0 / rd;
  for (int i = 0; i < 400; i++) {
    if (i >= steps || t > tmax) break;
    float loud;
    float h = pillarHeight(cell, loud);
    if (h > 0.0) {
      // The box in this cell: x/z within w of its centre, y from 0 to h.
      vec3 t0 = (vec3(cell.x + 0.5 - w, 0.0, cell.y + 0.5 - w) - ro) * inv;
      vec3 t1 = (vec3(cell.x + 0.5 + w, h, cell.y + 0.5 + w) - ro) * inv;
      vec3 tn = min(t0, t1);
      vec3 tf = max(t0, t1);
      float tin = max(max(tn.x, tn.y), tn.z);
      float tout = min(min(tf.x, tf.y), tf.z);
      if (tin <= tout && tout > 0.0) {
        hit.t = max(tin, 0.0);
        hit.n = tin == tn.x ? vec3(-sign(rd.x), 0.0, 0.0) : tin == tn.y ? vec3(0.0, -sign(rd.y), 0.0) : vec3(0.0, 0.0, -sign(rd.z));
        hit.cell = cell;
        hit.h = h;
        hit.loud = loud;
        hit.fogT = hit.t;
        return hit;
      }
    }
    float tExit = min(tNext.x, tNext.y);
    // The floor between the pillars.
    if (rd.y < 0.0 && ro.y + rd.y * tExit < 0.0) {
      hit.t = -ro.y / rd.y;
      hit.n = vec3(0.0, 1.0, 0.0);
      hit.cell = cell;
      hit.h = 0.0;
      hit.loud = 0.0;
      // (Hazed as far as the gap's mouth: the haze down a crevice would light it up as a line.)
      hit.fogT = max(t, hit.t - 6.0);
      return hit;
    }
    // Leaving through the top plane: nothing more to hit.
    if (rd.y > 0.0 && ro.y + rd.y * tExit > moTop) { reached = tExit; return hit; }
    t = tExit;
    if (tNext.x < tNext.y) { tNext.x += tDelta.x; cell.x += dir.x; }
    else { tNext.y += tDelta.y; cell.y += dir.y; }
  }
  reached = t;
  hit.t = -2.0;
  return hit;
}

// How much of the sun a point sees: a ray through the grid towards it, softened by how near it runs over the tops.
float sunShadow(vec3 ro, vec3 l, int steps) {
  vec2 cell = floor(ro.xz);
  vec2 dir = sign(l.xz);
  vec2 rdxz = abs(l.xz) + 1e-6;
  vec2 tDelta = 1.0 / rdxz;
  vec2 tNext = (vec2(dir.x > 0.0 ? cell.x + 1.0 - ro.x : ro.x - cell.x, dir.y > 0.0 ? cell.y + 1.0 - ro.z : ro.z - cell.y)) / rdxz;
  float res = 1.0;
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    float t = min(tNext.x, tNext.y);
    if (tNext.x < tNext.y) { tNext.x += tDelta.x; cell.x += dir.x; }
    else { tNext.y += tDelta.y; cell.y += dir.y; }
    float y = ro.y + l.y * t;
    if (y > moTop) break;
    float loud;
    float h = pillarHeight(cell, loud);
    res = min(res, clamp((y - h) * 3.0 / (0.6 + t * 0.15) + 0.5, 0.0, 1.0));
    if (res <= 0.0) break;
  }
  return res;
}

// Past the march's reach: the field sampled in growing steps (missing a pillar or two, which is invisible that far),
// so the distance is layer behind layer of silhouettes rather than a band of haze. The t it hits, or -1.
float farField(vec3 ro, vec3 rd, float t0, int steps, out bool ground, out vec2 cell, out float loudness) {
  ground = false;
  loudness = 0.0;
  float t = t0;
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    t += max(1.5, t * 0.035);
    vec3 p = ro + rd * t;
    if (p.y > moTop && rd.y >= 0.0) return -1.0;
    float loud;
    cell = floor(p.xz);
    float h = pillarHeight(cell, loud);
    loudness = loud;
    if (p.y < h) return t;
    // (The aisle's floor, far off: polished, it mirrors the horizon; drawn dark, it would arch over the aisle.)
    if (p.y < 0.0) { ground = true; return t; }
  }
  return -1.0;
}

vec3 skyColor(vec3 rd, bool withSun) {
  vec3 l = sunDir();
  float y = rd.y;
  float sd = max(dot(rd, l), 0.0);
  // Four stops from the horizon up (the horizon's light, a rose band, violet, the night coming), and the side away
  // from the sun dimmer and cooler, as a real dusk is.
  vec3 horizon;
  vec3 band;
  vec3 mid;
  vec3 zenith;
  vec3 away;
  if (style == 1) {
    horizon = vec3(1.25, 0.66, 0.34);
    band = vec3(0.8, 0.45, 0.4);
    mid = vec3(0.32, 0.3, 0.48);
    zenith = vec3(0.08, 0.12, 0.27);
    away = vec3(0.5, 0.38, 0.45);
  } else if (style == 2) {
    horizon = vec3(1.6, 0.22, 0.55);
    band = vec3(0.5, 0.03, 0.38);
    mid = vec3(0.07, 0.015, 0.18);
    zenith = vec3(0.004, 0.004, 0.035);
    away = vec3(0.32, 0.04, 0.32);
  } else {
    horizon = vec3(1.15, 0.42, 0.13);
    band = vec3(0.5, 0.16, 0.2);
    mid = vec3(0.1, 0.07, 0.18);
    zenith = vec3(0.012, 0.024, 0.075);
    away = vec3(0.32, 0.16, 0.26);
  }
  float hy = max(y, 0.0);
  float toSun = pow(dot(normalize(vec3(rd.x, 0.0, rd.z) + 1e-5), normalize(vec3(l.x, 0.0, l.z))) * 0.5 + 0.5, 2.0);
  horizon = mix(away, horizon, toSun);
  vec3 col = mix(horizon, band, smoothstep(0.0, 0.14, hy));
  col = mix(col, mid, smoothstep(0.06, 0.25, hy));
  col = mix(col, zenith, smoothstep(0.2, 0.7, hy));
  // The horizon's light: brighter with the level, and round the sun.
  col += horizon * (0.12 + 0.55 * moGlow) * exp(-abs(y) * 22.0) * (0.3 + 1.2 * pow(sd, 4.0));
  col += (style == 2 ? vec3(1.4, 0.2, 0.7) : vec3(1.4, 0.55, 0.2)) * (pow(sd, 18.0) * 0.45 + pow(sd, 300.0) * (style == 2 ? 0.3 : 1.6));
  if (withSun) {
    if (style == 2) {
      // A synthwave sun: striped below its middle.
      float a = acos(clamp(dot(rd, l), -1.0, 1.0));
      float disc = smoothstep(0.105, 0.1, a);
      float v = (rd.y - l.y) / 0.1;
      float stripes = v < 0.55 ? step(0.32 - 0.5 * v, fract(v * 6.0 + moTime * 0.5)) : 1.0;
      col = mix(col, mix(vec3(4.0, 0.35, 1.4), vec3(4.5, 2.6, 0.5), smoothstep(-0.6, 0.9, v)), disc * stripes);
      col *= 1.0 - disc * (1.0 - stripes) * 0.6;
    } else {
      col += vec3(16.0, 6.0, 1.6) * smoothstep(0.99915, 0.9995, sd);
    }
  }
  // Long thin clouds lit from below by the sun.
  if (y > 0.0) {
    vec2 q = rd.xz / (y + 0.06) * vec2(0.35, 1.2) + vec2(moTime * 0.01, 0.0);
    float c = smoothstep(0.5, 0.85, fbm3(vec3(q, 0.3), 4)) * smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.25, 0.6, y));
    vec3 cloudLit = style == 1 ? vec3(1.3, 0.75, 0.55) : style == 2 ? vec3(0.7, 0.08, 0.5) : vec3(1.6, 0.6, 0.3);
    col = mix(col, cloudLit * (0.3 + 0.9 * pow(sd, 4.0)), c * (style == 2 ? 0.3 : 0.6));
  }
  // Stars, faint, high up.
  vec3 sc = floor(rd * 400.0);
  col += vec3(0.6, 0.7, 1.0) * step(0.997, hash13(sc)) * pow(hash13(sc + 2.7), 6.0) * smoothstep(0.25, 0.7, y) * 1.5;
  return col;
}
// The pillars' stuff: albedo (for the diffuse).
vec3 albedoAt(vec3 p) {
  if (style == 1) {
    // Travertine-pale stone, thin grey veins drifting through it, each pillar a different cut.
    vec3 q = p * vec3(0.9, 0.3, 0.9);
    float vein = abs(fbm3(q * 1.4 + 3.1, 5) - 0.5);
    float v = smoothstep(0.0, 0.018, vein);
    float cloud = fbm3(p * 2.3, 3);
    return mix(vec3(0.3, 0.28, 0.27), vec3(0.56, 0.5, 0.43) * (0.9 + 0.2 * cloud), 0.35 + 0.65 * v);
  }
  if (style == 2) return vec3(0.006, 0.004, 0.01);
  return vec3(0.018, 0.017, 0.02);
}
vec3 edgeColor(float band) {
  if (style == 2) return mix(vec3(0.1, 0.9, 2.6), vec3(2.8, 0.2, 1.5), smoothstep(0.45, 0.85, band));
  if (style == 1) return vec3(2.2, 1.5, 0.95);
  return vec3(2.8, 1.25, 0.5);
}
vec3 sunColor() {
  if (style == 2) return vec3(2.4, 0.7, 1.5);
  if (style == 1) return vec3(3.0, 2.1, 1.5);
  return vec3(3.6, 1.8, 0.8);
}

// The haze: the sky's own colour at the horizon in that direction, so the field melts into it.
vec3 hazeColor(vec3 rd) {
  return skyColor(normalize(vec3(rd.x, 0.015, rd.z)), false) * (style == 2 ? 0.5 : 0.8);
}
// Haze that thins with height (the integral of exp(-y / H) along the ray), clear close by: the field fades layer by
// layer into the horizon's light, and from high up the patterns show.
float fog(vec3 ro, vec3 rd, float t) {
  float b = 1.0 / 12.0;
  // (Thinner seen from high up: risen, the patterns should be clear.)
  float a = 0.0034 * (0.85 + 0.3 * moGlow) * mix(1.0, 0.15, smoothstep(14.0, 40.0, camPos.y));
  float k = rd.y * b;
  float along = abs(k) < 1e-4 ? t : (1.0 - exp(-k * t)) / k;
  float near = 1.0 - exp(-t * t / 900.0);
  return 1.0 - exp(-a * exp(-ro.y * b) * along * near);
}
// Crepuscular rays: the light in the haze round the sun, broken into streaks by the pillars between.
vec3 sunRays(vec3 rd) {
  vec3 l = sunDir();
  float sd = max(dot(rd, l), 0.0);
  vec3 a = normalize(cross(l, vec3(0.0, 1.0, 0.0)));
  vec3 b = cross(a, l);
  float ang = atan(dot(rd, b), dot(rd, a));
  float streak = smoothstep(0.3, 0.85, vnoise3(vec3(ang * 14.0, moTime * 0.08, 0.0))) * smoothstep(0.2, 0.9, vnoise3(vec3(ang * 41.0, 3.0, moTime * 0.05)));
  return sunColor() * (pow(sd, 8.0) * 0.035 + pow(sd, 60.0) * 0.08) * streak;
}

vec3 ringColor() {
  if (style == 2) return vec3(0.25, 1.3, 2.8);
  if (style == 1) return vec3(2.4, 1.6, 1.0);
  return vec3(2.8, 1.4, 0.55);
}

// What a face seen in a reflection looks like: lit by the sun and the sky, its crown, and the sky it mirrors if it
// looks up (no further bounce: down, it would see the dark floor).
vec3 shadeSimple(vec3 p, Hit h, vec3 rd) {
  // The polished floor, seen in a face: the sky it mirrors (a face just below eye level shows it, not black).
  if (h.h <= 0.0) return skyColor(reflect(rd, vec3(0.0, 1.0, 0.0)), false) * (0.1 + 0.9 * pow(1.0 - abs(rd.y), 5.0)) * (style == 1 ? 0.3 : 0.85) + ringColor() * rings(p.xz).y * 0.04;
  vec3 col = albedoAt(p) * (sunColor() * max(dot(h.n, sunDir()), 0.0) * 0.5 + skyColor(vec3(0.0, 1.0, 0.0), false) * 0.5);
  vec3 r = reflect(rd, h.n);
  // (A ray just below level, bounced between mirrors, still runs far into the haze: no hard line at eye level.)
  float up = smoothstep(-0.15, 0.03, r.y);
  if (up > 0.0) col += skyColor(normalize(vec3(r.x, max(r.y, 0.0), r.z)), false) * up * (0.04 + 0.96 * pow(1.0 - clamp(dot(h.n, -rd), 0.0, 1.0), 5.0)) * (style == 1 ? 0.4 : 1.0);
  float crown = exp(-(h.h - p.y) * 6.0);
  col += ringColor() * rings(h.cell + 0.5).y * (0.006 + 0.3 * exp(-(h.h - p.y) * 0.7));
  return col + edgeColor(h.loud) * h.loud * h.loud * crown * 0.15;
}

// What it mirrors: the sky, or a pillar in the way (and a polished surface's blur towards the sky above it).
vec3 mirrored(vec3 p, vec3 n, vec3 r, int steps, float gloss) {
  float reached;
  Hit rh = traceField(p + n * 0.02, r, 60.0, steps, reached);
  vec3 refl;
  if (rh.t > 0.0) {
    vec3 rp = p + r * rh.t;
    refl = mix(shadeSimple(rp, rh, r), hazeColor(r), fog(p, r, rh.fogT));
  } else refl = r.y > 0.0 ? skyColor(r, true) : hazeColor(r) * mix(0.15, 0.9, smoothstep(-0.2, 0.0, r.y));
  if (r.y > 0.0) refl = mix(skyColor(normalize(r + vec3(0.0, 0.25, 0.0)), false) * 0.7, refl, gloss);
  return refl;
}

// The floor between the pillars and along the aisle: dark polished stone mirroring them, the rings' light running over it.
// The field's average colour seen along rd where pillars are smaller than pixels: looking down, mostly crowns (the
// sky they mirror, the light of the loud ones and of the rings, brighter risen); along, mostly dark faces.
vec3 fieldAverage(vec3 rd, float loud, float wash, float risen) {
  float w = halfWidth();
  float crowns = clamp(-rd.y * 1.6, 0.0, 1.0) * clamp(4.0 * w * w, 0.0, 1.0);
  float shine = mix(smoothstep(0.45, 1.0, loud), loud * loud * 1.6, risen);
  vec3 up = reflect(rd, vec3(0.0, 1.0, 0.0));
  vec3 lit = skyColor(up, false) * (0.04 + 0.96 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 5.0)) + edgeColor(loud) * shine * 0.3 + ringColor() * wash * (0.12 + risen * 1.1);
  return mix(hazeColor(rd) * mix(0.2, 0.03, risen) + ringColor() * wash * 0.05, lit, crowns);
}

// How far towards the field's average a point is drawn: by the pixel's size there against the pillars' spacing,
// along the grid's lines (looking down an aisle, a wall's faces crowd together long before its pillars are small).
float farness(float t, vec3 rd, float top) {
  float pix = t * camLens * 2.0 / min(resolution.x, resolution.y);
  float along = pix / max(min(abs(rd.x), abs(rd.z)), 0.12);
  return max(smoothstep(0.08, 0.4, pix), top > 0.5 ? 0.0 : smoothstep(0.35, 1.0, along));
}

vec3 shadeFloor(vec3 ro, vec3 rd, vec3 p, int reflSteps) {
  vec3 n = vec3(0.0, 1.0, 0.0);
  float fres = 0.1 + 0.9 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 5.0);
  vec3 col = albedoAt(p) * (style == 1 ? skyColor(n, false) * 0.5 + hazeColor(sunDir()) * 0.35 : skyColor(n, false) * 0.3);
  col += mirrored(p, n, reflect(rd, n), reflSteps, style == 1 ? 0.5 : 0.85) * fres * (style == 1 ? 0.3 : 0.85);
  // Shut in between pillars, it sees little of anything.
  float u = abs(p.x - pathX(p.z));
  if (u > AISLE - 0.3) col = mix(col * 0.35, hazeColor(rd) * 0.26, farness(length(p - ro), rd, 0.0));
  // The ring's own ripple on it is faint: what shows is the walls it lights, mirrored.
  return col + ringColor() * rings(p.xz).y * 0.05;
}

vec3 shade(vec3 ro, vec3 rd, Hit hit, int reflSteps, int shadowSteps) {
  vec3 p = ro + rd * hit.t;
  if (hit.h <= 0.0) return shadeFloor(ro, rd, p, reflSteps);
  vec3 n = hit.n;
  vec3 l = sunDir();
  vec3 zen = skyColor(vec3(0.0, 1.0, 0.0), false);
  float w = halfWidth();
  // How big a pixel is there (cells): fine detail fades out before it can shimmer.
  float pix = hit.t * camLens * 2.0 / min(resolution.x, resolution.y);
  float lod = smoothstep(0.03, 0.2, pix);
  // A fine bevel round the top: the normal of a rounded box there, so the crown's edges catch the light.
  float rad = max(0.03, pix * 1.2);
  vec2 q = p.xz - (hit.cell + 0.5);
  float topDist = hit.h - p.y;
  vec3 inner = vec3(max(abs(q.x) - (w - rad), 0.0), max(rad - topDist, 0.0), max(abs(q.y) - (w - rad), 0.0));
  vec3 bn = n;
  if (inner.y > 0.0 || n.y > 0.5) bn = length(inner) > 1e-4 ? normalize(vec3(sign(q.x), 1.0, sign(q.y)) * inner) : n;
  float bevel = n.y > 0.5 ? smoothstep(w - rad, w, max(abs(q.x), abs(q.y))) : smoothstep(rad, 0.0, topDist);
  float top = n.y > 0.5 ? 1.0 : 0.0;
  // Occlusion between them: how far below the neighbour it faces, and how deep down.
  float loudN;
  float hn = top > 0.5 ? 0.0 : pillarHeight(hit.cell + n.xz, loudN);
  float gap = max(1.0 - 2.0 * w, 0.02);
  float occl = top > 0.5 ? 1.0 : exp(-max(hn - p.y, 0.0) * 0.1 / (gap * 3.0 + 0.2));
  occl *= mix(0.3, 1.0, smoothstep(0.0, 4.0, p.y));
  float cosv = clamp(dot(bn, -rd), 0.0, 1.0);
  float fres = 0.04 + 0.96 * pow(1.0 - cosv, 5.0);
  vec3 r = reflect(rd, bn);
  vec3 refl = mirrored(p, bn, r, reflSteps, style == 1 ? 0.6 : 0.92);
  float sha = shadowSteps > 0 ? sunShadow(p + n * 0.02, l, shadowSteps) : 1.0;
  float dif = max(dot(bn, l), 0.0);
  vec3 sunCol = sunColor();
  vec3 amb = zen * 0.6 * (1.0 + max(bn.y, 0.0)) + hazeColor(-l) * 0.15;
  // Pale stone takes the warm glow of the whole sky, not only the blue above.
  if (style == 1) amb = (zen * 0.24 + hazeColor(normalize(vec3(l.x, 0.0, l.z))) * 0.09) * (1.0 + max(bn.y, 0.0)) + hazeColor(vec3(-n.x, 0.0, -n.z)) * 0.08;
  vec3 col = albedoAt(p) * (sunCol * dif * sha + amb * occl);
  // The polish: what it mirrors (marble is honed, not glassy: less).
  col += refl * fres * mix(occl, 1.0, 0.5) * (style == 1 ? 0.4 : 1.0);
  // The sun on it: a glint, a sheen, and down a tall face, the sun's long streak.
  float rl = max(dot(r, l), 0.0);
  col += sunCol * (pow(rl, 400.0) * 6.0 + pow(rl, 40.0) * 0.15) * sha * fres;
  if (top < 0.5) {
    vec2 rh = normalize(r.xz + 1e-5);
    float streak = pow(max(dot(rh, normalize(l.xz + 1e-5)), 0.0), 120.0) * exp(-abs(r.y - l.y) * 3.0);
    col += sunCol * streak * sha * fres * 1.2;
  }
  // The bevel catches the light whatever it mirrors: a fine bright line round the crown.
  col += (sunCol * 0.06 + hazeColor(r) * 0.3) * bevel * (1.0 - lod * 0.7);
  // The crown's light, as bright as its band is loud: glowing down from the top, so the loud ones burn at their tips.
  float hot = smoothstep(0.45, 1.0, hit.loud);
  hot *= hot;
  float crown = exp(-topDist * (style == 2 ? 4.0 : 7.0));
  col += edgeColor(hit.loud) * hot * (crown * (top > 0.5 ? 0.04 : 0.18) + bevel * 0.8);
  // A ring passing: a wave of light washing up the pillars, brightest at their crowns.
  float wash = rings(hit.cell + 0.5).y;
  col += ringColor() * wash * (top > 0.5 ? 0.12 * mix(0.3, 1.0, lod) : 0.006 + 0.3 * exp(-topDist * 0.7));
  // And from high up, the crowns shine as loud as their bands are, and as the rings pass: the spectrum as a
  // pattern of light over the dark field.
  float risen = smoothstep(14.0, 34.0, camPos.y);
  float shine = hot * mix(0.15, 1.0, lod) + risen * hit.loud * hit.loud * 1.6;
  col += (edgeColor(hit.loud) * shine * 0.3 + ringColor() * wash * risen * 1.1) * top;
  // Where pillars are smaller than a few pixels, the field's average there (what's hit flickers from pixel to
  // pixel; this doesn't): dark faces with the haze's light on them, the crowns' glow.
  float far = farness(hit.t, rd, top);
  if (far > 0.0) {
    col = mix(col, fieldAverage(rd, hit.loud, wash, risen), far);
  }
  return col;
}

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  int steps = int(mix(110.0, 300.0, quality));
  float tmax = mix(110.0, 220.0, quality);
  float reached;
  Hit hit = traceField(ro, rd, tmax, steps, reached);
  vec3 haze = hazeColor(rd);
  vec3 col;
  float f;
  if (hit.t >= 0.0) {
    col = shade(ro, rd, hit, int(mix(10.0, 28.0, quality)), int(mix(12.0, 40.0, quality)));
    f = fog(ro, rd, hit.fogT);
  } else if (hit.t < -1.5) {
    // Past the march: the far field's silhouettes, layer behind layer, their crowns catching the horizon's light.
    bool ground;
    vec2 cell;
    float loud;
    float tf = farField(ro, rd, reached, int(mix(24.0, 56.0, quality)), ground, cell, loud);
    if (tf > 0.0) {
      // (The same average as the march's far pillars, so the two meet without a seam.)
      col = ground ? skyColor(reflect(rd, vec3(0.0, 1.0, 0.0)), false) * 0.8 : fieldAverage(rd, loud, rings(cell + 0.5).y, smoothstep(14.0, 34.0, camPos.y));
      f = fog(ro, rd, tf);
    } else {
      col = rd.y < 0.0 ? haze : skyColor(rd, true);
      f = rd.y < 0.0 ? 1.0 : 0.0;
    }
  } else {
    col = skyColor(rd, true);
    f = 0.0;
  }
  col = mix(col, haze, f);
  // The sun's rays in the haze: through the far field's gaps, over the near one.
  return col + sunRays(rd) * (hit.t >= 0.0 ? f : 0.35);
}
`,
  init: () => ({
    time: 0,
    z: 0,
    speed: 4,
    turn: 0,
    across: 0,
    over: 0,
    rise: 0,
    y: 5,
    wall: 12,
    roll: 0,
    heading: Math.atan(pathSlope(0)),
    glow: 0,
    rings: [],
  }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    const height = Math.max(0.3, num(frame.values, "height", 1));
    s.time += dt;
    s.glow = smoothTo(s.glow, a.level, frame.dt, 1.5);
    s.speed = smoothTo(s.speed, 3.5 + 5 * a.bass + 3 * a.punch, frame.dt, 0.8);
    s.z += s.speed * dt;
    // Down the canyon for a while, then over the tops, and back (it never leaves the aisle, so never meets a pillar).
    s.over = smoothTo(s.over, smoothstep(-0.35, 0.35, Math.sin(s.time * 0.083 - 0.9)), frame.dt, 1.5);
    // Rising now and then to show the patterns, turning to look across the field rather than into the sun.
    const climb = smoothstep(0.35, 0.95, 0.5 + 0.5 * Math.sin(s.time * 0.07 - 1.4));
    s.rise = smoothTo(s.rise, 20 * climb + 3 * a.level * s.over, frame.dt, 2);
    s.across = smoothTo(s.across, 0.55 * climb, frame.dt, 2.5);
    // Looking about a little in the canyon, more over the tops.
    s.turn = (0.3 + 0.7 * s.over) * (0.32 * Math.sin(s.time * 0.061) + 0.1 * Math.sin(s.time * 0.17 + 1));
    // The walls either side (the lowest of the first rows, at their quietest jitter) and the tallest of them.
    const x0 = pathX(s.z);
    let low = Infinity;
    let tall = 0;
    for (let u = AISLE; u <= AISLE + 3; u++) {
      const level = Math.min(1, levelAt(frame.bands, bandOf(u)) * 1.1);
      for (const side of [-u, u]) {
        const rolling = swell(x0 + side, s.z, s.time);
        low = Math.min(low, standing(level * 0.9, height, rolling, 0));
        tall = Math.max(tall, standing(level, height, rolling, 1));
      }
    }
    s.wall = smoothTo(s.wall, low, frame.dt, 1.5);
    const canyon = Math.max(1.4, Math.min(s.wall * 0.5, s.wall - 2));
    const target = canyon + (Math.max(canyon, tall + 2.5) - canyon) * s.over + s.rise;
    s.y = smoothTo(s.y, target, frame.dt, 0.6);
    // Bank into the turn.
    const heading = Math.atan(pathSlope(s.z)) + s.turn + s.across;
    const rate = (heading - s.heading) / Math.max(frame.dt, 1e-4);
    s.heading = heading;
    s.roll = smoothTo(s.roll, Math.max(-0.12, Math.min(0.12, -rate * 0.6)), frame.dt, 0.8);
    for (const r of s.rings) {
      r.age += dt;
      r.radius += dt * (RING_SPEED + 1.5 * s.rise);
    }
    s.rings = s.rings.filter((r) => r.age < 4.5);
    if (a.onBeat) {
      s.rings.push({ x: x0, z: s.z, age: 0, radius: RING_START, power: 0.55 + 0.6 * clamp01(frame.hit) });
      if (s.rings.length > RINGS) s.rings.shift();
    }
  },
  uniforms(s, frame) {
    const height = Math.max(0.3, num(frame.values, "height", 1));
    // The world repeats every PERIOD cells along z: the camera (and the rings) are placed in the period it's in.
    const origin = Math.floor(s.z / PERIOD) * PERIOD;
    const pos: Vec3 = [pathX(s.z), s.y, s.z - origin];
    // Nearly level: the field receding into the light; looking down only when risen.
    const down = -0.06 + 0.11 * s.over + 0.01 * s.rise + 0.025 * Math.sin(s.time * 0.23);
    const fwd = normalize([Math.sin(s.heading), -down, Math.cos(s.heading)]);
    const rings = Array.from({ length: RINGS }, (_, i) => s.rings[i]);
    const fade = (r: Ring) => r.power * Math.exp(-r.age * 0.6);
    let most = 0;
    for (const r of s.rings) most += fade(r);
    return [
      ...cameraLooking(pos, fwd, s.roll, 48),
      ...soundUniforms(frame),
      float("moTime", s.time),
      float("moGlow", s.glow),
      // The tallest any pillar can stand: the band at its loudest, the jitter, the swell and the rings piled up.
      float("moTop", height * (20.8 * 1.1 + 2 + 3 * most) + 0.01),
      ...rings.map((r, i) => vec4(`moRing${i}`, r ? [r.x, r.z - origin, r.radius, fade(r)] : [0, 0, 0, 0])),
    ];
  },
};
