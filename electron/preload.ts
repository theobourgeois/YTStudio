/**
 * Runs before the editor's page in the desktop window. It marks the page as the desktop app (so it can make
 * room for the window buttons and drag by its header) and tells it where dropped files are; the page talks
 * to the server over HTTP as usual.
 */
import { contextBridge, webFrame, webUtils } from "electron";

contextBridge.exposeInMainWorld("editorDesktopInfo", {
  platform: process.platform,
  // Where a file or folder dropped from Finder is (the music Browser adds folders that way); a page can't know.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
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
