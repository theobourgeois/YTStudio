/**
 * The desktop app: Electron runs the editor's server in its main process and shows the web app in a window.
 * Everything else (projects, media, export, assistant) is the same code as `pnpm dev`.
 *
 *   pnpm dev:desktop     development (Vite with hot reload, data in ./data)
 *   pnpm build:desktop   a packaged app in release/ (data in ~/Library/Application Support/YTStudio)
 */
import { existsSync, renameSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { engineExecutable } from "../server/engine-path.ts";
import { BrowserWindow, Menu, type MenuItemConstructorOptions, app, dialog, ipcMain, screen, session, shell, systemPreferences } from "electron";
import { log, logFile, startLogging } from "../server/log.ts";
import type { RunningServer } from "./server.ts";
import { loadShellPath } from "./shell-path.ts";
import { loadWindowState, trackWindowState } from "./window-state.ts";
import { desktopIcon, initializeAppIcon } from "./app-icon.ts";
import { FloatingGroup, type FloatingState } from "./floating.ts";
import { POPUP_WINDOW } from "../shared/panels.ts";
import { HoverRelay } from "./hover.ts";
import { Panels, answerPanelRequests, isPanelName, panelOptions, popupOptions } from "./panels.ts";
import { Stages, answerStageRequests, isStageName, stageOptions } from "./stage.ts";
import { Restacker, WindowStack } from "./stacking.ts";

const APP_NAME = "YTStudio";
/** What the app was called before: where its data was. */
const LEGACY_APP_NAME = "Vaudio";
/** The packaged app's server port, kept the same across launches so the page's origin (and its saved layout) is too. */
const PACKAGED_PORTS = [5611, 5612, 5613, 5614, 5615, 0];
/** Set by scripts/desktop.ts in development: Vite's URL (it proxies /api and /files to our server). */
const DEV_URL = process.env.EDITOR_DESKTOP_DEV_URL;
/** How long closing waits for the page to save its last edit. */
const FLUSH_TIMEOUT_MS = 4000;
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
/** How long after the app comes to the front its windows are put back in order (the system reorders them as it activates). */
const RESTACK_DELAY_MS = 150;
/** How often the pointer's place is read to tell it to the windows without the focus (about a frame). */
const HOVER_INTERVAL_MS = 16;

/** The images the app opens as a new photo, by extension, with their types: what scripts/desktop.ts declares to macOS. */
const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

app.setName(APP_NAME);
// Windows groups the taskbar button, its pins and notifications by this: the installer's shortcut carries
// the same id (electron-builder's appId), so the running app is that shortcut's, not a second "Electron".
if (isWindows) app.setAppUserModelId(app.isPackaged ? "gg.jestr.ytstudio" : process.execPath);
// Chrome stops giving a page a GPU adapter after a second GPU-process crash within two minutes; the photo editor
// renders with WebGPU and recovers from a lost device, so it must always get one (docs/photo/architecture.md).
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
app.commandLine.appendSwitch("disable-domain-blocking-for-3d-apis");
// A separate profile (window state, page storage, the single-instance lock), for tests.
if (process.env.EDITOR_USER_DATA_DIR) app.setPath("userData", path.resolve(process.env.EDITOR_USER_DATA_DIR));
else {
  // The app was called Vaudio: its profile and data (recents, the Library, settings, the page's storage) move
  // to YTStudio's folder the first time, or stay where they are if they can't.
  const userData = path.join(app.getPath("appData"), APP_NAME);
  const legacy = path.join(app.getPath("appData"), LEGACY_APP_NAME);
  let moved = existsSync(userData) || !existsSync(legacy);
  if (!moved) {
    try {
      renameSync(legacy, userData);
      moved = true;
    } catch (err) {
      // Before the log has a folder: printed only.
      log("desktop").warn(`couldn't move ${legacy} to ${userData}: ${err instanceof Error ? err.message : err}`);
    }
  }
  app.setPath("userData", moved ? userData : legacy);
}
// The packaged app keeps its own data (recents, the Library, settings) with the user's other app data, and
// projects, files of their own, in ~/Documents/YTStudio; development uses the repo's ./data (and the same folder).
if (app.isPackaged && !process.env.EDITOR_DATA_DIR) {
  process.env.EDITOR_DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.EDITOR_PROJECTS_DIR ??= path.join(app.getPath("documents"), "YTStudio");
}

// The audio engine ships in the app's resources (scripts/desktop.ts); development uses engine/build.
if (app.isPackaged && !process.env.EDITOR_ENGINE_PATH) {
  process.env.EDITOR_ENGINE_PATH = engineExecutable(process.resourcesPath);
}
// So does the photo helper, with sharp beside it; development runs server/photo/helper-process.mjs.
if (app.isPackaged && !process.env.EDITOR_PHOTO_HELPER_PATH) {
  process.env.EDITOR_PHOTO_HELPER_PATH = path.join(process.resourcesPath, "photo-helper", "helper.mjs");
}
// And the music suite's models' worker, with ONNX Runtime beside it; development runs server/music/ml-worker.mjs.
if (app.isPackaged && !process.env.EDITOR_MUSIC_WORKER_PATH) {
  process.env.EDITOR_MUSIC_WORKER_PATH = path.join(process.resourcesPath, "music-worker", "ml-worker.mjs");
}

let mainWindow: BrowserWindow | null = null;
/** Files asked to open (double-clicked in Finder, Open Recent, dropped on the Dock icon) before the page could: it opens them once it's loaded. */
let pendingFiles: string[] = [];
/** Images handed to the app (dropped on its Dock icon, Open With), gathered for a moment: dropped together, they start one photo. */
let imageBatch: string[] = [];
let imageBatchTimer: ReturnType<typeof setTimeout> | null = null;
/** The images the page may read (`read-handed-image`): only those the system handed the app. */
const handedImages = new Set<string>();
let pageReady = false;
let appUrl = "";
let dataDir = "";
let closeServer: (() => void) | null = null;
/** Stop the server's process and wait for it (its engine saves its plugins' states as it goes). */
let closeServerAndWait: (() => Promise<void>) | null = null;
let setHostWindow: RunningServer["setHostWindow"] | null = null;
/** The main window's panels (the editor's windows, one native window each: panels.ts). */
let panels: Panels | null = null;
/** The page's stages (the visualizer popped out: stage.ts). */
const stages = new Stages();
/** Which of the app's windows float, and the engine's plugin windows with them (floating.ts). */
let group: FloatingGroup | null = null;
let floatingState: FloatingState = { floating: false, visible: true };
/** The order the floating windows are stacked in, ours and the engine's (stacking.ts): put back after the app is switched away from. */
const stack = new WindowStack();
let raiseEngineWindow: RunningServer["raiseEngineWindow"] | null = null;
let closeEngineWindows: RunningServer["closeEngineWindows"] | null = null;
const restacker = new Restacker(stack, async (key) => {
  if (key.startsWith("panel:")) return panels?.moveTop(key.slice("panel:".length)) ?? false;
  const [, owner, id] = key.split(":");
  return (await raiseEngineWindow?.(owner as "channel" | "effect", id)) ?? false;
}, 35);
/** Set once the app is quitting (⌘Q, the Dock, logging out), rather than a window closing. */
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  // Two servers on one data dir would overwrite each other's saves.
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // Windows and Linux pass a project opened from the file manager as an argument.
    for (const arg of argv.slice(1)) if (isHandedPath(arg)) openFile(arg);
    if (!mainWindow) return void createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  // A project double-clicked in Finder, dropped on the Dock icon or picked from Open Recent (macOS), or an image
  // dropped on the Dock icon or opened with YTStudio, even before launch ends.
  app.on("open-file", (event, file) => {
    event.preventDefault();
    openFile(file);
  });
  for (const arg of process.argv.slice(1)) if (isHandedPath(arg)) pendingFiles.push(arg);
  void start();
}

function isProjectPath(file: string) {
  // `.yt`, or `.vaudio` from before the app was YTStudio (renamed `.yt` once it's opened and closed).
  return /\.(yt|vaudio)[/\\]?$/i.test(file);
}

function imageType(file: string): string | undefined {
  return IMAGE_TYPES[path.extname(file).toLowerCase()];
}

function isHandedPath(file: string) {
  return isProjectPath(file) || imageType(file) !== undefined;
}

/** A file the system handed the app: a project opens; an image starts a photo. */
function openFile(file: string) {
  if (isProjectPath(file)) return openProject(file);
  if (!imageType(file)) return;
  handedImages.add(file);
  imageBatch.push(file);
  // macOS hands several files dropped at once one by one, a moment apart.
  if (imageBatchTimer) clearTimeout(imageBatchTimer);
  imageBatchTimer = setTimeout(openImages, 150);
}

/** Start a photo from the images handed to the app (once the page can: until then they wait). */
function openImages() {
  imageBatchTimer = null;
  const files = imageBatch;
  imageBatch = [];
  if (!mainWindow || !pageReady) {
    pendingFiles.push(...files);
    if (!mainWindow && appUrl) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  void mainWindow.webContents.executeJavaScript(`window.editorDesktop?.openImages(${JSON.stringify(files)})`).catch(() => {});
}

/** Open a project's package in the window (once the page can: until then it waits). */
function openProject(file: string) {
  if (!mainWindow || !pageReady) {
    pendingFiles.push(file);
    if (!mainWindow && appUrl) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  void mainWindow.webContents.executeJavaScript(`window.editorDesktop?.openFile(${JSON.stringify(file)})`).catch(() => {});
}

/** Where the Mac's window buttons sit: level with the middle of the Home screen's bar (52px tall), or of the tab strip or menu row (40px: src/index.css). */
const HEADER_BUTTONS = { x: 18, y: 20 };
const TAB_STRIP_BUTTONS = { x: 18, y: 14 };
/**
 * Windows: the window's own buttons (minimise, maximise, close, with Snap Layouts) sit over the page's top-right
 * corner, as tall as the bar that starts the window (`titleBarOverlay`): a header, or the tab strip. The page
 * leaves them room (`titlebar-area-*` in src/index.css) and says the bar's colours (electron/preload.ts).
 */
const HEADER_HEIGHT = 52;
const TAB_STRIP_HEIGHT = 40;

/** The page's and Chromium's own processes (the GPU's, a utility's) going, and the window hanging, into the log. */
function watchProcesses() {
  const logger = log("desktop");
  app.on("render-process-gone", (_event, contents, details) =>
    logger.error(`a page's process went: ${details.reason} (exit ${details.exitCode})`, { url: contents.getURL() }),
  );
  app.on("child-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") logger.error(`the ${details.name ?? details.type} process went: ${details.reason} (exit ${details.exitCode})`);
  });
}

/** A menu command of the page's (`DesktopCommand` in src/lib/desktop.ts). */
function pageCommand(name: string) {
  if (!mainWindow) createWindow();
  void mainWindow?.webContents.executeJavaScript(`window.editorDesktop?.command(${JSON.stringify(name)})`).catch(() => {});
}

async function start() {
  await Promise.all([app.whenReady(), loadShellPath()]);
  try {
    const devPort = Number(process.env.EDITOR_SERVER_PORT) || 0;
    process.env.EDITOR_SERVER_PORT ??= String(PACKAGED_PORTS[0]);
    // Only now: server/config.ts reads the environment when it's loaded.
    const { LOG_LEVEL, config } = await import("../server/config.ts");
    dataDir = config.dataDir;
    startLogging({ dir: path.join(dataDir, "logs"), level: LOG_LEVEL, console: !app.isPackaged, about: { version: app.getVersion(), packaged: app.isPackaged } });
    watchProcesses();
    const clientDir = path.join(app.getAppPath(), "dist");
    const serverOptions = {
      dataDir,
      clientDir: DEV_URL ? undefined : existsSync(clientDir) ? clientDir : undefined,
      ports: DEV_URL ? [devPort] : PACKAGED_PORTS,
    };
    let server: RunningServer;
    if (process.env.EDITOR_SERVER_IN_MAIN) {
      // The old way, for chasing a problem: the server in this process.
      const { startServer } = await import("./server.ts");
      const { openWindowPage } = await import("./gl-window.ts");
      server = await startServer({
        ...serverOptions,
        // A project's package goes to the Trash Finder knows (Put Back works), and Show in Finder is Finder's own.
        trash: (dir) => shell.trashItem(dir),
        reveal: async (dir) => shell.showItemInFolder(dir),
        openGlPage: openWindowPage,
      });
    } else {
      // In a process of its own: this one hands every window its mouse and keyboard, and the server's work here
      // (songs compiled for the engine, folders indexed, files served) made them lag.
      const { startServerProcess } = await import("./server-host.ts");
      const hosted = await startServerProcess(serverOptions, !app.isPackaged);
      // Started again after dying: the engine it started is new, and must be told where the app's window is.
      hosted.onRestart(() => void tellEngineWhereWeAre());
      closeServerAndWait = hosted.closeAndWait;
      server = hosted;
    }
    closeServer = server.close;
    setHostWindow = server.setHostWindow;
    raiseEngineWindow = server.raiseEngineWindow;
    closeEngineWindows = server.closeEngineWindows;
    // A plugin's window taking the focus (or giving it back) is the app being in use, as one of its own is.
    server.onEngineWindow((event) => {
      if (event.type === "foreground") group?.setEngineForeground(event.on);
      else stack.raise(`engine:${event.owner}:${event.id}`);
    });
    appUrl = DEV_URL ?? `http://127.0.0.1:${server.port}`;
  } catch (err) {
    log("desktop").error("couldn't start", err);
    dialog.showErrorBox(`${APP_NAME} couldn't start`, err instanceof Error ? err.message : String(err));
    app.exit(1);
    return;
  }
  Menu.setApplicationMenu(buildMenu());
  group = new FloatingGroup((state) => {
    floatingState = state;
    panels?.setState(state);
    // The levels change, which doesn't keep the windows in order across programs: they're put back in the stack's.
    // (Windows has no levels: owned windows keep their order as the app comes and goes.)
    void tellEngineWhereWeAre().then(async () => {
      if (!state.floating || !state.visible || isWindows) return;
      // The system orders the app's windows itself as it comes to the front, a moment later than it says so.
      await new Promise((resolve) => setTimeout(resolve, RESTACK_DELAY_MS));
      if (floatingState.floating && floatingState.visible) await restacker.run();
    });
  });
  app.on("browser-window-focus", (_event, focused) => {
    group?.setAppFocused(BrowserWindow.getFocusedWindow() !== null);
    // A plugin's window is the engine's, not one of the editor's: on a Mac, where the editor's windows are
    // drawn in the page (which can't come in front of it), it closes when the app's own window is used. On
    // Windows it stays: it and the editor's windows are all the main window's own, stacked by use.
    if (focused === mainWindow && !isWindows) void closeEngineWindows?.().catch(() => {});
  });
  app.on("browser-window-blur", () => group?.setAppFocused(BrowserWindow.getFocusedWindow() !== null));
  // (Only macOS withholds mouse moves from windows without the focus: elsewhere the 60 Hz poll would be for nothing.)
  if (isMac) relayHover();
  answerPanelRequests(() => (mainWindow && panels ? { main: mainWindow, panels } : null));
  answerStageRequests(stages, () => mainWindow);
  answerSaveDialogs();
  answerProjectDialogs();
  answerMicrophone();
  answerListening();
  initializeAppIcon();
  createWindow();
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    icon: desktopIcon(),
    show: false,
    // A click coming back from a native plugin must also reach the clicked editor window.
    acceptFirstMouse: true,
    backgroundColor: "#16191d",
    ...(isMac && { titleBarStyle: "hiddenInset", trafficLightPosition: HEADER_BUTTONS }),
    // No system title bar or menu bar (FL Studio has neither): the page's top bar drags the window, under the
    // system's own buttons. The colours are the dark theme's until the page says its own.
    ...(isWindows && { titleBarStyle: "hidden", titleBarOverlay: { color: "#16191d", symbolColor: "#e2e5e9", height: HEADER_HEIGHT } }),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Playback and exports keep going while the window is in the background.
      backgroundThrottling: false,
    },
  });
  win.on("unresponsive", () => log("desktop").warn("the window stopped responding"));
  win.on("responsive", () => log("desktop").info("the window is responding again"));
  // Windows and Linux: no menu bar across the window (FL Studio's is in its toolbar, as ours is the page's).
  // Its accelerators still work, and with autoHideMenuBar off a released Alt doesn't bring it back and take
  // the keyboard, which an Alt-drag (off the grid) would do every time.
  if (!isMac) win.setMenuBarVisibility(false);
  trackWindowState(win);
  mainWindow = win;
  const winPanels = new Panels(win, stack, () => void restacker.run());
  winPanels.setState(floatingState);
  panels = winPanels;
  // (Maximised only now: `maximize` shows a window, which would show it empty before its page is drawn.)
  win.once("ready-to-show", () => (state.maximized ? win.maximize() : win.show()));
  // The page is up (its hooks set): projects waiting to open can now.
  win.webContents.on("did-finish-load", () => {
    void win.webContents
      .executeJavaScript("new Promise((resolve) => { const wait = () => (window.editorDesktop ? resolve(true) : setTimeout(wait, 50)); wait(); })")
      .then(() => {
        pageReady = true;
        const files = pendingFiles;
        pendingFiles = [];
        for (const file of files) openFile(file);
      })
      .catch(() => {});
  });
  // Only a new page: `did-start-loading` also fires for the page's own `pushState` (opening a project), which
  // left files handed to the app waiting for a load that never came.
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) pageReady = false;
  });
  win.on("closed", () => {
    // The page that drew them is gone.
    stages.closeAll();
    if (mainWindow === win) {
      mainWindow = null;
      panels = null;
      pageReady = false;
    }
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
  openPanels(win, winPanels);
  followByPluginWindows(win);
  void win.loadURL(appUrl);
}

/**
 * macOS gives a window without the keyboard focus no mouse-moved events, so the toolbar of the main window
 * shows no hover while a panel is in use (and the other way round): the pointer is told to the window under it
 * (hover.ts).
 */
function relayHover() {
  const relay = new HoverRelay<BrowserWindow>(
    () => {
      const win = mainWindow;
      if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return [];
      // Only while there are panels: with the editor's windows in the page, the main window hears the pointer itself.
      const shown = panels?.shownWindows() ?? [];
      return shown.length > 0 ? [win, ...shown] : [];
    },
    () => floatingState.floating,
  );
  setInterval(() => relay.update(screen.getCursorScreenPoint()), HOVER_INTERVAL_MS);
}

/**
 * The page asks where to save a file (a song's export: `editorDesktopInfo.saveFile` in the preload),
 * as FL Studio does before it renders: the Mac's own save dialog, over the window. Null if cancelled.
 */
function answerSaveDialogs() {
  ipcMain.handle("save-file", async (event, options: { defaultPath?: unknown; filters?: unknown }) => {
    const win = dialogParent(event.sender);
    const filters = Array.isArray(options?.filters)
      ? options.filters.filter((f): f is { name: string; extensions: string[] } => typeof f?.name === "string" && Array.isArray(f?.extensions))
      : [];
    const settings = { defaultPath: typeof options?.defaultPath === "string" ? options.defaultPath : undefined, filters };
    const result = win ? await dialog.showSaveDialog(win, settings) : await dialog.showSaveDialog(settings);
    return result.canceled || !result.filePath ? null : result.filePath;
  });
}

/**
 * Projects are files (`.yt` packages, which Finder shows as one file once the app is installed): the
 * Mac's Open dialog picks one (or a file inside one, where macOS doesn't know the type yet), its folder
 * dialog picks where new ones go, and an opened one joins the system's recent documents (File › Open Recent).
 * An image handed to the app is read here for the page, which starts a photo with it.
 */
function answerProjectDialogs() {
  const defaultPath = (options: unknown) => {
    const value = (options as { defaultPath?: unknown } | null)?.defaultPath;
    return typeof value === "string" ? value : undefined;
  };
  ipcMain.handle("choose-project", async (event, options: unknown) => {
    const win = dialogParent(event.sender);
    const settings: Electron.OpenDialogOptions = {
      title: "Open a project",
      buttonLabel: "Open",
      defaultPath: defaultPath(options),
      // A package is a file to the dialog when the type is registered (the packaged app); otherwise its folder is picked.
      properties: isMac ? ["openFile", "openDirectory"] : ["openDirectory"],
      filters: [{ name: "YTStudio projects", extensions: ["yt", "vaudio"] }],
    };
    const result = win ? await dialog.showOpenDialog(win, settings) : await dialog.showOpenDialog(settings);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("choose-folder", async (event, options: unknown) => {
    const win = dialogParent(event.sender);
    const settings: Electron.OpenDialogOptions = {
      title: "Save new projects in",
      buttonLabel: "Choose",
      defaultPath: defaultPath(options),
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win ? await dialog.showOpenDialog(win, settings) : await dialog.showOpenDialog(settings);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  // ⌘H / ⌥⌘H the page didn't use (the app menu leaves them to it): macOS's Hide and Hide Others.
  ipcMain.on("hide-app", (_event, which: unknown) => {
    if (!isMac) return;
    if (which === "others") Menu.sendActionToFirstResponder("hideOtherApplications:");
    else app.hide();
  });
  // The bar that starts the window (the tab strip or menu row, or the taller Home bar): the window buttons sit in its
  // middle. Without the tab strip (Settings › General) a Mac's go, and the page draws its own at the bar's right.
  ipcMain.on("title-bar", (event, bar: unknown) => {
    const { height, ownButtons } = (bar ?? {}) as { height?: unknown; ownButtons?: unknown };
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win !== mainWindow) return;
    const short = height === TAB_STRIP_HEIGHT;
    if (isMac) {
      win.setWindowButtonPosition(short ? TAB_STRIP_BUTTONS : HEADER_BUTTONS);
      win.setWindowButtonVisibility(ownButtons !== true);
    }
    if (isWindows) win.setTitleBarOverlay({ height: short ? TAB_STRIP_HEIGHT : HEADER_HEIGHT });
  });
  ipcMain.on("window-action", (event, action: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win !== mainWindow) return;
    if (action === "minimize") win.minimize();
    else if (action === "fullscreen") win.setFullScreen(!win.isFullScreen());
    else if (action === "close") win.close();
  });
  // Windows: the colours of the bar under the window's buttons, and of its text (the theme's), as the page has them.
  ipcMain.on("title-bar-colours", (event, colours: unknown) => {
    const { color, symbolColor } = (colours ?? {}) as { color?: unknown; symbolColor?: unknown };
    const hex = (value: unknown) => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!isWindows || !win || win !== mainWindow || !hex(color) || !hex(symbolColor)) return;
    win.setTitleBarOverlay({ color: hex(color), symbolColor: hex(symbolColor) });
  });
  ipcMain.on("project-opened", (_event, file: unknown) => {
    if (typeof file === "string" && isProjectPath(file)) app.addRecentDocument(file);
  });
  // An image handed to the app (`openImages`), for the page to start a photo with: never any other file.
  ipcMain.handle("read-handed-image", async (_event, file: unknown) => {
    if (typeof file !== "string" || !handedImages.has(file)) throw new Error("That file wasn't opened with YTStudio.");
    handedImages.delete(file);
    return { name: path.basename(file), type: imageType(file), data: await readFile(file) };
  });
}

/**
 * Recording reads an input through the engine, which macOS lets through only once YTStudio (the app
 * responsible for it) may use the microphone. The page asks for it before the engine opens an input,
 * so the question comes from YTStudio, when the user has just chosen one; and says so when it's refused.
 */
function answerMicrophone() {
  const status = () => (process.platform === "darwin" || process.platform === "win32" ? systemPreferences.getMediaAccessStatus("microphone") : "granted");
  ipcMain.handle("microphone-status", () => status());
  ipcMain.handle("microphone-ask", async () => {
    if (process.platform !== "darwin") return status();
    await systemPreferences.askForMediaAccess("microphone");
    return status();
  });
}

/**
 * Now Playing's visualizer listens to what the computer plays (`src/lib/live-audio.ts`): the page asks for a
 * screen share's sound, and gets the system's (loopback: Core Audio's process tap on a Mac, which asks once, by
 * `NSAudioCaptureUsageDescription`) with its own page as the picture, so it's never asked to record the screen.
 */
function answerListening() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => callback({ video: request.frame ?? undefined, audio: "loopback" }));
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

/**
 * A system dialog sits on the window the user is working in: a panel's (the export's save dialog) rather
 * than the main window under it, which the panels float over.
 */
function dialogParent(sender: Electron.WebContents): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  // (Not the window menus are drawn in: it's gone once the menu item has been chosen.)
  if (focused && !panels?.isPopup(focused)) return focused;
  return BrowserWindow.fromWebContents(sender);
}

/**
 * The editor's windows are the page's own (`window.open`, same origin: the page draws into them and moves
 * them, src/components/windows/native/); they're made here, frameless, and kept at the floating level
 * with the plugin windows (floating.ts, panels.ts).
 */
function openPanels(win: BrowserWindow, owned: Panels) {
  const isApp = (url: string) => url === "about:blank" || url.startsWith(appUrl);
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (isPanelName(frameName) && isApp(url)) return { action: "allow", overrideBrowserWindowOptions: frameName === POPUP_WINDOW ? popupOptions() : panelOptions() };
    if (isStageName(frameName) && isApp(url)) return { action: "allow", overrideBrowserWindowOptions: stageOptions() };
    if (/^https?:/.test(url) && !url.startsWith(appUrl)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (panel, details) => {
    if (isStageName(details.frameName)) {
      stages.adopt(details.frameName, panel);
      keepLinksOutside(panel);
      return;
    }
    if (!isPanelName(details.frameName)) return;
    owned.adopt(details.frameName, panel);
    keepLinksOutside(panel);
  });
}

/**
 * The audio engine's plugin windows follow this one (docs/fl-studio/plugin-window.md): at the floating
 * level while the app is in use, hidden with the main window, and carried along when it moves.
 */
async function tellEngineWhereWeAre(bounds?: Electron.Rectangle): Promise<void> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return setHostWindow?.({ ...floatingState, visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 } });
  // Windows: plugin windows become the main window's own (above it, not above other programs, no taskbar
  // buttons, minimised with it), which needs its handle. The engine reads it from the message as it comes.
  return setHostWindow?.({ ...floatingState, bounds: bounds ?? win.getBounds(), handle: nativeHandle(win) });
}

/** Windows: a window's HWND as a decimal number (a pointer: 8 bytes on 64-bit Windows). */
function nativeHandle(win: BrowserWindow): string | undefined {
  if (!isWindows) return undefined;
  const handle = win.getNativeWindowHandle();
  return handle.length >= 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
}

function followByPluginWindows(win: BrowserWindow) {
  const tell = () => {
    if (win.isDestroyed()) return;
    group?.setMainVisible(win.isVisible() && !win.isMinimized());
    void tellEngineWhereWeAre();
  };
  // (A window that isn't shown yet isn't visible: it's told again as it shows, and when the page has loaded in it.)
  for (const event of ["show", "hide", "minimize", "restore", "move", "resize", "focus", "ready-to-show"] as const) win.on(event as "move", tell);
  // Windows: as a move starts, not once it's done, so the plugin windows keep up with it rather than trail behind.
  if (isWindows)
    win.on("will-move", (_event, next) => {
      if (!win.isDestroyed()) void tellEngineWhereWeAre(next);
    });
  win.webContents.on("did-finish-load", tell);
  win.on("closed", () => {
    group?.setMainVisible(false);
    void tellEngineWhereWeAre();
  });
  tell();
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
    // The app menu as macOS makes it, but Hide (⌘H) and Hide Others (⌥⌘H) leave their keys to the page: the photo
    // editor flips with them, and anywhere else the page hands them back (`hide-app`).
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const, accelerator: "Command+H", registerAccelerator: false },
              { role: "hideOthers" as const, accelerator: "Command+Alt+H", registerAccelerator: false },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      // The page catches these keys itself (wherever focus is), so the menu only shows them.
      submenu: [
        { label: "New Video", accelerator: "CmdOrCtrl+1", registerAccelerator: false, click: () => pageCommand("new:video") },
        { label: "New Song", accelerator: "CmdOrCtrl+2", registerAccelerator: false, click: () => pageCommand("new:music") },
        { label: "New Photo", accelerator: "CmdOrCtrl+3", registerAccelerator: false, click: () => pageCommand("new:photo") },
        { label: "New Project…", accelerator: "CmdOrCtrl+Shift+O", registerAccelerator: false, click: () => pageCommand("newProject") },
        { type: "separator" },
        { label: "Open…", accelerator: "CmdOrCtrl+O", registerAccelerator: false, click: () => pageCommand("open") },
        ...(isMac
          ? [{ label: "Open Recent", role: "recentDocuments" as const, submenu: [{ label: "Clear Menu", role: "clearRecentDocuments" as const }] }]
          : []),
        { type: "separator" },
        { label: "Home", accelerator: "CmdOrCtrl+Shift+H", registerAccelerator: false, click: () => pageCommand("home") },
        { label: "Show in Finder", click: () => pageCommand("reveal") },
        { type: "separator" },
        // ⌘W closes the project's tab (a window without tabs has nothing else to close); the window itself ⇧⌘W.
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", registerAccelerator: false, click: () => pageCommand("closeTab") },
        isMac ? { role: "close", accelerator: "CmdOrCtrl+Shift+W" } : { role: "quit" },
      ],
    },
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
        {
          label: "Show Logs",
          click: () => {
            const file = logFile();
            if (file) shell.showItemInFolder(file);
          },
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
app.on("window-all-closed", () => { if (!isMac) app.quit(); });

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", (event) => {
  if (closeServerAndWait) {
    // Once it has stopped, quit again (closeServerAndWait is gone by then).
    event.preventDefault();
    const wait = closeServerAndWait;
    closeServerAndWait = null;
    closeServer = null;
    void wait().finally(() => app.quit());
    return;
  }
  closeServer?.();
  closeServer = null;
});
