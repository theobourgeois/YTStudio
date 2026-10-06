import { create } from "zustand";
import type { View } from "@shared/photo/geometry";
import type { Guide } from "./canvas/snap";
import { usePhoto } from "./store";

/** The tools of the strip (ux.md, "Workspace"); more arrive with what they edit. */
export type PhotoTool = "move" | "hand" | "zoom";

/**
 * The photo editor's session state, outside the document and its history: the tool, which layer is selected, the
 * view (device pixels per document pixel and where it is), and the windows. Per open project: it starts afresh.
 */
interface PhotoUi {
  tool: PhotoTool;
  /** Space held: the Hand, until it's let go. */
  spaceHand: boolean;
  selectedLayerId: string | null;
  /** The layer the Move tool would pick under the pointer (outlined, as Photoshop's hover). */
  hoveredLayerId: string | null;
  /** Smart guides shown while a layer is moved or resized onto something. */
  guides: Guide[];
  /** Null until the canvas has a size (then it fits). */
  view: View | null;
  exportOpen: boolean;
  setTool: (tool: PhotoTool) => void;
  setSpaceHand: (held: boolean) => void;
  select: (layerId: string | null) => void;
  hover: (layerId: string | null) => void;
  setGuides: (guides: Guide[]) => void;
  setView: (view: View) => void;
  setExportOpen: (open: boolean) => void;
}

export const usePhotoUi = create<PhotoUi>((set) => ({
  tool: "move",
  spaceHand: false,
  selectedLayerId: null,
  hoveredLayerId: null,
  guides: [],
  view: null,
  exportOpen: false,
  setTool: (tool) => set({ tool }),
  setSpaceHand: (spaceHand) => set({ spaceHand }),
  select: (selectedLayerId) => set({ selectedLayerId }),
  hover: (hoveredLayerId) => set((s) => (s.hoveredLayerId === hoveredLayerId ? s : { hoveredLayerId })),
  setGuides: (guides) => set((s) => (s.guides.length === 0 && guides.length === 0 ? s : { guides })),
  setView: (view) => set({ view }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
}));

/** The tool in effect: the Hand while Space is held. */
export const useActiveTool = () => usePhotoUi((s) => (s.spaceHand ? "hand" : s.tool));

// Another photo: a fresh view, nothing selected, its windows closed.
usePhoto.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) usePhotoUi.setState({ selectedLayerId: null, hoveredLayerId: null, guides: [], view: null, exportOpen: false, spaceHand: false });
  // A selected layer that's gone (undone, deleted) is no longer selected.
  const selected = usePhotoUi.getState().selectedLayerId;
  if (selected && state.history && !state.history.doc.layers.some((l) => l.id === selected)) usePhotoUi.setState({ selectedLayerId: null });
});
