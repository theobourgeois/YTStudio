import { create } from "zustand";
import { type CopiedKeyframes, type KeyframeRef, clipKeyframes, copyKeyframes, keyframeTime, pasteKeyframes, sameRef, setKeyframeEasing } from "@shared/animation";
import { getClip } from "@shared/timeline";
import type { Clip, Easing } from "@shared/types";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";

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
  /** Keyframes copied with ⌘C, to paste at the playhead (on any clip) or onto another property. */
  clipboard: CopiedKeyframes | null;
  setClipboard: (copied: CopiedKeyframes | null) => void;
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
  clipboard: null,
  setClipboard(clipboard) {
    set({ clipboard });
  },
}));

/** The selected keyframes that still exist on `clip` (undo may have removed some). */
export function selectedKeyframes(clip: Clip | undefined): KeyframeRef[] {
  const { clipId, refs } = useKeyframeSelection.getState();
  if (!clip || clip.id !== clipId || refs.length === 0) return [];
  return clipKeyframes(clip).filter((k) => refs.some((r) => sameRef(r, k)));
}

// Another clip selected (or none): its keyframes aren't what's selected anymore. Clips copied:
// they're what ⌘V pastes now.
useEditor.subscribe((s, prev) => {
  if (s.clipboard !== prev.clipboard) useKeyframeSelection.getState().setClipboard(null);
  if (s.selectedClipIds === prev.selectedClipIds) return;
  if (s.selectedClipIds.at(-1) !== useKeyframeSelection.getState().clipId) useKeyframeSelection.getState().clear();
});

/** The clip whose keyframes are worked on: the last one selected. */
function workedClip(): Clip | undefined {
  const { project, selectedClipIds } = useEditor.getState();
  const id = selectedClipIds.at(-1);
  return id ? getClip(project, id) : undefined;
}

/** ⌘C with keyframes selected: copy them. False when none are. */
export function copySelectedKeyframes(): boolean {
  const clip = workedClip();
  const copied = clip && copyKeyframes(clip, selectedKeyframes(clip));
  if (!copied) return false;
  useKeyframeSelection.getState().setClipboard(copied);
  return true;
}

/**
 * ⌘V after copying keyframes: paste them on the selected clip with the first at the playhead,
 * onto the same properties, or (`onto`) one property's onto another. They end up selected.
 * False when there's nothing to paste, or nowhere for it to go.
 */
export function pasteCopiedKeyframes(onto?: { effectId: string; key: string }): boolean {
  const { clipboard } = useKeyframeSelection.getState();
  const clip = workedClip();
  if (!clipboard || !clip) return false;
  const { project } = useEditor.getState();
  const time = keyframeTime(clip, usePlayback.getState().time, project.settings.fps);
  const pasted = pasteKeyframes(project, clip.id, clipboard, time, onto);
  if (pasted.project === project) return false;
  useEditor.getState().commit(() => pasted.project);
  useKeyframeSelection.getState().select(clip.id, pasted.refs);
  return true;
}

/** F9 and its neighbours: ease the selected keyframes (After Effects' Easy Ease). False when none are selected. */
export function easeSelectedKeyframes(easing: Easing): boolean {
  const clip = workedClip();
  const refs = selectedKeyframes(clip);
  if (!clip || !refs.length) return false;
  useEditor.getState().commit((p) => setKeyframeEasing(p, clip.id, refs, easing));
  return true;
}
