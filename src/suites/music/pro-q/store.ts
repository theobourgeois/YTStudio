import { create } from "zustand";
import type { EqBand } from "@shared/music/types";
import { useMusic } from "../store";
import { FULL } from "./geometry";

/** How a Pro-Q's window shows its display (Pro-Q keeps these in the plugin; here they're the tab's). */
export interface EqWindowView {
  /** The selected bands, by number: what the band controls and drags act on. */
  selected: number[];
  /** The frequencies the display shows (zoomed by dragging its scale). */
  low: number;
  high: number;
  /** The piano keyboard in place of the frequency scale. */
  piano: boolean;
  /** Popups made sticky by a click (the analyzer's panel, its settings, the output's). */
  analyzerPanel: boolean;
  outputPanel: boolean;
  /** Freeze: the spectrum stops falling and keeps its highest (held only while the window's open). */
  freeze: boolean;
}

export const DEFAULT_VIEW: EqWindowView = { selected: [], low: FULL.low, high: FULL.high, piano: false, analyzerPanel: false, outputPanel: false, freeze: false };

/** A drag on the display, drawn as it goes and made one edit when it's let go. */
export interface EqDrag {
  effectId: string;
  bands: EqBand[];
}

/** A band soloed (its solo button held): what's heard is the part of the sound it works on. */
export interface EqSolo {
  effectId: string;
  band: number;
}

/** Spectrum Grab: the spectrum held still and its peaks labelled, waiting for one to be dragged. */
export interface EqGrab {
  effectId: string;
  /** Held on by a long press (until the background is clicked), or by hovering (until the pointer leaves). */
  permanent: boolean;
}

interface EqUiState {
  /** The Pro-Qs (by effect id) whose windows are open. */
  openIds: string[];
  views: Record<string, EqWindowView>;
  drag: EqDrag | null;
  solo: EqSolo | null;
  grab: EqGrab | null;
  /** The rectangle a drag on the background selects with (display px). */
  rubber: { effectId: string; x0: number; y0: number; x1: number; y1: number } | null;
  /** The band under the pointer (its curve lit, its values shown beside it). */
  hover: { effectId: string; band: number } | null;
  /** A band copied (Pro-Q 4's Copy band; ours on any Pro-Q). */
  copiedBands: EqBand[] | null;

  setView: (effectId: string, patch: Partial<EqWindowView>) => void;
}

export const useEqUi = create<EqUiState>((set, get) => ({
  openIds: [],
  views: {},
  drag: null,
  solo: null,
  grab: null,
  rubber: null,
  hover: null,
  copiedBands: null,
  setView(effectId, patch) {
    const views = get().views;
    set({ views: { ...views, [effectId]: { ...(views[effectId] ?? DEFAULT_VIEW), ...patch } } });
  },
}));

export const useEqView = (effectId: string) => useEqUi((s) => s.views[effectId] ?? DEFAULT_VIEW);
export const eqView = (effectId: string) => useEqUi.getState().views[effectId] ?? DEFAULT_VIEW;

// Another song: its own windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useEqUi.setState({ openIds: [], views: {}, drag: null, solo: null, grab: null, rubber: null, hover: null });
});

/** The band under the pointer, and letting it go a moment late (so the pointer can reach the values beside it). */
let leaving: ReturnType<typeof setTimeout> | null = null;
export function hoverBand(effectId: string, band: number | null) {
  if (leaving) clearTimeout(leaving);
  leaving = null;
  const now = useEqUi.getState().hover;
  if (band === null ? now !== null : now?.effectId !== effectId || now.band !== band) useEqUi.setState({ hover: band === null ? null : { effectId, band } });
}
export function leaveHover() {
  if (leaving) clearTimeout(leaving);
  leaving = setTimeout(() => {
    leaving = null;
    useEqUi.setState({ hover: null });
  }, 250);
}
export function keepHover() {
  if (leaving) clearTimeout(leaving);
  leaving = null;
}
