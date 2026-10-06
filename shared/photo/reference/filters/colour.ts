/** The colour filters' CPU references (`../../effects/filters/colour.ts`), mirrored by `render/filters/colour.ts`. */
import { gradientTable } from "../../style/gradients.ts";
import type { Gradient } from "../../types.ts";
import { type KernelReference, clamp, dec3, enc, enc3, fromEncoded, hexEncoded, luma, mix, premul, smoothstep, tableAt, unpremul } from "../kernel.ts";

/** Gradient Map: the encoded luminance picks the gradient's colour; its opacity mixes it over the pixel's own. */
const gradientMap: KernelReference = (p) => {
  const table = gradientTable(p.gradient as Gradient, p.reverse as boolean);
  return (_p, c) => {
    if (!(c[3] > 0)) return c;
    const rgb = unpremul(c);
    const g = tableAt(table, enc(luma(rgb)));
    const to = dec3([g[0], g[1], g[2]]);
    return premul([mix(rgb[0], to[0], g[3]), mix(rgb[1], to[1], g[3]), mix(rgb[2], to[2], g[3])], c[3]);
  };
};

/** Soft light (Pegtop's: smooth, and 0.5 leaves the base as it is) of a tint `b` on a base `a`, both encoded. */
const softLight = (a: number, b: number) => (1 - 2 * b) * a * a + 2 * b * a;

/**
 * Color Grade, on encoded straight colour: temperature, saturation (around Rec. 709 weights of the encoded colour),
 * contrast, split toning (each tint soft-lit by how dark or bright the pixel is, the crossover moved by Balance), fade.
 */
const colorGrade: KernelReference = (p) => {
  const warm = ((p.temperature as number) / 100) * 0.12;
  const saturation = 1 + (p.saturation as number) / 100;
  const contrast = (p.contrast as number) / 100;
  const shadows = hexEncoded(p.shadows as string);
  const highlights = hexEncoded(p.highlights as string);
  const pivot = 0.5 - 0.4 * ((p.balance as number) / 100);
  const toning = (p.toning as number) / 100;
  const fade = (p.fade as number) / 100;
  return (_p, c) => {
    if (!(c[3] > 0)) return c;
    const e = enc3(unpremul(c));
    let v = [clamp(e[0] * (1 + warm)), e[1], clamp(e[2] * (1 - warm))];
    const y = luma(v);
    v = v.map((x) => clamp(y + (x - y) * saturation));
    v = contrast > 0 ? v.map((x) => mix(x, x * x * (3 - 2 * x), contrast)) : v.map((x) => mix(x, 0.5, -contrast * 0.5));
    // Brightness with the crossover moved to ½, then how much of each tint it takes.
    const l = luma(v);
    const q = l < pivot ? (0.5 * l) / pivot : 0.5 + (0.5 * (l - pivot)) / (1 - pivot);
    const h = smoothstep(0, 1, q);
    const ws = (1 - h) * toning;
    const wh = h * toning;
    v = v.map((x, i) => mix(x, softLight(x, shadows[i]), ws));
    v = v.map((x, i) => mix(x, softLight(x, highlights[i]), wh));
    v = v.map((x) => mix(x, 0.1 + 0.82 * x, fade));
    return fromEncoded(v, c[3]);
  };
};

/** Posterize: each encoded channel rounded to `levels`, the step at each half-way softened over Smooth of a step. */
const posterize: KernelReference = (p) => {
  const steps = (p.levels as number) - 1;
  const width = Math.max((p.smooth as number) / 100, 1e-3);
  const level = (x: number) => {
    const t = x * steps;
    const i = Math.floor(t);
    return (i + smoothstep(0.5 - width / 2, 0.5 + width / 2, t - i)) / steps;
  };
  return (_p, c) => {
    if (!(c[3] > 0)) return c;
    return fromEncoded(enc3(unpremul(c)).map(level), c[3]);
  };
};

/**
 * Psychedelic, on encoded straight colour: grey midtones given red (Rainbow), the chroma turned about the grey axis
 * (Rodrigues) by Shift plus Cycles turns of the encoded luminance, saturated around the grey, then solarised.
 */
const psychedelic: KernelReference = (p) => {
  const shift = ((p.shift as number) * Math.PI) / 180;
  const turns = (p.cycles as number) * 2 * Math.PI;
  const rainbow = (p.rainbow as number) / 100;
  const saturation = (p.saturation as number) / 100;
  const solarize = (p.solarize as number) / 100;
  const k = 1 / Math.sqrt(3);
  return (_p, c) => {
    if (!(c[3] > 0)) return c;
    const rgb = unpremul(c);
    const e = enc3(rgb);
    const l = enc(luma(rgb));
    const add = rainbow * Math.min(l, 1 - l);
    const v = [e[0] + (add * 2) / 3, e[1] - add / 3, e[2] - add / 3];
    const angle = shift + turns * l;
    const cs = Math.cos(angle);
    const sn = Math.sin(angle);
    const m = (v[0] + v[1] + v[2]) / 3;
    const cross = [(v[2] - v[1]) * k, (v[0] - v[2]) * k, (v[1] - v[0]) * k];
    const out = v.map((x, i) => {
      const turned = x * cs + cross[i] * sn + m * (1 - cs);
      const s = clamp(m + (turned - m) * saturation);
      return mix(s, s < 0.5 ? 2 * s : 2 - 2 * s, solarize);
    });
    return fromEncoded(out, c[3]);
  };
};

export const COLOUR_REFERENCES: Record<string, KernelReference> = { "gradient-map": gradientMap, "color-grade": colorGrade, posterize, psychedelic };
