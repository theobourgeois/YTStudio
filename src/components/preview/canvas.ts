import { aspectParts } from "@shared/timeline";
import type { AspectRatio } from "@shared/types";

/** Largest rect with the given aspect ratio that fits in `width` x `height`. */
export function fitRect(width: number, height: number, aspect: AspectRatio) {
  const [a, b] = aspectParts(aspect);
  const ratio = a / b;
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  return width / height > ratio
    ? { width: Math.floor(height * ratio), height: Math.floor(height) }
    : { width: Math.floor(width), height: Math.floor(width / ratio) };
}
