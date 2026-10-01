import { create } from "zustand";

/**
 * The Mixer window's own state, at the speed of the pointer: which track's name is being typed, a track
 * to scroll into view, a track's state being dragged. None of it is the song's.
 */
interface MixerViewState {
  /** The track whose name is being edited (F2, a double-click, the menu's Rename), or null. */
  renaming: string | null;
  /** A track to scroll into view, once (just added, or selected by a key). */
  revealing: string | null;
  /** A track's state being dragged (from its menu's Copy track state) to drop on another: where, and the track under it. */
  carrying: { from: string; x: number; y: number; over: string | null } | null;
  rename: (id: string | null) => void;
  reveal: (id: string | null) => void;
  carry: (carrying: MixerViewState["carrying"]) => void;
}

export const useMixerView = create<MixerViewState>((set) => ({
  renaming: null,
  revealing: null,
  rename: (renaming) => set({ renaming }),
  reveal: (revealing) => set({ revealing }),
  carrying: null,
  carry: (carrying) => set({ carrying }),
}));
