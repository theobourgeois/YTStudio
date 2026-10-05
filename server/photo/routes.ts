/** `/api/photo/lab`: the photo lab's sources, decoded tiles, blobs and exports (shared/photo/lab.ts). */
import { Router, json, raw } from "express";
import type { ExportRequest, TileSize } from "../../shared/photo/lab.ts";
import { HttpError } from "../storage.ts";
import { MAX_TILE_BYTES } from "./blobs.ts";
import type { PhotoLab } from "./lab.ts";

const tileOf = (value: unknown): TileSize => {
  const n = Number(value ?? 256);
  if (n !== 256 && n !== 512) throw new HttpError(400, "tile must be 256 or 512.");
  return n;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function photoLabRoutes(lab: PhotoLab): Router {
  const router = Router();
  const immutable = { headers: { "Cache-Control": "public, max-age=31536000, immutable" } };

  router.get("/helper", async (_req, res) => {
    res.json(await lab.helperStatus());
  });

  router.delete("/cache", async (_req, res) => {
    await lab.clearCache();
    res.status(204).end();
  });
  router.get("/sources", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(lab.list());
  });
  // The body is the image file itself.
  router.post("/sources", async (req, res) => {
    res.status(201).json(await lab.addSource(req, text(req.query.name) || "image.png"));
  });
  router.get("/sources/:key/layout", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await lab.layout(req.params.key, tileOf(req.query.tile)));
  });
  // Byte ranges of the tile-major file: a band of tile rows is one contiguous range.
  router.get("/sources/:key/raw", async (req, res, next) => {
    res.sendFile(await lab.rawFile(req.params.key, tileOf(req.query.tile)), immutable, (error) => error && next(error));
  });
  router.get("/sources/:key/preview", async (req, res, next) => {
    res.sendFile(await lab.previewFile(req.params.key, tileOf(req.query.tile)), immutable, (error) => error && next(error));
  });

  router.put("/blobs/:hash", raw({ type: () => true, limit: MAX_TILE_BYTES }), async (req, res) => {
    const stored = await lab.blobs.putTile(req.params.hash, req.body as Buffer);
    res.status(stored ? 201 : 200).json({ stored });
  });
  router.get("/blobs/:hash", async (req, res) => {
    const tile = await lab.blobs.getTile(req.params.hash);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.type("application/octet-stream").send(tile);
  });
  router.put("/manifests/:hash", json({ limit: "8mb" }), async (req, res) => {
    const stored = await lab.blobs.putManifest(req.params.hash, req.body);
    res.status(stored ? 201 : 200).json({ stored });
  });
  router.get("/manifests/:hash", async (req, res) => {
    res.json(await lab.blobs.getManifest(req.params.hash));
  });

  // The body is the samples; what they are is in the query.
  router.post("/exports", async (req, res) => {
    const q = req.query;
    const request: ExportRequest = {
      name: text(q.name),
      width: Number(q.width),
      height: Number(q.height),
      bits: Number(q.bits) === 16 ? 16 : 8,
      format: q.format === "jpeg" ? "jpeg" : "png",
      quality: q.quality ? Number(q.quality) : undefined,
    };
    if (!Number.isInteger(request.width) || !Number.isInteger(request.height) || request.width < 1 || request.height < 1) {
      throw new HttpError(400, "width and height must be positive integers.");
    }
    res.status(201).json(await lab.export(req, request));
  });
  router.get("/exports/:name", (req, res, next) => {
    lab.exportStream(req.params.name).on("error", next).pipe(res.type(req.params.name.endsWith(".png") ? "png" : "jpeg"));
  });
  router.get("/exports/:name/compare", async (req, res) => {
    res.json(await lab.compare(req.params.name, text(req.query.source)));
  });

  return router;
}
