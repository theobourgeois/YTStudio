/**
 * The New photo window's maths (`new-photo-window.tsx`): which preset a size is, the box that shows its shape,
 * its ratio, and the sides typed in.
 */
import { CANVAS_PRESETS, type CanvasPreset, MAX_CANVAS_SIDE } from "@shared/photo/types";

/** The preset of exactly this size, if there is one (else the size is Custom). */
export const presetOf = (width: number, height: number): CanvasPreset | undefined => CANVAS_PRESETS.find((p) => p.width === width && p.height === height);

/** A side typed in: a whole number of pixels the canvas can have, else null. */
export function parseSide(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const side = Number(text);
  return side >= 1 && side <= MAX_CANVAS_SIDE ? side : null;
}

/** The size of a box of this shape fitting in `max` × `max` (Photoshop's preset icons), never thinner than `min`. */
export function shapeBox(width: number, height: number, max: number, min = 4): { width: number; height: number } {
  const scale = max / Math.max(width, height, 1);
  return { width: Math.max(min, Math.round(width * scale)), height: Math.max(min, Math.round(height * scale)) };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Its aspect ratio as people say it ("9:16", "4:5"), or null when it's no ratio of small numbers. */
export function ratioOf(width: number, height: number): string | null {
  if (width < 1 || height < 1) return null;
  const d = gcd(width, height);
  const [w, h] = [width / d, height / d];
  return Math.max(w, h) <= 32 ? `${w}:${h}` : null;
}
