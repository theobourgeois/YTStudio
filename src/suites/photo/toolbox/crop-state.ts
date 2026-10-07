/**
 * The Crop tool's session (docs/photo/tools/crop.md), outside React: what it crops (the canvas, or the one layer
 * selected), the box (in that target's frame: document pixels, or the layer's own), its options, and committing or
 * cancelling. The box is made afresh whenever what it's for changes (the target, the document, the selection), so an
 * undo or the assistant's edit never leaves a stale box. A box that differs from what's there is *pending*: Enter
 * commits it, Escape puts it back, and switching tools applies it (with Undo offered).
 */
import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { type CropRect, canvasCropRect, cropCanvas, cropFromDocBox, cropOf, documentMasks, fullRect, sameRect, setLayerCrop } from "@shared/photo/crop";
import type { Size } from "@shared/photo/geometry";
import { isProjective } from "@shared/photo/projective";
import { type Affine, IDENTITY, layerMatrix } from "@shared/photo/layers";
import { selectionBox } from "@shared/photo/selection";
import { type PhotoProject, type PhotoSelection, type CroppableLayer, isCroppable, isPlaced } from "@shared/photo/types";
import { currentDoc, currentSelection, usePhoto } from "../store";
import { sizeOf } from "../tool-edits";
import { usePhotoUi } from "../ui";
import { uploadsFor } from "../uploads";
import { shiftSurfaces } from "./crop-masks";
import { ratioCrop, swapCrop } from "./crop-geometry";

/** What the Crop tool crops. */
export type CropTarget = { kind: "canvas" } | { kind: "layer"; layerId: string };

/** The options bar's ratios: Photoshop's menu, short-form first. */
export const CROP_RATIOS = [
  { id: "free", label: "Free" },
  { id: "original", label: "Original ratio" },
  { id: "1:1", label: "1 : 1 (Square)", w: 1, h: 1 },
  { id: "4:5", label: "4 : 5 (Portrait post)", w: 4, h: 5 },
  { id: "9:16", label: "9 : 16 (Story / Reel)", w: 9, h: 16 },
  { id: "16:9", label: "16 : 9", w: 16, h: 9 },
  { id: "3:2", label: "3 : 2", w: 3, h: 2 },
  { id: "custom", label: "Custom" },
] as const;

export type CropRatioId = (typeof CROP_RATIOS)[number]["id"];

/** A target's frame: where its box lives (document pixels for the canvas, the layer's own for a layer). */
export interface CropFrame {
  target: CropTarget;
  /** Frame → document pixels. */
  matrix: Affine;
  /** Where the box must stay (a layer's pixels), or null (the canvas's box can grow it). */
  bounds: CropRect | null;
  /** What's there now: the canvas, or the layer's crop (the box with nothing pending). */
  base: CropRect;
  /** Document pixels per frame unit, each way (a ratio on the canvas is this much another in the frame). */
  scale: { x: number; y: number };
  /** The whole layer's, or the canvas's, size in the frame. */
  full: Size;
  /** A layer's name, for the options bar. */
  name: string;
}

interface CropState {
  ratio: CropRatioId;
  /** The ratio fields (Photoshop's W and H), when Custom. */
  custom: { w: number | null; h: number | null };
  /** The Canvas | Layer switch on Canvas with a layer selected (back to Layer when another is selected). */
  canvasChosen: boolean;
  /** The box, in its target's frame; null while there's nothing to crop. */
  box: CropRect | null;
  /** What the box is for: it's made afresh when any of these changes. */
  frame: CropFrame | null;
  for: { doc: PhotoProject | null; selection: PhotoSelection | null; target: string };
  /** A drag is moving the box (the grid shows). */
  dragging: boolean;
  /** A canvas crop is moving masks before it commits. */
  committing: boolean;
}

export const useCrop = create<CropState>(() => ({
  ratio: "free",
  custom: { w: null, h: null },
  canvasChosen: false,
  box: null,
  frame: null,
  for: { doc: null, selection: null, target: "" },
  dragging: false,
  committing: false,
}));

const targetKey = (t: CropTarget) => (t.kind === "canvas" ? "canvas" : `layer:${t.layerId}`);

/** The one image or pixel layer selected (with a size), when there's exactly one. */
function selectedPlaced(doc: PhotoProject): { layer: CroppableLayer; size: Size } | null {
  const { selectedLayerIds } = usePhotoUi.getState();
  if (selectedLayerIds.length !== 1) return null;
  const layer = doc.layers.find((l) => l.id === selectedLayerIds[0]);
  const size = layer ? sizeOf(layer, usePhoto.getState().assets) : null;
  // A layer in perspective isn't cropped by its own frame here (that's affine): the Crop tool crops the canvas.
  return layer && isCroppable(layer) && size && !isProjective(layer.transform) ? { layer, size } : null;
}

/** Whether a layer could be cropped now (one image or pixel layer selected): the switch's Layer side. */
export const croppableLayer = (doc: PhotoProject) => selectedPlaced(doc)?.layer ?? null;

/** The frame for the open photo as things are: the selected layer's (unless Canvas is chosen), else the canvas's. */
export function frameFor(doc: PhotoProject, canvasChosen = useCrop.getState().canvasChosen): CropFrame {
  const picked = canvasChosen ? null : selectedPlaced(doc);
  if (picked) {
    const { layer, size } = picked;
    const t = layer.transform;
    return { target: { kind: "layer", layerId: layer.id }, matrix: layerMatrix(t, size), bounds: fullRect(size), base: cropOf(layer, size), scale: { x: Math.abs(t.scaleX), y: Math.abs(t.scaleY) }, full: size, name: layer.name };
  }
  const canvas = { width: doc.canvas.width, height: doc.canvas.height };
  return { target: { kind: "canvas" }, matrix: IDENTITY, bounds: null, base: fullRect(canvas), scale: { x: 1, y: 1 }, full: canvas, name: "Canvas" };
}

/** Where a new box starts: at the selection's bounds (Photoshop's), else what's there now. */
function startingBox(frame: CropFrame, selection: PhotoSelection | null, doc: PhotoProject): CropRect {
  if (!selection) return frame.base;
  const b = selectionBox(selection);
  const box = { x: Math.floor(b.x0), y: Math.floor(b.y0), width: Math.ceil(b.x1) - Math.floor(b.x0), height: Math.ceil(b.y1) - Math.floor(b.y0) };
  if (frame.target.kind === "canvas") return box;
  const layer = doc.layers.find((l) => frame.target.kind === "layer" && l.id === frame.target.layerId);
  return (layer && isPlaced(layer) && cropFromDocBox(layer.transform, frame.full, box)) || frame.base;
}

/** Makes the box afresh when what it's for has changed (the target, the document, the selection). */
export function syncCrop() {
  const doc = currentDoc();
  const s = useCrop.getState();
  if (!doc) {
    if (s.frame) useCrop.setState({ frame: null, box: null, for: { doc: null, selection: null, target: "" }, dragging: false });
    return;
  }
  const selection = currentSelection();
  const frame = frameFor(doc);
  const target = targetKey(frame.target);
  if (s.for.doc === doc && s.for.selection === selection && s.for.target === target && s.frame) return;
  useCrop.setState({ frame, box: startingBox(frame, selection, doc), for: { doc, selection, target }, dragging: false });
}

/** The box made afresh (as the tool starts again: Escape, a commit). */
export function resetCrop() {
  useCrop.setState({ for: { doc: null, selection: null, target: "" } });
  syncCrop();
}

/** A box as it would be committed: whole document pixels for the canvas, whole layer pixels for a layer. */
export function committedBox(box: CropRect, frame: CropFrame): CropRect | null {
  if (frame.target.kind === "canvas") return canvasCropRect(box);
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const r = { x, y, width: Math.round(box.x + box.width) - x, height: Math.round(box.y + box.height) - y };
  return r.width >= 1 && r.height >= 1 ? r : null;
}

/** Whether the box would change something. */
export function isPending(s: Pick<CropState, "box" | "frame"> = useCrop.getState()): boolean {
  if (!s.box || !s.frame) return false;
  const r = committedBox(s.box, s.frame);
  return !!r && !sameRect(r, s.frame.base);
}

/** The ratio the box keeps, in its frame's units (width / height), or null (Free). */
export function frameRatio(s: Pick<CropState, "ratio" | "custom" | "frame"> = useCrop.getState()): number | null {
  if (!s.frame) return null;
  const entry = CROP_RATIOS.find((r) => r.id === s.ratio);
  let r: number | null = null;
  if (s.ratio === "original") return s.frame.full.width / s.frame.full.height;
  if (entry && "w" in entry) r = entry.w / entry.h;
  else if (s.ratio === "custom" && s.custom.w && s.custom.h) r = s.custom.w / s.custom.h;
  // A ratio on the canvas, in the frame's units (a layer scaled more one way than the other).
  return r === null ? null : (r * s.frame.scale.y) / s.frame.scale.x;
}

/** The ratio chosen, the box made the largest of it inside what can be cropped (Photoshop's), about its centre. */
export function chooseRatio(ratio: CropRatioId, custom?: { w: number | null; h: number | null }) {
  useCrop.setState({ ratio, ...(custom ? { custom } : {}) });
  const s = useCrop.getState();
  const r = frameRatio(s);
  if (!r || !s.frame || !s.box) return;
  const within = s.frame.bounds ?? s.frame.base;
  useCrop.setState({ box: ratioCrop(within, r, { x: s.box.x + s.box.width / 2, y: s.box.y + s.box.height / 2 }) });
}

/** ⇄ (X): the ratio's sides swapped, and the box turned on its side. */
export function swapSides() {
  const s = useCrop.getState();
  const entry = CROP_RATIOS.find((r) => r.id === s.ratio);
  if (entry && "w" in entry) {
    const swapped = CROP_RATIOS.find((r) => "w" in r && r.w === entry.h && r.h === entry.w);
    if (swapped) useCrop.setState({ ratio: swapped.id });
    else useCrop.setState({ ratio: "custom", custom: { w: entry.h, h: entry.w } });
  } else if (s.ratio === "custom") useCrop.setState({ custom: { w: s.custom.h, h: s.custom.w } });
  if (s.box && s.frame) useCrop.setState({ box: swapCrop(s.box, s.frame.bounds) });
}

/** Clear: no ratio, and the box back over what's there (a layer's whole self, to take its crop off). */
export function clearCrop() {
  const s = useCrop.getState();
  useCrop.setState({ ratio: "free", custom: { w: null, h: null }, box: s.frame ? (s.frame.bounds ?? s.frame.base) : s.box });
}

/** Escape and ✕: the box put back; with nothing pending, the layers deselected (back to the canvas). */
export function cancelCrop(): "cancelled" | "deselected" | null {
  if (isPending()) {
    useCrop.setState((s) => ({ box: s.frame?.base ?? s.box }));
    return "cancelled";
  }
  if (usePhotoUi.getState().selectedLayerIds.length) {
    usePhotoUi.getState().select(null);
    return "deselected";
  }
  return null;
}

/**
 * Crops: the canvas (its document masks moved first, then one undo step of the document and the selection), or the
 * layer (its crop set, one undo step). Resolves to whether it did; a failure is told in a toast.
 */
export async function commitCrop(): Promise<boolean> {
  const s = useCrop.getState();
  const projectId = usePhoto.getState().projectId;
  if (!s.box || !s.frame || !projectId || s.committing || !isPending(s)) return false;
  const box = committedBox(s.box, s.frame)!;
  const frame = s.frame;
  if (frame.target.kind === "layer") {
    const id = frame.target.layerId;
    usePhoto.getState().commit((d) => setLayerCrop(d, id, box, frame.full));
    resetCrop();
    return true;
  }
  const doc = currentDoc()!;
  useCrop.setState({ committing: true });
  try {
    const masks = documentMasks(doc);
    const moved = (box.x || box.y) && masks.length ? await shiftSurfaces(uploadsFor(projectId), masks, -box.x, -box.y, { width: box.width, height: box.height }) : new Map();
    if (usePhoto.getState().projectId !== projectId) return false;
    usePhoto.getState().commitState((state) => cropCanvas(state, box, moved));
    resetCrop();
    return true;
  } catch (error) {
    toast.error("Couldn't crop the canvas", { description: errorMessage(error) });
    return false;
  } finally {
    useCrop.setState({ committing: false });
  }
}

/** The canvas as it shows while a layer is cropped: that layer whole, so the crop can be widened (its outside dimmed). */
export function cropShownDoc(doc: PhotoProject): PhotoProject {
  const { tool } = usePhotoUi.getState();
  const frame = useCrop.getState().frame;
  if (tool !== "crop" || frame?.target.kind !== "layer") return doc;
  const id = frame.target.layerId;
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer || !isCroppable(layer) || !layer.crop) return doc;
  return setLayerCrop(doc, id, null, frame.full);
}

/** Whether the canvas's shown document depends on the crop session (live.ts redraws when this changes). */
export const cropPreviewKey = () => {
  const frame = useCrop.getState().frame;
  return usePhotoUi.getState().tool === "crop" && frame?.target.kind === "layer" ? frame.target.layerId : null;
};

// The box follows the photo, its selection and the selected layers; another selected layer is cropped as a layer
// again; leaving the tool with a crop pending applies it (Photoshop asks; ours is one undo step away).
usePhoto.subscribe((state, prev) => {
  if (state.history?.doc !== prev.history?.doc || state.assets !== prev.assets) syncCrop();
});
usePhotoUi.subscribe((state, prev) => {
  if (state.selectedLayerId !== prev.selectedLayerId && useCrop.getState().canvasChosen) useCrop.setState({ canvasChosen: false });
  if (state.tool !== prev.tool && prev.tool === "crop" && isPending()) {
    void commitCrop().then((done) => {
      if (done) toast("Cropped", { description: "Leaving the Crop tool applied its crop.", action: { label: "Undo", onClick: () => usePhoto.getState().undo() } });
    });
  }
  if (state.selectedLayerIds !== prev.selectedLayerIds || state.tool !== prev.tool) syncCrop();
});
useCrop.subscribe((state, prev) => {
  if (state.canvasChosen !== prev.canvasChosen) syncCrop();
});
