import { useMemo } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { addImageLayer, fromImage, placement } from "@shared/photo/edits";
import { sameSelection } from "@shared/photo/selection";
import type { PhotoProject, PhotoSelection, PhotoState } from "@shared/photo/types";
import type { MediaAsset } from "@shared/types";
import { ApiRequestError, api } from "@/lib/api";
import { createAutosaver } from "@/lib/autosaver";
import { DocumentGesture, type DocumentHistory, commit, historyOf, redo, rewrite, undo } from "@/lib/document-history";
import { uploadsFor } from "./uploads";
import { useProjects } from "@/stores/projects";
import { imageLayerOf, isDefaultName, projectNameOf } from "./media";

/**
 * The open photo: its document and selection with undo (`lib/document-history.ts`: a `PhotoState`, so selecting
 * is an undo step, as in Photoshop) and the project's media (its images). Every change to the document is a pure
 * edit from `shared/photo/edits.ts`, through `commit` (one undo step) or a `photoGesture()` (a drag); the selection
 * changes through `select`. Only the document is saved, and only once the pixels it names are uploaded (the
 * publication gate, `uploads.ts`). Which layers are selected, the tool and the view are in `ui.ts`; the GPU follows
 * the document from the workspace (`render/renderer.ts`).
 */
interface Point {
  x: number;
  y: number;
}

interface PhotoStore {
  projectId: string | null;
  history: DocumentHistory<PhotoState> | null;
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
  /** An edit of the document and the selection together (one undo step). */
  commitState: (update: (state: PhotoState) => PhotoState) => void;
  /** Selects (null: deselects), as one undo step. */
  select: (selection: PhotoSelection | null) => void;
  undo: () => void;
  redo: () => void;
  /**
   * Image files as new layers on top (uploaded as the project's media). `asCanvas`: an empty photo takes the first
   * image's size, as Photoshop opening a file does. `at`: centred on this point of the canvas (where they were
   * dropped), else on the canvas's middle. Returns the new layers' ids.
   */
  placeFiles: (files: File[], options?: { asCanvas?: boolean; at?: Point }) => Promise<string[]>;
  /** One of the project's images as a new layer on top (centred on `at`, if given). Returns its id. */
  placeMedia: (asset: MediaAsset, options?: { asCanvas?: boolean; name?: string; at?: Point }) => string | null;
}

const autosaver = createAutosaver<PhotoProject, Awaited<ReturnType<typeof api.saveDocument>>>({
  save: async (id, doc, keepalive) => {
    usePhoto.setState({ saving: true });
    // The publication gate: the server must have every surface the document names before it's saved. (A page
    // going away can't wait: the server refuses one naming what it hasn't got, and the last good save stays.)
    if (!keepalive) await uploadsFor(id).ready(doc);
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


/** What a document edit does to the state: the same state when the document doesn't change. */
const onDoc = (update: (doc: PhotoProject) => PhotoProject) => (state: PhotoState) => {
  const doc = update(state.doc);
  return doc === state.doc ? state : { ...state, doc };
};

export const usePhoto = create<PhotoStore>((set, get) => ({
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
      set({ history: historyOf<PhotoState>({ doc, selection: null }), assets, loading: false, savedAt: Date.now() });
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
    if (!history || !trimmed || trimmed === history.doc.doc.name) return;
    // Not an undoable edit: undo mustn't bring the old name back.
    set({ history: rewrite(history, (state) => ({ ...state, doc: { ...state.doc, name: trimmed } })) });
  },

  commit(update) {
    get().commitState(onDoc(update));
  },

  commitState(update) {
    const { history } = get();
    if (!history) return;
    const next = commit(history, update);
    if (next !== history) set({ history: next });
  },

  select(selection) {
    get().commitState((state) => (sameSelection(state.selection, selection) ? state : { ...state, selection }));
  },

  undo() {
    const { history } = get();
    if (history) set({ history: undo(history) });
  },

  redo() {
    const { history } = get();
    if (history) set({ history: redo(history) });
  },

  placeMedia(asset, { asCanvas = false, name, at } = {}) {
    const { history } = get();
    if (!history || asset.kind !== "image") return null;
    const layer = imageLayerOf(asset, name);
    get().commit((doc) => {
      if (asCanvas && doc.layers.length === 0) return fromImage(doc, layer);
      // Fitted in the canvas as ever, but centred where it was dropped (as Photoshop places a file dragged in).
      return addImageLayer(doc, layer, at ? { transform: { ...placement(doc.canvas, layer.size), x: Math.round(at.x), y: Math.round(at.y) } } : {});
    });
    return layer.id;
  },

  async placeFiles(files, { asCanvas = false, at } = {}) {
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
        const first = asCanvas && ids.length === 0;
        const wasEmpty = currentDoc()?.layers.length === 0;
        const id = get().placeMedia(asset, { asCanvas: first, at });
        if (id) ids.push(id);
        // A photo opened from an image is called what the image is (Photoshop's document takes the file's name),
        // unless it's been named already.
        if (id && first && wasEmpty && isDefaultName(currentDoc()?.name ?? "")) get().rename(projectNameOf(file.name));
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
  // A selection changing isn't a save.
  if (state.history.gestureBase || (state.history.doc.doc === prev.history.doc.doc && !gestureEnded)) return;
  autosaver.queue(state.projectId, state.history.doc.doc);
});

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    const { projectId, history } = usePhoto.getState();
    if (projectId && history?.gestureBase && history.doc !== history.gestureBase) autosaver.queue(projectId, history.doc.doc);
    autosaver.saveOnUnload();
  });
}

export const flushPhotos = () => autosaver.flush();
export const discardPhoto = (projectId: string) => autosaver.discard(projectId);

/** A drag or other continuous edit of the open photo's document, as one undo step. */
export class PhotoGesture {
  private readonly gesture = new DocumentGesture<PhotoState>({
    get: () => usePhoto.getState().history,
    set: (history) => usePhoto.setState({ history }),
  });

  get active() {
    return this.gesture.active;
  }

  begin() {
    this.gesture.begin();
  }

  /** An edit of the document (relative ones apply to the current one: a gesture previews on the document as it is). */
  apply(update: (doc: PhotoProject) => PhotoProject) {
    this.gesture.apply(onDoc(update));
  }

  /** An edit of the document and the selection (a marquee drag's). */
  applyState(update: (state: PhotoState) => PhotoState) {
    this.gesture.apply(update);
  }

  end() {
    this.gesture.end();
  }

  cancel() {
    this.gesture.cancel();
  }
}

export const photoGesture = () => new PhotoGesture();

/** The open photo's document now (null when none is open). */
export const currentDoc = (): PhotoProject | null => usePhoto.getState().history?.doc.doc ?? null;

/** The open photo's selection now. */
export const currentSelection = (): PhotoSelection | null => usePhoto.getState().history?.doc.selection ?? null;

/** A layer's source size in its own pixels (null while its image is missing), stable across renders. */
export function useLayerSize(mediaId: string | undefined): { width: number; height: number } | null {
  const width = usePhoto((s) => s.assets.find((a) => a.id === mediaId)?.width ?? null);
  const height = usePhoto((s) => s.assets.find((a) => a.id === mediaId)?.height ?? null);
  return useMemo(() => (width && height ? { width, height } : null), [width, height]);
}

/** Part of the open photo. Only for components under the workspace, which renders once it's loaded. */
export function usePhotoDoc<T>(selector: (doc: PhotoProject) => T): T {
  return usePhoto((s) => selector(s.history!.doc.doc));
}

/** The open photo's selection. */
export const useSelection = () => usePhoto((s) => s.history?.doc.selection ?? null);
