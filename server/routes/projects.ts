import { Router, json } from "express";
import type { ProjectStore } from "../projects.ts";

/** `/api/projects`: the project list and each project's document. */
export function projectRoutes(projects: ProjectStore): Router {
  const router = Router();
  router.use(json({ limit: "10mb" }));

  router.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(projects.list());
  });
  router.post("/", async (req, res) => {
    res.status(201).json(await projects.create(req.body));
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
  router.delete("/:id", async (req, res) => {
    await projects.remove(req.params.id);
    res.sendStatus(204);
  });
  return router;
}
