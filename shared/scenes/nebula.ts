/**
 * Nebula (docs/visualizer/scenes.md, "Five more"): gliding through a stellar nursery, clouds of glowing gas and dark
 * dust lit from inside by newborn stars. The cloud is a volume of domain-warped noise marched front to back (steps
 * short where it changes fast, at its skin and in dust, long through empty space and its even insides, as nimitz's
 * Protean Clouds does). Its gas glows by the starlight it gets, coloured by how ionised it is (the Hubble palette's
 * logic: the clouds' hydrogen gold or red far from the stars, oxygen's teal nearer, the stars' own blue-white right
 * round them); its dust absorbs, near-black; and the skin of each clump that faces a star burns brightest (an
 * ionisation front: a step towards the light, as a cloud is shaded), so pillars stand out with incandescent rims.
 * Every hundred units or so a heart, a young cluster, has blown a vast cavity off to a side: its walls glow ahead
 * through the gaps, the focal point the flight heads for, and their light hazes the space between, so the nearer
 * clouds stand dark against it. Each star blows a cavity round itself; a tunnel is carved along the flight.
 * The world repeats along the flight every `PERIOD` units (its noise, path and stars alike), so the camera's place
 * wraps and never runs out of precision. Stepped: how far it's flown (faster on the bass), its roll into the
 * bends, the gas's slow drift, its glow on the level (the hydrogen warmer on the bass, the oxygen on the highs),
 * and the stars each hit ignites ahead (seeded: a blue-white flare that blooms and lights the gas round it, then
 * settles and fades). The cloud's own stars hear the spectrum in the GLSL, each pulsing with its band.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraLooking, clamp01, float, normalize, random, sceneDt, smoothTo, soundUniforms, sub, vec4 } from "./kit.ts";

/** The world's period along the flight (units). */
const PERIOD = 1024;
/** Stars ignited at once, at most. */
const IGNITED = 5;

const TAU = Math.PI * 2;
const w = (n: number) => (TAU * n) / PERIOD;
/** Where the flight's path runs at depth z (the GLSL's `nbPath`). */
const pathXY = (z: number): [number, number] => [
  5 * Math.sin(z * w(12)) + 1.6 * Math.sin(z * w(29) + 1),
  3 * Math.sin(z * w(9) + 2) + 1.2 * Math.sin(z * w(23)),
];
const pathAt = (z: number): Vec3 => [...pathXY(z), z];

interface Ignited {
  x: number;
  y: number;
  z: number;
  age: number;
  power: number;
}

interface NebulaState {
  time: number;
  /** How far along the path (wrapped into the world's period), and how fast. */
  z: number;
  speed: number;
  roll: number;
  /** The gas's slow drift (an angle). */
  flow: number;
  /** The emission's brightness, the hydrogen's warmth and the oxygen's, followed. */
  glow: number;
  warm: number;
  cool: number;
  stars: Ignited[];
  rng: { seed: number };
}

/** An ignited star's brightness at an age: a flare at once, settling, then fading out. */
const flare = (age: number, power: number) => {
  const rise = 1 - Math.exp(-(age + 1 / 30) / 0.02);
  const settle = 0.6 + (power * 5 - 0.6) * Math.exp(-age / 0.25);
  const fade = age > 4 ? Math.exp(-(age - 4) / 0.8) : 1;
  return rise * settle * fade;
};

export const NEBULA: SceneSpec<NebulaState> = {
  type: "nebula",
  label: "Nebula",
  params: [
    {
      kind: "choice",
      key: "palette",
      label: "Palette",
      default: "hubble",
      options: [
        { value: "hubble", label: "Hubble" },
        { value: "natural", label: "Natural" },
        { value: "cosmic", label: "Cosmic" },
      ],
    },
    { kind: "number", key: "density", label: "Density", default: 1, min: 0.3, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "stars", label: "Stars", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  audio: () => ({ rows: 1, span: 0, fall: 0.2, window: 0 }),
  glsl: /* glsl */ `
uniform float nbFlow;
uniform float nbGlow;
uniform float nbWarm;
uniform float nbCool;
uniform vec4 nbStar0;
uniform vec4 nbStar1;
uniform vec4 nbStar2;
uniform vec4 nbStar3;
uniform vec4 nbStar4;

const float NB_PERIOD = ${PERIOD.toFixed(1)};
const float NB_TAU = 6.28318531;
const float NB_SPACING = 32.0;

vec2 nbPath(float z) {
  float w = NB_TAU / NB_PERIOD;
  return vec2(5.0 * sin(z * w * 12.0) + 1.6 * sin(z * w * 29.0 + 1.0), 3.0 * sin(z * w * 9.0 + 2.0) + 1.2 * sin(z * w * 23.0));
}

// Value noise whose lattice repeats every per cells along z (so the world repeats along the flight).
float nbNoise(vec3 x, float per) {
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

// The cloud's noise at p: domain-warped fbm, squashed upright (pillars), its finer octaves ridged (filaments); its
// first three octaves in y (the gas, and what the lighting probes), all of them in x (the dust).
// detail is how many octaves, the last faded in by its fraction (so far off, finer ones go without a seam).
vec2 nbCloud(vec3 p, float detail) {
  int octaves = int(ceil(detail));
  // The warp: big slow swirls, drifting.
  vec3 d = vec3(cos(nbFlow), sin(nbFlow), 0.0) * 3.0;
  vec3 wq = p * 0.0625 + d * 0.0625;
  vec3 warp = vec3(nbNoise(wq, 64.0), nbNoise(wq + vec3(5.2, 1.3, 7.0), 64.0), nbNoise(wq + vec3(9.1, 4.7, 2.0), 64.0)) - 0.5;
  vec3 q = (p + warp * 9.0) * vec3(0.125, 0.07, 0.125);
  float per = NB_PERIOD * 0.125;
  float a = 0.0;
  float b = 0.5;
  float coarse = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    // A twist per octave (periodic in z as the lattice is), so the lattice's planes never show.
    float kz = NB_TAU * floor(1.1 * per / NB_TAU + 0.5) / per;
    q.xy += 0.2 * sin(vec2(q.z * kz + q.y * 1.3, q.z * kz + q.x * 1.1 + 1.7));
    q.z += 0.3 * sin(q.x * 1.2 + q.y * 0.9 + 0.5);
    float n = nbNoise(q, per);
    // Finer octaves as ridges: filaments.
    if (i >= 2) n = 1.0 - abs(2.0 * n - 1.0);
    if (i == octaves - 1) n = mix(0.5, n, clamp(detail - float(i), 0.0, 1.0));
    a += b * n;
    if (i == 2) coarse = a;
    q.xy = mat2(0.8, -0.6, 0.6, 0.8) * q.xy * 2.0;
    q.z *= 2.0;
    q += vec3(1.7, 9.2, 3.0);
    per *= 2.0;
    b *= 0.5;
  }
  return vec2(a, coarse);
}

// A fixed star of the cloud, by its index along the flight: where (xyz) and how bright (w).
vec4 nbFixedStar(float k) {
  float km = mod(k, NB_PERIOD / NB_SPACING);
  vec3 h = hash33(vec3(km, 3.7, 11.0));
  float z = k * NB_SPACING + h.x * NB_SPACING * 0.6;
  float a = h.y * NB_TAU;
  float r = 7.0 + 6.0 * h.z;
  float power = (0.6 + 1.4 * hash13(vec3(km, 8.1, 2.0))) * (0.6 + 0.9 * spectrum(fract(km * 0.137)));
  return vec4(nbPath(z) + vec2(cos(a), sin(a)) * r, z, power);
}

// The nursery's hearts: a young cluster every NB_HEART along the flight, off to a side, in a vast cavity it has
// blown. The walls of its cavity are the brightest thing in the cloud: the glowing wall ahead the flight heads for.
const float NB_HEART = NB_PERIOD / 10.0;
vec4 nbHeart(float k) {
  float km = mod(k, 10.0);
  vec3 h = hash33(vec3(km, 19.3, 5.1));
  float z = (k + 0.5) * NB_HEART + (h.x - 0.5) * 24.0;
  float a = h.y * NB_TAU;
  float r = 15.0 + 7.0 * h.z;
  return vec4(nbPath(z) + vec2(cos(a), 1.3 * sin(a)) * r, z, 10.0 * (0.75 + 0.5 * nbGlow));
}

// The gas's colour by how ionised it is (x: 0..1): hydrogen (and sulphur) in the clouds far from the stars, oxygen
// nearer them and in the cavities, then the stars' own light right round them (the Hubble palette's logic).
vec3 nbPalette(float x) {
  vec3 far, mid, near;
  if (palette == 1) {
    far = vec3(0.9, 0.06, 0.16); mid = vec3(1.0, 0.36, 0.62); near = vec3(0.3, 0.55, 1.0);
  } else if (palette == 2) {
    far = vec3(0.6, 0.06, 0.8); mid = vec3(0.12, 0.45, 1.0); near = vec3(0.8, 0.95, 1.0);
  } else {
    far = vec3(1.0, 0.42, 0.06); mid = vec3(0.04, 0.72, 0.9); near = vec3(0.82, 0.95, 1.0);
  }
  far *= 1.0 + 0.9 * nbWarm;
  mid *= 1.0 + 0.9 * nbCool;
  vec3 c = mix(far, mid, smoothstep(0.3, 0.55, x));
  return mix(c, near, smoothstep(0.65, 1.0, x));
}

vec3 nbStarfield(vec3 rd) {
  vec3 col = vec3(0.0);
  for (int l = 0; l < 2; l++) {
    float s = 300.0 + float(l) * 340.0;
    vec3 c = floor(rd * s);
    float h = hash13(c + float(l) * 17.0);
    if (h > 0.996) {
      vec3 f = fract(rd * s) - 0.5;
      float m = exp(-dot(f, f) * 30.0);
      vec3 tint = mix(vec3(1.0, 0.75, 0.55), vec3(0.65, 0.8, 1.0), hash13(c + 5.0));
      col += tint * m * pow(hash13(c + 2.0), 3.0) * 2.5;
    }
  }
  return col * stars;
}

// The glow of the hearts ahead through the gaps: the far wall of their cavities, mottled, brightest towards them.
vec3 nbGlowWall(vec3 rd, vec3 ro, vec4 ha, vec4 hb) {
  float g = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 h = i == 0 ? ha : hb;
    vec3 v = h.xyz - ro;
    float d = length(v);
    // Fading in as it comes within sight, out as it's passed.
    float wgt = smoothstep(150.0, 70.0, d) * smoothstep(-0.2, 0.5, dot(v / d, camFwd));
    float c = max(dot(rd, v / d), 0.0);
    g += wgt * (pow(c, 4.0) * 0.6 + pow(c, 24.0) * 1.2);
  }
  float far = fbm3(rd * 3.5 + 4.0, 5);
  return nbPalette(0.62) * g * (0.15 + 0.85 * smoothstep(0.3, 0.75, far)) * (0.6 + 0.6 * nbGlow);
}

// What's behind the cloud: the hearts' glow, stars, faint far nebulosity.
vec3 nbBackground(vec3 rd, vec3 wall) {
  float far = fbm3(rd * 4.0 + 9.0, 3);
  return wall * 0.12 + nbPalette(0.1) * 0.01 * smoothstep(0.45, 0.8, far) + nbStarfield(rd);
}

const int NB_LIGHTS = 10;

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  // The lights: the cloud's own stars about the camera, the hearts either side of it, then the ignited stars.
  vec4 L[NB_LIGHTS];
  float k0 = floor(ro.z / NB_SPACING);
  // Stars sets the cloud's own stars; the hearts and the ones the hits ignite stay.
  L[0] = nbFixedStar(k0 - 1.0) * vec4(1.0, 1.0, 1.0, stars);
  L[1] = nbFixedStar(k0) * vec4(1.0, 1.0, 1.0, stars);
  L[2] = nbFixedStar(k0 + 1.0) * vec4(1.0, 1.0, 1.0, stars);
  float h0 = floor(ro.z / NB_HEART);
  L[3] = nbHeart(h0);
  L[4] = nbHeart(h0 + 1.0);
  L[5] = nbStar0;
  L[6] = nbStar1;
  L[7] = nbStar2;
  L[8] = nbStar3;
  L[9] = nbStar4;
  float Ts[NB_LIGHTS];
  float tsd[NB_LIGHTS];
  for (int i = 0; i < NB_LIGHTS; i++) { Ts[i] = 1.0; tsd[i] = dot(L[i].xyz - ro, rd); }

  int steps = int(mix(60.0, 200.0, quality));
  float maxDetail = mix(4.0, 6.0, quality);
  float tmax = 90.0;
  float jitter = hash12(gl_FragCoord.xy);
  float t = 0.05 + 0.3 * jitter;
  float glow = (0.5 + 0.9 * nbGlow) * 1.6;
  // The haze between: thin gas glowing with the hearts' light, so the further things are the more they glow.
  vec3 wall = nbGlowWall(rd, ro, L[3], L[4]);
  vec3 haze = wall * 0.0008;
  vec3 col = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < 200; i++) {
    if (i >= steps || T < 0.01 || t > tmax) break;
    vec3 p = ro + rd * t;
    // The ionising light here: how much, and from where mostly; and the cavities the stars have blown.
    float ion = 0.0;
    float hot = 0.0;
    float starIon = 0.0;
    vec3 ldir = vec3(0.0, 1e-3, 0.0);
    float bubble = 1.0;
    for (int j = 0; j < NB_LIGHTS; j++) {
      if (L[j].w <= 0.0) continue;
      vec3 dv = L[j].xyz - p;
      float d2 = dot(dv, dv);
      float e = L[j].w / (1.0 + d2 * 0.04);
      ion += e;
      // How ionised the gas is, by the stars near it (the hearts light it, but are far): its colour.
      if (j != 3 && j != 4) {
        starIon += e;
        hot += L[j].w / (1.0 + d2 * 1.5);
      }
      ldir += dv * (e * inversesqrt(d2 + 1e-4));
      float rad = (j == 3 || j == 4) ? 20.0 : 3.0 + 2.0 * min(L[j].w, 1.2);
      bubble = min(bubble, smoothstep(rad * 0.35, rad, sqrt(d2)));
    }
    ldir = normalize(ldir);
    vec2 n = nbCloud(p, clamp(maxDetail - log2(1.0 + t * 0.05), 3.0, maxDetail));
    // The tunnel along the flight, wider and narrower.
    float r = length((p.xy - nbPath(p.z)) * vec2(1.0, 0.7));
    float tunnel = smoothstep(4.0, 12.0, r);
    // The nursery's big shapes: dense reaches and open cavities, tens of units across.
    float macro = nbNoise(p * vec3(0.03125, 0.045, 0.03125) + vec3(3.1, 7.7, 0.0), 32.0);
    float carve = (0.5 + 0.2 * max(density - 1.0, 0.0)) * (1.0 - tunnel) + 0.45 * (1.0 - bubble) + 0.4 * smoothstep(0.55, 0.3, macro);
    // Gas: the broad shapes (glowing where it's ionised); dust: the dense, filamented cores (dark, rims lit).
    float gv = n.y + 0.2 * (density - 1.0) - carve;
    float dv = n.x + 0.15 * (density - 1.0) - carve;
    float gas = smoothstep(0.54, 0.68, gv);
    float dust = smoothstep(0.65, 0.82, dv);
    float dt = clamp(0.05 + t * 0.022, 0.06, 1.4);
    float hotness = 1.0 - exp(-hot * 0.4);
    // Thin gas everywhere glows faintly by the light it gets (the haze that gives depth), hottest round each star.
    vec3 emit = haze * glow + nbPalette(0.97) * hot * 0.012 * glow;
    float sigma = 0.0;
    if (gas + dust > 0.001) {
      // Lit where the cloud thins towards the light: rims facing the stars, shadowed backs.
      float probe = nbCloud(p + ldir * 0.5, 3.0).y;
      float facing = clamp((n.y - probe) * 8.0 + 0.15, 0.0, 1.0);
      // The lit side shows when the light is behind the lens; with it ahead, the cloud stands dark against it.
      facing *= mix(0.3, 1.0, 0.5 - 0.5 * dot(ldir, rd));
      // The clouds' hydrogen far from the stars, oxygen nearer, the stars' own light right round them.
      vec3 c = nbPalette(max(1.0 - exp(-starIon * 0.2), hotness));
      emit += c * gas * (0.0005 + ion * (0.012 + facing * facing * 0.06)) * glow * (1.0 - dust);
      // Ionisation fronts: the skin of the dust facing a star burns brightest, incandescent.
      vec3 front = nbPalette(0.0) * vec3(1.0, 1.25, 1.6);
      // (A shell of the smooth field round the dense cores, so it doesn't sparkle between the march's steps.)
      float shell = smoothstep(0.56, 0.66, gv) * (1.0 - smoothstep(0.68, 0.8, gv));
      emit += mix(front, nbPalette(1.0), hotness) * shell * facing * facing * facing * ion * 0.9 * glow;
      sigma = (gas * 0.07 + dust * 3.0) * density;
      // Short steps where it changes fast (the cloud's skin, the dust), long ones through its even insides.
      float skin = 1.0 - smoothstep(0.0, 0.12, abs(gv - 0.62));
      dt = min(dt * mix(1.0, 0.3, skin) * mix(1.0, 0.3, dust), 1.0);
    } else {
      // Empty: longer steps the further the cloud is from showing (the noise is a rough distance).
      dt *= clamp(0.5 + (0.54 - gv) * 12.0, 0.5, 2.0);
    }
    float a = exp(-sigma * dt);
    col += T * emit * (sigma > 1e-4 ? (1.0 - a) / sigma : dt);
    T *= a;
    for (int j = 0; j < NB_LIGHTS; j++) if (tsd[j] >= t && tsd[j] < t + dt) Ts[j] = T;
    t += dt;
  }
  for (int j = 0; j < NB_LIGHTS; j++) if (tsd[j] >= t) Ts[j] = T;
  // The stars themselves: a core, a glow and Hubble's diffraction spikes (fixed to the frame, as a telescope's).
  vec2 sp = vec2(dot(rd, camRight), dot(rd, camUp)) / (dot(rd, camFwd) * camLens);
  float px = 2.0 / min(resolution.x, resolution.y);
  for (int j = 0; j < NB_LIGHTS; j++) {
    if (L[j].w <= 0.0 || tsd[j] <= 0.3) continue;
    vec3 v = L[j].xyz - ro;
    float vz = dot(v, camFwd);
    if (vz <= 0.3) continue;
    vec2 o = sp - vec2(dot(v, camRight), dot(v, camUp)) / (vz * camLens);
    bool heart = j == 3 || j == 4;
    float w = heart ? 3.0 : L[j].w;
    float size = clamp(w * 3.0 / length(v), 0.02, 0.8);
    float r2 = dot(o, o);
    float core = exp(-r2 / (size * size * 0.0006 + px * px)) * 4.0;
    float halo = size * size * 0.0025 / (r2 + size * size * 0.002);
    float wdt = max(0.0015 * size, px * 0.6);
    float len = 0.2 * size;
    float spikes = exp(-abs(o.y) / wdt) * exp(-abs(o.x) / len) + exp(-abs(o.x) / wdt) * exp(-abs(o.y) / len);
    col += Ts[j] * vec3(0.85, 0.92, 1.0) * (core + halo + spikes * 0.8) * min(w, 3.0);
    // A newborn star's flare (and a heart) blooms in the lens, seen even through thin dust.
    float bloom = heart ? 0.12 : max(L[j].w - 1.0, 0.0) * 0.12;
    col += sqrt(Ts[j]) * nbPalette(0.97) * bloom * (0.004 / (r2 + 0.004) + 0.12 * exp(-r2 * 8.0));
  }
  col += T * nbBackground(rd, wall);
  return col;
}
`,
  init: () => ({ time: 0, z: 0, speed: 2, roll: 0, flow: 0, glow: 0.5, warm: 0, cool: 0, stars: [], rng: { seed: 0x4e3b1a } }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    s.time += dt;
    s.speed = smoothTo(s.speed, 1.6 + 3 * a.bass + 2 * a.punch, frame.dt, 0.6);
    s.z += s.speed * dt;
    s.flow = (s.flow + dt * 0.03) % TAU;
    s.glow = smoothTo(s.glow, a.level, frame.dt, 0.15);
    s.warm = smoothTo(s.warm, a.bass, frame.dt, 0.2);
    s.cool = smoothTo(s.cool, a.high, frame.dt, 0.2);
    // Into the bends: roll against the path's sideways curvature ahead, and a slow sway.
    const [x0] = pathXY(s.z + 2);
    const [x1] = pathXY(s.z + 6);
    const [x2] = pathXY(s.z + 10);
    const bend = (x2 - 2 * x1 + x0) / 16;
    s.roll = smoothTo(s.roll, Math.max(-0.5, Math.min(0.5, -bend * 18)) + 0.12 * Math.sin(s.time * 0.13), frame.dt, 0.8);
    for (const st of s.stars) st.age += frame.dt;
    s.stars = s.stars.filter((st) => st.age < 6 && st.z > s.z - 3);
    if (a.onBeat) {
      // A star ignites ahead, off the path, inside the gas.
      const z = s.z + 16 + random(s.rng) * 24;
      const ang = random(s.rng) * TAU;
      const r = 6 + random(s.rng) * 5;
      const [px, py] = pathXY(z);
      s.stars.push({ x: px + Math.cos(ang) * r, y: py + Math.sin(ang) * r, z, age: 0, power: 0.6 + 0.5 * clamp01(frame.hit) });
      if (s.stars.length > IGNITED) s.stars.shift();
    }
    // The world repeats every PERIOD: wrap the camera and what's about it together.
    if (s.z >= PERIOD) {
      s.z -= PERIOD;
      for (const st of s.stars) st.z -= PERIOD;
    }
  },
  uniforms(s, frame) {
    const pos = pathAt(s.z);
    const fwd = normalize(sub(pathAt(s.z + 7), pos));
    return [
      ...cameraLooking(pos, fwd, s.roll, 75),
      ...soundUniforms(frame),
      float("nbFlow", s.flow),
      float("nbGlow", s.glow),
      float("nbWarm", s.warm),
      float("nbCool", s.cool),
      ...Array.from({ length: IGNITED }, (_, i) => {
        const st = s.stars[i];
        return vec4(`nbStar${i}`, st ? [st.x, st.y, st.z, flare(st.age, st.power)] : [0, 0, 0, 0]);
      }),
    ];
  },
};
