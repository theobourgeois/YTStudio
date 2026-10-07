import { create } from "zustand";
import type { ProL } from "@shared/music/types";
import { useMusic } from "../store";

/** What YT-L's windows know that isn't the song (`docs/fabfilter/pro-l.md` §8.6). */
interface LimUiState {
  /** The YT-Ls (by effect id) whose windows are open. */
  openIds: string[];
  /** A whole YT-L copied (Copy state), to paste on another. */
  copiedState: ProL | null;
  /** The preset each last had (its name stays, dimmed, once it's changed), by effect id. */
  lastPreset: Record<string, string>;
}

export const useLimUi = create<LimUiState>(() => ({ openIds: [], copiedState: null, lastPreset: {} }));

// Another song: its own windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useLimUi.setState({ openIds: [], lastPreset: {} });
});
