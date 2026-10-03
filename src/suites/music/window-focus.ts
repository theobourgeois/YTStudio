import { openPanels } from "@/components/windows/native/use-panel";
import { desktopPanels } from "@/lib/desktop";
import { queryAnywhere } from "@/lib/window-events";

/**
 * A toolbar button or a shortcut brings a window to the front and gives it the keyboard. In the desktop app
 * the window is a window of the system (it may be among a plugin's, which stay where they are): it's raised
 * as a click on it would, then its element takes the focus.
 */
export function focusMusicWindowElement(id: string) {
  requestAnimationFrame(() => {
    const element = queryAnywhere(`[data-window="${id}"]`);
    if (!element) return;
    const panel = openPanels().get(id);
    if (panel) desktopPanels()?.raise(panel.name);
    element.focus({ preventScroll: true });
  });
}
