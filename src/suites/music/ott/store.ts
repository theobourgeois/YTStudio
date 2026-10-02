import { create } from "zustand";
import type { Ott } from "@shared/music/types";
import { useMusic } from "../store";

/** What OTT's windows know that isn't the song: which are open, and a whole OTT copied (Copy state). */
interface OttUiState {
  /** The OTTs (by effect id) whose windows are open. */
  openIds: string[];
  copiedState: Ott | null;
}

export const useOttUi = create<OttUiState>(() => ({ openIds: [], copiedState: null }));

// Another song: its own windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useOttUi.setState({ openIds: [] });
});
