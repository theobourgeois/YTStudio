/**
 * Infinite Dive (docs/visualizer/scenes.md): falling into a fractal that never ends, swooping as it goes. The
 * world is exactly self-similar about the origin: one level's structure (`levelForm` in the GLSL), and copies of
 * it scaled by `SCALE` and turned by the Twist, inwards and outwards for ever. So the camera's depth wraps every
 * level: it's drawn at its depth's fraction (`dive.wrap`), and nothing shows the seam, as everything the shader
 * does (fog, glow, the space carved round the lens, colour by absolute level) looks the same at any scale.
 * Stepped: the depth (a fall speed on the bass), the camera's place around the heart (swooping: angular speeds
 * eased towards targets the hits pick, a seeded random walk), where it looks (off the heart and back) and its roll.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, add, cameraLooking, clamp01, cross, float, normalize, num, random, scale, sceneDt, smoothTo, soundUniforms } from "./kit.ts";

/** How much smaller each level is than the one around it. */
export const SCALE = 2.4;

interface DiveState {
  time: number;
  /** Depth, in levels (fractions included). */
  depth: number;
  fall: number;
  /** The camera's place around the heart (azimuth, elevation) and how fast it swoops. */
  az: number;
  el: number;
  vAz: number;
  vEl: number;
  tAz: number;
  tEl: number;
  /** Where it looks, off the heart (yaw, pitch), and its roll. */
  yaw: number;
  pitch: number;
  roll: number;
  /** A hit's flash, falling. */
  flash: number;
  rng: { seed: number };
}

/** A point turned about the y axis by `a` radians. */
const turnY = (p: Vec3, a: number): Vec3 => [Math.cos(a) * p[0] + Math.sin(a) * p[2], p[1], -Math.sin(a) * p[0] + Math.cos(a) * p[2]];

/** The twist between one level and the next, radians. */
const twistOf = (values: Record<string, unknown>) => (num(values as never, "twist", 0.35) * Math.PI) / 2;

export const INFINITE_DIVE: SceneSpec<DiveState> = {
  type: "infinite-dive",
  label: "Infinite Dive",
  params: [
    {
      kind: "choice",
      key: "form",
      label: "Form",
      default: "portals",
      options: [
        { value: "portals", label: "Portals" },
        { value: "lattice", label: "Lattice" },
        { value: "spires", label: "Spires" },
      ],
    },
    {
      kind: "choice",
      key: "palette",
      label: "Palette",
      default: "iridescent",
      options: [
        { value: "iridescent", label: "Iridescent" },
        { value: "gold", label: "Gold" },
        { value: "ice", label: "Ice" },
        { value: "ember", label: "Ember" },
      ],
    },
    { kind: "number", key: "twist", label: "Twist", default: 0.35, min: 0, max: 1, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "glow", label: "Glow", default: 1, min: 0, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  glsl: /* glsl */ `
uniform float idLevel;
uniform float idFlash;
const float SCALE = ${SCALE.toFixed(4)};
const float LOG_SCALE = ${Math.log(SCALE).toFixed(6)};
const float BUBBLE = 0.05;
mat3 turnY(float a) { float c = cos(a); float s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
float twistAngle() { return twist * 1.5707963; }

// How big a pixel is where the ray is now, in the units of the level being measured (detail finer than a few
// pixels is left out, or it shimmers).
float gPix = 0.0;

// Octahedral symmetry: any direction folded into one 48th of the sphere (x >= y >= z >= 0).
vec3 foldOcta(vec3 p) {
  p = abs(p);
  if (p.x < p.y) p.xy = p.yx;
  if (p.y < p.z) p.yz = p.zy;
  if (p.x < p.y) p.xy = p.yx;
  return p;
}
// A ring round axis n (a unit vector) at distance c from the origin: radius a, tube thickness w.
float ring(vec3 p, vec3 n, float c, float a, float w) {
  vec3 q = p - n * c;
  float h = dot(q, n);
  return length(vec2(length(q - n * h) - a, h)) - w;
}
// A spike along n from radius r0 (width w0) to a point at r1.
float spike(vec3 p, vec3 n, float r0, float r1, float w0) {
  float h = clamp(dot(p, n), r0, r1);
  float rho = length(p - n * h);
  float w = w0 * (r1 - h) / (r1 - r0);
  return (rho - w) * 0.9 + max(0.0, r0 - dot(p, n));
}

// One level's structure, in [1, SCALE): a lace shell, a cage of portals, a geode of spires.
// trap: what colours it (x: a pattern value, y: how near an edge).
float levelForm(vec3 q, out vec2 trap) {
  float r = length(q);
  if (form == 0) {
    // Portals: rings at the 26 directions of a cube's faces, edges and corners, joined by great circles.
    vec3 p = foldOcta(q);
    float d = ring(p, vec3(1.0, 0.0, 0.0), 1.62, 0.3, 0.022);
    d = min(d, ring(p, vec3(0.7071068, 0.7071068, 0.0), 1.62, 0.2, 0.018));
    d = min(d, ring(p, vec3(0.5773503), 1.62, 0.24, 0.018));
    // The cage: great circles in the coordinate planes and the diagonal ones.
    float shellR = r - 1.62;
    float cage = min(length(vec2(shellR, p.z)), length(vec2(shellR, (p.x - p.y) * 0.7071068))) - 0.009;
    d = min(d, cage);
    // Small orbs in the portals' middles.
    d = min(d, length(p - vec3(1.62, 0.0, 0.0)) - 0.05);
    d = min(d, length(p - vec3(0.5773503) * 1.62) - 0.035);
    trap = vec2(fract(p.y * 3.1 + p.z * 1.7), smoothstep(0.03, 0.0, cage));
    return d;
  }
  if (form == 2) {
    // Spires: crystal needles out from the inner edge at a dozen-and-more symmetric directions.
    vec3 p = foldOcta(q);
    float d = spike(p, vec3(1.0, 0.0, 0.0), 0.9, 2.3, 0.07);
    d = min(d, spike(p, vec3(0.7071068, 0.7071068, 0.0), 0.95, 1.9, 0.05));
    d = min(d, spike(p, vec3(0.5773503), 0.95, 2.15, 0.06));
    d = min(d, spike(p, normalize(vec3(2.0, 1.0, 0.0)), 1.05, 1.6, 0.035));
    d = min(d, spike(p, normalize(vec3(2.0, 1.0, 1.0)), 1.05, 1.75, 0.035));
    d = min(d, spike(p, normalize(vec3(3.0, 2.0, 1.0)), 1.1, 1.5, 0.025));
    // Each spire's root a small faceted gem.
    d = min(d, length(p - vec3(1.0, 0.0, 0.0)) - 0.11);
    trap = vec2(fract(r * 0.8), smoothstep(1.5, 2.3, r));
    return d;
  }
  {
    // Lattice: a thin shell cut by a Menger sponge's crosses at three sizes (holes within holes).
    float d = abs(r - 1.62) - 0.06;
    float size = 1.2;
    float edge = 1.0;
    float cell = 0.0;
    for (int k = 0; k < 3; k++) {
      if (size < gPix * 3.0) break;
      vec3 b = abs(mod(q + 0.5 * size, size) / size - 0.5);
      // The three bars of the cross: two coordinates within a sixth of the cell's middle.
      float bars = min(min(max(b.x, b.y), max(b.y, b.z)), max(b.z, b.x)) - 0.21;
      d = max(d, -bars * size);
      edge = min(edge, abs(bars) * 6.0);
      cell += dot(floor((q + 0.5 * size) / size), vec3(0.17, 0.31, 0.43));
      size /= 3.0;
    }
    trap = vec2(fract(cell * 0.37), 1.0 - smoothstep(0.0, 0.03, edge));
    return d;
  }
  trap = vec2(0.0);
  return r - 1.5;
}

// The whole world: a point's own level and the ones either side, the nearest. lev: whose surface it is;
// raw: the distance before the lens's carve.
float worldRaw(vec3 p, out vec2 trap, out float lev, out float raw) {
  float r = max(length(p), 1e-7);
  float L = floor(log(r) / LOG_SCALE);
  float best = 1e9;
  trap = vec2(0.0);
  lev = L;
  for (int j = -1; j <= 1; j++) {
    float k = L + float(j);
    float sk = pow(SCALE, k);
    vec2 tr;
    float pix = gPix;
    gPix = pix / sk;
    float d = levelForm(turnY(-k * twistAngle()) * p / sk, tr) * sk;
    gPix = pix;
    if (d < best) { best = d; trap = tr; lev = k; }
  }
  // Nothing within reach of the lens: what it passes through is carved away (and glows at the cut).
  raw = best;
  float bubble = BUBBLE * length(camPos) - length(p - camPos);
  return max(best, bubble);
}
float world(vec3 p, out vec2 trap, out float lev) { float raw; return worldRaw(p, trap, lev, raw); }
float worldD(vec3 p) { vec2 t; float l; return world(p, t, l); }
vec3 worldNormal(vec3 p, float eps) {
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * worldD(p + k.xyy * eps) + k.yyx * worldD(p + k.yyx * eps) + k.yxy * worldD(p + k.yxy * eps) + k.xxx * worldD(p + k.xxx * eps));
}

vec3 paletteAt(float x) {
  // Cosine palettes (a + b cos(2pi(c x + d))).
  vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(1.0), d;
  if (palette == 1) { a = vec3(0.6, 0.45, 0.25); b = vec3(0.4, 0.3, 0.2); d = vec3(0.0, 0.05, 0.15); }
  else if (palette == 2) { a = vec3(0.4, 0.6, 0.8); b = vec3(0.3, 0.3, 0.25); d = vec3(0.5, 0.55, 0.6); }
  else if (palette == 3) { a = vec3(0.6, 0.3, 0.15); b = vec3(0.4, 0.3, 0.15); d = vec3(0.0, 0.1, 0.2); }
  else d = vec3(0.0, 0.33, 0.67);
  return a + b * cos(6.2831853 * (c * x + d));
}

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  float scaleNow = length(camPos);
  float t = 0.0;
  float tmax = 40.0 * scaleNow;
  int steps = int(mix(70.0, 200.0, quality));
  vec2 trap = vec2(0.0);
  float lev = 0.0;
  float halo = 0.0;
  float hit = -1.0;
  for (int i = 0; i < 200; i++) {
    if (i >= steps || t > tmax) break;
    vec3 p = ro + rd * t;
    gPix = 0.0015 * t;
    float d = world(p, trap, lev);
    // Near misses glow, measured in the size of where they are (so every level glows the same).
    float rel = d / max(length(p), 1e-5);
    halo += exp(-rel * 90.0) * 0.004;
    if (d < 0.0006 * t + 1e-6) { hit = t; break; }
    t += d * 0.8;
  }
  // The heart: light at the origin, its size and brightness the same at every level.
  vec3 toHeart = -ro;
  float along = dot(toHeart, rd);
  float miss = length(toHeart - rd * along) / max(length(toHeart), 1e-6);
  vec3 heartCol = paletteAt(idLevel * 0.11 + 0.15) * 1.2 + 0.25;
  vec3 col = heartCol * (exp(-miss * 18.0) * 2.0 + exp(-miss * 4.0) * 0.25) * (0.8 + 0.6 * sLevel) * step(0.0, along);
  if (hit > 0.0) {
    vec3 p = ro + rd * hit;
    float r = length(p);
    float raw;
    worldRaw(p, trap, lev, raw);
    vec3 n = worldNormal(p, 0.0005 * hit + 1e-6);
    // Colour by absolute level (the seam can't show) and the pattern within it.
    float absLevel = lev + idLevel;
    vec3 tint = paletteAt(absLevel * 0.11 + trap.x * 0.25 + sMid * 0.15);
    vec3 base = mix(vec3(0.05), tint * 0.12, 0.6);
    vec3 toCore = normalize(-p);
    float core = clamp(dot(n, toCore), 0.0, 1.0);
    float head = clamp(dot(n, -rd), 0.0, 1.0);
    // Ambient occlusion, in units of where it is.
    float ao = 0.0;
    for (int k = 1; k <= 4; k++) {
      float h = 0.02 * float(k) * r;
      ao += (h - worldD(p + n * h)) / r;
    }
    ao = clamp(1.0 - ao * 6.0, 0.0, 1.0);
    // Lit from the heart, a little from the lens; a sheen where it faces the heart.
    vec3 h = normalize(toCore - rd);
    float spec = pow(clamp(dot(n, h), 0.0, 1.0), 40.0);
    vec3 lit = base * (heartCol * core * core * 1.2 + vec3(0.2, 0.25, 0.4) * head * 0.3) * ao + heartCol * spec * 0.18 * ao;
    // The edges of the holes glow (more on a hit).
    lit += tint * trap.y * (0.05 + 0.3 * sBeat + 0.25 * idFlash) * glow;
    // Where the lens's carve cuts through: dark glass, its rim (where it meets the surface) glowing.
    if (raw < -0.0005 * hit) {
      float rim = exp(raw / (0.0015 * scaleNow));
      float fres = pow(1.0 - head, 3.0);
      lit = mix(vec3(0.004, 0.003, 0.01), tint * 0.08, fres) + heartCol * rim * 0.5;
    }
    // Fog in units of the camera's own scale.
    float fog = 1.0 - exp(-hit / scaleNow * 0.35);
    col = mix(lit, col * 0.5 + heartCol * 0.008, fog);
  }
  col += paletteAt(idLevel * 0.11 + 0.5) * halo * 0.08 * (0.5 + idFlash) * glow;
  return col;
}
`,
  init: () => ({ time: 0, depth: 0, fall: 0.3, az: 0.4, el: 0.3, vAz: 0.15, vEl: 0, tAz: 0.15, tEl: 0, yaw: 0, pitch: 0, roll: 0, flash: 0, rng: { seed: 0xd1be5eed } }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    s.time += dt;
    s.fall = smoothTo(s.fall, 0.22 + 0.4 * a.bass + 0.3 * a.punch, frame.dt, 0.5);
    s.depth += s.fall * dt;
    if (a.onBeat) {
      // A hit picks a new swoop: which way round the heart, how fast.
      s.tAz = (random(s.rng) - 0.5) * 1.6;
      s.tEl = (random(s.rng) - 0.5) * 1.0;
      s.flash = 1;
    }
    s.flash = Math.max(0, s.flash - frame.dt * 2.5);
    s.vAz = smoothTo(s.vAz, s.tAz, frame.dt, 0.9);
    s.vEl = smoothTo(s.vEl, s.tEl - s.el * 0.6, frame.dt, 0.9);
    s.az += s.vAz * dt;
    s.el = Math.max(-1.25, Math.min(1.25, s.el + s.vEl * dt));
    // Looks off the heart and back, and banks with the swoop.
    s.yaw = smoothTo(s.yaw, 0.55 * Math.sin(s.time * 0.31) + 0.3 * s.vAz, frame.dt, 0.8);
    s.pitch = smoothTo(s.pitch, 0.35 * Math.sin(s.time * 0.23 + 1.3) + 0.25 * s.vEl, frame.dt, 0.8);
    s.roll = smoothTo(s.roll, 0.6 * s.vAz + 0.25 * Math.sin(s.time * 0.17), frame.dt, 0.7);
  },
  uniforms(s, frame) {
    const twist = twistOf(frame.values);
    const level = Math.floor(s.depth);
    const f = s.depth - level;
    // Where the camera is in the frame that falls with it: on a sphere round the heart, the outer edge of a level.
    const out: Vec3 = [Math.cos(s.el) * Math.cos(s.az), Math.sin(s.el), Math.cos(s.el) * Math.sin(s.az)];
    const east = normalize(cross([0, 1, 0], out));
    const north = cross(out, east);
    // Looking at the heart, turned off it by the yaw and pitch.
    const inward = scale(out, -1);
    let fwd = normalize(add(add(scale(inward, Math.cos(s.yaw) * Math.cos(s.pitch)), scale(east, Math.sin(s.yaw))), scale(north, Math.sin(s.pitch))));
    // The wrap: this level's fraction of the way in, scaled and turned as the world is.
    const k = SCALE ** -f;
    const pos = turnY(scale(out, SCALE * 0.92 * k), -twist * f);
    fwd = turnY(fwd, -twist * f);
    const up = turnY(north, -twist * f);
    return [...cameraLooking(pos, fwd, s.roll, 78, up), ...soundUniforms(frame), float("idLevel", level), float("idFlash", s.flash * clamp01(1))];
  },
};
