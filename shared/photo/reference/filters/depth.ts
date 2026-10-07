/** The depth filters' CPU references (`../../effects/filters/depth.ts`), mirrored by `render/filters/depth.ts`. */
import { gradientTable } from "../../style/gradients.ts";
import type { Gradient } from "../../types.ts";
import { type KernelReference, type Rgb, clamp, enc3, fromEncoded, mix, tableAt, unpremul } from "../kernel.ts";

/** Rec. 709's weights, used on encoded colour as a stylised brightness. */
const W = [0.2126, 0.7152, 0.0722] as const;
const dot = (v: readonly number[]) => W[0] * v[0] + W[1] * v[1] + W[2] * v[2];

/** Depth Grade's blends, as the WGSL numbers them. */
export const DEPTH_BLENDS: Record<string, number> = { replace: 0, color: 1, "soft-light": 2 };

/** Where Far and Near put a depth along the gradient: their span (never 0, so they can cross). */
export function depthSpan(far: number, near: number): number {
  const span = (near - far) / 100;
  return Math.abs(span) < 1e-3 ? (span < 0 ? -1e-3 : 1e-3) : span;
}

/**
 * Depth Grade: the depth there, between Far and Near, picks a colour along the gradient; it replaces the encoded
 * colour, gives it its colour at the picture's brightness, or soft-lights it, through the gradient's opacity.
 */
const depthGrade: KernelReference = (p) => {
  const table = gradientTable(p.gradient as Gradient);
  const far = (p.far as number) / 100;
  const span = depthSpan(p.far as number, p.near as number);
  const mode = DEPTH_BLENDS[p.blend as string] ?? 1;
  return ([x, y], c, env) => {
    if (!(c[3] > 0)) return c;
    const t = clamp((env.scene(x, y)[0] - far) / span);
    const g = tableAt(table, t);
    const e = enc3(unpremul(c));
    let v: Rgb;
    if (mode === 0) v = [g[0], g[1], g[2]];
    else if (mode === 1) {
      const d = dot(e) - dot(g);
      v = [clamp(g[0] + d), clamp(g[1] + d), clamp(g[2] + d)];
    } else v = [0, 1, 2].map((i) => (1 - 2 * g[i]) * e[i] * e[i] + 2 * g[i] * e[i]) as Rgb;
    return fromEncoded([mix(e[0], v[0], g[3]), mix(e[1], v[1], g[3]), mix(e[2], v[2], g[3])], c[3]);
  };
};

export const DEPTH_REFERENCES: Record<string, KernelReference> = { "depth-grade": depthGrade };
