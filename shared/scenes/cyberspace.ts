/**
 * Cyberspace (docs/visualizer/scenes.md, "Five more, again"): down the data highway, at speed, inside the machine. An
 * endless square tunnel along a winding path, its walls circuit boards, all light on black (nothing else is drawn,
 * and light fades to black with distance rather than into fog), so Screen or Add lays it over a picture. The walls
 * are found by a march in the path's frame whose every step goes to where the ray would leave the section if the
 * tunnel ran straight from there (exact for a straight one, so a handful of steps do; a step that overshoots a bend
 * is bisected back), so it's cheap enough to look again: a glossy bounce off the black walls, and an inner layer
 * where holographic panels of dot-matrix glyphs hang. Each wall is laid out in districts: blocks of buses (parallel
 * traces jogging together at 45 degrees, ending on pads), chips (a package with pins, a die listening to a band of
 * its own, a hex label) and fields of vias and small parts, now and then a bus across the wall; every line is
 * anti-aliased by its footprint and fades to its mean as it shrinks below a pixel. Data pulses along the traces
 * (how many carry it is the level); packets race down twelve lanes inside the section, drawn in closed form where
 * the ray passes nearest them; the four corners are rails of LED bars running out along both walls, each corner a
 * band of the spectrum heard later the further down the tunnel it is; a core of light far ahead breathes with the
 * bass. The world repeats along the flight every `PERIOD` units (its path, boards and lanes alike) and every rate
 * turns whole times in `CLOCK` seconds, so the camera's place and the clock wrap and never run out of precision.
 * Stepped: how far it's flown (a speed on the bass), each hit's boost (faster, the lens wider, easing back), its
 * weave within the section, the tunnel's quarter-turns every eighth hit or so (Spin), and the scans each hit sends
 * racing ahead: a square of light across the section that lights the traces as it passes.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraLooking, clamp01, float, normalize, num, random, sceneDt, smoothTo, soundUniforms, sub, vec4 } from "./kit.ts";

/** The world's period along the flight (units): its path, boards and lanes all repeat in it, so the camera wraps. */
const PERIOD = 1024;
/** The clock's period (s): every rate in the GLSL turns a whole number of times in it, so it wraps without a seam. */
const CLOCK = 64;
/** Scans at once, at most, and how fast one races ahead (units a second). */
const SCANS = 4;
const SCAN_SPEED = 42;

const TAU = Math.PI * 2;
const W = TAU / PERIOD;
/** Where the tunnel runs at depth z (the GLSL's `cyPath`): slow bends, a radius of a few hundred units. */
const pathXY = (z: number): [number, number] => [
  6 * Math.sin(z * W * 3) + 2 * Math.sin(z * W * 8 + 1),
  4 * Math.sin(z * W * 2 + 2) + 1.5 * Math.sin(z * W * 7),
];
const pathAt = (z: number, dx = 0, dy = 0): Vec3 => {
  const [x, y] = pathXY(z);
  return [x + dx, y + dy, z];
};

/** The 5x7 hex digits (rows top to bottom, 5 bits each, the leftmost dot the highest bit). */
const HEX = [
  "01110 10001 10011 10101 11001 10001 01110",
  "00100 01100 00100 00100 00100 00100 01110",
  "01110 10001 00001 00010 00100 01000 11111",
  "11111 00010 00100 00010 00001 10001 01110",
  "00010 00110 01010 10010 11111 00010 00010",
  "11111 10000 11110 00001 00001 10001 01110",
  "00110 01000 10000 11110 10001 10001 01110",
  "11111 00001 00010 00100 01000 01000 01000",
  "01110 10001 10001 01110 10001 10001 01110",
  "01110 10001 10001 01111 00001 00010 01100",
  "01110 10001 10001 11111 10001 10001 10001",
  "11110 10001 10001 11110 10001 10001 11110",
  "01110 10001 10000 10000 10000 10001 01110",
  "11100 10010 10001 10001 10001 10010 11100",
  "11111 10000 10000 11110 10000 10000 11111",
  "11111 10000 10000 11110 10000 10000 10000",
].flatMap((g) => g.split(" ").map((r) => parseInt(r, 2)));

/** How far ahead the core of light is (the GLSL's `cz`). */
const CORE_AHEAD = 60;
/** The section's half-size (the GLSL's `CY_H`). */
const HALF = 1;

/** How clearly the camera sees the core down the tunnel (0: hidden behind a bend), for its bloom. */
function coreSeen(pos: Vec3): number {
  const core = pathAt(pos[2] + CORE_AHEAD);
  let seen = 1;
  for (let k = 1; k < 40; k++) {
    const f = k / 40;
    const z = pos[2] + (core[2] - pos[2]) * f;
    const [px, py] = pathXY(z);
    const x = pos[0] + (core[0] - pos[0]) * f - px;
    const y = pos[1] + (core[1] - pos[1]) * f - py;
    seen = Math.min(seen, clamp01((HALF - Math.max(Math.abs(x), Math.abs(y))) / 0.2));
  }
  return seen;
}

interface Scan {
  z: number;
  age: number;
  power: number;
}

interface CyberState {
  /** The scene's clock, wrapped every `CLOCK`. */
  clock: number;
  /** How far down the tunnel (wrapped into the world's period), and how fast. */
  z: number;
  speed: number;
  /** A hit's boost (speed and a wider lens), easing back. */
  boost: number;
  /** The tunnel's spin: where it's turning to (quarter-turns), where it is, how fast; hits since the last. */
  spinTo: number;
  roll: number;
  rollV: number;
  sinceSpin: number;
  /** The weave within the section: where, how fast, where to. */
  x: number;
  vx: number;
  tx: number;
  y: number;
  vy: number;
  ty: number;
  /** The level, followed (how many traces carry data), the hit's flash, the bass's core. */
  glow: number;
  flash: number;
  core: number;
  high: number;
  /** How clearly the core is seen, followed. */
  seen: number;
  scans: Scan[];
  rng: { seed: number };
}

/** A critically damped spring towards `target` (rate `w`, per second), stepped in small steps. */
function spring(pos: number, vel: number, target: number, w: number, dt: number): [number, number] {
  const n = Math.max(1, Math.ceil(dt / 0.01));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    vel += (w * w * (target - pos) - 2 * w * vel) * h;
    pos += vel * h;
  }
  return [pos, vel];
}

export const CYBERSPACE: SceneSpec<CyberState> = {
  type: "cyberspace",
  label: "Cyberspace",
  params: [
    {
      kind: "choice",
      key: "style",
      label: "Style",
      default: "tron",
      options: [
        { value: "tron", label: "Tron" },
        { value: "matrix", label: "Matrix" },
        { value: "synthwave", label: "Synthwave" },
        { value: "redalert", label: "Red Alert" },
      ],
    },
    { kind: "number", key: "glyphs", label: "Glyphs", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "spin", label: "Spin", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  audio: () => ({ rows: 40, span: 2.4, fall: 0.2, window: 0 }),
  glsl: /* glsl */ `
uniform float cyClock;
uniform float cyGlow;
uniform float cyFlash;
uniform float cyCore;
uniform float cyHigh;
uniform float cyCoreSeen;
uniform vec4 cyScan0;
uniform vec4 cyScan1;
uniform vec4 cyScan2;
uniform vec4 cyScan3;

const float CY_PERIOD = ${PERIOD.toFixed(1)};
const float CY_CLOCK = ${CLOCK.toFixed(1)};
const float CY_TAU = 6.28318531;
// The section's half-size; the lanes across a wall; a district's length along it (its layout of blocks), a jog's.
const float CY_H = ${HALF.toFixed(1)};
const float CY_LANES = 40.0;
const float CY_S = 2.0 * CY_H / CY_LANES;
const float CY_EDGE = 6.0;
const float CY_DIST = 8.0;
const float CY_JOG = 2.0;
// The glyph panels hang this far off the walls.
const float CY_INSET = 0.1;
const int CY_HEX[112] = int[112](${HEX.join(", ")});

vec2 cyPath(float z) {
  float w = CY_TAU / CY_PERIOD;
  return vec2(6.0 * sin(z * w * 3.0) + 2.0 * sin(z * w * 8.0 + 1.0), 4.0 * sin(z * w * 2.0 + 2.0) + 1.5 * sin(z * w * 7.0));
}
vec2 cyPathD(float z) {
  float w = CY_TAU / CY_PERIOD;
  return w * vec2(18.0 * cos(z * w * 3.0) + 16.0 * cos(z * w * 8.0 + 1.0), 8.0 * cos(z * w * 2.0 + 2.0) + 10.5 * cos(z * w * 7.0));
}

// ---- The palette ---------------------------------------------------------------------------------------------
vec3 cyTraceCol() {
  if (style == 1) return vec3(0.12, 1.0, 0.3);
  if (style == 2) return vec3(1.0, 0.1, 0.55);
  if (style == 3) return vec3(1.0, 0.06, 0.04);
  return vec3(0.05, 0.7, 1.0);
}
vec3 cyAccent() {
  if (style == 1) return vec3(0.75, 1.0, 0.6);
  if (style == 2) return vec3(0.1, 0.85, 1.0);
  if (style == 3) return vec3(1.0, 0.95, 0.92);
  return vec3(1.0, 0.42, 0.06);
}
vec3 cyRailCol() {
  if (style == 1) return vec3(0.3, 1.0, 0.45);
  if (style == 2) return vec3(0.55, 0.25, 1.0);
  if (style == 3) return vec3(1.0, 0.85, 0.82);
  return vec3(0.45, 0.9, 1.0);
}
vec3 cyGlyphCol() {
  if (style == 1) return vec3(0.25, 1.0, 0.4);
  if (style == 2) return vec3(0.2, 0.9, 1.0);
  if (style == 3) return vec3(1.0, 0.2, 0.12);
  return vec3(0.35, 0.85, 1.0);
}
vec3 cyCoreCol() {
  if (style == 1) return vec3(0.6, 1.0, 0.7);
  if (style == 2) return vec3(1.0, 0.45, 0.35);
  if (style == 3) return vec3(1.0, 0.35, 0.25);
  return vec3(0.75, 0.92, 1.0);
}

// Light fades to black with distance (no fog: nothing lifts the blacks).
float cyFade(float t) { return exp(-t / 15.0); }

// ---- The march: the square section's walls in the path's frame ----------------------------------------------------
// From t0, the first t where the ray leaves the box |q| < h (q: across the section at the ray's depth). Each step goes
// to where the ray would leave if the tunnel ran straight from here (exact for a straight one, so a few steps do), and
// a step that overshoots a bend is bisected back.
float cyTrace(vec3 ro, vec3 rd, float h, float t0) {
  float t = t0;
  float prev = t0;
  bool out_ = false;
  int steps = int(mix(10.0, 20.0, quality));
  for (int i = 0; i < 20; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    vec2 q = p.xy - cyPath(p.z);
    if (max(abs(q.x), abs(q.y)) > h) { out_ = true; break; }
    vec2 dq = rd.xy - cyPathD(p.z) * rd.z;
    dq = sign(dq) * max(abs(dq), vec2(1e-5));
    vec2 lim = (sign(dq) * h - q) / dq;
    float step_ = min(min(lim.x, lim.y), 8.0);
    prev = t;
    t += step_ + 1e-4;
    if (step_ < 2e-4 * t) break;
  }
  if (out_) {
    float a = prev;
    float b = t;
    for (int i = 0; i < 8; i++) {
      float m = 0.5 * (a + b);
      vec3 p = ro + rd * m;
      vec2 q = p.xy - cyPath(p.z);
      if (max(abs(q.x), abs(q.y)) > h) b = m; else a = m;
    }
    t = 0.5 * (a + b);
  }
  return t;
}

// A point of a wall: which (0 right, 1 top, 2 left, 3 bottom) and where across it (u, -H..H, counter-clockwise).
vec2 cyWallOf(vec2 q) {
  if (abs(q.x) > abs(q.y)) return q.x > 0.0 ? vec2(0.0, q.y) : vec2(2.0, -q.y);
  return q.y > 0.0 ? vec2(1.0, -q.x) : vec2(3.0, q.x);
}
// The wall's normal (into the tunnel) at depth z: the path's slope tilts it.
vec3 cyNormal(float wall, float z) {
  vec2 d = cyPathD(z);
  if (wall < 0.5) return normalize(vec3(-1.0, 0.0, d.x));
  if (wall < 1.5) return normalize(vec3(0.0, -1.0, d.y));
  if (wall < 2.5) return normalize(vec3(1.0, 0.0, -d.x));
  return normalize(vec3(0.0, 1.0, -d.y));
}

// ---- Glyphs --------------------------------------------------------------------------------------------------------
uint cyHashU(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
// Whether dot (x 0..4, y 0..6 from the top) of glyph g is lit: hex digits, or made-up katakana of three strokes.
bool cyGlyphDot(uint g, int x, int y) {
  if ((g & 3u) == 0u) {
    int row = CY_HEX[int((g >> 2) & 15u) * 7 + y];
    return ((row >> (4 - x)) & 1) == 1;
  }
  uint h = cyHashU(g);
  for (int i = 0; i < 3; i++) {
    int k = int((h >> (i * 4)) & 15u);
    bool on = k == 0 ? y == 0 : k == 1 ? y == 3 : k == 2 ? y == 6 : k == 3 ? x == 0 : k == 4 ? x == 4 : k == 5 ? x == 2
      : k == 6 ? x == 4 - (y * 4 + 3) / 6 : k == 7 ? x == (y * 4 + 3) / 6 : k == 8 ? (x == 4 && y <= 3)
      : k == 9 ? (y == 3 && x <= 2) : k == 10 ? (x == 2 && y >= 3) : k == 11 ? (x == 2 && y <= 3)
      : k == 12 ? (y == 1 && x >= 1 && x <= 3) : k == 13 ? (y >= 3 && x == 2 - (y - 3) * 2 / 3) : k == 14 ? (x == 0 && y >= 3)
      : (y == 5 && x >= 1);
    if (on) return true;
  }
  return false;
}
// A glyph's light at gp (dots: x 0..6 across a cell, y 0..8; the glyph in 5x7 of it, a dot a round LED).
float cyGlyph(uint g, vec2 gp, float fwDots) {
  vec2 c = floor(gp);
  if (c.x < 0.0 || c.x > 4.0 || c.y < 0.0 || c.y > 6.0) return 0.0;
  float mean = 0.3;
  if (fwDots > 1.2) return mean * 0.6;
  bool on = cyGlyphDot(g, int(c.x), int(c.y));
  float d = length(fract(gp) - 0.5);
  float dotL = clamp((0.38 - d) / max(fwDots, 1e-3) + 0.5, 0.0, 1.0);
  return mix(on ? dotL : 0.0, mean * 0.6, smoothstep(0.5, 1.2, fwDots));
}

// ---- Drawing -----------------------------------------------------------------------------------------------------
// A line of half-width w at distance d, anti-aliased over the footprint fw.
float cyLine(float d, float w, float fw) { return clamp((w - d) / max(fw, 1e-5) + 0.5, 0.0, 1.0) * min(1.0, 2.0 * w / max(fw, 1e-5)); }
// A ring of radius r and half-width w.
float cyRing(float d, float r, float w, float fw) { return cyLine(abs(d - r), w, fw); }

// The light the scans shed on the boards at depth v: a bright front and the traces lit behind it.
float cyScanAt(vec4 s, float v) {
  if (s.z <= 0.0) return 0.0;
  float d = v - s.x;
  float fade = exp(-s.y / 0.7);
  float front = exp(-d * d * 30.0) * 2.5;
  float trail = d < 0.0 ? exp(d / 1.2) * 0.5 * exp(-s.y / 0.25) : 0.0;
  return s.z * fade * (front + trail);
}
float cyScanLight(float v) { return cyScanAt(cyScan0, v) + cyScanAt(cyScan1, v) + cyScanAt(cyScan2, v) + cyScanAt(cyScan3, v); }

// Pulses of data along a trace at v: a bright head and a tail behind it, running one way or the other.
float cyPulse(float v, float h, float fwv) {
  float dir = h < 0.5 ? 1.0 : -1.0;
  float lambda = fract(h * 3.7) < 0.5 ? 4.0 : 8.0;
  float rate = (128.0 + floor(fract(h * 17.3) * 256.0)) / CY_CLOCK;
  float ph = fract(dir * v / lambda - cyClock * rate + h * 7.0);
  float tail = 0.25 + 0.3 * fract(h * 9.1);
  float b = exp(-(1.0 - ph) * lambda / tail);
  return mix(b, tail / lambda, smoothstep(0.2 * tail, 1.5 * tail, fwv));
}

// The board's light at (u across, v along) on wall w; fw is the footprint (u, v); lit is the scans' light there.
vec3 cyBoard(float wall, vec2 p, vec2 fw, float lit) {
  float s = CY_S;
  float dist = floor(p.y / CY_DIST);
  float dm = mod(dist, CY_PERIOD / CY_DIST);
  float lv = p.y - dist * CY_DIST;
  float lane = (p.x + CY_H) / s;
  // Some districts start with a bus across the wall, its data running round the tunnel: rungs that rush past.
  vec3 xcol = vec3(0.0);
  float hx = hash13(vec3(dm, wall, 41.0));
  if (hx < 0.7 && lv < 0.4 && lane > 3.0 && lane < CY_LANES - 3.0) {
    float li = floor(lv / 0.065);
    float dv = abs(lv - (li + 0.5) * 0.065);
    float ends = clamp((lane - 3.0) * s / max(fw.x, 1e-4), 0.0, 1.0) * clamp((CY_LANES - 3.0 - lane) * s / max(fw.x, 1e-4), 0.0, 1.0);
    float line = cyLine(dv, 0.005, fw.y) * ends * step(fract(hx * 7.0 + li * 0.31), 0.8);
    float pulse = cyPulse(p.x * 3.0, fract(hx * 13.0 + li * 0.17), fw.x * 3.0);
    vec3 tc = cyTraceCol();
    xcol = tc * line * (0.05 + 0.15 * cyFlash + lit) + mix(tc, vec3(1.0), 0.4) * line * pulse * step(fract(hx * 3.0 + li * 0.43), 0.15 + 0.6 * cyGlow) * 3.0;
  }
  // The district's blocks across the wall, from lane 6 to 34 (the corners are the rails').
  if (lane < CY_EDGE || lane >= CY_LANES - CY_EDGE) return xcol;
  float a = CY_EDGE;
  float b = CY_LANES - CY_EDGE;
  float start = CY_EDGE;
  for (int i = 0; i < 5; i++) {
    float end = min(start + 5.0 + floor(hash13(vec3(dm, wall, 7.0 + float(i))) * 6.0), CY_LANES - CY_EDGE);
    if (CY_LANES - CY_EDGE - end < 5.0) end = CY_LANES - CY_EDGE;
    if (lane < end) { a = start; b = end; break; }
    start = end;
  }
  float hb = hash13(vec3(dm, wall, a));
  float kind = hb < 0.6 ? 0.0 : hb < 0.8 ? 1.0 : 2.0;
  vec3 tc = cyTraceCol();
  vec3 ac = cyAccent();
  float traceW = 0.16 * s;
  float data = 0.0;
  float copper = 0.0;
  float accent = 0.0;
  // How fine the lanes are on screen: as they shrink below a pixel, they fade to their mean.
  float fine = smoothstep(0.25 * s, 0.9 * s, fw.x);

  if (kind < 0.5) {
    // A bus: parallel traces that jog together at 45 degrees, a lane or two at a time.
    float m = b - a >= 8.0 ? 2.0 : 1.0;
    float j = floor(lv / CY_JOG);
    float o0 = j < 0.5 ? 0.0 : floor(hash13(vec3(dm * 4.0 + j, wall, a + 0.5)) * (2.0 * m + 1.0)) - m;
    float o1 = j > 2.5 ? o0 : floor(hash13(vec3(dm * 4.0 + j + 1.0, wall, a + 0.5)) * (2.0 * m + 1.0)) - m;
    float dO = o1 - o0;
    float rampStart = (j + 1.0) * CY_JOG - abs(dO) * s;
    float ramp = abs(dO) > 0.0 ? clamp((lv - rampStart) / (abs(dO) * s), 0.0, 1.0) : 0.0;
    float off = o0 + dO * ramp;
    float slope = (ramp > 0.0 && ramp < 1.0) ? 0.7071 : 1.0;
    float uc = lane - off;
    float k = floor(uc);
    float hk = hash13(vec3(dm, wall, k + 0.25));
    bool inBus = k >= a + m && k < b - m && hk < 0.9;
    // Some traces start or end within the district, on a pad.
    float hs = fract(hk * 13.7);
    float vs = hs < 0.55 ? 0.5 : floor(fract(hk * 7.1) * 3.0) * CY_JOG + 0.5;
    float ve = hs > 0.45 ? CY_DIST - 0.25 : min(CY_DIST - 0.25, vs + (1.0 + floor(fract(hk * 3.3) * 3.0)) * CY_JOG - 0.5);
    if (inBus) {
      float hw = fract(hk * 57.3);
      float tw = s * (hw < 0.15 ? 0.3 : hw < 0.5 ? 0.2 : 0.12);
      float d = abs(fract(uc) - 0.5) * s * slope;
      float along = clamp((lv - vs) / max(fw.y, 1e-4) + 0.5, 0.0, 1.0) * clamp((ve - lv) / max(fw.y, 1e-4) + 0.5, 0.0, 1.0);
      float line = cyLine(d, tw, fw.x) * along;
      // Pads at the ends.
      float ps = length(vec2((fract(uc) - 0.5) * s, lv - vs));
      float pe = length(vec2((fract(uc) - 0.5) * s, lv - ve));
      float pad = max(cyRing(ps, 0.3 * s, 0.1 * s, fw.x), cyRing(pe, 0.3 * s, 0.1 * s, fw.x));
      copper = max(line, pad);
      float hp = fract(hk * 31.7);
      float carries = step(hp, 0.15 + 0.6 * cyGlow);
      // The data's light glows a little round its trace.
      float glowL = mix(exp(-d * d / (0.04 * s * s)) * 0.3, 0.1, fine) * along;
      data = (line + glowL) * carries * cyPulse(p.y, fract(hk * 5.3 + wall * 0.37), fw.y) * (tw > 0.25 * s ? 1.4 : 1.0) + pad * carries * 0.3;
    }
  } else if (kind < 1.5) {
    // A chip: a dark package, pins along its ends, traces leading off them.
    float hc = hash13(vec3(dm, wall, a + 0.75));
    float len = 0.7 + hc * 1.1;
    float v0 = CY_DIST * 0.5 - len * 0.5 + (fract(hc * 9.1) - 0.5) * 1.5;
    float v1 = v0 + len;
    float u0 = a + 1.0;
    float u1 = b - 1.0;
    // Distance to the package's edge (in units), negative inside.
    vec2 cen = vec2((u0 + u1) * 0.5 * s, (v0 + v1) * 0.5);
    vec2 hsz = vec2((u1 - u0) * 0.5 * s, len * 0.5);
    vec2 dd = abs(vec2(lane * s, lv) - cen) - hsz;
    float edge = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0);
    float k = floor(lane);
    float uIn = (fract(lane) - 0.5) * s;
    if (edge < 0.0) {
      // The package: black, its outline lit, a die's outline inside, pin one's dot.
      float outline = cyLine(abs(edge + 0.02), 0.008, max(fw.x, fw.y));
      float die = cyLine(abs(edge + min(hsz.x, hsz.y) * 0.45), 0.004, max(fw.x, fw.y));
      vec2 pin1 = cen - hsz + 0.09;
      float dot1 = cyLine(length(vec2(lane * s, lv) - pin1), 0.02, max(fw.x, fw.y));
      accent = outline * 0.8 + die * 0.25 + dot1 * 0.6;
      // Its die listens to a band of its own: a grid of cells lit to its level, glowing through the package.
      float inDie = smoothstep(0.0, -2.0 * max(fw.x, fw.y), edge + min(hsz.x, hsz.y) * 0.45);
      float lvl = spectrum(0.05 + 0.8 * fract(hc * 23.1));
      vec2 dg = abs(fract((vec2(lane * s, lv) - cen) / 0.035) - 0.5);
      float cells = mix(smoothstep(0.32, 0.2, max(dg.x, dg.y)), 0.5, smoothstep(0.005, 0.02, max(fw.x, fw.y)));
      accent += inDie * (0.02 + 0.3 * lvl * lvl * cells);
      // A label: a code in small dots by pin one.
      vec2 lp = vec2(lv - (cen.y - hsz.y + 0.17), (cen.x + hsz.x - 0.05) - lane * s) / 0.011;
      float ci = floor(lp.x / 6.5);
      if (ci >= 0.0 && ci < 6.0 && lp.y > 0.0) {
        uint g = (uint(ci) * 7u + uint(hc * 4096.0)) * 4u;
        accent += 0.7 * cyGlyph(g, vec2(lp.x - ci * 6.5, lp.y), max(fw.x, fw.y) / 0.011);
      }
    } else if (k >= u0 && k < u1) {
      // Pins, then traces from them to the district's ends.
      float pinLen = 0.12;
      bool before = lv < v0;
      float vEdge = before ? v0 : v1;
      float dv = abs(lv - vEdge);
      float pin = cyLine(abs(uIn), 0.22 * s, fw.x) * clamp((pinLen - dv) / max(fw.y, 1e-4) + 0.5, 0.0, 1.0);
      float hk = hash13(vec3(dm, wall, k + (before ? 0.4 : 0.6)));
      float vEnd = before ? 0.5 + fract(hk * 3.1) * max(v0 - 1.2, 0.0) : v1 + 0.75 + fract(hk * 3.1) * max(CY_DIST - v1 - 1.0, 0.0);
      float lo = before ? vEnd : vEdge;
      float hi = before ? vEdge : vEnd;
      float along = clamp((lv - lo) / max(fw.y, 1e-4) + 0.5, 0.0, 1.0) * clamp((hi - lv) / max(fw.y, 1e-4) + 0.5, 0.0, 1.0);
      float present = step(hk, 0.8);
      float line = cyLine(abs(uIn), traceW, fw.x) * along * present;
      float pad = cyRing(length(vec2(uIn, lv - vEnd)), 0.3 * s, 0.1 * s, fw.x) * present;
      copper = max(line, pad);
      accent = pin * 0.6;
      float carries = step(fract(hk * 31.7), 0.25 + 0.75 * cyGlow);
      data = line * carries * cyPulse(p.y, fract(hk * 5.3 + wall * 0.37), fw.y);
    }
  } else {
    // Vias and small parts scattered on a grid (some of the parts LEDs, lit to the music).
    vec2 g = vec2(lane, lv / s) * 0.5;
    vec2 cell = floor(g);
    vec2 f = (fract(g) - 0.5) * 2.0 * s;
    float hv = hash13(vec3(cell + vec2(dm * 97.0, 0.0), wall + 3.0));
    bool inside = cell.x * 2.0 >= a + 1.0 && cell.x * 2.0 < b - 2.0 && lv > 0.55;
    if (inside && hv < 0.3) {
      float r = length(f);
      copper = cyRing(r, 0.35 * s, 0.11 * s, fw.x);
      data = copper * step(fract(hv * 41.0), 0.3 * cyGlow) * 0.6;
    } else if (inside && hv < 0.55) {
      // A small part: two pads and a dark body between, along or across.
      vec2 e = fract(hv * 13.0) < 0.5 ? f : f.yx;
      vec2 pd = abs(vec2(abs(e.x) - 0.45 * s, e.y)) - vec2(0.18 * s, 0.25 * s);
      float pads = clamp(-max(pd.x, pd.y) / max(fw.x, 1e-4) + 0.5, 0.0, 1.0);
      vec2 bd = abs(e) - vec2(0.3 * s, 0.2 * s);
      float body = cyLine(abs(max(bd.x, bd.y)), 0.02 * s, fw.x);
      copper = max(pads * 0.8, body * 0.5);
      // LEDs among them, lit to the music.
      if (fract(hv * 29.0) < 0.3) accent = pads * spectrum(fract(hv * 7.7)) * 1.5;
    }
  }
  float far = mix(1.0, 0.25, fine);
  vec3 col = tc * copper * (0.035 + 0.15 * cyFlash + 0.9 * lit) * far;
  // Data runs white-hot at its heads.
  col += mix(tc, vec3(1.0), clamp(0.2 + 0.5 * data, 0.0, 0.75)) * data * (3.2 + lit) * far;
  col += ac * accent * (0.5 + 1.5 * lit + 0.8 * cyFlash);
  return col + xcol;
}

// The holographic panels hanging off the walls (at the inner layer), and in Matrix the rain on it: their light at
// (u across, v along), footprint fw.
vec3 cyPanels(float wall, vec2 p, vec2 fw) {
  vec3 gc = cyGlyphCol();
  vec3 col = vec3(0.0);
  float dotSize = 0.022;
  float fwDots = max(fw.x, fw.y) / dotSize;
  if (style == 1) {
    // Rain: columns of glyphs streaming down the tunnel towards the camera, a bright head and a fading trail.
    float colW = dotSize * 6.0;
    float ci = floor((p.x + CY_H) / colW);
    float hc = hash13(vec3(ci, wall, 5.0));
    float rate = (256.0 + floor(hc * 512.0)) / CY_CLOCK;
    float glyphL = dotSize * 8.0;
    float gy = p.y / glyphL;
    float gi = floor(gy);
    float stream = 9.0 + floor(fract(hc * 7.0) * 12.0);
    float ph = fract((gi + rate * cyClock * 4.0) / stream + hc * 3.0);
    float head = ph;
    float bright = exp(-head * 6.0) * step(0.0, glyphs - fract(hc * 11.0) * 1.2);
    if (bright > 0.003) {
      uint g = uint(mod(gi, 4096.0)) * 131u + uint(ci) * 7919u + uint(wall) * 31u + uint(floor(cyClock * (2.0 + 6.0 * fract(hc * 5.0)))) * (ph < 0.08 ? 1u : 0u);
      vec2 gp = vec2(fract((p.x + CY_H) / colW) * 6.0 - 0.5, 8.0 - fract(gy) * 8.0 - 0.5);
      float l = cyGlyph(g * 4u + 1u + uint(fract(hc * 3.0) * 2.0), gp, fwDots);
      col += mix(gc, vec3(0.85, 1.0, 0.9), smoothstep(0.1, 0.0, head)) * l * bright * (1.2 + 1.5 * cyHigh);
    }
  }
  // Panels: one in some stretches of each wall, with lines of text.
  float pc = floor((p.y + 4.0) / CY_DIST);
  float pm = mod(pc, CY_PERIOD / CY_DIST);
  vec3 hp = hash33(vec3(pm, wall, 19.0));
  if (hp.x < 0.45 * glyphs) {
    float h = 0.35 + 0.45 * hp.y;
    float uc = (fract(hp.z * 7.0) - 0.5) * (2.0 * CY_H - h - 0.5);
    float len = 1.6 + 2.6 * fract(hp.y * 5.3);
    float v0 = pc * CY_DIST - 4.0 + 1.0 + fract(hp.z * 3.1) * (CY_DIST - 2.0 - len);
    vec2 cen = vec2(uc, v0 + len * 0.5);
    vec2 hsz = vec2(h * 0.5, len * 0.5);
    vec2 dd = abs(p - cen) - hsz;
    float edge = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0);
    float fwe = max(fw.x, fw.y);
    if (edge < 0.04) {
      // Flicker: the highs glitch it.
      float tick = floor(cyClock * 18.0);
      float fl = hash12(vec2(tick, pm + wall * 13.0));
      float on = 0.75 + 0.25 * fl - step(fl, 0.08 * cyHigh) * 0.6;
      // Frame: a thin outline and brighter corner brackets.
      float frame = cyLine(abs(edge), 0.004, fwe);
      vec2 rel = abs(p - cen) - hsz + 0.12;
      float bracket = cyLine(abs(edge), 0.012, fwe) * step(0.0, min(rel.x, rel.y));
      col += gc * (frame * 0.5 + bracket * 1.2) * on;
      if (edge < 0.0) {
        // A faint fill with scanlines.
        float scan = 0.5 + 0.5 * sin((p.y - cyClock * 0.5) * 140.0);
        col += gc * 0.012 * mix(1.0, scan, 1.0 - smoothstep(0.004, 0.02, fw.y)) * on;
        // Text: lines along the panel, glyphs reading along v (their up across the wall).
        vec2 lp = vec2(p.y - (cen.y - hsz.y) - 0.04, (cen.x + hsz.x) - p.x - 0.04) / dotSize;
        float line = floor(lp.y / 9.0);
        float colI = floor(lp.x / 6.5);
        float hl = hash13(vec3(pm, wall, line));
        float lineLen = (hsz.y * 2.0 - 0.08) / dotSize / 6.5 * (0.4 + 0.6 * hl);
        if (lp.y > 0.0 && lp.y < (hsz.x * 2.0 - 0.08) / dotSize - 7.0 && colI < lineLen) {
          // Each line types out and changes now and then.
          float ver = floor(cyClock * (0.5 + hl * 2.0) + hl * 9.0);
          uint g = uint(colI) * 2654u + uint(line) * 977u + uint(pm) * 31u + uint(wall) * 7u + uint(mod(ver, 4096.0)) * 4099u;
          vec2 gp = vec2(lp.x - colI * 6.5, lp.y - line * 9.0);
          // Glyph x along v, y across (top of the glyph at the panel's top edge).
          float l = cyGlyph(g, vec2(gp.x, gp.y), fwDots);
          float hot = 1.0 - smoothstep(0.0, 2.0, abs(colI - fract(cyClock * 0.7 + hl) * lineLen));
          col += mix(gc, vec3(1.0), 0.3 * hot) * l * (0.9 + 1.2 * hot) * on * (0.8 + 0.8 * cyHigh);
        }
      }
    }
  }
  return col;
}

// ---- Rails -------------------------------------------------------------------------------------------------------
// The corners' rails: a line of light at each, and an equaliser of LED bars running from it along both walls (each
// rail a band, the bars heard later the further down the tunnel they are).
vec3 cyRails(float wall, vec2 p, vec2 fw, float lit) {
  float cu = CY_H - abs(p.x);
  float corner = p.x > 0.0 ? wall : mod(wall + 3.0, 4.0);
  float band = corner < 0.5 ? 0.62 : corner < 1.5 ? 0.38 : corner < 2.5 ? 0.06 : 0.2;
  vec3 rc = cyRailCol();
  vec3 col = rc * (cyLine(cu, 0.006, fw.x) + 0.12 * exp(-cu / 0.015) + 0.03 * exp(-cu / 0.08)) * (1.2 + 0.8 * cyGlow + lit + cyFlash);
  // The bars: a slice every 0.25 along v.
  float sl = 0.25;
  float k = floor(p.y / sl);
  float fv = p.y - (k + 0.5) * sl;
  float ago = max(p.y - camPos.z, 0.0) / 14.0;
  float lvl = smoothstep(0.25, 0.95, spectrumAgo(band, ago));
  float block = 0.04;
  float len = block + 0.24 * pow(lvl, 1.4);
  float bi = floor(cu / block);
  float fb = cu - (bi + 0.5) * block;
  float fwm = max(fw.x, fw.y);
  float bar = cyLine(abs(fv), 0.04, fw.y) * cyLine(abs(fb), 0.013, fw.x) * step(bi * block + 0.5 * block, len);
  float peak = step(len - block, bi * block + 0.5 * block);
  // Too fine to see the blocks: their mean.
  float fine = smoothstep(0.015, 0.06, fwm);
  float mean = 0.32 * 0.65 * smoothstep(0.0, 0.01, len - cu);
  bar = mix(bar, mean, fine);
  col += mix(rc, cyAccent(), peak) * bar * (0.5 + 0.9 * peak) * (1.0 + lit);
  return col;
}

// ---- Packets -----------------------------------------------------------------------------------------------------
// The packets' light along the ray (to tmax): bars racing along twelve lanes inside the section.
vec3 cyPackets(vec3 ro, vec3 rd, float tmax) {
  vec3 col = vec3(0.0);
  float px = 2.0 * camLens / min(resolution.x, resolution.y);
  float rz = max(rd.z, 0.05);
  // Fewer lanes for a fast preview.
  int lanes = int(mix(6.0, 12.0, quality) + 0.5);
  for (int l = 0; l < 12; l++) {
    if (l >= lanes) break;
    float fl = float(l);
    float side = floor(fl / 3.0);
    float across = (mod(fl, 3.0) - 1.0) * 0.55;
    vec2 lane = vec2(0.78, across);
    lane = side < 0.5 ? lane : side < 1.5 ? vec2(-lane.y, lane.x) : side < 2.5 ? -lane : vec2(lane.y, -lane.x);
    float hl = hash12(vec2(fl, 3.3));
    // Lanes run at their own speeds (whole turns of their spacing in the clock), some towards the camera.
    float n = floor(hl * 200.0) - 70.0;
    n += n > -10.0 && n < 10.0 ? 30.0 : 0.0;
    float speed = n / CY_CLOCK * 8.0;
    // Where the ray runs nearest the lane (in the tunnel's frame, from where it starts).
    float t = 0.0;
    for (int i = 0; i < 3; i++) {
      float z = ro.z + rd.z * t;
      vec2 Q = ro.xy + rd.xy * t - cyPath(z) - lane;
      vec2 V = rd.xy - cyPathD(z) * rd.z;
      t = clamp(t - dot(Q, V) / max(dot(V, V), 1e-6), 0.0, tmax);
    }
    float zs = ro.z + rd.z * t;
    float zl = zs - speed * cyClock;
    float cell = floor(zl / 8.0);
    for (int c = -1; c <= 1; c++) {
      float ci = cell + float(c);
      float cm = mod(ci, CY_PERIOD / 8.0);
      vec3 h = hash33(vec3(cm, fl, 1.7));
      if (h.x > 0.6) continue;
      float plen = 0.6 + 2.4 * h.y * h.y;
      float z0 = ci * 8.0 + h.z * (8.0 - plen) + speed * cyClock;
      float z1 = z0 + plen;
      float zc = clamp(zs, z0, z1);
      float tc = (zc - ro.z) / rz;
      if (tc < 0.05 || tc > tmax) continue;
      vec2 Q = ro.xy + rd.xy * tc - cyPath(zc) - lane;
      float d2 = dot(Q, Q);
      // Its width, never thinner than a pixel (then dimmer, as much light spread wider).
      float w0 = 0.01;
      float w = max(w0, px * tc);
      // The head (the end it runs towards) bright, the bar fading behind.
      float along = (zc - z0) / plen;
      along = speed > 0.0 ? along : 1.0 - along;
      float core = exp(-d2 / (w * w)) * (w0 / w) * (0.3 + 0.7 * along * along);
      float hr = w0 * 4.0 + w;
      float halo = 0.15 * exp(-d2 / (hr * hr)) * (w0 / w) * (0.3 + 0.7 * along);
      vec3 pc = h.y > 0.6 ? cyAccent() : cyTraceCol();
      col += (mix(pc, vec3(1.0), 0.6 * core) * core * 3.0 + pc * halo * 2.0) * cyFade(tc);
    }
  }
  return col;
}

// ---- Scans -------------------------------------------------------------------------------------------------------
// A scan's frame: a square of light across the section at its depth, as the ray crosses it.
vec3 cyFrame(vec3 ro, vec3 rd, float tmax, vec4 s) {
  if (s.z <= 0.0) return vec3(0.0);
  float t = (s.x - ro.z) / max(rd.z, 0.05);
  if (t <= 0.05 || t > tmax + 0.02) return vec3(0.0);
  vec2 q = ro.xy + rd.xy * t - cyPath(s.x);
  float d = max(CY_H - max(abs(q.x), abs(q.y)), 0.0);
  float fade = exp(-s.y / 0.7) * smoothstep(1.5, 5.0, t);
  float px = 2.0 * camLens / min(resolution.x, resolution.y) * t;
  float w = 0.005 + px * 1.2;
  float x = d / w;
  float line = exp(-x * x) + 0.25 * exp(-x * x / 10.0);
  return mix(cyAccent(), vec3(1.0), 0.4 * exp(-d / w)) * s.z * fade * line * 2.5 * cyFade(t * 0.7);
}

// What a wall gives at a point: its boards, rails, the scans' light; fw its footprint.
vec3 cyWallLight(vec3 hp, vec2 fw) {
  vec2 q = hp.xy - cyPath(hp.z);
  vec2 wu = cyWallOf(q);
  vec2 p = vec2(wu.y, hp.z);
  float lit = cyScanLight(hp.z);
  return cyBoard(wu.x, p, fw, lit) + cyRails(wu.x, p, fw, lit);
}

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  float tIn = cyTrace(ro, rd, CY_H - CY_INSET, 0.0);
  float tW = cyTrace(ro, rd, CY_H, tIn);
  vec3 hp = ro + rd * tW;
  vec2 q = hp.xy - cyPath(hp.z);
  vec2 wu = cyWallOf(q);
  vec2 p = vec2(wu.y, hp.z);
  // The footprint: across from the distance to the corner (continuous over them), along from the depth.
  vec2 fw = vec2(fwidth(CY_H - abs(wu.y)), fwidth(hp.z));
  fw = min(fw, vec2(1.0, 4.0));
  float fade = cyFade(tW);
  float lit = cyScanLight(hp.z);
  vec3 col = (cyBoard(wu.x, p, fw, lit) + cyRails(wu.x, p, fw, lit)) * fade;

  // The glossy black walls: a little of what's opposite, one bounce.
  vec3 n = cyNormal(wu.x, hp.z);
  vec3 rr = reflect(rd, n);
  float tR = cyTrace(hp + n * 1e-3, rr, CY_H, 0.0);
  vec3 rp = hp + n * 1e-3 + rr * tR;
  vec2 rq = rp.xy - cyPath(rp.z);
  vec2 rwu = cyWallOf(rq);
  vec2 rfw = vec2(fwidth(CY_H - abs(rwu.y)), fwidth(rp.z)) * 2.0 + 0.01;
  rfw = min(rfw, vec2(1.0, 4.0));
  float fres = 0.03 + 0.25 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
  vec3 ro2 = hp + n * 1e-3;
  vec3 refl = cyWallLight(rp, rfw) * cyFade(tR);
  refl += cyPackets(ro2, rr, tR);
  col += refl * fres * cyFade(tW);

  // The panels hanging off the walls (light: they add).
  vec3 ip = ro + rd * tIn;
  vec2 iq = ip.xy - cyPath(ip.z);
  vec2 iwu = cyWallOf(iq);
  vec2 ifw = vec2(fwidth(CY_H - abs(iwu.y)), fwidth(ip.z));
  ifw = min(ifw, vec2(1.0, 4.0));
  col += cyPanels(iwu.x, vec2(iwu.y, ip.z), ifw) * cyFade(tIn);

  col += cyPackets(ro, rd, tW);
  col += cyFrame(ro, rd, tW, cyScan0) + cyFrame(ro, rd, tW, cyScan1) + cyFrame(ro, rd, tW, cyScan2) + cyFrame(ro, rd, tW, cyScan3);

  // The core at the vanishing point, where the tunnel runs out of sight: it breathes with the bass.
  // Its light falls on the far walls round it; the core itself shows where nothing's in front of it.
  vec3 cz = vec3(cyPath(camPos.z + ${CORE_AHEAD.toFixed(1)}), camPos.z + ${CORE_AHEAD.toFixed(1)});
  vec3 toCore = cz - ro;
  float dc = length(toCore);
  float c = max(dot(rd, toCore / dc), 0.0);
  float pulse = 0.3 + 2.2 * cyCore * cyCore;
  vec3 dw = hp - cz;
  col += cyCoreCol() * 0.05 * exp(-dot(dw, dw) / 300.0) * pulse;
  float open = smoothstep(0.9, 1.0, tW / dc);
  col += cyCoreCol() * (open * pow(c, 40000.0) * 4.0 + cyCoreSeen * (pow(c, 1500.0) * 0.5 + pow(c, 200.0) * 0.04)) * pulse;
  return col;
}
`,
  init: () => ({
    clock: 0,
    z: 0,
    speed: 8,
    boost: 0,
    spinTo: 0,
    roll: 0,
    rollV: 0,
    sinceSpin: 0,
    x: 0,
    vx: 0,
    tx: 0,
    y: 0,
    vy: 0,
    ty: 0,
    glow: 0.5,
    flash: 0,
    core: 0,
    high: 0,
    seen: 1,
    scans: [],
    rng: { seed: 0xc7b35 },
  }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    s.clock = (s.clock + dt) % CLOCK;
    s.boost = Math.max(0, s.boost - frame.dt * 2.2 * Math.max(s.boost, 0.25));
    s.speed = smoothTo(s.speed, (6 + 7 * a.bass + 4 * a.punch) * (1 + 1.3 * s.boost), frame.dt, 0.3);
    s.z += s.speed * dt;
    s.glow = smoothTo(s.glow, a.level, frame.dt, 0.2);
    s.core = smoothTo(s.core, a.punch, frame.dt, 0.05);
    s.high = smoothTo(s.high, a.high, frame.dt, 0.1);
    s.flash = Math.max(0, s.flash - frame.dt * 4);
    for (const sc of s.scans) {
      sc.age += frame.dt;
      sc.z += SCAN_SPEED * dt;
    }
    s.scans = s.scans.filter((sc) => sc.age < 3);
    const spin = Math.max(0, num(frame.values, "spin", 1));
    if (a.onBeat) {
      const hit = clamp01(frame.hit);
      s.boost = Math.max(s.boost, 0.5 + 0.5 * hit);
      s.flash = Math.max(s.flash, 0.5 + 0.5 * hit);
      s.scans.push({ z: s.z + 1.5, age: 0, power: 0.6 + 0.6 * hit });
      if (s.scans.length > SCANS) s.scans.shift();
      // A new place in the section to weave to.
      s.tx = (random(s.rng) - 0.5) * 0.9;
      s.ty = (random(s.rng) - 0.5) * 0.9;
      // Every eighth hit or so (more often with more Spin), a quarter-turn.
      s.sinceSpin += 1;
      if (spin > 0 && s.sinceSpin >= Math.max(2, Math.round(8 / spin))) {
        s.sinceSpin = 0;
        s.spinTo += (random(s.rng) < 0.5 ? -1 : 1) * (Math.PI / 2);
      }
    }
    [s.roll, s.rollV] = spring(s.roll, s.rollV, s.spinTo, 7, frame.dt);
    [s.x, s.vx] = spring(s.x, s.vx, s.tx, 1.6, dt);
    [s.y, s.vy] = spring(s.y, s.vy, s.ty, 1.6, dt);
    // Turns are whole quarter-turns: keep both within a turn.
    if (Math.abs(s.spinTo) >= TAU) {
      const k = Math.sign(s.spinTo) * TAU;
      s.spinTo -= k;
      s.roll -= k;
    }
    s.seen = smoothTo(s.seen, coreSeen(pathAt(s.z, s.x, s.y)), frame.dt, 0.15);
    // The world repeats every PERIOD: wrap the camera and what's laid on it together.
    if (s.z >= PERIOD) {
      s.z -= PERIOD;
      for (const sc of s.scans) sc.z -= PERIOD;
    }
  },
  uniforms(s, frame) {
    const pos = pathAt(s.z, s.x, s.y);
    const fwd = normalize(sub(pathAt(s.z + 8, s.x * 0.6, s.y * 0.6), pos));
    return [
      ...cameraLooking(pos, fwd, s.roll, 58 + 18 * s.boost),
      ...soundUniforms(frame),
      float("cyClock", s.clock),
      float("cyGlow", s.glow),
      float("cyFlash", s.flash),
      float("cyCore", s.core),
      float("cyHigh", s.high),
      float("cyCoreSeen", s.seen),
      ...Array.from({ length: SCANS }, (_, i) => {
        const sc = s.scans[i];
        return vec4(`cyScan${i}`, sc ? [sc.z, sc.age, sc.power, 0] : [0, 0, 0, 0]);
      }),
    ];
  },
};
