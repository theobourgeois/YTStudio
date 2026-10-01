import { Router, json } from "express";
import type { ProjectStore } from "../projects.ts";

/** `/api/projects`: the project list and each project's document. `onRemove` cleans up after a deleted one. */
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
  router.post("/:id/duplicate", async (req, res) => {
    res.status(201).json(await projects.duplicate(req.params.id));
  });
  router.delete("/:id", async (req, res) => {
    await projects.remove(req.params.id);
    await onRemove?.(req.params.id).catch((err) => console.error(err));
    res.sendStatus(204);
  });
  return router;
}
