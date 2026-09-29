import type { LibraryFolder, LibraryItem, MediaAsset } from "@shared/types";
import { libraryItemKind, recentItems, searchItems } from "@shared/library";
import type { LibraryFilter, LibraryView } from "@/stores/library";

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/**
 * What the Library tab lists: a search looks through every folder; otherwise
 * the view's subfolders and items (A to Z, or most recent first for Recent).
 */
export function libraryContents(
  library: { folders: LibraryFolder[]; items: LibraryItem[]; assets: MediaAsset[] },
  { view, query, filter }: { view: LibraryView; query: string; filter: LibraryFilter },
): { folders: LibraryFolder[]; items: LibraryItem[] } {
  const media = new Map(library.assets.map((a) => [a.id, a]));
  const ofKind = (items: LibraryItem[]) =>
    filter === "all" ? items : items.filter((i) => libraryItemKind(i, media) === filter);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return {
      folders: library.folders.filter((f) => words.every((w) => f.name.toLowerCase().includes(w))).sort(byName),
      items: ofKind(searchItems(library.items, query)),
    };
  }
  if (view.kind === "favorites") return { folders: [], items: ofKind(library.items.filter((i) => i.favorite).sort(byName)) };
  if (view.kind === "recent") return { folders: [], items: ofKind(recentItems(library.items)) };
  return {
    folders: library.folders.filter((f) => f.parentId === view.folderId).sort(byName),
    items: ofKind(library.items.filter((i) => i.folderId === view.folderId).sort(byName)),
  };
}

/** How many items each folder holds, subfolders included. */
export function folderItemCounts(folders: LibraryFolder[], items: LibraryItem[]): Map<string, number> {
  const parent = new Map(folders.map((f) => [f.id, f.parentId]));
  const counts = new Map<string, number>();
  for (const item of items) {
    const seen = new Set<string>();
    for (let id = item.folderId; id && !seen.has(id); id = parent.get(id) ?? null) {
      seen.add(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}
