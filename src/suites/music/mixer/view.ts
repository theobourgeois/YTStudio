import { create } from "zustand";

/**
 * The Mixer window's own state, at the speed of the pointer: which track's name is being typed, and a
 * track to scroll into view. None of it is the song's.
 */
interface MixerViewState {
  /** The track whose name is being edited (F2, a double-click, the menu's Rename), or null. */
  renaming: string | null;
  /** A track to scroll into view, once (just added, or selected by a key). */
  revealing: string | null;
  rename: (id: string | null) => void;
  reveal: (id: string | null) => void;
}

export const useMixerView = create<MixerViewState>((set) => ({
  renaming: null,
  revealing: null,
  rename: (renaming) => set({ renaming }),
  reveal: (revealing) => set({ revealing }),
}));
