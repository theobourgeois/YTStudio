/**
 * The Browser's rows (`docs/fl-studio/browser.md`): the favourites, then the folders added with whatever
 * of them is open, or the search's results. Pure, so the tree and its keys are tested; the panel draws
 * the rows and the store keeps what's open, loaded and selected.
 */
import { type BrowserHit, type BrowserItem, type BrowserRoot, isAudioName } from "@shared/music/browser";

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
  /** Folders in the tree: open. */
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
  contents: ReadonlyMap<string, FolderContents>;
}

const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1) || p;

/** A favourite: a file if it's audio (the Browser shows no other files), else a folder. */
export const favouriteItem = (path: string): BrowserItem => ({ path, name: nameOf(path), kind: isAudioName(path) ? "file" : "folder" });

/** The tree's rows: the favourites (a favourite folder is a shortcut to it, not opened in place), then the folders. */
export function treeRows({ roots, favourites, expanded, contents }: TreeInput): Row[] {
  const starred = new Set(favourites);
  const rows: Row[] = [];
  if (favourites.length) {
    rows.push({ kind: "heading", key: "h:favourites", label: "Favourites" });
    for (const path of favourites) {
      rows.push({ kind: "item", key: `f:${path}`, section: "favourites", item: favouriteItem(path), depth: 0, expanded: false, favourite: true, root: false, missing: false });
    }
  }
  if (roots.length) rows.push({ kind: "heading", key: "h:folders", label: "Folders" });
  const walk = (item: BrowserItem, depth: number, root: BrowserRoot | null) => {
    const open = item.kind === "folder" && expanded.has(item.path) && !root?.missing;
    rows.push({
      kind: "item",
      key: `t:${item.path}`,
      section: "tree",
      item,
      depth,
      expanded: open,
      favourite: starred.has(item.path),
      root: root !== null,
      missing: root?.missing ?? false,
    });
    if (!open) return;
    const inside = contents.get(item.path);
    if (!inside || inside.status === "loading") rows.push({ kind: "note", key: `n:${item.path}`, depth: depth + 1, text: "Reading…" });
    else if (inside.status === "error") rows.push({ kind: "note", key: `n:${item.path}`, depth: depth + 1, text: inside.message });
    else if (!inside.items.length) rows.push({ kind: "note", key: `n:${item.path}`, depth: depth + 1, text: "No audio files" });
    else for (const child of inside.items) walk(child, depth + 1, null);
  };
  for (const root of roots) walk({ path: root.path, name: root.name, kind: "folder" }, 0, root);
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

/** The folder row a tree row is in (the nearest row above, one level out), or null at the top. */
export function parentRow(rows: readonly Row[], key: string): ItemRow | null {
  const at = rows.findIndex((r) => r.key === key);
  const row = rows[at];
  if (!isItem(row) || row.section !== "tree" || row.depth === 0) return null;
  for (let i = at - 1; i >= 0; i--) {
    const above = rows[i];
    if (isItem(above) && above.section === "tree" && above.depth === row.depth - 1) return above;
  }
  return null;
}

/** What → and ← do on a row, FL's (and Finder's) way. */
export type ArrowAction = { type: "expand" | "collapse"; path: string } | { type: "go"; row: ItemRow } | null;

export function arrowAction(rows: readonly Row[], key: string, direction: -1 | 1): ArrowAction {
  const at = rows.findIndex((r) => r.key === key);
  const row = rows[at];
  if (!isItem(row)) return null;
  if (direction > 0) {
    if (row.item.kind !== "folder" || row.section !== "tree" || row.missing) return null;
    if (!row.expanded) return { type: "expand", path: row.item.path };
    const child = rows[at + 1];
    return isItem(child) && child.depth === row.depth + 1 ? { type: "go", row: child } : null;
  }
  if (row.section === "tree" && row.item.kind === "folder" && row.expanded) return { type: "collapse", path: row.item.path };
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
  const root = roots.find((r) => path === r.path || path.startsWith(`${r.path}/`));
  if (!root) return null;
  const folders = [root.path];
  const rest = path.slice(root.path.length + 1).split("/").filter(Boolean);
  let at = root.path;
  for (const [i, part] of rest.entries()) {
    if (i === rest.length - 1 && !isFolder) break;
    at = `${at}/${part}`;
    folders.push(at);
  }
  return folders;
}
