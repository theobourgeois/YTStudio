import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { desktopPanels } from "@/lib/desktop";
import { type PanelWindow, openPanelWindow } from "./panel-window";
import { contentBounds, onContentBounds, pageScale } from "./bridge";
import type { Metrics } from "./geometry";
import { log } from "@/lib/log";

const logger = log("windows");

/**
 * Where the desktop is, for placing native panels on the screen: read on demand (`metrics`), and `subscribe`
 * says when it changed (the desktop resized, the main window moved or was resized, the page zoomed).
 */
export interface DeskTracker {
  metrics(): Metrics | null;
  subscribe(listener: () => void): () => void;
  /** Changes whenever the desktop does, for `useSyncExternalStore`. */
  version(): number;
}

export function createDeskTracker(ref: RefObject<HTMLElement | null>): DeskTracker {
  let version = 0;
  const listeners = new Set<() => void>();
  const bump = () => {
    version++;
    for (const listener of listeners) listener();
  };
  let observer: ResizeObserver | null = null;
  let stopBounds: (() => void) | null = null;
  const start = () => {
    const el = ref.current;
    if (el) {
      observer = new ResizeObserver(bump);
      observer.observe(el);
    }
    stopBounds = onContentBounds(bump);
    window.addEventListener("resize", bump);
  };
  const stop = () => {
    observer?.disconnect();
    observer = null;
    stopBounds?.();
    stopBounds = null;
    window.removeEventListener("resize", bump);
  };
  return {
    metrics() {
      const el = ref.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { content: contentBounds(), scale: pageScale(), desk: { x: r.left, y: r.top, width: r.width, height: r.height } };
    },
    subscribe(listener) {
      if (listeners.size === 0) start();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    version: () => version,
  };
}

/** Re-renders when the desktop changes (it moved, resized, or the main window did). */
export function useDeskVersion(tracker: DeskTracker): number {
  return useSyncExternalStore(tracker.subscribe, tracker.version);
}

/** Every open panel, by the id of the window it shows: how a window sees its neighbours (edges that stick). */
const open = new Map<string, PanelWindow>();
export const openPanels = (): ReadonlyMap<string, PanelWindow> => open;

/**
 * A native window for a window of the editor, while `enabled`: made hidden, in the page's theme, once the
 * page can draw in it. It's null until then, and again once it's gone; `onGone` is called when the system
 * closed it (the page didn't).
 */
export function usePanelWindow(id: string, title: string, enabled: boolean, onGone: () => void): PanelWindow | null {
  const [panel, setPanel] = useState<PanelWindow | null>(null);
  const titleRef = useRef(title);
  titleRef.current = title;
  const goneRef = useRef(onGone);
  goneRef.current = onGone;

  useEffect(() => {
    if (!enabled || !desktopPanels()) return;
    let made: PanelWindow | null = null;
    let live = true;
    // Next turn: React's development double-run of an effect opens (and closes) no window.
    const timer = setTimeout(() => {
      made = openPanelWindow(id, titleRef.current);
      if (!made) return void logger.error(`the window "${id}" couldn't be opened as a native window`);
      made.onGone = () => {
        open.delete(id);
        setPanel(null);
        goneRef.current();
      };
      const panelWindow = made;
      void panelWindow.ready.then(() => {
        if (!live) return;
        open.set(id, panelWindow);
        setPanel(panelWindow);
      });
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
      if (made && open.get(id) === made) open.delete(id);
      made?.close();
      setPanel(null);
    };
  }, [id, enabled]);

  useEffect(() => {
    if (panel) panel.win.document.title = title;
  }, [panel, title]);

  return panel;
}
