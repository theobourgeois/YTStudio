import { create } from "zustand";
import type { ProC } from "@shared/music/types";
import { useMusic } from "../store";

/** Listening to a Pro-C (live, not the song's): its key, or what its compression takes away. */
export interface CompAudition {
  effectId: string;
  mode: "key" | "triggering";
}

/** What Pro-C's windows know that isn't the song (`docs/fabfilter/pro-c.md` 8.6). */
interface CompUiState {
  /** The Pro-Cs (by effect id) whose windows are open. */
  openIds: string[];
  /** A whole Pro-C copied (Copy state), to paste on another. */
  copiedState: ProC | null;
  /** The preset each last had (its name stays, dimmed, once it's changed), by effect id. */
  lastPreset: Record<string, string>;
  audition: CompAudition | null;
  /** Match measuring, by effect id: when it was asked for (ms), and for how long (s). */
  matching: Record<string, { since: number; seconds: number }>;
  /** The output panel kept open by a click (it opens on hover, as Pro-C's). */
  outputPinned: string | null;
}

export const useCompUi = create<CompUiState>(() => ({ openIds: [], copiedState: null, lastPreset: {}, audition: null, matching: {}, outputPinned: null }));

// Another song: its own windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useCompUi.setState({ openIds: [], lastPreset: {}, audition: null, matching: {}, outputPinned: null });
});
