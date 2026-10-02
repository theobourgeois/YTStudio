import { create } from "zustand";
import type { PanMan, PanShapeEvent, PanStepPoint } from "@shared/music/types";
import { useMusic } from "../store";

/** How a PanMan's window shows itself (Soundtoys keeps these in the plugin; here they're the tab's). */
export interface PanView {
  /** The Tweak panel is open. */
  tweak: boolean;
  /** The editors' bar shown (0: the first) and grid (`PAN_GRIDS`). */
  bar: number;
  grid: string;
}

export const DEFAULT_VIEW: PanView = { tweak: false, bar: 0, grid: "1/8" };

/** A drag on an editor, drawn as it goes and made one edit when it's let go. */
export type PanDrag = { effectId: string; editor: "step"; points: PanStepPoint[] } | { effectId: string; editor: "shape"; events: PanShapeEvent[] };

/** What PanMan's windows know that isn't the song: which are open, how each shows itself, a drag, a copy. */
interface PanUiState {
  /** The PanMen (by effect id) whose windows are open. */
  openIds: string[];
  views: Record<string, PanView>;
  drag: PanDrag | null;
  /** A whole PanMan's settings copied (Copy state), to paste on another. */
  copied: PanMan | null;

  setView: (effectId: string, patch: Partial<PanView>) => void;
}

export const usePanUi = create<PanUiState>((set, get) => ({
  openIds: [],
  views: {},
  drag: null,
  copied: null,
  setView(effectId, patch) {
    const views = get().views;
    set({ views: { ...views, [effectId]: { ...(views[effectId] ?? DEFAULT_VIEW), ...patch } } });
  },
}));

/** A PanMan window's view. */
export const usePanView = (effectId: string) => usePanUi((s) => s.views[effectId] ?? DEFAULT_VIEW);

// Another song: its own windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) usePanUi.setState({ openIds: [], drag: null });
});
