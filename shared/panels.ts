/**
 * Panels are the editor's windows as windows of the operating system (docs/windows.md): the page opens each
 * with `window.open` under a name that starts with this, which is how the desktop app (electron/panels.ts)
 * tells them from anything else the page might open.
 */
export const PANEL_PREFIX = "vaudio-panel:";

/**
 * The one extra window the panels share for what pops up over them (menus, selects, popovers): a window can't
 * draw outside itself, and a small panel's menu would be cut off. It's transparent, and lies over the
 * display from the corner of the panel in use (`src/components/windows/native/overlay.ts`).
 */
export const POPUP_WINDOW = `${PANEL_PREFIX}popups`;
