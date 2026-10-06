/**
 * Event Horizon (docs/visualizer/scenes.md, "Five more"): a black hole, Interstellar's Gargantua. Every pixel's ray
 * is bent as light is round a Schwarzschild hole (the orbit equation `r'' = -1.5 h² r / |r|⁵`, the horizon's radius
 * 1, stepped finer near the hole): a ray that falls in is black, one that escapes reads the sky in its final
 * direction (so the stars are lensed, Einstein rings and all), and each crossing of the disk's plane on the way
 * adds the accretion disk's light there, so the disk's far side shows bent up over the hole and under it. The disk
 * is a blackbody whose temperature falls outwards from its inner edge, streaked by turbulence that turns at
 * Kepler's speed, brighter and bluer where it rushes at us (Doppler beaming) and redder deep in the well. It hears
 * the sound itself: its rings are the spectrum (the bass at the inner edge). Stepped: the disk's clock (two flows
 * crossfaded, so the streaks never wind up into rings), the camera's orbit, its inclination easing between
 * edge-on and from above, its distance (closer when it's loud), and the clumps each hit drops into the disk, which
 * spiral in at their orbit's speed and flare as they fall.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraUniforms, clamp01, num, random, sceneDt, smoothTo, smoothstep, soundUniforms, vec4, wrap } from "./kit.ts";

/** The disk's inner and outer radii (the horizon is 1; the innermost stable orbit is 3). */
const R_IN = 3;
const R_OUT = 13;
/** How long one flow of the disk's streaks lasts (in its clock) before the other takes over. */
const FLOW_PERIOD = 6;
const CLUMPS = 8;

interface Clump {
  r: number;
  phi: number;
  age: number;
  power: number;
  /** Seconds since it reached the inner edge (-1 until then). */
  fallen: number;
}

interface HorizonState {
  time: number;
  /** The disk's clock: the inner edge's angle turned so far (wrapped). */
  spin: number;
  heat: number;
  orbit: number;
  /** Where the inclination's slow swing is. */
  tilt: number;
  dist: number;
  /** A kick's nudge to the camera: its target jumps on a hit and falls; the nudge eases after it. */
  kick: number;
  kickTarget: number;
  clumps: Clump[];
  rng: { seed: number };
}

/** Angular speed at radius r relative to the inner edge's (Kepler's). */
const kepler = (r: number) => Math.pow(R_IN / Math.max(r, R_IN * 0.5), 1.5);

export const EVENT_HORIZON: SceneSpec<HorizonState> = {
  type: "event-horizon",
  label: "Event Horizon",
  params: [
    {
      kind: "choice",
      key: "disk",
      label: "Disk",
      default: "gargantua",
      options: [
        { value: "gargantua", label: "Gargantua" },
        { value: "blue", label: "Blue Giant" },
        { value: "ember", label: "Ember" },
      ],
    },
    { kind: "number", key: "inclination", label: "Inclination", default: 22, min: 2, max: 80, unit: "°", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "turbulence", label: "Turbulence", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  audio: () => ({ rows: 1, span: 0, fall: 0.2, window: 0 }),
  glsl: /* glsl */ `
uniform vec4 ehFlow;
uniform vec4 ehDisk;
uniform vec4 ehClump0;
uniform vec4 ehClump1;
uniform vec4 ehClump2;
uniform vec4 ehClump3;
uniform vec4 ehClump4;
uniform vec4 ehClump5;
uniform vec4 ehClump6;
uniform vec4 ehClump7;
const float FLOW_PERIOD = ${FLOW_PERIOD.toFixed(1)};
// The critical impact parameter: rays aimed closer than this fall in (the shadow's edge, the photon ring).
const float B_CRIT = 2.598076;

// A blackbody's colour at T kelvin, from Planck's law at three wavelengths (µm), white at 6500 K, at unit brightness.
vec3 planck(float T) {
  vec3 lam = vec3(0.65, 0.54, 0.44);
  return 1.0 / (lam * lam * lam * lam * lam * (exp(14388.0 / (lam * max(T, 700.0))) - 1.0));
}
vec3 blackbody(float T) {
  vec3 b = planck(T) / vec3(0.297, 0.367, 0.400);
  return b / dot(b, vec3(0.3333));
}
// The disk's peak temperature, by its look.
float peakTemp() {
  if (disk == 1) return 15000.0;
  if (disk == 2) return 2700.0;
  return 3900.0;
}
// The disk's profile (Shakura and Sunyaev's temperature, 1 at its peak) at radius r.
float profile(float r) {
  float x = ehDisk.x * 0.94 / max(r, 0.5);
  return pow(x, 0.75) * pow(max(1.0 - sqrt(x), 0.0), 0.25) / 0.488;
}
// Streaks: noise on a circle round the disk (no seam where the angle wraps), long along the orbit, fine across it;
// x is the large clumps of gas, y the thin filaments that run round in them. fp is a pixel's footprint in noise
// cells (lensing squeezes the disk's far side into thin arcs): detail finer than a pixel fades to its average.
vec2 streaks(float a, float lr, float seed, int octaves, float fp) {
  vec2 ring = vec2(cos(a), sin(a));
  vec3 q = vec3(ring * 2.2, lr * 9.0) + seed * vec3(7.31, 3.17, 11.7);
  float s = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  float k = fp;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    float keep = 1.0 - smoothstep(0.45, 1.1, k);
    s += amp * mix(0.5, vnoise3(q), keep);
    norm += amp;
    q = q * vec3(2.0, 2.0, 2.3) + vec3(1.7, 9.2, 3.1);
    amp *= 0.5;
    k *= 2.2;
  }
  vec3 fq = vec3(ring * 1.3, lr * 46.0) + seed * vec3(3.1, 5.7, 1.3);
  float keep1 = 1.0 - smoothstep(0.45, 1.1, fp * 5.1);
  float keep2 = 1.0 - smoothstep(0.45, 1.1, fp * 10.5);
  float f = 1.0 - abs(2.0 * vnoise3(fq) - 1.0);
  float f2 = 1.0 - abs(2.0 * vnoise3(fq * vec3(2.0, 2.0, 2.1) + 4.0) - 1.0);
  f = mix(0.5, f * f, keep1) * (0.6 + 0.4 * mix(0.5, f2, keep2));
  return vec2(s / norm, f);
}
// A clump a hit dropped (at c.xyz in the disk's plane, c.w its brightness) on the disk's surface: bright where it
// is, a tail trailing behind along its orbit.
float clumpAt(vec4 c, float r, float phi) {
  if (c.w <= 0.0) return 0.0;
  float cr = length(c.xz);
  float da = phi - atan(c.z, c.x);
  da -= 2.0 * PI * floor(da / (2.0 * PI) + 0.5);
  float along = da * r;
  float across = r - cr;
  float s = 0.16 + 0.02 * cr;
  float tail = along < 0.0 ? s * 4.0 : s;
  return c.w * exp(-across * across / (s * s) - along * along / (tail * tail));
}
// The disk where a ray crosses its plane at p, the ray running along v: its light (rgb) and opacity (a).
vec4 diskAt(vec3 p, vec3 v, int octaves, float fp) {
  float r = length(p.xz);
  float rin = ehDisk.x;
  float rout = ehDisk.y;
  if (r < rin * 0.92 || r > rout) return vec4(0.0);
  float phi = atan(p.z, p.x);
  float w = pow(rin / r, 1.5);
  float lr = log(r);
  // Two flows, each turned by its own clock, crossfaded: the streaks shear as Kepler says without winding for ever.
  float wa = 1.0 - abs(2.0 * ehFlow.x / FLOW_PERIOD - 1.0);
  vec2 st = wa * streaks(phi - w * ehFlow.x, lr, ehFlow.z, octaves, fp) + (1.0 - wa) * streaks(phi - w * ehFlow.y, lr, ehFlow.w, octaves, fp);
  // Contrast: the turbulence's amount.
  float n = clamp(0.5 + (st.x - 0.5) * (1.0 + 2.4 * turbulence), 0.0, 1.0) * mix(1.0, 0.45 + 0.9 * st.y, min(turbulence, 1.0));
  // The temperature profile of a thin disk (Shakura and Sunyaev's), its peak just outside the inner edge.
  float prof = profile(r);
  float temp = peakTemp() * prof * (1.0 + 0.25 * ehDisk.z) * (0.85 + 0.3 * n);
  // The rings are the spectrum: the bass inside, the highs out.
  float band = clamp((r - rin) / (rout - rin), 0.0, 1.0);
  float sound = 0.5 + 1.1 * spectrum(0.03 + band * 0.8);
  // Doppler: the gas orbits at Kepler's speed; light leaving it towards us (-v) is boosted where it comes at us.
  float beta = min(sqrt(0.5 / max(r - 1.0, 0.2)), 0.75);
  vec3 vel = vec3(-sin(phi), 0.0, cos(phi)) * beta;
  float gamma = inversesqrt(1.0 - beta * beta);
  float dop = 1.0 / (gamma * (1.0 - dot(vel, -normalize(v))));
  float g = dop * sqrt(max(1.0 - 1.0 / r, 0.0));
  // The edges: a soft inner lip, a long fade outwards.
  float edge = smoothstep(rin * 0.92, rin * 1.02, r) * pow(1.0 - smoothstep(rin * 1.2, rout, r), 1.6);
  float bright = pow(prof, 1.6) * edge * (0.25 + 1.6 * n * n) * sound * (0.85 + 0.4 * ehDisk.z);
  // Clumps: hotter than the gas round them.
  float cl = clumpAt(ehClump0, r, phi) + clumpAt(ehClump1, r, phi) + clumpAt(ehClump2, r, phi) + clumpAt(ehClump3, r, phi)
    + clumpAt(ehClump4, r, phi) + clumpAt(ehClump5, r, phi) + clumpAt(ehClump6, r, phi) + clumpAt(ehClump7, r, phi);
  vec3 col = blackbody(temp * g) * bright * pow(g, 3.0) * 0.42;
  // A little richer than Planck: the cool outer disk deep orange rather than tan.
  col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 1.25), 0.0);
  col += blackbody(peakTemp() * 1.5 * g) * cl * pow(g, 3.0) * 0.6 * edge;
  float alpha = clamp(edge * (0.3 + 0.7 * n) * (0.4 + 0.6 * prof) + cl * 0.5, 0.0, 0.97);
  return vec4(col, alpha);
}
// One layer of stars: one to a cell of directions, soft points no smaller than a pixel (px: a pixel's angle).
vec3 starLayer(vec3 d, float cells, float keep, float px) {
  vec3 q = d * cells;
  vec3 c = floor(q);
  float h = hash13(c + 17.0);
  if (h < keep) return vec3(0.0);
  vec3 sp = normalize(c + 0.25 + 0.5 * hash33(c)) * cells;
  float dist = length(sp - q);
  float s0 = 0.035;
  float sig = max(s0, px * cells * 0.7);
  float amp = (s0 * s0) / (sig * sig);
  float mag = pow(hash13(c + 5.3), 8.0) * 6.0 + 0.15;
  return blackbody(3200.0 + 9000.0 * hash13(c + 2.1)) * mag * amp * exp(-dist * dist / (sig * sig));
}
// The sky behind it: stars and a galaxy (a band of soft light, warm at its core, cut by dark lanes of dust), read in
// the escaped ray's direction.
vec3 sky(vec3 d, float px) {
  vec3 axis = normalize(vec3(0.1, 0.8, -0.62));
  float lat = dot(d, axis);
  // Along the band: its core is one way round.
  vec3 core = normalize(cross(axis, vec3(0.0, 0.0, 1.0)));
  float toCore = 0.5 + 0.5 * dot(normalize(d - axis * lat), core);
  float width = 0.11 + 0.08 * toCore;
  float band = exp(-lat * lat / (width * width));
  float lanes = smoothstep(0.42, 0.62, fbm3(d * 6.0 + 3.0, 5));
  float clouds = fbm3(d * 16.0 + 11.0, 4);
  float grain = vnoise3(d * 70.0);
  float glow = band * (0.2 + 1.1 * clouds * clouds * (0.6 + 0.8 * grain)) * (1.0 - 0.85 * lanes * exp(-lat * lat / (width * width * 0.25)));
  vec3 tint = mix(vec3(0.55, 0.65, 1.0), vec3(1.0, 0.75, 0.5), toCore * toCore);
  vec3 col = tint * glow * (0.035 + 0.1 * pow(toCore, 3.0));
  col += vec3(0.0012, 0.0015, 0.003);
  col += starLayer(d, 110.0, 0.94, px) * 0.6;
  col += starLayer(d, 260.0, 0.88 - band * 0.25, px) * (0.1 + 0.15 * band);
  return col;
}

// A pixel's footprint on the disk where a ray crossed it, in streak noise cells: from how fast the crossing's place
// changes across the frame (so lensing is in it), across the orbits and along them.
float footprint(vec3 c) {
  float lr = log(max(length(c.xz), 0.1));
  float ph = atan(c.z, c.x);
  float fa = min(fwidth(ph), fwidth(mod(ph + 2.0 * PI, 2.0 * PI) - PI));
  return min(max(fwidth(lr) * 9.0, fa * 2.2), 4.0);
}

// The lens: set for the shorter side, as every scene's is, but closer in portrait, where a black hole framed by
// the width would leave the top and bottom thirds empty (there the disk runs off the sides instead).
float lensSpan() { return pow(min(ratio, 1.0), 0.32); }
vec3 holeRay(vec2 uv) {
  vec2 p = (uv - 0.5) * 2.0 * vec2(ratio, 1.0) / lensSpan();
  return normalize(camFwd + camLens * (p.x * camRight + p.y * camUp));
}
// A pixel's angle, before lensing.
float pixelAngle() { return 2.0 * camLens / (lensSpan() * resolution.y); }

vec3 scene(vec2 uv) {
  vec3 p = camPos;
  vec3 v = holeRay(uv);
  // The ray's angular momentum is kept (h = |p x v|), and is its impact parameter: rays below B_CRIT fall in.
  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);
  float b = sqrt(h2);
  float rin = ehDisk.x;
  float escape = ehDisk.y + 1.0;
  float haze = 0.0;
  float knots = 0.0;
  vec4 clumps[8];
  clumps[0] = ehClump0; clumps[1] = ehClump1; clumps[2] = ehClump2; clumps[3] = ehClump3;
  clumps[4] = ehClump4; clumps[5] = ehClump5; clumps[6] = ehClump6; clumps[7] = ehClump7;
  // Roughly how much of the light behind still gets through (the disk's real opacity is worked out later).
  float through = 1.0;
  bool fell = false;
  // Where the ray crossed the disk's plane, and its direction there, nearest first.
  vec3 cp[4];
  vec3 cv[4];
  for (int k = 0; k < 4; k++) { cp[k] = vec3(rin * 2.0, 0.0, 0.0); cv[k] = vec3(0.0, 0.0, 1.0); }
  int crossings = 0;
  int maxSteps = int(mix(90.0, 240.0, quality));
  float stepK = mix(0.16, 0.08, quality);
  vec3 acc = -1.5 * h2 * p / pow(length(p), 5.0);
  for (int i = 0; i < 240; i++) {
    if (i >= maxSteps) break;
    float r = length(p);
    if (r < 1.0) { fell = true; break; }
    if (r > escape && dot(p, v) > 0.0) break;
    // Finer near the hole, where rays bend most.
    float dt = r * stepK * mix(0.35, 1.0, smoothstep(1.5, 6.0, r));
    // Velocity Verlet: kick, drift, kick.
    v += acc * dt * 0.5;
    vec3 prev = p;
    p += v * dt;
    float rn = length(p);
    acc = -1.5 * h2 * p / (rn * rn * rn * rn * rn);
    v += acc * dt * 0.5;
    // The disk's glow in the space just over it: a bloom that's lensed with everything else.
    float pr = length(p.xz);
    haze += through * dt * pow(profile(pr), 7.0) * (exp(-abs(p.y) / (0.1 + 0.03 * pr)) + 0.08 * exp(-abs(p.y) / (0.5 + 0.08 * pr)));
    // The clumps glow as knots of plasma in the disk: gathered along the bent ray, so they're lensed too.
    if (abs(p.y) < 1.8) {
      for (int k = 0; k < 8; k++) {
        // A streak along its orbit (it moves towards +phi), its tail trailing behind.
        vec3 d = p - clumps[k].xyz;
        vec3 t = normalize(vec3(-clumps[k].z, 0.0, clumps[k].x) + 1e-5);
        float along = dot(d, t);
        vec3 side = d - t * along;
        float q = dot(side, side) * 130.0 + along * along * (along > 0.0 ? 70.0 : 3.0);
        knots += through * dt * clumps[k].w * (exp(-q) + 0.015 * exp(-q * 0.12));
      }
    }
    if (prev.y * p.y < 0.0) {
      vec3 c = mix(prev, p, prev.y / (prev.y - p.y));
      float cr = length(c.xz);
      if (cr > rin * 0.9 && cr < ehDisk.y) {
        if (crossings == 0) { cp[0] = c; cv[0] = v; }
        else if (crossings == 1) { cp[1] = c; cv[1] = v; }
        else if (crossings == 2) { cp[2] = c; cv[2] = v; }
        else { cp[3] = c; cv[3] = v; }
        crossings++;
        through *= 1.0 - 0.8 * profile(cr) * (1.0 - smoothstep(rin * 1.4, ehDisk.y, cr));
        if (crossings == 4) break;
      }
    }
  }
  // Footprints, taken where every pixel runs the same code.
  float fp0 = footprint(cp[0]);
  float fp1 = footprint(cp[1]);
  float fp2 = footprint(cp[2]);
  float fp3 = footprint(cp[3]);
  vec3 vd = normalize(v);
  // A pixel's angle in the sky, from how fast the escaped direction changes across the frame (lensing included).
  float px = clamp(length(dFdx(vd)) + length(dFdy(vd)), pixelAngle(), 0.05);
  // The disk's light at each crossing, front to back.
  vec3 col = vec3(0.0);
  float trans = 1.0;
  int octaves = quality < 0.5 ? 4 : 6;
  for (int k = 0; k < 4; k++) {
    if (k >= crossings) break;
    float fp = k == 0 ? fp0 : k == 1 ? fp1 : k == 2 ? fp2 : fp3;
    vec4 d = diskAt(cp[k], cv[k], octaves, fp);
    col += trans * d.rgb * d.a;
    trans *= 1.0 - d.a;
  }
  float r = length(p);
  if (!fell && r > 1.0) {
    // What bending is left past here (weak field, to infinity), then the sky.
    float rest = (1.0 / max(b, 1.0)) * (1.0 - sqrt(max(1.0 - h2 / (r * r), 0.0)));
    vec3 inward = -p - dot(-p, vd) * vd;
    vec3 dir = normalize(vd + normalize(inward + 1e-6) * rest);
    col += trans * sky(dir, px);
  }
  vec3 hot = blackbody(peakTemp() * 1.1);
  // (Dimmer over the shadow, so a knot passing in front doesn't fog it.)
  col += blackbody(peakTemp() * 2.2) * knots * 2.4 * mix(0.4, 1.0, smoothstep(B_CRIT - 0.4, B_CRIT + 0.2, b));
  // (Kept off the shadow, which stays black.)
  col += hot * haze * 0.06 * (0.8 + 0.5 * ehDisk.z) * mix(0.25, 1.0, smoothstep(B_CRIT - 0.5, B_CRIT + 0.3, b));
  // The photon ring: rays that skimmed the photon sphere, at the shadow's edge; the punch (and infalls) pulse it.
  float bw = max(0.02, 0.8 * pixelAngle() * length(camPos));
  float ring = exp(-max(b - B_CRIT, 0.0) / bw - max(B_CRIT - b, 0.0) / (bw * 0.3)) * (0.02 / bw);
  col += trans * hot * ring * (0.25 + 2.0 * ehDisk.w);
  col += trans * hot * exp(-max(b - B_CRIT, 0.0) * 4.0) * step(B_CRIT, b) * 0.015 * (1.0 + ehDisk.w);
  return col;
}
`,
  init: () => ({ time: 0, spin: 0, heat: 0.5, orbit: 0.6, tilt: 0.3, dist: 30, kick: 0, kickTarget: 0, clumps: [], rng: { seed: 0xb1ac4013 } }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    s.time += dt;
    s.heat = smoothTo(s.heat, a.level, frame.dt, 0.5);
    // The disk turns faster when it's hot.
    const turn = dt * (0.5 + 0.6 * s.heat);
    // Wrapped after a whole number of each flow's seeds (61), so neither flow's seed jumps at the wrap.
    s.spin = wrap(s.spin + turn, 0, FLOW_PERIOD * 61);
    s.orbit = wrap(s.orbit + dt * (0.07 + 0.06 * s.heat), 0, Math.PI * 2);
    // The inclination's cycle: about 22 s, edge-on to the Inclination and back (wrapped: it's a phase).
    s.tilt = wrap(s.tilt + dt * 0.285, 0, Math.PI * 2);
    // Closer when it's loud, and a slow push in and out.
    s.dist = smoothTo(s.dist, 34 - 8 * a.level + 3.5 * Math.sin(s.time * 0.31 + 0.4), frame.dt, 1.2);
    if (a.onBeat) s.kickTarget = Math.max(s.kickTarget, 0.5 + 0.5 * clamp01(frame.hit));
    s.kickTarget = smoothTo(s.kickTarget, 0, frame.dt, 0.25);
    s.kick = smoothTo(s.kick, s.kickTarget, frame.dt, 0.06);
    for (const c of s.clumps) {
      c.age += frame.dt;
      if (c.fallen >= 0) c.fallen += frame.dt;
      else {
        // Spiralling in, faster as it goes, turning at its orbit's speed.
        c.r -= frame.dt * 1.2 * Math.pow(R_OUT / c.r, 0.7) * Math.max(0.3, num(frame.values, "speed", 1));
        c.phi = wrap(c.phi + turn * kepler(c.r), -Math.PI, Math.PI * 2);
        if (c.r <= R_IN) {
          c.r = R_IN;
          c.fallen = 0;
        }
      }
    }
    s.clumps = s.clumps.filter((c) => c.fallen < 0.5);
    if (a.onBeat) {
      s.clumps.push({ r: R_IN + (R_OUT - R_IN) * (0.35 + 0.4 * random(s.rng)), phi: (random(s.rng) * 2 - 1) * Math.PI, age: 0, power: 0.6 + 0.6 * clamp01(frame.hit), fallen: -1 });
      if (s.clumps.length > CLUMPS) s.clumps.shift();
    }
  },
  uniforms(s, frame) {
    const incl = (Math.max(2, Math.min(80, num(frame.values, "inclination", 22))) * Math.PI) / 180;
    // Mostly near edge-on (the iconic view), rising to the Inclination now and then.
    const swing = smoothstep(0.15, 1, 0.5 - 0.5 * Math.cos(s.tilt));
    // A kick dips the camera a little towards the disk's plane... and in.
    const elev = (3 * Math.PI) / 180 + (incl - (3 * Math.PI) / 180) * swing + 0.012 * s.kick;
    const dist = s.dist - 1.4 * s.kick;
    const pos: Vec3 = [Math.cos(elev) * Math.cos(s.orbit) * dist, Math.sin(elev) * dist, Math.cos(elev) * Math.sin(s.orbit) * dist];
    const roll = 0.16 * Math.sin(s.time * 0.23 + 0.5) + 0.02 * s.kick;
    const flowA = s.spin % FLOW_PERIOD;
    const flowB = (s.spin + FLOW_PERIOD / 2) % FLOW_PERIOD;
    const seedA = Math.floor(s.spin / FLOW_PERIOD) % 61;
    const seedB = Math.floor((s.spin + FLOW_PERIOD / 2) / FLOW_PERIOD) % 61;
    let flare = 0;
    const clumps = Array.from({ length: CLUMPS }, (_, i) => {
      const c = s.clumps[i];
      if (!c) return vec4(`ehClump${i}`, [R_OUT * 4, 0, 0, 0]);
      const fadeIn = clamp01(c.age / 0.15);
      const deep = clamp01((R_OUT - c.r) / (R_OUT - R_IN));
      let bright = c.power * fadeIn * (0.5 + 1.8 * deep * deep);
      if (c.fallen >= 0) {
        const f = Math.exp(-c.fallen * 9);
        bright = c.power * 3 * f;
        flare += c.power * f;
      }
      const at: Vec3 = [Math.cos(c.phi) * c.r, 0, Math.sin(c.phi) * c.r];
      // One passing close to the camera would fill the frame with a blur.
      const near = smoothstep(dist * 0.55, dist * 0.8, Math.hypot(at[0] - pos[0], at[1] - pos[1], at[2] - pos[2]));
      return vec4(`ehClump${i}`, [at[0], at[1], at[2], bright * near]);
    });
    return [
      // Long, so the near side of the disk doesn't loom over the hole.
      ...cameraUniforms(pos, [0, 0, 0], roll, 25),
      ...soundUniforms(frame),
      vec4("ehFlow", [flowA, flowB, seedA, seedB]),
      vec4("ehDisk", [R_IN, R_OUT, s.heat, frame.follow.punch * 0.6 + flare]),
      ...clumps,
    ];
  },
};
