/** Pure maths for the source preview's trimmer (`source-trimmer.tsx`). */

export interface StripTile {
  x: number;
  width: number;
  /** 0-based filmstrip frame. */
  frame: number;
}

/**
 * Filmstrip frames laid side by side across `width` px, each `tileWidth` wide (the last
 * one cut short), each showing the frame at its middle.
 */
export function stripTiles(width: number, tileWidth: number, frameCount: number): StripTile[] {
  if (width <= 0 || tileWidth <= 0 || frameCount <= 0) return [];
  const tiles: StripTile[] = [];
  for (let x = 0; x < width; x += tileWidth) {
    const w = Math.min(tileWidth, width - x);
    const frame = Math.min(frameCount - 1, Math.floor(((x + w / 2) / width) * frameCount));
    tiles.push({ x, width: w, frame });
  }
  return tiles;
}

/** Position `t` of `duration` as a CSS percentage (clamped to the strip). */
export function percentAt(t: number, duration: number): string {
  if (!(duration > 0)) return "0%";
  return `${(Math.min(Math.max(t, 0), duration) / duration) * 100}%`;
}
