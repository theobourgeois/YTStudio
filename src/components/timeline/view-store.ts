/**
 * Timeline-local UI state that changes at interaction speed (scroll position,
 * drag ghost, snap guide, drop target). Kept out of the editor store so it
 * never pollutes undo history or autosave.
 */
import { create } from "zustand";
import { projectDuration } from "@shared/timeline";
import { MAX_ZOOM, MIN_ZOOM, useEditor } from "@/stores/editor";
import { CHUNK_PX } from "./constants";
import { minZoomFor, visibleWindow } from "./geometry";

/** Where a dragged clip or asset goes: an existing track, or a new one above/below all tracks. */
export type TrackTarget = { trackId: string; newTrack?: undefined } | { trackId?: undefined; newTrack: "above" | "below" };

export type DragGhost = TrackTarget & {
  clipId: string;
  /** Desired start time under the pointer (after snapping). */
  start: number;
  duration: number;
};

export interface DropTarget {
  /** Hovered track, if any. */
  trackId: string | null;
  /** Hovering the empty space above the first / below the last track. */
  newTrack: "above" | "below" | null;
  /** Pointer time. */
  time: number;
}

/** Where a transition dragged in from the library would go, and the stretch it would play. */
export interface TransitionDrop {
  trackId: string;
  start: number;
  end: number;
}

/** Rubber-band selection rectangle, in lane-area px. */
export interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TimelineViewState {
  /** Horizontal scroll of the lane area (lane px). */
  scrollLeft: number;
  /** Visible lane width (viewport minus the header column). */
  viewWidth: number;
  /** Clips being moved (rendered as placeholders where they'd land). */
  dragClipIds: string[];
  ghosts: DragGhost[];
  marquee: Marquee | null;
  snapGuide: number | null;
  drop: DropTarget | null;
  transitionDrop: TransitionDrop | null;
  /** The clip a video effect being dragged would be added to. */
  effectDrop: string | null;
  scrubbing: boolean;
}

const NONE: never[] = [];

export const useTimelineView = create<TimelineViewState>(() => ({
  scrollLeft: 0,
  viewWidth: 0,
  dragClipIds: NONE,
  ghosts: NONE,
  marquee: null,
  snapGuide: null,
  drop: null,
  transitionDrop: null,
  effectDrop: null,
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
  setView({ dragClipIds: NONE, ghosts: NONE, snapGuide: null, marquee: null });
}

/** Quantised [x0, x1) lane-px window worth rendering; re-renders only on chunk crossings. */
export function useVisibleWindow(): [number, number] {
  const x0 = useTimelineView((s) => visibleWindow(s.scrollLeft, s.viewWidth, CHUNK_PX).x0);
  const x1 = useTimelineView((s) => visibleWindow(s.scrollLeft, s.viewWidth, CHUNK_PX).x1);
  return [x0, x1];
}

/** Furthest the timeline can zoom out right now (depends on the edit's length and the view's width). */
export function minZoom(): number {
  return minZoomFor(projectDuration(useEditor.getState().project), useTimelineView.getState().viewWidth, MIN_ZOOM, MAX_ZOOM);
}

export function useMinZoom(): number {
  const duration = useEditor((s) => projectDuration(s.project));
  const viewWidth = useTimelineView((s) => s.viewWidth);
  return minZoomFor(duration, viewWidth, MIN_ZOOM, MAX_ZOOM);
}

/** Timeline commands for code outside the timeline tree (keyboard shortcuts). Set while mounted. */
export const timelineCommands: { zoomToFit: () => void; zoomBy: (factor: number) => void } = {
  zoomToFit: () => {},
  zoomBy: () => {},
};
