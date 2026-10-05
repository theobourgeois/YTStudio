import { Router, json } from "express";
import { isObject, HttpError } from "../../storage.ts";
import { AUDIO_SERVER_TOOLS, type AudioIntelligence } from "./service.ts";

export function audioIntelligenceRoutes(service: AudioIntelligence): Router {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/:projectId/hearing", async (req, res) => {
    res.json({ settings: await service.hearingSettings(req.params.projectId), capabilities: service.capabilities() });
  });
  // User consent is intentionally not available as an assistant tool.
  router.patch("/:projectId/hearing", json(), async (req, res) => {
    if (!isObject(req.body)) throw new HttpError(400, "Invalid hearing settings.");
    res.json(await service.setHearingSettings(req.params.projectId, req.body.enabled));
  });
  // Curated references/profiles are user/operator supplied, never model self-reviewed.
  router.post("/:projectId/examples", json({ limit: "10mb" }), async (req, res) => {
    res.status(201).json(await service.examples.add(req.params.projectId, req.body));
  });
  // Local selection/upload and review are user operations; the assistant receives registered IDs only.
  router.post("/:projectId/datasets/import-path", json(), async (req, res) => {
    if (!isObject(req.body)) throw new HttpError(400, "Invalid dataset selection.");
    res.status(202).json(await service.datasets.importPath(req.params.projectId, req.body.path));
  });
  router.post("/:projectId/datasets/upload", async (req, res) => {
    res.status(202).json(await service.datasets.upload(req.params.projectId, req, req.query.name));
  });
  router.get("/:projectId/datasets/:packageId", async (req, res) => {
    res.json(await service.datasets.readiness(req.params.projectId, req.params.packageId));
  });
  router.patch("/:projectId/datasets/:packageId/review", json({ limit: "2mb" }), async (req, res) => {
    res.json(await service.datasets.saveReview(req.params.projectId, req.params.packageId, req.body));
  });
  router.post("/:projectId/datasets/:packageId/profile", json({ limit: "2mb" }), async (req, res) => {
    res.status(201).json(await service.datasets.buildProfile(req.params.projectId, req.params.packageId, req.body));
  });
  router.get("/:projectId/datasets/:packageId/assets/:assetId", async (req, res) => {
    const { asset, file } = await service.datasets.assetFile(req.params.projectId, req.params.packageId, req.params.assetId);
    res.download(file, asset.relativePath.split("/").at(-1)!, { dotfiles: "allow" });
  });
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
