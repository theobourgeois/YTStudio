/**
 * Runs before the editor's page in the desktop window. It marks the page as the desktop app (so it can make
 * room for the window buttons and drag by its header) and tells it where dropped files are; the page talks
 * to the server over HTTP as usual.
 */
import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";
import type { AppIconId } from "../shared/app-icons.ts";

type Rect = { x: number; y: number; width: number; height: number };

contextBridge.exposeInMainWorld("editorDesktopInfo", {
  platform: process.platform,
  appIcon: {
    get: () => ipcRenderer.invoke("app-icon-get") as Promise<AppIconId>,
    set: (id: AppIconId) => ipcRenderer.invoke("app-icon-set", id) as Promise<void>,
  },
  // Where a file or folder dropped from Finder is (the music Browser adds folders that way); a page can't know.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  // Where to save a file (a song's export), from the Mac's save dialog; null if it's cancelled.
  saveFile: (options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke("save-file", options) as Promise<string | null>,
  // Projects are files (`.yt` packages): the Mac's Open dialog for one, and its folder picker (where new ones go).
  chooseProject: (defaultPath?: string) => ipcRenderer.invoke("choose-project", { defaultPath }) as Promise<string | null>,
  chooseFolder: (defaultPath?: string) => ipcRenderer.invoke("choose-folder", { defaultPath }) as Promise<string | null>,
  // ⌘H or ⌥⌘H that the page didn't use: macOS's Hide or Hide Others (the menu leaves those keys to the page).
  hideApp: (which: "app" | "others") => ipcRenderer.send("hide-app", which),
  // The bar that starts the window (the tab strip, the menu row or Home's): the window buttons move to its middle,
  // or a Mac's hide when the page draws its own (no tab strip, Settings › General).
  titleBar: (bar: { height: number; ownButtons: boolean }) => ipcRenderer.send("title-bar", bar),
  // The page's own window buttons.
  windowAction: (action: "minimize" | "fullscreen" | "close") => ipcRenderer.send("window-action", action),
  // A project was opened: the Dock's and File › Open Recent's recent documents list it.
  projectOpened: (path: string) => ipcRenderer.send("project-opened", path),
  // An image dropped on the Dock icon (or opened with YTStudio), which the page starts a photo with.
  readHandedImage: (path: string) => ipcRenderer.invoke("read-handed-image", path) as Promise<{ name: string; type?: string; data: Uint8Array }>,
  // The editor's windows, native ones (electron/panels.ts, src/components/windows/native/): the page opens each with
  // `window.open` and draws into it; this is what only the main process can do for them.
  panels: {
    show: (name: string, focus: boolean) => ipcRenderer.send("panels:show", name, focus),
    raise: (name: string) => ipcRenderer.send("panels:raise", name),
    hide: (name: string) => ipcRenderer.send("panels:hide", name),
    place: (name: string, rect: Rect, basis?: Rect) => ipcRenderer.send("panels:place", name, rect, basis),
    configure: (name: string, options: { minWidth?: number; minHeight?: number; resizable?: boolean; backgroundColor?: string; title?: string }) =>
      ipcRenderer.send("panels:configure", name, options),
    close: (name: string) => ipcRenderer.send("panels:close", name),
    /** Where the main window's content is on the screen (points), now. */
    contentBounds: () => ipcRenderer.sendSync("panels:content-bounds") as Rect | null,
    /** The displays' usable areas on the screen. */
    workAreas: () => ipcRenderer.sendSync("panels:work-areas") as Rect[],
    /** The main window moved or was resized. */
    onContentBounds: (listener: (bounds: Rect) => void) => {
      const on = (_event: unknown, bounds: Rect) => listener(bounds);
      ipcRenderer.on("panels:content-bounds", on);
      return () => void ipcRenderer.removeListener("panels:content-bounds", on);
    },
    /** A panel's window was closed by something other than the page (the system, the window menu). */
    onClosed: (listener: (name: string) => void) => {
      const on = (_event: unknown, name: string) => listener(name);
      ipcRenderer.on("panels:closed", on);
      return () => void ipcRenderer.removeListener("panels:closed", on);
    },
  },
  // Stages: windows of their own the page fills (the visualizer popped out, electron/stage.ts).
  stage: {
    pin: (name: string, on: boolean) => ipcRenderer.send("stage:pin", name, on),
  },
  // Whether the engine may read inputs (recording): macOS asks YTStudio, which started it.
  microphone: {
    status: () => ipcRenderer.invoke("microphone-status") as Promise<string>,
    ask: () => ipcRenderer.invoke("microphone-ask") as Promise<string>,
  },
});

/**
 * The page's zoom (⌘+ / ⌘−), as `--desktop-zoom`: the window buttons stay the same size in the window
 * whatever the zoom, so what's placed beside them divides by it (src/index.css). A zoom resizes the page.
 */
const markZoom = () => document.documentElement.style.setProperty("--desktop-zoom", String(webFrame.getZoomFactor()));

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("desktop", `desktop-${process.platform}`);
  markZoom();
  if (process.platform === "win32") followTitleBarColours();
});
window.addEventListener("resize", markZoom);

/** How often the bar under the window's buttons is looked at (a theme, a project or the tab strip changes it). */
const TITLE_BAR_CHECK_MS = 500;

/**
 * Windows: the system draws the window's buttons over the page's top-right corner (`titleBarOverlay`,
 * electron/main.ts) in colours it's given, so they're given the bar's under them and its text's, whatever
 * the theme. Looked at twice a second (one element, its style): cheaper than watching the page change.
 */
function followTitleBarColours() {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  // Any CSS colour (the themes use oklch and color-mix) as #rrggbb, or null if it's transparent.
  const hex = (css: string): string | null => {
    if (!context) return null;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return a === 0 ? null : `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  };
  let said = "";
  const check = () => {
    let element: Element | null = document.elementFromPoint(window.innerWidth - 2, 2);
    let color: string | null = null;
    const text = element ? hex(getComputedStyle(element).color) : null;
    for (; element && !color; element = element.parentElement) color = hex(getComputedStyle(element).backgroundColor);
    if (!color || !text) return;
    const key = `${color} ${text}`;
    if (key === said) return;
    said = key;
    ipcRenderer.send("title-bar-colours", { color, symbolColor: text });
  };
  check();
  setInterval(check, TITLE_BAR_CHECK_MS);
}
