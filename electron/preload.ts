/**
 * Runs before the editor's page in the desktop window. It only marks the page as the desktop app (so it can
 * make room for the window buttons and drag by its header); the page talks to the server over HTTP as usual.
 */
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("editorDesktopInfo", { platform: process.platform });

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("desktop", `desktop-${process.platform}`);
});
