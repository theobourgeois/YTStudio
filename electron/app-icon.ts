import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import { type AppIconId, isAppIconId } from "../shared/app-icons.ts";

let choice: AppIconId = "original";
const file = () => path.join(app.getPath("userData"), "app-icon.json");

export function desktopIcon() {
  const root = app.isPackaged ? path.join(app.getAppPath(), "dist") : path.join(import.meta.dirname, "..", "public");
  return nativeImage.createFromPath(path.join(root, "app-icons", `${choice}.png`));
}

function apply() {
  const icon = desktopIcon();
  if (icon.isEmpty()) throw new Error("Couldn't load the app icon.");
  app.dock?.setIcon(icon);
  if (process.platform !== "darwin") for (const win of BrowserWindow.getAllWindows()) win.setIcon(icon);
}

export function initializeAppIcon() {
  try {
    const saved: unknown = JSON.parse(readFileSync(file(), "utf8"));
    if (isAppIconId(saved)) choice = saved;
  } catch {
    // A new profile starts with the original icon.
  }
  apply();
  ipcMain.handle("app-icon-get", () => choice);
  ipcMain.handle("app-icon-set", (_event, id: unknown) => {
    if (!isAppIconId(id)) throw new Error("Unknown app icon.");
    const previous = choice;
    try {
      choice = id;
      apply();
      writeFileSync(file(), JSON.stringify(id));
    } catch (error) {
      choice = previous;
      apply();
      throw error;
    }
  });
}
