/** The glitch filters' CPU references (`../../effects/filters/glitch.ts`), mirrored by `render/filters/glitch.ts`. */
import { type KernelReference, type Pixel } from "../kernel.ts";

/** RGB Split: red read from behind its shift, blue (or green and blue) from ahead of it; coverage the most of them. */
const rgbSplit: KernelReference = (p, canvas) => {
  const distance = p.distance as number;
  const angle = ((p.angle as number) * Math.PI) / 180;
  const radial = p.mode === "radial";
  const anaglyph = p.pair === "anaglyph";
  const half = Math.hypot(canvas.width, canvas.height) / 2;
  return ([x, y], c, env) => {
    let dx = Math.cos(angle) * distance;
    let dy = Math.sin(angle) * distance;
    if (radial) {
      dx = ((x - canvas.width / 2) / half) * distance;
      dy = ((y - canvas.height / 2) / half) * distance;
    }
    const r = env.src(x - dx, y - dy);
    const b = env.src(x + dx, y + dy);
    if (anaglyph) return [r[0], b[1], b[2], Math.max(r[3], b[3])] as Pixel;
    return [r[0], c[1], b[2], Math.max(r[3], c[3], b[3])] as Pixel;
  };
};

export const GLITCH_REFERENCES: Record<string, KernelReference> = { "rgb-split": rgbSplit };
