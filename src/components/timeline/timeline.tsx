/**
 * The timeline panel (docked below the monitor at first; it fills whatever room the dock gives it).
 *
 *   Timeline (panel, context)
 *   ├─ TimelineToolbar
 *   └─ TimelineBody (single scroller)
 *      ├─ ruler row (sticky top): corner + Ruler (ticks, scrub, PlayheadHead)
 *      └─ TrackHeaders (sticky left) + lanes (backgrounds, TimelineClip*, overlays, PlayheadLine)
 */
import { useEffect, useMemo, useRef } from "react";
import { projectDuration } from "@shared/timeline";
import { MAX_ZOOM, useEditor } from "@/stores/editor";
import { TimelineContext, type TimelineContextValue } from "./context";
import { anchoredScrollLeft, fitZoom, type LaneLayout } from "./geometry";
import { cancelActiveDrag } from "@/lib/pointer-drag";
import { TimelineBody } from "./timeline-body";
import { TimelineToolbar } from "./toolbar";
import { minZoom, setView, timelineCommands, useTimelineView } from "./view-store";

export function Timeline() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const lanesLayout = useRef<LaneLayout[]>([]);
  const pendingScrollLeft = useRef<number | null>(null);

  const ctx = useMemo<TimelineContextValue>(
    () => ({
      scrollerRef,
      lanesRef,
      lanesLayout,
      pendingScrollLeft,
      effectiveScrollLeft: () => pendingScrollLeft.current ?? scrollerRef.current?.scrollLeft ?? 0,
      zoomTo(next, anchor) {
        const { zoom, setZoom } = useEditor.getState();
        const z = Math.min(MAX_ZOOM, Math.max(minZoom(), next));
        const el = scrollerRef.current;
        if (anchor && el) {
          const target = anchoredScrollLeft(anchor.time, z, anchor.vx);
          if (z === zoom) {
            el.scrollLeft = target;
            return;
          }
          pendingScrollLeft.current = target;
          // If several zoom steps net out to no change before React renders, the
          // anchor effect never runs; apply the anchor ourselves next frame.
          requestAnimationFrame(() => {
            if (pendingScrollLeft.current !== target) return;
            pendingScrollLeft.current = null;
            if (useEditor.getState().zoom === z) el.scrollLeft = target;
          });
        }
        setZoom(z);
      },
    }),
    [],
  );

  // Never leave a drag (and its uncommitted gesture) dangling.
  useEffect(
    () => () => {
      cancelActiveDrag();
      setView({ dragClipIds: [], ghosts: [], marquee: null, snapGuide: null, drop: null, scrubbing: false });
    },
    [],
  );

  useEffect(() => {
    timelineCommands.zoomToFit = () => {
      const duration = projectDuration(useEditor.getState().project);
      const fit = fitZoom(duration, useTimelineView.getState().viewWidth, minZoom(), MAX_ZOOM);
      if (fit !== null) ctx.zoomTo(fit, { time: 0, vx: 0 });
    };
    timelineCommands.zoomBy = (factor) => ctx.zoomTo(useEditor.getState().zoom * factor);
    return () => {
      timelineCommands.zoomToFit = () => {};
      timelineCommands.zoomBy = () => {};
    };
  }, [ctx]);

  return (
    <TimelineContext value={ctx}>
      <section aria-label="Timeline" className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-timeline">
        <TimelineToolbar />
        <TimelineBody />
      </section>
    </TimelineContext>
  );
}
