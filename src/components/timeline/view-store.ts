/**
 * Timeline-local UI state that changes at interaction speed (scroll position,
 * drag ghost, snap guide, drop target). Kept out of the editor store so it
 * never pollutes undo history or autosave.
 */
import { create } from "zustand";
import { CHUNK_PX } from "./constants";
import { visibleWindow } from "./geometry";

export interface DragGhost {
  clipId: string;
  /** Desired start time under the pointer (after snapping). */
  start: number;
  duration: number;
  trackId: string;
}

export interface DropTarget {
  /** Hovered track, or null for the empty space below the lanes (auto-route). */
  trackId: string | null;
  /** Pointer time. */
  time: number;
  /** Main track only: boundary of the insertion slot. */
  slotTime: number | null;
}

interface TimelineViewState {
  /** Horizontal scroll of the lane area (lane px). */
  scrollLeft: number;
  /** Visible lane width (viewport minus the header column). */
  viewWidth: number;
  /** Clip being moved (rendered as a placeholder in its laid-out slot). */
  dragClipId: string | null;
  ghost: DragGhost | null;
  snapGuide: number | null;
  drop: DropTarget | null;
  scrubbing: boolean;
}

export const useTimelineView = create<TimelineViewState>(() => ({
  scrollLeft: 0,
  viewWidth: 0,
  dragClipId: null,
  ghost: null,
  snapGuide: null,
  drop: null,
  scrubbing: false,
}));

export function setView(patch: Partial<TimelineViewState>) {
  const s = useTimelineView.getState();
  for (const k in patch) {
    if (!Object.is(s[k as keyof TimelineViewState], patch[k as keyof TimelineViewState])) {
      useTimelineView.setState(patch);
      return;
    }
  }
}

export function clearDragView() {
  setView({ dragClipId: null, ghost: null, snapGuide: null });
}

/** Quantised [x0, x1) lane-px window worth rendering; re-renders only on chunk crossings. */
export function useVisibleWindow(): [number, number] {
  const x0 = useTimelineView((s) => visibleWindow(s.scrollLeft, s.viewWidth, CHUNK_PX).x0);
  const x1 = useTimelineView((s) => visibleWindow(s.scrollLeft, s.viewWidth, CHUNK_PX).x1);
  return [x0, x1];
}
