/**
 * Clip move and trim drags. Every frame is derived from the gesture's base
 * project (`beginGesture` snapshot) plus the total pointer delta, so clamping
 * and reordering never accumulate. All edits go through the editor store.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  MAIN_TRACK_ID,
  canPlaceOnTrack,
  clipDuration,
  clipEnd,
  getClip,
  getTrack,
  moveClip,
  snapTime,
  trimClip,
} from "@shared/timeline";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { DRAG_THRESHOLD_PX, SNAP_PX, TRIM_THRESHOLD_PX } from "./constants";
import type { TimelineContextValue } from "./context";
import { laneAt, moveSnapPoints, snapClipStart, trimSnapPoints } from "./geometry";
import { startPointerSession, type LanePoint } from "./pointer-session";
import { clearDragView, setView } from "./view-store";

/** Pointer x -> time using the *current* zoom (zoom may change mid-drag). */
const timeAt = (p: LanePoint) => p.x / useEditor.getState().zoom;

function near(a: number, b: number) {
  return Math.abs(a - b) < 1e-4;
}

export function startClipMove(
  e: ReactPointerEvent<HTMLElement>,
  clipId: string,
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
  let targetTrackId = "";
  let allowed: (trackId: string) => boolean = () => false;

  startPointerSession(e, ctx, {
    threshold: DRAG_THRESHOLD_PX,
    autoScroll: true,
    cursor: "grabbing",
    onStart() {
      const s = useEditor.getState();
      gestureId = s.beginGesture();
      const base = useEditor.getState().gestureBase;
      const clip = base && getClip(base, clipId);
      if (!base || !clip) return;
      const asset = s.getAsset(clip.assetId);
      targetTrackId = clip.trackId;
      allowed = (trackId) => {
        const track = getTrack(base!, trackId);
        if (!track) return false;
        return asset ? canPlaceOnTrack(asset, track) : trackId === clip.trackId;
      };
      points = s.snapping ? moveSnapPoints(base, clipId, usePlayback.getState().time) : [];
      setView({
        dragClipId: clipId,
        ghost: { clipId, start: clip.start, duration: clipDuration(clip), trackId: clip.trackId },
      });
    },
    onMove(p) {
      const s = useEditor.getState();
      // Read the base fresh: another edit (e.g. deleting media) may have updated it,
      // and a commit from elsewhere ends this gesture.
      const base = s.gestureId === gestureId ? s.gestureBase : null;
      const clip = base && getClip(base, clipId);
      if (!base || !clip) return;
      const lane = laneAt(ctx.lanesLayout.current, p.y);
      if (lane && allowed(lane.trackId)) targetTrackId = lane.trackId;

      const duration = clipDuration(clip);
      const raw = Math.max(0, clip.start + timeAt(p) - pointerStartTime);
      // The magnetic main track decides positions by slot, so edge snapping only
      // matters on free-positioned audio tracks.
      const snapped =
        targetTrackId !== MAIN_TRACK_ID && s.snapping
          ? snapClipStart(raw, duration, points, SNAP_PX / s.zoom)
          : { start: raw, snappedTo: null };

      const from = base;
      const trackId = targetTrackId;
      const pointerTime = Math.max(0, timeAt(p));
      s.preview(() => moveClip(from, clipId, trackId, snapped.start, pointerTime));

      const placed = getClip(useEditor.getState().project, clipId);
      const guide =
        snapped.snappedTo !== null &&
        placed &&
        (near(placed.start, snapped.snappedTo) || near(clipEnd(placed), snapped.snappedTo))
          ? snapped.snappedTo
          : null;
      setView({
        ghost: { clipId, start: snapped.start, duration, trackId },
        snapGuide: guide,
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
      const isMain = clip.trackId === MAIN_TRACK_ID;
      let delta = timeAt(p) - pointerStartTime;

      // The edge that moves on the timeline (a main-track start trim changes
      // the in-point but keeps the clip's slot, so it has no edge to snap).
      let snappedTo: number | null = null;
      const edgeTime = edge === "end" ? clipEnd(clip) : isMain ? null : clip.start;
      if (edgeTime !== null && s.snapping) {
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
