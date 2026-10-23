/**
 * The main process's side of the server's own process (server-process.ts): starts it, answers what it asks
 * (the Trash, Show in Folder, the export's drawing page), writes its log lines, and starts it again if it dies. To the rest of main.ts it's the server as before (`RunningServer`).
 */
import path from "node:path";
import { type UtilityProcess, shell, utilityProcess } from "electron";
import type { GlPage } from "../server/gl-browser.ts";
import { log, writeLogLines } from "../server/log.ts";
import { openWindowPage } from "./gl-window.ts";
import type { RunningServer, ServerOptions } from "./server.ts";
import { type HostCall, type ServerMessage, type ServerStart, describeError } from "./server-protocol.ts";

/** A server that dies is started again, but not more than this many times a minute (it would only die again). */
const MAX_RESTARTS_A_MINUTE = 3;
/** How long the server has to stop (the engine saving its plugins' states) before the app quits anyway. */
const CLOSE_TIMEOUT_MS = 4000;

export interface HostedServer extends RunningServer {
  /** Stop it and wait for it to have stopped (or `CLOSE_TIMEOUT_MS`). */
  closeAndWait(): Promise<void>;
}

export function startServerProcess(options: Omit<ServerOptions, "trash" | "reveal" | "openGlPage">, console: boolean): Promise<HostedServer> {
  const logger = log("desktop");
  const entry = path.join(import.meta.dirname, "server-process.mjs");
  const pages = new Map<number, GlPage>();
  let nextPage = 0;
  let child: UtilityProcess | null = null;
  let closing = false;
  let closed: (() => void) | null = null;
  const restarts: number[] = [];
  let ports = options.ports;

  /** What the server asks of this process. */
  const answer = async (call: HostCall): Promise<unknown> => {
    switch (call.method) {
      case "trash":
        return shell.trashItem(call.dir);
      case "reveal":
        return shell.showItemInFolder(call.dir);
      case "glOpen": {
        const id = ++nextPage;
        pages.set(id, await openWindowPage(call.url));
        return id;
      }
      case "glEvaluate": {
        const page = pages.get(call.pageId);
        if (!page) throw new Error("The export's drawing page was closed.");
        // The function's source, as Playwright's `evaluate` takes one (gl-window.ts sends it on as source too).
        const fn = { toString: () => call.source } as unknown as (arg: unknown) => unknown;
        return page.evaluate(fn, call.arg);
      }
      case "glClose": {
        const page = pages.get(call.pageId);
        pages.delete(call.pageId);
        return page?.close();
      }
    }
  };

  const launch = (onReady: (port: number) => void, onFailed: (error: Error) => void) => {
    const proc = utilityProcess.fork(entry, [], { serviceName: "YTStudio server", stdio: console ? "inherit" : "ignore" });
    child = proc;
    let ready = false;
    proc.on("message", (message: ServerMessage) => {
      switch (message.type) {
        case "ready":
          ready = true;
          // Started again, it takes the same port: the page's address stays.
          ports = [message.port];
          return onReady(message.port);
        case "failed":
          return onFailed(new Error(message.error));
        case "log":
          return writeLogLines(message.text);
        case "closed":
          return closed?.();
        case "call":
          answer(message.call as HostCall).then(
            (value) => proc.postMessage({ type: "reply", id: message.id, ok: true, value: value ?? null } satisfies ServerMessage),
            (err) => proc.postMessage({ type: "reply", id: message.id, ok: false, error: describeError(err) } satisfies ServerMessage),
          );
          return;
      }
    });
    proc.on("exit", (code) => {
      if (child === proc) child = null;
      for (const page of pages.values()) void page.close();
      pages.clear();
      if (closing) return closed?.();
      if (!ready) return onFailed(new Error(`The server stopped as it started (exit ${code}).`));
      logger.error(`the server's process stopped (exit ${code})`);
      const now = Date.now();
      while (restarts.length && now - restarts[0] > 60_000) restarts.shift();
      if (restarts.length >= MAX_RESTARTS_A_MINUTE) return logger.error("the server keeps stopping: not starting it again");
      restarts.push(now);
      launch(
        () => logger.info("the server was started again"),
        (err) => logger.error("the server couldn't be started again", err),
      );
    });
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"));
    proc.postMessage({ type: "start", options: { ...options, ports, console }, env } satisfies ServerStart);
  };

  return new Promise((resolve, reject) => {
    launch((port) => {
      const close = () => {
        closing = true;
        child?.postMessage({ type: "close" } satisfies ServerMessage);
      };
      resolve({
        port,
        close,
        closeAndWait() {
          if (!child) return Promise.resolve();
          const proc = child;
          return new Promise<void>((done) => {
            const timer = setTimeout(() => {
              proc.kill();
              done();
            }, CLOSE_TIMEOUT_MS);
            closed = () => {
              clearTimeout(timer);
              proc.kill();
              done();
            };
            close();
          });
        },
      });
    }, reject);
  });
}
