/**
 * What the desktop app (electron/) and the page share. The preload script sets `editorDesktopInfo`; the page
 * gives the app `editorDesktop`, which it calls before closing the window.
 */
import { useProjects } from "@/stores/projects";
import type { AppIconId } from "@shared/app-icons";

/** A rectangle on the screen, in points. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What only the desktop app's main process can do for the editor's native windows (panels): the page opens
 * each one with `window.open` and draws into it and moves it itself (`components/windows/native/`).
 */
export interface DesktopPanels {
  show(name: string, focus: boolean): void;
  raise(name: string): void;
  hide(name: string): void;
  /** Move and resize a panel's window at once, to a place on the screen (points). */
  place(name: string, rect: ScreenRect): void;
  configure(name: string, options: { minWidth?: number; minHeight?: number; resizable?: boolean; backgroundColor?: string; title?: string }): void;
  close(name: string): void;
  /** Where the main window's content is on the screen. */
  contentBounds(): ScreenRect | null;
  /** The displays' usable areas. */
  workAreas(): ScreenRect[];
  /** The main window moved or changed size. Returns how to stop listening. */
  onContentBounds(listener: (bounds: ScreenRect) => void): () => void;
  /** A panel's window was closed by something other than the page. Returns how to stop listening. */
  onClosed(listener: (name: string) => void): () => void;
}

declare global {
  interface Window {
    editorDesktopInfo?: {
      platform: string;
      panels?: DesktopPanels;
      appIcon?: { get(): Promise<AppIconId>; set(id: AppIconId): Promise<void> };
      pathForFile?: (file: File) => string;
      saveFile?: (options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
      microphone?: { status(): Promise<string>; ask(): Promise<string> };
      /** The system's Open dialog for a project (a `.vaudio` package); null if cancelled. */
      chooseProject?: (defaultPath?: string) => Promise<string | null>;
      /** The system's dialog for a folder; null if cancelled. */
      chooseFolder?: (defaultPath?: string) => Promise<string | null>;
      /** The tab strip shows (or not): a Mac's window buttons move to its middle. */
      tabStrip?: (shown: boolean) => void;
      /** A project was opened: the system's recent documents (the Dock, File › Open Recent) list it. */
      projectOpened?: (path: string) => void;
    };
    editorDesktop?: {
      flush(): Promise<void>;
      /** Open a project's package (double-clicked in Finder, or picked from File › Open Recent). */
      openFile(path: string): Promise<void>;
      /** A menu command of the app's (`DesktopCommand`). */
      command(name: DesktopCommand): void;
    };
  }
}

/** What the desktop app's menu asks the page to do (electron/main.ts's File menu). */
export type DesktopCommand = "home" | "open" | "newProject" | "reveal" | "closeTab" | `new:${string}`;

/** Whether the editor runs in the desktop app rather than a browser tab. */
export const isDesktop = typeof window !== "undefined" && window.editorDesktopInfo !== undefined;

/** The native windows' side of the desktop app, if this is it (a browser tab keeps its windows in the page). */
export const desktopPanels = (): DesktopPanels | undefined => (typeof window === "undefined" ? undefined : window.editorDesktopInfo?.panels);

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

/** The system's Open dialog for a project (the desktop app only; undefined in a browser, which asks for a path). */
export function chooseProjectFile(defaultPath?: string): Promise<string | null> | undefined {
  return window.editorDesktopInfo?.chooseProject?.(defaultPath);
}

/** The system's dialog for a folder (the desktop app only). */
export function chooseFolder(defaultPath?: string): Promise<string | null> | undefined {
  return window.editorDesktopInfo?.chooseFolder?.(defaultPath);
}

/** Tell the system a project was opened (its recent documents), in the desktop app. */
export function noteOpenedProject(path: string): void {
  window.editorDesktopInfo?.projectOpened?.(path);
}

/** What the page does for the desktop app's menu commands; set by the Home screen's module. */
let commands: (name: DesktopCommand) => void = () => {};
export function onDesktopCommand(run: (name: DesktopCommand) => void): void {
  commands = run;
}

export function exposeDesktopHooks() {
  if (!isDesktop) return;
  window.editorDesktop = {
    flush: () => useProjects.getState().flush(),
    openFile: (path) => useProjects.getState().openFile(path),
    command: (name) => commands(name),
  };
}

/** Tell the desktop app whether the tab strip is showing (it keeps a Mac's window buttons level with the bar). */
export function noteTabStrip(shown: boolean) {
  window.editorDesktopInfo?.tabStrip?.(shown);
}
