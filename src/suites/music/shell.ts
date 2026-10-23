/**
 * The music shell (docs/claude/music-shell.md): when the page runs in the audio engine's own window, it can send a
 * few commands straight to the engine (JUCE's native functions, `ShellWindow.cpp`) instead of through the server.
 * Elsewhere (a browser, the desktop app) there is no shell and everything goes through the server as before.
 */

/** What JUCE's web view puts on the page (juce_WebBrowserComponent's script, as of JUCE 8). */
interface JuceBackend {
  emitEvent(name: string, payload: unknown): void;
  addEventListener(name: string, listener: (payload: unknown) => void): [string, number];
  removeEventListener(token: [string, number]): void;
}

declare global {
  interface Window {
    __JUCE__?: { backend: JuceBackend; initialisationData: { __juce__functions?: string[] } };
  }
}

type Reply = { ok: true; result: unknown } | { ok: false; error: string };

const juce = typeof window === "undefined" ? undefined : window.__JUCE__;

/** Whether the page is in the shell, with its `engine` function. */
export const inShell = juce?.initialisationData.__juce__functions?.includes("engine") ?? false;

let nextId = 0;
const waiting = new Map<number, (reply: Reply) => void>();
if (inShell)
  juce!.backend.addEventListener("__juce__complete", (payload) => {
    const { promiseId, result } = payload as { promiseId: number; result: Reply };
    waiting.get(promiseId)?.(result);
    waiting.delete(promiseId);
  });

/** Sends `command` straight to the engine (only those it lets the page send: `directCommands` in ShellWindow.cpp). */
export function shellCommand(command: string, params: Record<string, unknown>): Promise<unknown> {
  if (!inShell) return Promise.reject(new Error("Not in the music shell."));
  const resultId = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(resultId, (reply) => (reply.ok ? resolve(reply.result) : reject(new Error(reply.error))));
    juce!.backend.emitEvent("__juce__invoke", { name: "engine", params: [command, params], resultId });
  });
}
