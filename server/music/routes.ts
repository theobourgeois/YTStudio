import { Router, json } from "express";
import type { AudioEngine } from "./engine.ts";

/** `/api/engine`: the music suite's audio engine (the plugins it found, and commands to it). */
export function engineRoutes(engine: AudioEngine): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/plugins", async (_req, res) => {
    res.json(await engine.plugins());
  });
  router.get("/devices", async (_req, res) => {
    res.json(await engine.devices());
  });
  router.post("/devices", json(), async (req, res) => {
    res.json(await engine.setDevice(req.body));
  });
  // The whole document, on every edit while it's open.
  router.post("/song", json({ limit: "10mb" }), async (req, res) => {
    res.json(await engine.setSong(req.body));
  });
  router.get("/events", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": connected\n\n");
    const stop = engine.onEvent((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    req.on("close", stop);
  });
  router.post("/:command", json(), async (req, res) => {
    res.json(await engine.command(req.params.command, req.body));
  });
  return router;
}
