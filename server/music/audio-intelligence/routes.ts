import { Router, json } from "express";
import { isObject, HttpError } from "../../storage.ts";
import { AUDIO_SERVER_TOOLS, type AudioIntelligence } from "./service.ts";

export function audioIntelligenceRoutes(service: AudioIntelligence): Router {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.post("/:projectId/capture", json({ limit: "10mb" }), async (req, res) => {
    res.json(await service.capture(req.params.projectId, req.body));
  });
  router.post("/:projectId/tools/:name", json(), async (req, res) => {
    if (!(AUDIO_SERVER_TOOLS as readonly string[]).includes(req.params.name) || !isObject(req.body)) throw new HttpError(400, "Invalid audio tool request.");
    res.json(await service.tool(req.params.projectId, req.params.name, req.body));
  });
  router.get("/:projectId/artifacts/:id", async (req, res) => { res.json(await service.artifact(req.params.projectId, req.params.id)); });
  router.get("/:projectId/artifacts/:id/audio", async (req, res) => {
    await service.artifact(req.params.projectId, req.params.id);
    res.sendFile(service.audioFile(req.params.projectId, req.params.id), { dotfiles: "allow" });
  });
  return router;
}
