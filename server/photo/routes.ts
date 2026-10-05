/** `/api/photo/lab`: the photo lab's sources, decoded tiles, blobs and exports (shared/photo/lab.ts). */
import { Router, json, raw } from "express";
import type { ExportRequest, TileSize } from "../../shared/photo/lab.ts";
import { HttpError } from "../storage.ts";
import { MAX_TILE_BYTES } from "./blobs.ts";
import type { PhotoLab } from "./lab.ts";
import type { ExportStart, PhotoService } from "./service.ts";

const tileOf = (value: unknown): TileSize => {
  const n = Number(value ?? 256);
  if (n !== 256 && n !== 512) throw new HttpError(400, "tile must be 256 or 512.");
  return n;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function photoLabRoutes(lab: PhotoLab): Router {
  const router = Router();
  // Paths are the server's own (a data folder can be a dot-folder: e2e's is e2e/.data).
  const immutable = { headers: { "Cache-Control": "public, max-age=31536000, immutable" }, dotfiles: "allow" as const };

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

  router.post("/exports", json(), async (req, res) => {
    const body = (req.body ?? {}) as Partial<ExportRequest>;
    const request: ExportRequest = {
      name: text(body.name),
      width: Number(body.width),
      height: Number(body.height),
      bits: body.bits === 16 ? 16 : 8,
      format: body.format === "jpeg" ? "jpeg" : "png",
      quality: typeof body.quality === "number" ? body.quality : undefined,
    };
    if (!Number.isInteger(request.width) || !Number.isInteger(request.height) || request.width < 1 || request.height < 1) {
      throw new HttpError(400, "width and height must be positive integers.");
    }
    res.status(201).json({ id: await lab.beginExport(request) });
  });
  // The body is whole rows of samples, starting at row `from`.
  router.put("/exports/:id/rows", raw({ type: () => true, limit: "128mb" }), async (req, res) => {
    await lab.exportRows(req.params.id, Number(req.query.from), req.body as Buffer);
    res.status(204).end();
  });
  router.post("/exports/:id/finish", async (req, res) => {
    res.json(await lab.finishExport(req.params.id));
  });
  router.delete("/exports/:id", async (req, res) => {
    await lab.cancelExport(req.params.id);
    res.status(204).end();
  });
  router.get("/exports/:name", (req, res, next) => {
    lab.exportStream(req.params.name).on("error", next).pipe(res.type(req.params.name.endsWith(".png") ? "png" : "jpeg"));
  });
  router.get("/exports/:name/compare", async (req, res) => {
    res.json(await lab.compare(req.params.name, text(req.query.source)));
  });

  return router;
}

/** `/api/photo`: the photo suite's own routes (a project's decoded images, exports). */
export function photoRoutes(photo: PhotoService): Router {
  const router = Router();
  // Paths are the server's own (a data folder can be a dot-folder: e2e's is e2e/.data).
  const immutable = { headers: { "Cache-Control": "no-cache" }, dotfiles: "allow" as const };
  const params = (req: { params: Record<string, string> }) => [req.params.projectId, req.params.mediaId] as const;

  router.get("/projects/:projectId/media/:mediaId/layout", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await photo.layout(...params(req), tileOf(req.query.tile)));
  });
  // Byte ranges of the tile-major file: a band of tile rows is one contiguous range.
  router.get("/projects/:projectId/media/:mediaId/raw", async (req, res, next) => {
    res.sendFile(await photo.rawFile(...params(req), tileOf(req.query.tile)), immutable, (error) => error && next(error));
  });
  router.get("/projects/:projectId/media/:mediaId/preview", async (req, res, next) => {
    res.sendFile(await photo.previewFile(...params(req), tileOf(req.query.tile)), immutable, (error) => error && next(error));
  });

  router.post("/exports", json(), async (req, res) => {
    const body = (req.body ?? {}) as Partial<ExportStart>;
    res.status(201).json({
      id: await photo.beginExport({
        projectId: text(body.projectId),
        name: text(body.name),
        width: Number(body.width),
        height: Number(body.height),
        bits: body.bits === 16 ? 16 : 8,
        format: body.format === "jpeg" ? "jpeg" : "png",
        quality: typeof body.quality === "number" ? Math.max(1, Math.min(100, Math.round(body.quality))) : undefined,
        destination: typeof body.destination === "string" && body.destination ? body.destination : null,
      }),
    });
  });
  router.put("/exports/:id/rows", raw({ type: () => true, limit: "128mb" }), async (req, res) => {
    await photo.exports.rows(req.params.id, Number(req.query.from), req.body as Buffer);
    res.status(204).end();
  });
  router.post("/exports/:id/finish", async (req, res) => {
    const result = await photo.exports.finish(req.params.id);
    res.json({ ...result, download: `/api/photo/exports/${req.params.id}/file` });
  });
  router.delete("/exports/:id", async (req, res) => {
    await photo.exports.cancel(req.params.id);
    res.status(204).end();
  });
  router.get("/exports/:id/file", (req, res, next) => {
    const { name } = photo.exports.file(req.params.id);
    res.attachment(name);
    photo.exports.stream(req.params.id).on("error", next).pipe(res);
  });
  router.get("/exports/:id/compare", async (req, res) => {
    res.json(await photo.compare(req.params.id, text(req.query.projectId), text(req.query.mediaId)));
  });

  return router;
}
