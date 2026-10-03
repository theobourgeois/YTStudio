/**
 * Where the main window is, as the desktop app says (`DesktopPanels`): native panels are placed on the screen,
 * but the page keeps their places on its desktop, so it needs to know where that is.
 */
import { type ScreenRect, desktopPanels } from "@/lib/desktop";
import { scaleOf } from "./geometry";

let content: ScreenRect | null = null;
let stop: (() => void) | null = null;
const listeners = new Set<(bounds: ScreenRect) => void>();

/** Where the main window's content is on the screen (points), kept up to date once anyone asks. */
export function contentBounds(): ScreenRect {
  const panels = desktopPanels();
  if (!panels) return { x: window.screenX, y: window.screenY, width: window.innerWidth, height: window.innerHeight };
  if (!stop) {
    stop = panels.onContentBounds((bounds) => {
      content = bounds;
      for (const listener of listeners) listener(bounds);
    });
    content = panels.contentBounds();
  }
  return content ?? { x: window.screenX, y: window.screenY, width: window.innerWidth, height: window.innerHeight };
}

/** Called when the main window moves or is resized. Returns how to stop. */
export function onContentBounds(listener: (bounds: ScreenRect) => void): () => void {
  contentBounds();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Points to a CSS px (the page's zoom). */
export const pageScale = (): number => scaleOf(contentBounds().width, window.innerWidth);

/** The displays' usable areas, in points. */
export const workAreas = (): ScreenRect[] => desktopPanels()?.workAreas() ?? [];
