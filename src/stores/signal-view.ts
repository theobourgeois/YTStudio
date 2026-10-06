import { create } from "zustand";
import { useVideoWindows } from "./video-windows";

const LANES_KEY = "editor-signal-lanes";
const SPECTROGRAMS_KEY = "editor-spectrograms";

/**
 * How the video's signals are shown (the visualizer, docs/visualizer/README.md): whether the Signals window
 * is open and which signal it edits, and, kept in this browser, whether the timeline shows signal lanes under
 * its ruler and spectrograms on audio clips instead of waveforms.
 */
interface SignalViewState {
  open: boolean;
  /** The signal the window edits (an id), if any. */
  selected: string | null;
  lanes: boolean;
  spectrograms: boolean;
  /** Open the window (in front), on a signal if one is given. */
  show: (selected?: string | null) => void;
  close: () => void;
  select: (id: string | null) => void;
  setLanes: (on: boolean) => void;
  setSpectrograms: (on: boolean) => void;
}

export const SIGNALS_WINDOW = "signals" as const;

export const useSignalView = create<SignalViewState>((set) => ({
  open: false,
  selected: null,
  lanes: localStorage.getItem(LANES_KEY) !== "off",
  spectrograms: localStorage.getItem(SPECTROGRAMS_KEY) === "on",
  show(selected) {
    useVideoWindows.getState().focus(SIGNALS_WINDOW);
    set((s) => ({ open: true, selected: selected === undefined ? s.selected : selected }));
  },
  close: () => set({ open: false }),
  select: (selected) => set({ selected }),
  setLanes(lanes) {
    localStorage.setItem(LANES_KEY, lanes ? "on" : "off");
    set({ lanes });
  },
  setSpectrograms(spectrograms) {
    localStorage.setItem(SPECTROGRAMS_KEY, spectrograms ? "on" : "off");
    set({ spectrograms });
  },
}));
