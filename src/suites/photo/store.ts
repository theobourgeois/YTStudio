import { useMemo } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { addImageLayer, fromImage } from "@shared/photo/edits";
import type { PhotoProject } from "@shared/photo/types";
import type { MediaAsset } from "@shared/types";
import { ApiRequestError, api } from "@/lib/api";
import { createAutosaver } from "@/lib/autosaver";
import { DocumentGesture, type DocumentHistory, commit, historyOf, redo, rewrite, undo } from "@/lib/document-history";
import { useProjects } from "@/stores/projects";
import { imageLayerOf } from "./media";

/**
 * The open photo: its document with undo (`lib/document-history.ts`) and the project's media (its images). Every
 * change to the document is a pure edit from `shared/photo/edits.ts`, through `commit` (one undo step) or a
 * `photoGesture()` (a drag). Which layer is selected, the tool and the view are in `ui.ts`; the GPU follows the
 * document from the workspace (`render/renderer.ts`).
 */
interface PhotoState {
  projectId: string | null;
  history: DocumentHistory<PhotoProject> | null;
  /** The project's media: an image layer's `mediaId` is one of these. */
  assets: MediaAsset[];
  loading: boolean;
  loadError: string | null;
  /** When the document was last saved (for the header's saved state). */
  savedAt: number | null;
  saving: boolean;

  open: (projectId: string) => Promise<void>;
  close: () => Promise<void>;
  rename: (name: string) => void;
  commit: (update: (doc: PhotoProject) => PhotoProject) => void;
  undo: () => void;
  redo: () => void;
  /**
   * Image files as new layers on top (uploaded as the project's media). `asCanvas`: an empty photo takes the first
   * image's size, as Photoshop opening a file does. Returns the new layers' ids.
   */
  placeFiles: (files: File[], options?: { asCanvas?: boolean }) => Promise<string[]>;
  /** One of the project's images as a new layer on top. Returns its id. */
  placeMedia: (asset: MediaAsset, options?: { asCanvas?: boolean; name?: string }) => string | null;
}

const autosaver = createAutosaver<PhotoProject, Awaited<ReturnType<typeof api.saveDocument>>>({
  save: (id, doc, keepalive) => {
    usePhoto.setState({ saving: true });
    return api.saveDocument("photo", id, doc, keepalive);
  },
  onSaved: (summary) => {
    usePhoto.setState({ saving: false, savedAt: Date.now() });
    useProjects.getState().setSummary(summary);
  },
  isGone: (err) => err instanceof ApiRequestError && err.status === 404,
});

/** Bumped by every open/close, so a load that's been overtaken is dropped. */
let openToken = 0;


export const usePhoto = create<PhotoState>((set, get) => ({
  projectId: null,
  history: null,
  assets: [],
  loading: false,
  loadError: null,
  savedAt: null,
  saving: false,

  async open(projectId) {
    if (get().projectId === projectId && get().history) return;
    await autosaver.flush();
    const token = ++openToken;
    set({ projectId, history: null, assets: [], loading: true, loadError: null, savedAt: null, saving: false });
    try {
      const [doc, assets] = await Promise.all([api.getDocument("photo", projectId), api.listMedia(projectId)]);
      if (token !== openToken) return;
      set({ history: historyOf(doc), assets, loading: false, savedAt: Date.now() });
    } catch (err) {
      if (token === openToken) set({ loading: false, loadError: errorMessage(err) });
    }
  },

  async close() {
    ++openToken;
    await autosaver.flush();
    set({ projectId: null, history: null, assets: [], loading: false, loadError: null, savedAt: null, saving: false });
  },

  rename(name) {
    const { history } = get();
    const trimmed = name.trim();
    if (!history || !trimmed || trimmed === history.doc.name) return;
    // Not an undoable edit: undo mustn't bring the old name back.
    set({ history: rewrite(history, (doc) => ({ ...doc, name: trimmed })) });
  },

  commit(update) {
    const { history } = get();
    if (!history) return;
    const next = commit(history, update);
    if (next !== history) set({ history: next });
  },

  undo() {
    const { history } = get();
    if (history) set({ history: undo(history) });
  },

  redo() {
    const { history } = get();
    if (history) set({ history: redo(history) });
  },

  placeMedia(asset, { asCanvas = false, name } = {}) {
    const { history } = get();
    if (!history || asset.kind !== "image") return null;
    const layer = imageLayerOf(asset, name);
    get().commit((doc) => (asCanvas && doc.layers.length === 0 ? fromImage(doc, layer) : addImageLayer(doc, layer)));
    return layer.id;
  },

  async placeFiles(files, { asCanvas = false } = {}) {
    const { projectId } = get();
    if (!projectId) return [];
    const ids: string[] = [];
    for (const file of files) {
      try {
        const asset = await api.uploadMedia(projectId, file);
        if (asset.kind !== "image") {
          void api.deleteMedia(asset.id).catch(() => {});
          throw new Error("it isn't an image");
        }
        if (get().projectId !== projectId) return ids;
        set({ assets: [...get().assets, asset] });
        const id = get().placeMedia(asset, { asCanvas: asCanvas && ids.length === 0 });
        if (id) ids.push(id);
      } catch (err) {
        toast.error(`Couldn't place ${file.name}`, { description: errorMessage(err) });
      }
    }
    return ids;
  },
}));

// Save the photo when it changes outside a gesture (a gesture's result is saved when it ends).
usePhoto.subscribe((state, prev) => {
  if (!state.projectId || state.projectId !== prev.projectId || !state.history || !prev.history) return;
  const gestureEnded = prev.history.gestureBase !== null && state.history.gestureBase === null;
  if (state.history.gestureBase || (state.history.doc === prev.history.doc && !gestureEnded)) return;
  autosaver.queue(state.projectId, state.history.doc);
});

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    const { projectId, history } = usePhoto.getState();
    if (projectId && history?.gestureBase && history.doc !== history.gestureBase) autosaver.queue(projectId, history.doc);
    autosaver.saveOnUnload();
  });
}

export const flushPhotos = () => autosaver.flush();
export const discardPhoto = (projectId: string) => autosaver.discard(projectId);

/** A drag or other continuous edit of the open photo, as one undo step. */
export const photoGesture = () =>
  new DocumentGesture<PhotoProject>({
    get: () => usePhoto.getState().history,
    set: (history) => usePhoto.setState({ history }),
  });

/** A layer's source size in its own pixels (null while its image is missing), stable across renders. */
export function useLayerSize(mediaId: string | undefined): { width: number; height: number } | null {
  const width = usePhoto((s) => s.assets.find((a) => a.id === mediaId)?.width ?? null);
  const height = usePhoto((s) => s.assets.find((a) => a.id === mediaId)?.height ?? null);
  return useMemo(() => (width && height ? { width, height } : null), [width, height]);
}

/** Part of the open photo. Only for components under the workspace, which renders once it's loaded. */
export function usePhotoDoc<T>(selector: (doc: PhotoProject) => T): T {
  return usePhoto((s) => selector(s.history!.doc));
}
