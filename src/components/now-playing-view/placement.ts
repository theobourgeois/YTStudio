/**
 * Where the visualizer sits in the app's window (docs/now-playing.md, step 7): filling it, a window moved and resized
 * anywhere over it, or a mini player in a corner (the app goes on under both). Boxes are the page's CSS pixels, kept
 * whole inside it. Pure, and tested.
 */

/** Filling the app, a window over it, or the mini player. (Its own window, outside the app, is `out`.) */
export type VisualizerSize = "full" | "window" | "mini";
/** The sizes that are a box over the app. */
export type BoxedSize = Exclude<VisualizerSize, "full">;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Area {
  width: number;
  height: number;
}

/** The mini player, and how far it sits from the app's corner. */
export const MINI = { width: 360, height: 203 };
export const MARGIN = 16;
/** It's never smaller than this. */
export const SMALLEST = { width: 240, height: 135 };
/** Smaller than this, it shows the mini player's few controls. */
export const COMPACT = { width: 640, height: 300 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A box kept whole inside the area: no smaller than allowed, no bigger than the area. */
export function fitBox(box: Box, area: Area): Box {
  const width = Math.round(Math.min(area.width, Math.max(SMALLEST.width, box.width)));
  const height = Math.round(Math.min(area.height, Math.max(SMALLEST.height, box.height)));
  return {
    x: Math.round(clamp(box.x, 0, area.width - width)),
    y: Math.round(clamp(box.y, 0, area.height - height)),
    width,
    height,
  };
}

/** A size's own place: the mini player in the bottom right corner; a window at 16:9, centred over most of the app. */
export function defaultBox(size: BoxedSize, area: Area): Box {
  if (size === "mini") return fitBox({ x: area.width - MINI.width - MARGIN, y: area.height - MINI.height - MARGIN, ...MINI }, area);
  const width = Math.min(area.width * 0.6, (area.height * 0.7 * 16) / 9);
  const height = (width * 9) / 16;
  return fitBox({ x: (area.width - width) / 2, y: (area.height - height) / 2, width, height }, area);
}

/** Where a size is: where it was left (kept inside the app, which may have got smaller since), else its own place. */
export function placeBox(size: BoxedSize, left: Box | null | undefined, area: Area): Box {
  return left ? fitBox(left, area) : defaultBox(size, area);
}

/** The edges a drag moves: -1 the left or top one, 1 the right or bottom one, 0 neither. */
export interface Edges {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}

/**
 * A box dragged `dx, dy` from where it was: moved (no edges), or resized by its edges, the opposite ones staying
 * put. Kept inside the area, and no smaller than allowed.
 */
export function dragBox(start: Box, edges: Edges | null, dx: number, dy: number, area: Area): Box {
  if (!edges) return fitBox({ ...start, x: start.x + dx, y: start.y + dy }, area);
  const along = (from: number, size: number, edge: -1 | 0 | 1, by: number, smallest: number, room: number): [number, number] => {
    if (edge === 1) return [from, clamp(size + by, smallest, room - from)];
    if (edge === -1) {
      const end = from + size;
      const next = clamp(size - by, smallest, end);
      return [end - next, next];
    }
    return [from, size];
  };
  const [x, width] = along(start.x, start.width, edges.x, dx, SMALLEST.width, area.width);
  const [y, height] = along(start.y, start.height, edges.y, dy, SMALLEST.height, area.height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** A box as it was kept (localStorage), or null if it isn't one. */
export function readBox(value: unknown): Box | null {
  const b = value as Partial<Box> | null;
  if (!b || typeof b !== "object") return null;
  const ok = [b.x, b.y, b.width, b.height].every((v) => typeof v === "number" && Number.isFinite(v));
  return ok ? { x: b.x!, y: b.y!, width: b.width!, height: b.height! } : null;
}
