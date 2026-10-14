/**
 * The editor's server in a process of its own (an Electron utility process, started by server-host.ts): the
 * main process is the one that hands every window its mouse and keyboard, so the server's work (songs
 * compiled for the engine, folders indexed, files served, exports) made the windows lag while it ran there.
 *
 * What the server needs of the main process (the Trash, Show in Folder, the export's drawing page in a hidden
 * window) and what the main process asks of the server (where its window is, plugin windows) go over the
 * process's port as calls (`ServerMessage`); its log lines go to the main process's file.
 */
import { type ServerCall, type ServerMessage, type ServerStart, type HostCall, describeError } from "./server-protocol.ts";

type Port = { postMessage(message: unknown): void; on(event: "message", listener: (event: { data: unknown }) => void): void };
const port = (process as unknown as { parentPort: Port }).parentPort;
const send = (message: ServerMessage) => port.postMessage(message);

let nextId = 0;
const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
/** Ask the main process (`HostCall`). */
function host<T>(call: HostCall): Promise<T> {
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
    send({ type: "call", id, call });
  });
}

let running: Awaited<ReturnType<typeof import("./server.ts").startServer>> | null = null;

async function start({ options, env }: ServerStart) {
  // Only now: server/config.ts reads the environment when it's loaded.
  Object.assign(process.env, env);
  const { LOG_LEVEL } = await import("../server/config.ts");
  const { startLogging } = await import("../server/log.ts");
  const path = await import("node:path");
  startLogging({ dir: path.join(options.dataDir, "logs"), level: LOG_LEVEL, console: options.console, forward: (text) => send({ type: "log", text }) });
  const { startServer } = await import("./server.ts");
  running = await startServer({
    ...options,
    trash: (dir) => host({ method: "trash", dir }),
    reveal: (dir) => host({ method: "reveal", dir }),
    openGlPage: async (url) => {
      const pageId = await host<number>({ method: "glOpen", url });
      return {
        evaluate: <A, R>(fn: (arg: A) => R | Promise<R>, arg: A) => host<R>({ method: "glEvaluate", pageId, source: fn.toString(), arg }),
        close: () => host<void>({ method: "glClose", pageId }),
      };
    },
  });
  running.onEngineWindow((event) => send({ type: "engineWindow", event }));
  send({ type: "ready", port: running.port });
}

/** A call from the main process (`ServerCall`). */
async function answer(call: ServerCall): Promise<unknown> {
  if (!running) throw new Error("The server isn't running yet.");
  switch (call.method) {
    case "setHostWindow":
      return running.setHostWindow(call.host);
    case "raiseEngineWindow":
      return running.raiseEngineWindow(call.owner, call.id);
    case "closeEngineWindows":
      return running.closeEngineWindows();
  }
}

port.on("message", ({ data }) => {
  const message = data as ServerMessage;
  if (message.type === "start") {
    start(message).catch((err) => send({ type: "failed", error: describeError(err) }));
  } else if (message.type === "reply") {
    const pending = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.ok) pending?.resolve(message.value);
    else pending?.reject(new Error(message.error));
  } else if (message.type === "call") {
    answer(message.call as ServerCall).then(
      (value) => send({ type: "reply", id: message.id, ok: true, value }),
      (err) => send({ type: "reply", id: message.id, ok: false, error: describeError(err) }),
    );
  } else if (message.type === "close") {
    running?.close();
    running = null;
    // Lines still waiting go before the process does.
    void import("../server/log.ts")
      .then(({ settleLog }) => settleLog())
      .finally(() => send({ type: "closed" }));
  }
});
