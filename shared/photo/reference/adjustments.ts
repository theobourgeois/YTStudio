/**
 * CPU references for the adjustments (docs/photo/research/adjustments.md): one premultiplied linear pixel in, one
 * out, in f64. The GPU kernels (`src/suites/photo/render/adjustments.ts`) are tested against these.
 */
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import { channelFunctions, identityChannels } from "../effects/curve-math.ts";
import type { CurveSet } from "../types.ts";

export type Pixel = [number, number, number, number];

export interface ExposureParams {
  exposure: number;
  offset: number;
  gamma: number;
}

/**
 * Exposure, in linear light on unassociated colour: × 2^exposure, + offset, then the gamma correction's power
 * (1 / gamma), mirrored for negative values. Alpha is unchanged; a transparent pixel stays transparent.
 */
export function exposurePixel([r, g, b, a]: Pixel, { exposure, offset, gamma }: ExposureParams): Pixel {
  if (!(a > 0)) return [r, g, b, a];
  const gain = 2 ** exposure;
  const power = 1 / gamma;
  const one = (c: number) => {
    const v = (c / a) * gain + offset;
    const shaped = gamma === 1 ? v : Math.sign(v) * Math.abs(v) ** power;
    return shaped * a;
  };
  return [one(r), one(g), one(b), a];
}

/**
 * Curves, on sRGB-encoded unassociated colour (rendering.md, "Operation domains"): each channel through its own
 * curve, then the composite. Values outside [0, 1] (light above white, colours outside sRGB) pass through
 * unchanged; an untouched channel is exactly what it was.
 */
export function curvesFor(set: CurveSet): (pixel: Pixel) => Pixel {
  const fns = channelFunctions(set);
  const identity = identityChannels(set);
  return ([r, g, b, a]) => {
    if (!(a > 0)) return [r, g, b, a];
    const one = (c: number, i: number) => {
      if (identity[i]) return c;
      const v = c / a;
      if (v < 0 || v > 1) return c;
      return srgbToLinear(fns[i](linearToSrgb(v))) * a;
    };
    return [one(r, 0), one(g, 1), one(b, 2), a];
  };
}

/** An adjustment's result faded by its layer's opacity over what was below. */
export function fade(below: Pixel, adjusted: Pixel, opacity: number): Pixel {
  if (opacity >= 1) return adjusted;
  return below.map((v, i) => v + (adjusted[i] - v) * opacity) as Pixel;
}
