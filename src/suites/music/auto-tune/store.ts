import { create } from "zustand";
import type { AutoTune } from "@shared/music/types";
import { useMusic } from "../store";

/** Which of the window's lower panels shows: Edit Scale, or Create Vibrato. */
export type TunePanel = "scale" | "vibrato";

/** How an Auto-Tune's window shows (the tab's, not the song's). */
export interface TuneView {
  panel: TunePanel;
  /** Hold: the graph and the meter stand still (Antares' freeze), to look at what was sung. */
  hold: boolean;
}

export const DEFAULT_TUNE_VIEW: TuneView = { panel: "scale", hold: false };

/** What Auto-Tune's windows know that isn't the song: which are open, how each shows, a copied state. */
interface TuneUiState {
  /** The Auto-Tunes (by effect id) whose windows are open. */
  openIds: string[];
  views: Record<string, TuneView>;
  /** A whole Auto-Tune's settings copied (Copy state), to paste on another. */
  copiedState: AutoTune | null;
  setView: (effectId: string, patch: Partial<TuneView>) => void;
}

export const useTuneUi = create<TuneUiState>((set, get) => ({
  openIds: [],
  views: {},
  copiedState: null,
  setView(effectId, patch) {
    const views = get().views;
    set({ views: { ...views, [effectId]: { ...(views[effectId] ?? DEFAULT_TUNE_VIEW), ...patch } } });
  },
}));

export const useTuneView = (effectId: string) => useTuneUi((s) => s.views[effectId] ?? DEFAULT_TUNE_VIEW);

// Another song: its own windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useTuneUi.setState({ openIds: [] });
});
