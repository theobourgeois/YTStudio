/**
 * Galaxy (docs/visualizer/scenes.md, "Five more, again"): a tour of a spiral galaxy, light on black. The galaxy is
 * a volume marched front to back, only inside its slab and disk (the ray meets them analytically), in steps sized
 * by what changes there: short near the plane, the core and close by, long through its thin outskirts, the start
 * jittered per pixel so nothing bands. Its light is old stars (a warm exponential disk and a flattened bulge,
 * brightest at a point-like core drawn after the march), young ones along the arms (a logarithmic spiral warped by
 * noise, brighter and fainter along its length, throwing spurs into the gaps; blue-white, in clumps and clusters
 * no smaller than a pixel) and pink knots where stars are being born; its dust lanes run along the arms' inner
 * edges and on into the bulge, filamented, and absorb, reddening what's behind, so they stand dark against the core.
 * Clusters are balls of light whose share of each step is integrated exactly, so they never turn to grain. Seen
 * from close by, the disk's structure resolves (darker gaps, arms in clumps) and its starlight is stars, not glow:
 * resolved, one or none in each cell a 3D DDA crosses, by the disk's density there. The pattern turns rigidly, as
 * a density wave does. Behind it are faint galaxies and stars, which Stars turns off; nothing else is drawn, so
 * Screen or Add lays it over footage.
 * Stepped: the camera's tour (poses eased through by a Catmull-Rom spline: high over the spiral, down onto the disk,
 * skimming the arms with the bulge and its dust lanes ahead, out to see it edge-on, and round; hits nudge it along),
 * the galaxy's turn, the core's glow on the level, the supernovae each hit sets off in the arms in view (a
 * blue-white flare with diffraction spikes that lights the dust round it and fades), and the knots the hits launch
 * up the quasar's jets, which pulse with the punch. The arms hear the spectrum in the GLSL, by radius: the bass at
 * the core, the highs at the rim.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraUniforms, clamp01, float, normalize, random, sceneDt, smoothTo, soundUniforms, sub, vec4, wrap } from "./kit.ts";

const TAU = Math.PI * 2;
/** The disk's radius (the march's bounds, with the slab's half-height, GX_H). */
const RADIUS = 13;
/** The arms' pitch (the tangent of the angle they wind at). */
const PITCH = 0.32;
/** Supernovae and jet knots alive at once, at most. */
const NOVAE = 5;
const KNOTS = 4;
/** One tour round, in the tour's own seconds (hits nudge it along, so with music it's quicker). */
const TOUR = 52;

/** A pose of the tour: the camera at radius `rho`, angle `az` and height `h`; what it looks at; its lens and roll. */
type Pose = [rho: number, az: number, h: number, tx: number, ty: number, tz: number, fov: number, roll: number];
/** The tour, a loop: each pose at its time; after the last it comes round to the first, once further round. */
const KEYS: [number, Pose][] = [
  // High over the spiral, a little off its axis.
  [0, [8, 0.0, 19, 0, 0, 0, 52, 0.55]],
  [9, [14, 0.6, 11, 0, 0, 0, 52, 0.35]],
  // Down onto the disk.
  [16, [12.5, 1.2, 4.2, 0, -0.2, 0, 54, 0.2]],
  // Skimming the arms, high enough that their pattern reads in perspective, the bulge and its lanes ahead.
  [22, [8.5, 1.75, 2.1, 0, -0.4, 0, 60, 0.08]],
  [28, [6.4, 2.45, 1.5, 0, -0.3, 0, 62, -0.06]],
  // Rising and swinging out.
  [33, [8, 3.05, 2.2, 0, 0, 0, 58, 0.1]],
  // Edge-on from afar: the dust lane across the bulge, the jets.
  [41, [27, 3.6, 2.0, 0, 0.1, 0, 38, 0.95]],
];

const keyAt = (j: number): { t: number; v: number[] } => {
  const n = KEYS.length;
  const lap = Math.floor(j / n);
  const [t, pose] = KEYS[((j % n) + n) % n];
  const v = [...pose];
  v[1] += lap * TAU;
  return { t: t + lap * TOUR, v };
};

/** The tour's pose at `u` seconds into it (Catmull-Rom through the keys, so it never stops at one). */
export function tourPose(u: number): Pose {
  const n = KEYS.length;
  let i = n - 1;
  while (i > 0 && KEYS[i][0] > u) i--;
  const [p0, p1, p2, p3] = [keyAt(i - 1), keyAt(i), keyAt(i + 1), keyAt(i + 2)];
  const span = p2.t - p1.t;
  const s = (u - p1.t) / span;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return p1.v.map((a, k) => {
    const m1 = ((p2.v[k] - p0.v[k]) / (p2.t - p0.t)) * span;
    const m2 = ((p3.v[k] - p1.v[k]) / (p3.t - p1.t)) * span;
    return h00 * a + h10 * m1 + h01 * p2.v[k] + h11 * m2;
  }) as Pose;
}

const posOf = (p: Pose): Vec3 => [p[0] * Math.cos(p[1]), p[2], p[0] * Math.sin(p[1])];

interface Nova {
  /** Where, in the galaxy's turning frame (radius, angle, height: just over the dust, among the young stars). */
  r: number;
  th: number;
  y: number;
  age: number;
  power: number;
}

interface Knot {
  age: number;
  power: number;
}

interface GalaxyState {
  /** Seconds into the tour (wrapped), and a hit's nudge along it. */
  tour: number;
  push: number;
  /** The disk's turn (wrapped). */
  spin: number;
  /** The core's glow (the level) and the jets' (the punch), followed. */
  core: number;
  jet: number;
  novae: Nova[];
  knots: Knot[];
  rng: { seed: number };
}

/** A supernova's brightness at an age: a flash, a bright peak settling, then fading over a few seconds. */
const novaLight = (age: number, power: number) => {
  const rise = 1 - Math.exp(-(age + 1 / 30) / 0.03);
  const settle = 0.4 + (power * 6 - 0.4) * Math.exp(-age / 0.3);
  const fade = age > 1.5 ? Math.exp(-(age - 1.5) / 0.8) : 1;
  return rise * settle * fade;
};

/** A jet knot's height up the axis and its brightness (racing out, fading). */
const knotAt = (k: Knot | undefined): [number, number] => (k ? [0.2 + k.age * 2.6, k.power * Math.exp(-k.age / 0.9) * clamp01(k.age / 0.08)] : [0, 0]);

/** How many arms the Arms value means. */
const armsOf = (v: unknown) => (v === "four" ? 4 : v === "two" ? 2 : 3);

export const GALAXY: SceneSpec<GalaxyState> = {
  type: "galaxy",
  label: "Galaxy",
  params: [
    {
      kind: "choice",
      key: "palette",
      label: "Palette",
      default: "hubble",
      options: [
        { value: "hubble", label: "Hubble" },
        { value: "andromeda", label: "Andromeda" },
        { value: "neon", label: "Neon" },
      ],
    },
    {
      kind: "choice",
      key: "arms",
      label: "Arms",
      default: "three",
      options: [
        { value: "two", label: "2" },
        { value: "three", label: "3" },
        { value: "four", label: "4" },
      ],
    },
    { kind: "number", key: "dust", label: "Dust", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "stars", label: "Stars", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  audio: () => ({ rows: 1, span: 0, fall: 0.2, window: 0 }),
  glsl: /* glsl */ `
uniform float gxSpin;
uniform float gxCore;
uniform float gxJet;
uniform vec4 gxKnotA;
uniform vec4 gxKnotB;
uniform vec4 gxNova0;
uniform vec4 gxNova1;
uniform vec4 gxNova2;
uniform vec4 gxNova3;
uniform vec4 gxNova4;

const float GX_R = ${RADIUS.toFixed(1)};
const float GX_H = 2.6;
const float GX_PITCH = ${PITCH.toFixed(3)};
const int GX_NOVAE = ${NOVAE};

vec3 gxOld;
vec3 gxYoung;
vec3 gxHii;
vec3 gxBulge;
vec3 gxNovaCol;
vec3 gxJetCol;
mat2 gxSpinM;
vec3 gxRd;
vec3 gxRdQ;
vec4 gxN[GX_NOVAE];

// A halo's falloff to nothing by reach (a 1/r² glow left alone lifts the whole frame's black).
float gxWindow(float r, float reach) { float x = clamp(r / reach, 0.0, 1.0); return (1.0 - x * x) * (1.0 - x * x); }

mat2 gxRot(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }

// Value fbm in the plane, detail octaves (the last faded in by its fraction), 0..1.
float gxFbm2(vec2 p, float detail) {
  detail = max(detail, 1.0);
  int octaves = int(ceil(detail));
  float a = 0.0;
  float b = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 7; i++) {
    if (i >= octaves) break;
    float n = vnoise2d(p).x;
    a += b * mix(0.5, n, clamp(detail - float(i), 0.0, 1.0));
    norm += b;
    p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + vec2(1.7, 9.2);
    b *= 0.5;
  }
  return a / norm;
}

// The same in 3D (for what isn't a column through the disk: knots, dust filaments).
float gxFbm3(vec3 p, float detail) {
  detail = max(detail, 1.0);
  int octaves = int(ceil(detail));
  float a = 0.0;
  float b = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    a += b * mix(0.5, vnoise3(p), clamp(detail - float(i), 0.0, 1.0));
    norm += b;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    b *= 0.5;
  }
  return a / norm;
}

void gxPalette() {
  if (palette == 1) {
    gxOld = vec3(1.0, 0.6, 0.3);
    gxYoung = vec3(0.62, 0.74, 1.0);
    gxHii = vec3(1.0, 0.45, 0.32);
    gxBulge = vec3(1.0, 0.66, 0.36);
    gxNovaCol = vec3(0.85, 0.9, 1.0);
    gxJetCol = vec3(0.7, 0.72, 1.0);
  } else if (palette == 2) {
    gxOld = vec3(0.3, 0.55, 1.0);
    gxYoung = vec3(1.0, 0.18, 0.75);
    gxHii = vec3(0.2, 1.0, 0.95);
    gxBulge = vec3(0.55, 0.85, 1.0);
    gxNovaCol = vec3(0.7, 1.0, 1.0);
    gxJetCol = vec3(0.45, 0.9, 1.0);
  } else {
    gxOld = vec3(1.0, 0.8, 0.55);
    gxYoung = vec3(0.5, 0.68, 1.0);
    gxHii = vec3(1.0, 0.3, 0.55);
    gxBulge = vec3(1.0, 0.82, 0.58);
    gxNovaCol = vec3(0.75, 0.88, 1.0);
    gxJetCol = vec3(0.55, 0.6, 1.0);
  }
}

// The arms' phase at q (turning frame): crests where cos is 1; warped by noise, so they're not ruled curves.
float gxPsi(vec2 q, float r) {
  float m = float(arms + 2);
  float warp = gxFbm2(q * 0.2 + vec2(3.1, 7.4), 2.0) - 0.5;
  return m * atan(q.y, q.x) - (m / GX_PITCH) * log(max(r, 0.15)) + warp * 2.4;
}
// How much arm there is at q (0..1 or so): the crests, brighter and fainter along their length, and spurs, a more
// open spiral, feathering out into the gaps in pieces.
float gxArm(vec2 q, float r, float psi) {
  float wave = max(0.5 + 0.5 * cos(psi), 0.0);
  float arm = wave * wave * sqrt(wave) * (0.4 + 1.2 * gxFbm2(q * 0.3 + vec2(17.0, 5.0), 2.0));
  float m2 = float(arms + 2) * 2.0;
  float sw = max(0.5 + 0.5 * cos(m2 * atan(q.y, q.x) - (m2 / 0.85) * log(max(r, 0.15)) + psi * 0.35), 0.0);
  sw *= sw;
  float spur = sw * sw * smoothstep(0.5, 0.7, gxFbm2(q * 0.55 + vec2(2.0, 13.0), 2.0)) * (1.0 - wave);
  return (arm + 0.45 * spur) * smoothstep(0.5, 2.0, r);
}

// The error function (Winitzki's approximation, within about 1e-4).
float gxErf(float x) {
  float x2 = x * x;
  return sign(x) * sqrt(1.0 - exp(-x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2)));
}

// One cluster, the ball of cell c (its size, layer l), if it has one: its light averaged over this step's stretch
// of the ray (from (q, y), dt long), exactly (a Gaussian along a line is an erf), so the march's steps, however long,
// never sample it by chance into grain.
float gxBall(vec2 c, float l, float size, vec2 q, float y, float thick, float fp, float dt, float arm) {
  vec3 h = hash33(vec3(c, l * 7.0 + 3.0));
  // (Whether it has one is read where the ray is, so it's soft: a hard test would switch it pixel by pixel.)
  float has = smoothstep(h.z - 0.08, h.z + 0.08, arm * 0.9);
  if (has <= 0.0) return 0.0;
  // A ball at a height in the young stars' layer (in (q, height) order, as gxRdQ is).
  vec3 at = vec3((c + 0.25 + 0.5 * h.xy) * size, (hash12(c + 4.7) - 0.5) * thick);
  float rad = size * 0.09;
  float spread = max(rad, fp * 0.8);
  vec3 inv = vec3(1.0 / spread);
  vec3 u0 = (vec3(q, y) - at) * inv;
  vec3 v = gxRdQ * inv;
  float vv = dot(v, v);
  float sv = sqrt(vv);
  float b = dot(u0, v) / vv;
  float miss = max(dot(u0, u0) - b * b * vv, 0.0);
  if (miss > 12.0) return 0.0;
  float seg = exp(-miss) * 0.8862 * (gxErf(sv * (dt + b)) - gxErf(sv * b)) / (sv * dt);
  // (Per unit length of the march: a ball's light, its column's worth at its middle.)
  return has * (rad * rad) / (spread * spread * spread) * seg * (0.3 + 2.5 * pow(hash12(c + 9.1), 4.0));
}

// Star clusters in the plane (q, the turning frame): a ball of light in some cells of five sizes, more of them
// where the arms are (arm, 0..1); the cells at both ends of the step's stretch, so a ball the step starts beside
// isn't missed. fp is a pixel's footprint: a cluster is never drawn smaller than a pixel (it spreads, its light
// kept) and cells too small to see fade out, so they never alias into noise.
float gxClusters(vec2 q, float y, float thick, float fp, float dt, float arm) {
  float sum = 0.0;
  float size = 0.7;
  vec2 q1 = q + gxRdQ.xy * dt;
  for (int l = 0; l < 5; l++) {
    // Cells too small to see from here, and all finer ones, are left out.
    if (size < fp * 2.0) break;
    float keep = smoothstep(fp * 2.0, fp * 4.0, size);
    vec2 c0 = floor(q / size);
    vec2 c1 = floor(q1 / size);
    float lit = gxBall(c0, float(l), size, q, y, thick, fp, dt, arm);
    if (c1 != c0) lit += gxBall(c1, float(l), size, q, y, thick, fp, dt, arm);
    sum += keep * lit;
    size *= 0.5;
  }
  return sum;
}

// The galaxy at p: its light (returned) and its dust's density (dust); fp is a pixel's footprint there.
vec3 gxMedium(vec3 p, float t, float fp, float dt, out float dustOut) {
  vec2 q = gxSpinM * p.xz;
  float r = length(q);
  float ay = abs(p.y);
  // The disk flares, thicker outwards.
  float hz = 1.0 + 0.07 * r;
  float detail = clamp(log2(0.6 / max(fp, 1e-4)), 1.0, 6.0);
  float psi = gxPsi(q, r);
  float edge = 1.0 - smoothstep(GX_R * 0.5, GX_R, r);
  float armC = gxArm(q, r, psi);
  // Dust lanes hug the arms' inner edges (and wind on into the bulge, as M51's do).
  float lw = max(0.5 + 0.5 * cos(psi - 0.6), 0.0);
  lw *= lw;
  float laneC = lw * lw * lw * smoothstep(0.25, 1.0, r);
  // Clumps of young stars, knots where they're being born, and clusters.
  vec3 g = vec3(q.x, p.y, q.y);
  float clump = gxFbm2(q * 1.4 + vec2(5.0, 1.0), detail);
  float knot = smoothstep(0.62, 0.76, gxFbm3(g * vec3(2.6, 3.0, 2.6) + vec3(11.0, 3.0, 0.0), min(detail - 1.0, 4.0)));
  float vYoung = exp(-ay / (0.07 * hz));
  // The arms' brightness by radius is the spectrum: the bass at the core, the highs at the rim.
  float band = 0.5 + 1.0 * spectrum(clamp(0.04 + r / GX_R * 0.85, 0.0, 1.0));
  // Seen from close by (t: within a dozen units), the disk's structure resolves: its gaps darker, its arms in clumps
  // with dark between them. From afar both blur into the smoother glow a telescope sees.
  float close = 1.0 - smoothstep(5.0, 14.0, t);
  float floorOld = mix(0.5, mix(0.55, 0.15, smoothstep(1.5, 5.0, r)), close);
  float old = exp(-r / 2.4) * edge * exp(-ay / (0.2 * hz)) * (floorOld + mix(0.7, 0.8, close) * armC);
  float clumps = mix(0.35 + 1.8 * clump * clump, 0.12 + 1.9 * smoothstep(0.36, 0.72, clump), close);
  // (Stars are born just past the lanes, not in them.)
  float young = exp(-r / 6.0) * edge * vYoung * armC * clumps * band * (1.0 - 0.7 * laneC);
  // Close to the lens, starlight isn't a glow but stars, resolved (gxNearStars): the glow fades there.
  float near = mix(0.15, 1.0, smoothstep(0.8, 6.0, t));
  old *= near;
  young *= near;
  float cl = gxClusters(q, p.y, 0.1 * hz, fp, dt, armC * (0.4 + clump)) * exp(-r / 6.0) * edge * band;
  float hii = young * knot * armC * 7.0;
  // The bulge: a flattened core of old stars (the point-like core is drawn after the march).
  float rb = length(p * vec3(1.0, 1.65, 1.0));
  // (Faded to nothing inside the slab, whose bounds would otherwise cut it with a line.)
  float bulge = (1.4 / pow(1.0 + rb * rb / 0.15, 1.5) + 0.3 * exp(-rb / 0.9)) * (1.0 - smoothstep(1.2, GX_H * 0.95, ay));
  vec3 col = gxOld * old * 0.45 + gxYoung * (young * 1.5 + cl * 0.4) + gxHii * hii * 1.6 + gxBulge * bulge * (0.8 + 0.6 * gxCore);
  // Dust: lanes and patches, filamented (ridged noise), in a layer thinner than the young stars'.
  // (Gentle in height and no finer than the march's steps resolve: undersampled dust is grain in all behind it.)
  float fn = gxFbm3(g * vec3(1.8, 1.6, 1.8) + vec3(4.0, 0.0, 2.0), min(detail - 0.5, 3.0));
  float fil = 1.0 - abs(2.0 * fn - 1.0);
  float patchy = smoothstep(0.35, 0.65, gxFbm2(q * 0.7 + vec2(8.0, 2.0), 2.0));
  // (The lanes densest where they wind into the bulge, so they stand in silhouette against it.)
  float lanes = laneC * (20.0 + 25.0 * (1.0 - smoothstep(1.2, 4.0, r)));
  float dd = exp(-r / 6.5) * edge * exp(-ay / (0.055 * hz)) * smoothstep(0.4, 1.6, r) * (lanes + 0.4 * armC * patchy + 0.08 * patchy) * fil * fil;
  // (Andromeda's dust is heavier: its rings stand out.)
  dustOut = dd * dust * (palette == 1 ? 1.5 : 1.0);
  // The supernovae light the dust and gas round them.
  for (int k = 0; k < GX_NOVAE; k++) {
    if (gxN[k].w <= 0.0) continue;
    vec3 d = p - gxN[k].xyz;
    float d2 = dot(d, d);
    float l = gxN[k].w / (1.0 + d2 * 10.0);
    // (And a glow of its own round it, gone within a unit or two: the slab's bounds mustn't show.)
    col += gxNovaCol * (l * (dd * 1.5 + young * 0.5) + gxN[k].w * 0.01 * exp(-d2 * 1.5));
  }
  return col;
}

// Faint far galaxies and stars behind it all (Stars sets them; nothing else lifts the black).
vec3 gxSky(vec3 rd, float px) {
  vec3 col = vec3(0.0);
  for (int l = 0; l < 2; l++) {
    float cells = 140.0 + float(l) * 190.0;
    vec3 c = floor(rd * cells);
    float h = hash13(c + float(l) * 31.0);
    if (h > 0.985) {
      vec3 sp = normalize(c + 0.25 + 0.5 * hash33(c)) * cells;
      float dist = length(sp - rd * cells);
      float sig = max(0.05, px * cells * 0.7);
      float mag = pow(hash13(c + 5.3), 6.0) * 3.0 + 0.08;
      vec3 tint = mix(vec3(1.0, 0.78, 0.6), vec3(0.7, 0.82, 1.0), hash13(c + 2.1));
      col += tint * mag * (0.0025 / (sig * sig)) * exp(-dist * dist / (sig * sig));
    }
  }
  // Far galaxies: small smudges, a few to the sky.
  vec3 gc = floor(rd * 20.0);
  if (hash13(gc + 7.0) > 0.88) {
    vec3 h = hash33(gc + 3.0);
    vec3 cen = normalize(gc + 0.2 + 0.6 * h);
    vec3 o = rd - cen * dot(rd, cen);
    vec3 ax = normalize(cross(cen, hash33(gc + 9.0) - 0.5));
    float a = dot(o, ax);
    float b = length(o - ax * a) / (0.35 + 0.6 * h.z);
    float size = 0.0025 + 0.004 * h.y;
    float g = exp(-(a * a + b * b) / (size * size));
    col += mix(vec3(1.0, 0.85, 0.65), vec3(0.75, 0.85, 1.0), h.x) * g * 0.035;
  }
  return col * stars;
}

// Stars near the camera, resolved: one or none in each cell the ray crosses (a 3D DDA from where it enters the
// galaxy), likelier where the disk is dense; never smaller than a pixel, faded out with distance into the glow
// they're part of. Each is put in a bin by its depth (bins double from the galaxy's edge), dimmed later by the dust
// in front of it.
const float GX_CELL = 0.22;
void gxNearStars(vec3 ro, vec3 rd, float t0, float t1, float pxA, inout vec3 bins[6]) {
  int cells = int(mix(20.0, 56.0, quality));
  vec3 p = ro + rd * t0;
  vec3 c = floor(p / GX_CELL);
  vec3 stepDir = sign(rd);
  vec3 inv = 1.0 / max(abs(rd), 1e-5);
  vec3 tMax = ((c + max(stepDir, 0.0)) * GX_CELL - p) * stepDir * inv;
  vec3 tDelta = GX_CELL * inv;
  for (int i = 0; i < 56; i++) {
    if (i >= cells) break;
    vec3 h = hash33(c + 41.0);
    vec3 at = (c + 0.2 + 0.6 * h) * GX_CELL;
    float r = length(at.xz);
    // Old stars in a thick disk; young ones, blue, thin and along the arms (the arms turn with the disk).
    vec2 aq = gxSpinM * at.xz;
    float arm = gxArm(aq, r, gxPsi(aq, r));
    float edgeS = 1.0 - smoothstep(GX_R * 0.5, GX_R, r);
    float oldD = exp(-r / 3.2) * exp(-abs(at.y) / (0.25 + 0.03 * r));
    float youngD = 1.6 * arm * exp(-r / 6.0) * exp(-abs(at.y) / (0.09 + 0.01 * r));
    float dens = (oldD + youngD) * edgeS;
    float pick = hash13(c + 13.0);
    if (pick < dens) {
      vec3 v = at - ro;
      float along = dot(v, rd);
      if (along > 0.05) {
        float perp2 = max(dot(v, v) - along * along, 0.0);
        float ang2 = perp2 / (along * along);
        float sig = pxA * 0.85;
        float mag = 0.15 + 3.0 * pow(hash13(c + 7.7), 6.0);
        float fade = 1.0 - smoothstep(3.5, 7.0, along);
        vec3 tint = hash13(c + 2.9) * (oldD + youngD) < youngD ? mix(gxYoung, vec3(1.0), 0.35) : mix(gxOld, vec3(1.0), 0.3);
        float I = mag * fade / (along * along * 0.06 + 0.05) * exp(-ang2 / (sig * sig));
        int k = int(clamp(floor(log2(max((along - t0) / 0.3, 1.0))), 0.0, 5.0));
        for (int b = 0; b < 6; b++) if (b == k) bins[b] += tint * I * stars;
      }
    }
    // The next cell along the ray.
    if (tMax.x < tMax.y && tMax.x < tMax.z) { c.x += stepDir.x; tMax.x += tDelta.x; }
    else if (tMax.y < tMax.z) { c.y += stepDir.y; tMax.y += tDelta.y; }
    else { c.z += stepDir.z; tMax.z += tDelta.z; }
    if (min(tMax.x, min(tMax.y, tMax.z)) + t0 > min(t1, t0 + 8.0)) break;
  }
}

vec3 scene(vec2 uv) {
  gxPalette();
  gxSpinM = gxRot(gxSpin);
  gxN[0] = gxNova0; gxN[1] = gxNova1; gxN[2] = gxNova2; gxN[3] = gxNova3; gxN[4] = gxNova4;
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  gxRd = rd;
  // (The ray in the turning frame, for what's placed there.)
  gxRdQ = vec3(gxSpinM * rd.xz, rd.y);
  float pxA = 2.0 * camLens / min(resolution.x, resolution.y);
  // The march's bounds: the slab, then the disk's cylinder.
  float t0 = 0.0;
  float t1 = -1.0;
  if (abs(rd.y) > 1e-5) {
    float a = (GX_H - ro.y) / rd.y;
    float b = (-GX_H - ro.y) / rd.y;
    t0 = max(min(a, b), 0.0);
    t1 = max(a, b);
  } else if (abs(ro.y) < GX_H) t1 = 1e4;
  vec2 o = ro.xz;
  vec2 d = rd.xz;
  float A = dot(d, d);
  float B = dot(o, d);
  float C = dot(o, o) - GX_R * GX_R;
  float disc = B * B - A * C;
  if (A > 1e-8 && disc > 0.0) {
    float sq = sqrt(disc);
    t0 = max(t0, (-B - sq) / A);
    t1 = min(t1, (-B + sq) / A);
  } else if (C > 0.0) t1 = -1.0;
  // The jets: where the ray passes closest to the galaxy's axis (tj along it, sj up the axis), and how close.
  float jb = rd.y;
  float jd = dot(rd, ro);
  float jden = max(1.0 - jb * jb, 1e-4);
  float tj = (jb * ro.y - jd) / jden;
  float sj = (ro.y - jb * jd) / jden;
  float jdist = length(ro + rd * tj - vec3(0.0, sj, 0.0));
  // Depths of what's drawn after the march, so the dust in front of each dims it: the core, the jets, the novae,
  // then the near stars' bins.
  const int GX_MARKS = GX_NOVAE + 8;
  float tsd[GX_MARKS];
  vec3 Ts[GX_MARKS];
  tsd[0] = dot(-ro, rd);
  tsd[1] = tj;
  for (int k = 0; k < GX_NOVAE; k++) tsd[k + 2] = dot(gxN[k].xyz - ro, rd);
  for (int k = 0; k < 6; k++) tsd[GX_NOVAE + 2 + k] = t0 + 0.3 * exp2(float(k));
  vec3 bins[6];
  for (int k = 0; k < 6; k++) bins[k] = vec3(0.0);
  if (t1 > t0 && t0 < 7.0 && stars > 0.0) gxNearStars(ro, rd, t0, t1, pxA, bins);
  for (int k = 0; k < GX_MARKS; k++) Ts[k] = vec3(1.0);
  vec3 col = vec3(0.0);
  vec3 T = vec3(1.0);
  // Dust reddens what's behind it: blue is lost first.
  vec3 ext = vec3(0.6, 0.8, 1.0) * 8.0;
  if (t1 > t0) {
    int steps = int(mix(48.0, 140.0, quality));
    float t = t0;
    float jitter = hash12(gl_FragCoord.xy);
    float planar = max(length(rd.xz), 0.02);
    for (int i = 0; i < 140; i++) {
      if (i >= steps || t >= t1 || max(T.r, max(T.g, T.b)) < 0.01) break;
      vec3 p = ro + rd * t;
      float fp = t * pxA;
      // Steps as short as what changes here: the disk's profile, its structure in the plane, the core.
      float dtV = (0.022 + 0.45 * abs(p.y)) / max(abs(rd.y), 0.02);
      float dtP = max(0.1, fp * 2.0) / planar;
      float dtC = 0.03 + 0.3 * length(p);
      float dt = min(min(dtV, dtP), dtC);
      dt = max(dt, (t1 - t) / float(steps - i));
      if (i == 0) { t += dt * jitter; p = ro + rd * t; }
      float dd;
      vec3 e = gxMedium(p, t, fp, dt, dd);
      vec3 sig = ext * dd;
      vec3 a = exp(-sig * dt);
      vec3 w = vec3(sig.r > 1e-4 ? (1.0 - a.r) / sig.r : dt, sig.g > 1e-4 ? (1.0 - a.g) / sig.g : dt, sig.b > 1e-4 ? (1.0 - a.b) / sig.b : dt);
      col += T * e * w;
      T *= a;
      for (int k = 0; k < GX_MARKS; k++) if (tsd[k] >= t && tsd[k] < t + dt) Ts[k] = T;
      t += dt;
    }
    for (int k = 0; k < GX_MARKS; k++) if (tsd[k] >= t) Ts[k] = T;
  }
  // The core: a point of light at the heart, blooming.
  vec3 v = -ro;
  float vz = dot(v, rd);
  if (vz > 0.0) {
    float miss = length(v - rd * vz) / vz;
    float c = (0.0004 / (miss * miss + 0.0004 + pxA * pxA)) * 1.5 * gxWindow(miss, 0.25) + exp(-miss * miss / (0.0025)) * 0.3;
    col += Ts[0] * gxBulge * c * (0.6 + 0.8 * gxCore);
  }
  for (int k = 0; k < 6; k++) col += Ts[GX_NOVAE + 2 + k] * bins[k];
  // The jets: two thin beams up and down the axis, widening, pulsing with the punch; knots the hits launch race up
  // them. Never thinner than a pixel (their light kept).
  if (tj > 0.0) {
    float h = abs(sj);
    float width = 0.01 + 0.012 * h;
    float spread = max(width, tj * pxA * 0.7);
    float beam = smoothstep(0.1, 0.6, h) * (1.0 - smoothstep(2.5, 5.5, h)) * exp(-h / (0.6 + 1.6 * gxJet)) * gxJet * gxJet;
    float knots = 0.0;
    for (int k = 0; k < 2; k++) {
      vec2 a = k == 0 ? gxKnotA.xy : gxKnotB.xy;
      vec2 b = k == 0 ? gxKnotA.zw : gxKnotB.zw;
      float wa = 0.12 + 0.06 * a.x;
      float wb = 0.12 + 0.06 * b.x;
      knots += (1.0 - smoothstep(4.0, 7.0, h)) * (a.y * exp(-(h - a.x) * (h - a.x) / (wa * wa)) + b.y * exp(-(h - b.x) * (h - b.x) / (wb * wb)));
    }
    float lit = (beam + knots) * 0.6;
    float x2 = jdist * jdist;
    float I = (width / spread) * exp(-x2 / (spread * spread)) + 0.02 * width / (x2 + width * width * 4.0) * gxWindow(jdist, 0.5);
    col += Ts[1] * gxJetCol * I * lit;
  }
  // The supernovae: a core, a glow and diffraction spikes.
  vec2 sp = vec2(dot(rd, camRight), dot(rd, camUp)) / (dot(rd, camFwd) * camLens);
  float px = 2.0 / min(resolution.x, resolution.y);
  for (int k = 0; k < GX_NOVAE; k++) {
    float w = gxN[k].w;
    if (w <= 0.0) continue;
    vec3 nv = gxN[k].xyz - ro;
    float nz = dot(nv, camFwd);
    if (nz <= 0.3) continue;
    vec2 off = sp - vec2(dot(nv, camRight), dot(nv, camUp)) / (nz * camLens);
    float size = clamp(w * 2.0 / length(nv), 0.02, 0.6);
    float r2 = dot(off, off);
    float core = exp(-r2 / (size * size * 0.0006 + px * px)) * 4.0;
    float halo = size * size * 0.003 / (r2 + size * size * 0.002) * gxWindow(sqrt(r2), size * 1.5);
    float wdt = max(0.0015 * size, px * 0.6);
    float len = 0.25 * size;
    float spikes = exp(-abs(off.y) / wdt) * exp(-abs(off.x) / len) * gxWindow(off.x, len * 5.0) + exp(-abs(off.x) / wdt) * exp(-abs(off.y) / len) * gxWindow(off.y, len * 5.0);
    col += pow(Ts[k + 2], vec3(0.4)) * gxNovaCol * (core + halo + spikes * 0.7) * min(w, 4.0);
  }
  col += T * gxSky(rd, pxA);
  return col;
}
`,
  init: () => ({ tour: 0, push: 0, spin: 0.4, core: 0.5, jet: 0, novae: [], knots: [], rng: { seed: 0x6a1a9 } }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    if (a.onBeat) s.push = Math.max(s.push, 0.5 * (0.6 + 0.4 * clamp01(frame.hit)));
    s.push = smoothTo(s.push, 0, frame.dt, 0.25);
    s.tour = wrap(s.tour + dt * (1 + s.push), 0, TOUR);
    s.spin = wrap(s.spin + dt * (0.03 + 0.02 * a.level), 0, TAU);
    s.core = smoothTo(s.core, a.level, frame.dt, 0.2);
    s.jet = smoothTo(s.jet, a.punch, frame.dt, 0.05);
    for (const n of s.novae) n.age += frame.dt;
    s.novae = s.novae.filter((n) => n.age < 4.5);
    for (const k of s.knots) k.age += frame.dt;
    s.knots = s.knots.filter((k) => k.age < 3);
    if (a.onBeat) {
      // A supernova in an arm, in view.
      const pose = tourPose(s.tour);
      const pos = posOf(pose);
      const fwd = normalize(sub([pose[3], pose[4], pose[5]], pos));
      // Looking down on the disk: round where the view meets it (anywhere in the arms if that's the core). Looking
      // along it: a little way ahead, near enough to flare over the disk below the bulge rather than be lost in its
      // glow, and within a portrait frame's width.
      let r: number;
      let thWorld: number;
      if (fwd[1] < -0.3) {
        const look = [pos[0] - (fwd[0] * pos[1]) / fwd[1], pos[2] - (fwd[2] * pos[1]) / fwd[1]];
        const lr = Math.hypot(look[0], look[1]);
        r = lr < 2 ? 3 + random(s.rng) * 5 : lr + (random(s.rng) - 0.5) * 1.5;
        thWorld = lr < 2 ? random(s.rng) * TAU : Math.atan2(look[1], look[0]) + ((random(s.rng) - 0.5) * 1.5) / r;
      } else {
        const flat = Math.hypot(fwd[0], fwd[2]) || 1;
        const ahead = 2.5 + random(s.rng) * 3;
        const side = (random(s.rng) - 0.5) * ahead * 0.7;
        const look = [pos[0] + (fwd[0] * ahead - fwd[2] * side) / flat, pos[2] + (fwd[2] * ahead + fwd[0] * side) / flat];
        r = Math.hypot(look[0], look[1]);
        thWorld = Math.atan2(look[1], look[0]);
      }
      // Into the turning frame (the GLSL's q = rot(spin) xz), then out or in onto the nearest arm (along the radius,
      // the shorter way: round the circle the next arm can be a long way off).
      const m = armsOf(frame.values.arms);
      const th = thWorld + s.spin;
      const n = Math.round((m * th - (m / PITCH) * Math.log(r)) / TAU);
      // (Only so far: up close, a nova off the arm is better than one out of sight.)
      const arm = Math.exp(((m * th - n * TAU) * PITCH) / m);
      const onArm = Math.max(2.2, Math.min(8.5, r + Math.max(-1.2, Math.min(1.2, arm - r))));
      s.novae.push({ r: onArm, th, y: 0.06 + random(s.rng) * 0.12, age: 0, power: 0.6 + 0.5 * clamp01(frame.hit) });
      if (s.novae.length > NOVAE) s.novae.shift();
      s.knots.push({ age: 0, power: 0.5 + 0.5 * clamp01(frame.hit) });
      if (s.knots.length > KNOTS) s.knots.shift();
    }
  },
  uniforms(s, frame) {
    const pose = tourPose(s.tour);
    const pos = posOf(pose);
    const novae = Array.from({ length: NOVAE }, (_, i) => {
      const n = s.novae[i];
      if (!n) return vec4(`gxNova${i}`, [0, 0, 0, 0]);
      // Back out of the turning frame.
      const th = n.th - s.spin;
      return vec4(`gxNova${i}`, [n.r * Math.cos(th), n.y, n.r * Math.sin(th), novaLight(n.age, n.power)]);
    });
    return [
      ...cameraUniforms(pos, [pose[3], pose[4], pose[5]], pose[7], pose[6]),
      ...soundUniforms(frame),
      float("gxSpin", s.spin),
      float("gxCore", s.core),
      float("gxJet", s.jet),
      vec4("gxKnotA", [...knotAt(s.knots[0]), ...knotAt(s.knots[1])]),
      vec4("gxKnotB", [...knotAt(s.knots[2]), ...knotAt(s.knots[3])]),
      ...novae,
    ];
  },
};
