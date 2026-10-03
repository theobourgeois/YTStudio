/**
 * Where a native panel is, in the three coordinate systems it lives in: the desktop's (CSS px from the
 * desktop element's corner, which is where `WindowPlace` is), the main window's viewport (CSS px) and the
 * screen (points, which is what moving a real window takes). The page may be zoomed, so a CSS px isn't
 * always a point: `scale` is how many points one is. Pure, so it's tested.
 */
import type { Rect } from "../geometry";

export interface Metrics {
  /** Where the main window's content is on the screen, in points. */
  content: Rect;
  /** Points to a CSS px (the page's zoom). */
  scale: number;
  /** The desktop element in the main window's viewport, in CSS px. */
  desk: Rect;
}

/** A rectangle on the desktop (CSS px) as one on the screen (points). */
export function deskToScreen(m: Metrics, r: Rect): Rect {
  return {
    x: m.content.x + (m.desk.x + r.x) * m.scale,
    y: m.content.y + (m.desk.y + r.y) * m.scale,
    width: r.width * m.scale,
    height: r.height * m.scale,
  };
}

/** A rectangle on the screen (points) as one on the desktop (CSS px). */
export function screenToDesk(m: Metrics, r: Rect): Rect {
  return {
    x: (r.x - m.content.x) / m.scale - m.desk.x,
    y: (r.y - m.content.y) / m.scale - m.desk.y,
    width: r.width / m.scale,
    height: r.height / m.scale,
  };
}

/** A point on the screen (points) as one on the desktop (CSS px). */
export function pointToDesk(m: Metrics, p: { x: number; y: number }): { x: number; y: number } {
  const { x, y } = screenToDesk(m, { ...p, width: 0, height: 0 });
  return { x, y };
}

/** Points to a CSS px, from how wide the main window's content is in points and in CSS px. */
export function scaleOf(contentWidth: number, innerWidth: number): number {
  if (!(contentWidth > 0) || !(innerWidth > 0)) return 1;
  return Math.round((contentWidth / innerWidth) * 1000) / 1000;
}

/** The work area (of `areas`) that holds most of `rect`, or the first; null if there are none. */
export function areaFor(rect: Rect, areas: readonly Rect[]): Rect | null {
  let best: Rect | null = null;
  let most = -1;
  for (const a of areas) {
    const w = Math.min(rect.x + rect.width, a.x + a.width) - Math.max(rect.x, a.x);
    const h = Math.min(rect.y + rect.height, a.y + a.height) - Math.max(rect.y, a.y);
    const overlap = w > 0 && h > 0 ? w * h : 0;
    if (overlap > most) {
      most = overlap;
      best = a;
    }
  }
  return best;
}

/**
 * Keep a window's title bar reachable: moved so that at least `keep` px of its width and its top edge are
 * on some display's work area (`areas`, same units as `rect`). A window may leave the main window and the
 * screen it started on, but never get lost off all of them.
 */
export function keepReachable(rect: Rect, areas: readonly Rect[], keep: number, titleHeight: number): Rect {
  if (areas.length === 0) return rect;
  const area = areaFor(rect, areas) ?? areas[0];
  const x = Math.min(Math.max(rect.x, area.x + keep - rect.width), area.x + area.width - keep);
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - titleHeight);
  return { ...rect, x, y };
}

/** A size no bigger than the work area it's on (a window that fits what's in it never reaches past the display). */
export function capSize(size: { width: number; height: number }, area: Rect | null): { width: number; height: number } {
  if (!area) return size;
  return { width: Math.min(size.width, area.width), height: Math.min(size.height, area.height) };
}

/** Whether two rectangles are the same to the pixel (windows are moved by whole points). */
export const sameRect = (a: Rect, b: Rect) => Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y) && Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height);
