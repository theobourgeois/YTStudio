/**
 * The music shell (docs/claude/music-shell.md): when the page runs in the audio engine's own window, it can send a
 * few commands straight to the engine (`directCommands` in `ShellWindow.cpp`) instead of through the server. On
 * Windows the engine hosts WebView2 itself (`WebView.cpp`: `chrome.webview` messages); on macOS it's JUCE's web view
 * (its native function `engine`). Elsewhere (a browser, the desktop app) there is no shell and everything goes
 * through the server as before.
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

const juce = typeof window === "undefined" ? undefined : window.__JUCE__;
const webview = typeof window === "undefined" ? undefined : window.chrome?.webview;

/** Whether the page is in the shell, with a way to the engine. */
export const inShell = webview !== undefined || (juce?.initialisationData.__juce__functions?.includes("engine") ?? false);

let nextId = 0;
const waiting = new Map<number, (reply: Reply) => void>();
function answered(id: number, reply: Reply) {
  waiting.get(id)?.(reply);
  waiting.delete(id);
}
if (webview)
  webview.addEventListener("message", (event) => {
    const { id, ...reply } = event.data as { id: number } & Reply;
    answered(id, reply as Reply);
  });
else if (inShell)
  juce!.backend.addEventListener("__juce__complete", (payload) => {
    const { promiseId, result } = payload as { promiseId: number; result: Reply };
    answered(promiseId, result);
  });

/** Sends `command` straight to the engine (only those it lets the page send: `directCommands` in ShellWindow.cpp). */
export function shellCommand(command: string, params: Record<string, unknown>): Promise<unknown> {
  if (!inShell) return Promise.reject(new Error("Not in the music shell."));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, (reply) => (reply.ok ? resolve(reply.result) : reject(new Error(reply.error))));
    if (webview) webview.postMessage({ id, command, params });
    else juce!.backend.emitEvent("__juce__invoke", { name: "engine", params: [command, params], resultId: id });
  });
}
