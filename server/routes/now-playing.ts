import { Router, json } from "express";
import type { DownloadedModel } from "../models.ts";
import type { NowPlaying } from "../now-playing.ts";
import { HttpError } from "../storage.ts";

/**
 * `/api/now-playing`: what the computer's music player is playing, and telling it what to do; and the vibe's model
 * (CLAP's audio side, `shared/signals/vibe.ts`): whether it's here, its download (asked for by the user), its file.
 */
export function nowPlayingRoutes(nowPlaying: NowPlaying, vibe: DownloadedModel): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await nowPlaying.status());
  });
  router.post("/", json(), async (req, res) => {
    res.json(await nowPlaying.command(req.body));
  });
  router.get("/vibe", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await vibe.status());
  });
  router.post("/vibe/setup", async (_req, res) => {
    await vibe.setUp();
    res.status(202).json(await vibe.status());
  });
  router.get("/vibe/file", async (_req, res, next) => {
    const file = await vibe.file();
    if (!file) throw new HttpError(404, "The vibe's model isn't downloaded: POST /api/now-playing/vibe/setup first.");
    res.sendFile(file, { headers: { "Cache-Control": "no-cache" }, dotfiles: "allow" }, (error) => error && next(error));
  });
  return router;
}
