import { Router, json } from "express";
import type { LookRatings } from "../look-ratings.ts";
import type { DownloadedModel } from "../models.ts";
import type { NowPlaying } from "../now-playing.ts";
import { HttpError } from "../storage.ts";

/**
 * `/api/now-playing`: what the computer's music player is playing, and telling it what to do; and the vibe's model
 * (CLAP's audio side, `shared/signals/vibe.ts`): whether it's here, its download (asked for by the user), its file; and
 * the visualizer's looks as rated (`shared/look-ratings.ts`).
 */
export function nowPlayingRoutes(nowPlaying: NowPlaying, vibe: DownloadedModel, ratings: LookRatings): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await nowPlaying.status());
  });
  router.post("/", json(), async (req, res) => {
    res.json(await nowPlaying.command(req.body));
  });
  router.get("/cover/:hash", (req, res) => {
    const cover = nowPlaying.cover(req.params.hash);
    if (!cover) throw new HttpError(404, "That cover isn't the song playing now: GET /api/now-playing for its URL.");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.type(cover.type).send(cover.data);
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
  router.get("/ratings", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ratings: await ratings.list() });
  });
  router.post("/ratings", json(), async (req, res) => {
    res.status(201).json(await ratings.add(req.body));
  });
  return router;
}
