import { musicApi } from "./api";

/** Native plugin editors must join the browser windows' stacking order when one is activated. */
export function lowerPluginEditors() {
  void musicApi.engine("lowerEditors", {}).catch(() => {});
}

/** A toolbar or shortcut also returns keyboard focus from the native editor to the chosen window. */
export function focusMusicWindowElement(id: string) {
  // Do this before sending native commands: a subsequent click may open a plugin again.
  void window.editorDesktopInfo?.focusEditor?.();
  lowerPluginEditors();
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-window="${id}"]`)?.focus({ preventScroll: true }));
}
