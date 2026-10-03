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
  // Projects are files (`.vaudio` packages): the Mac's Open dialog for one, and its folder picker (where new ones go).
  chooseProject: (defaultPath?: string) => ipcRenderer.invoke("choose-project", { defaultPath }) as Promise<string | null>,
  chooseFolder: (defaultPath?: string) => ipcRenderer.invoke("choose-folder", { defaultPath }) as Promise<string | null>,
  // A project was opened: the Dock's and File › Open Recent's recent documents list it.
  projectOpened: (path: string) => ipcRenderer.send("project-opened", path),
  // The editor's windows, native ones (electron/panels.ts, src/components/windows/native/): the page opens each with
  // `window.open` and draws into it; this is what only the main process can do for them.
  panels: {
    show: (name: string, focus: boolean) => ipcRenderer.send("panels:show", name, focus),
    raise: (name: string) => ipcRenderer.send("panels:raise", name),
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
  // Whether the engine may read inputs (recording): macOS asks Vaudio, which started it.
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
});
window.addEventListener("resize", markZoom);
