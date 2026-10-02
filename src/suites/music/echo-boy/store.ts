import { create } from "zustand";
import type { EchoBoy, EchoStyle } from "@shared/music/types";
import { useMusic } from "../store";

/** What EchoBoy's drawer under its panel shows: nothing, the mode's Tweak, or the Style Editor (EchoBoy's Style Edit). */
export type EchoDrawer = "none" | "tweak" | "style";

/** What EchoBoy's windows know that isn't the song: which are open, each one's drawer, the taps of Tap Tempo, copies. */
interface EchoUiState {
  /** The EchoBoys (by effect id) whose windows are open. */
  openIds: string[];
  drawers: Record<string, EchoDrawer>;
  /** Tap Tempo's taps (ms, `performance.now()`), by effect id. */
  taps: Record<string, number[]>;
  /** A whole EchoBoy copied (Copy state), to paste on another. */
  copiedState: EchoBoy | null;
  /** A style copied from the Style Editor. */
  copiedStyle: EchoStyle | null;

  setDrawer: (effectId: string, drawer: EchoDrawer) => void;
}

export const useEchoUi = create<EchoUiState>((set, get) => ({
  openIds: [],
  drawers: {},
  taps: {},
  copiedState: null,
  copiedStyle: null,
  setDrawer(effectId, drawer) {
    set({ drawers: { ...get().drawers, [effectId]: drawer } });
  },
}));

export const useEchoDrawer = (effectId: string) => useEchoUi((s) => s.drawers[effectId] ?? "none");

// Another song: its own windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useEchoUi.setState({ openIds: [], taps: {} });
});
