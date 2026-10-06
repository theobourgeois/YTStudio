/**
 * Leviathan (vaudio's): a sea serpent of 92 vertebrae swimming through the deep, jellyfish pulsing past.
 * A real simulation: its head steers (a wandering wish, kept inside the water and off the lens) and every
 * vertebra follows the one ahead at a fixed distance, so where it is now depends on everywhere it swam. What's
 * stepped: the spine, the heading and speed, the swim's wave, the pulse each hit sends down the body, the
 * jaw, the jellyfish and the camera (which eases after its orbit). Drawn by `src/scenes/leviathan.ts`.
 */
import type { SceneSpec } from "./index.ts";
import { clamp01, follow, heard, num, r5, random, sceneDt, smoothTo } from "./kit.ts";

export const SEGMENTS = 92;
/** Distance between vertebrae: SEGMENTS * SPACING is the creature's length. */
export const SPACING = 0.95;
/** It turns back towards the middle past this far out. */
const BOUND = 46;
/** It turns away from the lens closer than this. */
const CLEARANCE = 13;
export const JELLYFISH = 42;
/** Frames it swims before its clip starts (see `init`). */
const PRE_ROLL = 150;

export interface JellyShape {
  drift: [number, number, number];
  phase: number;
  rate: number;
  hue: number;
  size: number;
  spin: number;
}

/** The jellyfish's shapes and where they start, from a seed: the state's and the renderer's alike. */
export function jellyShapes(): { shapes: JellyShape[]; position: [number, number, number][] } {
  const rng = { seed: 0x5eed1337 };
  const shapes: JellyShape[] = [];
  const position: [number, number, number][] = [];
  for (let i = 0; i < JELLYFISH; i++) {
    position.push([(random(rng) - 0.5) * 70, -22 + random(rng) * 44, (random(rng) - 0.5) * 70]);
    shapes.push({
      drift: [(random(rng) - 0.5) * 0.5, 0.25 + random(rng) * 0.5, (random(rng) - 0.5) * 0.5],
      phase: random(rng) * Math.PI * 2,
      rate: 0.7 + random(rng) * 0.7,
      hue: random(rng),
      size: 0.8 + random(rng) * 2.2,
      spin: (random(rng) - 0.5) * 0.4,
    });
  }
  return { shapes, position };
}

export const liveJellies = (detail: number) => Math.round(12 + clamp01(detail) * (JELLYFISH - 12));

/** Where vertebra `i` is after the swim's wave: `base` bent sideways and up, the tail whipping hardest. */
export function swimBody(base: number[], wave: number, amplitude: number): number[] {
  const out = new Array<number>(SEGMENTS * 3);
  for (let i = 0; i < SEGMENTS; i++) {
    const t = i / (SEGMENTS - 1);
    const a = Math.max(0, i - 1) * 3;
    const b = Math.min(SEGMENTS - 1, i + 1) * 3;
    let tx = base[a] - base[b];
    let ty = base[a + 1] - base[b + 1];
    let tz = base[a + 2] - base[b + 2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    [tx, ty, tz] = [tx / tl, ty / tl, tz / tl];
    // side = up × tangent, up' = tangent × side
    let sx = tz;
    let sy = 0;
    let sz = -tx;
    const sl = Math.hypot(sx, sz) || 1;
    [sx, sy, sz] = [sx / sl, sy / sl, sz / sl];
    const ux = ty * sz - tz * sy;
    const uy = tz * sx - tx * sz;
    const uz = tx * sy - ty * sx;
    const swing = Math.sin(i * 0.185 - wave) * amplitude * Math.pow(t, 0.75);
    const lift = Math.cos(i * 0.185 - wave + 1.1) * amplitude * 0.3 * t;
    out[i * 3] = base[i * 3] + sx * swing + ux * lift;
    out[i * 3 + 1] = base[i * 3 + 1] + sy * swing + uy * lift;
    out[i * 3 + 2] = base[i * 3 + 2] + sz * swing + uz * lift;
  }
  return out;
}

export interface LeviathanState {
  time: number;
  /** The spine's vertebrae (x, y, z each), head first. */
  base: number[];
  heading: [number, number, number];
  swimSpeed: number;
  wave: number;
  /** Head-to-tail position of the glowing pulse, in segments. */
  pulse: number;
  jawOpen: number;
  orbit: number;
  camera: [number, number, number];
  look: [number, number, number];
  fov: number;
  jellies: [number, number, number][];
  snow: [number, number, number];
  detail: number;
}

let shapes: JellyShape[] | null = null;

const amplitudeOf = (punch: number, level: number) => 0.85 + punch * 1.5 + level * 0.5;

export const LEVIATHAN: SceneSpec<LeviathanState> = {
  type: "leviathan",
  build: (values) => ({ detail: Math.round(clamp01(num(values, "detail", 0.7)) * 20) / 20 }),
  init(build) {
    const start = jellyShapes();
    shapes = start.shapes;
    const base: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) base.push(0, 0, -i * SPACING);
    const state: LeviathanState = {
      time: 0,
      base,
      heading: [0, 0, -1],
      swimSpeed: 9,
      wave: 0,
      pulse: SEGMENTS * 2,
      jawOpen: 0,
      orbit: 0,
      camera: [15, 3, 0],
      look: [0, 0, -20],
      fov: 58,
      jellies: start.position,
      snow: [0, 0, 0],
      detail: Number(build.detail),
    };
    // It swims a few seconds in silence first, so it starts uncoiled and in front of the camera (which
    // would otherwise start inside it), as vaudio's had always been running by the time it was seen.
    const quiet = { frame: 0, time: 0, dt: 1 / 30, values: {}, level: 0, bass: 0, mid: 0, high: 0, hit: 0, bands: [], follow: follow.init() };
    for (let k = 0; k < PRE_ROLL; k++) LEVIATHAN.step(state, quiet);
    return state;
  },
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    const beat = a.beat * a.beat;
    s.time += dt;
    const t = s.time;
    // Wander: a slow heading target, back towards the middle and away from the lens, folded in gently.
    let wx = Math.sin(t * 0.21) + Math.sin(t * 0.53 + 1.7) * 0.6;
    let wy = Math.sin(t * 0.17 + 2.2) * 0.55;
    let wz = Math.cos(t * 0.24 + 0.9) + Math.cos(t * 0.47) * 0.6;
    const [hx, hy, hz] = [s.base[0], s.base[1], s.base[2]];
    const distance = Math.hypot(hx, hy, hz);
    if (distance > BOUND) {
      const k = ((distance - BOUND) * 0.35) / distance;
      wx -= hx * k;
      wy -= hy * k;
      wz -= hz * k;
    }
    const [dx, dy, dz] = [hx - s.camera[0], hy - s.camera[1], hz - s.camera[2]];
    const lens = Math.hypot(dx, dy, dz);
    if (lens < CLEARANCE) {
      const k = ((CLEARANCE - lens) * 0.6) / Math.max(lens, 0.001);
      wx += dx * k;
      wy += dy * k;
      wz += dz * k;
    }
    const wl = Math.hypot(wx, wy, wz) || 1;
    const turn = 1 - Math.exp(-dt * 1.4);
    let [px, py, pz] = s.heading;
    px += (wx / wl - px) * turn;
    py += (wy / wl - py) * turn;
    pz += (wz / wl - pz) * turn;
    const pl = Math.hypot(px, py, pz) || 1;
    s.heading = [px / pl, py / pl, pz / pl];
    s.swimSpeed = smoothTo(s.swimSpeed, 7 + a.punch * 16 + a.level * 7, dt, 0.5);
    s.base[0] += s.heading[0] * s.swimSpeed * dt;
    s.base[1] += s.heading[1] * s.swimSpeed * dt;
    s.base[2] += s.heading[2] * s.swimSpeed * dt;
    // Follow the leader: each vertebra is dragged to a fixed distance from the one ahead.
    for (let i = 1; i < SEGMENTS; i++) {
      const o = i * 3;
      const sx = s.base[o] - s.base[o - 3];
      const sy = s.base[o + 1] - s.base[o - 2];
      const sz = s.base[o + 2] - s.base[o - 1];
      const k = SPACING / (Math.hypot(sx, sy, sz) || 1e-4);
      s.base[o] = s.base[o - 3] + sx * k;
      s.base[o + 1] = s.base[o - 2] + sy * k;
      s.base[o + 2] = s.base[o - 1] + sz * k;
    }
    s.wave += dt * (2.1 + a.punch * 3.4 + a.level * 1.6);
    if (a.onBeat) {
      s.pulse = -4;
      s.jawOpen = 1;
    }
    s.pulse += dt * (52 + a.level * 60);
    s.jawOpen = smoothTo(s.jawOpen, 0, dt, 0.25);
    // Jellyfish jet on the contraction and coast on the recovery.
    const shape = (shapes ??= jellyShapes().shapes);
    for (let i = 0; i < liveJellies(s.detail); i++) {
      const j = shape[i];
      const phase = t * j.rate * (1 + a.level * 0.8) + j.phase;
      const thrust = 1 + Math.pow(Math.max(0, Math.sin(phase)), 3) * 2.2 + beat * 1.5;
      const p = s.jellies[i];
      p[0] += j.drift[0] * dt * thrust;
      p[1] += j.drift[1] * dt * thrust;
      p[2] += j.drift[2] * dt * thrust;
      if (p[1] > 30) p[1] = -26;
    }
    // The camera eases after a slow orbit, its eye after a point a third of the way down the body.
    s.orbit += dt * 0.07;
    const ease = 1 - Math.exp(-dt * 1.2);
    const origin = [Math.cos(s.orbit) * 15, Math.sin(t * 0.2) * 4 + 3, Math.sin(s.orbit) * 15];
    for (let k = 0; k < 3; k++) s.camera[k] += (origin[k] - s.camera[k]) * ease;
    const body = swimBody(s.base, s.wave, amplitudeOf(a.punch, a.level));
    const target = [body[45] + Math.sin(t * 0.31) * 5, body[46] + Math.sin(t * 0.23 + 1.1) * 0.7 * 5, body[47] + Math.cos(t * 0.27) * 5];
    const follow = 1 - Math.exp(-dt * 1.3);
    for (let k = 0; k < 3; k++) s.look[k] += (target[k] - s.look[k]) * follow;
    s.fov = smoothTo(s.fov, 60 + beat * 4, dt, 0.2);
    const sway = 0.3 + Math.sin(t * 0.2) * 0.2;
    s.snow = [s.snow[0] + sway * dt, s.snow[1] - 0.85 * dt, s.snow[2] + 0.15 * dt];
  },
  view: (s, frame) => {
    const f = frame.follow;
    const body = swimBody(s.base, s.wave, amplitudeOf(f.punch, f.level));
    return {
      time: r5(s.time),
      body: body.map(r5),
      wave: r5(s.wave),
      pulse: r5(s.pulse),
      jawOpen: r5(s.jawOpen),
      camera: s.camera.map(r5),
      look: s.look.map(r5),
      fov: r5(s.fov),
      jellies: s.jellies.slice(0, liveJellies(s.detail)).map((p) => p.map(r5)),
      snow: s.snow.map(r5),
      ...heard(frame),
    };
  },
};
