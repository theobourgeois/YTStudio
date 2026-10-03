import { Router, json } from "express";
import type { ProjectStore } from "../projects.ts";

/** `/api/projects`: the recents, each project's document and its package. `onRemove` cleans up after a deleted one. */
export function projectRoutes(projects: ProjectStore, onRemove?: (id: string) => Promise<void>): Router {
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
  router.get("/:id", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await projects.get(req.params.id));
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
    await projects.remove(req.params.id);
    await onRemove?.(req.params.id).catch((err) => console.error(err));
    res.sendStatus(204);
  });
  return router;
}
