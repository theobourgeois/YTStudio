import { create } from "zustand";
import type { View } from "@shared/photo/geometry";
import type { EffectParamValue } from "@shared/photo/types";
import type { Box, Guide } from "./canvas/snap";
import type { PaintTarget } from "./paint-target";
import { usePhoto } from "./store";

/** The tools of the strip (ux.md, "Workspace"); more arrive with what they edit. */
export type PhotoTool = "move" | "marquee" | "brush" | "eraser" | "hand" | "zoom";

export type { PaintTarget };

/**
 * The photo editor's session state, outside the document and its history: the tool, which layers are selected, the
 * view (device pixels per document pixel and where it is), and the windows. Per open project: it starts afresh.
 */
interface PhotoUi {
  tool: PhotoTool;
  /** Space held: the Hand, until it's let go. */
  spaceHand: boolean;
  /** What the brush paints on the active layer (a click on its mask's thumbnail targets the mask). */
  target: PaintTarget;
  /** An image layer the brush was pressed on: the choice between a new paint layer and converting it (ux.md). */
  paintChoice: string | null;
  /** The selected layers (Photoshop's: several at once), in the order they were picked. */
  selectedLayerIds: string[];
  /**
   * The one acted on alone (Properties shows it; a Shift range starts from it): the last picked, or null when
   * nothing is selected. Always one of `selectedLayerIds`.
   */
  selectedLayerId: string | null;
  /** The layer the Move tool would pick under the pointer (outlined, as Photoshop's hover). */
  hoveredLayerId: string | null;
  /** A filter of the active layer that Properties shows instead of the layer (clicked in Layers), or null. */
  selectedFilterId: string | null;
  /** A generator's element that Properties shows (clicked in its list), or null. */
  selectedElementId: string | null;
  /** Smart guides shown while a layer is moved or resized onto something. */
  guides: Guide[];
  /** The marquee being drawn on the canvas (document pixels), selecting the layers it touches. */
  marquee: Box | null;
  /** Null until the canvas has a size (then it fits). */
  view: View | null;
  exportOpen: boolean;
  /** The Filter Gallery window (every filter's looks; the one picked previewed on the photo). */
  filterGalleryOpen: boolean;
  /**
   * The look the Filter Gallery shows on the canvas before it's applied (on the active layer, or a generator's new
   * layer above it), with the settings it would be applied with: the renderer shows it, the document doesn't have
   * it (no undo step, nothing saved) until Apply.
   */
  filterPreview: { key: string; params: Record<string, EffectParamValue> } | null;
  /**
   * The filter added last (Photoshop's Filter › Last Filter, ⌃⌘F, adds it again): its type and the filter it made,
   * whose settings are what's added again (it may have been changed since; its first ones if it's gone).
   */
  lastFilter: { type: string; layerId: string; filterId: string; params: Record<string, unknown> } | null;
  /** The Layer Style window: its layer and the page it shows ("blending", or an effect's id), or null when it's closed. */
  layerStyle: { layerId: string; page: string } | null;
  /** The Scale Effects window's layers, or null when it's closed. */
  scaleEffects: string[] | null;
  setTool: (tool: PhotoTool) => void;
  setTarget: (target: PaintTarget) => void;
  setPaintChoice: (layerId: string | null) => void;
  setSpaceHand: (held: boolean) => void;
  /** That layer alone, or nothing. */
  select: (layerId: string | null) => void;
  /** These layers; `active` (default: the last) is the one acted on alone. */
  setSelection: (layerIds: readonly string[], active?: string | null) => void;
  hover: (layerId: string | null) => void;
  /** A filter of a layer: that layer alone selected, and the filter shown in Properties. */
  selectFilter: (layerId: string, filterId: string | null) => void;
  selectElement: (elementId: string | null) => void;
  setGuides: (guides: Guide[]) => void;
  setMarquee: (marquee: Box | null) => void;
  setView: (view: View) => void;
  setExportOpen: (open: boolean) => void;
  /** Opens or closes the Filter Gallery (closing drops its preview). */
  setFilterGalleryOpen: (open: boolean) => void;
  setFilterPreview: (preview: PhotoUi["filterPreview"]) => void;
  setLastFilter: (last: PhotoUi["lastFilter"]) => void;
  setLayerStyle: (open: { layerId: string; page: string } | null) => void;
  setScaleEffects: (layerIds: string[] | null) => void;
}

export const usePhotoUi = create<PhotoUi>((set) => ({
  tool: "move",
  target: "content",
  paintChoice: null,
  spaceHand: false,
  selectedLayerIds: [],
  selectedLayerId: null,
  hoveredLayerId: null,
  selectedFilterId: null,
  selectedElementId: null,
  guides: [],
  marquee: null,
  view: null,
  exportOpen: false,
  filterGalleryOpen: false,
  filterPreview: null,
  lastFilter: null,
  layerStyle: null,
  scaleEffects: null,
  setTool: (tool) => set({ tool }),
  setTarget: (target) => set({ target }),
  setPaintChoice: (paintChoice) => set({ paintChoice }),
  setSpaceHand: (spaceHand) => set({ spaceHand }),
  // Another active layer is targeted by its content first (its mask's thumbnail targets the mask).
  select: (layerId) => set((s) => ({ ...selectionOf(layerId ? [layerId] : []), target: layerId === s.selectedLayerId ? s.target : "content", selectedFilterId: null, selectedElementId: layerId === s.selectedLayerId ? s.selectedElementId : null })),
  setSelection: (layerIds, active) =>
    set((s) => {
      const next = selectionOf(layerIds, active);
      const same = next.selectedLayerId === s.selectedLayerId;
      return { ...next, target: same ? s.target : "content", selectedFilterId: same ? s.selectedFilterId : null, selectedElementId: same ? s.selectedElementId : null };
    }),
  selectFilter: (layerId, filterId) => set((s) => ({ ...selectionOf([layerId]), target: layerId === s.selectedLayerId ? s.target : "content", selectedFilterId: filterId, selectedElementId: null })),
  selectElement: (selectedElementId) => set({ selectedElementId }),
  hover: (hoveredLayerId) => set((s) => (s.hoveredLayerId === hoveredLayerId ? s : { hoveredLayerId })),
  setGuides: (guides) => set((s) => (s.guides.length === 0 && guides.length === 0 ? s : { guides })),
  setMarquee: (marquee) => set({ marquee }),
  setView: (view) => set({ view }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setFilterGalleryOpen: (filterGalleryOpen) => set(filterGalleryOpen ? { filterGalleryOpen } : { filterGalleryOpen, filterPreview: null }),
  setFilterPreview: (filterPreview) => set({ filterPreview }),
  setLastFilter: (lastFilter) => set({ lastFilter }),
  setLayerStyle: (layerStyle) => set({ layerStyle }),
  setScaleEffects: (scaleEffects) => set({ scaleEffects }),
}));

/** A selection as the store keeps it: no repeats, and the active layer one of them (the last, by default). */
function selectionOf(layerIds: readonly string[], active?: string | null) {
  const ids = [...new Set(layerIds)];
  const chosen = active && ids.includes(active) ? active : (ids.at(-1) ?? null);
  return { selectedLayerIds: ids, selectedLayerId: chosen };
}

/** The tool in effect: the Hand while Space is held. */
export const useActiveTool = () => usePhotoUi((s) => (s.spaceHand ? "hand" : s.tool));

// Another photo: a fresh view, nothing selected, its windows closed.
usePhoto.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId)
    usePhotoUi.setState({ selectedLayerIds: [], selectedLayerId: null, hoveredLayerId: null, selectedFilterId: null, selectedElementId: null, guides: [], marquee: null, view: null, exportOpen: false, filterGalleryOpen: false, filterPreview: null, lastFilter: null, layerStyle: null, scaleEffects: null, spaceHand: false, target: "content", paintChoice: null });
  // Selected layers that are gone (undone, deleted) are no longer selected.
  const { selectedLayerIds, selectedLayerId } = usePhotoUi.getState();
  if (!state.history || selectedLayerIds.length === 0 || state.history.doc.doc.layers === prev.history?.doc.doc.layers) return;
  const there = new Set(state.history.doc.doc.layers.map((l) => l.id));
  const kept = selectedLayerIds.filter((id) => there.has(id));
  if (kept.length !== selectedLayerIds.length) usePhotoUi.setState(selectionOf(kept, selectedLayerId));
});
