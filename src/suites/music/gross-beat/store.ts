import { create } from "zustand";
import type { GrossKind } from "@shared/music/gross-beat";
import type { AutomationPoint, GrossBeat, GrossBeatSlot } from "@shared/music/types";
import { useMusic } from "../store";
import type { GrossSnap } from "./geometry";

/** How a Gross Beat's window shows its mapping panel (FL keeps these in the plugin; here they're the tab's). */
export interface GrossView {
  /** The envelope the panel shows and edits: the picked time slot's, or the picked volume slot's. */
  kind: GrossKind;
  snap: GrossSnap;
  /** Step editing: a drag paints a step in each grid cell it crosses (Shift: pulses). */
  step: boolean;
  /** Slide remaining points: a point moved takes the ones after it along. */
  slide: boolean;
  /** The envelopes can't be edited. */
  freeze: boolean;
  /** The scratching clock is shown (the options menu's View scratching clock). */
  clock: boolean;
}

export const DEFAULT_VIEW: GrossView = { kind: "time", snap: 1 / 8, step: false, slide: false, freeze: false, clock: true };

/** A drag on the mapping panel, drawn as it goes and made one edit when it's let go. */
export interface GrossDrag {
  effectId: string;
  kind: GrossKind;
  slot: number;
  points: AutomationPoint[];
}

/** What Gross Beat's windows know that isn't the song: which are open, how each shows its panel, a drag, menus, copies. */
interface GrossUiState {
  /** The Gross Beats (by effect id) whose windows are open. */
  openIds: string[];
  views: Record<string, GrossView>;
  drag: GrossDrag | null;
  /** A point's menu (right-click), where it was clicked on the panel. */
  pointMenu: { effectId: string; kind: GrossKind; slot: number; index: number; x: number; y: number } | null;
  /** A slot copied (its menu's Copy), to paste on any slot of either kind. */
  copiedSlot: GrossBeatSlot | null;
  /** A whole Gross Beat's settings copied (Copy state), to paste on another. */
  copiedState: GrossBeat | null;

  setView: (effectId: string, patch: Partial<GrossView>) => void;
}

export const useGrossUi = create<GrossUiState>((set, get) => ({
  openIds: [],
  views: {},
  drag: null,
  pointMenu: null,
  copiedSlot: null,
  copiedState: null,
  setView(effectId, patch) {
    const views = get().views;
    set({ views: { ...views, [effectId]: { ...(views[effectId] ?? DEFAULT_VIEW), ...patch } } });
  },
}));

/** A Gross Beat window's view. */
export const useGrossView = (effectId: string) => useGrossUi((s) => s.views[effectId] ?? DEFAULT_VIEW);

// Another song: its own windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useGrossUi.setState({ openIds: [], drag: null, pointMenu: null });
});
