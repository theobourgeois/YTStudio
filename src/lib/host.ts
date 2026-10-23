/**
 * The music app (docs/apps.md): the page in the audio engine's own window, the engine being the app. It does what
 * the Electron apps' preload and main process do for the page (`editorDesktopInfo`: the system's dialogs) and talks
 * to the engine directly: commands it answers (`ShellWindow::command`) and events it sends (`flush` before quitting,
 * `openFile` for a package opened in Finder or Explorer). On Windows the engine hosts WebView2 itself
 * (`WebView.cpp`: `chrome.webview` messages); on macOS it's JUCE's web view (its native function `engine`, events
 * named "host"). Elsewhere (a browser, the Electron apps) there's no host and this does nothing.
 *
 * Imported first by main.tsx: `isDesktop` (lib/desktop.ts) is decided when that module loads, from what this sets.
 * So it imports nothing of the app's.
 */

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

/** What the engine tells the page unasked. */
type HostEvent = { event: "flush"; request: number } | { event: "openFile"; path: string };

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
}

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

if (hosted)
  window.editorDesktopInfo = {
    platform: /Windows/.test(navigator.userAgent) ? "win32" : "darwin",
    saveFile: async (options) => pathOrNull(await hostCommand("host.saveFile", options)),
    chooseProject: async (defaultPath) => pathOrNull(await hostCommand("host.chooseProject", { defaultPath })),
    chooseFolder: async (defaultPath) => pathOrNull(await hostCommand("host.chooseFolder", { defaultPath })),
  };

/**
 * The page is ready for the engine's events (main.tsx, once the app has loaded and `editorDesktop` is set): it
 * opens the files the app was started with or handed while the page loaded.
 */
export async function startHost(): Promise<void> {
  if (!hosted) return;
  const { files } = (await hostCommand("host.ready")) as { files: string[] };
  for (const path of files) await window.editorDesktop?.openFile(path);
}
