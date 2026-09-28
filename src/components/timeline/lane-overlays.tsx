/** Lane backgrounds and the transient overlays drawn on top of clips. */
import { memo } from "react";
import { PiCursorClick, PiUploadSimple } from "react-icons/pi";
import type { Track } from "@shared/types";
import { MAIN_TRACK_ID, getClip } from "@shared/timeline";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { CLIP_INSET_Y } from "./constants";
import type { LaneLayout } from "./geometry";
import { useTimelineView } from "./view-store";

export const LaneBackgrounds = memo(function LaneBackgrounds({
  lanes,
  tracks,
}: {
  lanes: LaneLayout[];
  tracks: Track[];
}) {
  return (
    <>
      {lanes.map((lane, i) => (
        <div
          key={lane.trackId}
          className={cn(
            "pointer-events-none absolute inset-x-0 border-b",
            lane.trackId === MAIN_TRACK_ID ? "bg-foreground/[0.035]" : "bg-foreground/[0.015]",
            tracks[i]?.muted && "bg-[repeating-linear-gradient(135deg,transparent_0_8px,color-mix(in_oklab,var(--color-foreground)_3%,transparent)_8px_16px)]",
          )}
          style={{ top: lane.top, height: lane.height }}
        />
      ))}
    </>
  );
});

/** Where a dragged-in asset/file will land. */
export function DropIndicator({
  lanes,
  lanesHeight,
  zoom,
}: {
  lanes: LaneLayout[];
  lanesHeight: number;
  zoom: number;
}) {
  const drop = useTimelineView((s) => s.drop);
  if (!drop) return null;
  const lane = drop.trackId ? lanes.find((l) => l.trackId === drop.trackId) : undefined;
  if (!lane) {
    // Below the lanes: auto-route to the matching track.
    return (
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] border-2 border-dashed border-brand/50 bg-brand/5"
        style={{ top: lanesHeight }}
      />
    );
  }
  const lineTime = lane.trackId === MAIN_TRACK_ID ? (drop.slotTime ?? drop.time) : drop.time;
  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 z-[5] bg-brand/8 ring-2 ring-brand/45 ring-inset"
        style={{ top: lane.top, height: lane.height }}
      />
      <div
        className="pointer-events-none absolute z-[6] w-0"
        style={{ left: Math.max(4, lineTime * zoom), top: lane.top + 2, height: lane.height - 4 }}
      >
        <div className="absolute inset-y-0 -left-px w-0.5 rounded-full bg-brand" />
        <div className="absolute -top-0.5 -left-[4px] size-2 rounded-full bg-brand" />
        <div className="absolute -bottom-0.5 -left-[4px] size-2 rounded-full bg-brand" />
      </div>
    </>
  );
}

export function SnapGuide({ zoom }: { zoom: number }) {
  const time = useTimelineView((s) => s.snapGuide);
  if (time === null) return null;
  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-[7] w-px bg-brand shadow-[0_0_6px_var(--color-brand)]"
      style={{ left: time * zoom }}
    />
  );
}

/** Floating copy of the dragged clip that follows the pointer (snapped to the target lane). */
export function DragGhost({ lanes, zoom }: { lanes: LaneLayout[]; zoom: number }) {
  const ghost = useTimelineView((s) => s.ghost);
  const name = useEditor((s) => {
    if (!ghost) return null;
    const clip = getClip(s.gestureBase ?? s.project, ghost.clipId);
    return clip ? (s.getAsset(clip.assetId)?.name ?? "Media offline") : null;
  });
  const lane = ghost && lanes.find((l) => l.trackId === ghost.trackId);
  if (!ghost || !lane) return null;
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-[9] overflow-hidden rounded-md opacity-85 shadow-lg ring-2 ring-foreground",
        lane.kind === "audio" ? "bg-clip-audio" : "bg-clip-video",
      )}
      style={{
        left: ghost.start * zoom,
        width: Math.max(2, ghost.duration * zoom),
        top: lane.top + CLIP_INSET_Y,
        height: lane.height - CLIP_INSET_Y * 2,
      }}
    >
      <div className="absolute top-1 left-1 max-w-[calc(100%-8px)] truncate rounded-[4px] bg-black/45 px-1.5 text-[10.5px] leading-4 font-medium text-white">
        {name}
      </div>
    </div>
  );
}

/** Dashed call-to-action in the empty main lane. */
export function EmptyMainHint({ lane, width }: { lane: LaneLayout; width: number }) {
  const active = useTimelineView((s) => s.drop?.trackId === MAIN_TRACK_ID);
  if (width < 80) return null;
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-2 z-[4] flex items-center justify-center gap-2 rounded-md border border-dashed text-xs text-muted-foreground transition-colors",
        active ? "border-brand/60 bg-brand/5 text-foreground" : "border-muted-foreground/35",
      )}
      style={{ top: lane.top + CLIP_INSET_Y, height: lane.height - CLIP_INSET_Y * 2, width: width - 16 }}
    >
      {active ? <PiCursorClick className="size-3.5" /> : <PiUploadSimple className="size-3.5" />}
      <span className="font-medium">Drag clips here</span>
      <span className="hidden text-muted-foreground/80 sm:inline">from the media bin or your computer</span>
    </div>
  );
}
