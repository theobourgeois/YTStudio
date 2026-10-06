/**
 * The Layers panel's thumbnails (ux.md, "Workspace"): a layer as it's composited on the canvas (its place, alone,
 * over the checkerboard, its mask left out as Photoshop's content thumbnail does), and its mask (black hides, white
 * reveals), rendered by the same renderer as everything else, a moment after they last changed.
 */
import { useEffect, useState } from "react";
import type { ContentLayer, PhotoLayer, PhotoProject } from "@shared/photo/types";
import { type PhotoRenderer } from "../render/renderer";
import { liveRenderer, useSourceStates } from "../live";
import { usePhoto } from "../store";

/** The thumbnail's width in pixels (drawn at half that in CSS on a 2× screen). */
const SIZE = 72;
const DELAY_MS = 250;

/** One layer alone on the canvas, shown, over transparency, without its mask (with its filters). */
export function thumbnailDoc(doc: PhotoProject, layer: ContentLayer): PhotoProject {
  const { mask: _mask, ...alone } = layer;
  return { ...doc, canvas: { ...doc.canvas, background: null }, layers: [{ ...alone, visible: true, opacity: 1 } as PhotoLayer] };
}

/** An object URL of a picture `render` makes a moment after `deps` change; null until it's made (or while `ready` is false). */
export function useRendered(ready: boolean, render: (renderer: PhotoRenderer) => Promise<Blob | null>, deps: unknown[]): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    let made: string | null = null;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const pending = liveRenderer();
      if (!pending) return;
      try {
        const blob = await render(await pending);
        if (cancelled || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      } catch {
        // A thumbnail is a nicety: the icon stays.
      }
    }, DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // The previous one stays shown until the next is ready; it's let go once that's replaced it.
      if (made) setTimeout(() => URL.revokeObjectURL(made!), DELAY_MS * 4);
    };
  }, [ready, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return ready ? url : null;
}

/** An object URL of the layer's thumbnail, or null until it's rendered (or while its image loads). */
export function useLayerThumbnail(layer: ContentLayer): string | null {
  const width = usePhoto((s) => s.history?.doc.doc.canvas.width);
  const height = usePhoto((s) => s.history?.doc.doc.canvas.height);
  const ready = useSourceStates((s) => layer.kind !== "image" || s.states[layer.mediaId]?.state === "ready");
  // Its place, pixels and filters are what it looks like; its name, visibility and opacity aren't (Photoshop's neither).
  const pixels = layer.kind === "image" ? layer.mediaId : layer.kind === "pixel" ? layer.surface : layer.effect;
  const place = layer.kind === "generator" ? null : layer.transform;
  return useRendered(
    ready && !!width && !!height,
    (renderer) => {
      const doc = usePhoto.getState().history?.doc.doc;
      return doc ? renderer.picture(thumbnailDoc(doc, layer), SIZE) : Promise.resolve(null);
    },
    [pixels, place, layer.filters, layer.filtersEnabled, width, height],
  );
}

/** An object URL of the layer's mask, black where it hides and white where it reveals, or null until it's rendered. */
export function useMaskThumbnail(layer: PhotoLayer): string | null {
  const surface = layer.mask?.surface;
  const ready = useSourceStates((s) => layer.kind !== "image" || s.states[layer.mediaId]?.state === "ready");
  return useRendered(!!layer.mask && ready, (renderer) => renderer.maskPicture(layer.id, SIZE), [surface, layer.id]);
}
