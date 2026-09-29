import { create } from "zustand";
import { toast } from "sonner";
import type { LibraryEntry, LibraryFolder, LibraryItem, MediaAsset, UpdateLibraryItemRequest } from "@shared/types";
import { errorMessage } from "@shared/errors";
import { type LibraryItemKind, folderPath, folderSubtree, itemMediaIds, sameName, templateFromClips } from "@shared/library";
import { createId } from "@shared/timeline";
import { api } from "@/lib/api";
import { type DroppedFolder, droppedFiles, filterDrop } from "@/lib/dropped-files";
import { acceptMediaFiles } from "@/components/media/import-media";
import { pollProcessingAssets } from "./asset-polling";
import { type AddToTimelineOptions, useEditor } from "./editor";

/** What the Library tab shows: a folder (null = the top level), or every favourite or recently used item. */
export type LibraryView = { kind: "folder"; folderId: string | null } | { kind: "favorites" } | { kind: "recent" };

export type LibraryFilter = "all" | LibraryItemKind;

/** The folder new things go into from a view (favourites and recent: the top level). */
export function viewFolder(view: LibraryView): string | null {
  return view.kind === "folder" ? view.folderId : null;
}

export interface LibraryUpload {
  id: string;
  name: string;
  /** 0..1 */
  progress: number;
  folderId: string | null;
}

/** Files uploaded into the Library at once (a dropped folder can hold hundreds). */
const UPLOAD_CONCURRENCY = 3;

/**
 * The Library shared by every project (see `shared/library.ts`): its folders,
 * items and their media, plus how the Library tab is being browsed. Using an
 * item goes through the editor store (`addLibraryItem`).
 */
interface LibraryState {
  loaded: boolean;
  loadError: string | null;
  folders: LibraryFolder[];
  items: LibraryItem[];
  /** The media the items use (named like the editor's so the same poller refreshes it). */
  assets: MediaAsset[];
  uploads: LibraryUpload[];

  view: LibraryView;
  query: string;
  filter: LibraryFilter;
  setView: (view: LibraryView) => void;
  setQuery: (query: string) => void;
  setFilter: (filter: LibraryFilter) => void;

  /** Fetch the Library (once; again after a failure). */
  load: () => Promise<void>;
  createFolder: (name: string, parentId: string | null) => Promise<LibraryFolder | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  moveFolder: (id: string, parentId: string | null) => Promise<void>;
  /** Delete a folder with everything in it. */
  deleteFolder: (id: string) => Promise<void>;
  /** Upload files into a folder. */
  importFiles: (files: File[], folderId: string | null) => Promise<void>;
  /** Upload dropped files and folders into a folder, merging into same-named subfolders. */
  importTree: (tree: DroppedFolder, folderId: string | null) => Promise<void>;
  /** Add one of the open project's media files to a folder. */
  addAsset: (assetId: string, folderId: string | null) => Promise<void>;
  /** Save timeline clips (with their effects and transitions) to a folder. */
  saveClips: (clipIds: string[], name: string, folderId: string | null) => Promise<boolean>;
  updateItem: (id: string, patch: UpdateLibraryItemRequest) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  /** Put an item on the open project's timeline (see `addLibraryItem`). */
  addToTimeline: (itemId: string, opts?: AddToTimelineOptions) => Promise<void>;
}

let loading: Promise<void> | null = null;

export const useLibrary = create<LibraryState>((set, get) => {
  const poll = () => pollProcessingAssets(useLibrary, api.getLibraryMedia);

  const addEntry = ({ item, media }: LibraryEntry) => {
    const known = new Set(get().assets.map((a) => a.id));
    set({
      items: [...get().items.filter((i) => i.id !== item.id), item],
      assets: [...media.filter((m) => !known.has(m.id)), ...get().assets],
    });
    poll();
  };

  const replaceItem = (item: LibraryItem) =>
    set({ items: get().items.map((i) => (i.id === item.id ? item : i)) });

  /** Forget media no item uses any more (the server deleted it). */
  const pruneAssets = () => {
    const used = new Set(get().items.flatMap(itemMediaIds));
    set({ assets: get().assets.filter((a) => used.has(a.id)) });
  };

  /** Leave a view that's gone (a deleted folder) for the top level. */
  const fixView = () => {
    const { view, folders } = get();
    if (view.kind === "folder" && view.folderId && !folders.some((f) => f.id === view.folderId)) {
      set({ view: { kind: "folder", folderId: null } });
    }
  };

  const upload = async (file: File, folderId: string | null): Promise<boolean> => {
    const entry: LibraryUpload = { id: createId("up"), name: file.name, progress: 0, folderId };
    set({ uploads: [...get().uploads, entry] });
    try {
      addEntry(
        await api.uploadToLibrary(folderId, file, (progress) =>
          set({ uploads: get().uploads.map((u) => (u.id === entry.id ? { ...u, progress } : u)) }),
        ),
      );
      return true;
    } catch (err) {
      toast.error(`Couldn't import ${file.name}`, { description: errorMessage(err) });
      return false;
    } finally {
      set({ uploads: get().uploads.filter((u) => u.id !== entry.id) });
    }
  };

  /** A folder's name for messages. */
  const where = (folderId: string | null) => folderPath(get().folders, folderId).at(-1)?.name ?? "the Library";

  const fail = (what: string, err: unknown) => toast.error(what, { description: errorMessage(err) });

  return {
    loaded: false,
    loadError: null,
    folders: [],
    items: [],
    assets: [],
    uploads: [],

    view: { kind: "folder", folderId: null },
    query: "",
    filter: "all",
    setView(view) {
      set({ view, query: "" });
    },
    setQuery(query) {
      set({ query });
    },
    setFilter(filter) {
      set({ filter });
    },

    load() {
      loading ??= api
        .getLibrary()
        .then(({ folders, items, media }) => {
          set({ folders, items, assets: media, loaded: true, loadError: null });
          poll();
        })
        .catch((err) => {
          loading = null;
          set({ loadError: errorMessage(err) });
        });
      return loading;
    },

    async createFolder(name, parentId) {
      try {
        const folder = await api.createLibraryFolder({ name, parentId });
        set({ folders: [...get().folders, folder] });
        return folder;
      } catch (err) {
        fail("Couldn't create the folder", err);
        return null;
      }
    },

    async renameFolder(id, name) {
      try {
        const folder = await api.updateLibraryFolder(id, { name });
        set({ folders: get().folders.map((f) => (f.id === id ? folder : f)) });
      } catch (err) {
        fail("Couldn't rename the folder", err);
      }
    },

    async moveFolder(id, parentId) {
      const current = get().folders.find((f) => f.id === id);
      if (!current || current.parentId === parentId) return;
      try {
        const folder = await api.updateLibraryFolder(id, { parentId });
        set({ folders: get().folders.map((f) => (f.id === id ? folder : f)) });
      } catch (err) {
        fail("Couldn't move the folder", err);
      }
    },

    async deleteFolder(id) {
      try {
        await api.deleteLibraryFolder(id);
      } catch (err) {
        fail("Couldn't delete the folder", err);
        return;
      }
      // Like the server: the folder, its subfolders and their items.
      const doomed = folderSubtree(get().folders, id);
      set({
        folders: get().folders.filter((f) => !doomed.has(f.id)),
        items: get().items.filter((i) => !i.folderId || !doomed.has(i.folderId)),
      });
      pruneAssets();
      fixView();
    },

    importFiles(files, folderId) {
      return get().importTree({ name: "", files, folders: [] }, folderId);
    },

    async importTree(tree, folderId) {
      const accepted = new Set(acceptMediaFiles(droppedFiles(tree)));
      const media = filterDrop(tree, (f) => accepted.has(f));
      // Folders first (reusing same-named ones), then the files, a few at a time.
      const jobs: { file: File; folderId: string | null }[] = [];
      const walk = async (node: DroppedFolder, parentId: string | null) => {
        for (const file of node.files) jobs.push({ file, folderId: parentId });
        for (const sub of node.folders) {
          const existing = get().folders.find((f) => f.parentId === parentId && sameName(f.name, sub.name));
          const folder = existing ?? (await get().createFolder(sub.name, parentId));
          if (folder) await walk(sub, folder.id);
        }
      };
      await walk(media, folderId);
      let imported = 0;
      const next = async () => {
        for (let job = jobs.shift(); job; job = jobs.shift()) {
          if (await upload(job.file, job.folderId)) imported++;
        }
      };
      const total = jobs.length;
      await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, next));
      if (total > 1 && imported > 0) {
        toast.success(`Imported ${imported} file${imported === 1 ? "" : "s"} into ${where(folderId)}`);
      }
    },

    async addAsset(assetId, folderId) {
      try {
        const entry = await api.saveMediaToLibrary({ assetId, folderId });
        addEntry(entry);
        toast.success(`Added “${entry.item.name}” to ${where(folderId)}`);
      } catch (err) {
        fail("Couldn't add it to the Library", err);
      }
    },

    async saveClips(clipIds, name, folderId) {
      const { projectId, project } = useEditor.getState();
      if (!projectId) return false;
      try {
        const entry = await api.saveClipsToLibrary({ projectId, name, folderId, ...templateFromClips(project, clipIds) });
        addEntry(entry);
        toast.success(`Saved “${entry.item.name}” to ${where(folderId)}`);
        return true;
      } catch (err) {
        fail("Couldn't save to the Library", err);
        return false;
      }
    },

    async updateItem(id, patch) {
      const current = get().items.find((i) => i.id === id);
      if (!current) return;
      // Optimistic, so starring and moving feel instant.
      replaceItem({ ...current, ...patch } as LibraryItem);
      try {
        replaceItem(await api.updateLibraryItem(id, patch));
      } catch (err) {
        replaceItem(current);
        fail("Couldn't update the Library", err);
      }
    },

    async deleteItem(id) {
      try {
        await api.deleteLibraryItem(id);
      } catch (err) {
        fail("Couldn't delete it from the Library", err);
        return;
      }
      set({ items: get().items.filter((i) => i.id !== id) });
      pruneAssets();
    },

    async addToTimeline(itemId, opts) {
      const item = await useEditor.getState().addLibraryItem(itemId, opts);
      if (item && get().items.some((i) => i.id === item.id)) replaceItem(item);
    },
  };
});
