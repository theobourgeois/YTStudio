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
import type { DesktopCommand } from "@/lib/desktop";

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
 * A plugin's editor in the app's window (macOS: `ShellWindow::describePlugin`). The page draws its frame as one of
 * its windows and says where its body is (`placePlugins`); the engine puts the plugin's view there, over the page.
 */
export interface HostPlugin {
  /** "channel:<id>" or "effect:<id>". */
  key: string;
  title: string;
  /** The plugin's editor's size, in points (the page's CSS pixels times its zoom). */
  width: number;
  height: number;
  /** False while a song exports. */
  shown: boolean;
  /** The preset it's on (or empty), and whether its arrows step through presets. */
  preset: string;
  steps: boolean;
  /** The parameter last touched in it (its Automate button), or empty. */
  touched: string;
}

/** What the engine tells the page unasked (all but the first two only on macOS: `ShellWindow::menu`, `macShell::Listener`). */
type HostEvent =
  | { event: "flush"; request: number }
  | { event: "openFile"; path: string }
  | { event: "command"; name: string }
  | { event: "fullscreen"; on: boolean }
  | { event: "zoom"; factor: number }
  | { event: "dragPaths"; paths: string[] }
  | { event: "plugin"; plugin: HostPlugin }
  | { event: "pluginGone"; key: string }
  | { event: "pluginFront"; key: string };

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
  else if (event.event === "zoom") markZoom(event.factor);
  else if (event.event === "dragPaths") dragged = event.paths;
  else if (event.event === "plugin") {
    plugins = new Map(plugins).set(event.plugin.key, event.plugin);
    pluginsChanged();
  } else if (event.event === "pluginGone") {
    plugins = new Map(plugins);
    plugins.delete(event.key);
    pluginsChanged();
  } else if (event.event === "pluginFront") pluginsChanged(event.key);
}

/** The page's zoom, as Electron's preload marks it (`--desktop-zoom`: what's beside the window's buttons undoes it). */
function markZoom(factor: number) {
  zoom = factor;
  document.documentElement.style.setProperty("--desktop-zoom", String(factor));
}

let zoom = 1;
/** The page's zoom in the music app (View › Zoom): CSS pixels times this are the window's points. */
export const hostZoom = () => zoom;

let plugins = new Map<string, HostPlugin>();
const pluginListeners = new Set<(front?: string) => void>();
function pluginsChanged(front?: string) {
  for (const listener of pluginListeners) listener(front);
}

/** The plugins' editors open in the app's window (a new Map whenever one opens, changes or closes). */
export const hostPlugins = (): ReadonlyMap<string, HostPlugin> => plugins;

/** Told when a plugin opens, changes or closes, and with its key when it's to come to the front (opened again, clicked). */
export function onHostPlugins(listener: (front?: string) => void): () => void {
  pluginListeners.add(listener);
  return () => void pluginListeners.delete(listener);
}

/** Where a plugin's view goes (CSS pixels): its body, and the parts of it the page's other windows leave showing. */
export interface PluginPlace {
  key: string;
  body: { x: number; y: number; width: number; height: number };
  visible: { x: number; y: number; width: number; height: number }[];
}

/** Put the plugins' views where their frames are, back to front; those not listed hide. */
export const placePlugins = (places: PluginPlace[]) => void hostCommand("host.placePlugins", { places }).catch(() => {});

/** A press in a plugin's frame: its ×, its preset arrows (`direction` -1 or 1), Automate or its wrapper button. */
export const pluginAction = (key: string, action: "close" | "step" | "automate" | "settings", direction = 0) =>
  void hostCommand("host.pluginAction", { key, action, direction }).catch(() => {});

/** The files Finder is dragging over the page, where they are (a page only gets their names and bytes). */
let dragged: string[] = [];

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

/** Whether plugins' editors are in the app's window under frames the page draws (the music app on a Mac), not windows of their own. */
export const embedsPlugins = mac;

/** A bar's parts that are pressed rather than dragged: index.css's `no-drag` (Electron's drag regions). */
const NO_DRAG = 'button, a, input, label, select, textarea, [role="button"], [role="tab"], [role="slider"], [role="spinbutton"], [contenteditable], [data-no-drag], [data-window]';

if (hosted)
  window.editorDesktopInfo = {
    platform: webview ? "win32" : "darwin",
    saveFile: async (options) => pathOrNull(await hostCommand("host.saveFile", options)),
    chooseProject: async (defaultPath) => pathOrNull(await hostCommand("host.chooseProject", { defaultPath })),
    chooseFolder: async (defaultPath) => pathOrNull(await hostCommand("host.chooseFolder", { defaultPath })),
    windowAction: (action) => void hostCommand("host.window", { action }),
    ...(mac && {
      hideApp: (which) => void hostCommand("host.hide", { which }),
      titleBar: (bar) => void hostCommand("host.titleBar", { ...bar }),
      projectOpened: (path) => void hostCommand("host.recent", { path }),
      // By its name among what Finder said it's dragging (`dragPaths`), which comes before the drop.
      pathForFile: (file) => dragged.find((path) => path.slice(path.lastIndexOf("/") + 1) === file.name) ?? "",
    }),
  };

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
  const ready = (await hostCommand("host.ready")) as { files: string[]; zoom?: number; plugins?: HostPlugin[] };
  const { files } = ready;
  if (mac && ready.zoom) markZoom(ready.zoom);
  // Plugins already open (the page was loaded again): their frames are drawn again.
  if (ready.plugins?.length) {
    plugins = new Map(ready.plugins.map((plugin) => [plugin.key, plugin]));
    pluginsChanged();
  }
  for (const path of files) await window.editorDesktop?.openFile(path);
}
