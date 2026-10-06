import { Router, json } from "express";
import type { ProjectStore } from "../projects.ts";
import type { WebMediaLibrary } from "../web-media.ts";
import { abortOnClose, queryString } from "./util.ts";

/** `/api/web`: online media (YouTube search, links to any site yt-dlp supports). */
export function webRoutes(web: WebMediaLibrary, projects: ProjectStore): Router {
  const router = Router();

  router.get("/search", async (req, res) => {
    const clips = await web.search(queryString(req.query.q), abortOnClose(res));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.json(clips);
  });
  router.get("/resolve", async (req, res) => {
    const clip = await web.resolve(queryString(req.query.url), abortOnClose(res));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.json(clip);
  });
  router.get("/audio", async (req, res, next) => {
    const file = await web.audio(queryString(req.query.url));
    // The cache is the server's own (in a data folder that may be under a dot folder: e2e's is `e2e/.data`).
    res.sendFile(file, { maxAge: "1y", immutable: true, dotfiles: "allow" }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  });
  router.get("/progress", (req, res) => {
    res.json(web.progress(queryString(req.query.url), req.query.kind));
  });
  router.post("/import", json(), async (req, res) => {
    res.status(201).json(await web.import(req.body, (id) => projects.has(id)));
  });
  return router;
}
