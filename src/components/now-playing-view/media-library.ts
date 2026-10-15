import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { sameName } from "@shared/library";
import type { MediaAsset } from "@shared/types";
import { api } from "@/lib/api";
import { log } from "@/lib/log";

const logger = log("now-playing");

/** The Library folder the visualizer's clips and pictures are in (made the first time one's added). */
export const MEDIA_FOLDER = "Visualizer";

/** A clip or picture of the visualizer's: its Library item and its media. */
export interface VisualizerMedia {
  itemId: string;
  asset: MediaAsset;
}

interface VisualizerMediaState {
  media: VisualizerMedia[];
  loaded: boolean;
  /** Files being added (uploading). */
  adding: number;
  /** The one melting into the MilkDrop look shown (its media id), if any. */
  feeding: string | null;
  setFeeding(id: string | null): void;
  /** The folder's clips and pictures, from the Library. */
  load(): Promise<void>;
  /** Files added to the folder (clips and pictures; anything else is left out, said so). */
  add(files: readonly File[]): Promise<void>;
  remove(itemId: string): Promise<void>;
}

/** What the visualizer can feed in: a clip with a picture, or a picture. */
const usable = (asset: MediaAsset | undefined): asset is MediaAsset => !!asset && asset.status !== "error" && (asset.kind === "image" || (asset.kind === "video" && asset.hasVideo));

/** A file that looks like a clip or a picture (its type, else its name). */
export const isVisual = (file: Pick<File, "type" | "name">) =>
  /^(video|image)\//.test(file.type) || /\.(mp4|m4v|mov|webm|mkv|avi|gif|png|jpe?g|webp|heic|avif|bmp|tiff?)$/i.test(file.name);

async function folderId(create: boolean): Promise<string | null> {
  const library = await api.getLibrary();
  const folder = library.folders.find((f) => f.parentId === null && sameName(f.name, MEDIA_FOLDER));
  if (folder || !create) return folder?.id ?? null;
  return (await api.createLibraryFolder({ name: MEDIA_FOLDER, parentId: null })).id;
}

/**
 * The visualizer's own clips and pictures (docs/now-playing.md, "Your media"): the Library's Visualizer folder, so
 * they're kept with the rest of the Library (the video editor's Library tab shows them too) and served from the same
 * origin (the GPU may read them).
 */
export const useVisualizerMedia = create<VisualizerMediaState>((set, get) => ({
  media: [],
  loaded: false,
  adding: 0,
  feeding: null,
  setFeeding(feeding) {
    if (get().feeding !== feeding) set({ feeding });
  },
  async load() {
    try {
      const library = await api.getLibrary();
      const folder = library.folders.find((f) => f.parentId === null && sameName(f.name, MEDIA_FOLDER));
      const assets = new Map(library.media.map((a) => [a.id, a]));
      const media = folder
        ? library.items.flatMap((item) => (item.kind === "media" && item.folderId === folder.id && usable(assets.get(item.mediaId)) ? [{ itemId: item.id, asset: assets.get(item.mediaId)! }] : []))
        : [];
      set({ media, loaded: true });
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
      const folder = await folderId(true);
      for (const file of visual) {
        try {
          const { item, media } = await api.uploadToLibrary(folder, file);
          const asset = item.kind === "media" ? media.find((m) => m.id === item.mediaId) : undefined;
          if (usable(asset)) set((s) => ({ media: [...s.media, { itemId: item.id, asset }] }));
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
    if (!get().loaded) await get().load();
  },
  async remove(itemId) {
    const was = get().media;
    set({ media: was.filter((m) => m.itemId !== itemId) });
    try {
      await api.deleteLibraryItem(itemId);
    } catch (err) {
      set({ media: was });
      toast.error(`Couldn't take it out: ${errorMessage(err)}`);
    }
  },
}));
