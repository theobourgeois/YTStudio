/**
 * The Layers panel's thumbnails (ux.md, "Workspace"): a layer as it's composited on the canvas (its place, alone,
 * over the checkerboard), rendered by the same renderer as everything else, a moment after it last changed.
 */
import { useEffect, useState } from "react";
import type { ImageLayer, PhotoProject } from "@shared/photo/types";
import { liveRenderer, useSourceStates } from "../live";
import { usePhoto } from "../store";

/** The thumbnail's width in pixels (drawn at half that in CSS on a 2× screen). */
const SIZE = 72;
const DELAY_MS = 250;

/** One layer alone on the canvas, shown, over transparency. */
export function thumbnailDoc(doc: PhotoProject, layer: ImageLayer): PhotoProject {
  return { ...doc, canvas: { ...doc.canvas, background: null }, layers: [{ ...layer, visible: true, opacity: 1 }] };
}

/** An object URL of the layer's thumbnail, or null until it's rendered (or while its image loads). */
export function useLayerThumbnail(layer: ImageLayer): string | null {
  const width = usePhoto((s) => s.history?.doc.canvas.width);
  const height = usePhoto((s) => s.history?.doc.canvas.height);
  const ready = useSourceStates((s) => s.states[layer.mediaId]?.state === "ready");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !width || !height) return;
    let made: string | null = null;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const pending = liveRenderer();
      const doc = usePhoto.getState().history?.doc;
      if (!pending || !doc) return;
      try {
        const renderer = await pending;
        const blob = await renderer.picture(thumbnailDoc(doc, layer), SIZE);
        if (cancelled) return;
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
    // Its place and image are what it looks like; its name, visibility and opacity aren't (Photoshop's neither).
  }, [layer.mediaId, layer.transform, width, height, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return ready ? url : null;
}
