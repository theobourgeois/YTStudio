import { create } from "zustand";
import { type KeyframeRef, clipKeyframes, sameRef } from "@shared/animation";
import type { Clip } from "@shared/types";
import { useEditor } from "@/stores/editor";

/**
 * Keyframes selected in the Effect Controls' lanes (UI state, like a
 * sub-selection of the selected clip): what Delete, the interpolation menu
 * and dragging act on. Cleared when another clip is selected.
 */
interface KeyframeSelectionState {
  clipId: string | null;
  refs: KeyframeRef[];
  /** Replace the selection, add to it, or toggle `refs` in it (all in, then all out). */
  select: (clipId: string, refs: KeyframeRef[], mode?: "replace" | "add" | "toggle") => void;
  clear: () => void;
}

export const useKeyframeSelection = create<KeyframeSelectionState>((set, get) => ({
  clipId: null,
  refs: [],
  select(clipId, refs, mode = "replace") {
    const current = get().clipId === clipId ? get().refs : [];
    if (mode === "replace") return set({ clipId, refs });
    const allIn = refs.every((r) => current.some((c) => sameRef(c, r)));
    if (mode === "toggle" && allIn) return set({ clipId, refs: current.filter((c) => !refs.some((r) => sameRef(c, r))) });
    set({ clipId, refs: [...current, ...refs.filter((r) => !current.some((c) => sameRef(c, r)))] });
  },
  clear() {
    if (get().refs.length || get().clipId) set({ clipId: null, refs: [] });
  },
}));

/** The selected keyframes that still exist on `clip` (undo may have removed some). */
export function selectedKeyframes(clip: Clip | undefined): KeyframeRef[] {
  const { clipId, refs } = useKeyframeSelection.getState();
  if (!clip || clip.id !== clipId || refs.length === 0) return [];
  return clipKeyframes(clip).filter((k) => refs.some((r) => sameRef(r, k)));
}

// Another clip selected (or none): its keyframes aren't what's selected anymore.
useEditor.subscribe((s, prev) => {
  if (s.selectedClipIds === prev.selectedClipIds) return;
  if (s.selectedClipIds.at(-1) !== useKeyframeSelection.getState().clipId) useKeyframeSelection.getState().clear();
});
