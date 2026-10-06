/**
 * Abyss (docs/visualizer/scenes.md, "Five more"): the deep sea's twilight. Shafts of light from a rippling surface
 * far above, marine snow drifting through them, and glowing jellyfish (moon jellies and long-trailing sea nettles)
 * pulsing as they swim. The water is a colour by direction (brighter up, black down) that the Depth darkens; the
 * shafts are gathered along each ray through a caustic pattern carried down the light's direction; the snow is motes
 * in cells round the camera, walked cell by cell. A jellyfish is drawn without marching: its bell is two ellipsoids
 * (the light through it is the path between them, so its edges glow as a translucent shell's do), its gonads petals
 * on a plane inside, and its tentacles, oral arms and rim lights are glowing lines, each a few segments a ray's
 * closest approach is found to exactly; out of focus, the lines and the bell's outline spread.
 * Stepped: each jelly (its pulse on a kick or by itself, a contraction then a glide on the thrust it gave along its
 * leaning axis, whose lean slowly turns; its tentacles' sway; its place, in the group, past the lens or far off in
 * the haze, that it's drawn back to; kept apart from the others as the camera sees them), the group's focus (rising
 * with it, carried by a slow current), and the camera arcing round it, in and out and up and down.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraUniforms, clamp01, cross, float, normalize, num, random, sceneDt, smoothTo, smoothstep, soundUniforms, vec4 } from "./kit.ts";

/** Jellies stepped (the Jellies look shows the first few). */
const JELLIES = 10;
/**
 * Where each slot swims, so any number of them is staged in depth: in the group the camera looks at (0), past the
 * lens, on the camera's own circle, so it glides by them (1), or far off in the haze (2).
 */
const TIERS = [0, 1, 2, 0, 2, 0, 0, 2, 1, 2];
/** The group's heights from its focus. */
const LOW = -2.4;
const HIGH = 4.2;

interface Jelly {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  /** A sea nettle (1: striped, its tentacles fewer and far longer; two of the slots) or a moon jelly (0); its tentacles' length. */
  kind: number;
  reach: number;
  /** Its place round the focus (an angle, a distance, a height), and when it moves on. */
  ha: number;
  hr: number;
  hy: number;
  homeIn: number;
  /** Its axis, leaning (x, z of a unit vector up): how far it leans, which way, and how fast that way turns. */
  tx: number;
  tz: number;
  lean: number;
  leanAt: number;
  leanTurn: number;
  /** Its bell's contraction (0..1), seconds into its pulse, the pulse's strength, a kick's pulse waiting to start. */
  c: number;
  age: number;
  strength: number;
  pending: number;
  /** Seconds it pulses by itself after, when nothing kicks it. */
  rest: number;
  /** The tentacles' wave (radians, wrapped). */
  sway: number;
  /** Fading in after a respawn. */
  born: number;
}

interface AbyssState {
  time: number;
  /** The shafts' and surface's clock, and how far the snow has sunk. */
  clock: number;
  drift: number;
  /** The group's centre (the camera looks at it), and the current carrying it (a heading that wanders). */
  fx: number;
  fy: number;
  fz: number;
  heading: number;
  /** The camera's way round the group. */
  orbit: number;
  shaft: number;
  sparkle: number;
  jellies: Jelly[];
  /** The jellies have been put in their places (on the first frame, when it's known how many are shown). */
  placed: boolean;
  rng: { seed: number };
}

const TAU = Math.PI * 2;

/** How the group draws in when there are few (one alone is in the middle, and the camera comes closer). */
const gather = (count: number) => 0.3 + 0.7 * Math.min(1, (count - 1) / 5);
/** The camera's mean distance from the focus. */
const orbitRadius = (count: number) => 6.6 * (0.62 + 0.38 * gather(count));

/** A place for jelly `i` in its tier, round from where it was (so it swims a little way, not across the group). */
function newHome(s: AbyssState, j: Jelly, i: number, first: boolean): void {
  const tier = TIERS[i];
  j.ha = first ? random(s.rng) * TAU : j.ha + (random(s.rng) - 0.5) * 1.1;
  if (tier === 0) {
    j.hr = (0.15 + 0.85 * Math.sqrt(random(s.rng))) * 3.2;
    j.hy = LOW + (HIGH - LOW) * ((i * 0.618 + 0.12 + 0.1 * random(s.rng)) % 1);
  } else if (tier === 1) {
    // Beside the camera's circle, a little above the lens: it's passed close, seen from below.
    j.hr = 6.6 + (random(s.rng) < 0.5 ? -2.3 : 2.3);
    j.hy = -0.6 + random(s.rng) * 2;
  } else {
    j.hr = 11 + random(s.rng) * 6;
    j.hy = -3 + random(s.rng) * 10;
  }
  j.homeIn = 15 + random(s.rng) * 15;
}

/** A jelly's place from the focus (the group's middle drawn in when there are few). */
function homeOf(j: Jelly, i: number, count: number): Vec3 {
  const tier = TIERS[i];
  if (tier === 1) {
    const r = j.hr * (orbitRadius(count) / 6.6);
    return [Math.cos(j.ha) * r, j.hy, Math.sin(j.ha) * r];
  }
  const k = tier === 0 ? gather(count) : 1;
  const mid = (LOW + HIGH) / 2;
  return [Math.cos(j.ha) * j.hr * k, tier === 0 ? mid + (j.hy - mid) * k : j.hy, Math.sin(j.ha) * j.hr * k];
}

/** Jelly `i`, at its place (`below`: under it, out of sight, to swim up into it). */
function spawn(s: AbyssState, i: number, below: boolean, sway: number): Jelly {
  const tier = TIERS[i];
  const young = random(s.rng);
  const j: Jelly = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    // Young ones to big ones in the group; the far ones big enough to read in the haze.
    size: tier === 2 ? 0.9 + young * 0.6 : tier === 1 ? 0.55 + young * 0.35 : 0.4 + young * 0.8,
    kind: i === 3 || i === 7 ? 1 : 0,
    reach: 0.8 + random(s.rng) * 0.45,
    ha: 0, hr: 0, hy: 0, homeIn: 0,
    tx: 0, tz: 0,
    lean: 0.17 + random(s.rng) * 0.53,
    leanAt: random(s.rng) * TAU,
    leanTurn: (random(s.rng) < 0.5 ? -1 : 1) * (0.08 + random(s.rng) * 0.2),
    c: 0, age: random(s.rng) * 2, strength: 0.5, pending: -1,
    rest: 1.8 + random(s.rng) * 1.2,
    sway,
    born: below ? 0 : 1,
  };
  newHome(s, j, i, true);
  j.tx = Math.sin(j.lean) * Math.cos(j.leanAt);
  j.tz = Math.sin(j.lean) * Math.sin(j.leanAt);
  return j;
}

/** A jelly's frame, as the GLSL builds it: its axis, and two directions across it. */
function frameOf(j: Jelly): [Vec3, Vec3, Vec3] {
  const u: Vec3 = [j.tx, Math.sqrt(Math.max(0.05, 1 - j.tx * j.tx - j.tz * j.tz)), j.tz];
  const e1 = normalize(cross([0, 0, 1], u));
  const e2 = cross(u, e1);
  return [u, e1, e2];
}

/** How long a contraction takes; it relaxes more slowly. */
const RISE = 0.13;
/** The most a bell leans (sin of the angle). */
const MAX_LEAN = 0.72;

function stepJelly(s: AbyssState, j: Jelly, dt: number, kick: number, i: number, count: number): void {
  // A kick's pulse starts after this jelly's own small delay (so the group ripples), unless it's mid-contraction.
  if (kick > 0 && j.pending < 0 && j.age > RISE) {
    j.pending = (i * 0.37) % 0.11;
    j.strength = Math.max(0.55, Math.min(1, kick));
  }
  // Seconds into its pulse; a pulse that starts within this frame starts on its own moment.
  let from = j.age;
  j.age += dt;
  if (j.pending >= 0) {
    j.pending -= dt;
    if (j.pending < 0) {
      j.age = -j.pending;
      from = 0;
    }
  }
  // Nothing kicking: it pulses by itself, more gently.
  if (j.age > j.rest && j.pending < 0) {
    j.age -= j.rest;
    from = 0;
    j.strength = 0.5;
  }
  const contracting = j.age < RISE;
  j.c = smoothTo(j.c, contracting ? j.strength : 0, dt, contracting ? 0.045 : 0.26);
  const [u] = frameOf(j);
  // The thrust: along its axis while it contracts (for exactly the part of this frame it does); then it glides,
  // slowed by the water, sinking a little, and drawn gently back to its place.
  const pushed = Math.max(0, Math.min(j.age, RISE) - Math.max(from, 0));
  const thrust = (2.6 * j.strength * (0.75 + 0.3 * j.size) * pushed) / Math.max(dt, 1e-6);
  const home = homeOf(j, i, count);
  const rx = j.x - s.fx - home[0];
  const ry = j.y - s.fy - home[1];
  const rz = j.z - s.fz - home[2];
  const pull = 0.22;
  j.vx += (u[0] * thrust - rx * pull) * dt;
  j.vy += (u[1] * thrust - ry * pull - 0.05) * dt;
  j.vz += (u[2] * thrust - rz * pull) * dt;
  const drag = Math.exp(-dt / 0.75);
  j.vx *= drag;
  j.vy *= drag;
  j.vz *= drag;
  j.x += j.vx * dt;
  j.y += j.vy * dt;
  j.z += j.vz * dt;
  j.homeIn -= dt;
  if (j.homeIn < 0) newHome(s, j, i, false);
  // It leans its own way, which slowly turns (so it swims in slow curves), and a little towards its place.
  j.leanAt = (j.leanAt + j.leanTurn * dt) % TAU;
  let ax = Math.sin(j.lean) * Math.cos(j.leanAt) - rx * 0.08;
  let az = Math.sin(j.lean) * Math.sin(j.leanAt) - rz * 0.08;
  const m = Math.hypot(ax, az);
  if (m > MAX_LEAN) [ax, az] = [(ax * MAX_LEAN) / m, (az * MAX_LEAN) / m];
  j.tx = smoothTo(j.tx, ax, dt, 1.5);
  j.tz = smoothTo(j.tz, az, dt, 1.5);
  // The tentacles' wave runs faster just after a pulse.
  j.sway = (j.sway + dt * (1.6 + 2.5 * j.c)) % TAU;
  j.born = Math.min(1, j.born + dt / 2);
}

/** Where the camera is: round the group's focus, in and out and up and down as it goes, so it glides past them. */
function cameraAt(s: AbyssState, count: number): Vec3 {
  const r = orbitRadius(count) + 1.0 * Math.sin(s.time * 0.09) * gather(count);
  return [s.fx + Math.cos(s.orbit) * r, s.fy - 1.2 + 1.3 * Math.sin(s.time * 0.13 + 0.5), s.fz + Math.sin(s.orbit) * r];
}

/** Shown jellies too near each other as the camera sees them drift apart across its view, so none hides another. */
function spaceOut(s: AbyssState, count: number, dt: number): void {
  const cam = cameraAt(s, count);
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      const p = s.jellies[a];
      const q = s.jellies[b];
      const pp: Vec3 = [p.x - cam[0], p.y - cam[1], p.z - cam[2]];
      const qq: Vec3 = [q.x - cam[0], q.y - cam[1], q.z - cam[2]];
      const dp = Math.hypot(...pp);
      const dq = Math.hypot(...qq);
      if (dp < 1e-3 || dq < 1e-3) continue;
      // Their directions from the lens, and how far apart those are against how big they look.
      const d: Vec3 = [pp[0] / dp - qq[0] / dq, pp[1] / dp - qq[1] / dq, pp[2] / dp - qq[2] / dq];
      const gap = Math.hypot(...d);
      const want = 1.3 * (p.size / dp + q.size / dq);
      if (gap >= want || gap < 1e-5) continue;
      const push = ((want - gap) / gap) * 0.8 * dt;
      p.vx += d[0] * push * dp;
      p.vy += d[1] * push * dp;
      p.vz += d[2] * push * dp;
      q.vx -= d[0] * push * dq;
      q.vy -= d[1] * push * dq;
      q.vz -= d[2] * push * dq;
    }
  }
}

export const ABYSS: SceneSpec<AbyssState> = {
  type: "abyss",
  label: "Abyss",
  params: [
    {
      kind: "choice",
      key: "glow",
      label: "Glow",
      default: "cyan",
      options: [
        { value: "cyan", label: "Cyan" },
        { value: "magenta", label: "Magenta" },
        { value: "gold", label: "Gold" },
        { value: "rainbow", label: "Rainbow" },
      ],
    },
    { kind: "number", key: "depth", label: "Depth", default: 0.5, min: 0, max: 1, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "jellies", label: "Jellies", default: 7, min: 1, max: JELLIES, step: 1, decimals: 0, slider: true },
  ],
  audio: () => ({ rows: 1, span: 0, fall: 0.22, window: 0 }),
  glsl: /* glsl */ `
uniform float abClock;
uniform float abDrift;
uniform float abShaft;
uniform float abSparkle;
uniform float abFocus;
${Array.from({ length: JELLIES }, (_, i) => `uniform vec4 abJ${i};\nuniform vec4 abK${i};\nuniform vec4 abL${i};\nuniform vec4 abM${i};`).join("\n")}

const int TENTACLES = 24;
const int SEGS = 11;
// The light comes down from the surface, leaning a little.
const vec3 SUN = vec3(0.17, -0.97, 0.13);

vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
// A jelly's glow colour (its slot picks a shade), and the paler one of its inner parts.
vec3 glowColor(float i) {
  float h = hash12(vec2(i, 7.3));
  if (glow == 1) return mix(vec3(1.0, 0.2, 0.75), vec3(0.6, 0.25, 1.0), h);
  if (glow == 2) return mix(vec3(1.0, 0.62, 0.18), vec3(1.0, 0.82, 0.45), h);
  if (glow == 3) return mix(hue(fract(i * 0.618 + 0.05)), vec3(1.0), 0.12);
  return mix(vec3(0.05, 0.9, 1.0), vec3(0.15, 0.6, 1.0), h);
}
// Its second colour, deep in the bell and down the arms.
vec3 glowColor2(float i) {
  if (glow == 1) return vec3(0.45, 0.2, 1.0);
  if (glow == 2) return vec3(1.0, 0.32, 0.08);
  if (glow == 3) return mix(hue(fract(i * 0.618 + 0.2)), vec3(1.0), 0.1);
  return vec3(0.45, 0.25, 1.0);
}

// Twilight's colours as the Depth goes from sunlit (0) through twilight (0.5) to the abyss (1), mixed geometrically.
vec3 byDepth(vec3 sunlit, vec3 twilight, vec3 abyss) {
  vec3 a = log(sunlit);
  vec3 b = log(twilight);
  vec3 c = log(abyss);
  return exp(depth < 0.5 ? mix(a, b, depth * 2.0) : mix(b, c, depth * 2.0 - 1.0));
}
// The water's own light by direction: the surface's glow above, falling to black below; darker with depth.
vec3 water(vec3 rd) {
  float up = rd.y;
  vec3 top = byDepth(vec3(0.06, 0.26, 0.34), vec3(0.008, 0.05, 0.085), vec3(0.0012, 0.006, 0.014));
  vec3 mid = byDepth(vec3(0.02, 0.12, 0.19), vec3(0.0015, 0.011, 0.028), vec3(0.0003, 0.0015, 0.0045));
  vec3 low = byDepth(vec3(0.002, 0.018, 0.035), vec3(0.0002, 0.0015, 0.005), vec3(0.00004, 0.00015, 0.0005));
  vec3 col = up > 0.0 ? mix(mid, top, pow(up, 1.3)) : mix(mid, low, pow(-up, 0.6));
  // Towards the sun: Snell's window, the sky squeezed into a disc overhead (its edge rippling), and its glow.
  float s = max(dot(rd, -SUN), 0.0);
  float edge = 0.7 + 0.03 * (vnoise2d(rd.xz / max(rd.y, 0.2) * 3.0 + abClock * 0.25).x - 0.5);
  float window = smoothstep(edge - 0.03, edge + 0.1, s);
  vec3 sky = byDepth(vec3(0.26, 0.52, 0.6), vec3(0.04, 0.16, 0.2), vec3(0.001, 0.004, 0.008));
  col += sky * (window * (0.25 + 0.75 * pow(s, 16.0)) * (1.0 - depth) + pow(s, 5.0) * 0.4);
  return col;
}

// The light reaching p from the surface: a caustic pattern carried down the light's direction, so it hangs in shafts.
float shaftLight(vec3 p) {
  vec2 q = (p.xz - SUN.xz * ((p.y - camPos.y) / SUN.y)) * 0.55;
  vec2 w = vnoise2d(q * 0.4 + abClock * 0.02).yz;
  float n = vnoise2d(q + w * 0.3 + vec2(abClock * 0.05, abClock * 0.03)).x * 0.6 + vnoise2d(q * 2.3 - abClock * 0.07).x * 0.4;
  return pow(smoothstep(0.45, 0.85, n), 3.0);
}

// The shafts: light gathered along the ray (finer near the lens), dimming with depth below the camera.
vec3 shafts(vec3 ro, vec3 rd, int n) {
  float sum = 0.0;
  float jitter = hash12(gl_FragCoord.xy + fract(abClock) * 37.0);
  float sigma = mix(0.05, 0.11, depth);
  float tPrev = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    float f = (float(i) + jitter) / float(n);
    float t = 45.0 * f * f;
    vec3 p = ro + rd * t;
    float dt = t - tPrev;
    tPrev = t;
    float fall = exp(clamp((p.y - ro.y) * 0.09, -6.0, 3.0));
    sum += shaftLight(p) * fall * exp(-sigma * t) * dt;
  }
  vec3 tint = byDepth(vec3(0.19, 0.44, 0.54), vec3(0.12, 0.42, 0.55), vec3(0.01, 0.04, 0.07));
  return tint * sum * 0.03 * (0.4 + 1.0 * abShaft);
}

// The closest approach of a ray (o, d unit) to the segment ab: (distance, along the ray, along the segment).
vec3 raySeg(vec3 o, vec3 d, vec3 a, vec3 b) {
  vec3 ba = b - a;
  vec3 w = o - a;
  float bb = dot(ba, ba);
  float bd = dot(ba, d);
  float den = bb - bd * bd;
  float s = den > 1e-7 ? clamp((dot(ba, w) - bd * dot(d, w)) / den, 0.0, 1.0) : 0.0;
  float t = max(dot(a + ba * s - o, d), 0.0);
  vec3 pr = o + d * t;
  s = clamp(dot(pr - a, ba) / max(bb, 1e-7), 0.0, 1.0);
  return vec3(length(pr - a - ba * s), t, s);
}
// A ray's crossing of an ellipsoid (semi-axes r, centred at c): entry and exit, or (1e9, -1e9).
vec2 ellipsoid(vec3 o, vec3 d, vec3 c, vec3 r) {
  vec3 oc = (o - c) / r;
  vec3 dc = d / r;
  float a = dot(dc, dc);
  float b = dot(oc, dc);
  float k = dot(oc, oc) - 1.0;
  float h = b * b - a * k;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2((-b - h) / a, (-b + h) / a);
}
// The part of [t0, t1] where the ray is above y = yc (and in front of the lens).
vec2 above(vec2 seg, vec3 o, vec3 d, float yc) {
  seg.x = max(seg.x, 0.0);
  if (abs(d.y) < 1e-5) return o.y > yc ? seg : vec2(1.0, 0.0);
  float tp = (yc - o.y) / d.y;
  if (d.y > 0.0) seg.x = max(seg.x, tp); else seg.y = min(seg.y, tp);
  return seg;
}
// A glowing line at closest distance dist, its core width w, seen a pixel wide at least (energy kept).
float line(float dist, float w, float px) {
  float we = max(w, px);
  // (Its tails end well inside the jelly's bounds, so the bounds never show.)
  return (w / we) * (we * we / (dist * dist + we * we) + 0.06 * exp(-dist / (w * 6.0 + we))) * smoothstep(1.0, 0.4, dist);
}

// One jelly's light along a ray (world), and how much of what's behind it gets through.
vec3 jelly(vec3 ro, vec3 rd, float i, vec4 J, vec4 K, vec4 L, vec4 M, float pxAngle, inout float through) {
  bool nettle = M.x > 0.5;
  float size = J.w;
  vec3 u = vec3(K.x, sqrt(max(0.05, 1.0 - K.x * K.x - K.y * K.y)), K.y);
  vec3 e1 = normalize(cross(vec3(0.0, 0.0, 1.0), u));
  vec3 e2 = cross(u, e1);
  // Into its own space: its bell's radius about 1, its axis up.
  vec3 q = (ro - J.xyz) / size;
  vec3 o = vec3(dot(q, e1), dot(q, u), dot(q, e2));
  vec3 d = vec3(dot(rd, e1), dot(rd, u), dot(rd, e2));
  float c = K.z;
  float level = spectrum(0.05 + 0.85 * (i + 0.5) / max(jellies, 1.0));
  float bright = 0.3 + 1.5 * level;
  vec3 col = glowColor(i);
  vec3 col2 = glowColor2(i);
  vec3 pale = mix(col, vec3(1.0), 0.3);
  float tCentre = max(dot(-o, d), 0.0);
  // Far off, it fades into the water's haze.
  float fog = exp(-mix(0.045, 0.12, depth) * tCentre * size) * L.w;
  // Its glow in the water round it (everywhere, so it has no edge).
  vec3 hc = vec3(0.0, -0.2, 0.0);
  float th0 = dot(hc - o, d);
  float th = max(th0, 0.0);
  float dh = length(o + d * th - hc);
  // (Only towards it: one beside the lens mustn't wash the whole frame.)
  vec3 light = col * bright * (0.025 + 0.08 * c) / (dh * dh + 0.7) * smoothstep(0.0, 2.0, th0);
  // Its tentacles' length: a sea nettle's trail far further.
  float len = 4.2 * M.y * (nettle ? 1.75 : 1.0);
  // Bounds: everything else is inside this sphere.
  vec3 bc = vec3(0.0, -len * 0.42, 0.0);
  float br = len * 0.6 + 1.0;
  float b = dot(o - bc, d);
  float h = b * b - dot(o - bc, o - bc) + br * br;
  if (h < 0.0 || -b + sqrt(h) < 0.0) return light * fog;
  // A pixel's width here, or (out of focus, near the lens or far off) the blur's.
  float px = max(pxAngle * max(tCentre, 0.5), min(abs(tCentre * size - abFocus) * 0.012 / size, 0.12));

  // The bell: an outer and an inner ellipsoid (thick at the top, thin at the margin), cut off at the margin.
  // A cap of the ellipsoid (its centre below the margin, so the margin flares); contracting, the cap deepens
  // and the margin draws in.
  float R = (1.08 - 0.3 * c) * (nettle ? 0.92 : 1.0);
  float H = (0.95 + 0.2 * c) * (nettle ? 1.08 : 0.8 + 0.4 * hash12(vec2(i, 3.1)));
  vec3 ce = vec3(0.0, -0.42 * H, 0.0);
  float rimY = -0.42 * c * H;
  float top = ce.y + H;
  vec2 outer = ellipsoid(o, d, ce, vec3(R, H, R));
  vec2 inner = ellipsoid(o, d, ce - vec3(0.0, 0.02, 0.0), vec3(R - 0.025, H - 0.17, R - 0.025));
  float path = 0.0;
  float frontAt = 1e9;
  if (outer.y > max(outer.x, 0.0)) {
    vec2 s1 = inner.y > inner.x ? vec2(outer.x, inner.x) : outer;
    vec2 s2 = inner.y > inner.x ? vec2(inner.y, outer.y) : vec2(1.0, 0.0);
    s1 = above(s1, o, d, rimY);
    s2 = above(s2, o, d, rimY);
    if (s1.y > s1.x) { path += s1.y - s1.x; frontAt = s1.x; }
    if (s2.y > s2.x) { path += s2.y - s2.x; frontAt = min(frontAt, s2.x); }
  }
  // Out of focus, its outline spreads into a soft fringe of the margin's light.
  if (px > 0.02) {
    vec3 oc = (o - ce) / vec3(R, H, R);
    vec3 dc = d / vec3(R, H, R);
    float bb = dot(oc, dc) / dot(dc, dc);
    vec3 cl = oc - dc * bb;
    float miss = length(cl) - 1.0;
    if (miss > 0.0 && bb > 0.0 && cl.y * H + ce.y > rimY - 0.2) light += mix(col, pale, 0.5) * bright * 0.35 * exp(-miss / (px * 1.5)) * smoothstep(0.02, 0.08, px);
  }
  if (path > 0.0) {
    vec3 front = o + d * frontAt;
    // Translucent: its light is the path through it (the edges, seen edge-on, glow most), plus a sheen.
    vec3 n = normalize((front - ce) / vec3(R * R, H * H, R * R));
    float fres = pow(1.0 - abs(dot(n, d)), 4.0);
    float ang = atan(front.z, front.x);
    float r = length(front.xz);
    // Faint radial canals, the bright ring canal along the margin.
    float canals = exp(-pow(r * sin(ang * 8.0) / 0.02, 2.0)) * smoothstep(0.2, 0.7, r / R);
    float rw = max(0.03, px);
    float ring = exp(-pow((front.y - rimY - 0.03) / rw, 2.0)) * (0.7 + 0.3 * cos(ang * 16.0)) * 0.03 / rw;
    // Brighter towards the margin, its colour deepening towards the top; faint rings of muscle round the skirt.
    float skirt = smoothstep(top, rimY, front.y);
    float muscle = 0.5 + 0.5 * sin((front.y - rimY) * 70.0);
    vec3 shell = mix(col2, col, skirt) * (0.5 + 0.8 * skirt) * (0.85 + 0.15 * muscle * skirt);
    // A sea nettle's bell is striped from its top to its margin.
    if (nettle) shell = mix(shell, col2 * 1.4, 0.5 + 0.5 * cos(ang * 16.0)) * (0.6 + 0.4 * skirt);
    // Lit from above too, brighter where it swims through a shaft.
    vec3 lit = water(vec3(0.0, 1.0, 0.0)) * (0.5 + 2.0 * shaftLight(J.xyz));
    light += bright * (shell * pow(path, 1.5) * 0.8 + col * (0.12 * canals * (nettle ? 0.0 : 1.0) + (0.8 + 1.5 * c) * ring)) + pale * fres * 0.25 * bright + lit * (path * 0.4 + fres * 0.6);
    through *= 1.0 - 0.3 * clamp(path, 0.0, 1.0) * fog;
  }
  // Inside the bell: the four gonads (soft petals, seen through it) and a glow at its heart.
  float yg = mix(rimY, top, 0.3);
  if (abs(d.y) > 1e-4) {
    float tg = (yg - o.y) / d.y;
    if (tg > 0.0) {
      vec3 g = o + d * tg;
      float rg = length(g.xz);
      if (rg < R * 0.8) {
        float a = atan(g.z, g.x) + 0.785398;
        float sector = 1.570796;
        float al = a - sector * floor(a / sector + 0.5);
        vec2 pl = vec2(cos(al), sin(al)) * rg - vec2(0.34 * R, 0.0);
        // Soft filled petals with a brighter edge (rings alone read as faces).
        float pr = length(pl * vec2(1.0, 1.25));
        float petal = smoothstep(0.2 * R, 0.04 * R, pr) * 0.5 + 0.5 * exp(-pow((pr - 0.13 * R) / 0.05, 2.0));
        light += mix(pale, vec3(1.0, 0.75, 0.85), 0.25) * petal * bright * (nettle ? 0.05 : 0.16);
      }
    }
  }
  vec3 core = vec3(0.0, mix(rimY, top, 0.35), 0.0);
  float tc = max(dot(core - o, d), 0.0);
  float dc = length(o + d * tc - core);
  // Its heart glows in its colour, flaring as it contracts.
  light += mix(col2, col, 0.4) * bright * (0.5 + 1.6 * c) * exp(-dc * dc / 0.2);

  // The margin: its rim lights (a little equaliser of the jelly's own part of the spectrum) and the tentacles.
  float Rm = R * sqrt(max(0.0, 1.0 - (rimY - ce.y) * (rimY - ce.y) / (H * H)));
  vec2 trail = L.xy;
  float sway = L.z;
  float calm = 1.0 / (1.0 + 1.5 * max(K.w, 0.0));
  float tent = 0.0;
  float band = 0.05 + 0.85 * (i + 0.5) / max(jellies, 1.0);
  for (int k = 0; k < TENTACLES; k++) {
    float fk = float(k);
    float hk = hash12(vec2(fk, i * 13.1));
    float a = (fk + 0.4 * hk) / float(TENTACLES) * 6.2831853;
    vec2 dir = vec2(cos(a), sin(a));
    // A sea nettle has half as many, all long.
    bool hangs = !nettle || k - 2 * (k / 2) == 0;
    float tl = len * (nettle ? 0.75 + 0.25 * hk : 0.35 + 0.65 * hash12(vec2(fk, i * 7.7 + 2.0)));
    vec3 prev = vec3(dir.x * Rm, rimY, dir.y * Rm);
    float best = 1e9;
    float bestS = 0.0;
    for (int j = 1; j <= SEGS; j++) {
      if (!hangs) break;
      float fj = pow(float(j) / float(SEGS), 1.35);
      float yy = tl * fj;
      // Hanging from the margin, drawn in a little and wandering round it (so they cross), trailing behind its
      // motion; a wave of its own runs down each, and one down the whole bundle.
      float aa = a + 0.25 * sin(0.9 * yy + hk * 9.0 - sway);
      float rr = Rm * (1.0 - 0.35 * smoothstep(0.0, 0.6, fj)) + 0.15 * fj * sin(1.6 * yy - sway + hk * 5.0) * calm;
      vec2 xz = vec2(cos(aa), sin(aa)) * rr - trail * yy * yy * 0.1;
      xz += vec2(sin(0.8 * yy - sway), cos(0.7 * yy - sway + 1.0)) * 0.22 * fj * calm;
      vec3 cur = vec3(xz.x, rimY - yy, xz.y);
      vec3 hit = raySeg(o, d, prev, cur);
      if (hit.x < best) { best = hit.x; bestS = (float(j - 1) + hit.z) / float(SEGS); }
      prev = cur;
    }
    tent += line(best, 0.008, px) * (1.0 - bestS);
    // The rim light at its root.
    float spot = spectrum(band + (fk / float(TENTACLES) - 0.5) * 0.08);
    vec3 sp = vec3(dir.x * Rm, rimY, dir.y * Rm);
    float ts = max(dot(sp - o, d), 0.0);
    float ds = length(o + d * ts - sp);
    // Vivid, and flaring on each contraction.
    light += col * line(ds, 0.03, px) * (0.3 + 2.5 * spot * spot) * (1.0 + 2.5 * c) * 0.6;
  }
  light += mix(col, pale, 0.15) * tent * bright * 0.6;
  // The oral arms: four frilled ribbons from the middle, each two strands twisting round each other.
  float arms = 0.0;
  for (int k = 0; k < 4; k++) {
    float a = 0.785398 + float(k) * 1.570796;
    vec2 dir = vec2(cos(a), sin(a));
    for (int st = 0; st < 2; st++) {
      vec3 prev = vec3(dir.x * 0.08, rimY + 0.12, dir.y * 0.08);
      float best = 1e9;
      float bestS = 0.0;
      for (int j = 1; j <= 9; j++) {
        float fj = float(j) / 9.0;
        float yy = len * (nettle ? 0.6 : 0.55) * fj;
        float tw = yy * 2.6 + float(st) * 3.14159 + float(k) * 1.3 - sway;
        vec2 xz = dir * (0.08 + 0.22 * fj) + vec2(cos(tw), sin(tw)) * (0.04 + 0.1 * fj) - trail * yy * yy * 0.1;
        xz += vec2(sin(1.1 * yy - sway + float(k)), cos(0.9 * yy - sway)) * 0.1 * fj * calm;
        vec3 cur = vec3(xz.x, rimY + 0.12 - yy, xz.y);
        vec3 hit = raySeg(o, d, prev, cur);
        if (hit.x < best) { best = hit.x; bestS = (float(j - 1) + hit.z) / 9.0; }
        prev = cur;
      }
      // Frilled: brighter and dimmer along it.
      float frill = 0.75 + 0.25 * sin(bestS * 25.0 + float(k + st) * 2.0);
      arms += line(best, nettle ? 0.035 : 0.022, px) * frill * (1.0 - bestS * 0.7);
    }
  }
  light += mix(pale, col2, 0.35) * arms * bright * 0.45;
  return light * fog;
}

// Marine snow: a mote in most cells of a grid round the camera, walked cell by cell; a few are plankton that glow.
vec3 snow(vec3 ro, vec3 rd, float pxAngle, int n) {
  const float CELL = 0.9;
  vec3 o = (ro + vec3(0.0, abDrift, 0.0)) / CELL;
  vec3 cell = floor(o);
  vec3 stepDir = sign(rd);
  vec3 tDelta = abs(1.0 / rd);
  vec3 tMax = (stepDir * (cell - o) + stepDir * 0.5 + 0.5) * tDelta;
  vec3 sum = vec3(0.0);
  vec3 tint = byDepth(vec3(0.55, 0.8, 0.85), vec3(0.1, 0.22, 0.28), vec3(0.015, 0.03, 0.045));
  for (int i = 0; i < 40; i++) {
    if (i >= n) break;
    vec3 hs = hash33(cell + 17.0);
    if (hs.x < 0.7) {
      vec3 m = cell + 0.2 + 0.6 * hash33(cell);
      m.x += 0.08 * sin(abClock * 0.7 + hs.y * 40.0);
      m.z += 0.08 * cos(abClock * 0.6 + hs.z * 40.0);
      float t = dot(m - o, rd);
      if (t > 0.0) {
        float dist = length(o + rd * t - m) * CELL;
        float tw = t * CELL;
        float r = 0.008 + 0.012 * hs.y;
        // Near the lens it's out of focus: a soft disc.
        float re = max(max(r, tw * pxAngle * 0.8), abs(tw - 5.0) * 0.006);
        float a = (r * r) / (re * re) * exp(-dist * dist / (re * re));
        float plankton = step(0.9, hs.z);
        float tw2 = 0.5 + 0.5 * sin(abClock * (3.0 + 5.0 * hs.y) + hs.x * 60.0);
        vec3 c = tint * (0.5 + 1.5 * shaftLight(m * CELL - vec3(0.0, abDrift, 0.0)));
        c = mix(c, glowColor(floor(hs.y * 8.0)) * (0.4 + 6.0 * abSparkle * tw2 * tw2), plankton);
        sum += c * a * exp(-0.08 * tw) * smoothstep(0.4, 1.6, tw);
      }
    }
    // On to the next cell.
    vec3 mask = step(tMax.xyz, tMax.yzx) * step(tMax.xyz, tMax.zxy);
    tMax += mask * tDelta;
    cell += mask * stepDir;
  }
  return sum * 1.2;
}

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  float pxAngle = 2.0 * camLens / min(resolution.x, resolution.y);
  vec3 col = water(rd);
  col += shafts(ro, rd, int(mix(20.0, 60.0, quality)));
  float through = 1.0;
  vec3 glowSum = vec3(0.0);
  vec4 J[${JELLIES}];
  vec4 K[${JELLIES}];
  vec4 L[${JELLIES}];
  vec4 M[${JELLIES}];
${Array.from({ length: JELLIES }, (_, i) => `  J[${i}] = abJ${i}; K[${i}] = abK${i}; L[${i}] = abL${i}; M[${i}] = abM${i};`).join("\n")}
  for (int i = 0; i < ${JELLIES}; i++) {
    if (L[i].w <= 0.002) continue;
    glowSum += jelly(ro, rd, float(i), J[i], K[i], L[i], M[i], pxAngle, through);
  }
  col = col * through + glowSum;
  col += snow(ro, rd, pxAngle, int(mix(16.0, 36.0, quality)));
  return col;
}
`,

  init() {
    const s: AbyssState = { time: 0, clock: 0, drift: 0, fx: 0, fy: 0, fz: 0, heading: 0.4, orbit: 0.6, shaft: 0.5, sparkle: 0, jellies: [], placed: false, rng: { seed: 0xab155 } };
    for (let i = 0; i < JELLIES; i++) s.jellies.push(spawn(s, i, false, (i * 2.3) % TAU));
    return s;
  },
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    const count = Math.max(1, Math.min(JELLIES, Math.round(num(frame.values, "jellies", 7))));
    // On the first frame, each starts at its place (which depends on how many are shown).
    if (!s.placed) {
      s.placed = true;
      s.jellies.forEach((j, i) => {
        const h = homeOf(j, i, count);
        [j.x, j.y, j.z] = [s.fx + h[0], s.fy + h[1], s.fz + h[2]];
      });
    }
    s.time += dt;
    s.clock += dt;
    s.drift += dt * 0.06;
    s.shaft = smoothTo(s.shaft, a.level, frame.dt, 0.3);
    s.sparkle = smoothTo(s.sparkle, a.high, frame.dt, 0.15);
    const kick = a.onBeat ? Math.max(0.6, frame.hit) : 0;
    s.jellies.forEach((j, i) => stepJelly(s, j, dt, kick, i, count));
    spaceOut(s, count, dt);
    // The focus follows the group up as it swims (where its jellies are, less their places), and a slow current
    // carries it along.
    let rise = 0;
    let n = 0;
    s.jellies.forEach((j, i) => {
      if (i < count && TIERS[i] === 0) {
        rise += j.y - homeOf(j, i, count)[1];
        n += 1;
      }
    });
    s.fy = smoothTo(s.fy, n ? rise / n : s.fy, dt, 1.2);
    s.heading += dt * 0.06 * Math.sin(s.time * 0.05 + 1);
    s.fx += Math.cos(s.heading) * 0.12 * dt;
    s.fz += Math.sin(s.heading) * 0.12 * dt;
    // One that has strayed far from its place (it can't, by much) comes back from below.
    s.jellies.forEach((j, i) => {
      const h = homeOf(j, i, count);
      const off = Math.hypot(j.x - s.fx - h[0], j.y - s.fy - h[1], j.z - s.fz - h[2]);
      if (off > 9) {
        const fresh = spawn(s, i, true, j.sway);
        const fh = homeOf(fresh, i, count);
        [fresh.x, fresh.y, fresh.z] = [s.fx + fh[0], s.fy + fh[1] - 6, s.fz + fh[2]];
        s.jellies[i] = fresh;
      }
    });
    // The camera's way round the group: a slow arc, a little quicker when it's loud.
    s.orbit += dt * (0.1 + 0.05 * a.level);
  },
  uniforms(s, frame) {
    const count = Math.max(1, Math.min(JELLIES, Math.round(num(frame.values, "jellies", 7))));
    const pos = cameraAt(s, count);
    // It looks at the group, its gaze swinging a little to either side and up and down.
    const side = 1.3 * Math.sin(s.time * 0.11);
    const target: Vec3 = [s.fx - Math.sin(s.orbit) * side, s.fy + 0.5 + 0.6 * Math.sin(s.time * 0.17), s.fz + Math.cos(s.orbit) * side];
    const focus = Math.hypot(target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]);
    const out = [
      ...cameraUniforms(pos, target, 0.06 * Math.sin(s.time * 0.21), 58),
      ...soundUniforms(frame),
      float("abClock", s.clock % 1000),
      float("abDrift", s.drift % 900),
      float("abShaft", s.shaft),
      float("abSparkle", s.sparkle),
      float("abFocus", focus),
    ];
    s.jellies.forEach((j, i) => {
      const [u, e1, e2] = frameOf(j);
      // Its motion across its axis (in its own frame): the tentacles trail the other way. Along it: they stream.
      const lateral = [j.vx * e1[0] + j.vy * e1[1] + j.vz * e1[2], j.vx * e2[0] + j.vy * e2[1] + j.vz * e2[2]];
      const axial = (j.vx * u[0] + j.vy * u[1] + j.vz * u[2]) / j.size;
      // Fading in when respawned, and out right at the lens (near its bell or anywhere along its tentacles).
      const reach = 4.2 * j.reach * (j.kind ? 1.75 : 1) * j.size;
      const rel: Vec3 = [pos[0] - j.x, pos[1] - j.y, pos[2] - j.z];
      const along = Math.max(-reach, Math.min(0, rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2]));
      const near = Math.hypot(rel[0] - u[0] * along, rel[1] - u[1] * along, rel[2] - u[2] * along) / j.size;
      const fade = i < count ? j.born * smoothstep(1.6, 3.0, near) : 0;
      out.push(
        vec4(`abJ${i}`, [j.x, j.y, j.z, j.size]),
        vec4(`abK${i}`, [j.tx, j.tz, clamp01(j.c), axial]),
        vec4(`abL${i}`, [lateral[0] / j.size, lateral[1] / j.size, j.sway, fade]),
        vec4(`abM${i}`, [j.kind, j.reach, 0, 0]),
      );
    });
    return out;
  },
};
