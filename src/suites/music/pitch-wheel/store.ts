import { create } from "zustand";
import type { PitchWheel } from "@shared/music/types";
import { useMusic } from "../store";

/** What Pitch Wheel's windows know that isn't the song: which are open, a copied state. */
interface WheelUiState {
  /** The Pitch Wheels (by effect id) whose windows are open. */
  openIds: string[];
  /** A whole Pitch Wheel's settings copied (Copy state), to paste on another. */
  copiedState: PitchWheel | null;
}

export const useWheelUi = create<WheelUiState>(() => ({ openIds: [], copiedState: null }));

// Another song: its own windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useWheelUi.setState({ openIds: [] });
});
