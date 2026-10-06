/**
 * Camera Raw's CPU reference as a kernel (docs/photo/camera-raw.md): `developPixel` at each point, on the content's
 * straight colour. The GPU's passes (`src/suites/photo/render/camera-raw.ts`) are checked against it by
 * `scripts/photo-sheet.ts camera-raw`.
 */
import { developPixel, developSettings, developTable } from "../effects/camera-raw/develop.ts";
import { type KernelReference, premul, rand, unpremul } from "./kernel.ts";

export const cameraRawReference: KernelReference = (params, canvas) => {
  const table = developTable(params);
  const settings = developSettings(params, canvas);
  return ([x, y], c) => (c[3] > 0 ? premul(developPixel(unpremul(c), x, y, table, settings, rand), c[3]) : c);
};
