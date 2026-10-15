/**
 * Stages: windows of their own for a picture to fill (the Now Playing visualizer popped out, `STAGE_PREFIX`). The
 * page opens one with `window.open` and draws into it, as it does a panel; unlike a panel it's an ordinary window
 * of the system's: framed, in the Window menu and Mission Control, full screen on whichever screen it's on, and
 * kept over other programs only when the page asks (`pin`).
 */
import { type BrowserWindow, type BrowserWindowConstructorOptions, ipcMain } from "electron";
import { STAGE_PREFIX } from "../shared/panels.ts";

/** Whether `window.open` was given a stage's name. */
export const isStageName = (name: string) => name.startsWith(STAGE_PREFIX);

/** What a stage is made with: black until the page draws, as small as a mini player, full screen allowed. */
export function stageOptions(): BrowserWindowConstructorOptions {
  return {
    title: "Now Playing",
    backgroundColor: "#000000",
    minWidth: 240,
    minHeight: 135,
    // The size the page asks for is its picture's (as a browser's popup), not counting the title bar.
    useContentSize: true,
    fullscreenable: true,
    // Windows and Linux: no menu bar across it.
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // It keeps drawing whatever covers the main window, or it.
      backgroundThrottling: false,
    },
  };
}

/** The stages open now, by name: what the main window's page asks of them, and closing them with it. */
export class Stages {
  private readonly windows = new Map<string, BrowserWindow>();

  adopt(name: string, win: BrowserWindow) {
    this.windows.set(name, win);
    if (process.platform !== "darwin") win.setMenuBarVisibility(false);
    win.on("closed", () => {
      if (this.windows.get(name) === win) this.windows.delete(name);
    });
  }

  /** Over other programs' windows (at the floating level), or not. */
  pin(name: string, on: boolean) {
    const win = this.windows.get(name);
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(on, "floating");
  }

  /** The page that drew them is going: so are they. */
  closeAll() {
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.close();
    this.windows.clear();
  }
}

/** What the page asks of its stages; only the main window's page (`main`) may ask. */
export function answerStageRequests(stages: Stages, main: () => BrowserWindow | null) {
  ipcMain.on("stage:pin", (event, name: unknown, on: unknown) => {
    if (typeof name === "string" && main()?.webContents === event.sender) stages.pin(name, on === true);
  });
}
