/**
 * Cathedral (vaudio's): a flight down an endless nave of chrome arches, moths circling, light shafts
 * raking the columns. What's stepped: how far it's flown and how fast, the camera's roll and lens, the
 * pulses each hit sends down the nave, and every moth's orbit (a hit scatters them, seeded). Drawn by
 * `src/scenes/cathedral.ts`.
 */
import type { SceneSpec } from "./index.ts";
import { clamp01, heard, num, r5, random, sceneDt, smoothTo, wrap } from "./kit.ts";

export const ARCHES = 26;
export const ARCH_SPACING = 7.6;
export const SPAN = ARCHES * ARCH_SPACING;
/** How far past the camera geometry travels before it recycles to the back. */
export const AHEAD = 12;
export const MOTHS = 160;

/** What doesn't change about a moth. */
export interface MothShape {
  angleRate: number;
  speed: number;
  hover: number;
  phase: number;
  size: number;
}

/** The moths' shapes and where they start, from a seed: the state's and the renderer's alike. */
export function mothShapes(): { shapes: MothShape[]; angle: number[]; radius: number[]; z: number[] } {
  const rng = { seed: 0x5eed1337 };
  const shapes: MothShape[] = [];
  const angle: number[] = [];
  const radius: number[] = [];
  const z: number[] = [];
  for (let i = 0; i < MOTHS; i++) {
    radius.push(1.6 + random(rng) * 3);
    angle.push(random(rng) * Math.PI * 2);
    const rate = 0.15 + random(rng) * 0.4;
    const angleRate = rate * (random(rng) < 0.5 ? -1 : 1);
    z.push(-random(rng) * SPAN);
    shapes.push({ angleRate, speed: 3 + random(rng) * 7, hover: -1 + random(rng) * 3, phase: random(rng) * Math.PI * 2, size: 0.17 + random(rng) * 0.26 });
  }
  return { shapes, angle, radius, z };
}

export const liveMoths = (detail: number) => Math.round(48 + clamp01(detail) * (MOTHS - 48));

export interface CathedralState {
  time: number;
  travel: number;
  speed: number;
  roll: number;
  fov: number;
  pulses: number[];
  angle: number[];
  radius: number[];
  radiusTarget: number[];
  z: number[];
  rng: { seed: number };
  detail: number;
}

let shapes: MothShape[] | null = null;

export const CATHEDRAL: SceneSpec<CathedralState> = {
  type: "cathedral",
  build: (values) => ({ detail: Math.round(clamp01(num(values, "detail", 0.7)) * 20) / 20 }),
  init(build) {
    const start = mothShapes();
    shapes = start.shapes;
    return {
      time: 0,
      travel: 0,
      speed: 12,
      roll: 0,
      fov: 58,
      pulses: [],
      angle: start.angle,
      radius: start.radius,
      radiusTarget: [...start.radius],
      z: start.z,
      rng: { seed: 0xca7ed2a1 },
      detail: Number(build.detail),
    };
  },
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    const beat = a.beat * a.beat;
    s.time += dt;
    const t = s.time;
    s.speed = smoothTo(s.speed, 10 + a.punch * 18 + a.level * 6, dt, 0.35);
    s.travel += s.speed * dt;
    if (a.onBeat) {
      if (s.pulses.length < 6) s.pulses.push(SPAN * 0.92);
      for (let i = 0; i < MOTHS; i++) s.radiusTarget[i] = 1.4 + random(s.rng) * (3.4 + a.bass * 4);
    }
    for (let i = s.pulses.length - 1; i >= 0; i--) {
      s.pulses[i] -= (108 + a.level * 60) * dt;
      if (s.pulses[i] < -14) s.pulses.splice(i, 1);
    }
    s.roll = smoothTo(s.roll, Math.sin(t * 0.19) * 0.05 + beat * 0.05, dt, 0.4);
    s.fov = smoothTo(s.fov, 57 + beat * 5, dt, 0.18);
    const shape = (shapes ??= mothShapes().shapes);
    for (let i = 0; i < liveMoths(s.detail); i++) {
      s.angle[i] += shape[i].angleRate * dt * (1 + a.high * 1.6);
      s.radius[i] = smoothTo(s.radius[i], s.radiusTarget[i], dt, 0.7);
      s.z[i] = wrap(s.z[i] + (s.speed * 0.55 + shape[i].speed) * dt, AHEAD - SPAN, SPAN);
    }
  },
  view: (s, frame) => {
    const live = liveMoths(s.detail);
    return {
      time: r5(s.time),
      travel: r5(s.travel),
      speed: r5(s.speed),
      roll: r5(s.roll),
      fov: r5(s.fov),
      pulses: s.pulses.map(r5),
      angle: s.angle.slice(0, live).map(r5),
      radius: s.radius.slice(0, live).map(r5),
      z: s.z.slice(0, live).map(r5),
      ...heard(frame),
    };
  },
};
