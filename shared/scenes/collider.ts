/**
 * Collider (docs/visualizer/scenes.md, "Five more, again"): inside a particle detector, a collision on every kick,
 * drawn as an event display is (ATLAS's and CMS's) in light on black. The detector is faint lines of light worked out
 * analytically per pixel: the tracker's layers as thin glowing shells (limb-brightened, as glass is) with rings at
 * their ends, the calorimeter as a ring of towers integrated exactly along the ray cell by cell (each as tall as its
 * band of the spectrum: end on it's a circular equaliser), the muon chambers' octagons and the toroid's coils as
 * projected lines, the beam pipe with its bunches. Each collision's tracks are hashed in the GLSL from its seed: a
 * helix from the vertex per track (its momentum the radius of curvature in the solenoid's field, soft ones curling
 * into tight spirals, its charge, heading and dip), projected to the screen per pixel as a polyline (only where its
 * bounds reach) and drawn as a sharp core and a soft halo by the pixel's distance in pixels, so it's crisp at any
 * size; it grows outwards over the collision's first moments, its head white-hot, and lights hit dots on the
 * layers it crosses. Jets are cones of hard tracks that pile energy into the towers they reach; muons run on
 * straight through the chambers, lighting them; a dashed arrow points where the missing energy went; a shock of
 * light runs out through the detector. Bubble Chamber is the old photographs instead: white spirals on black,
 * curling tighter as they lose energy. Field is the solenoid's strength (how tightly everything curls). Stepped: the camera's orbit about the beam, its tour between the end-on view,
 * the side and three-quarters, its push in on each hit, and the collisions (seed, age, energy), a few at once.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraLooking, clamp01, num, random, sceneDt, smoothTo, smoothstep, soundUniforms, vec4, wrap } from "./kit.ts";

const EVENTS = 4;
/** How long a collision lasts (seconds). */
const LIFE = 2;

/** The tour's views: elevation over the beam's plane (90° is end on) and distance, in turn. */
const VIEWS = [
  { elev: 84, dist: 1.06 },
  { elev: 36, dist: 1 },
  { elev: 7, dist: 1.02 },
  { elev: 58, dist: 0.96 },
];
/** Seconds each view lasts at Speed 1 (the last part of it moving on to the next). */
const VIEW_SECONDS = 8;

interface Collision {
  seed: number;
  age: number;
  energy: number;
  /** Where along the beam it happened. */
  z: number;
}

interface ColliderState {
  time: number;
  /** The camera's azimuth about the beam, and where its tour of views is (views, wrapped). */
  orbit: number;
  tour: number;
  dist: number;
  kick: number;
  kickTarget: number;
  /** The beam's bunches and the dashes' clock (wrapped). */
  clock: number;
  breath: number;
  events: Collision[];
  rng: { seed: number };
}

export const COLLIDER: SceneSpec<ColliderState> = {
  type: "collider",
  label: "Collider",
  params: [
    {
      kind: "choice",
      key: "style",
      label: "Style",
      default: "display",
      options: [
        { value: "display", label: "Event Display" },
        { value: "neon", label: "Neon" },
        { value: "bubble", label: "Bubble Chamber" },
        { value: "mono", label: "Mono" },
      ],
    },
    { kind: "number", key: "tracks", label: "Tracks", default: 1, min: 0.25, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "field", label: "Field", default: 1, min: 0.3, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "detector", label: "Detector", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  audio: () => ({ rows: 1, span: 0, fall: 0.2, window: 0 }),
  glsl: /* glsl */ `
uniform vec4 coEv0;
uniform vec4 coEv1;
uniform vec4 coEv2;
uniform vec4 coEv3;
// x: the beam's clock, y: the towers' breath, z: the latest hit's push.
uniform vec4 coDrive;

const float CO_TAU = 6.2831853;
const float CO_LIFE = ${LIFE.toFixed(1)};
// The detector (metres, roughly ATLAS's proportions halved): the beam along z.
const float CO_SOL = 1.45;
const float CO_TRK_L = 2.5;
const float CO_CAL_R = 1.58;
const float CO_CAL_H = 0.85;
const float CO_CAL_L = 2.8;
const float CO_CELLS = 64.0;
const float CO_RINGS = 6.0;
const float CO_MU_OUT = 5.0;
const float CO_FRONT = 4.5;
const int CO_MAXT = 36;

vec3 coR;
vec3 coU;
vec3 coF;
vec3 coMx;
vec3 coMy;
vec3 coMz;
float coK;
float coPx;
float coUnit;
vec2 coQ;
vec4 coE[4];
float coEnv[4];
vec4 coJet[8];

vec2 coMul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 coDiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }
vec3 coCam(vec3 p) { vec3 d = p - camPos; return vec3(dot(d, coR), dot(d, coU), dot(d, coF)); }
vec2 coProj(vec3 c) { return c.xy * (coK / max(c.z, 0.05)); }
// A pixel's distance to a segment, and how far along it the nearest point is.
vec2 coSeg(vec2 q, vec2 a, vec2 b) {
  vec2 pa = q - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}
// A line of light at d pixels: a sharp core w pixels across each side (box-filtered, so anti-aliased at any size)
// and a halo h pixels wide that falls to nothing.
float coGlow(float d, float w, float h, float halo) {
  return clamp(w + 0.5 - d, 0.0, 1.0) + halo * max(exp(-d / h) - 0.004, 0.0);
}
float coOverlap(float a0, float a1, float b0, float b1) { return max(0.0, min(a1, b1) - max(a0, b0)); }

// Colours, by Style.
vec3 coTrackCol(float q, float hard) {
  if (style == 1) return mix(q > 0.0 ? vec3(0.08, 0.8, 1.0) : vec3(1.0, 0.16, 0.75), vec3(1.0, 0.85, 1.0), hard * 0.5);
  if (style == 2) return vec3(1.0, 0.95, 0.86);
  if (style == 3) return vec3(1.0);
  return mix(q > 0.0 ? vec3(1.0, 0.55, 0.12) : vec3(1.0, 0.78, 0.22), vec3(1.0, 0.93, 0.6), hard * 0.6);
}
vec3 coMuonCol() {
  if (style == 1) return vec3(0.5, 1.0, 0.15);
  if (style == 3 || style == 2) return vec3(1.0);
  return vec3(1.0, 0.13, 0.08);
}
vec3 coShellCol() {
  if (style == 1) return vec3(0.42, 0.22, 1.0);
  if (style == 2 || style == 3) return vec3(0.75, 0.78, 0.85);
  return vec3(0.32, 0.5, 0.85);
}
vec3 coChamberCol() {
  if (style == 1) return vec3(0.25, 0.3, 1.0);
  if (style == 2 || style == 3) return vec3(0.7);
  return vec3(0.22, 0.42, 1.0);
}
// A tower's light by how far up its range it is: a level meter.
vec3 coMeter(float f) {
  if (style == 1) return mix(mix(vec3(0.35, 0.1, 1.0), vec3(1.0, 0.15, 0.7), smoothstep(0.1, 0.55, f)), vec3(1.0, 0.85, 1.0), smoothstep(0.6, 1.0, f));
  if (style == 2 || style == 3) return vec3(0.42, 0.44, 0.48) * (0.5 + f);
  return mix(mix(vec3(0.1, 0.95, 0.3), vec3(1.0, 0.85, 0.1), smoothstep(0.15, 0.45, f)), vec3(1.0, 0.18, 0.06), smoothstep(0.5, 0.85, f));
}
vec3 coMetCol() {
  if (style == 1) return vec3(1.0, 0.9, 0.2);
  if (style == 0) return vec3(0.85, 0.9, 1.0);
  return vec3(1.0);
}

// How bright a collision is at an age: a flash, a hold, then gone by its end.
float coEnvelope(float age) {
  return (1.0 + 2.5 * exp(-age * 6.0)) * exp(-max(age - 0.18, 0.0) * 2.6) * (1.0 - smoothstep(CO_LIFE - 0.6, CO_LIFE, age));
}
// The shock of light a collision sends out through the detector: how much it lights radius r now.
float coWave(float r) {
  float w = 0.0;
  for (int e = 0; e < 4; e++) {
    if (coE[e].z <= 0.0) continue;
    float front = coE[e].y * 9.0;
    float d = (r - front) / 0.35;
    w += coE[e].z * exp(-d * d) * exp(-coE[e].y * 1.5);
  }
  return w;
}

void coSetup() {
  coE[0] = coEv0; coE[1] = coEv1; coE[2] = coEv2; coE[3] = coEv3;
  for (int e = 0; e < 4; e++) {
    coEnv[e] = coE[e].z > 0.0 ? coEnvelope(coE[e].y) : 0.0;
    vec3 h = hash33(vec3(coE[e].x * 0.731 + 3.1, 91.7, 5.3));
    float phi = h.x * CO_TAU;
    float power = coE[e].z * (0.6 + 0.4 * h.y);
    // One jet, or two back to back (a dijet), the harder hits making two.
    coJet[e * 2] = vec4(phi, (h.z - 0.5) * 1.6, power, 0.0);
    vec3 h2 = hash33(vec3(coE[e].x * 0.731 + 7.7, 13.1, 2.9));
    float two = coE[e].z > 0.6 || h2.x > 0.55 ? 1.0 : 0.0;
    coJet[e * 2 + 1] = vec4(phi + 3.14159 + (h2.y - 0.5) * 0.7, -(h.z - 0.5) * 1.2 + (h2.z - 0.5) * 0.8, power * (0.5 + 0.5 * h2.z) * two, 0.0);
  }
}

// The pixel distance from q to the circle of radius r about the beam at z0, projected: Gauss-Newton on the circle's
// angle, from where the ray meets its plane.
float coRing(vec3 rd, float r, float z0) {
  vec3 ro = camPos;
  float t = abs(rd.z) > 0.04 ? (z0 - ro.z) / rd.z : -1.0;
  vec3 h = t > 0.0 ? ro + rd * t : ro + rd * max(dot(vec3(0.0, 0.0, z0) - ro, rd), 0.0);
  float th = atan(h.y, h.x);
  vec3 c0 = coCam(vec3(0.0, 0.0, z0));
  vec2 e = vec2(1e5);
  for (int i = 0; i < 4; i++) {
    vec2 cs = vec2(cos(th), sin(th));
    vec3 c = c0 + r * (cs.x * coMx + cs.y * coMy);
    vec3 dc = r * (-cs.y * coMx + cs.x * coMy);
    float iz = 1.0 / max(c.z, 0.05);
    vec2 s = c.xy * coK * iz;
    vec2 ds = (dc.xy - c.xy * dc.z * iz) * coK * iz;
    e = s - coQ;
    th -= clamp(dot(e, ds) / max(dot(ds, ds), 1e-6), -0.5, 0.5);
  }
  vec2 cs = vec2(cos(th), sin(th));
  return length(coProj(c0 + r * (cs.x * coMx + cs.y * coMy)) - coQ);
}

// The path length of the ray inside a thin cylindrical shell about the beam (radius r, thickness w, |z| < l): its
// glow, brightest where it's seen edge on, as glass is.
float coShell(vec3 rd, float r, float w, float l) {
  vec3 ro = camPos;
  float tz0 = 0.0;
  float tz1 = 1e5;
  if (abs(rd.z) > 1e-6) {
    float t1 = (-l - ro.z) / rd.z;
    float t2 = (l - ro.z) / rd.z;
    tz0 = max(min(t1, t2), 0.0);
    tz1 = max(t1, t2);
  } else if (abs(ro.z) > l) return 0.0;
  if (tz1 <= tz0) return 0.0;
  float a = max(dot(rd.xy, rd.xy), 1e-9);
  float b = dot(ro.xy, rd.xy);
  float c = dot(ro.xy, ro.xy);
  float ro2 = r + 0.5 * w;
  float ri2 = r - 0.5 * w;
  float dO = b * b - a * (c - ro2 * ro2);
  if (dO <= 0.0) return 0.0;
  dO = sqrt(dO);
  float o1 = (-b - dO) / a;
  float o2 = (-b + dO) / a;
  float dI = b * b - a * (c - ri2 * ri2);
  if (dI <= 0.0) return coOverlap(o1, o2, tz0, tz1);
  dI = sqrt(dI);
  return coOverlap(o1, (-b - dI) / a, tz0, tz1) + coOverlap((-b + dI) / a, o2, tz0, tz1);
}

// The calorimeter's towers: CO_CELLS round, CO_RINGS along the barrel, each a glowing translucent box rising from
// CO_CAL_R as tall as its band of the spectrum (mirrored about the bottom: the bass there, the highs at the top),
// breathing with the bass, plus the energy the jets drop into it.
float coTowerH(float cell, float ring) {
  float u = fract((cell + 0.5) / CO_CELLS - 0.75);
  float x = min(u, 1.0 - u) * 2.0;
  float s = spectrum(0.02 + x * 0.86);
  float zc = (ring + 0.5) / CO_RINGS * 2.0 - 1.0;
  float h = CO_CAL_H * (0.04 + 0.96 * pow(s, 2.2)) * (1.0 - 0.35 * zc * zc) * (0.7 + 0.4 * coDrive.y);
  float phi = (cell + 0.5) / CO_CELLS * CO_TAU;
  float z = zc * CO_CAL_L;
  for (int j = 0; j < 8; j++) {
    vec4 jet = coJet[j];
    if (jet.z <= 0.0) continue;
    float age = coE[j / 2].y;
    float arrive = smoothstep(0.18, 0.32, age) * coEnv[j / 2];
    float dp = phi - jet.x;
    dp -= CO_TAU * floor(dp / CO_TAU + 0.5);
    float dz = z - clamp(jet.y * CO_CAL_R, -CO_CAL_L, CO_CAL_L);
    h += CO_CAL_H * 1.1 * jet.z * arrive * exp(-dp * dp / 0.012 - dz * dz / 0.5);
  }
  return min(h, CO_CAL_H);
}
// The length of the ray inside the circle of radius r (transverse quadratic a, b, c) within [t0, t1].
float coInside(float a, float b, float c, float r, float t0, float t1) {
  float d = b * b - a * (c - r * r);
  if (d <= 0.0) return 0.0;
  d = sqrt(d);
  return coOverlap((-b - d) / a, (-b + d) / a, t0, t1);
}
vec3 coTowers(vec3 rd, float bright) {
  vec3 ro = camPos;
  float rMax = CO_CAL_R + CO_CAL_H;
  float a = max(dot(rd.xy, rd.xy), 1e-9);
  float b = dot(ro.xy, rd.xy);
  float c = dot(ro.xy, ro.xy);
  float dO = b * b - a * (c - rMax * rMax);
  if (dO <= 0.0) return vec3(0.0);
  float tz0 = 0.0;
  float tz1 = 1e5;
  if (abs(rd.z) > 1e-6) {
    float t1 = (-CO_CAL_L - ro.z) / rd.z;
    float t2 = (CO_CAL_L - ro.z) / rd.z;
    tz0 = max(min(t1, t2), 0.0);
    tz1 = max(t1, t2);
  }
  dO = sqrt(dO);
  float o1 = (-b - dO) / a;
  float o2 = (-b + dO) / a;
  float dI = b * b - a * (c - CO_CAL_R * CO_CAL_R);
  vec2 spans[2];
  if (dI <= 0.0) {
    spans[0] = vec2(o1, o2);
    spans[1] = vec2(0.0);
  } else {
    dI = sqrt(dI);
    spans[0] = vec2(o1, (-b - dI) / a);
    spans[1] = vec2((-b + dI) / a, o2);
  }
  // A pixel's size in the world at the calorimeter, for its caps and soft gaps.
  float pw = length(camPos) / coK;
  float capW = max(0.035, 1.6 * pw);
  vec3 col = vec3(0.0);
  float through = 1.0;
  int budget = int(mix(16.0, 40.0, quality));
  for (int sp = 0; sp < 2; sp++) {
    float t = max(spans[sp].x, tz0);
    float tEnd = min(spans[sp].y, tz1);
    for (int it = 0; it < 40; it++) {
      if (it >= budget || t >= tEnd - 1e-4) break;
      vec3 p = ro + rd * (t + 1e-4);
      float ph = atan(p.y, p.x);
      float cell = floor(ph / CO_TAU * CO_CELLS);
      float ring = clamp(floor((p.z + CO_CAL_L) / (2.0 * CO_CAL_L) * CO_RINGS), 0.0, CO_RINGS - 1.0);
      // The next wall the ray crosses: a cell's (radial planes) or a ring's.
      float turn = p.x * rd.y - p.y * rd.x;
      float wall = (cell + (turn > 0.0 ? 1.0 : 0.0)) * CO_TAU / CO_CELLS;
      vec2 n = vec2(-sin(wall), cos(wall));
      float den = dot(n, rd.xy);
      float tw = abs(den) > 1e-8 ? -dot(n, ro.xy) / den : 1e9;
      if (tw <= t + 1e-5) tw = 1e9;
      float tr = 1e9;
      if (abs(rd.z) > 1e-6) {
        float zb = -CO_CAL_L + (ring + (rd.z > 0.0 ? 1.0 : 0.0)) * 2.0 * CO_CAL_L / CO_RINGS;
        tr = (zb - ro.z) / rd.z;
        if (tr <= t + 1e-5) tr = 1e9;
      }
      float tn = min(tEnd, min(tw, tr));
      float h = coTowerH(cell, ring);
      float top = CO_CAL_R + h;
      float inside = coInside(a, b, c, top, t, tn);
      if (inside > 0.0) {
        // Gaps between the towers, softened by a pixel: where the stretch's middle is in its cell.
        vec3 m = ro + rd * (0.5 * (t + tn));
        float fc = fract(atan(m.y, m.x) / CO_TAU * CO_CELLS);
        float fr = fract((m.z + CO_CAL_L) / (2.0 * CO_CAL_L) * CO_RINGS);
        float fwc = pw / (length(m.xy) * CO_TAU / CO_CELLS) + 0.02;
        float fwr = pw / (2.0 * CO_CAL_L / CO_RINGS) + 0.02;
        float gap = smoothstep(0.08 - fwc, 0.08 + fwc, fc) * smoothstep(0.08 - fwc, 0.08 + fwc, 1.0 - fc)
          * smoothstep(0.04 - fwr, 0.04 + fwr, fr) * smoothstep(0.04 - fwr, 0.04 + fwr, 1.0 - fr);
        float cap = inside - coInside(a, b, c, top - capW, t, tn);
        float f = h / CO_CAL_H;
        float e = 1.0 - exp(-inside * 0.35 * gap);
        // The caps shine where they're seen edge on (end on, and at the barrel's sides): outlines, not sheets.
        float edge = smoothstep(capW * 1.3, capW * 5.0, cap);
        float shock = 1.0 + 2.5 * coWave(length(m.xy));
        col += through * (coMeter(f * 0.85) * e * 0.035 * shock + coMeter(f) * edge * gap * 0.8 * shock);
        through *= 1.0 - 0.3 * e;
      }
      t = tn;
    }
  }
  return col * bright;
}

// The muon chambers (three octagons of them, inner and outer skins) and the toroid's eight coils, as lines.
vec3 coMuonSystem(float bright) {
  float d = 1e5;
  float dc = 1e5;
  float lit = 0.0;
  float apo[3] = float[3](2.85, 3.35, 3.85);
  float len[3] = float[3](3.5, 3.9, 4.3);
  float sec = 1.0 / cos(CO_TAU / 16.0);
  for (int s = 0; s < 3; s++) {
    for (int skin = 0; skin < 2; skin++) {
      float rc = (apo[s] + float(skin) * 0.16) * sec;
      float l = len[s];
      vec2 prevA = vec2(0.0);
      vec2 prevB = vec2(0.0);
      for (int k = 0; k <= 8; k++) {
        float ang = (float(k) + 0.5) * CO_TAU / 8.0;
        vec3 cxy = rc * (cos(ang) * coMx + sin(ang) * coMy);
        vec2 pa = coProj(cxy + coCam(vec3(0.0, 0.0, l)));
        vec2 pb = coProj(cxy + coCam(vec3(0.0, 0.0, -l)));
        if (k < 8) d = min(d, coSeg(coQ, pa, pb).x);
        if (k == 0) lit = max(lit, coWave(rc));
        if (k > 0) {
          d = min(d, coSeg(coQ, prevA, pa).x);
          d = min(d, coSeg(coQ, prevB, pb).x);
        }
        prevA = pa;
        prevB = pb;
      }
    }
  }
  // The coils: racetracks in the planes between the chambers' corners.
  for (int k = 0; k < 8; k++) {
    float ang = (float(k) + 0.5) * CO_TAU / 8.0;
    vec3 dir = cos(ang) * coMx + sin(ang) * coMy;
    vec3 zl = coCam(vec3(0.0, 0.0, 3.4)) - coCam(vec3(0.0));
    vec3 o = coCam(vec3(0.0));
    vec2 a0 = coProj(o + dir * 3.02 + zl);
    vec2 a1 = coProj(o + dir * 3.65 + zl);
    vec2 b0 = coProj(o + dir * 3.02 - zl);
    vec2 b1 = coProj(o + dir * 3.65 - zl);
    dc = min(dc, min(min(coSeg(coQ, a0, a1).x, coSeg(coQ, b0, b1).x), min(coSeg(coQ, a0, b0).x, coSeg(coQ, a1, b1).x)));
  }
  float w = 0.35 * coUnit;
  return coChamberCol() * coGlow(d, w, 3.0 * coUnit, 0.5) * 0.07 * bright * (1.0 + 4.0 * coWave(3.3)) + coShellCol() * coGlow(dc, w, 3.0 * coUnit, 0.4) * 0.04 * bright;
}

// The tracker, the solenoid and the calorimeter's skins: glowing shells, rings at their ends; the shock of each
// collision lighting them as it passes.
vec3 coShells(vec3 rd, float bright) {
  float pw = length(camPos) / coK;
  float w = max(0.012, 1.4 * pw);
  vec3 col = vec3(0.0);
  float radii[8] = float[8](0.13, 0.24, 0.38, 0.56, 0.76, 0.97, 1.19, CO_SOL);
  float lens[8] = float[8](0.8, 0.9, 1.05, 2.2, 2.3, 2.4, 2.5, 2.7);
  for (int i = 0; i < 8; i++) {
    float r = radii[i];
    float l = lens[i];
    float boost = 1.0 + 3.0 * coWave(r);
    float g = coShell(rd, r, w, l);
    float lit = (1.0 - exp(-g / (w * 10.0))) * 0.03 + g * 0.002;
    float ring = min(coRing(rd, r, l), coRing(rd, r, -l));
    lit += coGlow(ring, 0.3 * coUnit, 2.5 * coUnit, 0.5) * 0.1;
    col += coShellCol() * lit * boost * (i == 7 ? 0.7 : 1.0);
  }
  // The calorimeter's inner and outer skins: rings only.
  float rc = min(min(coRing(rd, CO_CAL_R, CO_CAL_L), coRing(rd, CO_CAL_R, -CO_CAL_L)), min(coRing(rd, CO_CAL_R + CO_CAL_H, CO_CAL_L), coRing(rd, CO_CAL_R + CO_CAL_H, -CO_CAL_L)));
  col += coMeter(0.0) * coGlow(rc, 0.3 * coUnit, 2.5 * coUnit, 0.5) * 0.12 * (1.0 + 2.0 * coWave(CO_CAL_R));
  return col * bright;
}

// The beam pipe along z, glowing with the level, its bunches streaming in from both ends.
vec3 coBeam(float bright) {
  vec2 a = coProj(coCam(vec3(0.0, 0.0, -6.5)));
  vec2 b = coProj(coCam(vec3(0.0, 0.0, 6.5)));
  vec2 sd = coSeg(coQ, a, b);
  float z = abs(sd.y * 13.0 - 6.5);
  float bunch = pow(0.5 + 0.5 * cos(CO_TAU * (z * 0.8 + coDrive.x)), 12.0);
  float g = coGlow(sd.x, 0.45 * coUnit, 4.0 * coUnit, 0.6);
  vec3 c = style == 1 ? vec3(0.5, 0.6, 1.0) : style == 0 ? vec3(0.55, 0.75, 1.0) : vec3(0.9);
  return c * g * (0.03 + 0.08 * sLevel + bunch * (0.15 + 0.3 * sLevel)) * bright * (1.0 - smoothstep(4.5, 6.5, z));
}

// One track's helix, projected: from the vertex (camera space) at radius of curvature R0 (losing k of it a radian),
// charge q, heading phi0 and dip cot, as far as arc length sEnd. The pixel's distance to it and the arc length
// there; far away when the pixel is outside its bounds.
vec2 coHelix(vec3 vc, float R0, float k, float q, float phi0, float cot, float sEnd, float margin, int maxSeg) {
  float alpha;
  if (k < 1e-3) alpha = sEnd / R0;
  else {
    float x = k * sEnd / R0;
    alpha = x < 0.995 ? -log(1.0 - x) / k : 60.0;
  }
  vec2 C = R0 * coDiv(vec2(cos(phi0), sin(phi0)), vec2(k, q));
  vec3 zAxis = coMz * cot;
  // Bounds: the chord's sphere for an arc under a half turn, else the circle it stays in.
  vec3 centre;
  float rad;
  if (alpha <= 3.14159) {
    vec2 E = exp(-k * alpha) * vec2(cos(q * alpha), -sin(q * alpha));
    vec2 W = C - coMul(C, E);
    vec3 pe = vc + W.x * coMx + W.y * coMy + zAxis * sEnd;
    centre = 0.5 * (vc + pe);
    rad = 0.5 * length(pe - vc) * 1.08 + 0.01;
  } else {
    centre = vc + C.x * coMx + C.y * coMy + zAxis * (0.5 * sEnd);
    rad = sqrt(dot(C, C) + 0.25 * cot * cot * sEnd * sEnd) + 0.01;
  }
  float rpx = rad * coK / max(centre.z - rad, 0.3);
  if (length(coProj(centre) - coQ) > rpx + margin) return vec2(1e5, 0.0);
  int n = int(clamp(ceil(alpha / mix(0.5, 0.2, quality)), 2.0, float(maxSeg)));
  float da = alpha / float(n);
  float decay = exp(-k * da);
  vec2 stp = decay * vec2(cos(q * da), -sin(q * da));
  vec2 E = vec2(1.0, 0.0);
  float m = 1.0;
  vec2 prev = coProj(vc);
  float sPrev = 0.0;
  vec2 best = vec2(1e5, 0.0);
  for (int j = 1; j <= 72; j++) {
    if (j > n) break;
    E = coMul(E, stp);
    m *= decay;
    float s = k < 1e-3 ? R0 * da * float(j) : R0 * (1.0 - m) / k;
    vec2 W = C - coMul(C, E);
    vec2 p = coProj(vc + W.x * coMx + W.y * coMy + zAxis * s);
    vec2 sd = coSeg(coQ, prev, p);
    if (sd.x < best.x) best = vec2(sd.x, mix(sPrev, s, sd.y));
    prev = p;
    sPrev = s;
  }
  return best;
}
// Where the helix is at turning angle alpha (camera space).
vec3 coHelixAt(vec3 vc, float R0, float k, float q, float phi0, float cot, float alpha) {
  vec2 C = R0 * coDiv(vec2(cos(phi0), sin(phi0)), vec2(k, q));
  vec2 E = exp(-k * alpha) * vec2(cos(q * alpha), -sin(q * alpha));
  vec2 W = C - coMul(C, E);
  float s = k < 1e-3 ? R0 * alpha : R0 * (1.0 - exp(-k * alpha)) / k;
  return vc + W.x * coMx + W.y * coMy + coMz * cot * s;
}

// One collision: its tracks, jets' cones, muons, hit dots, the missing energy's arrow and the vertex's flash.
vec3 coEvent(int e) {
  vec4 ev = coE[e];
  float seed = ev.x;
  float age = ev.y;
  float energy = ev.z;
  float env = coEnv[e];
  if (env <= 0.002) return vec3(0.0);
  bool bubble = style == 2;
  vec3 vc = coCam(vec3(0.0, 0.0, ev.w));
  vec2 vp = coProj(vc);
  float front = age * CO_FRONT;
  vec3 col = vec3(0.0);
  float wCore = max(0.35, 0.55 * coUnit);
  float halo = (style == 1 ? 5.0 : 3.5) * coUnit;
  float margin = halo * 6.0 + 2.0;
  int maxSeg = int(mix(18.0, 72.0, quality));
  float fieldK = 1.0 / max(field, 0.05);
  int nT = int(min(float(CO_MAXT), floor(tracks * (7.0 + 20.0 * energy) + 0.5)));
  int nJetT = int(floor(float(nT) * 0.4));
  int nMu = energy > 0.75 ? 2 : energy > 0.4 ? 1 : 0;
  if (bubble) nMu = 0;
  for (int i = 0; i < CO_MAXT; i++) {
    if (i >= nT) break;
    vec3 h = hash33(vec3(seed * 0.731 + 3.1, float(i) * 1.37 + 0.5, 1.9));
    vec3 g = hash33(vec3(seed * 0.513 + 8.3, float(i) * 2.11 + 4.5, 7.3));
    float q = h.x > 0.5 ? 1.0 : -1.0;
    bool isMu = i >= nT - nMu;
    bool isJet = !isMu && i < nJetT;
    float R0;
    float phi0;
    float cot;
    float k = 0.0;
    float hard = 0.0;
    if (isJet) {
      vec4 jet = coJet[e * 2 + (coJet[e * 2 + 1].z > 0.0 && (i & 1) == 1 ? 1 : 0)];
      R0 = (2.5 + 14.0 * h.y * h.y) * fieldK;
      phi0 = jet.x + (g.x - 0.5) * 0.4;
      cot = jet.y + (g.y - 0.5) * 0.4;
      hard = 1.0;
    } else if (isMu) {
      R0 = (4.0 + 8.0 * h.y) * fieldK;
      phi0 = g.x * CO_TAU;
      cot = (g.y - 0.5) * 1.2;
      hard = 1.0;
    } else {
      R0 = (0.16 + 2.2 * h.y * h.y * h.y) * fieldK;
      phi0 = g.x * CO_TAU;
      cot = (g.y - 0.5) * 2.4;
      hard = smoothstep(0.8, 2.5, R0);
      if (R0 < 0.55) k = 0.035;
    }
    if (bubble) {
      // Bubble chamber: the field strong and the tracks near the picture's plane, forward from the beam; the soft
      // ones losing energy and curling in.
      R0 *= 0.38;
      cot *= 0.15;
      if (!isJet) {
        phi0 = (g.x - 0.5) * 2.4;
        k = R0 < 0.5 ? 0.2 + 0.5 * g.z : 0.04;
      }
    }
    // How far it runs: out to the calorimeter (or the chamber's edge), through the endcap, or round and round.
    float rEnd = bubble ? 2.6 : isMu ? CO_SOL : CO_CAL_R - 0.04;
    float alphaEnd = 2.0 * R0 > rEnd ? 2.0 * asin(rEnd / (2.0 * R0)) : (bubble ? 40.0 : CO_TAU * (1.6 + 1.2 * g.z));
    float sEnd = k < 1e-3 ? R0 * alphaEnd : R0 * (1.0 - exp(-k * alphaEnd)) / k;
    float lz = isMu ? 999.0 : (bubble ? 1.2 : CO_TRK_L);
    sEnd = min(sEnd, lz / max(abs(cot), 1e-3));
    float sDraw = min(sEnd, front);
    if (sDraw <= 1e-3) continue;
    vec2 hd = coHelix(vc, R0, k, q, phi0, cot, sDraw, margin, maxSeg);
    vec3 tc = isMu ? coMuonCol() : coTrackCol(q, hard);
    float bright = isMu ? 1.4 : mix(0.55, 1.15, hard);
    // The head, white-hot while it's still flying out; the trail behind it cools.
    float growing = front < sEnd ? 1.0 : 0.0;
    float head = growing * exp(-(sDraw - hd.y) * 9.0);
    float trail = (0.6 + 0.4 * exp(-(sDraw - hd.y) * 1.5)) * smoothstep(0.0, 0.18, hd.y);
    float wc = wCore * (isMu ? 1.4 : mix(0.8, 1.15, hard));
    float bub = 1.0;
    if (bubble) {
      // Bubbles: a string of beads along it.
      float bead = vnoise3(vec3(hd.y * 60.0, seed, float(i)));
      bub = 0.45 + 0.9 * smoothstep(0.35, 0.65, bead);
    }
    if (hd.x < 1e4) {
      col += mix(tc, vec3(1.0), head * 0.8) * coGlow(hd.x, wc, halo, 0.32) * bright * (0.8 * trail + 2.5 * head) * bub;
    }
    // Hit dots where it crossed the tracker's layers.
    if (!bubble && hd.x < margin + 40.0) {
      float lr[6] = float[6](0.13, 0.24, 0.38, 0.56, 0.76, 0.97);
      for (int L = 0; L < 6; L++) {
        if (lr[L] >= 2.0 * R0) break;
        float al = 2.0 * asin(lr[L] / (2.0 * R0));
        float sl = R0 * al;
        if (sl > sDraw || abs(cot * sl) > 2.3) break;
        vec2 dp = coProj(coHelixAt(vc, R0, k, q, phi0, cot, al));
        float dd = length(dp - coQ);
        col += mix(tc, vec3(1.0), 0.6) * coGlow(dd, 1.1 * coUnit, 1.6 * coUnit, 0.6) * 0.5;
      }
    }
    // Muons go on, straight, through the chambers.
    if (isMu && front > sEnd) {
      float as = 2.0 * asin(min(CO_SOL / (2.0 * R0), 1.0));
      vec3 ps = coHelixAt(vc, R0, k, q, phi0, cot, as);
      float dirA = phi0 - q * as;
      vec3 dir = cos(dirA) * coMx + sin(dirA) * coMy + coMz * cot;
      float sMax = (CO_MU_OUT - CO_SOL);
      float sOn = min(front - sEnd, sMax);
      vec2 a0 = coProj(ps);
      vec2 a1 = coProj(ps + dir * sOn);
      vec2 sd = coSeg(coQ, a0, a1);
      float headM = sOn < sMax ? exp(-(1.0 - sd.y) * sOn * 9.0) : 0.0;
      col += mix(tc, vec3(1.0), headM * 0.8) * coGlow(sd.x, wc * 1.4, halo, 0.32) * 1.4 * (1.0 + 2.5 * headM);
      // The chambers it has crossed light up where it went through.
      float apo[3] = float[3](2.85, 3.35, 3.85);
      vec2 tang = vec2(-sin(dirA), cos(dirA));
      for (int s = 0; s < 3; s++) {
        float l = (apo[s] + 0.08) / max(cos(dirA - floor(dirA / (CO_TAU / 8.0) + 0.5) * CO_TAU / 8.0), 0.5) - CO_SOL;
        if (l > sOn) break;
        vec3 hit = ps + dir * l;
        float faceA = floor(dirA / (CO_TAU / 8.0) + 0.5) * CO_TAU / 8.0;
        vec3 along = -sin(faceA) * coMx + cos(faceA) * coMy;
        vec2 sd2 = coSeg(coQ, coProj(hit - along * 0.2), coProj(hit + along * 0.2));
        col += mix(coChamberCol(), vec3(1.0), 0.3) * coGlow(sd2.x, 1.0 * coUnit, 3.0 * coUnit, 0.5) * 0.7;
      }
    }
  }
  // The jets' cones: soft wedges of light from the vertex to the calorimeter.
  if (!bubble) {
    for (int j = 0; j < 2; j++) {
      vec4 jet = coJet[e * 2 + j];
      if (jet.z <= 0.0) continue;
      float reach = min(front, CO_CAL_R) / CO_CAL_R;
      if (reach <= 0.0) continue;
      vec3 axis = cos(jet.x) * coMx + sin(jet.x) * coMy + coMz * jet.y;
      vec3 tip = vc + axis * CO_CAL_R * reach;
      vec2 ta = coProj(tip);
      float rpx = 0.32 * CO_CAL_R * reach * coK / max(tip.z, 0.3);
      vec2 sd = coSeg(coQ, vp, ta);
      float span = length(ta - vp);
      float wide = mix(rpx, rpx * sd.y, smoothstep(0.0, rpx * 1.5, span));
      float cone = max(1.0 - sd.x / max(wide, 1.0), 0.0);
      col += coTrackCol(1.0, 1.0) * cone * cone * 0.12 * jet.z * (0.4 + 0.6 * sd.y);
    }
    // The missing energy: a dashed arrow in the beam's plane, away from where the jets went.
    vec2 sum = vec2(0.0);
    for (int j = 0; j < 2; j++) {
      vec4 jet = coJet[e * 2 + j];
      sum += jet.z * vec2(cos(jet.x), sin(jet.x));
    }
    vec3 mh = hash33(vec3(seed * 0.37 + 1.3, 4.4, 8.8));
    float am = atan(-sum.y - 0.0001, -sum.x) + (mh.x - 0.5) * 0.9;
    float lenM = min(front, (1.6 + 1.6 * mh.y) * (0.5 + 0.5 * energy));
    if (lenM > 0.0 && mh.z > 0.25) {
      vec3 dirM = cos(am) * coMx + sin(am) * coMy;
      vec3 tipM = vc + dirM * lenM;
      vec2 sd = coSeg(coQ, vp, coProj(tipM));
      float dash = smoothstep(0.35, 0.5, fract(sd.y * lenM * 4.0 - coDrive.x * 2.0)) * smoothstep(1.0, 0.85, fract(sd.y * lenM * 4.0 - coDrive.x * 2.0));
      vec3 side = -sin(am) * coMx + cos(am) * coMy;
      vec2 hA = coProj(tipM - dirM * 0.22 + side * 0.11);
      vec2 hB = coProj(tipM - dirM * 0.22 - side * 0.11);
      vec2 tp = coProj(tipM);
      float dh = min(coSeg(coQ, tp, hA).x, coSeg(coQ, tp, hB).x);
      col += coMetCol() * (coGlow(sd.x, wCore * 1.2, halo, 0.3) * dash + coGlow(dh, wCore * 1.2, halo, 0.3)) * 0.9;
    }
  }
  // The shock: a ring of light in the beam's plane sweeping out from the vertex through everything.
  float shockR = age * 7.0;
  float shockB = energy * exp(-age * 3.2) * smoothstep(0.0, 0.3, shockR);
  vec3 shock = vec3(0.0);
  if (!bubble && shockB > 0.01 && shockR < 5.5) {
    float dr = coRing(normalize(coF + (coQ.x * coR + coQ.y * coU) / coK), shockR, ev.w);
    vec3 sc = style == 1 ? vec3(0.8, 0.5, 1.0) : style == 0 ? vec3(0.75, 0.85, 1.0) : vec3(1.0);
    shock = sc * coGlow(dr, 0.7 * coUnit, (5.0 + 12.0 * age) * coUnit, 0.6) * shockB * 0.8;
  }
  // Bubble chamber: the beam particle that came in along the beam's line and struck.
  if (bubble) {
    vec2 sd = coSeg(coQ, coProj(coCam(vec3(-2.7, 0.0, ev.w))), vp);
    col += vec3(1.0, 0.95, 0.86) * coGlow(sd.x, wCore, halo, 0.3) * 0.5 * smoothstep(0.0, 0.1, sd.y);
  }
  // The vertex's flash: a point and a star of spikes.
  float fl = energy * exp(-age * 7.0);
  vec2 dv = coQ - vp;
  float rv = length(dv) / coUnit;
  float spikes = pow(abs(cos(atan(dv.y, dv.x + 1e-4) * 3.0)), 80.0) * exp(-rv / 40.0);
  col += (style == 1 ? vec3(0.9, 0.7, 1.0) : vec3(1.0, 0.95, 0.85)) * fl * (exp(-rv / 3.0) * 2.0 + exp(-rv / 14.0) * 0.25 + spikes * 0.35);
  return col * env + shock;
}

// Bubble chamber: the beam's tracks crossing the chamber, parallel, and the chamber's window and fiducial crosses.
vec3 coChamber(vec3 rd, float bright) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    float y = (float(i) - 3.0) * 0.32 + 0.05;
    vec2 a = coProj(coCam(vec3(-2.6, y, 0.0)));
    vec2 b = coProj(coCam(vec3(2.6, y, 0.0)));
    vec2 sd = coSeg(coQ, a, b);
    col += vec3(0.9, 0.9, 0.85) * coGlow(sd.x, 0.4 * coUnit, 2.0 * coUnit, 0.3) * (0.12 + 0.3 * sBass) * smoothstep(0.0, 0.1, sd.y) * smoothstep(1.0, 0.9, sd.y);
  }
  float ring = coRing(rd, 2.75, 0.0);
  col += vec3(0.8) * coGlow(ring, 0.5 * coUnit, 3.0 * coUnit, 0.4) * (0.1 + 0.25 * sLevel);
  return col * bright;
}

vec3 scene(vec2 uv) {
  // Portrait sees the barrel standing up; landscape turns it on its side.
  coR = camRight;
  coU = camUp;
  if (ratio > 1.0) {
    coR = camUp;
    coU = -camRight;
  }
  coF = camFwd;
  coMx = vec3(coR.x, coU.x, coF.x);
  coMy = vec3(coR.y, coU.y, coF.y);
  coMz = vec3(coR.z, coU.z, coF.z);
  float shortSide = min(resolution.x, resolution.y);
  coK = shortSide / (2.0 * camLens);
  coUnit = shortSide / 1080.0;
  coQ = (uv - 0.5) * resolution;
  vec3 rd = normalize(coF + (coQ.x * coR + coQ.y * coU) / coK);
  coSetup();
  vec3 col = vec3(0.0);
  float det = detector;
  if (style == 2) {
    col += coChamber(rd, det);
  } else {
    col += coShells(rd, det);
    col += coMuonSystem(det);
    col += coTowers(rd, smoothstep(0.0, 0.5, det));
    col += coBeam(1.0);
  }
  for (int e = 0; e < 4; e++) col += coEvent(e);
  return col;
}
`,
  init: () => ({ time: 0, orbit: 0.4, tour: 0, dist: 15, kick: 0, kickTarget: 0, clock: 0, breath: 0, events: [], rng: { seed: 0xc011de5 } }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    s.time += dt;
    s.orbit = wrap(s.orbit + dt * (0.07 + 0.06 * a.level), 0, Math.PI * 2);
    s.tour = wrap(s.tour + dt / VIEW_SECONDS, 0, VIEWS.length);
    s.clock = wrap(s.clock + dt * (0.6 + 1.2 * a.level), 0, 64);
    s.breath = smoothTo(s.breath, a.punch, frame.dt, 0.08);
    s.dist = smoothTo(s.dist, 15.5 - 1.2 * a.level, frame.dt, 1.5);
    if (a.onBeat) s.kickTarget = Math.max(s.kickTarget, 0.5 + 0.5 * clamp01(frame.hit));
    s.kickTarget = smoothTo(s.kickTarget, 0, frame.dt, 0.2);
    s.kick = smoothTo(s.kick, s.kickTarget, frame.dt, 0.07);
    for (const e of s.events) e.age += frame.dt;
    s.events = s.events.filter((e) => e.age < LIFE);
    if (a.onBeat) {
      const hit = clamp01(frame.hit);
      s.events.push({ seed: Math.floor(random(s.rng) * 4096), age: 0, energy: 0.25 + 0.75 * hit * hit, z: (random(s.rng) - 0.5) * 0.24 });
      if (s.events.length > EVENTS) s.events.shift();
    }
  },
  uniforms(s, frame) {
    const i = Math.floor(s.tour);
    const from = VIEWS[i % VIEWS.length];
    const to = VIEWS[(i + 1) % VIEWS.length];
    const blend = smoothstep(0.6, 1, s.tour - i);
    const tourElev = from.elev + (to.elev - from.elev) * blend;
    // A bubble chamber is photographed along its field: its tour keeps near that.
    const elev = ((frame.values.style === "bubble" ? 55 + 0.35 * (tourElev - 7) : tourElev) * Math.PI) / 180;
    const dist = s.dist * (from.dist + (to.dist - from.dist) * blend) - 2.2 * s.kick;
    const az = s.orbit;
    const pos: Vec3 = [Math.cos(elev) * Math.cos(az) * dist, Math.cos(elev) * Math.sin(az) * dist, Math.sin(elev) * dist];
    const fwd: Vec3 = [-pos[0] / dist, -pos[1] / dist, -pos[2] / dist];
    // Up is the beam's way, seen from here (the meridian's tangent): never degenerate, even end on.
    const up: Vec3 = [-Math.sin(elev) * Math.cos(az), -Math.sin(elev) * Math.sin(az), Math.cos(elev)];
    const roll = 0.08 * Math.sin(s.time * 0.21 + 0.3);
    const events = Array.from({ length: EVENTS }, (_, k) => s.events[k]);
    return [
      ...cameraLooking(pos, fwd, roll, 19, up),
      ...soundUniforms(frame),
      ...events.map((e, k) => vec4(`coEv${k}`, e ? [e.seed, e.age, e.energy, e.z] : [0, 0, 0, 0])),
      vec4("coDrive", [s.clock, s.breath, s.kick, num(frame.values, "field", 1)]),
    ];
  },
};
