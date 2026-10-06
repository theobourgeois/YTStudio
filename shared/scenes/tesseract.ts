/**
 * Tesseract (vaudio's Tesseract Vault): a 24-cell and a tesseract turning through all six planes of
 * 4-space, a lattice of smaller ones turning with them. What's stepped: the six angles and their rates
 * (each hit hands the spin to another W-plane and fires a shockwave out through the lattice), the hero's
 * size, the camera's orbit and lens. The rest is drawn from these (`src/scenes/tesseract.ts`).
 */
import type { SceneSpec } from "./index.ts";
import { clamp01, heard, num, r5, sceneDt, smoothTo } from "./kit.ts";

const SHOCKWAVES = 5;

export interface TesseractState {
  time: number;
  angles: number[];
  rates: number[];
  shockwaves: number[];
  heroScale: number;
  orbit: number;
  fov: number;
  /** How far the drifting motes have moved (up), for the renderer's wrap. */
  drift: number;
}

export const TESSERACT: SceneSpec<TesseractState> = {
  type: "tesseract",
  build: (values) => ({ detail: Math.round(clamp01(num(values, "detail", 0.7)) * 20) / 20 }),
  init: () => ({ time: 0, angles: [0, 0, 0, 0, 0, 0], rates: [0.12, 0.08, 0.05, 0.34, 0.22, 0.17], shockwaves: [], heroScale: 7, orbit: 0, fov: 58, drift: 0 }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    s.time += dt;
    if (a.onBeat) {
      // Each hit hands the energy to another W-plane: it stops turning one impossible way and starts another.
      const dominant = 3 + (a.beatCount % 3);
      for (let p = 3; p < 6; p++) s.rates[p] = p === dominant ? 0.55 + a.bass * 1.3 : 0.06;
      s.rates[0] = 0.1 + a.high * 0.35;
      if (s.shockwaves.length < SHOCKWAVES) s.shockwaves.push(0);
    }
    for (let i = s.shockwaves.length - 1; i >= 0; i--) {
      s.shockwaves[i] += dt * (44 + a.level * 40);
      if (s.shockwaves[i] > 130) s.shockwaves.splice(i, 1);
    }
    const spin = 1 + a.punch * 1.4;
    for (let p = 0; p < 6; p++) s.angles[p] += s.rates[p] * spin * dt;
    const beat = a.beat * a.beat;
    s.heroScale = smoothTo(s.heroScale, 8 + a.bass * 2.4 + beat * 1.5, dt, 0.2);
    s.orbit += dt * (0.14 + a.level * 0.16);
    s.fov = smoothTo(s.fov, 62 + beat * 6, dt, 0.16);
    s.drift += dt * 0.3;
  },
  view: (s, frame) => ({
    time: r5(s.time),
    angles: s.angles.map(r5),
    shockwaves: s.shockwaves.map(r5),
    heroScale: r5(s.heroScale),
    orbit: r5(s.orbit),
    fov: r5(s.fov),
    drift: r5(s.drift),
    ...heard(frame),
  }),
};
