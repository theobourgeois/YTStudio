/**
 * What the desktop app (electron/) and the page share. The preload script sets `editorDesktopInfo`; the page
 * gives the app `editorDesktop`, which it calls before closing the window.
 */
import { useProjects } from "@/stores/projects";

declare global {
  interface Window {
    editorDesktopInfo?: { platform: string };
    editorDesktop?: { flush(): Promise<void> };
  }
}

/** Whether the editor runs in the desktop app rather than a browser tab. */
export const isDesktop = typeof window !== "undefined" && window.editorDesktopInfo !== undefined;

export function exposeDesktopHooks() {
  if (isDesktop) window.editorDesktop = { flush: () => useProjects.getState().flush() };
}
