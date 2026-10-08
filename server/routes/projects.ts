import type { ProjectPreviews, PreviewInputs } from "../project-previews.ts";
import { HttpError, isObject } from "../storage.ts";
import { Router, json, raw } from "express";
import { PROJECT_NOTICE_HEADER } from "../../shared/types.ts";
import { MAX_COVER_BYTES, type ProjectStore } from "../projects.ts";
import { log } from "../log.ts";

const logger = log("projects");

/** `/api/projects`: the recents, each project's document and its package. `onRemove` cleans up after a deleted one. */
export function projectRoutes(projects: ProjectStore, previews: ProjectPreviews, onRemove?: (id: string) => Promise<void>): Router {
  const router = Router();
  router.use(json({ limit: "10mb" }));

  router.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(projects.list());
  });
  router.post("/", async (req, res) => {
    res.status(201).json(await projects.create(req.body));
  });
  router.post("/open", async (req, res) => {
    res.json(await projects.openPath(req.body));
  });
  router.get("/location", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(projects.getLocation());
  });
  router.put("/location", async (req, res) => {
    res.json(await projects.setLocation(req.body));
  });
  router.get("/templates", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(projects.templates());
  });
  router.delete("/templates/:suite", async (req, res) => {
    res.json(await projects.clearTemplate(req.params.suite));
  });
  router.post("/:id/template", async (req, res) => {
    res.json(await projects.saveTemplate(req.params.id));
  });
  router.get("/:id/preview", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await previews.get(req.params.id));
  });
  router.post("/:id/preview", async (req, res) => {
    if (!isObject(req.body) || typeof req.body.revision !== "number") throw new HttpError(400, "Expected a preview revision.");
    res.setHeader("Cache-Control", "no-store");
    res.json(await previews.ensure(req.params.id, req.body.revision, req.body as PreviewInputs));
  });
  router.get("/:id/preview/media", async (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(await previews.file(req.params.id, false), { dotfiles: "allow" });
  });
  router.get("/:id/preview/poster", async (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(await previews.file(req.params.id, true), { dotfiles: "allow" });
  });
  // The body is the image itself (a JPEG or PNG the tab drew); its first bytes say which, whatever it's labelled.
  router.put("/:id/cover", raw({ type: ["image/*", "application/octet-stream"], limit: MAX_COVER_BYTES }), async (req, res) => {
    await projects.saveCover(req.params.id, req.body);
    res.sendStatus(204);
  });
  router.get("/:id/cover", (req, res) => {
    // Its URL changes with it (`?v=`), but the card asks again rather than trust a cached one.
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(projects.coverFile(req.params.id), { dotfiles: "allow" });
  });
  router.get("/:id", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const { doc, notice } = await projects.openDoc(req.params.id);
    // What the check on opening changed (headers are Latin-1: encoded).
    if (notice) res.setHeader(PROJECT_NOTICE_HEADER, encodeURIComponent(notice));
    res.json(doc);
  });
  router.put("/:id", async (req, res) => {
    res.json(await projects.save(req.params.id, req.body));
  });
  router.patch("/:id", async (req, res) => {
    res.json(await projects.update(req.params.id, req.body));
  });
  router.post("/:id/opened", async (req, res) => {
    res.json(await projects.opened(req.params.id));
  });
  router.post("/:id/closed", async (req, res) => {
    res.json(await projects.closed(req.params.id));
  });
  router.post("/:id/reveal", async (req, res) => {
    await projects.reveal(req.params.id);
    res.sendStatus(204);
  });
  router.post("/:id/duplicate", async (req, res) => {
    res.status(201).json(await projects.duplicate(req.params.id));
  });
  router.delete("/:id/recent", async (req, res) => {
    await projects.forget(req.params.id);
    res.sendStatus(204);
  });
  router.delete("/:id", async (req, res) => {
    previews.forget(req.params.id);
    await projects.remove(req.params.id);
    await onRemove?.(req.params.id).catch((err) => logger.error("removing its chat failed", err));
    res.sendStatus(204);
  });
  return router;
}
