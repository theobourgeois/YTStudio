import { create } from "zustand";
import type { View } from "@shared/photo/geometry";
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
  /** Move: clicking a layer on the canvas selects it (off by default, so a drag never grabs the wrong one). */
  autoSelect: boolean;
  selectedLayerId: string | null;
  /** Null until the canvas has a size (then it fits). */
  view: View | null;
  exportOpen: boolean;
  setTool: (tool: PhotoTool) => void;
  setSpaceHand: (held: boolean) => void;
  setAutoSelect: (on: boolean) => void;
  select: (layerId: string | null) => void;
  setView: (view: View) => void;
  setExportOpen: (open: boolean) => void;
}

export const usePhotoUi = create<PhotoUi>((set) => ({
  tool: "move",
  spaceHand: false,
  autoSelect: false,
  selectedLayerId: null,
  view: null,
  exportOpen: false,
  setTool: (tool) => set({ tool }),
  setSpaceHand: (spaceHand) => set({ spaceHand }),
  setAutoSelect: (autoSelect) => set({ autoSelect }),
  select: (selectedLayerId) => set({ selectedLayerId }),
  setView: (view) => set({ view }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
}));

/** The tool in effect: the Hand while Space is held. */
export const useActiveTool = () => usePhotoUi((s) => (s.spaceHand ? "hand" : s.tool));

// Another photo: a fresh view, nothing selected, its windows closed.
usePhoto.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) usePhotoUi.setState({ selectedLayerId: null, view: null, exportOpen: false, spaceHand: false });
  // A selected layer that's gone (undone, deleted) is no longer selected.
  const selected = usePhotoUi.getState().selectedLayerId;
  if (selected && state.history && !state.history.doc.layers.some((l) => l.id === selected)) usePhotoUi.setState({ selectedLayerId: null });
});
