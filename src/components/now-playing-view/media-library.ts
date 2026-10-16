import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { sameName } from "@shared/library";
import type { Library, LibraryEntry, WebClip, WebDownloadProgress } from "@shared/types";
import { api } from "@/lib/api";
import { log } from "@/lib/log";
import { FIRST_SET, type MediaSet, type VisualizerMedia, currentSet, readSets, usable } from "./media-sets";

export type { MediaSet, VisualizerMedia } from "./media-sets";

const logger = log("now-playing");

/** The Library folder the visualizer's clips and pictures are in (made the first time one's added). */
export const MEDIA_FOLDER = "Visualizer";

/** Where the set in use is kept (its folder's id). */
const SET_KEY = "editor-visualizer-media-set";

interface VisualizerMediaState {
  /** The sets of clips (folders in the Visualizer folder), the oldest first. */
  sets: MediaSet[];
  /** The set the visualizer feeds from (its folder's id). */
  setId: string | null;
  /** The clips and pictures of the set in use. */
  media: VisualizerMedia[];
  loaded: boolean;
  /** Files being added (uploading). */
  adding: number;
  /** The one melting into the MilkDrop look shown (its media id), if any. */
  feeding: string | null;
  setFeeding(id: string | null): void;
  /** One just added, to show next (its media id): the visualizer takes it at once, on a MilkDrop look. */
  wanted: string | null;
  setWanted(id: string | null): void;
  /** Online clips being downloaded into the folder, by their link: how far (null: starting, or not said yet). */
  downloads: Record<string, WebDownloadProgress | null>;
  /** Online clips added, by their link: their media. */
  fromWeb: Record<string, string>;
  /** An online clip's picture downloaded into the folder (a long video's first minutes), and shown next. */
  addOnline(clip: WebClip): Promise<void>;
  /** The sets and their clips and pictures, from the Library (those in no set moved into the first: `FIRST_SET`). */
  load(): Promise<void>;
  /** Files added to the set in use (clips and pictures; anything else is left out, said so). */
  add(files: readonly File[]): Promise<void>;
  remove(itemId: string): Promise<void>;
  /** Feed from another set. */
  useSet(id: string): void;
  /** A new set, used from now on (empty: what's added goes into it). */
  createSet(name: string): Promise<void>;
  renameSet(id: string, name: string): Promise<void>;
  /** A set deleted, with its clips and pictures (from the Library). */
  deleteSet(id: string): Promise<void>;
  /** A clip or picture moved into another set. */
  move(itemId: string, setId: string): Promise<void>;
}

/** Online videos longer than this come as their first `LONG_TAKES` seconds (the visualizer loops a few seconds of one). */
export const LONG_VIDEO = 6 * 60;
export const LONG_TAKES = 4 * 60;
/** How often an online clip's download is asked how far it's got (ms). */
const PROGRESS_MS = 600;

/** A file that looks like a clip or a picture (its type, else its name). */
export const isVisual = (file: Pick<File, "type" | "name">) =>
  /^(video|image)\//.test(file.type) || /\.(mp4|m4v|mov|webm|mkv|avi|gif|png|jpe?g|webp|heic|avif|bmp|tiff?)$/i.test(file.name);

const rootOf = (library: Library) => library.folders.find((f) => f.parentId === null && sameName(f.name, MEDIA_FOLDER))?.id ?? null;

async function rootId(): Promise<string> {
  return rootOf(await api.getLibrary()) ?? (await api.createLibraryFolder({ name: MEDIA_FOLDER, parentId: null })).id;
}

/** The sets as read, the one in use and its clips. */
function withSets(sets: MediaSet[], kept: string | null): Pick<VisualizerMediaState, "sets" | "setId" | "media"> {
  const set = currentSet(sets, kept);
  return { sets, setId: set?.id ?? null, media: set?.media ?? [] };
}

/** Each set's clips changed by `change` (the one in use's too). */
const changed = (sets: MediaSet[], setId: string | null, change: (media: VisualizerMedia[], set: MediaSet) => VisualizerMedia[]) =>
  withSets(
    sets.map((s) => ({ ...s, media: change(s.media, s) })),
    setId,
  );

/**
 * The visualizer's own clips and pictures (docs/now-playing.md, "Your media"): the Library's Visualizer folder, so
 * they're kept with the rest of the Library (the video editor's Library tab shows them too) and served from the same
 * origin (the GPU may read them); in sets, its folders, one in use at a time.
 */
export const useVisualizerMedia = create<VisualizerMediaState>((set, get) => {
  /** The set what's added goes into: the one in use, or a first one made. */
  const intoSet = async (): Promise<string> => {
    if (!get().loaded) await get().load();
    const { setId } = get();
    if (setId) return setId;
    const folder = await api.createLibraryFolder({ name: FIRST_SET, parentId: await rootId() });
    localStorage.setItem(SET_KEY, folder.id);
    set((s) => withSets([...s.sets, { id: folder.id, name: folder.name, media: [] }], folder.id));
    return folder.id;
  };
  /** One added to a set: shown next. */
  const added = (setId: string, media: VisualizerMedia) =>
    set((s) => ({
      ...changed(s.sets, s.setId, (list, it) => (it.id === setId && !list.some((m) => m.itemId === media.itemId) ? [...list, media] : list)),
      wanted: media.asset.id,
    }));
  return {
    sets: [],
    setId: null,
    media: [],
    loaded: false,
    adding: 0,
    feeding: null,
    setFeeding(feeding) {
      if (get().feeding !== feeding) set({ feeding });
    },
    wanted: null,
    setWanted(wanted) {
      set({ wanted });
    },
    downloads: {},
    fromWeb: {},
    async addOnline(clip) {
      const url = clip.url;
      if (url in get().downloads) return;
      set((s) => ({ downloads: { ...s.downloads, [url]: null } }));
      const timer = setInterval(() => {
        api.webDownloadProgress(url, "video").then(
          (progress) => url in get().downloads && set((s) => ({ downloads: { ...s.downloads, [url]: progress } })),
          () => {},
        );
      }, PROGRESS_MS);
      try {
        const folder = await intoSet();
        const entry: LibraryEntry = await api.addWebToLibrary({ url, title: clip.title, folderId: folder, ...(clip.duration > LONG_VIDEO && { most: LONG_TAKES }) });
        const asset = entry.item.kind === "media" ? entry.media.find((m) => m.id === (entry.item as { mediaId: string }).mediaId) : undefined;
        if (!usable(asset)) throw new Error("it has no picture to show");
        // One the Library had already (from the same link) is moved into this set.
        set((s) => changed(s.sets, s.setId, (list) => list.filter((m) => m.itemId !== entry.item.id)));
        added(folder, { itemId: entry.item.id, asset });
        set((s) => ({ fromWeb: { ...s.fromWeb, [url]: asset.id } }));
        logger.info(`added ${clip.title} (${clip.site}) to the visualizer's media`);
      } catch (err) {
        toast.error(`Couldn't add ${clip.title}: ${errorMessage(err)}`);
        logger.warn(`couldn't add ${url} to the visualizer's media: ${errorMessage(err)}`);
      } finally {
        clearInterval(timer);
        set((s) => {
          const downloads = { ...s.downloads };
          delete downloads[url];
          return { downloads };
        });
      }
    },
    async load() {
      try {
        let library = await api.getLibrary();
        const root = rootOf(library);
        let { sets, loose } = readSets(library, root);
        // Those from before there were sets (or put in the folder in the Library) go into the first.
        if (root && loose.length) {
          const home = sets.find((s) => sameName(s.name, FIRST_SET))?.id ?? (await api.createLibraryFolder({ name: FIRST_SET, parentId: root })).id;
          await Promise.all(loose.map((m) => api.updateLibraryItem(m.itemId, { folderId: home })));
          logger.info(`moved ${loose.length} of the visualizer's clips into ${FIRST_SET}`);
          library = await api.getLibrary();
          ({ sets, loose } = readSets(library, root));
        }
        set({ ...withSets(sets, get().setId ?? localStorage.getItem(SET_KEY)), loaded: true });
      } catch (err) {
        logger.warn(`couldn't read the visualizer's media: ${errorMessage(err)}`);
      }
    },
    async add(files) {
      const visual = files.filter(isVisual);
      if (visual.length < files.length) toast.message(`Only clips and pictures go into the visualizer: ${files.length - visual.length} left out.`);
      if (!visual.length) return;
      set((s) => ({ adding: s.adding + visual.length }));
      try {
        const folder = await intoSet();
        for (const file of visual) {
          try {
            const { item, media } = await api.uploadToLibrary(folder, file);
            const asset = item.kind === "media" ? media.find((m) => m.id === item.mediaId) : undefined;
            if (usable(asset)) added(folder, { itemId: item.id, asset });
            else toast.error(`${file.name} has no picture to show.`);
            logger.info(`added ${file.name} to the visualizer's media`);
          } catch (err) {
            toast.error(`Couldn't add ${file.name}: ${errorMessage(err)}`);
          } finally {
            set((s) => ({ adding: s.adding - 1 }));
          }
        }
      } catch (err) {
        set((s) => ({ adding: Math.max(0, s.adding - visual.length) }));
        toast.error(`Couldn't add them: ${errorMessage(err)}`);
      }
    },
    async remove(itemId) {
      const was = get().sets;
      set((s) => changed(s.sets, s.setId, (list) => list.filter((m) => m.itemId !== itemId)));
      try {
        await api.deleteLibraryItem(itemId);
      } catch (err) {
        set((s) => withSets(was, s.setId));
        toast.error(`Couldn't take it out: ${errorMessage(err)}`);
      }
    },
    useSet(id) {
      if (id === get().setId || !get().sets.some((s) => s.id === id)) return;
      localStorage.setItem(SET_KEY, id);
      set((s) => withSets(s.sets, id));
    },
    async createSet(name) {
      try {
        const folder = await api.createLibraryFolder({ name, parentId: await rootId() });
        localStorage.setItem(SET_KEY, folder.id);
        set((s) => withSets([...s.sets, { id: folder.id, name: folder.name, media: [] }], folder.id));
      } catch (err) {
        toast.error(`Couldn't make the set: ${errorMessage(err)}`);
      }
    },
    async renameSet(id, name) {
      try {
        const folder = await api.updateLibraryFolder(id, { name });
        set((s) => withSets(s.sets.map((it) => (it.id === id ? { ...it, name: folder.name } : it)), s.setId));
      } catch (err) {
        toast.error(`Couldn't rename it: ${errorMessage(err)}`);
      }
    },
    async deleteSet(id) {
      const was = get().sets;
      set((s) => withSets(s.sets.filter((it) => it.id !== id), s.setId));
      try {
        await api.deleteLibraryFolder(id);
      } catch (err) {
        set((s) => withSets(was, s.setId));
        toast.error(`Couldn't delete the set: ${errorMessage(err)}`);
      }
    },
    async move(itemId, setId) {
      const was = get().sets;
      const media = was.flatMap((s) => s.media).find((m) => m.itemId === itemId);
      if (!media) return;
      set((s) => changed(s.sets, s.setId, (list, it) => (it.id === setId ? [...list.filter((m) => m.itemId !== itemId), media] : list.filter((m) => m.itemId !== itemId))));
      try {
        await api.updateLibraryItem(itemId, { folderId: setId });
      } catch (err) {
        set((s) => withSets(was, s.setId));
        toast.error(`Couldn't move it: ${errorMessage(err)}`);
      }
    },
  };
});
