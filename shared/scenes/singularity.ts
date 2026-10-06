/**
 * Singularity (vaudio's): a low orbit around a black hole with its light bent for real, a Keplerian disk,
 * jets fired by hits and debris falling in. What's stepped: the camera's orbit, inclination and lens, the
 * jets' power and every shard's orbit (a hit drops three fresh ones in from the outside, at random but
 * seeded, so it's the same every time). Drawn by `src/scenes/singularity.ts`.
 */
import type { SceneSpec } from "./index.ts";
import { clamp01, heard, num, r5, random, sceneDt, smoothTo } from "./kit.ts";

/** Schwarzschild radius, in scene units; everything else is measured in these. */
export const RS = 3;
/** The shadow's apparent radius: sqrt(27)/2 rs, the photon capture cross-section. */
export const SHADOW = 2.598 * RS;
export const DISK_INNER = 3 * RS;
export const DISK_OUTER = 16 * RS;
export const SHARDS = 70;

/** What doesn't change about a shard: its orbit's tilt and line of nodes, its size and tumble. */
export interface ShardShape {
  tilt: number;
  node: number;
  size: number;
  spin: [number, number, number];
}

/** The shards' shapes and where they start, from a seed: the state's and the renderer's alike. */
export function shardShapes(): { shapes: ShardShape[]; radius: number[]; angle: number[] } {
  const rng = { seed: 0x5eed1337 };
  const shapes: ShardShape[] = [];
  const radius: number[] = [];
  const angle: number[] = [];
  for (let i = 0; i < SHARDS; i++) {
    radius.push(DISK_INNER + Math.pow(random(rng), 1.7) * (DISK_OUTER * 1.05 - DISK_INNER));
    angle.push(random(rng) * Math.PI * 2);
    shapes.push({
      tilt: (random(rng) - 0.5) * 0.34,
      node: random(rng) * Math.PI * 2,
      size: 0.12 + random(rng) * 0.34,
      spin: [(random(rng) - 0.5) * 2, (random(rng) - 0.5) * 2, (random(rng) - 0.5) * 2],
    });
  }
  return { shapes, radius, angle };
}

export const liveShards = (detail: number) => Math.round(30 + clamp01(detail) * (SHARDS - 30));

export interface SingularityState {
  time: number;
  orbit: number;
  inclination: number;
  jetPower: number;
  fov: number;
  radius: number[];
  angle: number[];
  rng: { seed: number };
  drift: number;
  detail: number;
}

export const SINGULARITY: SceneSpec<SingularityState> = {
  type: "singularity",
  build: (values) => ({ detail: Math.round(clamp01(num(values, "detail", 0.7)) * 20) / 20 }),
  init(build) {
    const { radius, angle } = shardShapes();
    return { time: 0, orbit: 0, inclination: 0.12, jetPower: 0.25, fov: 58, radius, angle, rng: { seed: 0x0b1ac401 }, drift: 0, detail: Number(build.detail) };
  },
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    const beat = a.beat * a.beat;
    s.time += dt;
    const t = s.time;
    s.orbit += dt * (0.055 + a.level * 0.06);
    s.inclination = smoothTo(s.inclination, 0.1 + Math.sin(t * 0.06) * 0.22, dt, 1.4);
    s.fov = smoothTo(s.fov, 52 + beat * 5, dt, 0.18);
    if (a.onBeat) {
      s.jetPower = 1;
      // Every hit drops a few fresh rocks in from the outside.
      for (let i = 0; i < 3; i++) {
        const k = (a.beatCount * 3 + i) % SHARDS;
        s.radius[k] = DISK_OUTER * (1 + random(s.rng) * 0.25);
        s.angle[k] = random(s.rng) * Math.PI * 2;
      }
    }
    s.jetPower = smoothTo(s.jetPower, 0.22 + a.high * 0.4, dt, 0.45);
    // Keplerian: the closer a shard gets the faster it goes, and the faster it falls.
    for (let i = 0; i < liveShards(s.detail); i++) {
      const r = s.radius[i];
      s.angle[i] += dt * 5.5 * Math.pow(DISK_INNER / Math.max(r, RS), 1.5);
      s.radius[i] = r - dt * (0.7 + 26 / Math.max(r, RS)) * (1 + a.level);
      if (s.radius[i] < SHADOW * 0.85) {
        s.radius[i] = DISK_OUTER * (1 + random(s.rng) * 0.3);
        s.angle[i] = random(s.rng) * Math.PI * 2;
      }
    }
    s.drift += dt * 0.6;
  },
  view: (s, frame) => ({
    time: r5(s.time),
    orbit: r5(s.orbit),
    inclination: r5(s.inclination),
    jetPower: r5(s.jetPower),
    fov: r5(s.fov),
    radius: s.radius.map(r5),
    angle: s.angle.map(r5),
    drift: r5(s.drift),
    ...heard(frame),
  }),
};
