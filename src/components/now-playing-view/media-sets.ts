/**
 * The user's sets of clips for the visualizer (docs/now-playing.md, "Your media"): a set is a folder in the Library's
 * Visualizer folder (friends for a music video, nature for another vibe...), and the visualizer feeds from one at a
 * time. Pure, and tested.
 */
import type { Library, MediaAsset } from "@shared/types";

/** A clip or picture of the visualizer's: its Library item and its media. */
export interface VisualizerMedia {
  itemId: string;
  asset: MediaAsset;
}

/** A set of clips: its folder, its name, its clips and pictures. */
export interface MediaSet {
  id: string;
  name: string;
  media: VisualizerMedia[];
}

/** The set the clips already in the Visualizer folder go into, and the first one made. */
export const FIRST_SET = "My clips";

/** What the visualizer can feed in: a clip with a picture, or a picture. */
export const usable = (asset: MediaAsset | undefined): asset is MediaAsset =>
  !!asset && asset.status !== "error" && (asset.kind === "image" || (asset.kind === "video" && asset.hasVideo));

/**
 * The sets in the Visualizer folder (`rootId`), the oldest first, each with what's in it or in its own folders; and
 * what's in the Visualizer folder itself, in no set (added before there were sets, or in the Library by hand).
 */
export function readSets(library: Library, rootId: string | null): { sets: MediaSet[]; loose: VisualizerMedia[] } {
  if (!rootId) return { sets: [], loose: [] };
  const parents = new Map(library.folders.map((f) => [f.id, f.parentId]));
  // The set a folder is in (itself, or the one above it right under the Visualizer folder).
  const setOf = (folderId: string | null): string | null => {
    for (let id = folderId, depth = 0; id && depth < 64; depth++) {
      const parent = parents.get(id);
      if (parent === rootId) return id;
      id = parent ?? null;
    }
    return null;
  };
  const sets = library.folders
    .filter((f) => f.parentId === rootId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((f): MediaSet => ({ id: f.id, name: f.name, media: [] }));
  const byId = new Map(sets.map((s) => [s.id, s]));
  const assets = new Map(library.media.map((a) => [a.id, a]));
  const loose: VisualizerMedia[] = [];
  for (const item of library.items) {
    if (item.kind !== "media") continue;
    const asset = assets.get(item.mediaId);
    if (!usable(asset)) continue;
    if (item.folderId === rootId) loose.push({ itemId: item.id, asset });
    else byId.get(setOf(item.folderId) ?? "")?.media.push({ itemId: item.id, asset });
  }
  return { sets, loose };
}

/** The set in use: the one kept, if it's still there, else the first. */
export function currentSet(sets: readonly MediaSet[], kept: string | null): MediaSet | null {
  return sets.find((s) => s.id === kept) ?? sets[0] ?? null;
}

/** The set after `id` (going round), for K. */
export function nextSet(sets: readonly MediaSet[], id: string | null): MediaSet | null {
  if (!sets.length) return null;
  const at = sets.findIndex((s) => s.id === id);
  return sets[(at + 1) % sets.length];
}

/** A name for a new set no other has: "Set 2", "Set 3"... */
export function newSetName(sets: readonly Pick<MediaSet, "name">[]): string {
  const taken = new Set(sets.map((s) => s.name.trim().toLowerCase()));
  for (let n = sets.length + 1; ; n++) if (!taken.has(`set ${n}`)) return `Set ${n}`;
}
