/** The light filters' CPU references (`../../effects/filters/light.ts`), mirrored by `render/filters/light.ts`. */
import { addLight } from "../../effects/glow.ts";
import { type KernelReference, type Pixel, dec3, hexEncoded, mix, rotate, smoothstep, vnoise } from "../kernel.ts";

/**
 * One leak's light (before Intensity): distance in from its edge (warped by Wobble's noise) through a falloff,
 * held to the stretch of edge it comes from, broken into lobes along it; the core colour where it's strongest.
 */
function leak(x: number, y: number, angle: number, seed: number, l: { cx: number; cy: number; hx: number; hy: number; diag: number; reach: number; wobble: number; core: number[]; outer: number[] }): [number, number, number] {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const edge = Math.abs(ux) * l.hx + Math.abs(uy) * l.hy;
  const dx = x - l.cx;
  const dy = y - l.cy;
  const along = edge - (dx * ux + dy * uy);
  const lat = -dx * uy + dy * ux;
  // Tongues of light reaching in by different depths along the edge, and wisps: noise on coordinates turned off the
  // frame's axes, so value noise's lattice doesn't show.
  const tongue = vnoise(lat / l.reach * 1.1 + 3.1, (seed % 64) * 5.7 + 0.5, seed) - 0.5;
  const [rx, ry] = rotate(x / l.reach, y / l.reach, 0.7);
  const wisp = vnoise(rx * 2.6 + 5.3, ry * 2.6 + 1.9, (seed + 1) >>> 0) - 0.5;
  const t = Math.max(0, along + (tongue * 1.4 + wisp * 0.6) * l.wobble * l.reach) / l.reach;
  const fall = Math.exp(-4 * t * t) * 0.85 + Math.exp(-2.5 * t) * 0.15;
  const across = lat / (0.42 * l.diag);
  const span = Math.exp(-across * across);
  const lobe = vnoise(lat / l.reach * 2.3 + 7.7, (seed % 64) * 3.1 + 0.5, (seed + 2) >>> 0);
  const shape = fall * span * mix(1, 0.25 + 1.1 * lobe, l.wobble);
  const h = smoothstep(0.25, 0.95, shape);
  return [mix(l.outer[0], l.core[0], h) * shape, mix(l.outer[1], l.core[1], h) * shape, mix(l.outer[2], l.core[2], h) * shape];
}

/** Light Leak: one leak (or two, from opposite edges) added in linear light; coverage at least the light's. */
const lightLeak: KernelReference = (p, canvas) => {
  const angle = ((p.angle as number) * Math.PI) / 180;
  const gain = Math.pow(2, p.intensity as number);
  const seed = (p.seed as number) >>> 0;
  const two = !!p.double;
  const diag = Math.hypot(canvas.width, canvas.height);
  const l = {
    cx: canvas.width / 2,
    cy: canvas.height / 2,
    hx: canvas.width / 2,
    hy: canvas.height / 2,
    diag,
    reach: ((p.spread as number) / 100) * diag,
    wobble: (p.wobble as number) / 100,
    core: dec3(hexEncoded(p.colour as string)),
    outer: dec3(hexEncoded(p.colour2 as string)),
  };
  return ([x, y], c) => {
    let light = leak(x, y, angle, seed, l);
    if (two) {
      const other = leak(x, y, angle + Math.PI, (seed + 97) >>> 0, l);
      light = [light[0] + other[0] * 0.7, light[1] + other[1] * 0.7, light[2] + other[2] * 0.7];
    }
    return addLight(c, [light[0] * gain, light[1] * gain, light[2] * gain]) as Pixel;
  };
};

export const LIGHT_REFERENCES: Record<string, KernelReference> = { "light-leak": lightLeak };
