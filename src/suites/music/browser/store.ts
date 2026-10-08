import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import type { BrowserSearchResult, BrowserState } from "@shared/music/browser";
import { musicApi } from "../api";
import { previewRequest } from "./online";
import { type FolderContents, type FolderPlace, foldersToReveal, nameOf } from "./tree";

/**
 * The Browser (`docs/fl-studio/browser.md`): the same in every project, so none of it is the song's.
 * Its folders and favourites are the server's (`/api/browser`); what's open, its width and the
 * preview's volume are this computer's (localStorage); what's selected and previewing is the tab's.
 */
/** The Browser's tabs: the user's folders, or online clips (YouTube's search, a pasted link). */
export type BrowserTab = "files" | "online";

interface BrowserStoreState {
  open: boolean;
  width: number;
  tab: BrowserTab;
  /** The preview's volume, 0..1. */
  volume: number;
  /** The server's: the folders added and the favourites. Null until it's said. */
  state: BrowserState | null;
  /** Folders open in the tree. */
  expanded: ReadonlySet<string>;
  /** Favourite folders open where they are, rather than shown in the tree (Settings; on by default). */
  favouritesInPlace: boolean;
  /** Folders open under the favourites. */
  favouritesExpanded: ReadonlySet<string>;
  /** What's been read of each folder opened. */
  contents: ReadonlyMap<string, FolderContents>;
  query: string;
  /** The search's results for `query` (null with no query, or before the first answer). */
  results: BrowserSearchResult | null;
  /** Selected rows (by row key: `tree.ts`), and the one the arrows move from (Shift+click's anchor too). */
  selected: readonly string[];
  cursor: string | null;
  /** The file being previewed (its path, or an online clip's URL), and the name the engine knows the preview by. */
  previewing: { path: string; id: string } | null;
  /** Where a preview was paused (its sample and the seconds it had got to): play goes on from there. */
  paused: { path: string; seconds: number } | null;
  /** The Online tab's search (or link), and the clip selected there (its URL). */
  onlineQuery: string;
  onlineSelected: string | null;
  /** A row to scroll into view once it's drawn (after a jump to a favourite). */
  scrollTo: string | null;

  load: () => Promise<void>;
  setOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
  setTab: (tab: BrowserTab) => void;
  setOnlineQuery: (query: string) => void;
  selectOnline: (url: string | null) => void;
  setVolume: (volume: number) => void;
  /** Open or close a folder in the tree, or (`place`) under the favourites. */
  toggleFolder: (path: string, place?: FolderPlace) => void;
  expand: (path: string, place?: FolderPlace) => void;
  collapse: (path: string, place?: FolderPlace) => void;
  setFavouritesInPlace: (inPlace: boolean) => void;
  collapseAll: () => void;
  /** Read every open folder again, and the index (Ctrl+R). */
  rescan: () => Promise<void>;
  addRoots: (paths: string[]) => Promise<void>;
  removeRoot: (path: string) => Promise<void>;
  setFavourite: (path: string, favourite: boolean) => Promise<void>;
  setQuery: (query: string) => void;
  select: (keys: readonly string[], cursor: string | null) => void;
  /** Open the tree down to `path` and select it there (a favourite folder's shortcut). */
  reveal: (path: string, isFolder: boolean) => void;
  clearScrollTo: () => void;
  /** Hear a file (from `start` seconds), cutting off the last; or nothing, if it's already playing from its start. */
  preview: (path: string, start?: number) => void;
  stopPreview: () => void;
  /** Stop the preview, keeping where it had got to (`seconds`, null if the engine wasn't playing it yet) for play to go on from. */
  pausePreview: (seconds: number | null) => void;
}

const STORAGE_KEY = "vaudio.music.browser";
export const MIN_WIDTH = 200;
export const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 280;

interface Saved {
  open: boolean;
  width: number;
  tab: BrowserTab;
  volume: number;
  expanded: string[];
  favouritesInPlace: boolean;
  favouritesExpanded: string[];
}

function readSaved(): Saved {
  const fallback: Saved = { open: true, width: DEFAULT_WIDTH, tab: "files", volume: 0.8, expanded: [], favouritesInPlace: true, favouritesExpanded: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
    if (!raw || typeof raw !== "object") return fallback;
    return {
      open: typeof raw.open === "boolean" ? raw.open : fallback.open,
      width: typeof raw.width === "number" ? clampWidth(raw.width) : fallback.width,
      tab: raw.tab === "online" ? "online" : fallback.tab,
      volume: typeof raw.volume === "number" ? Math.max(0, Math.min(1, raw.volume)) : fallback.volume,
      expanded: paths(raw.expanded),
      favouritesInPlace: typeof raw.favouritesInPlace === "boolean" ? raw.favouritesInPlace : fallback.favouritesInPlace,
      favouritesExpanded: paths(raw.favouritesExpanded),
    };
  } catch {
    return fallback;
  }
}

const paths = (value: unknown) => (Array.isArray(value) ? value.filter((p): p is string => typeof p === "string").slice(0, 500) : []);
const clampWidth = (width: number) => Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)));

const saved = typeof localStorage === "undefined" ? null : readSaved();
let previews = 0;
/** Searches answered out of order are dropped: only the last one asked counts. */
let searches = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;

export const useBrowser = create<BrowserStoreState>((set, get) => {
  function save() {
    const { open, width, tab, volume, expanded, favouritesInPlace, favouritesExpanded } = get();
    const saved: Saved = { open, width, tab, volume, expanded: [...expanded], favouritesInPlace, favouritesExpanded: [...favouritesExpanded] };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Private mode, or full: it's only where the Browser was left.
    }
  }

  async function list(path: string) {
    const loading = new Map(get().contents);
    if (!loading.has(path)) {
      loading.set(path, { status: "loading" });
      set({ contents: loading });
    }
    let next: FolderContents;
    try {
      next = { status: "loaded", items: await musicApi.listBrowserFolder(path) };
    } catch (err) {
      next = { status: "error", message: errorMessage(err) };
    }
    const contents = new Map(get().contents);
    contents.set(path, next);
    set({ contents });
  }

  /** The folders open in the tree, or under the favourites. */
  const openIn = (place: FolderPlace) => (place === "favourites" ? "favouritesExpanded" : "expanded");
  /** Every folder open anywhere (each read once). */
  const allOpen = () => new Set([...get().expanded, ...get().favouritesExpanded]);

  function failed(what: string, err: unknown) {
    toast.error(what, { description: errorMessage(err) });
  }

  return {
    open: saved?.open ?? true,
    width: saved?.width ?? DEFAULT_WIDTH,
    tab: saved?.tab ?? "files",
    volume: saved?.volume ?? 0.8,
    state: null,
    expanded: new Set(saved?.expanded ?? []),
    favouritesInPlace: saved?.favouritesInPlace ?? true,
    favouritesExpanded: new Set(saved?.favouritesExpanded ?? []),
    contents: new Map(),
    query: "",
    results: null,
    selected: [],
    cursor: null,
    previewing: null,
    paused: null,
    scrollTo: null,
    onlineQuery: "",
    onlineSelected: null,

    async load() {
      try {
        const state = await musicApi.browser();
        set({ state });
        // A restarted engine plays previews at full volume until it's told.
        void musicApi.engine("previewVolume", { volume: get().volume }).catch(() => {});
        // The folders left open last time are read again.
        for (const path of allOpen()) if (state.roots.some((r) => path === r.path || path.startsWith(`${r.path}/`))) void list(path);
      } catch (err) {
        failed("Couldn't read the Browser's folders", err);
      }
    },
    setOpen(open) {
      if (!open) get().stopPreview();
      set({ open });
      save();
    },
    setWidth(width) {
      set({ width: clampWidth(width) });
      save();
    },
    setTab(tab) {
      set({ tab });
      save();
    },
    setOnlineQuery: (onlineQuery) => set({ onlineQuery }),
    selectOnline: (onlineSelected) => set({ onlineSelected }),
    setVolume(volume) {
      set({ volume: Math.max(0, Math.min(1, volume)) });
      save();
      void musicApi.engine("previewVolume", { volume: get().volume }).catch(() => {});
    },
    toggleFolder(path, place = "tree") {
      if (get()[openIn(place)].has(path)) get().collapse(path, place);
      else get().expand(path, place);
    },
    expand(path, place = "tree") {
      const expanded = new Set(get()[openIn(place)]);
      expanded.add(path);
      set({ [openIn(place)]: expanded });
      save();
      // Read again each time it's opened: files come and go.
      void list(path);
    },
    collapse(path, place = "tree") {
      const expanded = new Set(get()[openIn(place)]);
      expanded.delete(path);
      set({ [openIn(place)]: expanded });
      save();
    },
    collapseAll() {
      set({ expanded: new Set(), favouritesExpanded: new Set() });
      save();
    },
    setFavouritesInPlace(favouritesInPlace) {
      set({ favouritesInPlace });
      save();
    },
    async rescan() {
      try {
        set({ state: await musicApi.rescanBrowser() });
        await Promise.all([...allOpen()].map((path) => list(path)));
      } catch (err) {
        failed("Couldn't read the folders again", err);
      }
    },
    async addRoots(paths) {
      for (const path of paths) {
        try {
          set({ state: await musicApi.addBrowserRoot({ path }) });
          get().expand(path);
        } catch (err) {
          failed(`Couldn't add "${nameOf(path)}"`, err);
        }
      }
    },
    async removeRoot(path) {
      try {
        set({ state: await musicApi.removeBrowserRoot(path) });
        get().collapse(path);
      } catch (err) {
        failed("Couldn't remove the folder", err);
      }
    },
    async setFavourite(path, favourite) {
      try {
        set({ state: await musicApi.setBrowserFavourite({ path, favourite }) });
      } catch (err) {
        failed("Couldn't change the favourites", err);
      }
    },
    setQuery(query) {
      set({ query });
      if (searchTimer) clearTimeout(searchTimer);
      const asked = ++searches;
      if (!query.trim()) return set({ results: null });
      searchTimer = setTimeout(() => {
        musicApi.searchBrowser(query).then(
          (results) => asked === searches && set({ results }),
          (err) => asked === searches && failed("The search failed", err),
        );
      }, 60);
    },
    select: (selected, cursor) => set({ selected, cursor }),
    reveal(path, isFolder) {
      const folders = foldersToReveal(get().state?.roots ?? [], path, isFolder);
      if (!folders) return;
      const expanded = new Set(get().expanded);
      for (const folder of folders) {
        if (!expanded.has(folder)) void list(folder);
        expanded.add(folder);
      }
      const key = `t:${path}`;
      set({ expanded, query: "", results: null, selected: [key], cursor: key, scrollTo: key });
      save();
    },
    clearScrollTo: () => set({ scrollTo: null }),
    preview(path, start = 0) {
      const id = `preview-${++previews}`;
      set({ previewing: { path, id }, paused: null });
      musicApi.previewFile(previewRequest(path, start, id)).then(
        // Stopped while its sound was still downloading (an online clip's): the engine started it since.
        () => get().previewing === null && void musicApi.engine("stopPreview", {}).catch(() => {}),
        (err) => {
          if (get().previewing?.id === id) set({ previewing: null });
          failed("Couldn't play the file", err);
        },
      );
    },
    stopPreview() {
      set({ paused: null });
      if (!get().previewing) return;
      set({ previewing: null });
      void musicApi.engine("stopPreview", {}).catch(() => {});
    },
    pausePreview(seconds) {
      const previewing = get().previewing;
      if (!previewing) return;
      get().stopPreview();
      if (seconds !== null) set({ paused: { path: previewing.path, seconds } });
    },
  };
});
