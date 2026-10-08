import { type Request, type RequestHandler, Router, json } from "express";
import { pageLogEntries } from "../../shared/log.ts";
import { log, logFile, writePageLog } from "../log.ts";
import { HttpError } from "../storage.ts";

/** A request this long is worth a line of its own (streams and files aside). */
const SLOW_MS = 5000;

/** `/api/log`: the tab's lines into the log, and the log shown in Finder. */
export function logRoutes(reveal: (file: string) => Promise<void>): Router {
  const router = Router();
  router.post("/", json({ limit: "256kb" }), (req, res) => {
    const entries = pageLogEntries(req.body);
    if (!entries) throw new HttpError(400, "Expected { entries: [{ level, scope, message, time }] }, at most 50.");
    writePageLog(entries);
    res.sendStatus(204);
  });
  router.post("/reveal", async (_req, res) => {
    const file = logFile();
    if (!file) throw new HttpError(404, "This server keeps no log (it was started without one).");
    await reveal(file);
    res.sendStatus(204);
  });
  return router;
}

/**
 * Every request's outcome at debug, and one that took long at info: what the server was busy with. Failures are
 * the error handler's to say (it has the error). Costs nothing while neither level is written.
 */
export function logRequests(): RequestHandler {
  const logger = log("http");
  return (req, res, next) => {
    if (!logger.enabled("info")) return next();
    const started = performance.now();
    res.once("finish", () => {
      const ms = Math.round(performance.now() - started);
      const where = requestPath(req);
      const streamed = where.startsWith("/files/") || String(res.getHeader("content-type") ?? "").startsWith("text/event-stream");
      const message = `${req.method} ${where} ${res.statusCode} in ${ms} ms`;
      if (ms >= SLOW_MS && !streamed) logger.info(message);
      else logger.debug(message);
    });
    next();
  };
}

/** A request's path as it was asked for, without its query (searches), wherever in the routers it is now. */
export const requestPath = (req: Request) => req.originalUrl.split("?")[0];
