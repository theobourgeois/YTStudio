import { Router, json } from "express";
import type { TranscriptionService } from "../transcription/service.ts";

/** `/api/transcription`: speech-to-text engines (and setting them up) and transcription jobs. */
export function transcriptionRoutes(transcription: TranscriptionService): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/engines", async (_req, res) => {
    res.json(await transcription.listEngines());
  });
  router.post("/engines/:id/setup", json(), async (req, res) => {
    res.json(await transcription.setUp(req.params.id, req.body));
  });
  router.delete("/engines/:id/setup", async (req, res) => {
    res.json(await transcription.forget(req.params.id));
  });

  router.post("/jobs", json({ limit: "1mb" }), async (req, res) => {
    res.status(202).json(await transcription.create(req.body));
  });
  router.get("/jobs/:id", (req, res) => {
    res.json(transcription.get(req.params.id));
  });
  router.delete("/jobs/:id", (req, res) => {
    transcription.cancel(req.params.id);
    res.sendStatus(204);
  });
  return router;
}
