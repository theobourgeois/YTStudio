/**
 * Edit › Transform's flips and turns of the selected layers, and Image › Image Rotation's of the whole canvas
 * (`shared/photo/orient.ts`): what the menus, the keys (⌘H, ⌥⌘H), Properties and the assistant run.
 */
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { documentMasks } from "@shared/photo/crop";
import { type Orientation, canvasOrientationLabel, orientCanvas, orientLayers } from "@shared/photo/orient";
import type { PhotoProject, SurfaceId } from "@shared/photo/types";
import { isPlaced } from "@shared/photo/types";
import { selectedInOrder } from "./layer-actions";
import { currentDoc, usePhoto } from "./store";
import { sizeOf } from "./tool-edits";
import { orientSurfaces } from "./toolbox/crop-masks";
import { type SurfaceUploads, uploadsFor } from "./uploads";

/** The masks in document pixels oriented with the canvas (old id → new), made and uploaded as a crop's are. */
export async function orientedMasks(uploads: SurfaceUploads, doc: PhotoProject, o: Orientation): Promise<Map<SurfaceId, SurfaceId>> {
  const masks = documentMasks(doc);
  return masks.length ? orientSurfaces(uploads, masks, o, doc.canvas) : new Map();
}

let orienting = false;

export const transformActions = {
  /** The selected layers flipped or turned together (Edit › Transform), one undo step. */
  layers(o: Orientation) {
    const doc = currentDoc();
    const ids = selectedInOrder();
    if (!doc) return;
    const movable = ids.filter((id) => {
      const l = doc.layers.find((x) => x.id === id);
      return l && (isPlaced(l) || l.kind === "generator");
    });
    if (!movable.length) return void toast.message(ids.length ? "An adjustment layer has no place to flip or turn: select a layer with pixels." : "Select a layer to flip or turn.");
    const assets = usePhoto.getState().assets;
    usePhoto.getState().commit((d) => orientLayers(d, movable, o, (l) => sizeOf(l, assets)));
  },

  /** The whole canvas flipped or turned (Image › Image Rotation): its masks in document pixels go with it. */
  async canvas(o: Orientation) {
    const doc = currentDoc();
    const projectId = usePhoto.getState().projectId;
    if (!doc || !projectId || orienting) return;
    orienting = true;
    try {
      const masks = await orientedMasks(uploadsFor(projectId), doc, o);
      if (usePhoto.getState().projectId !== projectId) return;
      if (currentDoc() !== doc) return void toast.message(`The photo changed meanwhile: ${canvasOrientationLabel(o)} wasn't applied. Try again.`);
      usePhoto.getState().commitState((state) => orientCanvas(state, o, masks));
    } catch (error) {
      toast.error("Couldn't rotate or flip the canvas", { description: errorMessage(error) });
    } finally {
      orienting = false;
    }
  },
};
