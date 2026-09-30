/**
 * The desktop app: Electron runs the editor's server in its main process and shows the web app in a window.
 * Everything else (projects, media, export, assistant) is the same code as `pnpm dev`.
 *
 *   pnpm dev:desktop     development (Vite with hot reload, data in ./data)
 *   pnpm build:desktop   a packaged app in release/ (data in ~/Library/Application Support/Vaudio)
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { BrowserWindow, Menu, type MenuItemConstructorOptions, app, dialog, shell } from "electron";
import { loadShellPath } from "./shell-path.ts";
import { loadWindowState, trackWindowState } from "./window-state.ts";

const APP_NAME = "Vaudio";
/** The packaged app's server port, kept the same across launches so the page's origin (and its saved layout) is too. */
const PACKAGED_PORTS = [5611, 5612, 5613, 5614, 5615, 0];
/** Set by scripts/desktop.ts in development: Vite's URL (it proxies /api and /files to our server). */
const DEV_URL = process.env.EDITOR_DESKTOP_DEV_URL;
/** How long closing waits for the page to save its last edit. */
const FLUSH_TIMEOUT_MS = 4000;
const isMac = process.platform === "darwin";

app.setName(APP_NAME);
// A separate profile (window state, page storage, the single-instance lock), for tests.
if (process.env.EDITOR_USER_DATA_DIR) app.setPath("userData", path.resolve(process.env.EDITOR_USER_DATA_DIR));
// The packaged app keeps its videos with the user's other app data; development uses the repo's ./data.
if (app.isPackaged && !process.env.EDITOR_DATA_DIR) {
  process.env.EDITOR_DATA_DIR = path.join(app.getPath("userData"), "data");
}

let mainWindow: BrowserWindow | null = null;
let appUrl = "";
let dataDir = "";
let closeServer: (() => void) | null = null;
/** Set once the app is quitting (⌘Q, the Dock, logging out), rather than a window closing. */
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  // Two servers on one data dir would overwrite each other's saves.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return void createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  void start();
}

async function start() {
  await Promise.all([app.whenReady(), loadShellPath()]);
  try {
    const devPort = Number(process.env.EDITOR_SERVER_PORT) || 0;
    process.env.EDITOR_SERVER_PORT ??= String(PACKAGED_PORTS[0]);
    // Only now: server/config.ts reads the environment when it's loaded.
    const { config } = await import("../server/config.ts");
    const { startServer } = await import("./server.ts");
    dataDir = config.dataDir;
    const clientDir = path.join(app.getAppPath(), "dist");
    const server = await startServer({
      dataDir,
      clientDir: DEV_URL ? undefined : existsSync(clientDir) ? clientDir : undefined,
      ports: DEV_URL ? [devPort] : PACKAGED_PORTS,
    });
    closeServer = server.close;
    appUrl = DEV_URL ?? `http://127.0.0.1:${server.port}`;
  } catch (err) {
    dialog.showErrorBox(`${APP_NAME} couldn't start`, err instanceof Error ? err.message : String(err));
    app.exit(1);
    return;
  }
  Menu.setApplicationMenu(buildMenu());
  // A packaged app has its icon in its bundle; in development the Dock would show Electron's.
  if (!app.isPackaged) app.dock?.setIcon(path.join(import.meta.dirname, "..", "resources", "icon.png"));
  createWindow();
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    show: false,
    backgroundColor: "#16191d",
    ...(isMac && { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 18, y: 20 } }),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Playback and exports keep going while the window is in the background.
      backgroundThrottling: false,
    },
  });
  if (state.maximized) win.maximize();
  trackWindowState(win);
  mainWindow = win;
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
    // Hidden export windows don't count: without the editor's window the app is done (except on a Mac).
    if (!isMac) app.quit();
  });
  // The window buttons hide in full screen, and the page stops making room for them (src/index.css).
  const setFullScreen = (on: boolean) =>
    void win.webContents.executeJavaScript(`document.documentElement.classList.toggle("fullscreen", ${on})`).catch(() => {});
  win.on("enter-full-screen", () => setFullScreen(true));
  win.on("leave-full-screen", () => setFullScreen(false));
  flushBeforeClose(win);
  keepLinksOutside(win);
  void win.loadURL(appUrl);
}

/**
 * Let the page save its last edit (autosave is debounced) before the window, and maybe the server, goes.
 * Holding the close back cancels a quit in progress, so that's started again once saved.
 */
function flushBeforeClose(win: BrowserWindow) {
  let flushed = false;
  win.on("close", (event) => {
    if (flushed) return;
    event.preventDefault();
    flushed = true;
    const wasQuitting = quitting;
    const timeout = new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS));
    const flush = win.webContents.executeJavaScript("window.editorDesktop?.flush?.()").catch(() => {});
    void Promise.race([flush, timeout]).then(() => {
      if (wasQuitting) app.quit();
      else if (!win.isDestroyed()) win.close();
    });
  });
}

/** Links to the web open in the user's browser; the window only ever shows the editor. */
function keepLinksOutside(win: BrowserWindow) {
  const isApp = (url: string) => url.startsWith(appUrl);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !isApp(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isApp(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    { role: "fileMenu" },
    // Text fields need the Edit menu for ⌘C/⌘V/⌘Z on a Mac. The editor's own shortcuts get the keys first
    // and only unhandled ones reach these.
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        // No ⌘R: that's Speed/Duration in the editor.
        { role: "reload", accelerator: "" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Show Data Folder",
          click: () => void shell.openPath(dataDir),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

app.on("activate", () => {
  if (!mainWindow && appUrl) createWindow();
});

// Closing the window leaves the app (and any export) running on a Mac, like other Mac apps.
app.on("window-all-closed", () => {});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", () => {
  closeServer?.();
  closeServer = null;
});
