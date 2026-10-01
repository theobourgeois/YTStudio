import { Router, json } from "express";
import type { SampleBrowser } from "./browser.ts";
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
  router.post("/states", async (_req, res) => {
    await engine.saveStates();
    res.sendStatus(204);
  });
  router.post("/states/copy", json(), async (req, res) => {
    res.json(await engine.copyStates(req.body));
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

/** `/api/browser`: the Browser's sample folders (the same for every project), what's in them, and the search. */
export function browserRoutes(browser: SampleBrowser, engine: AudioEngine): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/", (_req, res) => {
    res.json(browser.state());
  });
  router.post("/roots", json(), async (req, res) => {
    res.json(await browser.addRoot(req.body?.path));
  });
  router.delete("/roots", async (req, res) => {
    res.json(await browser.removeRoot(req.query.path));
  });
  router.post("/favourites", json(), async (req, res) => {
    res.json(await browser.setFavourite(req.body?.path, req.body?.favourite));
  });
  router.post("/rescan", async (_req, res) => {
    res.json(await browser.rescan());
  });
  router.get("/list", async (req, res) => {
    res.json(await browser.list(req.query.path));
  });
  router.get("/search", (req, res) => {
    res.json(browser.search(req.query.q, req.query.limit));
  });
  // Hear a file, outside the song (`PreviewFileRequest`); `/api/engine/stopPreview` stops it.
  router.post("/preview", json(), async (req, res) => {
    const file = await browser.audioFile(req.body?.path);
    const start = Number(req.body?.start);
    const id = typeof req.body?.id === "string" ? req.body.id.slice(0, 200) : "";
    res.json(await engine.previewFile(file, Number.isFinite(start) && start > 0 ? start : 0, id));
  });
  // The file itself: its waveform in the Browser, and its bytes when it's added to a project.
  router.get("/file", async (req, res) => {
    res.sendFile(await browser.audioFile(req.query.path), { dotfiles: "allow" });
  });
  return router;
}
