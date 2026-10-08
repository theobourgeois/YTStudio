import { lazy } from "react";
import { PiImageSquare } from "react-icons/pi";
import type { PhotoProject } from "@shared/photo/types";
import { api } from "@/lib/api";
import type { ClientSuite } from "../types";
import { photoContext, photoLabel } from "./context";
import { isImage } from "./media";
import { newPhotoOptions } from "./preferences";
import { photoSketch } from "./sketch";
import { discardPhoto, flushPhotos, usePhoto } from "./store";
import { runPhotoTool } from "./tools";
import { usePhotoUi } from "./ui";


/** The photo suite (a Photoshop-style editor, docs/photo/): a canvas of layers drawn with WebGPU. */
export const photoSuite: ClientSuite<"photo"> = {
  id: "photo",
  icon: PiImageSquare,
  tint: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
  swatch: "bg-blue-500 dark:bg-blue-400",
  aspect: (p) => (p.width > 0 && p.height > 0 ? p.width / p.height : 1),
  sketch: (p) => photoSketch(p),
  open: (projectId) => usePhoto.getState().open(projectId),
  close: () => usePhoto.getState().close(),
  flush: () => flushPhotos(),
  discard: (projectId) => discardPhoto(projectId),
  Workspace: lazy(() => import("./workspace")),
  settings: {
    title: "Photo",
    description: "The photo editor: the size new photos start at, and the GPU memory its images take.",
    Panel: lazy(() => import("./settings")),
  },
  describe: (p) => `${p.width} × ${p.height} · ${p.layerCount} layer${p.layerCount === 1 ? "" : "s"}`,
  useLiveName: (projectId) => usePhoto((s) => (s.projectId === projectId ? (s.history?.doc.doc.name ?? null) : null)),
  chat: {
    pitch: "can see your photo and work on it: place images, move, scale and rotate layers, brighten it and shape its tones with adjustment layers, size the canvas and export.",
    useSuggestions() {
      const hasLayers = usePhoto((s) => (s.history?.doc.doc.layers.length ?? 0) > 0);
      return hasLayers ? ["Make this a 1280×720 thumbnail", "Add a bit of contrast with Curves", "What do you see?"] : ["What can you do?", "Make the canvas a YouTube thumbnail"];
    },
    ask: "help with your photo",
    useContextLabel: () =>
      usePhoto((s) => {
        if (!s.history) return "";
        return photoLabel(s.history.doc.doc, null);
      }),
    contextHint: "Sent with your message, so the assistant knows the photo",
  },
  messageContext() {
    const { history } = usePhoto.getState();
    return history ? photoContext(history.doc.doc, usePhotoUi.getState().selectedLayerIds) : null;
  },
  runTool: runPhotoTool,
  documents: {
    current: (projectId) => openPhoto(usePhoto.getState(), projectId),
    useCurrent: (projectId) => usePhoto((s) => openPhoto(s, projectId)),
    async snapshot(projectId) {
      const open = openPhoto(usePhoto.getState(), projectId);
      if (open) return { doc: open, exact: true };
      // A photo that isn't open is edited on the server's copy (its tools load and save it).
      return { doc: await api.getDocument("photo", projectId), exact: false };
    },
    restore(projectId, doc) {
      if (usePhoto.getState().projectId !== projectId) return;
      usePhoto.getState().commit((current) => {
        const photo = doc as PhotoProject;
        return photo.name === current.name ? photo : { ...photo, name: current.name };
      });
    },
  },
  // Images dropped on Home on their own start a photo (video gives way to it: src/suites/video.ts).
  startsWith: (files) => (files.length && files.every(isImage) ? files : []),
  async importFiles(files) {
    await usePhoto.getState().placeFiles(files, { asCanvas: true });
  },
  newProjectOptions: newPhotoOptions,
  // New asks first, as Photoshop's New Document: a size (a preset or typed in) and a background, or an image.
  NewProject: lazy(() => import("./new-photo-window")),
};

/** The photo while it's open; mid-gesture, as it was before it. */
function openPhoto(s: ReturnType<typeof usePhoto.getState>, projectId: string): PhotoProject | null {
  return s.projectId === projectId && s.history ? (s.history.gestureBase ?? s.history.doc).doc : null;
}
