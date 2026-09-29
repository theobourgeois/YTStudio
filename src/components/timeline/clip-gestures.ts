/**
 * Clip move, trim and marquee drags. Every frame is derived from the gesture's
 * base project (`beginGesture` snapshot) plus the total pointer delta, so
 * clamping and collision handling never accumulate. All edits go through the
 * editor store.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Clip, Project, TrackKind } from "@shared/types";
import {
  addTrack,
  canPlaceOnTrack,
  clipDuration,
  clipEnd,
  createId,
  getClip,
  moveClips,
  pruneEmptyTrack,
  snapTime,
  trimClip,
} from "@shared/timeline";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { DRAG_THRESHOLD_PX, MARQUEE_THRESHOLD_PX, SNAP_PX, TRIM_THRESHOLD_PX } from "./constants";
import { lanePoint, type TimelineContextValue } from "./context";
import { clipRect, laneAt, moveSnapPoints, newTrackZoneAt, snapDelta, trimSnapPoints } from "./geometry";
import { startPointerSession, type LanePoint } from "./pointer-session";
import { clearDragView, setView, type DragGhost, type TrackTarget } from "./view-store";

/** Pointer x -> time using the *current* zoom (zoom may change mid-drag). */
const timeAt = (p: LanePoint) => p.x / useEditor.getState().zoom;

function near(a: number, b: number) {
  return Math.abs(a - b) < 1e-4;
}

const isAdditive = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) =>
  e.shiftKey || e.metaKey || e.ctrlKey;

/**
 * Press on a clip: selection handling, then (past the threshold) a move of the
 * selection. A single clip can change tracks, including onto a new track by
 * dragging above the first or below the last lane; a multi-clip selection
 * moves in time only. Holding Alt at the press drags copies instead.
 */
export function startClipMove(
  e: ReactPointerEvent<HTMLElement>,
  clipId: string,
  ctx: TimelineContextValue,
) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const editor = useEditor.getState();
  if (editor.gestureBase) return;

  const additive = isAdditive(e);
  const duplicate = e.altKey;
  if (additive) {
    editor.toggleSelected(clipId);
    if (!useEditor.getState().selectedClipIds.includes(clipId)) return; // just deselected
  } else if (!editor.selectedClipIds.includes(clipId)) {
    editor.select(clipId);
  }

  const r = ctx.lanesRef.current?.getBoundingClientRect();
  if (!r) return;
  const pointerStartTime = (e.clientX - r.left) / editor.zoom;

  let gestureId = -1;
  let points: number[] = [];
  /** Clips being dragged: the selection, or fresh copies of it when duplicating. */
  let copies: Clip[] = [];
  let movingIds: string[] = [];
  let sourceTracks = new Set<string>();
  let single = true;
  let target: TrackTarget = { trackId: "" };
  let delta = 0;
  let allowed: (kind: TrackKind, trackId?: string) => boolean = () => false;

  /** The project the move is computed from (the base, plus the copies when duplicating). */
  const source = (base: Project): Project =>
    duplicate ? { ...base, clips: [...base.clips, ...copies] } : base;

  startPointerSession(e, ctx, {
    threshold: DRAG_THRESHOLD_PX,
    autoScroll: true,
    cursor: duplicate ? "copy" : "grabbing",
    onStart() {
      const s = useEditor.getState();
      gestureId = s.beginGesture();
      const base = useEditor.getState().gestureBase;
      const clip = base && getClip(base, clipId);
      if (!base || !clip) return;
      const selected = s.selectedClipIds.filter((id) => getClip(base, id));
      const ids = selected.includes(clipId) ? selected : [clipId];
      copies = duplicate ? ids.map((id) => ({ ...getClip(base, id)!, id: createId("clip") })) : [];
      movingIds = duplicate ? copies.map((c) => c.id) : ids;
      sourceTracks = new Set(ids.map((id) => getClip(base, id)!.trackId));
      single = ids.length === 1;
      target = { trackId: clip.trackId };

      const asset = s.getAsset(clip.assetId);
      allowed = (kind, trackId) =>
        asset ? canPlaceOnTrack(asset, { kind }) : trackId === clip.trackId;
      // Originals stay put when duplicating, so they're snap targets too.
      points = s.snapping
        ? moveSnapPoints(base, duplicate ? [] : movingIds, usePlayback.getState().time)
        : [];
      setView({ dragClipIds: movingIds });
    },
    onMove(p) {
      const s = useEditor.getState();
      // Read the base fresh: another edit (e.g. deleting media) may have updated it,
      // and a commit from elsewhere ends this gesture.
      const base = s.gestureId === gestureId ? s.gestureBase : null;
      if (!base) return;
      const from = source(base);
      const moving = movingIds.map((id) => getClip(from, id)).filter((c): c is Clip => !!c);
      if (moving.length === 0) return;

      if (single) {
        const lanes = ctx.lanesLayout.current;
        const lane = laneAt(lanes, p.y);
        const zone = newTrackZoneAt(lanes, p.y);
        if (lane) {
          if (allowed(lane.kind, lane.trackId)) target = { trackId: lane.trackId };
        } else if (zone === "above" && allowed("video")) {
          target = { newTrack: "above" };
        } else if (zone === "below" && allowed("audio")) {
          target = { newTrack: "below" };
        }
      }

      const spans = moving.map((c) => ({ start: c.start, duration: clipDuration(c) }));
      const snapped = s.snapping
        ? snapDelta(timeAt(p) - pointerStartTime, spans, points, SNAP_PX / s.zoom)
        : { delta: timeAt(p) - pointerStartTime, snappedTo: null };
      delta = Math.max(snapped.delta, -Math.min(...spans.map((sp) => sp.start)));

      const trackId = target.trackId;
      // A clip headed for a new track stays where it was until it's dropped.
      s.preview(() =>
        trackId === undefined
          ? from
          : moveClips(from, movingIds, delta, single ? () => trackId : undefined),
      );

      const placed = useEditor.getState().project;
      const ghosts: DragGhost[] = moving.map((c) => ({
        clipId: c.id,
        start: c.start + delta,
        duration: clipDuration(c),
        ...(target.newTrack ? { newTrack: target.newTrack } : { trackId: single ? target.trackId! : c.trackId }),
      }));
      const guide =
        snapped.snappedTo !== null &&
        (target.newTrack !== undefined ||
          movingIds.some((id) => {
            const c = getClip(placed, id);
            return c && (near(c.start, snapped.snappedTo!) || near(clipEnd(c), snapped.snappedTo!));
          }))
          ? snapped.snappedTo
          : null;
      setView({ ghosts, snapGuide: guide });
    },
    onEnd() {
      clearDragView();
      const s = useEditor.getState();
      const base = s.gestureId === gestureId ? s.gestureBase : null;
      if (base) {
        const newTrack = target.newTrack;
        s.preview((p) => {
          let q = p;
          if (newTrack) {
            const added = addTrack(source(base), newTrack === "above" ? "video" : "audio");
            q = moveClips(added.project, movingIds, delta, () => added.trackId);
          }
          // Extra tracks emptied by the move go away (undo brings them back).
          if (!duplicate) for (const t of sourceTracks) q = pruneEmptyTrack(q, t);
          return q;
        });
        if (duplicate) s.setSelection(movingIds);
      }
      useEditor.getState().endGesture(gestureId);
    },
    onCancel() {
      clearDragView();
      useEditor.getState().cancelGesture(gestureId);
    },
    onClick() {
      // A plain click inside a multi-selection narrows it to this clip.
      if (!additive) useEditor.getState().select(clipId);
    },
  });
}

export function startClipTrim(
  e: ReactPointerEvent<HTMLElement>,
  clipId: string,
  edge: "start" | "end",
  ctx: TimelineContextValue,
) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const editor = useEditor.getState();
  if (editor.gestureBase) return;
  editor.select(clipId);

  const r = ctx.lanesRef.current?.getBoundingClientRect();
  if (!r) return;
  const pointerStartTime = (e.clientX - r.left) / editor.zoom;

  let gestureId = -1;
  let points: number[] = [];
  let assetDuration = 0;

  startPointerSession(e, ctx, {
    threshold: TRIM_THRESHOLD_PX,
    autoScroll: true,
    cursor: "ew-resize",
    onStart() {
      const s = useEditor.getState();
      gestureId = s.beginGesture();
      const base = useEditor.getState().gestureBase;
      const clip = base && getClip(base, clipId);
      if (!base || !clip) return;
      assetDuration = s.getAsset(clip.assetId)?.duration ?? clip.out;
      points = s.snapping ? trimSnapPoints(base, clipId, usePlayback.getState().time) : [];
    },
    onMove(p) {
      const s = useEditor.getState();
      // Read the base fresh: another edit (e.g. deleting media) may have updated it,
      // and a commit from elsewhere ends this gesture.
      const base = s.gestureId === gestureId ? s.gestureBase : null;
      const clip = base && getClip(base, clipId);
      if (!base || !clip) return;
      let delta = timeAt(p) - pointerStartTime;

      let snappedTo: number | null = null;
      const edgeTime = edge === "end" ? clipEnd(clip) : clip.start;
      if (s.snapping) {
        const res = snapTime(edgeTime + delta, points, SNAP_PX / s.zoom);
        if (res.snappedTo !== null) {
          delta = res.time - edgeTime;
          snappedTo = res.snappedTo;
        }
      }

      const from = base;
      s.preview(() => trimClip(from, clipId, edge, delta, assetDuration));

      const placed = getClip(useEditor.getState().project, clipId);
      const actualEdge = placed ? (edge === "end" ? clipEnd(placed) : placed.start) : null;
      setView({
        snapGuide:
          snappedTo !== null && actualEdge !== null && near(actualEdge, snappedTo)
            ? snappedTo
            : null,
      });
    },
    onEnd() {
      clearDragView();
      useEditor.getState().endGesture(gestureId);
    },
    onCancel() {
      clearDragView();
      useEditor.getState().cancelGesture(gestureId);
    },
  });
}

/**
 * Press on empty lane space: a click deselects and seeks there; a drag draws a
 * selection rectangle (added to the existing selection with Shift/⌘/Ctrl).
 */
export function startMarquee(e: ReactPointerEvent<HTMLElement>, ctx: TimelineContextValue) {
  if (e.button !== 0) return;
  const origin = lanePoint(ctx, e.clientX, e.clientY);
  if (!origin) return;
  const additive = isAdditive(e);
  const initial = additive ? useEditor.getState().selectedClipIds : [];

  startPointerSession(e, ctx, {
    threshold: MARQUEE_THRESHOLD_PX,
    autoScroll: true,
    onMove(p) {
      const { project, zoom, selectedClipIds, setSelection } = useEditor.getState();
      const box = {
        x0: Math.min(origin.x, p.x),
        y0: Math.min(origin.y, p.y),
        x1: Math.max(origin.x, p.x),
        y1: Math.max(origin.y, p.y),
      };
      const lanes = new Map(ctx.lanesLayout.current.map((l) => [l.trackId, l]));
      const hits = project.clips
        .filter((c) => {
          const lane = lanes.get(c.trackId);
          if (!lane) return false;
          const r = clipRect(c.start, clipDuration(c), lane, zoom);
          return r.left < box.x1 && r.right > box.x0 && r.top < box.y1 && r.bottom > box.y0;
        })
        .map((c) => c.id);
      const next = [...new Set([...initial, ...hits])];
      if (next.length !== selectedClipIds.length || next.some((id, i) => id !== selectedClipIds[i])) {
        setSelection(next);
      }
      setView({ marquee: box });
    },
    onEnd() {
      setView({ marquee: null });
    },
    onCancel() {
      setView({ marquee: null });
      useEditor.getState().setSelection(initial);
    },
    onClick() {
      if (!additive) useEditor.getState().select(null);
      usePlayback.getState().seek(Math.max(0, origin.x / useEditor.getState().zoom));
    },
  });
}
