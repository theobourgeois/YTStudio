import { createContext, useContext, type RefObject } from "react";
import type { LaneLayout } from "./geometry";

/**
 * Stable handles shared by the timeline's pieces. Everything is a ref or a
 * stable function, so consuming the context never causes re-renders.
 */
export interface TimelineContextValue {
  scrollerRef: RefObject<HTMLDivElement | null>;
  lanesRef: RefObject<HTMLDivElement | null>;
  /** Current lane layout (updated on render). */
  lanesLayout: RefObject<LaneLayout[]>;
  /**
   * Change the zoom. With `anchor`, `anchor.time` stays under lane-viewport offset
   * `anchor.vx`; otherwise the playhead (if visible) or the viewport centre stays put.
   */
  zoomTo: (zoom: number, anchor?: { time: number; vx: number }) => void;
  /** scrollLeft the lane area has, or is about to have once a pending zoom commits. */
  effectiveScrollLeft: () => number;
  /** scrollLeft to apply once the pending zoom change has rendered. */
  pendingScrollLeft: RefObject<number | null>;
}

export const TimelineContext = createContext<TimelineContextValue | null>(null);

export function useTimelineContext(): TimelineContextValue {
  const ctx = useContext(TimelineContext);
  if (!ctx) throw new Error("useTimelineContext must be used inside <Timeline>");
  return ctx;
}

/** Pointer position in lane coordinates (x = lane px from time 0, y = px from the first lane's top). */
export function lanePoint(ctx: TimelineContextValue, clientX: number, clientY: number) {
  const el = ctx.lanesRef.current;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}
