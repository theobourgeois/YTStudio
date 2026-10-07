/**
 * The Background Eraser's colour extraction (docs/photo/tools/background-eraser.md): a pixel erased by `A` of a
 * background `B` is taken as the mix `C = (1 − A)·F + A·B` and solved for its foreground `F`, so a soft edge keeps the
 * subject's colour without the background's. The CPU reference the GPU's apply pass is held to
 * (`render/brush-effects.ts`, its erase mode): change both.
 */
import type { Rgba } from "./toning.ts";

/**
 * `base` (premultiplied linear RGBA) after a stroke whose accumulation there is `acc` (the background taken out,
 * weighted, and how much is erased: `background-eraser.ts`'s `accumulate`), limited by `cover` (the selection's).
 * Premultiplied, `α(1 − A)·F` is simply `α(C − A·B)`, kept within [0, α(1 − A)·max(1, C)].
 */
export function extractPixel(base: Readonly<Rgba>, acc: Readonly<Rgba>, cover = 1): Rgba {
  const erased = Math.min(1, Math.max(0, acc[3])) * Math.min(1, Math.max(0, cover));
  const alpha = base[3];
  if (!(erased > 0) || !(alpha > 0)) return [...base] as Rgba;
  if (erased >= 1) return [0, 0, 0, 0];
  const left = alpha * (1 - erased);
  const out: Rgba = [0, 0, 0, left];
  for (let c = 0; c < 3; c++) {
    const background = acc[c] / acc[3];
    const ceiling = left * Math.max(1, base[c] / alpha);
    out[c] = Math.min(ceiling, Math.max(0, base[c] - alpha * erased * background));
  }
  return out;
}
