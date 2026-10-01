/**
 * Runs before the editor's page in the desktop window. It marks the page as the desktop app (so it can make
 * room for the window buttons and drag by its header) and tells it where dropped files are; the page talks
 * to the server over HTTP as usual.
 */
import { contextBridge, webUtils } from "electron";

contextBridge.exposeInMainWorld("editorDesktopInfo", {
  platform: process.platform,
  // Where a file or folder dropped from Finder is (the music Browser adds folders that way); a page can't know.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
});

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("desktop", `desktop-${process.platform}`);
});
