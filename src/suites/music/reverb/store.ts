import { create } from "zustand";
import type { ReverbState } from "@shared/music/types";
import { useMusic } from "../store";

/** What the Reverb's windows know that isn't the song (`docs/reverb/reverb.md` 4.8). */
interface VerbUiState {
  /** The Reverbs (by effect id) whose windows are open. */
  openIds: string[];
  /** A whole Reverb's sound copied (Copy settings), to paste on another. */
  copiedState: ReverbState | null;
  /** The Decay EQ's curve copied (Copy curve), alone. */
  copiedCurve: Pick<ReverbState, "bands" | "bandsBypass"> | null;
  /** The preset each last had (its name stays, in italics, once it's changed; Revert goes back to it), by effect id. */
  lastPreset: Record<string, string>;
  /** The Decay EQ's bands selected (dragged together), by effect id. */
  selected: Record<string, number[]>;
  /** Freeze or Kill held from the window (live, not the song's), by effect id. */
  freezeHeld: string | null;
  killHeld: string | null;
}

export const useVerbUi = create<VerbUiState>(() => ({ openIds: [], copiedState: null, copiedCurve: null, lastPreset: {}, selected: {}, freezeHeld: null, killHeld: null }));

// Another song: its own windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useVerbUi.setState({ openIds: [], lastPreset: {}, selected: {}, freezeHeld: null, killHeld: null });
});
