/**
 * What the desktop app (electron/) and the page share. The preload script sets `editorDesktopInfo`; the page
 * gives the app `editorDesktop`, which it calls before closing the window.
 */
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { addWindowListener } from "@/lib/window-events";
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
 * What only the page's host can do for the editor's native windows (panels): the page opens each one with
 * `window.open` and draws into it and moves it itself (`components/windows/native/`). Only the music app on Windows
 * gives it (src/lib/host.ts: the engine's `PanelWindow`s); Electron's went with step 5 (docs/apps.md).
 */
export interface DesktopPanels {
  show(name: string, focus: boolean): void;
  raise(name: string): void;
  hide(name: string): void;
  /**
   * Move and resize a panel's window at once, to a place on the screen (points). `basis`: where the main
   * window's content was when `rect` was worked out from it; if it has moved since (the host moves the
   * panels with it at once), `rect` goes along by as much.
   */
  place(name: string, rect: ScreenRect, basis?: ScreenRect): void;
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

/** A screen or another program's window the page may see (its picture now, small: a data URL, or empty). */
export interface ScreenSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
}

declare global {
  interface Window {
    editorDesktopInfo?: {
      platform: string;
      panels?: DesktopPanels;
      /** Stages: windows of their own the page fills (electron/stage.ts). Pin one over other programs, or not. */
      stage?: { pin(name: string, on: boolean): void };
      appIcon?: { get(): Promise<AppIconId>; set(id: AppIconId): Promise<void> };
      pathForFile?: (file: File) => string;
      saveFile?: (options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
      microphone?: { status(): Promise<string>; ask(): Promise<string> };
      /** The screens and other programs' windows a screen share may be (electron/screen-share.ts), and one picked for the next. */
      screen?: { sources(): Promise<{ sources: ScreenSource[]; access: string }>; choose(id: string): Promise<void> };
      /** The system's Open dialog for a project (a `.ytvid`, `.ytsng` or `.ytimg` package); null if cancelled. */
      chooseProject?: (defaultPath?: string) => Promise<string | null>;
      /** The system's dialog for a folder; null if cancelled. */
      chooseFolder?: (defaultPath?: string) => Promise<string | null>;
      /** macOS's Hide (⌘H) or Hide Others (⌥⌘H), for those keys when the page didn't use them. */
      hideApp?: (which: "app" | "others") => void;
      /** The bar that starts the window (its height) and who draws the window's buttons: they sit in its middle. */
      titleBar?: (bar: TitleBar) => void;
      /** Minimise, full screen (maximise, on Windows) or close the window, for the page's own buttons (`WindowButtons`, `CaptionButtons`). */
      windowAction?: (action: WindowAction) => void;
      /**
       * Windows: the window has no buttons of the system's (the music app's), so the page draws them over the top-right
       * corner of the bar that starts the window (`CaptionButtons`), where Electron's `titleBarOverlay` draws the system's.
       */
      captionButtons?: boolean;
      /** A project was opened: the system's recent documents (the Dock, File › Open Recent) list it. */
      projectOpened?: (path: string) => void;
      /** An image the system handed the app (`editorDesktop.openImages`): its name, type and bytes. */
      readHandedImage?: (path: string) => Promise<{ name: string; type?: string; data: Uint8Array }>;
    };
    editorDesktop?: {
      flush(): Promise<void>;
      /** Open a project's package (double-clicked in Finder, or picked from File › Open Recent). */
      openFile(path: string): Promise<void>;
      /** Start a photo from images dropped on the Dock icon or opened with the app (several dropped at once: one photo). */
      openImages(paths: string[]): Promise<void>;
      /** A menu command of the app's (`DesktopCommand`). */
      command(name: DesktopCommand): void;
    };
  }
}

/** What the desktop app's menu asks the page to do (electron/main.ts's File menu). */
export type DesktopCommand = "home" | "open" | "newProject" | "reveal" | "closeTab" | `new:${string}`;

/** Whether the editor runs in the desktop app rather than a browser tab. */
export const isDesktop = typeof window !== "undefined" && window.editorDesktopInfo !== undefined;

/**
 * What a screen share may be, in the desktop app (undefined in a browser, whose own picker asks): every screen and
 * every other program's window, and macOS's answer about recording the screen ("granted", "denied"...).
 */
export const desktopScreens = () => (typeof window === "undefined" ? undefined : window.editorDesktopInfo?.screen);

/** The native windows' side of the desktop app, if this is it (a browser tab keeps its windows in the page). */
export const desktopPanels = (): DesktopPanels | undefined => (typeof window === "undefined" ? undefined : window.editorDesktopInfo?.panels);

/** Pinning a stage over other programs: only the desktop app can (undefined in a browser). */
export const desktopStage = () => (typeof window === "undefined" ? undefined : window.editorDesktopInfo?.stage);

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
 * Ask for the microphone (recording an input), before the engine opens one, so macOS asks on YTStudio's
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
    openImages,
    command: (name) => commands(name),
  };
  handBackHideKeys();
}

/**
 * The desktop app's menu leaves ⌘H and ⌥⌘H to the page (the photo editor flips with them); a press nothing in the
 * page used (`preventDefault`) still hides the app, or the others, as on any Mac.
 */
function handBackHideKeys() {
  const hide = window.editorDesktopInfo?.hideApp;
  if (!hide || window.editorDesktopInfo?.platform !== "darwin") return;
  addWindowListener("keydown", (e) => {
    if (e.code !== "KeyH" || !e.metaKey || e.ctrlKey || e.shiftKey || e.repeat) return;
    // After every other listener has had it.
    setTimeout(() => {
      if (!e.defaultPrevented) hide(e.altKey ? "others" : "app");
    });
  });
}

/** Images handed to the app start something, as files dropped on Home do (`startWith`: images start a photo). */
async function openImages(paths: string[]) {
  const read = window.editorDesktopInfo?.readHandedImage;
  if (!read || !paths.length) return;
  let files: File[];
  try {
    files = await Promise.all(paths.map(async (path) => {
      const { name, type, data } = await read(path);
      return new File([data as Uint8Array<ArrayBuffer>], name, { type: type ?? "" });
    }));
  } catch (err) {
    toast.error("Couldn't open that image", { description: errorMessage(err) });
    return;
  }
  if (!useProjects.getState().startWith(files)) toast.error("YTStudio can't open that file");
}

/**
 * The bar that starts the window: the tab strip and the menu row are 40px tall, the Home screen's own bar 52px
 * (src/index.css). `ownButtons`: the page draws the window's buttons, so a Mac's are hidden.
 */
export interface TitleBar {
  height: 40 | 52;
  ownButtons: boolean;
}

/** Tell the desktop app which bar starts the window (it keeps the window's buttons level with it, or hides a Mac's). */
export function noteTitleBar(bar: TitleBar) {
  window.editorDesktopInfo?.titleBar?.(bar);
}

/** What the page's own window buttons do (`maximize`: Windows' maximise or restore). */
export type WindowAction = "minimize" | "fullscreen" | "maximize" | "close";

export function windowAction(action: WindowAction) {
  window.editorDesktopInfo?.windowAction?.(action);
}

/** Whether the page draws Windows' window buttons over the bar that starts the window (the music app on Windows). */
export function drawsCaptionButtons(): boolean {
  return typeof window !== "undefined" && window.editorDesktopInfo?.captionButtons === true;
}

/** Whether the page draws the window's buttons: in a Mac's desktop app, without the tab strip. */
export function ownWindowButtons(tabsHidden: boolean): boolean {
  return tabsHidden && window.editorDesktopInfo?.platform === "darwin" && window.editorDesktopInfo.windowAction !== undefined;
}
