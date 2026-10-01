/**
 * What the desktop app (electron/) and the page share. The preload script sets `editorDesktopInfo`; the page
 * gives the app `editorDesktop`, which it calls before closing the window.
 */
import { useProjects } from "@/stores/projects";

declare global {
  interface Window {
    editorDesktopInfo?: {
      platform: string;
      pathForFile?: (file: File) => string;
      saveFile?: (options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
      microphone?: { status(): Promise<string>; ask(): Promise<string> };
    };
    editorDesktop?: { flush(): Promise<void> };
  }
}

/** Whether the editor runs in the desktop app rather than a browser tab. */
export const isDesktop = typeof window !== "undefined" && window.editorDesktopInfo !== undefined;

/** Where a file dropped from Finder is on disk: only the desktop app can say (empty when it can't). */
export function droppedPath(file: File): string {
  return window.editorDesktopInfo?.pathForFile?.(file) ?? "";
}

/**
 * Where to save a file, from the system's save dialog (the desktop app only): its full path, or null if
 * it was cancelled. Undefined where there's no save dialog (a browser), which downloads instead.
 */
export function chooseSaveFile(options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> | undefined {
  return window.editorDesktopInfo?.saveFile?.(options);
}

/**
 * Whether this app may hear the microphone (macOS's answer: "granted", "denied", "restricted" or
 * "not-determined"). Undefined outside the desktop app: there the engine's own process is asked, by
 * whoever started the server (a terminal, in development).
 */
export function microphoneAccess(): Promise<string> | undefined {
  return window.editorDesktopInfo?.microphone?.status();
}

/**
 * Ask for the microphone (recording an input), before the engine opens one, so macOS asks on Vaudio's
 * behalf at that moment. Resolves with the answer; undefined outside the desktop app.
 */
export function askMicrophone(): Promise<string> | undefined {
  return window.editorDesktopInfo?.microphone?.ask();
}

export function exposeDesktopHooks() {
  if (isDesktop) window.editorDesktop = { flush: () => useProjects.getState().flush() };
}
