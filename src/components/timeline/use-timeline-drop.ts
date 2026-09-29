/**
 * HTML5 drop target for the whole timeline: media-bin asset drags and OS files.
 * An enter/leave depth counter (reset on drop/dragend) keeps the highlight
 * from flickering between child elements or sticking after the drag ends.
 */
import { useEffect, useRef, type DragEvent } from "react";
import { toast } from "sonner";
import { snapPoints, snapTime } from "@shared/timeline";
import { dragKind, getAssetDragData, mediaFiles } from "@/lib/dnd";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { SNAP_PX } from "./constants";
import { lanePoint, type TimelineContextValue } from "./context";
import { laneAt, newTrackZoneAt } from "./geometry";
import { setView, useTimelineView, type DropTarget } from "./view-store";

function sameTarget(a: DropTarget | null, b: DropTarget | null) {
  if (!a || !b) return a === b;
  return a.trackId === b.trackId && a.newTrack === b.newTrack && Math.abs(a.time - b.time) < 1e-3;
}

export function useTimelineDrop(ctx: TimelineContextValue) {
  const depth = useRef(0);

  useEffect(() => {
    const reset = () => {
      depth.current = 0;
      setView({ drop: null });
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

  const show = (e: DragEvent) => {
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
      e.dataTransfer.dropEffect = "copy";
      show(e);
    },
    onDragLeave(e: DragEvent) {
      if (!dragKind(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setView({ drop: null });
    },
    onDrop(e: DragEvent) {
      const kind = dragKind(e.dataTransfer);
      if (!kind) return;
      e.preventDefault();
      const target = targetAt(e);
      depth.current = 0;
      setView({ drop: null });
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
