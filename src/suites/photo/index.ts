import { lazy } from "react";
import { PiImageSquare } from "react-icons/pi";
import type { ClientSuite } from "../types";
import { photoContext, photoLabel } from "./context";
import { newPhotoOptions } from "./preferences";
import { discardPhoto, flushPhotos, usePhoto } from "./store";
import { runPhotoTool } from "./tools";
import { usePhotoUi } from "./ui";

/** An image file, by its type or its name: what the photo editor opens. */
const isImage = (file: File) => file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name);

/** The photo suite (a Photoshop-style editor, docs/photo/): a canvas of layers drawn with WebGPU. */
export const photoSuite: ClientSuite<"photo"> = {
  id: "photo",
  icon: PiImageSquare,
  tint: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
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
  useLiveName: (projectId) => usePhoto((s) => (s.projectId === projectId ? (s.history?.doc.name ?? null) : null)),
  chat: {
    pitch: "can see your photo and work on it: place images, move, scale and rotate layers, brighten it and shape its tones with adjustment layers, size the canvas and export.",
    useSuggestions() {
      const hasLayers = usePhoto((s) => (s.history?.doc.layers.length ?? 0) > 0);
      return hasLayers ? ["Make this a 1280×720 thumbnail", "Add a bit of contrast with Curves", "What do you see?"] : ["What can you do?", "Make the canvas a YouTube thumbnail"];
    },
    ask: "help with your photo",
    useContextLabel: () =>
      usePhoto((s) => {
        if (!s.history) return "";
        return photoLabel(s.history.doc, null);
      }),
    contextHint: "Sent with your message, so the assistant knows the photo",
  },
  messageContext() {
    const { history } = usePhoto.getState();
    return history ? photoContext(history.doc, usePhotoUi.getState().selectedLayerIds) : null;
  },
  runTool: runPhotoTool,
  // Images dropped on Home on their own start a photo (video gives way to it: src/suites/video.ts).
  startsWith: (files) => (files.length && files.every(isImage) ? files : []),
  async importFiles(files) {
    await usePhoto.getState().placeFiles(files, { asCanvas: true });
  },
  newProjectOptions: newPhotoOptions,
};
