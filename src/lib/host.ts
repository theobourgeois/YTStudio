/**
 * The music app (docs/apps.md): the page in the audio engine's own window, the engine being the app. It does what
 * the Electron apps' preload and main process do for the page (`editorDesktopInfo`: the system's dialogs) and talks
 * to the engine directly: commands it answers (`ShellWindow::command`) and events it sends (`flush` before quitting,
 * `openFile` for a package opened in Finder or Explorer). On Windows the engine hosts WebView2 itself
 * (`WebView.cpp`: `chrome.webview` messages); on macOS it's JUCE's web view (its native function `engine`, events
 * named "host"). Elsewhere (a browser, the Electron apps) there's no host and this does nothing.
 *
 * Imported first by main.tsx: `isDesktop` (lib/desktop.ts) is decided when that module loads, from what this sets.
 * So it imports nothing of the app's (types only).
 */
import type { DesktopCommand, DesktopPanels, ScreenRect } from "@/lib/desktop";

/** What JUCE's web view puts on the page (juce_WebBrowserComponent's script, as of JUCE 8). */
interface JuceBackend {
  emitEvent(name: string, payload: unknown): void;
  addEventListener(name: string, listener: (payload: unknown) => void): [string, number];
  removeEventListener(token: [string, number]): void;
}

/** What WebView2 puts on the page: messages to and from its host. */
interface WebView2 {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

declare global {
  interface Window {
    __JUCE__?: { backend: JuceBackend; initialisationData: { __juce__functions?: string[] } };
    chrome?: { webview?: WebView2 };
  }
}

type Reply = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * What the engine tells the page unasked: `command`, `fullscreen` and `zoom` only on macOS (`ShellWindow::menu`,
 * `macShell::Listener`), `maximized`, `screen` and `panelClosed` only on Windows.
 */
type HostEvent =
  | { event: "flush"; request: number }
  | { event: "openFile"; path: string }
  | { event: "command"; name: string }
  | { event: "fullscreen"; on: boolean }
  | { event: "maximized"; on: boolean }
  | { event: "screen"; screen: Screen }
  | { event: "panelClosed"; name: string }
  | { event: "zoom"; factor: number }
  | { event: "dragPaths"; paths: string[] };

const juce = typeof window === "undefined" ? undefined : window.__JUCE__;
const webview = typeof window === "undefined" ? undefined : window.chrome?.webview;

/** Whether the page is in the music app's window, with a way to the engine. */
export const hosted = webview !== undefined || (juce?.initialisationData.__juce__functions?.includes("engine") ?? false);

let nextId = 0;
const waiting = new Map<number, (reply: Reply) => void>();
function answered(id: number, reply: Reply) {
  waiting.get(id)?.(reply);
  waiting.delete(id);
}

/**
 * Sends `command` straight to the engine: the app's own (`host.*`) or one it lets the page send without the server
 * (`directCommands` in ShellWindow.cpp).
 */
export function hostCommand(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if (!hosted) return Promise.reject(new Error("Not in the music app."));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, (reply) => (reply.ok ? resolve(reply.result) : reject(new Error(reply.error))));
    if (webview) webview.postMessage({ id, command, params });
    else juce!.backend.emitEvent("__juce__invoke", { name: "engine", params: [command, params], resultId: id });
  });
}

function received(event: HostEvent) {
  if (event.event === "flush")
    // Saved (or not: the app quits either way once it's waited), then the engine stops the server.
    void Promise.resolve(window.editorDesktop?.flush())
      .catch(() => {})
      .then(() => hostCommand("host.flushed", { request: event.request }));
  else if (event.event === "openFile") void window.editorDesktop?.openFile(event.path);
  // A menu item of the page's (File's New, Open..., Close Tab): `DesktopCommand`, as Electron's menu sends them.
  else if (event.event === "command") window.editorDesktop?.command(event.name as DesktopCommand);
  else if (event.event === "fullscreen") document.documentElement.classList.toggle("fullscreen", event.on);
  else if (event.event === "maximized") markMaximized(event.on);
  else if (event.event === "screen") movedTo(event.screen);
  else if (event.event === "panelClosed") for (const listener of closedListeners) listener(event.name);
  else if (event.event === "zoom") markZoom(event.factor);
  else if (event.event === "dragPaths") dragged = event.paths;
}

/** The page's zoom, as Electron's preload marks it (`--desktop-zoom`: what's beside the window's buttons undoes it). */
function markZoom(factor: number) {
  document.documentElement.style.setProperty("--desktop-zoom", String(factor));
}

/** Where the window is (points), and the displays' usable areas: the engine says so as it moves (`screenAreas`). */
interface Screen {
  content: ScreenRect;
  workAreas: ScreenRect[];
}
let screen: Screen | null = null;
const boundsListeners = new Set<(bounds: ScreenRect) => void>();
const closedListeners = new Set<(name: string) => void>();
function movedTo(now: Screen) {
  screen = now;
  for (const listener of boundsListeners) listener(now.content);
}

/**
 * Windows: the page's panels as windows of the engine's own (`PanelWindow`, owned by the app's window as the plugin
 * windows are, so the two stack among each other by use, as FL Studio's do). The page opens each with `window.open`
 * (WebView.cpp makes it, its document the page's own) and places it; this tells the engine the rest.
 */
const panels: DesktopPanels = {
  show: (name, focus) => void hostCommand("host.panel", { action: "show", name, focus }),
  raise: (name) => void hostCommand("host.panel", { action: "raise", name }),
  hide: (name) => void hostCommand("host.panel", { action: "hide", name }),
  place: (name, rect, basis) => void hostCommand("host.panel", { action: "place", name, rect, basis }),
  configure: (name, options) => void hostCommand("host.panel", { action: "configure", name, options }),
  close: (name) => void hostCommand("host.panel", { action: "close", name }),
  contentBounds: () => screen?.content ?? null,
  workAreas: () => screen?.workAreas ?? [],
  onContentBounds(listener) {
    boundsListeners.add(listener);
    return () => void boundsListeners.delete(listener);
  },
  onClosed(listener) {
    closedListeners.add(listener);
    return () => void closedListeners.delete(listener);
  },
};

/** Windows: the window is maximised (`CaptionButtons` shows restore rather than maximise). */
function markMaximized(on: boolean) {
  document.documentElement.classList.toggle("maximized", on);
}

/** The files Finder or Explorer is dragging over the page, where they are (a page only gets their names and bytes). */
let dragged: string[] = [];
/** A path's last part, on either system. */
const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

if (webview)
  webview.addEventListener("message", (message) => {
    const data = message.data as ({ id: number } & Reply) | HostEvent;
    if ("event" in data) return received(data);
    const { id, ...reply } = data;
    answered(id, reply as Reply);
  });
else if (hosted) {
  juce!.backend.addEventListener("__juce__complete", (payload) => {
    const { promiseId, result } = payload as { promiseId: number; result: Reply };
    answered(promiseId, result);
  });
  juce!.backend.addEventListener("host", (payload) => received(payload as HostEvent));
}

/** A path from a dialog: null if it was cancelled. */
const pathOrNull = (result: unknown) => (typeof result === "string" && result ? result : null);

/** What a Mac's window does for the page as Electron's does: no title bar, so the page's bars drag it. */
const mac = hosted && !webview;
/** Windows' window: no title bar either, but its bars are the page's drag regions (`WebView.cpp`) and it draws the buttons. */
const windows = hosted && !!webview;

/** A bar's parts that are pressed rather than dragged: index.css's `no-drag` (Electron's drag regions). */
const NO_DRAG = 'button, a, input, label, select, textarea, [role="button"], [role="tab"], [role="slider"], [role="spinbutton"], [contenteditable], [data-no-drag], [data-window]';

if (hosted)
  window.editorDesktopInfo = {
    platform: webview ? "win32" : "darwin",
    saveFile: async (options) => pathOrNull(await hostCommand("host.saveFile", options)),
    chooseProject: async (defaultPath) => pathOrNull(await hostCommand("host.chooseProject", { defaultPath })),
    chooseFolder: async (defaultPath) => pathOrNull(await hostCommand("host.chooseFolder", { defaultPath })),
    windowAction: (action) => void hostCommand("host.window", { action }),
    titleBar: (bar) => void hostCommand("host.titleBar", { ...bar }),
    projectOpened: (path) => void hostCommand("host.recent", { path }),
    // By its name among what Finder or Explorer said it's dragging (`dragPaths`), which comes before the drop.
    pathForFile: (file) => dragged.find((path) => baseName(path) === file.name) ?? "",
    ...(mac && { hideApp: (which) => void hostCommand("host.hide", { which }) }),
    ...(windows && { captionButtons: true, panels }),
  };

/**
 * What over the page takes the pointer, wherever it is: the windows on the page's desktops, menus and popovers,
 * dialogs, the window's buttons.
 */
const OVER_BARS = "[data-window], [data-caption-buttons], [data-radix-popper-content-wrapper], [role=\"dialog\"], [role=\"menu\"], [data-sonner-toaster]";

/**
 * Windows: where the page's bars drag the window, told to the engine (`host.dragRegions`, CSS pixels), which answers
 * the system's hit test with them (`ShellWindow::findControlAtPoint`): the `[data-titlebar]` bars, less what's
 * pressed in them (index.css's `no-drag`) and what lies over them. Not WebView2's own `app-region` (it sends them on
 * nearly every frame while the page animates, and fell behind: WebView.cpp). Measured when the bars or what's over them
 * change, at most every 200 ms, and sent only when they moved.
 */
function watchDragRegions() {
  let sent = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const rect = (el: Element) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  };
  const measure = () => {
    timer = null;
    const bars = [...document.querySelectorAll("[data-titlebar]")];
    const drag = bars.map(rect).filter(([, , w, h]) => w > 0 && h > 0);
    const pressed = [...bars.flatMap((bar) => [...bar.querySelectorAll(NO_DRAG)]), ...document.querySelectorAll(OVER_BARS)];
    const noDrag = pressed.map(rect).filter(([, , w, h]) => w > 0 && h > 0);
    const regions = JSON.stringify({ drag, noDrag });
    if (regions === sent) return;
    sent = regions;
    void hostCommand("host.dragRegions", { drag, noDrag }).catch(() => (sent = ""));
  };
  const soon = () => {
    timer ??= setTimeout(measure, 200);
  };
  const resized = new ResizeObserver(soon);
  const watched = new WeakSet<Element>();
  // What changes a bar: its elements coming and going, their classes and styles (not their text: a clock ticking).
  new MutationObserver(() => {
    for (const bar of document.querySelectorAll("[data-titlebar]"))
      if (!watched.has(bar)) {
        watched.add(bar);
        resized.observe(bar);
      }
    soon();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "data-state", "hidden"] });
  window.addEventListener("resize", soon);
  soon();
}

// Room for the window's buttons, as Electron's preload marks the page (index.css), and its bars drag the window.
if (windows) {
  document.documentElement.classList.add("desktop", "desktop-win32", "caption-buttons");
  watchDragRegions();
}

if (mac) {
  // What Electron's preload does: index.css makes room for the traffic lights, drag regions, the zoom.
  document.documentElement.classList.add("desktop", "desktop-darwin");
  // `-webkit-app-region` is Electron's: here a press on a bar (not on what's pressed in it, nor a window over it)
  // has the window follow the mouse, and a double click does what the system says. Only the main window's
  // bars: the music editor's windows are in the page on a Mac.
  window.addEventListener(
    "mousedown",
    (event) => {
      const target = event.target as Element | null;
      if (event.button !== 0 || !target?.closest?.("[data-titlebar]") || target.closest(NO_DRAG)) return;
      event.preventDefault();
      void hostCommand(event.detail === 2 ? "host.titleDoubleClick" : "host.drag");
    },
    true,
  );
}

/**
 * The page is ready for the engine's events (main.tsx, once the app has loaded and `editorDesktop` is set): it
 * opens the files the app was started with or handed while the page loaded.
 */
export async function startHost(): Promise<void> {
  if (!hosted) return;
  const ready = (await hostCommand("host.ready")) as { files: string[]; zoom?: number; maximized?: boolean; screen?: Screen };
  if (mac && ready.zoom) markZoom(ready.zoom);
  if (windows) markMaximized(ready.maximized === true);
  if (windows && ready.screen) movedTo(ready.screen);
  const { files } = ready;
  for (const path of files) await window.editorDesktop?.openFile(path);
}
