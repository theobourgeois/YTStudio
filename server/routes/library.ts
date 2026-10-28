import { Router, json } from "express";
import type { LibraryStore } from "../library.ts";
import type { ModelSearch } from "../model-search.ts";
import type { WebMediaLibrary } from "../web-media.ts";
import { queryString } from "./util.ts";

/** `/api/library`: media and saved clips shared by every project. */
export function libraryRoutes(library: LibraryStore, web: WebMediaLibrary, models: ModelSearch): Router {
  const router = Router();
  const body = json({ limit: "10mb" });

  router.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(library.snapshot());
  });

  router.post("/folders", body, async (req, res) => {
    res.status(201).json(await library.createFolder(req.body));
  });
  router.patch("/folders/:id", body, async (req, res) => {
    res.json(await library.updateFolder(req.params.id, req.body));
  });
  router.delete("/folders/:id", async (req, res) => {
    await library.removeFolder(req.params.id);
    res.sendStatus(204);
  });

  // The body is the raw file; no body parser runs on this route.
  router.post("/items", async (req, res) => {
    const folderId = queryString(req.query.folderId) || null;
    res.status(201).json(await library.upload(req, queryString(req.query.name), folderId));
  });
  router.post("/items/web", body, async (req, res) => {
    res.status(201).json(await library.addFromWeb(req.body, web));
  });
  router.post("/items/model", body, async (req, res) => {
    res.status(201).json(await library.addModel(req.body, models));
  });
  router.post("/items/media", body, async (req, res) => {
    res.status(201).json(await library.addMedia(req.body));
  });
  router.post("/items/clips", body, async (req, res) => {
    res.status(201).json(await library.addClips(req.body));
  });
  router.patch("/items/:id", body, async (req, res) => {
    res.json(await library.updateItem(req.params.id, req.body));
  });
  router.delete("/items/:id", async (req, res) => {
    await library.removeItem(req.params.id);
    res.sendStatus(204);
  });
  router.post("/items/:id/use", body, async (req, res) => {
    res.json(await library.use(req.params.id, req.body));
  });

  router.get("/media/:id", (req, res) => {
    res.json(library.getMedia(req.params.id));
  });
  return router;
}
