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
import { PhotoRenderer, type RefineState, type SourceState } from "./render/renderer";
import { usePhoto } from "./store";
import { commitSurface } from "./paint-target";
import { shownDoc } from "./filter-preview";
import { usePhotoUi } from "./ui";
import { cropPreviewKey, cropShownDoc, useCrop } from "./toolbox/crop-state";

let open: { projectId: string; renderer: Promise<PhotoRenderer> } | null = null;

/** The open photo's images: loading, ready, missing or failed (the Layers panel and the status bar show it). */
export const useSourceStates = create<{ states: Record<string, SourceState> }>(() => ({ states: {} }));

/** Whether the screen shows its final picture, or a preview while the full-resolution one is made (the status bar). */
export const useRenderState = create<{ refine: RefineState }>(() => ({ refine: "none" }));

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
      r.onRefineState = (refine) => {
        if (open?.renderer === renderer) useRenderState.setState({ refine });
      };
      r.setDocument(projectId, shown(history.doc.doc), assets);
    }, () => {});
  }
  return open.renderer;
}

/**
 * What the canvas shows of `doc`: with the Filter Gallery's look while one is picked, and the layer the Crop tool
 * crops shown whole (docs/photo/tools/crop.md).
 */
const shown = (doc: PhotoProject) => {
  const { filterPreview, selectedLayerId } = usePhotoUi.getState();
  return cropShownDoc(shownDoc(doc, filterPreview, selectedLayerId));
};

export function closeRenderer() {
  const closing = open;
  open = null;
  useSourceStates.setState({ states: {} });
  useRenderState.setState({ refine: "none" });
  void closing?.renderer.then((r) => r.destroy(), () => {});
}

// The renderer follows the document and the project's media; another project closes it.
usePhoto.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) {
    closeRenderer();
    return;
  }
  if (!open || !state.projectId || !state.history) return;
  if (state.history.doc.doc === prev.history?.doc.doc && state.assets === prev.assets) return;
  const { projectId, history, assets } = state;
  void open.renderer.then((r) => r.setDocument(projectId, shown(history.doc.doc), assets), () => {});
});

// The gallery's look follows what's picked, its settings and the active layer it goes on.
usePhotoUi.subscribe((state, prev) => {
  if (state.filterPreview === prev.filterPreview && (state.selectedLayerId === prev.selectedLayerId || (!state.filterPreview && !prev.filterPreview))) return;
  const { projectId, history, assets } = usePhoto.getState();
  if (!open || !projectId || !history) return;
  void open.renderer.then((r) => r.setDocument(projectId, shown(history.doc.doc), assets), () => {});
});

// The layer the Crop tool crops shows whole while it's cropped, and as it is again after.
let cropShown: string | null = null;
const followCrop = () => {
  const key = cropPreviewKey();
  if (key === cropShown) return;
  cropShown = key;
  const { projectId, history, assets } = usePhoto.getState();
  if (!open || !projectId || !history) return;
  void open.renderer.then((r) => r.setDocument(projectId, shown(history.doc.doc), assets), () => {});
};
useCrop.subscribe(followCrop);
usePhotoUi.subscribe(followCrop);

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

/**
 * In development (and so in e2e), the renderer and stores on `window.photoDebug`: the tests read the GPU's own
 * numbers (`readScreen`, `stats`, `presented`) for the gates no screenshot can check.
 */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { photoDebug: unknown }).photoDebug = {
    renderer: () => liveRenderer(),
    photo: usePhoto,
    ui: usePhotoUi,
    renderState: useRenderState,
    /**
     * A stroke from these samples (document pixels) on a layer's pixels or mask, committed as the brush's is (one
     * undo step), or dropped (`cancel`): the gates paint exactly the same samples at different views.
     */
    async paint(layerId: string, part: "content" | "mask", points: { x: number; y: number }[], options: { radius?: number; hardness?: number; strength?: number; colour?: number[]; cancel?: boolean } = {}) {
      const renderer = await liveRenderer()!;
      for (let i = 0; i < 200 && !renderer.beginStroke(layerId, part, { radius: options.radius ?? 30, hardness: options.hardness ?? 0.8, strength: options.strength ?? 1, spacing: 0.1 }, options.colour ?? [0, 0, 0, 1], usePhoto.getState().history?.doc.selection ?? null); i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      if (!renderer.stroking) throw new Error(`Layer ${layerId}'s ${part} isn't on the GPU.`);
      renderer.strokeTo(points);
      if (options.cancel) {
        renderer.cancelStroke();
        return null;
      }
      const started = performance.now();
      const result = await renderer.endStroke();
      if (!result) return null;
      usePhoto.getState().commit(commitSurface(layerId, part, result.id));
      return { ...result, commitMs: performance.now() - started };
    },
  };
  // `scripts/photo-bench.ts`'s scenarios, loaded only when asked for.
  (window as unknown as { photoBench: unknown }).photoBench = { load: () => import("./bench") };
}
