/** The colour filters' CPU references (`../../effects/filters/colour.ts`), mirrored by `render/filters/colour.ts`. */
import { gradientTable } from "../../style/gradients.ts";
import type { Gradient } from "../../types.ts";
import { type KernelReference, dec3, enc, luma, mix, premul, tableAt, unpremul } from "../kernel.ts";

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

export const COLOUR_REFERENCES: Record<string, KernelReference> = { "gradient-map": gradientMap };
