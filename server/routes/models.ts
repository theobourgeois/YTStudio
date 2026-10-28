import { Router, json } from "express";
import type { ModelSearch } from "../model-search.ts";
import { queryString } from "./util.ts";

/** `/api/models`: the visualizer's 3D model search (its sites and their keys); adding one is the Library's. */
export function modelRoutes(models: ModelSearch): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(models.status());
  });
  router.put("/keys/:source", json(), async (req, res) => {
    res.json(await models.setKey(req.params.source, req.body));
  });
  router.get("/search", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const { q, source, animated, cursor } = req.query;
    res.json(await models.search({ q: queryString(q), source: queryString(source), animated: queryString(animated), cursor: queryString(cursor) }));
  });
  return router;
}
