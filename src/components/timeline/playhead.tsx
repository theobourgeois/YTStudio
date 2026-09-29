/**
 * The playhead never re-renders React on playback: a store subscription writes
 * its transform directly, and a second one pages the view to follow it.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { PAGE_MARGIN } from "./constants";
import { pageScrollTarget } from "./geometry";
import { useTimelineView } from "./view-store";

function usePlayheadTransform(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const x = usePlayback.getState().time * useEditor.getState().zoom;
      el.style.transform = `translate3d(${x}px, 0, 0)`;
    };
    update();
    const unsubTime = usePlayback.subscribe((s, p) => {
      if (s.time !== p.time) update();
    });
    const unsubZoom = useEditor.subscribe((s, p) => {
      if (s.zoom !== p.zoom) update();
    });
    return () => {
      unsubTime();
      unsubZoom();
    };
  }, [ref]);
}

/** Grabbable head, rendered inside the ruler (which handles the scrub itself). */
export function PlayheadHead() {
  const ref = useRef<HTMLDivElement>(null);
  usePlayheadTransform(ref);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-y-0 left-0 z-10 will-change-transform">
      <div className="pointer-events-auto absolute top-0 -left-2 flex h-full w-4 cursor-ew-resize justify-center">
        <div className="absolute top-0.5 h-3.5 w-3 rounded-t-[3px] bg-playhead [clip-path:polygon(0_0,100%_0,100%_62%,50%_100%,0_62%)]" />
        {/* Over the ruler's bottom border, so it meets the line through the lanes. */}
        <div className="absolute top-3 -bottom-px w-0.5 bg-playhead" />
      </div>
    </div>
  );
}

/** The line through the lanes. */
export function PlayheadLine() {
  const ref = useRef<HTMLDivElement>(null);
  usePlayheadTransform(ref);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-y-0 left-0 z-[8] will-change-transform">
      <div className="absolute inset-y-0 -left-px w-0.5 bg-playhead shadow-[0_0_0_0.5px_rgb(0_0_0/0.15)]" />
    </div>
  );
}

/**
 * Page the view to keep the playhead visible when time moves (playback, keyboard seeks).
 *
 * Scrolling or zooming the timeline yourself during playback detaches the view
 * (like Logic's "catch" or Resolve's follow mode): it stays where you put it
 * until the playhead comes back on screen or playback stops or restarts.
 */
export function usePlayheadFollow(scrollerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let detached = false;
    /** The last scrollLeft we set, to tell our own scroll events from the user's. */
    let paged: number | null = null;

    const onScroll = () => {
      if (el.scrollLeft === paged) return;
      paged = null;
      if (usePlayback.getState().playing) detached = true;
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    const unsubscribe = usePlayback.subscribe((s, p) => {
      if (s.playing !== p.playing) detached = false;
      if (s.time === p.time) return;
      const view = useTimelineView.getState();
      if (view.scrubbing || view.dragClipIds.length > 0 || view.viewWidth <= 0) return;
      const x = s.time * useEditor.getState().zoom;
      const target = pageScrollTarget(x, view.scrollLeft, view.viewWidth, PAGE_MARGIN);
      if (detached) {
        if (target !== null) return;
        detached = false;
      }
      if (target === null) return;
      el.scrollLeft = target;
      // Read back: the browser clamps and rounds.
      paged = el.scrollLeft;
    });
    return () => {
      el.removeEventListener("scroll", onScroll);
      unsubscribe();
    };
  }, [scrollerRef]);
}
