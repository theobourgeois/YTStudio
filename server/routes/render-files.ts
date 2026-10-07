import { Router, json } from "express";
import type { RenderFiles } from "../render-files.ts";
import { HttpError } from "../storage.ts";

/** `/api/render-files`: a video's render files (Premiere's preview files) and its renders. */
export function renderFileRoutes(renders: RenderFiles): Router {
  const router = Router();

  router.delete("/jobs/:id", (req, res) => {
    renders.cancel(req.params.id);
    res.sendStatus(204);
  });
  router.get("/:projectId", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await renders.state(req.params.projectId));
  });
  // Big enough for the text clips drawn by the browser (as an export's).
  router.post("/:projectId", json({ limit: "200mb" }), async (req, res) => {
    res.status(202).json(await renders.start(req.params.projectId, req.body));
  });
  router.delete("/:projectId", async (req, res) => {
    res.json(await renders.remove(req.params.projectId));
  });
  router.get("/:projectId/:file", (req, res, next) => {
    const key = req.params.file.replace(/\.mp4$/, "");
    // Named by what's in it, so it never changes. (A package can be under a dot-folder: allowed.)
    res.sendFile(renders.file(req.params.projectId, key), { dotfiles: "allow", maxAge: "365d", immutable: true }, (err) => {
      if (err && !res.headersSent) next(new HttpError(404, "Render file not found"));
    });
  });
  return router;
}
