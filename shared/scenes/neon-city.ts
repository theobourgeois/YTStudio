/**
 * Neon City (docs/visualizer/scenes.md, "Five more"): a night flight down an endless avenue between towers in the
 * rain: kanji in neon tubes on signs hanging over the street, great billboards, thousands of small lit windows,
 * flying traffic, searchlights sweeping the cloud, and a wet street mirroring it all. The towers stand on a grid of
 * lots, traced cell by cell (a DDA: exact, and cheap however far it looks): a base, a set-back top, plant on the roof,
 * an antenna with a blinking red light, a few supertalls going up into the cloud. Their windows (with fins, ledges
 * and plant floors, crowns lit from below) are drawn on exact faces and filtered by the pixel's footprint (no moiré
 * far off). The lights' glow is gathered along each ray in closed form (in-scattering from each
 * light's nearest point), squashed in the street's mirror so its reflections streak; the mirror is looked into three
 * times, tilted along the avenue, so lights smear as on wet asphalt. It hears the sound itself: the towers' faces
 * turned to the camera are meters (four window columns a band, lit to its level, a neon cap at its peak),
 * and those along the avenue are lit to their bands too, so the street is an analyser in perspective. The world
 * repeats every `PERIOD` metres along the avenue and the camera's place wraps in it (whatever is laid on it, and
 * the clouds, tile), so a long song never runs out of precision. Stepped: how far it's flown (a speed on the bass),
 * its weaves between lanes and heights (each picked by a hit, springs to reach them, banking into them), and a
 * kick's flash of the neon and haze.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraUniforms, clamp01, float, num, random, sceneDt, smoothTo, soundUniforms, wrap } from "./kit.ts";

/** The lots' size, and how many repeat along the avenue (the GLSL's `CELL` and `ROWS`). */
const CELL = 30;
const ROWS = 240;
const PERIOD = CELL * ROWS;
/** The clouds' tile (the GLSL's `cloudCoord` repeats every this many metres). */
const CLOUD_PERIOD = 16000;
/** Lanes the camera weaves between (metres across the avenue: the signs start at ±11.5). */
const LANES = [-7.5, -4, 0, 4, 7.5];

interface CityState {
  time: number;
  /** How far down the avenue (wrapped), and how fast (m, m/s). */
  z: number;
  speed: number;
  /** Across the avenue and up: where it is, how fast, where it's heading. */
  x: number;
  vx: number;
  tx: number;
  y: number;
  vy: number;
  ty: number;
  roll: number;
  /** Seconds since the last weave, and weaves so far (every few change the height too). */
  sinceWeave: number;
  weaves: number;
  /** A kick's flash of the neon, falling; how loud it's been lately. */
  flash: number;
  energy: number;
  /** The clouds' drift (wrapped in their own tile). */
  cloud: number;
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

export const NEON_CITY: SceneSpec<CityState> = {
  type: "neon-city",
  label: "Neon City",
  params: [
    {
      kind: "choice",
      key: "palette",
      label: "Palette",
      default: "cyberpunk",
      options: [
        { value: "cyberpunk", label: "Cyberpunk" },
        { value: "bladerunner", label: "Blade Runner" },
        { value: "tokyo", label: "Tokyo" },
        { value: "matrix", label: "Matrix" },
      ],
    },
    { kind: "number", key: "rain", label: "Rain", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "height", label: "Height", default: 1, min: 0.5, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  audio: () => ({ rows: 1, span: 0, fall: 0.15, window: 0 }),
  glsl: /* glsl */ `
uniform float ncTime;
uniform float ncFlash;
uniform float ncCloud;

const float CELL = 30.0;
const float ROWS = 240.0;
const float HALF = 15.0;
const float KERB = 11.0;
const float SLOT = 10.0;
const float SLOTS = 720.0;
float fogAmount(vec3 ro, vec3 rd, float t);

// ---- The palette ----------------------------------------------------------------------------------------------
vec3 neonColor(float h) {
  int i = int(h * 3.999);
  if (palette == 1) return i == 0 ? vec3(1.0, 0.2, 0.42) : i == 1 ? vec3(0.08, 0.85, 0.75) : i == 2 ? vec3(1.0, 0.42, 0.06) : vec3(0.5, 0.72, 1.0);
  if (palette == 2) return i == 0 ? vec3(1.0, 0.08, 0.1) : i == 1 ? vec3(1.0, 0.28, 0.62) : i == 2 ? vec3(0.95, 0.9, 1.0) : vec3(0.12, 0.38, 1.0);
  if (palette == 3) return i == 0 ? vec3(0.12, 1.0, 0.28) : i == 1 ? vec3(0.5, 1.0, 0.2) : i == 2 ? vec3(0.04, 0.5, 0.15) : vec3(0.7, 1.0, 0.7);
  return i == 0 ? vec3(1.0, 0.06, 0.5) : i == 1 ? vec3(0.04, 0.7, 1.0) : i == 2 ? vec3(0.45, 0.12, 1.0) : vec3(1.0, 0.65, 0.08);
}
vec3 hazeColor() {
  if (palette == 1) return vec3(0.03, 0.012, 0.004);
  if (palette == 2) return vec3(0.004, 0.004, 0.011);
  if (palette == 3) return vec3(0.0015, 0.007, 0.003);
  return vec3(0.009, 0.003, 0.016);
}
// The city's light in the haze: the neon's colours mixed, glowing low along the street and far down it.
vec3 cityGlow() { return (neonColor(0.1) + neonColor(0.3) + neonColor(0.6) * 0.6) * 0.016; }
vec3 fogColor(vec3 rd) {
  return hazeColor() * (1.0 + 0.6 * ncFlash) + cityGlow() * (0.35 + 1.8 * exp(-abs(rd.y) * 7.0)) * (1.0 + 0.5 * ncFlash);
}
float hazeDensity() { return palette == 1 ? 0.0065 : palette == 2 ? 0.0028 : 0.004; }
// The light inside the windows: warm, or cool, by a hash.
vec3 windowColor(float h) {
  if (palette == 3) return mix(vec3(0.35, 1.0, 0.45), vec3(0.75, 1.0, 0.6), h);
  vec3 warm = palette == 1 ? vec3(1.0, 0.55, 0.22) : vec3(1.0, 0.68, 0.38);
  vec3 cool = palette == 0 ? vec3(0.5, 0.75, 1.0) : vec3(0.75, 0.88, 1.0);
  return h < 0.62 ? warm * (0.8 + 0.4 * h) : h < 0.9 ? cool : neonColor(fract(h * 7.3));
}
// The equaliser's peaks, across the bands.
vec3 peakColor(float band) {
  if (palette == 3) return vec3(0.4, 1.0, 0.5);
  if (palette == 1) return mix(vec3(1.0, 0.45, 0.1), vec3(0.1, 0.9, 0.8), band);
  if (palette == 2) return mix(vec3(1.0, 0.15, 0.2), vec3(0.3, 0.5, 1.0), band);
  return mix(vec3(1.0, 0.1, 0.55), vec3(0.1, 0.75, 1.0), band);
}

// ---- Noise that tiles (the world repeats, so whatever is laid on it must too) -------------------------------------
float tnoise(vec2 x, float per) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, per));
  float b = hash12(mod(i + vec2(1.0, 0.0), per));
  float c = hash12(mod(i + vec2(0.0, 1.0), per));
  float d = hash12(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float tfbm(vec2 x, float per, int octaves) {
  float a = 0.0;
  float b = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    a += b * tnoise(x, per);
    x *= 2.0;
    per *= 2.0;
    b *= 0.5;
  }
  return a;
}
// A pulse train (1 on [a, b] of each unit), box-filtered over a footprint w (in units): no moiré however far.
float pulseInt(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
float pulseF(float x, float a, float b, float w) {
  w = max(w, 1e-4);
  return (pulseInt(x + 0.5 * w, a, b) - pulseInt(x - 0.5 * w, a, b)) / w;
}

// ---- The towers -----------------------------------------------------------------------------------------------
// A tower: a base, maybe a set-back top, plant on its roof, maybe an antenna (x, z, its foot and its tip).
struct Tower { vec3 lo; vec3 hi; vec3 lo2; vec3 hi2; vec3 rlo; vec3 rhi; vec4 ant; float top; vec3 seed; };
bool crossStreet(float iz) { return mod(mod(iz, ROWS), 6.0) < 0.5; }
// The tower on lot (ix, iz): ix 0 is the avenue; every sixth iz a cross street. A few are supertall, up into the cloud.
Tower towerAt(vec2 cell) {
  float iz = mod(cell.y, ROWS);
  vec3 a = hash33(vec3(cell.x, iz, 7.0));
  vec3 b = hash33(vec3(cell.x, iz, 13.0));
  float row = abs(cell.x);
  float x0 = cell.x * CELL - HALF;
  float front = row < 1.5 ? 0.2 + 1.6 * a.x : 2.0 + 3.0 * a.x;
  float back = 2.0 + 4.0 * a.y;
  float lx = cell.x > 0.0 ? x0 + front : x0 + back;
  float hx = cell.x > 0.0 ? x0 + CELL - back : x0 + CELL - front;
  float lz = cell.y * CELL + 1.5 + 3.0 * a.z;
  float hz = (cell.y + 1.0) * CELL - 1.5 - 3.0 * b.x;
  float tall = step(0.955, fract(a.z * 7.31 + b.y * 3.7));
  float h = (26.0 + 95.0 * b.y * b.y + step(0.78, b.z) * (90.0 + 120.0 * a.x) + 22.0 * (row - 1.0) + tall * (300.0 + 260.0 * b.x)) * height;
  Tower t;
  t.seed = vec3(hash12(vec2(cell.x, iz)), b.z, a.y);
  t.lo = vec3(lx, 0.0, lz);
  vec3 tlo;
  vec3 thi;
  if (h > 70.0) {
    float h1 = h * (0.45 + 0.3 * b.x);
    float ins = 2.0 + 3.0 * a.y;
    t.hi = vec3(hx, h1, hz);
    t.lo2 = vec3(lx + ins, h1, lz + ins);
    t.hi2 = vec3(hx - ins, h, hz - ins);
    tlo = t.lo2;
    thi = t.hi2;
  } else {
    t.hi = vec3(hx, h, hz);
    t.lo2 = vec3(1e5);
    t.hi2 = vec3(1e5);
    tlo = t.lo;
    thi = t.hi;
  }
  // Plant on the roof: a smaller block, off centre.
  vec2 span = thi.xz - tlo.xz;
  vec2 rs = span * (0.25 + 0.25 * b.yz);
  vec2 rc = tlo.xz + (span - rs) * vec2(fract(a.x * 5.1), fract(a.y * 3.9));
  t.rlo = vec3(rc.x, h, rc.y);
  t.rhi = vec3(rc.x + rs.x, h + 3.0 + 5.0 * fract(b.x * 9.1), rc.y + rs.y);
  // An antenna on the taller ones, a red light at its tip.
  vec2 ac = 0.5 * (tlo.xz + thi.xz);
  t.ant = h > 85.0 && fract(b.y * 11.3) > 0.4 ? vec4(ac.x, ac.y, h, h + (15.0 + 40.0 * fract(a.z * 13.7)) * height) : vec4(ac, h, h);
  t.top = max(t.rhi.y, t.ant.w);
  return t;
}
float boxT(vec3 ro, vec3 ird, vec3 lo, vec3 hi) {
  vec3 t0 = (lo - ro) * ird;
  vec3 t1 = (hi - ro) * ird;
  vec3 tn = min(t0, t1);
  vec3 tf = max(t0, t1);
  float a = max(max(tn.x, tn.y), tn.z);
  float b = min(min(tf.x, tf.y), tf.z);
  return a < b && b > 0.0 ? max(a, 0.0) : 1e9;
}
// The box of a tower's part (0 base, 1 top, 2 roof plant, 3 antenna, never thinner than a pixel at distance t).
void partBox(Tower tw, int part, float w, out vec3 lo, out vec3 hi) {
  if (part == 0) { lo = tw.lo; hi = tw.hi; }
  else if (part == 1) { lo = tw.lo2; hi = tw.hi2; }
  else if (part == 2) { lo = tw.rlo; hi = tw.rhi; }
  else { lo = vec3(tw.ant.x - w, tw.ant.z, tw.ant.y - w); hi = vec3(tw.ant.x + w, tw.ant.w, tw.ant.y + w); }
}
float antennaWidth(float t, float pix) { return max(0.35, 0.6 * pix * t); }
// The red lights on the antennas, blinking slowly, each in its own time.
float beaconBlink(float seed) {
  float f = fract(ncTime * 0.6 + seed);
  return smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.35, 0.45, f));
}
// The nearest tower along a ray, stepping the lots' grid: its t (or -1), which lot, which part; and the red lights of
// the antennas it passes (added to beacons).
float traceCity(vec3 ro, vec3 rd, float tmax, int steps, float pix, out vec2 lot, out int part, inout vec3 beacons) {
  vec3 ird = 1.0 / rd;
  float hmax = 640.0 * height;
  vec2 cell = vec2(floor((ro.x + HALF) / CELL), floor(ro.z / CELL));
  vec2 stp = sign(rd.xz);
  vec2 tDelta = abs(CELL * ird.xz);
  vec2 tNext = ((cell + max(stp, vec2(0.0))) * CELL - vec2(HALF, 0.0) - ro.xz) * ird.xz;
  float tIn = 0.0;
  lot = vec2(0.0);
  part = 0;
  for (int i = 0; i < 128; i++) {
    if (i >= steps || tIn > tmax) break;
    float yIn = ro.y + rd.y * tIn;
    if ((rd.y >= 0.0 && yIn > hmax) || yIn < 0.0) break;
    if (cell.x != 0.0 && !crossStreet(cell.y)) {
      Tower tw = towerAt(cell);
      float tOut = min(tNext.x, tNext.y);
      if (min(yIn, ro.y + rd.y * tOut) < tw.top) {
        float best = 1e9;
        int which = 0;
        for (int k = 0; k < 4; k++) {
          vec3 lo;
          vec3 hi;
          partBox(tw, k, antennaWidth(tIn, pix), lo, hi);
          float tk = boxT(ro, ird, lo, hi);
          if (tk < best) { best = tk; which = k; }
        }
        if (tw.ant.w > tw.ant.z + 1.0) {
          vec3 tip = vec3(tw.ant.x, tw.ant.w + 0.5, tw.ant.y);
          float tc = dot(tip - ro, rd);
          if (tc > 0.0 && tc < best) {
            float d2 = dot(ro + rd * tc - tip, ro + rd * tc - tip);
            // A lamp of 0.3 m, never thinner than a pixel; a small halo, sized by angle.
            float px = max(0.3, 1.3 * pix * tc);
            float halo = 0.012 * tc;
            beacons += vec3(1.0, 0.04, 0.02) * (exp(-d2 / (px * px)) * 3.0 * min(1.0, 0.3 * 0.3 / (px * px) * 4.0) + 0.25 / (1.0 + d2 / (halo * halo)))
              * beaconBlink(tw.seed.x) * exp(-hazeDensity() * tc * 0.8);
          }
        }
        if (best < 1e8) {
          lot = cell;
          part = which;
          return best;
        }
      }
    }
    if (tNext.x < tNext.y) { tIn = tNext.x; tNext.x += tDelta.x; cell.x += stp.x; }
    else { tIn = tNext.y; tNext.y += tDelta.y; cell.y += stp.y; }
  }
  return -1.0;
}

// ---- Billboards: great screens on the towers facing the avenue --------------------------------------------------
// The billboard on the street face of lot (ix, iz), if it has one: its rectangle on the face (u0, v0, u1, v1, with u
// along the avenue from the base's near end) and its seed.
bool billboardAt(vec2 lot, Tower tw, out vec4 rect, out vec3 h) {
  h = hash33(vec3(lot.x, mod(lot.y, ROWS), 21.0));
  rect = vec4(0.0);
  if (abs(lot.x) > 1.5 || h.x < 0.45 || crossStreet(lot.y)) return false;
  float w = tw.hi.z - tw.lo.z;
  float top = tw.hi.y;
  float bw = w * (0.4 + 0.45 * h.y);
  float bh = h.z > 0.45 ? bw * (1.3 + 1.2 * fract(h.y * 5.1)) : bw * 0.5;
  float room = top - 4.0 - bh - 10.0;
  if (room < 0.0) return false;
  float v0 = 10.0 + room * fract(h.x * 7.7) * 0.7;
  float u0 = (w - bw) * fract(h.z * 3.3);
  rect = vec4(u0, v0, u0 + bw, v0 + bh);
  return true;
}
// What a billboard shows at f (0..1 across and up), fw its footprint there: a glowing logo, scrolling bands, or
// columns of glyphs, on a gradient; scanlines close up.
vec3 billboard(vec2 f, vec3 h, vec2 fw) {
  vec3 a = neonColor(h.y);
  vec3 b = neonColor(fract(h.y + 0.31 + 0.3 * h.z));
  float kind = floor(fract(h.x * 13.7) * 3.0);
  float aspect = h.z > 0.45 ? 0.5 : 2.0;
  vec3 col = mix(a, b, smoothstep(0.0, 1.0, f.y + 0.25 * sin(ncTime * 0.7 + h.x * 9.0))) * 0.35;
  if (kind == 0.0) {
    // A logo: a ring and a disc, breathing with the beat.
    vec2 c = (f - 0.5) * vec2(1.0, 1.0 / aspect);
    float r = length(c) / min(1.0, 1.0 / aspect);
    float ring = 1.0 - smoothstep(0.02, 0.04 + fw.x, abs(r - 0.33 - 0.04 * sBeat));
    float disc = 1.0 - smoothstep(0.17, 0.19 + fw.x, r);
    col = mix(col * 0.4, b * 1.2, ring) + a * disc * (1.0 + sBeat);
  } else if (kind == 1.0) {
    // Bands scrolling up, in two colours.
    float y = f.y * 6.0 - ncTime * (0.4 + 0.6 * h.y);
    float band = pulseF(y, 0.0, 0.55, fw.y * 6.0);
    col = mix(a * 0.15, mix(a, b, fract(floor(y) * 0.37)) * 1.1, band);
  } else {
    // Columns of glyphs, lit in turn.
    vec2 g = f * vec2(4.0, 4.0 / aspect * 1.4);
    vec2 gi = floor(g);
    float on = step(0.5, hash12(vec2(gi.x * 7.0 + gi.y, floor(ncTime * 2.0 + gi.x * 0.37) + h.z * 50.0)));
    float stroke = pulseF(g.x, 0.15, 0.85, fw.x * 4.0) * pulseF(g.y, 0.12, 0.88, fw.y * 4.0 / aspect * 1.4);
    col = col * 0.5 + b * on * stroke * 1.4;
  }
  // Scanlines, close up.
  col *= 1.0 - 0.3 * (1.0 - smoothstep(0.1, 0.5, fw.y * 90.0)) * pulseF(f.y * 90.0, 0.0, 0.5, fw.y * 90.0);
  // A bright frame.
  float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y) * aspect);
  col += b * (1.0 - smoothstep(0.012, 0.02 + fw.x, e)) * 1.2;
  return col * (1.0 + 0.8 * ncFlash);
}

// ---- The signs: blades hanging over the sidewalks, every SLOT metres either side (or not) --------------------
// Slot k on side s: false where there's none; else its box and its seed.
bool signAt(float k, float s, out vec3 lo, out vec3 hi, out vec3 h) {
  float km = mod(k, SLOTS);
  h = hash33(vec3(km, s * 3.0, 5.0));
  lo = vec3(0.0);
  hi = vec3(0.0);
  if (h.x > 0.6) return false;
  float zc = k * SLOT + 2.0 + 6.0 * fract(h.z * 3.7);
  if (crossStreet(floor(zc / CELL))) return false;
  float reach = 1.6 + 2.0 * h.y;
  float y0 = 4.5 + 18.0 * h.z * h.z;
  float len = 4.0 + 13.0 * fract(h.x * 7.13 + h.y);
  lo = vec3(s > 0.0 ? HALF - reach : -HALF - 1.0, y0, zc - 0.2);
  hi = vec3(s > 0.0 ? HALF + 1.0 : -HALF + reach, y0 + len, zc + 0.2);
  return true;
}
float signPower(vec3 h) {
  // A few flicker, as old tubes do; every one flashes on the kicks.
  float flick = h.y > 0.86 ? step(0.25, hash12(vec2(floor(ncTime * 14.0), h.z * 91.0))) : 1.0;
  return (2.2 + 1.6 * fract(h.z * 13.1)) * flick * (1.0 + 1.2 * ncFlash);
}
vec3 signColor(vec3 h) { return neonColor(fract(h.x * 5.31 + h.z * 2.7)); }

// Every sign along a ray up to tEnd: the nearest one hit (t, its slot, side) and the glow gathered from all of them
// (in-scattering from each sign's nearest point, in closed form). squash < 1 stretches the glows up and down (the
// wet street's streaks).
vec3 signsAlong(vec3 ro, vec3 rd, float tEnd, int count, float squash, out vec4 hit) {
  vec3 glow = vec3(0.0);
  hit = vec4(1e9, 0.0, 0.0, 0.0);
  float dir = rd.z >= 0.0 ? 1.0 : -1.0;
  float k0 = floor(ro.z / SLOT) - dir;
  float density = hazeDensity();
  vec3 ird = 1.0 / rd;
  for (int i = 0; i < 40; i++) {
    if (i >= count) break;
    float k = k0 + dir * float(i);
    if ((k * SLOT - ro.z) * dir > tEnd * abs(rd.z) + SLOT) break;
    for (int side = 0; side < 2; side++) {
      float s = side == 0 ? -1.0 : 1.0;
      vec3 lo;
      vec3 hi;
      vec3 h;
      if (!signAt(k, s, lo, hi, h)) continue;
      float tb = boxT(ro, ird, lo, hi);
      if (tb < hit.x && tb < tEnd) hit = vec4(tb, k, s, 0.0);
      // The sign as a line of light down its middle.
      vec3 c = vec3(0.5 * (lo.x + hi.x) + s * 0.3, 0.0, 0.5 * (lo.z + hi.z));
      vec2 rel = c.xz - ro.xz;
      float tc = dot(rel, rd.xz) / max(dot(rd.xz, rd.xz), 1e-5);
      float yc = clamp(ro.y + rd.y * tc, lo.y + 0.5, hi.y - 0.5);
      vec3 q = vec3(c.x, yc, c.z);
      tc = dot(q - ro, rd);
      vec3 off = ro + rd * tc - q;
      off.y *= squash;
      float d = max(length(off), 0.25);
      // (The mist is thick round the signs: their light dies out within a few metres of them.)
      float scatter = (atan((tEnd - tc) / d) + atan(tc / d)) / d * exp(-d * 0.14);
      glow += signColor(h) * signPower(h) * (hi.y - lo.y) * scatter * exp(-density * max(tc, 0.0));
    }
  }
  // The billboards: each an area of light on its face, seen from its nearest point.
  float l0 = floor(ro.z / CELL) - dir;
  for (int i = 0; i < 14; i++) {
    if (i * 3 >= count) break;
    float lz = l0 + dir * float(i);
    if ((lz * CELL - ro.z) * dir > tEnd * abs(rd.z) + CELL) break;
    for (int side = 0; side < 2; side++) {
      vec2 lot = vec2(side == 0 ? -1.0 : 1.0, lz);
      Tower tw = towerAt(lot);
      vec4 rect;
      vec3 h;
      if (!billboardAt(lot, tw, rect, h)) continue;
      float fx = side == 0 ? tw.hi.x + 0.5 : tw.lo.x - 0.5;
      vec3 c = vec3(fx, 0.5 * (rect.y + rect.w), tw.lo.z + 0.5 * (rect.x + rect.z));
      float tc = dot(c - ro, rd);
      vec3 near = ro + rd * clamp(tc, 0.0, tEnd);
      vec3 q = vec3(fx, clamp(near.y, rect.y, rect.w), clamp(near.z, tw.lo.z + rect.x, tw.lo.z + rect.z));
      tc = dot(q - ro, rd);
      vec3 off = ro + rd * tc - q;
      off.y *= squash;
      float d = max(length(off), 0.5);
      float scatter = (atan((tEnd - tc) / d) + atan(tc / d)) / d * exp(-d * 0.05);
      vec3 bc = mix(neonColor(h.y), neonColor(fract(h.y + 0.31 + 0.3 * h.z)), 0.5);
      glow += bc * (1.0 + 0.8 * ncFlash) * (rect.z - rect.x) * (rect.w - rect.y) * 0.05 * scatter * exp(-density * max(tc, 0.0));
    }
  }
  return glow * density * 0.6;
}
// A sign's face: glyphs stacked down it, in tubes on dark or dark on a lit panel.
// A glyph's strokes (c 0..1 across the character): tubes along some edges of a 3x3 lattice, and now and then a
// slant, so it reads as a kanji in neon. How far c is from the nearest stroke.
float glyphDist(vec2 c, float seed) {
  float d = 1e3;
  for (int e = 0; e < 12; e++) {
    float fe = float(e);
    if (hash12(vec2(fe * 7.3 + 1.0, seed)) < 0.5) continue;
    bool across = e < 6;
    float idx = across ? fe : fe - 6.0;
    float line = 0.1 + 0.4 * floor(idx / 2.0);
    float a0 = 0.1 + 0.4 * mod(idx, 2.0);
    vec2 q = across ? c : c.yx;
    float dx = max(max(a0 - q.x, q.x - a0 - 0.4), 0.0);
    d = min(d, length(vec2(dx, q.y - line)));
  }
  float sl = hash12(vec2(91.0, seed));
  if (sl > 0.55) {
    // A slant down from the middle to a lower corner.
    vec2 a = vec2(0.5, 0.5);
    vec2 b = vec2(sl > 0.78 ? 0.1 : 0.9, 0.9);
    vec2 pa = c - a;
    vec2 ba = b - a;
    d = min(d, length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)));
  }
  return d;
}
// A neon tube dm metres from its axis, seen with a footprint fp: a white-hot core and a soft bloom on the panel.
vec2 tube(float dm, float fp) {
  float rt = 0.05;
  float w = max(rt, fp * 0.6);
  return vec2(exp(-dm * dm / (w * w)) * rt / w, exp(-dm / 0.22));
}
// A sign's face: kanji in neon tubes stacked down it on a dark panel, an outline of another colour; or a lit panel
// with the strokes dark.
vec3 shadeSign(vec3 p, vec3 rd, float t, float k, float s, float pix) {
  vec3 lo;
  vec3 hi;
  vec3 h;
  signAt(k, s, lo, hi, h);
  float power = signPower(h);
  vec3 col = signColor(h);
  vec3 col2 = neonColor(fract(h.x * 5.31 + h.z * 2.7 + 0.25 + 0.5 * step(0.5, h.y)));
  vec3 d = min(abs(p - lo), abs(p - hi));
  if (d.z > min(d.x, d.y)) return col * power * 0.04 + hazeColor() * 0.2;
  float outer = s > 0.0 ? lo.x : hi.x;
  float w = HALF - abs(outer);
  float len = hi.y - lo.y;
  // On a face: across from the outer edge, down from the top.
  vec2 f = vec2(abs(p.x - outer), hi.y - p.y);
  float fp = t * pix / max(abs(rd.z), 0.08);
  float ring = min(min(f.x, w - f.x), min(f.y, len - f.y));
  vec2 edge = tube(abs(ring - 0.12), fp);
  // The characters: squares as wide as the sign, one under another.
  float c = w - 0.6;
  float pitch = c + 0.25;
  float n = floor((len - 0.5) / pitch);
  float gy = (f.y - 0.35) / pitch;
  float ci = floor(gy);
  vec2 cu = vec2((f.x - 0.3) / c, fract(gy) * pitch / c);
  float inside = step(0.0, gy) * step(ci, n - 1.0) * step(0.0, cu.x) * step(cu.x, 1.0) * step(cu.y, 1.0);
  vec2 glyph = inside > 0.0 ? tube(glyphDist(cu, ci * 3.1 + h.z * 57.0) * c, fp) : vec2(0.0);
  // Far off, the strokes are a glow of their average.
  float far = smoothstep(0.2, 0.6, fp / c);
  glyph = mix(glyph, vec2(0.14, 0.3) * step(0.0, gy) * step(ci, n - 1.0), far);
  bool panel = fract(h.x * 9.7) > 0.65;
  vec3 hot = vec3(1.0) * 0.3;
  vec3 res;
  if (panel) res = col * power * 0.3 * (1.0 - 0.85 * min(glyph.x * 3.0 + glyph.y * 0.3, 1.0)) + (col2 + hot) * power * edge.x * 1.5;
  else res = (col * 1.6 + hot) * power * glyph.x + col * power * glyph.y * 0.18 + (col2 * 1.6 + hot) * power * edge.x + col2 * power * edge.y * 0.1;
  return res + col * power * 0.012;
}

// ---- Light on surfaces: the signs' spill, the shops' glow from below -----------------------------------------
vec3 spill(vec3 p, vec3 n) {
  vec3 sum = vec3(0.0);
  float k0 = floor(p.z / SLOT);
  for (int i = -2; i <= 2; i++) {
    float k = k0 + float(i);
    for (int side = 0; side < 2; side++) {
      float s = side == 0 ? -1.0 : 1.0;
      vec3 lo;
      vec3 hi;
      vec3 h;
      if (!signAt(k, s, lo, hi, h)) continue;
      vec3 c = vec3(0.5 * (lo.x + hi.x), clamp(p.y, lo.y, hi.y), 0.5 * (lo.z + hi.z));
      vec3 l = c - p;
      float d2 = dot(l, l);
      float lam = max(dot(n, l) * inversesqrt(d2 + 1e-4), 0.0) * 0.6 + 0.4 * step(0.5, n.y);
      sum += signColor(h) * signPower(h) * (hi.y - lo.y) * lam / (d2 + 6.0);
    }
  }
  return sum * 0.5;
}

// ---- Traffic: spinners flying down the avenue, head lights coming, tail lights going ------------------------
// Each car is a pair of lights; its place along the avenue is relative to the camera's (a window of TRAFFIC metres,
// which divides the world's period, so the camera's wrap doesn't move them).
const float TRAFFIC = 600.0;
vec3 trafficAlong(vec3 ro, vec3 rd, float tEnd, float squash, float pix) {
  vec3 sum = vec3(0.0);
  float density = hazeDensity();
  for (int i = 0; i < 12; i++) {
    vec3 h = hash33(vec3(float(i), 4.0, 9.0));
    float dir = h.x > 0.45 ? -1.0 : 1.0;
    float speed = 18.0 + 22.0 * h.y;
    float zr = mod(h.z * TRAFFIC + dir * speed * ncTime - camPos.z, TRAFFIC) - 80.0;
    // Their lanes are by the signs, clear of the camera's.
    float lane = (dir < 0.0 ? 1.0 : -1.0) * (9.6 + 1.2 * fract(h.y * 7.1));
    float y = 10.0 + 50.0 * fract(h.x * 5.3) * fract(h.z * 3.1) + 2.0 * sin(ncTime * 0.5 + h.z * 6.0);
    vec3 c = vec3(lane, y, camPos.z + zr);
    // Coming at us: white head lights; going: red tail lights.
    vec3 col = dir < 0.0 ? vec3(0.9, 0.95, 1.0) * 3.0 : vec3(1.0, 0.05, 0.02) * 2.2;
    for (int k = 0; k < 2; k++) {
      vec3 q = c + vec3(float(k) * 2.0 - 1.0, 0.0, 0.0);
      float tc = dot(q - ro, rd);
      if (tc < 0.0 || tc > tEnd) continue;
      vec3 off = ro + rd * tc - q;
      off.y *= squash;
      float d2 = dot(off, off);
      // A small bright core (never thinner than a pixel), and its light scattered in the haze.
      // (Lamps are bars: wider than tall.)
      vec3 bar = off * vec3(0.3, 1.0, 1.0);
      float px = 0.06 + 1.5 * pix * tc;
      float core = exp(-dot(bar, bar) / (px * px)) * min(1.0, 0.07 * 0.07 / (px * px) * 4.0) * smoothstep(4.0, 14.0, tc);
      float d = max(sqrt(d2), 0.2);
      float scatter = (atan((tEnd - tc) / d) + atan(tc / d)) / d * exp(-d * 0.2) * smoothstep(4.0, 25.0, tc);
      sum += col * (core * 3.0 + scatter * density * 2.0) * exp(-density * tc);
    }
  }
  return sum;
}

// ---- The sky: a low ceiling of cloud lit from below by the city -----------------------------------------------
vec3 sky(vec3 ro, vec3 rd) {
  vec3 haze = hazeColor();
  vec3 col = haze * (0.1 + 1.4 * exp(-max(rd.y, 0.0) * 4.0)) + cityGlow() * 1.4 * exp(-max(rd.y, 0.0) * 6.0);
  if (rd.y > 0.0) {
    // The cloud's underside, lit by the city: brightest low, towards the avenue's far end.
    float t = (420.0 - ro.y) / rd.y;
    vec2 q = vec2(ro.x + rd.x * t, ncCloud + rd.z * t) * 0.003;
    float c = tfbm(q + vec2(ncTime * 0.006, 0.0), 48.0, 5);
    float lit = smoothstep(0.35, 0.7, c);
    vec3 under = haze * (3.5 + 2.5 * ncFlash) * (0.3 + 1.6 * c) * (0.6 + 1.8 * exp(-rd.y * 3.0));
    col = mix(col, under, lit * exp(-t * 0.0004));
  }
  return col;
}

// ---- A tower's face ---------------------------------------------------------------------------------------------
vec3 shadeTower(vec3 p, vec3 rd, float t, vec2 lot, int part, float pix, bool cheap) {
  Tower tw = towerAt(lot);
  vec3 lo;
  vec3 hi;
  partBox(tw, part, antennaWidth(t, pix), lo, hi);
  vec3 dl = abs(p - lo);
  vec3 dh = abs(p - hi);
  vec3 dm = min(dl, dh);
  vec3 n;
  if (dm.y < dm.x && dm.y < dm.z) n = vec3(0.0, 1.0, 0.0);
  else if (dm.x < dm.z) n = vec3(dl.x < dh.x ? -1.0 : 1.0, 0.0, 0.0);
  else n = vec3(0.0, 0.0, dl.z < dh.z ? -1.0 : 1.0);
  vec3 haze = hazeColor();
  vec3 seed = tw.seed;
  float flash = 1.0 + 1.2 * ncFlash;
  vec3 trim = neonColor(fract(seed.x * 3.7));
  bool trimmed = fract(seed.x * 17.3) > 0.62;
  if (part >= 2) {
    // Plant and antennas: dark, louvres catching the haze, the odd lit vent.
    vec3 col = vec3(0.008) + haze * 0.12;
    if (part == 2 && n.y < 0.5) {
      float uu = abs(n.x) > 0.5 ? p.z : p.x;
      float fpx = t * pix / max(abs(dot(rd, n)), 0.1);
      col += haze * 0.25 * pulseF(p.y / 0.5, 0.0, 0.4, fpx / 0.5);
      col += windowColor(0.95) * 0.08 * step(0.85, hash12(vec2(floor(uu / 2.0), seed.x * 40.0))) * pulseF(uu / 2.0, 0.2, 0.8, fpx / 2.0) * step(p.y, lo.y + 2.2) * step(lo.y + 0.8, p.y);
    }
    return col;
  }
  if (n.y > 0.5) {
    // A roof: dark, an edge of neon, a beacon on the tallest.
    vec3 col = vec3(0.012) + haze * 0.08;
    float e = min(min(p.x - lo.x, hi.x - p.x), min(p.z - lo.z, hi.z - p.z));
    if (trimmed) col += trim * 2.0 * flash * (1.0 - smoothstep(0.2, 0.35 + t * pix, e));
    return col;
  }
  // A face: u along it, v up; T and B its axes.
  vec3 T = abs(n.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  float u = abs(n.x) > 0.5 ? p.z - lo.z : p.x - lo.x;
  float width = abs(n.x) > 0.5 ? hi.z - lo.z : hi.x - lo.x;
  float v = p.y;
  // The pixel's footprint on the face, along u and v.
  float cn = max(abs(dot(rd, n)), 0.03);
  vec3 w = rd - n * dot(rd, n);
  float wl = length(w);
  w = wl > 1e-4 ? w / wl : T;
  float wt = dot(w, T);
  float wb = w.y;
  vec2 fp = t * pix * vec2(sqrt(wt * wt / (cn * cn) + 1.0 - wt * wt), sqrt(wb * wb / (cn * cn) + 1.0 - wb * wb));

  // The facade itself: dark, wet, lit from below by the street and by the signs.
  vec3 col = vec3(0.006, 0.006, 0.008) + haze * 0.05;
  if (!cheap) col += vec3(0.05) * spill(p + n * 0.5, n);
  col += haze * 0.25 * exp(-v * 0.08);
  float fres = pow(1.0 - cn, 4.0);
  col += sky(p, reflect(rd, n)) * fres * 0.15;

  float faceSeed = seed.x * 31.0 + n.x * 3.0 + n.z * 7.0;
  bool street = part == 0 && abs(lot.x) < 1.5 && n.x == -sign(lot.x);
  float base = part == 0 ? 5.0 : lo.y;
  if (part == 0 && v < 5.0) {
    // Shops along the street: glass fronts lit from inside (warmer at the back, brighter up top), mullions, a door,
    // and a band of sign over each.
    float sw = 4.0 + 3.0 * fract(seed.x * 5.3);
    float sq = u / sw;
    float si = floor(sq);
    vec3 sh = hash33(vec3(si, faceSeed, 2.0));
    vec3 tint = mix(windowColor(sh.x * 0.6), neonColor(sh.y), 0.35 + 0.4 * sh.z);
    float glass = pulseF(sq, 0.05, 0.95, fp.x / sw) * (1.0 - smoothstep(3.0, 3.1 + fp.y, v)) * smoothstep(0.15, 0.25 + fp.y, v);
    float mull = 1.0 - 0.7 * pulseF(u / 1.3, 0.0, 0.06, fp.x / 1.3) * (1.0 - smoothstep(0.5, 1.5, fp.x));
    float inside = (0.06 + 0.22 * sh.z * sh.z) * (0.6 + 0.6 * smoothstep(0.3, 3.0, v)) * step(0.12, sh.x);
    float band = smoothstep(3.4, 3.48 + fp.y, v) * (1.0 - smoothstep(4.3, 4.38 + fp.y, v)) * pulseF(sq, 0.1, 0.9, fp.x / sw);
    float lettering = mix(step(0.4, hash12(vec2(floor(u * 1.6), si + faceSeed))), 0.6, smoothstep(0.2, 0.6, fp.x * 1.6));
    col += tint * glass * mull * inside + neonColor(fract(sh.y * 3.1 + 0.4)) * band * (0.3 + 1.2 * lettering) * flash * step(0.35, sh.z);
    return col;
  }
  // The windows. Each tower is one of three kinds: punched windows, ribbons of glass along each floor, or a glass
  // tower, dark and mirror-like with a few floors lit. Small bays and low floors, so the towers read as huge.
  float kind = mod(floor(seed.y * 2.999) + floor(seed.z * 7.0), 3.0);
  float ncol = max(1.0, floor(width / (kind == 0.0 ? 1.15 : kind == 1.0 ? 0.95 : 1.4)));
  float cw = width / ncol;
  float fh = kind == 2.0 ? 3.3 : 2.9;
  vec2 q = vec2(u / cw, (v - base) / fh);
  vec2 id = floor(q);
  vec2 fq = fp / vec2(cw, fh);
  float far = smoothstep(0.4, 1.1, max(fq.x, fq.y));
  float pane = kind == 0.0 ? pulseF(q.x, 0.18, 0.82, fq.x) * pulseF(q.y, 0.25, 0.82, fq.y)
    : pulseF(q.x, 0.04, 0.96, fq.x) * pulseF(q.y, kind == 1.0 ? 0.3 : 0.06, kind == 1.0 ? 0.86 : 0.95, fq.y);
  // Every few floors a plant floor (no windows, a ledge along its top); the top floors are a crown, lit from below.
  float every = 5.0 + floor(seed.z * 6.0);
  float rowsAll = floor((hi.y - base) / fh);
  bool highest = part == 1 || tw.hi2.y > 1e4;
  float crownRow = highest ? rowsAll - 2.0 : 1e4;
  float plant = mix(step(every - 0.5, mod(id.y, every)) + step(crownRow, id.y), 1.0 / every, far);
  pane *= 1.0 - clamp(plant, 0.0, 1.0);
  float ledge = pulseF((v - base) / (fh * every), 0.0, 0.04, fp.y / (fh * every));
  // Fins: a pier every few bays, standing out of the face and catching the light.
  float fe = cw * (2.0 + floor(seed.x * 3.0));
  float fin = pulseF(u / fe + 0.5, 0.0, 0.3 / fe, fp.x / fe) * step(0.3, fract(seed.z * 4.3));
  pane *= 1.0 - fin;
  vec3 catchLight = haze * 0.9 + vec3(0.04) * (cheap ? vec3(0.0) : spill(p + n * 0.5, n)) + windowColor(0.2) * 0.02 * exp(-v * 0.05);
  col += catchLight * (ledge * 0.8 + fin * 0.5);
  if (highest) col += vec3(1.0, 0.82, 0.6) * 0.03 * smoothstep(hi.y - 2.0 * fh, hi.y - 0.5, v) * (0.5 + seed.x);
  // Lit or not: a flat's few windows together, or an office's run along a floor.
  vec2 cellId = kind == 0.0 ? vec2(floor(id.x / 3.0), id.y) : vec2(floor(id.x / (4.0 + 4.0 * seed.x)), id.y);
  vec3 r = hash33(vec3(cellId, faceSeed));
  vec3 rw = hash33(vec3(id, faceSeed + 1.7));
  float litFrac = kind == 2.0 ? 0.25 + 0.25 * seed.z : 0.2 + 0.45 * seed.z;
  float bright = (0.025 + 0.22 * r.z * r.z * r.z) * (0.75 + 0.5 * rw.x);
  // Inside: lit from the ceiling; blinds in some.
  float fy = fract(q.y);
  float room = (0.75 + 0.5 * smoothstep(0.3, 0.85, fy)) * (rw.y > 0.8 ? 0.6 + 0.4 * step(0.5, fract(fy * 9.0)) : 1.0);
  room = mix(room, 1.0, far);
  vec3 light = windowColor(r.y) * step(r.x, litFrac) * bright * room;
  vec3 mean = mix(windowColor(0.3), windowColor(0.75), 0.3) * litFrac * 0.07;
  // The faces turned to the oncoming camera are meters seen face on (the lows nearest the avenue), and those along
  // it too (seen edge on, their tops make a line along the street).
  bool front = n.z < -0.5;
  vec3 peakLit = vec3(0.0);
  if (street || front) {
    // The equaliser: four columns a band, lit to its level, its top row in the peak's colour.
    float bands = max(1.0, floor(ncol / 4.0));
    float cx = front && lot.x < 0.0 ? ncol - q.x : q.x;
    float bx = mix(floor(cx / 4.0) + 0.5, cx / 4.0, far) / bands;
    float level = spectrum(0.03 + 0.92 * clamp(bx, 0.0, 1.0));
    // Along the street, bars in floors (every tower's tops make one line); face on, most of the tower.
    float rows = floor((hi.y - base) / fh);
    float reach = min(rows - 1.0, floor((front ? 40.0 : 17.0) * height));
    float bar = (0.05 + 0.95 * smoothstep(0.12, 1.0, level)) * reach;
    float wy = mix(id.y + 0.5, q.y, far);
    float inBar = 1.0 - smoothstep(bar - 0.5, bar + 0.5, wy);
    float peak = (1.0 - smoothstep(0.35, 0.9, abs(wy - bar + 0.5))) * smoothstep(0.03, 0.15, level) * (front ? 1.0 : 0.0);
    // A meter: amber low down, taking the peak's colour towards the top, its top row bright; dark above.
    vec3 amber = palette == 3 ? vec3(0.2, 0.8, 0.3) : palette == 1 ? vec3(1.0, 0.42, 0.1) : vec3(1.0, 0.5, 0.2);
    vec3 warm = mix(amber, peakColor(bx), smoothstep(0.15, 1.0, wy / max(bar, 1.0)));
    float ramp = 0.35 + 0.9 * smoothstep(0.0, 1.0, wy / max(bar, 1.0));
    vec3 eqLight = warm * (0.03 + 0.08 * rw.z * rw.z) * ramp * step(rw.x, 0.8) * inBar * room;
    vec3 eqMean = warm * 0.035 * inBar * ramp;
    // The peak: one neon cap across the band's windows, as a meter's.
    float cap = pulseF(cx / 4.0, 0.05, 0.95, fq.x / 4.0) * pulseF(q.y, 0.25, 0.82, fq.y) * (1.0 - clamp(plant, 0.0, 1.0));
    peakLit = peakColor(bx) * 1.1 * peak * flash * mix(cap, 0.55, far);
    light = light * 0.12 + eqLight;
    mean = mean * 0.12 + eqMean;
  }
  vec3 lit = pane * mix(light, mean, far) + peakLit;
  if (kind == 2.0) {
    // Glass: the haze and the sky in it, darker where it's lit from inside.
    col += sky(p, reflect(rd, n)) * (0.08 + 0.2 * fres) * pane;
  }
  col += lit;
  if (street) {
    vec4 rect;
    vec3 bh;
    if (billboardAt(lot, tw, rect, bh) && u > rect.x && u < rect.z && v > rect.y && v < rect.w) {
      vec2 size = rect.zw - rect.xy;
      return billboard((vec2(u, v) - rect.xy) / size, bh, fp / size);
    }
  }
  // Neon trim: up the corners facing the street, and along the top.
  if (trimmed) {
    float edge = min(u, width - u);
    float vert = (1.0 - smoothstep(0.25, 0.4 + fp.x, edge)) * step(0.5, seed.z) * (street ? 1.0 : 0.0);
    float topBand = (1.0 - smoothstep(0.25, 0.4 + fp.y, abs(v - (hi.y - 1.0))));
    col += trim * 2.2 * flash * (vert + topBand);
  }
  return col;
}

// What the wet street mirrors along r from p (t: how far p is from the eye): the towers, the signs and the traffic
// (their glow streaked up and down), the sky; through the haze.
vec3 mirrorOf(vec3 p, vec3 r, float t, float pix, int steps) {
  r.y = max(r.y, 0.002);
  vec2 lot;
  int part;
  vec3 beacons = vec3(0.0);
  float tr = traceCity(p + r * 0.05, r, 900.0, steps, pix * 3.0, lot, part, beacons);
  float tEnd = tr > 0.0 ? tr : 900.0;
  vec4 sh;
  vec3 glow = signsAlong(p, r, tEnd, 12, 0.12, sh) * 1.6 + trafficAlong(p, r, tEnd, 0.15, pix * 2.0);
  vec3 refl;
  if (sh.x < tEnd) refl = shadeSign(p + r * sh.x, r, sh.x + t, sh.y, sh.z, pix * 3.0);
  else if (tr > 0.0) refl = shadeTower(p + r * tr, r, tr + t, lot, part, pix * 3.0, true);
  else refl = sky(p, r);
  return mix(refl, fogColor(r), fogAmount(p, r, min(tEnd, sh.x))) + glow + beacons;
}

// ---- The wet street ---------------------------------------------------------------------------------------------
vec3 shadeStreet(vec3 p, vec3 rd, float t, float pix, int steps) {
  vec3 haze = hazeColor();
  float ax = abs(p.x);
  bool road = ax < KERB || ax > HALF + 0.5;
  // Puddles (mirrors), the rest rough and darker.
  float zt = mod(p.z, CELL * ROWS);
  float puddle = smoothstep(0.42, 0.6, tfbm(vec2(p.x, zt) * 0.15, 1080.0, 3));
  if (!road) puddle *= 0.4;
  // A gentle wobble tilts the mirror; two looks into it, tilted along the avenue either way, smear its lights up
  // and down as wet asphalt does (more where it's rough than in the puddles).
  vec2 g = vec2(tnoise(vec2(p.x * 0.6, zt * 0.5), 3600.0), tnoise(vec2(p.x * 0.5, zt * 1.6) + 17.0, 11520.0)) - 0.5;
  float wobble = mix(0.02, 0.008, puddle) * (1.0 - smoothstep(40.0, 250.0, t));
  float spread = mix(0.022, 0.007, puddle);
  vec3 n = vec3(g.x * wobble, 1.0, g.y * wobble);
  // Rain rings near the lens: a drop in each cell, at its own moment, its ring spreading and fading.
  float rainAmt = rain * (0.4 + 1.2 * sHigh);
  if (t < 45.0 && rainAmt > 0.0) {
    vec2 rp = vec2(p.x, zt) / 0.8;
    for (int k = 0; k < 2; k++) {
      vec2 c0 = floor(rp + float(k) * 0.5);
      vec2 hh = hash22(mod(c0, vec2(4096.0, 9000.0)) + float(k) * 13.1);
      vec2 dvec = rp + float(k) * 0.5 - c0 - (0.25 + 0.5 * hh);
      float age = fract(ncTime * (0.7 + 0.5 * hh.x) + hh.y);
      float rr = length(dvec);
      float ring = sin((rr - age * 0.45) * 60.0) * exp(-pow((rr - age * 0.45) * 14.0, 2.0)) * (1.0 - age) * (1.0 - age);
      n.xz += normalize(dvec + 1e-4) * ring * 0.07 * min(rainAmt, 1.5) * (1.0 - smoothstep(20.0, 45.0, t));
    }
  }
  float cn = max(-rd.y, 0.0);
  float fres = 0.04 + 0.96 * pow(1.0 - cn, 5.0);
  // (Three looks, a tent across the spread, jittered a little per pixel so they don't show as copies.)
  float j = (hash12(gl_FragCoord.xy) - 0.5) * 0.7;
  vec3 refl = 0.5 * mirrorOf(p, reflect(rd, normalize(n + vec3(0.0, 0.0, spread * j * 0.6))), t, pix, steps)
    + 0.25 * mirrorOf(p, reflect(rd, normalize(n + vec3(0.0, 0.0, spread * (1.0 + j)))), t, pix, steps)
    + 0.25 * mirrorOf(p, reflect(rd, normalize(n - vec3(0.0, 0.0, spread * (1.0 - j)))), t, pix, steps);
  vec3 asphalt = vec3(0.01, 0.01, 0.012) * (0.75 + 0.5 * tnoise(vec2(p.x, zt) * 6.0, 43200.0));
  // Lane markings: faint paint.
  float lane = (1.0 - smoothstep(0.08, 0.12 + t * pix, abs(abs(p.x) - 3.7))) * step(0.5, fract(p.z / 12.0));
  float kerbLine = 1.0 - smoothstep(0.1, 0.16 + t * pix, abs(ax - KERB));
  vec3 lit = haze * 0.3 + spill(p, vec3(0.0, 1.0, 0.0)) * 0.08 + vec3(0.3, 0.2, 0.12) * exp(-max(HALF - ax, 0.0) * 0.6) * 0.2;
  vec3 col = asphalt * (1.0 + lit * 20.0) + vec3(0.25) * (lane + kerbLine * 0.5) * lit;
  float mirror = mix(0.45, 1.0, puddle) * fres;
  return mix(col, refl, mirror);
}

// ---- The air -------------------------------------------------------------------------------------------------
// How much haze between ro and ro + rd t: dense low over the street, thinning upwards (in closed form).
float fogAmount(vec3 ro, vec3 rd, float t) {
  float b = 1.0 / 70.0;
  float k = rd.y * b;
  float f = abs(k) < 1e-5 ? t : (1.0 - exp(-k * t)) / k;
  return 1.0 - exp(-2.2 * hazeDensity() * exp(-ro.y * b) * f);
}
// Searchlights on the roofs ahead, sweeping the cloud: their light in the haze around each beam's axis (the
// nearest approach of the ray to it, and how long the ray runs inside it). They flare on the kicks.
vec3 beams(vec3 ro, vec3 rd, float tEnd) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 h = hash33(vec3(float(i), 2.0, 31.0));
    float zr = mod(h.x * 1200.0 - camPos.z, 1200.0) + 120.0;
    float fade = smoothstep(120.0, 300.0, zr) * (1.0 - smoothstep(1000.0, 1320.0, zr));
    vec3 o = vec3((h.y > 0.5 ? 1.0 : -1.0) * (45.0 + 90.0 * h.z), (80.0 + 120.0 * fract(h.x * 3.3)) * height, camPos.z + zr);
    float a = ncTime * (0.2 + 0.25 * h.y) * (h.z > 0.5 ? 1.0 : -1.0) + h.z * 6.28;
    vec3 d = normalize(vec3(sin(a) * 0.55, 1.0, cos(a) * 0.45 - 0.2));
    vec3 w0 = ro - o;
    float b = dot(rd, d);
    float den = max(1.0 - b * b, 1e-4);
    float dd = dot(rd, w0);
    float e = dot(d, w0);
    float tc = clamp((b * e - dd) / den, 0.0, tEnd);
    float sc = max(dot(ro + rd * tc - o, d), 0.0);
    float top = (420.0 - o.y) / d.y;
    vec3 off = ro + rd * tc - (o + d * min(sc, top));
    float width = 1.2 + sc * 0.05;
    float inside = exp(-dot(off, off) / (width * width)) * width / sqrt(den);
    vec3 col = palette == 3 ? vec3(0.5, 1.0, 0.6) : palette == 1 ? vec3(1.0, 0.8, 0.6) : vec3(0.75, 0.85, 1.0);
    sum += col * inside * fade * exp(-sc * 0.0025) * exp(-hazeDensity() * tc * 0.5);
  }
  return sum * hazeDensity() * (0.6 + 0.6 * sLevel + 1.5 * ncFlash);
}

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  if (abs(rd.x) < 1e-5) rd.x = 1e-5;
  if (abs(rd.z) < 1e-5) rd.z = 1e-5;
  float pix = 2.0 * camLens / min(resolution.x, resolution.y);
  int steps = int(mix(40.0, 96.0, quality));
  vec2 lot;
  int part;
  float tmax = 1400.0;
  vec3 beacons = vec3(0.0);
  float tb = traceCity(ro, rd, tmax, steps, pix, lot, part, beacons);
  float tg = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  float tEnd = tb > 0.0 ? tb : min(tg, tmax);
  vec4 sh;
  vec3 glow = signsAlong(ro, rd, tEnd, int(mix(16.0, 36.0, quality)), 1.0, sh);
  glow += trafficAlong(ro, rd, min(tEnd, sh.x), 1.0, pix);
  vec3 col;
  float t;
  if (sh.x < tEnd) {
    t = sh.x;
    col = shadeSign(ro + rd * t, rd, t, sh.y, sh.z, pix);
  } else if (tb > 0.0) {
    t = tb;
    col = shadeTower(ro + rd * t, rd, t, lot, part, pix, false);
    // The supertalls go up into the cloud.
    col = mix(col, sky(ro, rd), smoothstep(370.0, 470.0, ro.y + rd.y * t));
  } else if (tg < tmax) {
    t = tg;
    col = shadeStreet(ro + rd * t, rd, t, pix, int(mix(16.0, 40.0, quality)));
  } else {
    t = tmax;
    col = sky(ro, rd);
  }
  // Haze: thick low down, glowing with the city; then the signs' light gathered through it.
  vec3 haze = fogColor(rd);
  float fog = fogAmount(ro, rd, t);
  col = mix(col, haze, fog) + glow + beams(ro, rd, t) + beacons;
  // Rain: streaks falling past the lens, two layers; lit by what glows behind them.
  float rainAmt = rain * (0.4 + 1.2 * sHigh);
  if (rainAmt > 0.0) {
    float s2 = 0.0;
    for (int l = 0; l < 2; l++) {
      float fl = float(l);
      vec2 q = vec2((uv.x + uv.y * 0.06) * ratio * (180.0 + fl * 120.0), uv.y * (4.0 + fl * 2.5) + ncTime * (9.0 + fl * 5.0));
      float c = floor(q.x);
      float on = step(0.88, hash12(vec2(c, fl + floor(q.y + hash12(vec2(c, 7.0 + fl)) * 9.0))));
      float y = fract(q.y + hash12(vec2(c, 3.0 + fl)) * 9.0);
      float x = abs(fract(q.x) - 0.5);
      s2 += on * smoothstep(0.0, 0.2, y) * (1.0 - smoothstep(0.2, 0.6, y)) * smoothstep(0.4, 0.0, x) * (0.7 - fl * 0.3);
    }
    col += (vec3(0.012, 0.013, 0.017) + hazeColor() * 1.5 + glow * 1.5) * s2 * rainAmt;
  }
  return col;
}
`,
  init: () => ({
    time: 0,
    z: 40,
    speed: 18,
    x: 0,
    vx: 0,
    tx: 0,
    y: 6,
    vy: 0,
    ty: 6,
    roll: 0,
    sinceWeave: 0,
    weaves: 0,
    flash: 0,
    energy: 0,
    cloud: 0,
    rng: { seed: 0xc1757 },
  }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    const tall = Math.max(0.5, num(frame.values, "height", 1));
    s.time += dt;
    s.energy = smoothTo(s.energy, a.level, frame.dt, 3);
    s.speed = smoothTo(s.speed, 12 + 26 * a.bass + 14 * a.punch, frame.dt, 0.6);
    s.z = wrap(s.z + s.speed * dt, 0, PERIOD);
    s.cloud = wrap(s.cloud + (s.speed + 3) * dt, 0, CLOUD_PERIOD);
    s.sinceWeave += dt;
    if (a.onBeat) {
      s.flash = Math.max(s.flash, 0.6 + 0.4 * clamp01(frame.hit));
      // A hit picks the next weave once the last has mostly played out.
      if (s.sinceWeave > 2.2) {
        s.sinceWeave = 0;
        s.weaves += 1;
        const others = LANES.filter((l) => Math.abs(l - s.tx) > 1);
        s.tx = others[Math.floor(random(s.rng) * others.length)];
        // Every few weaves, a new height: just over the street, among the signs, or up among the tops (loud
        // passages climb).
        if (s.weaves % 2 === 1) {
          const pick = random(s.rng) + 0.35 * s.energy;
          s.ty = pick < 0.4 ? 4 + 3 * random(s.rng) : pick < 0.85 ? 16 + 14 * random(s.rng) : (45 + 45 * random(s.rng)) * tall;
        }
      }
    }
    s.flash = Math.max(0, s.flash - frame.dt * 3.5);
    [s.x, s.vx] = spring(s.x, s.vx, s.tx, 1.3, dt);
    [s.y, s.vy] = spring(s.y, s.vy, s.ty, 0.7, dt);
    // Bank into the weave.
    s.roll = smoothTo(s.roll, Math.max(-0.06, Math.min(0.06, -s.vx * 0.014)), frame.dt, 0.25);
  },
  uniforms(s, frame) {
    const pos: Vec3 = [s.x, s.y, s.z];
    // Looking ahead down the avenue, into the weave, nearly level (so the towers stand upright): a touch up when low, a
    // touch down when high.
    const lift = clamp01((s.y - 6) / 60);
    const target: Vec3 = [s.x + s.vx * 1.2, s.y + 3.5 - 9 * lift + s.vy * 0.15, s.z + 60];
    return [
      ...cameraUniforms(pos, target, s.roll, 50),
      ...soundUniforms(frame),
      float("ncTime", s.time),
      float("ncFlash", s.flash),
      float("ncCloud", s.cloud),
    ];
  },
};
