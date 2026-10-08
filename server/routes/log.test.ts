import { mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { expect, it, vi } from "vitest";
import { logFile, settleLog, startLogging } from "../log.ts";
import { HttpError } from "../storage.ts";
import { logRequests, logRoutes } from "./log.ts";

it("takes the tab's lines, refuses what isn't, shows the file, and logs each request at debug", async () => {
  startLogging({ dir: mkdtempSync(path.join(os.tmpdir(), "log-routes-")), level: "debug", console: false });
  const reveal = vi.fn(async (_file: string) => {});
  const app = express();
  app.use(logRequests());
  app.use("/api/log", logRoutes(reveal));
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/log`;
  const post = (body: unknown, suffix = "") => fetch(url + suffix, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    expect((await post({ entries: [{ level: "error", scope: "autosave", message: "failed", time: 0 }] })).status).toBe(204);
    expect((await post({ entries: [{ level: "shout", scope: "a", message: "b", time: 0 }] })).status).toBe(400);
    expect((await post({}, "/reveal")).status).toBe(204);
    expect(reveal).toHaveBeenCalledWith(logFile());
    await settleLog();
    const written = readFileSync(logFile()!, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { scope: string; message: string; from?: string });
    expect(written).toContainEqual(expect.objectContaining({ scope: "autosave", from: "tab", message: "failed" }));
    expect(written.filter((l) => l.scope === "http").map((l) => l.message.replace(/\d+ ms/, "_ ms"))).toEqual([
      "POST /api/log 204 in _ ms",
      "POST /api/log 400 in _ ms",
      "POST /api/log/reveal 204 in _ ms",
    ]);
  } finally {
    server.close();
  }
});
