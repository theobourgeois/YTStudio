/** The edge filters' CPU references (`../../effects/filters/edges.ts`), mirrored by `render/filters/edges.ts`. */
import { type KernelReference, type Pixel, type Rgb, clamp, dec3, enc, enc3, fract, fromEncoded, hexEncoded, luma, rand, smoothstep, unpremul } from "../kernel.ts";

/** Rec. 709's weights, used on encoded colour as a stylised brightness. */
const W = [0.2126, 0.7152, 0.0722] as const;
const dot = (v: readonly number[]) => W[0] * v[0] + W[1] * v[1] + W[2] * v[2];
/**
 * A read at `q` (one axis) kept within the canvas's edge pixels as evaluated (`px` document pixels each), unless `p`
 * is off it: never farther from `p` than `q`.
 */
const onCanvas = (q: number, p: number, size: number, px: number) => clamp(q, Math.min(p, 0.5 * px), Math.max(p, size - 0.5 * px));

/** Deep Fry's Crunch as steps per channel (0: no posterising): fewer the higher it is. */
export const crunchLevels = (crunch: number) => (crunch > 0 ? Math.round(2 + 30 * (1 - crunch / 100) ** 2) : 0);

/** Deep Fry's blur taps besides the centre: a ring at half the radius, and one at it. */
const DEEP_FRY_RINGS = { inner: 8, outer: 12 } as const;

/**
 * Deep Fry: an unsharp mask on the encoded colour (the blur a disc of taps, averaged premultiplied), then
 * saturation, a warm cast, contrast, noise and posterising, each clipped to [0, 1].
 */
const deepFry: KernelReference = (p) => {
  const amount = (p.sharpen as number) / 100;
  const r = p.radius as number;
  const saturation = (p.saturation as number) / 100;
  const contrast = 1 + 3 * ((p.contrast as number) / 100);
  const w = (p.warmth as number) / 100;
  const noise = (p.noise as number) / 100;
  const levels = crunchLevels(p.crunch as number);
  return ([x, y], c, env) => {
    if (!(c[3] > 0)) return c;
    const sum = [c[0], c[1], c[2], c[3]];
    const add = (s: Pixel) => {
      for (let k = 0; k < 4; k++) sum[k] += s[k];
    };
    for (let k = 0; k < DEEP_FRY_RINGS.inner; k++) {
      const a = ((k + 0.5) * Math.PI) / 4;
      add(env.src(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5));
    }
    for (let k = 0; k < DEEP_FRY_RINGS.outer; k++) {
      const a = (k * Math.PI) / 6;
      add(env.src(x + Math.cos(a) * r, y + Math.sin(a) * r));
    }
    const b = enc3(unpremul(sum as Pixel));
    let v = enc3(unpremul(c)).map((e, i) => clamp(e + amount * (e - b[i])));
    const l = dot(v);
    v = v.map((e) => clamp(l + (e - l) * saturation));
    v = [clamp(v[0] * (1 + 0.5 * w) + 0.04 * w), clamp(v[1] * (1 + 0.1 * w)), clamp(v[2] * (1 - 0.6 * w))];
    v = v.map((e) => clamp((e - 0.5) * contrast + 0.5));
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    v = v.map((e, i) => clamp(e + (rand(ix, iy, 11 + i) - 0.5) * noise * 0.6));
    if (levels > 0) v = v.map((e) => clamp(Math.floor(e * levels + 0.5) / levels));
    return fromEncoded(v, c[3]);
  };
};

/** A hue (0..1 round the wheel) at full saturation, encoded. */
const hue = (h: number): Rgb => [0, 2 / 3, 1 / 3].map((o) => clamp(Math.abs(fract(h + o) * 6 - 3) - 1)) as Rgb;

/**
 * Neon Edges: a Sobel filter on each sample's encoded brightness (over its coverage, so a cut-out's outline is an
 * edge), its taps `width` apart and kept on the canvas (its border is no edge); lines coloured, then lit on black or
 * the image, or inked on white.
 */
const neonEdges: KernelReference = (p, canvas) => {
  const w = p.width as number;
  const gain = (p.brightness as number) / 100;
  const mode = p.colouring === "tint" ? 1 : p.colouring === "rainbow" ? 2 : 0;
  const background = p.background === "image" ? 1 : p.background === "paper" ? 2 : 0;
  const tint = hexEncoded(p.tint as string);
  return ([x, y], c, env) => {
    const sum = [c[0], c[1], c[2], c[3]];
    let aMax = c[3];
    const lum = (dx: number, dy: number) => {
      const s = env.src(onCanvas(x + dx * w, x, canvas.width, env.px), onCanvas(y + dy * w, y, canvas.height, env.px));
      for (let k = 0; k < 4; k++) sum[k] += s[k];
      aMax = Math.max(aMax, s[3]);
      return s[3] * (0.2 + 0.8 * enc(luma(unpremul(s))));
    };
    const tl = lum(-1, -1);
    const t = lum(0, -1);
    const tr = lum(1, -1);
    const l = lum(-1, 0);
    const r = lum(1, 0);
    const bl = lum(-1, 1);
    const b = lum(0, 1);
    const br = lum(1, 1);
    const gx = tr + 2 * r + br - (tl + 2 * l + bl);
    const gy = bl + 2 * b + br - (tl + 2 * t + tr);
    const e = smoothstep(0.02, 0.2, Math.hypot(gx, gy) / 4) * gain;
    let ink: Rgb = tint;
    if (mode === 0) {
      const v = enc3(unpremul(sum as Pixel));
      const m = Math.max(v[0], v[1], v[2], 0.05);
      const s = v.map((e) => e / m);
      const ls = dot(s);
      ink = s.map((e) => clamp(ls + (e - ls) * 1.5)) as Rgb;
    } else if (mode === 2) {
      ink = hue(Math.atan2(gy, gx) / Math.PI + 1);
    }
    const line = Math.min(e, 1);
    const a = Math.max(c[3], line * aMax);
    if (background === 2) return fromEncoded([0, 1, 2].map((i) => 1 + (ink[i] - 1) * line), a);
    const light = dec3(ink).map((v) => v * e * aMax);
    const keep = background === 1 ? 1 - 0.5 * line : 0;
    return [c[0] * keep + light[0], c[1] * keep + light[1], c[2] * keep + light[2], a];
  };
};

export const EDGES_REFERENCES: Record<string, KernelReference> = { "deep-fry": deepFry, edges: neonEdges };
