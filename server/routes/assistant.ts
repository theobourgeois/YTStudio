import { Router, json } from "express";
import type { AssistantService } from "../assistant/service.ts";
import { type Bridge, isTabId } from "../assistant/bridge.ts";
import { HttpError, isObject, isValidId } from "../storage.ts";
import { queryString } from "./util.ts";

/**
 * `/api/assistant`: the in-app assistant's chats, and the editor tabs' side of
 * the tool bridge (their event stream, and the results they post back).
 */
export function assistantRoutes(assistant: AssistantService, bridge: Bridge): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/status", async (_req, res) => {
    res.json(await assistant.status());
  });

  router.get("/events", (req, res) => {
    const tab = queryString(req.query.tab);
    if (!isTabId(tab)) throw new HttpError(400, "Invalid tab.");
    const project = queryString(req.query.project);
    bridge.connect(req, res, tab, isValidId(project) ? project : null);
  });
  router.post("/tabs/:tab/focus", (req, res) => {
    bridge.focus(req.params.tab);
    res.sendStatus(204);
  });
  router.post("/calls/:id/result", json({ limit: "40mb" }), (req, res) => {
    bridge.resolve(req.params.id, isObject(req.body) ? req.body.tab : undefined, req.body);
    res.sendStatus(204);
  });
  router.post("/calls/:id/progress", json(), (req, res) => {
    bridge.progress(req.params.id, isObject(req.body) ? req.body.tab : undefined, req.body);
    res.sendStatus(204);
  });

  router.get("/chats/:projectId", async (req, res) => {
    res.json(await assistant.get(req.params.projectId));
  });
  router.patch("/chats/:projectId", json(), async (req, res) => {
    res.json(await assistant.setModel(req.params.projectId, req.body));
  });
  router.post("/chats/:projectId/messages", json({ limit: "1mb" }), async (req, res) => {
    await assistant.send(req.params.projectId, req.body);
    res.sendStatus(204);
  });
  router.post("/chats/:projectId/stop", async (req, res) => {
    await assistant.stop(req.params.projectId);
    res.sendStatus(204);
  });
  router.delete("/chats/:projectId", async (req, res) => {
    res.json(await assistant.reset(req.params.projectId));
  });
  router.get("/images/:projectId/:name", (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(assistant.imagePath(req.params.projectId, req.params.name), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "Not found" });
    });
  });
  return router;
}
