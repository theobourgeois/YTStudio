/**
 * Bottom timeline panel.
 *
 *   Timeline (panel, resize handle, context)
 *   ├─ TimelineToolbar
 *   └─ TimelineBody (single scroller)
 *      ├─ ruler row (sticky top): corner + Ruler (ticks, scrub, PlayheadHead)
 *      └─ TrackHeaders (sticky left) + lanes (backgrounds, TimelineClip*, overlays, PlayheadLine)
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { projectDuration } from "@shared/timeline";
import { MAX_ZOOM, useEditor } from "@/stores/editor";
import { cn } from "cn";
import { PANEL_DEFAULT_HEIGHT, PANEL_MAX_FRACTION, PANEL_MIN_HEIGHT } from "./constants";
import { TimelineContext, type TimelineContextValue } from "./context";
import { anchoredScrollLeft, fitZoom, type LaneLayout } from "./geometry";
import { cancelActiveDrag } from "@/lib/pointer-drag";
import { TimelineBody } from "./timeline-body";
import { SequenceTabs } from "./sequence-tabs";
import { TimelineToolbar } from "./toolbar";
import { minZoom, setView, timelineCommands, useTimelineView } from "./view-store";

const HEIGHT_KEY = "editor-timeline-height";

const clampHeight = (h: number) =>
  Math.round(Math.min(Math.max(h, PANEL_MIN_HEIGHT), window.innerHeight * PANEL_MAX_FRACTION));

function initialHeight() {
  const saved = Number(localStorage.getItem(HEIGHT_KEY));
  return clampHeight(Number.isFinite(saved) && saved > 0 ? saved : PANEL_DEFAULT_HEIGHT);
}

export function Timeline() {
  const [height, setHeight] = useState(initialHeight);
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
      <section
        aria-label="Timeline"
        className="relative flex shrink-0 flex-col border-t bg-timeline"
        style={{ height, maxHeight: `${PANEL_MAX_FRACTION * 100}vh` }}
      >
        <ResizeHandle height={height} onResize={setHeight} />
        <SequenceTabs />
        <TimelineToolbar />
        <TimelineBody />
      </section>
    </TimelineContext>
  );
}

function ResizeHandle({ height, onResize }: { height: number; onResize: (h: number) => void }) {
  const drag = useRef<{ startY: number; startH: number; pointerId: number } | null>(null);
  const [active, setActive] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startH: height, pointerId: e.pointerId };
    setActive(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    onResize(clampHeight(d.startH - (e.clientY - d.startY)));
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setActive(false);
    localStorage.setItem(HEIGHT_KEY, String(clampHeight(d.startH - (e.clientY - d.startY))));
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize timeline"
      className="group/resize absolute inset-x-0 -top-1 z-50 h-2 cursor-ns-resize touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => {
        onResize(clampHeight(PANEL_DEFAULT_HEIGHT));
        localStorage.setItem(HEIGHT_KEY, String(PANEL_DEFAULT_HEIGHT));
      }}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-brand opacity-0 transition-opacity group-hover/resize:opacity-60",
          active && "opacity-100 group-hover/resize:opacity-100",
        )}
      />
    </div>
  );
}
