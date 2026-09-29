import { Router } from "express";
import type { MediaLibrary } from "../media.ts";
import type { ProjectStore } from "../projects.ts";
import { HttpError } from "../storage.ts";
import { queryString } from "./util.ts";

/** `/api/media`: each project's imported media. */
export function mediaRoutes(library: MediaLibrary, projects: ProjectStore): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const projectId = queryString(req.query.projectId);
    if (!projectId) throw new HttpError(400, "The projectId query parameter is required.");
    if (!projects.has(projectId)) throw new HttpError(404, "Project not found");
    res.json(library.list(projectId));
  });
  // The body is the raw file; no body parser runs on this route.
  router.post("/", async (req, res) => {
    const projectId = queryString(req.query.projectId);
    const name = queryString(req.query.name);
    res.status(201).json(await library.ingest(req, name, projectId, () => projects.has(projectId)));
  });
  router.get("/:id", (req, res) => {
    res.json(library.get(req.params.id));
  });
  router.delete("/:id", async (req, res) => {
    await library.remove(req.params.id);
    res.sendStatus(204);
  });
  return router;
}
