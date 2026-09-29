import { Router, json } from "express";
import { clamp } from "../../shared/math.ts";
import type { MediaLibrary } from "../media.ts";
import type { MusicAnalysis } from "../../shared/types.ts";
import { analyseMusic, analyseSound, detectScenes, extractFrame } from "../media-analysis.ts";
import type { ProjectStore } from "../projects.ts";
import { HttpError, isObject } from "../storage.ts";
import { queryString } from "./util.ts";

/** A number query parameter, or `fallback` when it's missing or not a number. */
const queryNumber = (value: unknown, fallback: number) => {
  const n = typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/** `/api/media`: each project's imported media. */
export function mediaRoutes(library: MediaLibrary, projects: ProjectStore): Router {
  const router = Router();
  // The last few music analyses (the assistant often asks again about the same song).
  const music = new Map<string, Promise<MusicAnalysis>>();

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
  router.post("/import-file", json(), async (req, res) => {
    const body: unknown = req.body;
    const projectId = isObject(body) && typeof body.projectId === "string" ? body.projectId : "";
    if (!projects.has(projectId)) throw new HttpError(404, "Project not found");
    res.status(201).json(await library.importFile(isObject(body) ? body.path : undefined, projectId, () => projects.has(projectId)));
  });
  router.get("/:id", (req, res) => {
    res.json(library.get(req.params.id));
  });
  router.get("/:id/frame", async (req, res) => {
    const asset = library.get(req.params.id);
    if (!asset.hasVideo) throw new HttpError(400, "That file has no picture.");
    const t = clamp(queryNumber(req.query.t, 0), 0, Math.max(0, asset.duration - 0.01));
    const width = Math.round(clamp(queryNumber(req.query.w, 480), 32, 1920));
    const jpeg = await extractFrame(library.sourcePath(asset), { t, width, still: asset.kind === "image" });
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.type("jpeg").send(jpeg);
  });
  router.get("/:id/sound", async (req, res) => {
    const asset = library.get(req.params.id);
    if (!asset.hasAudio) throw new HttpError(400, "That file has no sound.");
    const from = clamp(queryNumber(req.query.from, 0), 0, asset.duration);
    const to = clamp(queryNumber(req.query.to, asset.duration), from, asset.duration);
    const threshold = clamp(queryNumber(req.query.threshold, -35), -90, 0);
    const minSilence = clamp(queryNumber(req.query.min, 0.4), 0.05, 60);
    res.setHeader("Cache-Control", "no-store");
    res.json(await analyseSound(library.sourcePath(asset), { from, to, threshold, minSilence }));
  });
  router.get("/:id/music", async (req, res) => {
    const asset = library.get(req.params.id);
    if (!asset.hasAudio) throw new HttpError(400, "That file has no sound.");
    const from = Math.round(clamp(queryNumber(req.query.from, 0), 0, asset.duration) * 1000) / 1000;
    const to = Math.round(clamp(queryNumber(req.query.to, asset.duration), from, asset.duration) * 1000) / 1000;
    const key = `${asset.id}:${from}:${to}`;
    let analysis = music.get(key);
    if (!analysis) {
      analysis = analyseMusic(library.sourcePath(asset), from, to);
      analysis.catch(() => music.delete(key));
      music.set(key, analysis);
      if (music.size > 20) music.delete(music.keys().next().value!);
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(await analysis);
  });
  router.get("/:id/scenes", async (req, res) => {
    const asset = library.get(req.params.id);
    if (asset.kind !== "video") throw new HttpError(400, "Only videos have shots.");
    const threshold = clamp(queryNumber(req.query.threshold, 0.3), 0.05, 1);
    res.setHeader("Cache-Control", "no-store");
    res.json({ cuts: await detectScenes(library.sourcePath(asset), threshold) });
  });
  router.delete("/:id", async (req, res) => {
    await library.remove(req.params.id);
    res.sendStatus(204);
  });
  return router;
}
