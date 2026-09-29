import { create } from "zustand";
import { usePlayback } from "./playback";

/** Transport for the media element the source preview is showing. */
export interface SourceController {
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  /** Relative seek in seconds. */
  step: (seconds: number) => void;
  duration: () => number;
}

/**
 * Previewing a library asset on its own: while `assetId` is set, the preview
 * area shows that file instead of the timeline, and the playback shortcuts
 * drive it (through `controller`) instead of the timeline clock.
 */
interface SourcePreviewState {
  assetId: string | null;
  controller: SourceController | null;
  open: (assetId: string) => void;
  close: () => void;
  setController: (controller: SourceController | null) => void;
}

export const useSourcePreview = create<SourcePreviewState>((set) => ({
  assetId: null,
  controller: null,
  open(assetId) {
    usePlayback.getState().pause();
    set({ assetId });
  },
  close() {
    set({ assetId: null, controller: null });
  },
  setController(controller) {
    set({ controller });
  },
}));

// Going back to the timeline: playing or seeking it closes the source preview.
usePlayback.subscribe((state, prev) => {
  if (!useSourcePreview.getState().assetId) return;
  if ((state.playing && !prev.playing) || state.time !== prev.time) useSourcePreview.getState().close();
});
