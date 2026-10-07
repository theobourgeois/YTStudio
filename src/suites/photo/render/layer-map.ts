/**
 * A layer's document → layer pixels map as the passes read it (the layer pass, the isolated composite, the style
 * pass): three rows (u, v, w), each (x, y, constant, 0). w is (0, 0, 1) but for a layer in perspective, whose
 * `projection` is its whole map; the passes divide (u, v) by it.
 */
import { type Affine, invert } from "@shared/photo/layers.ts";
import { type Homography, invertHomography } from "@shared/photo/projective.ts";

export function inverseRows(l: { matrix: Affine; projection?: Homography }): number[] {
  if (l.projection && (l.projection[6] !== 0 || l.projection[7] !== 0)) {
    const h = invertHomography(l.projection);
    return [h[0], h[1], h[2], 0, h[3], h[4], h[5], 0, h[6], h[7], h[8], 0];
  }
  const inv = invert(l.matrix);
  return [inv[0], inv[2], inv[4], 0, inv[1], inv[3], inv[5], 0, 0, 0, 1, 0];
}
