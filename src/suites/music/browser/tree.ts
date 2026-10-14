/**
 * The Browser's rows (`docs/fl-studio/browser.md`): the favourites, then the folders added with whatever
 * of them is open, or the search's results. Pure, so the tree and its keys are tested; the panel draws
 * the rows and the store keeps what's open, loaded and selected.
 */
import { type BrowserHit, type BrowserItem, type BrowserRoot, isAudioName, isInsideFolder } from "@shared/music/browser";

/** What's known of a folder's content: read, being read, or unreadable. */
export type FolderContents = { status: "loaded"; items: BrowserItem[] } | { status: "loading" } | { status: "error"; message: string };

export type Row =
  /** A heading: "Favourites", "Folders". */
  | { kind: "heading"; key: string; label: string }
  /** A line that says something about the folder above (empty, loading, unreadable). */
  | { kind: "note"; key: string; depth: number; text: string }
  | ItemRow;

export interface ItemRow {
  kind: "item";
  /** Unique among the rows: a path can be both a favourite and in the tree. */
  key: string;
  section: "favourites" | "tree" | "results";
  item: BrowserItem;
  depth: number;
  /** A folder that opens where it is (one in the tree, or a favourite one with `favouritesInPlace`). */
  opens: boolean;
  /** Folders that open: open. */
  expanded: boolean;
  favourite: boolean;
  /** A folder added to the Browser (its own menu: remove it). */
  root: boolean;
  /** A folder added that isn't there any more. */
  missing: boolean;
  /** Search results: where it is ("Drums/808 Kit"). */
  folder?: string;
}

export interface TreeInput {
  roots: readonly BrowserRoot[];
  favourites: readonly string[];
  expanded: ReadonlySet<string>;
  /** Favourite folders open in their own section, rather than jumping to the tree (the default). */
  favouritesInPlace?: boolean;
  /** Folders open under the favourites (kept apart from the tree's, so one doesn't open the other). */
  favouritesExpanded?: ReadonlySet<string>;
  contents: ReadonlyMap<string, FolderContents>;
}

/** The last part of a path, whichever separator the server's platform uses. */
export const nameOf = (p: string) => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1) || p;

/** A favourite: a file if it's audio (the Browser shows no other files), else a folder. */
export const favouriteItem = (path: string): BrowserItem => ({ path, name: nameOf(path), kind: isAudioName(path) ? "file" : "folder" });

/** Where rows are walked: their section, their keys, and the folders open there. */
interface Place {
  section: "favourites" | "tree";
  key: (path: string) => string;
  open: ReadonlySet<string>;
}

/**
 * The tree's rows: the favourites, then the folders. A favourite folder opens in place, under its star, or
 * (`favouritesInPlace` off) is a shortcut to it in the tree.
 */
export function treeRows({ roots, favourites, expanded, favouritesInPlace = false, favouritesExpanded = new Set(), contents }: TreeInput): Row[] {
  const starred = new Set(favourites);
  const rows: Row[] = [];
  const walk = (item: BrowserItem, depth: number, root: BrowserRoot | null, place: Place) => {
    const opens = item.kind === "folder" && (place.section === "tree" || favouritesInPlace) && !root?.missing;
    const open = opens && place.open.has(item.path);
    const key = place.key(item.path);
    rows.push({
      kind: "item",
      key,
      section: place.section,
      item,
      depth,
      opens,
      expanded: open,
      favourite: starred.has(item.path),
      root: root !== null,
      missing: root?.missing ?? false,
    });
    if (!open) return;
    const inside = contents.get(item.path);
    if (!inside || inside.status === "loading") rows.push({ kind: "note", key: `n:${key}`, depth: depth + 1, text: "Reading…" });
    else if (inside.status === "error") rows.push({ kind: "note", key: `n:${key}`, depth: depth + 1, text: inside.message });
    else if (!inside.items.length) rows.push({ kind: "note", key: `n:${key}`, depth: depth + 1, text: "No audio files" });
    else for (const child of inside.items) walk(child, depth + 1, null, place);
  };
  if (favourites.length) {
    rows.push({ kind: "heading", key: "h:favourites", label: "Favourites" });
    // What's inside a favourite is keyed by the favourite too: favourites can be inside one another.
    for (const path of favourites) {
      const key = (p: string) => (p === path ? `f:${path}` : `f:${path}>${p}`);
      walk(favouriteItem(path), 0, null, { section: "favourites", key, open: favouritesExpanded });
    }
  }
  if (roots.length) rows.push({ kind: "heading", key: "h:folders", label: "Folders" });
  const tree: Place = { section: "tree", key: (p) => `t:${p}`, open: expanded };
  for (const root of roots) walk({ path: root.path, name: root.name, kind: "folder" }, 0, root, tree);
  return rows;
}

/** The search's results as rows: a flat list, each with its folder. */
export function resultRows(hits: readonly BrowserHit[], favourites: readonly string[]): Row[] {
  const starred = new Set(favourites);
  return hits.map((hit) => ({
    kind: "item",
    key: `r:${hit.path}`,
    section: "results",
    item: { path: hit.path, name: hit.name, kind: hit.kind },
    depth: 0,
    opens: false,
    expanded: false,
    favourite: starred.has(hit.path),
    root: false,
    missing: false,
    folder: hit.folder,
  }));
}

export const isItem = (row: Row | undefined): row is ItemRow => row?.kind === "item";

/** The item row `delta` rows from `key` (headings and notes skipped), stopping at the ends; the first if `key` isn't there. */
export function step(rows: readonly Row[], key: string | null, delta: number): ItemRow | null {
  const items = rows.filter(isItem);
  if (!items.length) return null;
  const at = items.findIndex((r) => r.key === key);
  if (at < 0) return delta < 0 ? items[items.length - 1] : items[0];
  return items[Math.max(0, Math.min(items.length - 1, at + delta))];
}

/** The folder row a row is in (the nearest row above, one level out, in its section), or null at the top. */
export function parentRow(rows: readonly Row[], key: string): ItemRow | null {
  const at = rows.findIndex((r) => r.key === key);
  const row = rows[at];
  if (!isItem(row) || row.section === "results" || row.depth === 0) return null;
  for (let i = at - 1; i >= 0; i--) {
    const above = rows[i];
    if (isItem(above) && above.section === row.section && above.depth === row.depth - 1) return above;
  }
  return null;
}

/** Which folders a row opens among: the tree's, or the favourites' own. */
export const placeOf = (row: ItemRow): FolderPlace => (row.section === "favourites" ? "favourites" : "tree");
export type FolderPlace = "tree" | "favourites";

/** What → and ← do on a row, FL's (and Finder's) way. */
export type ArrowAction = { type: "expand" | "collapse"; path: string; place: FolderPlace } | { type: "go"; row: ItemRow } | null;

export function arrowAction(rows: readonly Row[], key: string, direction: -1 | 1): ArrowAction {
  const at = rows.findIndex((r) => r.key === key);
  const row = rows[at];
  if (!isItem(row)) return null;
  if (direction > 0) {
    if (!row.opens) return null;
    if (!row.expanded) return { type: "expand", path: row.item.path, place: placeOf(row) };
    const child = rows[at + 1];
    return isItem(child) && child.depth === row.depth + 1 ? { type: "go", row: child } : null;
  }
  if (row.opens && row.expanded) return { type: "collapse", path: row.item.path, place: placeOf(row) };
  const parent = parentRow(rows, key);
  return parent ? { type: "go", row: parent } : null;
}

/** The item rows from one key to another, both included, in the rows' order (Shift+click). */
export function rowRange(rows: readonly Row[], from: string, to: string): string[] {
  const items = rows.filter(isItem);
  const a = items.findIndex((r) => r.key === from);
  const b = items.findIndex((r) => r.key === to);
  if (a < 0 || b < 0) return b < 0 ? [] : [to];
  return items.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.key);
}

/**
 * The folders to open to show `path` in the tree: its root and every folder down to the one it's in
 * (or to itself, for a folder: it's shown open). Null if it isn't in any of the roots.
 */
export function foldersToReveal(roots: readonly BrowserRoot[], path: string, isFolder: boolean): string[] | null {
  const root = roots.find((r) => isInsideFolder(path, r.path));
  if (!root) return null;
  const folders = [root.path];
  const sep = root.path.includes("\\") ? "\\" : "/";
  const rest = path.slice(root.path.length + 1).split(/[\\/]/).filter(Boolean);
  let at = root.path;
  for (const [i, part] of rest.entries()) {
    if (i === rest.length - 1 && !isFolder) break;
    at = `${at}${sep}${part}`;
    folders.push(at);
  }
  return folders;
}
