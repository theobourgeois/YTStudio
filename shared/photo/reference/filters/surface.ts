/** The surface filters' CPU references (`../../effects/filters/surface.ts`), mirrored by `render/filters/surface.ts`. */
import { addLight } from "../../effects/glow.ts";
import { gradientTable } from "../../style/gradients.ts";
import type { Gradient } from "../../types.ts";
import { type KernelEnv, type KernelReference, type Pixel, clamp, dec, enc, enc3, fromEncoded, luma, mix, premul, rand, smoothstep, tableAt, unpremul, dec3 } from "../kernel.ts";

/** A read held inside the canvas when the point is (grown to take it in), so the canvas's edge is no slope. */
const held = (v: number, at: number, size: number) => clamp(v, Math.min(at, 0.5), Math.max(at, size - 0.5));

/** A sample's height: its encoded brightness over its coverage, so a cut-out's outline is a slope too. */
const height = (s: Pixel) => s[3] * enc(luma(unpremul(s)));

/**
 * The surface at `p`: its height smoothed over a disc of `r` (the point, eight reads at half the radius and twelve at
 * it) and its slope from the same reads, as the height's change across `r`: [height, slope x, slope y].
 */
function surface(p: readonly [number, number], c: Pixel, r: number, env: KernelEnv): [number, number, number] {
  const [x, y] = p;
  const { width, height: tall } = env.canvas;
  let sum = height(c);
  let ix = 0;
  let iy = 0;
  let ox = 0;
  let oy = 0;
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) * Math.PI) / 4;
    const h = height(env.src(held(x + Math.cos(a) * r * 0.5, x, width), held(y + Math.sin(a) * r * 0.5, y, tall)));
    sum += h;
    ix += h * Math.cos(a);
    iy += h * Math.sin(a);
  }
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    const h = height(env.src(held(x + Math.cos(a) * r, x, width), held(y + Math.sin(a) * r, y, tall)));
    sum += h;
    ox += h * Math.cos(a);
    oy += h * Math.sin(a);
  }
  // A plane's change across r, from either ring (Σcos² is 4 on the inner, 6 on the outer), averaged.
  return [sum / 21, 0.5 * (ox / 6 + ix / 2), 0.5 * (oy / 6 + iy / 2)];
}

/** The light's elevation above the picture (the relief's shading). */
const ELEVATION = (40 * Math.PI) / 180;

/**
 * Chrome: the smoothed height rises through Reflections bands (a raised cosine), moved and shaded by the slope's
 * light from Angle, its edges hardened by Contrast, the result's colour read from the Environment gradient.
 */
const chrome: KernelReference = (p) => {
  const r = p.smoothness as number;
  const bands = p.reflections as number;
  const depth = 4 * ((p.relief as number) / 100);
  const angle = ((p.angle as number) * Math.PI) / 180;
  const L = [Math.cos(angle) * Math.cos(ELEVATION), Math.sin(angle) * Math.cos(ELEVATION), Math.sin(ELEVATION)];
  const contrast = (p.contrast as number) / 100;
  const table = gradientTable(p.environment as Gradient);
  return (q, c, env) => {
    if (!(c[3] > 0)) return c;
    const [h, sx, sy] = surface(q, c, r, env);
    const nx = -sx * depth;
    const ny = -sy * depth;
    const shade = (nx * L[0] + ny * L[1] + L[2]) / Math.hypot(nx, ny, 1) - L[2];
    let v = 0.5 - 0.5 * Math.cos(2 * Math.PI * bands * (h + 0.35 * shade));
    v = clamp(v + 0.5 * shade);
    const s1 = v * v * (3 - 2 * v);
    v = mix(v, s1 * s1 * (3 - 2 * s1), contrast);
    const g = tableAt(table, v);
    const rgb = unpremul(c);
    const to = dec3([g[0], g[1], g[2]]);
    return premul([mix(rgb[0], to[0], g[3]), mix(rgb[1], to[1], g[3]), mix(rgb[2], to[2], g[3])], c[3]);
  };
};

/** Holographic Foil's palettes: a cosine palette each, a + b cos(2π(t + d)), encoded. */
export const HOLO_PALETTES: Record<string, { a: number[]; b: number[]; d: number[] }> = {
  rainbow: { a: [0.55, 0.55, 0.55], b: [0.45, 0.45, 0.45], d: [0, 0.33, 0.67] },
  pastel: { a: [0.8, 0.76, 0.84], b: [0.2, 0.24, 0.16], d: [0, 0.3, 0.62] },
  oil: { a: [0.36, 0.32, 0.42], b: [0.42, 0.4, 0.44], d: [0.62, 0.86, 0.1] },
};

/**
 * Holographic Foil: a hue phase from the sheen across the canvas (Bands along Angle), the encoded brightness (Tone)
 * and the slope along the sheen (Relief); the foil is its palette's colour, overlaid and screened on the picture (Over)
 * or the picture's lightness in it (Foil), on encoded colour. Glitter flakes (diamonds in document cells, seeded) are
 * light added in linear light.
 */
const holographic: KernelReference = (p, canvas) => {
  const foil = p.mode === "foil";
  const pal = HOLO_PALETTES[p.palette as string] ?? HOLO_PALETTES.rainbow;
  const amount = (p.amount as number) / 100;
  const angle = ((p.angle as number) * Math.PI) / 180;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const bands = p.bands as number;
  const tone = (p.tone as number) / 100;
  const relief = (p.relief as number) / 100;
  const radius = p.radius as number;
  const sparkle = (p.sparkle as number) / 100;
  const size = p.size as number;
  const seed = (p.seed as number) >>> 0;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const diag = Math.hypot(canvas.width, canvas.height);
  return (q, c, env) => {
    if (!(c[3] > 0)) return c;
    const [x, y] = q;
    const rgb = unpremul(c);
    const e = enc3(rgb);
    const l = enc(luma(rgb));
    let sx = 0;
    let sy = 0;
    if (relief > 0) [, sx, sy] = surface(q, c, radius, env);
    const phase = (bands * ((x - cx) * ux + (y - cy) * uy)) / diag + tone * l + 1.5 * relief * (sx * ux + sy * uy);
    const f = [0, 1, 2].map((i) => clamp(pal.a[i] + pal.b[i] * Math.cos(2 * Math.PI * (phase + pal.d[i]))));
    const v = [0, 1, 2].map((i) => {
      let o: number;
      if (foil) o = clamp(f[i] * (0.3 + 0.95 * l) + 0.25 * l * l);
      else {
        const over = e[i] < 0.5 ? 2 * e[i] * f[i] : 1 - 2 * (1 - e[i]) * (1 - f[i]);
        const screen = 1 - (1 - e[i]) * (1 - f[i]);
        o = 0.5 * (over + screen);
      }
      return mix(e[i], o, amount);
    });
    const out = fromEncoded(v, c[3]);
    if (!(sparkle > 0)) return out;
    const ix = Math.floor(x / size);
    const iy = Math.floor(y / size);
    const flash = smoothstep(1 - 0.12 * sparkle, 1, rand(ix, iy, seed));
    if (!(flash > 0)) return out;
    // A diamond flake in its cell, its edge smoothed over a pixel evaluated.
    const fx = x / size - ix - 0.5;
    const fy = y / size - iy - 0.5;
    const mask = clamp(((0.5 - Math.abs(fx) - Math.abs(fy)) * size) / env.px + 0.5);
    const twinkle = 0.5 + 0.5 * Math.cos(2 * Math.PI * (2 * phase + rand(ix, iy, (seed + 1) >>> 0)));
    const b = 4 * sparkle * flash * mask * (0.25 + 0.75 * twinkle) * c[3];
    return addLight(out, [b * (0.5 + 0.5 * dec(f[0])), b * (0.5 + 0.5 * dec(f[1])), b * (0.5 + 0.5 * dec(f[2]))]) as Pixel;
  };
};

export const SURFACE_REFERENCES: Record<string, KernelReference> = { chrome, holographic };
