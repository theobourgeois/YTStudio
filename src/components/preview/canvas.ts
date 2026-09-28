import type { AspectRatio } from "@shared/types";

/** Largest rect with the given aspect ratio that fits in `width` x `height`. */
export function fitRect(width: number, height: number, aspect: AspectRatio) {
  const [a, b] = aspect.split(":").map(Number);
  const ratio = a / b;
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  return width / height > ratio
    ? { width: Math.floor(height * ratio), height: Math.floor(height) }
    : { width: Math.floor(width), height: Math.floor(width / ratio) };
}

/** Whether a `#rrggbb` colour is light enough to need dark text on top of it. */
export function isLightColor(hex: string): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return false;
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}
