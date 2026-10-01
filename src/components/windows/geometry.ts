/**
 * The window manager's maths (`floating-window.tsx`): where a dragged window's edges stick to the desktop's and
 * to other windows' (FL Studio's windows snap together), when the pointer at the desktop's edge snaps
 * a window to fill it or half of it, and how a window is resized by an edge or a corner. Pure, so it's
 * tested.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a window fills the desktop, rather than floating: all of it, or its left or right half. */
export type WindowSnap = "full" | "left" | "right";

/** An edge or a corner of a window, as the compass points the resize handles are named by. */
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** How close (px) an edge must come to another to stick to it. */
export const MAGNET = 10;
/** How close (px) the pointer must come to the desktop's edge to snap the window to it. */
export const EDGE_ZONE = 4;

/** The nearest of `targets` to `value` within `MAGNET`, as the offset to it (0 if none is near). */
function pull(values: number[], targets: number[]): number {
  let best = 0;
  let distance = MAGNET + 1;
  for (const value of values) {
    for (const target of targets) {
      const d = Math.abs(target - value);
      if (d < distance) {
        distance = d;
        best = target - value;
      }
    }
  }
  return distance <= MAGNET ? best : 0;
}

/**
 * Where a window being dragged to `rect` lands once its edges stick to the desktop's (of `desktop`'s
 * size) and to the edges of `others` (the other windows) that are near. Edges of other windows only
 * stick where the two overlap along the other axis (side by side, or one above the other).
 */
export function magnetise(rect: Rect, desktop: { width: number; height: number }, others: readonly Rect[]): Rect {
  const xs = [0, desktop.width];
  const ys = [0, desktop.height];
  for (const o of others) {
    if (rect.y < o.y + o.height + MAGNET && o.y < rect.y + rect.height + MAGNET) xs.push(o.x, o.x + o.width);
    if (rect.x < o.x + o.width + MAGNET && o.x < rect.x + rect.width + MAGNET) ys.push(o.y, o.y + o.height);
  }
  return { ...rect, x: rect.x + pull([rect.x, rect.x + rect.width], xs), y: rect.y + pull([rect.y, rect.y + rect.height], ys) };
}

/** The snap the pointer asks for at the desktop's edge (top: fill it; left, right: half), or null. */
export function edgeSnap(pointer: { x: number; y: number }, desktop: { width: number; height: number }): WindowSnap | null {
  if (pointer.y <= EDGE_ZONE) return "full";
  if (pointer.x <= EDGE_ZONE) return "left";
  if (pointer.x >= desktop.width - EDGE_ZONE) return "right";
  return null;
}

/** The rectangle a snapped window fills on a desktop of this size. */
export function snappedRect(snap: WindowSnap, desktop: { width: number; height: number }): Rect {
  const half = Math.round(desktop.width / 2);
  if (snap === "left") return { x: 0, y: 0, width: half, height: desktop.height };
  if (snap === "right") return { x: half, y: 0, width: desktop.width - half, height: desktop.height };
  return { x: 0, y: 0, width: desktop.width, height: desktop.height };
}

/**
 * A window resized by dragging `edge` by `dx`, `dy`: the opposite edges stay put, it's never smaller
 * than `min`, and never past the desktop's edges.
 */
export function resizeRect(start: Rect, edge: ResizeEdge, dx: number, dy: number, min: { width: number; height: number }, desktop: { width: number; height: number }): Rect {
  let { x, y, width, height } = start;
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  if (edge.includes("e")) width = Math.min(desktop.width - start.x, Math.max(min.width, start.width + dx));
  if (edge.includes("s")) height = Math.min(desktop.height - start.y, Math.max(min.height, start.height + dy));
  if (edge.includes("w")) {
    x = Math.min(right - min.width, Math.max(0, start.x + dx));
    width = right - x;
  }
  if (edge.includes("n")) {
    y = Math.min(bottom - min.height, Math.max(0, start.y + dy));
    height = bottom - y;
  }
  return { x, y, width, height };
}

/**
 * Where a snapped window goes when it's dragged out of its snap: back to its own size, under the
 * pointer at the same fraction of its width as it was grabbed at.
 */
export function unsnapAt(pointer: { x: number; y: number }, grabbed: { fraction: number; dy: number }, size: { width: number; height: number }): Rect {
  return { x: Math.round(pointer.x - grabbed.fraction * size.width), y: Math.max(0, pointer.y - grabbed.dy), ...size };
}
