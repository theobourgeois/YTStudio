/**
 * A canvas crop's masks in document pixels (adjustment and generator layers'), moved with the canvas by whole pixels
 * (`shared/photo/surface-shift.ts`): renumbered when the move is whole tiles, else each new tile made from the old
 * ones' samples, hashed in the Worker and uploaded as a stroke's tiles are (the publication gate holds the save until
 * the server has them). Image › Image Rotation flips or turns them the same way (`shared/photo/surface-orient.ts`).
 */
import type { Size } from "@shared/photo/geometry";
import type { Orientation } from "@shared/photo/orient";
import { orientedManifest, orientedTile, planOrient } from "@shared/photo/surface-orient";
import { composeShiftedTile, planShift, shiftedManifest } from "@shared/photo/surface-shift";
import { FORMAT_INFO, isHash, tileHashes } from "@shared/photo/surfaces";
import type { SurfaceId } from "@shared/photo/types";
import type { SurfaceUploads } from "../uploads";

/** Surface `id` moved by (dx, dy) onto a grid of `size`: the new surface's id. */
export async function shiftSurface(uploads: SurfaceUploads, id: SurfaceId, dx: number, dy: number, size: Size): Promise<SurfaceId> {
  const manifest = await uploads.manifest(id);
  const plan = planShift(manifest, dx, dy, size);
  // Whole tiles: the same tiles, numbered again (any not uploaded yet go with it).
  if ("manifest" in plan) return uploads.add(plan.manifest, tileHashes(plan.manifest));
  const needed = [...new Set(plan.tiles.flatMap((t) => t.sources.map((s) => s.ref)).filter((r): r is string => r !== null && isHash(r)))];
  const bytes = new Map<string, Uint16Array>();
  await Promise.all(needed.map(async (hash) => bytes.set(hash, new Uint16Array(await uploads.tile(hash)))));
  const tiles = plan.tiles.map((t) => composeShiftedTile(manifest, t, (ref) => bytes.get(ref)!).buffer as ArrayBuffer);
  const { refs } = await uploads.hash(tiles, FORMAT_INFO[manifest.format].channels);
  const moved = shiftedManifest(manifest, plan.tiles, refs);
  return uploads.add(moved, tileHashes(moved));
}

/** Each of `ids` moved (old id → new), all at once. */
export async function shiftSurfaces(uploads: SurfaceUploads, ids: readonly SurfaceId[], dx: number, dy: number, size: Size): Promise<Map<SurfaceId, SurfaceId>> {
  const moved = await Promise.all(ids.map((id) => shiftSurface(uploads, id, dx, dy, size)));
  return new Map(ids.map((id, i) => [id, moved[i]]));
}

/** Surface `id`, in the pixels of a canvas of `size`, flipped or turned with it: the new surface's id. */
export async function orientSurface(uploads: SurfaceUploads, id: SurfaceId, o: Orientation, size: Size): Promise<SurfaceId> {
  const manifest = await uploads.manifest(id);
  const plan = planOrient(manifest, o, size);
  const needed = [...new Set(plan.tiles.flatMap((t) => t.reads))];
  const bytes = new Map<string, Uint16Array>();
  await Promise.all(needed.map(async (hash) => bytes.set(hash, new Uint16Array(await uploads.tile(hash)))));
  const tiles = plan.tiles.map((t) => orientedTile(manifest, o, size, t.tx, t.ty, (ref) => bytes.get(ref)!).buffer as ArrayBuffer);
  const refs = tiles.length ? (await uploads.hash(tiles, FORMAT_INFO[manifest.format].channels)).refs : [];
  const oriented = orientedManifest(manifest, plan, refs);
  return uploads.add(oriented, tileHashes(oriented));
}

/** Each of `ids` oriented (old id → new), all at once. */
export async function orientSurfaces(uploads: SurfaceUploads, ids: readonly SurfaceId[], o: Orientation, size: Size): Promise<Map<SurfaceId, SurfaceId>> {
  const oriented = await Promise.all(ids.map((id) => orientSurface(uploads, id, o, size)));
  return new Map(ids.map((id, i) => [id, oriented[i]]));
}
