import { Router, json } from "express";
import type { AudioEngine } from "../music/engine.ts";

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
  router.post("/:command", json(), async (req, res) => {
    res.json(await engine.command(req.params.command, req.body));
  });
  return router;
}
