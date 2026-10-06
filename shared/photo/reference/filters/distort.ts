/** The distort filters' CPU references (`../../effects/filters/distort.ts`), mirrored by `render/filters/distort.ts`. */
import { type KernelReference, clamp, vnoise } from "../kernel.ts";

/**
 * Where a displaced read lands: held inside the canvas (grown to take in the point itself, so a read never moves
 * farther from it), so the edges stretch rather than pull transparency in.
 */
const held = (v: number, at: number, size: number) => clamp(v, Math.min(at, 0.5), Math.max(at, size - 0.5));

/** Two octaves of value noise in [0, 1). */
const swirl = (x: number, y: number, seed: number) => (vnoise(x, y, seed) + 0.5 * vnoise(x * 2.03 + 3.7, y * 2.03 + 1.3, (seed + 7) >>> 0)) / 1.5;

/**
 * Wave: Sine moves the read along x by the row's sine (and along y by the column's); Liquid by a domain-warped noise,
 * each axis within ±Amplitude.
 */
const wave: KernelReference = (p, canvas) => {
  const amplitude = p.amplitude as number;
  const liquid = p.type === "liquid";
  const k = (2 * Math.PI) / (p.wavelength as number);
  const rows = p.direction !== "vertical";
  const columns = p.direction !== "horizontal";
  const scale = p.scale as number;
  const seed = (p.seed as number) >>> 0;
  return ([x, y], _c, env) => {
    let dx = 0;
    let dy = 0;
    if (liquid) {
      const qx = x / scale;
      const qy = y / scale;
      const rx = qx + (vnoise(qx, qy, seed) - 0.5) * 2;
      const ry = qy + (vnoise(qx + 5.2, qy + 1.3, seed) - 0.5) * 2;
      dx = (swirl(rx, ry, (seed + 1) >>> 0) * 2 - 1) * amplitude;
      dy = (swirl(rx + 9.1, ry + 2.7, (seed + 2) >>> 0) * 2 - 1) * amplitude;
    } else {
      if (rows) dx = Math.sin(y * k) * amplitude;
      if (columns) dy = Math.sin(x * k) * amplitude;
    }
    return env.src(held(x + dx, x, canvas.width), held(y + dy, y, canvas.height));
  };
};

export const DISTORT_REFERENCES: Record<string, KernelReference> = { wave };
