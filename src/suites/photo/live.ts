/**
 * The open photo's renderer, outside React: the canvas draws with it, and exports, Home's cover and the
 * assistant's pictures render with it too. A photo that isn't open (an assistant call in another chat) gets a
 * renderer of its own for the call, without a canvas.
 */
import type { PhotoProject } from "@shared/photo/types";
import type { MediaAsset } from "@shared/types";
import { api } from "@/lib/api";
import { budgetBytes } from "./preferences";
import { create } from "zustand";
import { PhotoRenderer, type SourceState } from "./render/renderer";
import { usePhoto } from "./store";

let open: { projectId: string; renderer: Promise<PhotoRenderer> } | null = null;

/** The open photo's images: loading, ready, missing or failed (the Layers panel and the status bar show it). */
export const useSourceStates = create<{ states: Record<string, SourceState> }>(() => ({ states: {} }));

/** The renderer of the open photo, made on first use; null when no photo is open. */
export function liveRenderer(): Promise<PhotoRenderer> | null {
  const { projectId, history, assets } = usePhoto.getState();
  if (!projectId || !history) return null;
  if (open?.projectId !== projectId) {
    closeRenderer();
    const renderer = PhotoRenderer.create(budgetBytes());
    open = { projectId, renderer };
    void renderer.then((r) => {
      r.onSourceState = (mediaId, state) => {
        if (open?.renderer === renderer) useSourceStates.setState((s) => ({ states: { ...s.states, [mediaId]: state } }));
      };
      r.setDocument(projectId, history.doc, assets);
    }, () => {});
  }
  return open.renderer;
}

export function closeRenderer() {
  const closing = open;
  open = null;
  useSourceStates.setState({ states: {} });
  void closing?.renderer.then((r) => r.destroy(), () => {});
}

// The renderer follows the document and the project's media; another project closes it.
usePhoto.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) {
    closeRenderer();
    return;
  }
  if (!open || !state.projectId || !state.history) return;
  if (state.history.doc === prev.history?.doc && state.assets === prev.assets) return;
  const { projectId, history, assets } = state;
  void open.renderer.then((r) => r.setDocument(projectId, history.doc, assets), () => {});
});

/**
 * Runs `task` with a renderer showing `doc`, every image loaded: the open photo's, or one made for the call
 * (and destroyed after) for a photo that isn't open.
 */
export async function withRenderer<T>(projectId: string, doc: PhotoProject, assets: MediaAsset[] | null, task: (renderer: PhotoRenderer) => Promise<T>): Promise<T> {
  if (usePhoto.getState().projectId === projectId) {
    const renderer = await liveRenderer()!;
    renderer.setDocument(projectId, doc, assets ?? usePhoto.getState().assets);
    await renderer.ready();
    return task(renderer);
  }
  const renderer = await PhotoRenderer.create(512 * 1024 ** 2);
  try {
    renderer.setDocument(projectId, doc, assets ?? (await api.listMedia(projectId)));
    await renderer.ready();
    return await task(renderer);
  } finally {
    renderer.destroy();
  }
}
