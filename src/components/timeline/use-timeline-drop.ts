/**
 * HTML5 drop target for the whole timeline: media-bin asset drags, Library
 * items, OS files, transitions (dropped on the nearest clip edge) and video
 * effects (dropped on a clip).
 * An enter/leave depth counter (reset on drop/dragend) keeps the highlight
 * from flickering between child elements or sticking after the drag ends.
 */
import { useEffect, useRef, type DragEvent } from "react";
import { toast } from "sonner";
import { clipsAtTime, isOnVideoTrack, snapPoints, snapTime } from "@shared/timeline";
import { type TransitionRef, addTransition, findWindow, transitionTargetAt } from "@shared/transition-windows";
import { DEFAULT_TRANSITION } from "@shared/transitions";
import { dragKind, getAssetDragData, getEffectDragData, getLibraryDragData, getTransitionDragData, mediaFiles } from "@/lib/dnd";
import { useEditor } from "@/stores/editor";
import { useLibrary } from "@/stores/library";
import { usePlayback } from "@/stores/playback";
import { SNAP_PX } from "./constants";
import { lanePoint, type TimelineContextValue } from "./context";
import { laneAt, newTrackZoneAt } from "./geometry";
import { setView, useTimelineView, type DropTarget, type TransitionDrop } from "./view-store";

/** How far (px) outside a clip a transition still snaps to its edge. */
const TRANSITION_REACH_PX = 16;

function sameTransitionDrop(a: TransitionDrop | null, b: TransitionDrop | null) {
  if (!a || !b) return a === b;
  return a.trackId === b.trackId && Math.abs(a.start - b.start) < 1e-6 && Math.abs(a.end - b.end) < 1e-6;
}

function sameTarget(a: DropTarget | null, b: DropTarget | null) {
  if (!a || !b) return a === b;
  return a.trackId === b.trackId && a.newTrack === b.newTrack && Math.abs(a.time - b.time) < 1e-3;
}

export function useTimelineDrop(ctx: TimelineContextValue) {
  const depth = useRef(0);

  useEffect(() => {
    const reset = () => {
      depth.current = 0;
      setView({ drop: null, transitionDrop: null, effectDrop: null });
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
      reset();
    };
  }, []);

  const targetAt = (e: DragEvent): DropTarget | null => {
    const p = lanePoint(ctx, e.clientX, e.clientY);
    if (!p) return null;
    const lanes = ctx.lanesLayout.current;
    const lane = laneAt(lanes, p.y);
    const { project, zoom, snapping } = useEditor.getState();
    let time = Math.max(0, p.x / zoom);
    if (snapping) time = snapTime(time, snapPoints(project, usePlayback.getState().time), SNAP_PX / zoom).time;
    return { trackId: lane?.trackId ?? null, newTrack: newTrackZoneAt(lanes, p.y), time };
  };

  /** The clip edge a transition would be dropped on (not snapped: edges attract it instead). */
  const transitionTarget = (e: DragEvent): TransitionRef | null => {
    const p = lanePoint(ctx, e.clientX, e.clientY);
    const lane = p && laneAt(ctx.lanesLayout.current, p.y);
    if (!p || !lane) return null;
    const { project, zoom } = useEditor.getState();
    return transitionTargetAt(project, lane.trackId, Math.max(0, p.x / zoom), TRANSITION_REACH_PX / zoom);
  };

  /** The video-track clip under the pointer, which an effect would be added to. */
  const effectTarget = (e: DragEvent): string | null => {
    const p = lanePoint(ctx, e.clientX, e.clientY);
    const lane = p && laneAt(ctx.lanesLayout.current, p.y);
    if (!p || !lane) return null;
    const { project, zoom } = useEditor.getState();
    const clip = clipsAtTime(project, p.x / zoom).find((c) => c.trackId === lane.trackId);
    return clip && isOnVideoTrack(project, clip) ? clip.id : null;
  };

  const show = (e: DragEvent) => {
    if (dragKind(e.dataTransfer) === "effect") {
      setView({ effectDrop: effectTarget(e) });
      return;
    }
    if (dragKind(e.dataTransfer) === "transition") {
      const ref = transitionTarget(e);
      const { project } = useEditor.getState();
      // Where it would play (the type isn't readable mid-drag; the default's length is close enough).
      const w = ref && findWindow(addTransition(project, ref, DEFAULT_TRANSITION).project, ref);
      const next = w ? { trackId: w.trackId, start: w.start, end: w.end } : null;
      if (!sameTransitionDrop(useTimelineView.getState().transitionDrop, next)) setView({ transitionDrop: next });
      return;
    }
    const next = targetAt(e);
    if (!sameTarget(useTimelineView.getState().drop, next)) setView({ drop: next });
  };

  return {
    onDragEnter(e: DragEvent) {
      if (!dragKind(e.dataTransfer)) return;
      e.preventDefault();
      depth.current++;
      show(e);
    },
    onDragOver(e: DragEvent) {
      if (!dragKind(e.dataTransfer)) return;
      e.preventDefault();
      show(e);
      const kind = dragKind(e.dataTransfer);
      const view = useTimelineView.getState();
      const nowhere = (kind === "transition" && !view.transitionDrop) || (kind === "effect" && !view.effectDrop);
      e.dataTransfer.dropEffect = nowhere ? "none" : "copy";
    },
    onDragLeave(e: DragEvent) {
      if (!dragKind(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setView({ drop: null, transitionDrop: null, effectDrop: null });
    },
    onDrop(e: DragEvent) {
      const kind = dragKind(e.dataTransfer);
      if (!kind) return;
      e.preventDefault();
      depth.current = 0;
      setView({ drop: null, transitionDrop: null, effectDrop: null });
      if (kind === "effect") {
        const type = getEffectDragData(e.dataTransfer);
        const clipId = effectTarget(e);
        if (!type || !clipId) return;
        // Dropped on one of the selected clips: it goes on all of them, like Premiere.
        const selected = useEditor.getState().selectedClipIds;
        useEditor.getState().addEffectTo(selected.includes(clipId) ? selected : [clipId], type);
        return;
      }
      if (kind === "transition") {
        const type = getTransitionDragData(e.dataTransfer);
        const ref = transitionTarget(e);
        if (type && ref) useEditor.getState().addTransitionAt(ref, type);
        return;
      }
      const target = targetAt(e);
      const opts = {
        trackId: target?.trackId ?? undefined,
        newTrack: target?.newTrack ?? undefined,
        at: target?.time,
      };
      const editor = useEditor.getState();

      if (kind === "assets") {
        const payload = getAssetDragData(e.dataTransfer);
        if (payload?.assetIds.length) editor.addAssetsToTimeline(payload.assetIds, opts);
        return;
      }
      if (kind === "library") {
        // A dragged folder has nothing to put on the timeline.
        const items = new Set(useLibrary.getState().items.map((i) => i.id));
        const ids = getLibraryDragData(e.dataTransfer).filter((id) => items.has(id));
        if (ids.length) void useLibrary.getState().addToTimeline(ids, opts);
        return;
      }
      const all = Array.from(e.dataTransfer.files);
      const files = mediaFiles(all);
      if (files.length === 0) {
        if (all.length) toast.error("Unsupported file type", { description: "Drop video or audio files." });
        return;
      }
      void editor.importFiles(files).then((assets) => {
        if (assets.length) {
          useEditor.getState().addAssetsToTimeline(
            assets.map((a) => a.id),
            opts,
          );
        }
      });
    },
  };
}
