/**
 * Scroll/zoom plumbing for the timeline scroller:
 * - mirrors scrollLeft / viewport width into the view store (for virtualisation)
 * - Ctrl/⌘ + wheel and trackpad pinch zoom anchored at the pointer
 * - Shift + wheel (and plain wheel when nothing scrolls vertically) scrolls horizontally
 * - applies the scroll anchor after every zoom change, before paint
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { HEADER_WIDTH } from "./constants";
import type { TimelineContextValue } from "./context";
import { anchoredScrollLeft, wheelZoomFactor } from "./geometry";
import { setView } from "./view-store";

interface SafariGestureEvent extends UIEvent {
  scale: number;
  clientX: number;
}

const lineScale = (e: WheelEvent, page: number) =>
  e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page : 1;

export function useScrollZoom(ctx: TimelineContextValue, zoom: number) {
  const { scrollerRef } = ctx;

  // Mirror scroll position + viewport width.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const sync = () =>
      setView({ scrollLeft: el.scrollLeft, viewWidth: Math.max(0, el.clientWidth - HEADER_WIDTH) });
    sync();
    const onScroll = () => setView({ scrollLeft: el.scrollLeft });
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [scrollerRef]);

  // Wheel + pinch.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const anchorAt = (clientX: number) => {
      const viewW = el.clientWidth - HEADER_WIDTH;
      const vx = Math.min(Math.max(0, clientX - el.getBoundingClientRect().left - HEADER_WIDTH), viewW);
      return { vx, time: (ctx.effectiveScrollLeft() + vx) / useEditor.getState().zoom };
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const current = useEditor.getState().zoom;
        ctx.zoomTo(current * wheelZoomFactor(e.deltaY, e.deltaMode), anchorAt(e.clientX));
        return;
      }
      const noVerticalScroll = el.scrollHeight <= el.clientHeight;
      if (e.deltaX === 0 && e.deltaY !== 0 && (e.shiftKey || noVerticalScroll)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY * lineScale(e, el.clientWidth);
      }
    };

    // Safari reports trackpad pinch as gesture events instead of ctrl+wheel.
    let gestureStartZoom = 0;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStartZoom = useEditor.getState().zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as SafariGestureEvent;
      if (gestureStartZoom > 0 && g.scale > 0) ctx.zoomTo(gestureStartZoom * g.scale, anchorAt(g.clientX));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, [ctx, scrollerRef]);

  // Re-anchor the scroll position after a zoom change (runs after the new content width is committed).
  const prevZoom = useRef(zoom);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const old = prevZoom.current;
    prevZoom.current = zoom;
    if (!el || old === zoom) return;
    let target = ctx.pendingScrollLeft.current;
    ctx.pendingScrollLeft.current = null;
    if (target === null) {
      // Zoom changed elsewhere (slider, buttons, shortcuts): keep the playhead
      // fixed if it's on screen, otherwise the viewport centre.
      const viewW = el.clientWidth - HEADER_WIDTH;
      const sl = el.scrollLeft;
      const px = usePlayback.getState().time * old;
      const vx = px >= sl && px <= sl + viewW ? px - sl : viewW / 2;
      target = anchoredScrollLeft((sl + vx) / old, zoom, vx);
    }
    el.scrollLeft = target;
    // Update synchronously so virtualised content matches this frame.
    setView({ scrollLeft: el.scrollLeft });
  }, [ctx, scrollerRef, zoom]);
}
