import { Router, json } from "express";
import { availableFormats } from "../encoders.ts";
import type { ExportManager } from "../exports.ts";
import { HttpError } from "../storage.ts";

/** `/api/exports`: render jobs and their files. */
export function exportRoutes(exports: ExportManager): Router {
  const router = Router();

  // Big enough for the text clips drawn by the browser.
  router.post("/", json({ limit: "200mb" }), async (req, res) => {
    res.status(202).json(await exports.create(req.body));
  });
  router.get("/formats", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await availableFormats());
  });
  router.get("/:id", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(exports.get(req.params.id));
  });
  router.delete("/:id", (req, res) => {
    exports.cancel(req.params.id);
    res.sendStatus(204);
  });
  router.get("/:id/download", (req, res, next) => {
    const { file, name } = exports.output(req.params.id);
    // The data folder may be under a dot-folder (e2e/.data, ~/.something): send refuses those by default.
    res.download(file, name, { dotfiles: "allow" }, (err) => {
      if (err && !res.headersSent) next(new HttpError(410, "The exported file is gone."));
    });
  });
  return router;
}
