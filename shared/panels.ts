/**
 * Panels are the editor's windows as windows of the operating system (docs/windows.md): the page opens each
 * with `window.open` under a name that starts with this, which is how the desktop app (electron/panels.ts)
 * tells them from anything else the page might open.
 */
export const PANEL_PREFIX = "vaudio-panel:";
