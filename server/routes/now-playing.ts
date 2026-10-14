import { Router, json } from "express";
import type { NowPlaying } from "../now-playing.ts";

/** `/api/now-playing`: what the computer's music player is playing, and telling it what to do. */
export function nowPlayingRoutes(nowPlaying: NowPlaying): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await nowPlaying.status());
  });
  router.post("/", json(), async (req, res) => {
    res.json(await nowPlaying.command(req.body));
  });
  return router;
}
