/**
 * Panels: the editor's windows (the music editor's channel rack, Piano roll, Playlist, mixer... docs/windows.md)
 * as windows of the operating system, so a plugin's window, which is the audio engine's and so another
 * program's, can sit between them. The page opens each with `window.open` (same origin, same renderer: the
 * page draws into it and moves it itself, `src/components/windows/native/`); this is the part only the main
 * process can do: how the window is made, showing it, its stacking level, and telling the page where its own
 * window is.
 */
import { type BrowserWindow, type BrowserWindowConstructorOptions, type Rectangle, ipcMain, screen } from "electron";
import { PANEL_PREFIX, POPUP_WINDOW } from "../shared/panels.ts";
import type { FloatingState } from "./floating.ts";
import type { WindowStack } from "./stacking.ts";

/**
 * Windows has no window levels, but it has owned windows: always above their owner, never above another
 * program's windows, minimised and hidden with it, and stacked among each other by use. The plugin windows
 * are the main window's (the engine's `setWindowOwner`), so the panels are too: siblings, a click raises
 * whichever it lands on, the Piano roll in front of Serum or Serum in front of it, as in FL Studio.
 */
const ownedByMain = process.platform === "win32";

/**
 * Owned windows don't move with their owner, and the page placing them again after the main window moves (a
 * message to the page, a render, a message back) left them trailing behind it. So on Windows the main process
 * moves them itself, as the main window starts each move (`will-move`, before it's drawn there).
 */
const followsMain = ownedByMain;

/** A panel's key in the stack of floating windows (stacking.ts). */
export const panelKey = (name: string) => `panel:${name}`;

/** Whether `window.open` was given a panel's name; anything else the page opens is refused (`keepLinksOutside`). */
export const isPanelName = (name: string) => name.startsWith(PANEL_PREFIX);

/** What a panel is made with: no frame (the page draws its title bar), hidden until the page has drawn it. */
export function panelOptions(): BrowserWindowConstructorOptions {
  return {
    show: false,
    frame: false,
    width: 480,
    height: 320,
    backgroundColor: "#16191d",
    hasShadow: true,
    // The page draws square windows (a plugin's are too); macOS would round a frameless one's corners and clip the page's own.
    roundedCorners: false,
    // A click that raises it must also act, as in the main window.
    acceptFirstMouse: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    // They're the app's panels, not windows of the computer: no tile of their own in Mission Control.
    hiddenInMissionControl: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Playback keeps drawing while another window covers it.
      backgroundThrottling: false,
    },
  };
}

/** The shared window for menus and popovers: transparent, no shadow, never in the stack of windows in use. */
export function popupOptions(): BrowserWindowConstructorOptions {
  return { ...panelOptions(), transparent: true, hasShadow: false, backgroundColor: "#00000000", resizable: false, focusable: true };
}

export class Panels {
  private readonly windows = new Map<string, BrowserWindow>();
  /** The ones the page has shown (the others are still being drawn, or hidden with the main window). */
  private readonly shown = new Set<string>();
  private state: FloatingState = { floating: false, visible: true };
  /** The page is being replaced: a window it opens has no one to draw it. */
  private navigating = false;
  /** Where each panel was last put (never read back: at 125% a window's size read back and set again grows). */
  private readonly placed = new Map<string, Rectangle>();
  /** Where the main window's content was when the panels were last moved along with it. */
  private followed: { x: number; y: number };

  /**
   * `stack` is told which panel is used (it has the focus) and which are new; `restack` puts every floating
   * window back in the stack's order (a panel shown without the focus goes behind the ones in use).
   */
  constructor(
    private readonly main: BrowserWindow,
    private readonly stack: WindowStack,
    private readonly restack: () => void,
  ) {
    const send = () => {
      if (!main.isDestroyed()) main.webContents.send("panels:content-bounds", main.getContentBounds());
    };
    for (const event of ["move", "resize", "enter-full-screen", "leave-full-screen", "maximize", "unmaximize"] as const) main.on(event as "move", send);
    this.followed = main.getContentBounds();
    if (followsMain) {
      // Where its content will be: as far from where it is as the window's new place from its old one.
      main.on("will-move", (_event, next) => {
        const now = main.getBounds();
        const content = main.getContentBounds();
        this.follow({ x: content.x + next.x - now.x, y: content.y + next.y - now.y });
      });
      // Anything `will-move` didn't announce (a snap, a maximise) is caught up with once it's done.
      for (const event of ["move", "resize", "maximize", "unmaximize"] as const) main.on(event as "move", () => this.follow(main.getContentBounds()));
    }
    // A reload or another page: the windows of the old one have no one to draw them.
    main.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      this.navigating = true;
      this.closeAll();
    });
    // (The old page may still open one as it goes: those are closed as they're made, until the new one has loaded.)
    main.webContents.on("dom-ready", () => (this.navigating = false));
    main.on("closed", () => this.closeAll());
  }

  /** A window the page opened (`window.open` with a panel's name, made with `panelOptions`). */
  adopt(name: string, win: BrowserWindow) {
    if (this.navigating) return void win.destroy();
    this.windows.set(name, win);
    if (ownedByMain) win.setParentWindow(this.main);
    else win.setAlwaysOnTop(this.state.floating, "floating");
    // The popup window is transient: it isn't one of the windows in use that the stack keeps in order.
    const stacked = name !== POPUP_WINDOW;
    if (stacked) win.on("focus", () => this.stack.raise(panelKey(name)));
    win.on("closed", () => {
      this.windows.delete(name);
      this.shown.delete(name);
      this.placed.delete(name);
      if (stacked) this.stack.drop(panelKey(name));
      if (!this.main.isDestroyed()) this.main.webContents.send("panels:closed", name);
    });
  }

  /** At the floating level, or the ordinary one, and hidden or not, with the main window (`FloatingGroup`). */
  setState(state: FloatingState) {
    const visibleChanged = state.visible !== this.state.visible;
    this.state = state;
    for (const [name, win] of this.windows) {
      if (win.isDestroyed()) continue;
      if (!ownedByMain) win.setAlwaysOnTop(state.floating, "floating");
      if (visibleChanged && this.shown.has(name)) {
        if (state.visible) win.showInactive();
        else win.hide();
      }
    }
  }

  show(name: string, focus: boolean) {
    const win = this.windows.get(name);
    if (!win || win.isDestroyed()) return;
    this.shown.add(name);
    if (name === POPUP_WINDOW) {
      if (this.state.visible) win.show();
      return;
    }
    if (focus) this.stack.raise(panelKey(name));
    else this.stack.lower(panelKey(name));
    if (!this.state.visible) return;
    if (focus) {
      win.show();
    } else {
      win.showInactive();
      // It's on top of the others for now: behind the ones in use, where the stack has it.
      this.restack();
    }
  }

  /** The windows on screen, from the back to the front (the popup window, when something's in it, over them all): where the pointer might be. */
  shownWindows(): BrowserWindow[] {
    if (!this.state.visible) return [];
    const order = this.stack.order();
    const rank = (name: string) => (name === POPUP_WINDOW ? Infinity : order.indexOf(panelKey(name)));
    return [...this.shown]
      .sort((a, b) => rank(a) - rank(b))
      .map((name) => this.windows.get(name))
      .filter((win): win is BrowserWindow => !!win && !win.isDestroyed() && win.isVisible());
  }

  /** In front of the other floating windows, without the keyboard; false if it's not shown. */
  moveTop(name: string): boolean {
    const win = this.windows.get(name);
    if (!win || win.isDestroyed() || !this.shown.has(name)) return false;
    win.moveTop();
    return true;
  }

  /** In front of the other floating windows, with the keyboard. */
  raise(name: string) {
    const win = this.windows.get(name);
    if (!win || win.isDestroyed() || !this.shown.has(name)) return;
    win.show();
    win.moveTop();
  }

  configure(name: string, options: { minWidth?: number; minHeight?: number; resizable?: boolean; backgroundColor?: string; title?: string }) {
    const win = this.windows.get(name);
    if (!win || win.isDestroyed()) return;
    if (options.minWidth !== undefined || options.minHeight !== undefined) win.setMinimumSize(Math.max(0, Math.round(options.minWidth ?? 0)), Math.max(0, Math.round(options.minHeight ?? 0)));
    if (options.resizable !== undefined) win.setResizable(options.resizable);
    if (options.backgroundColor) win.setBackgroundColor(options.backgroundColor);
    if (options.title) win.setTitle(options.title);
  }

  /**
   * Position and size at once: moving and then resizing from the page undoes the move (the resize starts from
   * the old place). `basis` is where the main window's content was when the page worked `rect` out: a request
   * that was on its way while the main window moved lands where the page meant, not where it was.
   */
  place(name: string, rect: Rectangle, basis?: { x: number; y: number }) {
    const win = this.windows.get(name);
    if (!win || win.isDestroyed()) return;
    const dx = followsMain && basis ? this.followed.x - basis.x : 0;
    const dy = followsMain && basis ? this.followed.y - basis.y : 0;
    const bounds = { x: Math.round(rect.x + dx), y: Math.round(rect.y + dy), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
    this.placed.set(name, bounds);
    win.setBounds(bounds);
  }

  /** The main window's content is now at `content`: every panel goes along by as much as it moved. */
  private follow(content: { x: number; y: number }) {
    const dx = Math.round(content.x - this.followed.x);
    const dy = Math.round(content.y - this.followed.y);
    this.followed = { x: content.x, y: content.y };
    if (dx === 0 && dy === 0) return;
    for (const [name, win] of this.windows) {
      if (win.isDestroyed()) continue;
      const was = this.placed.get(name) ?? win.getBounds();
      const bounds = { ...was, x: was.x + dx, y: was.y + dy };
      this.placed.set(name, bounds);
      win.setBounds(bounds);
    }
  }

  hide(name: string) {
    const win = this.windows.get(name);
    if (!win || win.isDestroyed()) return;
    this.shown.delete(name);
    win.hide();
  }

  close(name: string) {
    const win = this.windows.get(name);
    if (win && !win.isDestroyed()) win.close();
  }

  closeAll() {
    for (const win of [...this.windows.values()]) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
    this.shown.clear();
  }

  /** The shared window menus are drawn in: never the one a dialog belongs to. */
  isPopup(win: BrowserWindow) {
    return this.windows.get(POPUP_WINDOW) === win;
  }
}

/**
 * What the page asks of the main process for its panels. `current` is the panels of the open main window
 * (there is one at a time); only that window's page may ask.
 */
export function answerPanelRequests(current: () => { main: BrowserWindow; panels: Panels } | null) {
  const from = (sender: Electron.WebContents) => {
    const now = current();
    return now && now.main.webContents === sender ? now : null;
  };
  ipcMain.on("panels:show", (event, name: unknown, focus: unknown) => {
    if (typeof name === "string") from(event.sender)?.panels.show(name, focus === true);
  });
  ipcMain.on("panels:raise", (event, name: unknown) => {
    if (typeof name === "string") from(event.sender)?.panels.raise(name);
  });
  ipcMain.on("panels:configure", (event, name: unknown, options: unknown) => {
    if (typeof name === "string" && options && typeof options === "object") from(event.sender)?.panels.configure(name, options as Parameters<Panels["configure"]>[1]);
  });
  ipcMain.on("panels:place", (event, name: unknown, rect: unknown, basis: unknown) => {
    const r = rect as Partial<Rectangle> | null;
    const b = basis as Partial<Rectangle> | null | undefined;
    const point = b && typeof b.x === "number" && typeof b.y === "number" && Number.isFinite(b.x) && Number.isFinite(b.y) ? { x: b.x, y: b.y } : undefined;
    if (typeof name === "string" && r && [r.x, r.y, r.width, r.height].every((v) => typeof v === "number" && Number.isFinite(v))) from(event.sender)?.panels.place(name, r as Rectangle, point);
  });
  ipcMain.on("panels:hide", (event, name: unknown) => {
    if (typeof name === "string") from(event.sender)?.panels.hide(name);
  });
  ipcMain.on("panels:close", (event, name: unknown) => {
    if (typeof name === "string") from(event.sender)?.panels.close(name);
  });
  // Synchronous: a drag reads them as it starts.
  ipcMain.on("panels:content-bounds", (event) => {
    event.returnValue = from(event.sender)?.main.getContentBounds() ?? null;
  });
  ipcMain.on("panels:work-areas", (event) => {
    event.returnValue = screen.getAllDisplays().map((d): Rectangle => d.workArea);
  });
}
