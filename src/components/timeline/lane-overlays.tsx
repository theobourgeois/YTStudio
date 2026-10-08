/** Lane backgrounds and the transient overlays drawn on top of clips. */
import { memo } from "react";
import { PiCursorClick, PiPlus, PiUploadSimple } from "react-icons/pi";
import type { Track } from "@shared/types";
import { clipName, getClip } from "@shared/timeline";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { AUDIO_LANE_HEIGHT, CLIP_INSET_Y, TOP_GUTTER } from "./constants";
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
            i === 0 && "border-t",
            lane.kind === "video" ? "bg-foreground/[0.035]" : "bg-foreground/[0.015]",
            (tracks[i]?.muted || tracks[i]?.hidden) && "bg-[repeating-linear-gradient(135deg,transparent_0_8px,color-mix(in_oklab,var(--color-foreground)_3%,transparent)_8px_16px)]",
          )}
          style={{ top: lane.top, height: lane.height }}
        />
      ))}
    </>
  );
});

/** Vertical extent of the "new track" zone above the first / below the last lane. */
function newTrackZone(where: "above" | "below", lanesHeight: number) {
  return where === "above"
    ? { top: 0, height: TOP_GUTTER }
    : { top: lanesHeight, height: AUDIO_LANE_HEIGHT };
}

/** Highlighted strip where a new track will be created on drop. */
function NewTrackZone({ where, lanesHeight }: { where: "above" | "below"; lanesHeight: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-[5] flex items-center border-y border-dashed border-brand/60 bg-brand/8"
      style={newTrackZone(where, lanesHeight)}
    >
      <span className="sticky right-2 ml-auto flex items-center gap-1 px-2 text-[10.5px] font-medium text-brand">
        <PiPlus className="size-3" />
        New {where === "above" ? "video" : "audio"} track
      </span>
    </div>
  );
}

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
  if (drop.newTrack) return <NewTrackZone where={drop.newTrack} lanesHeight={lanesHeight} />;
  const lane = drop.trackId ? lanes.find((l) => l.trackId === drop.trackId) : undefined;
  if (!lane) return null;
  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 z-[5] bg-brand/8 ring-2 ring-brand/45 ring-inset"
        style={{ top: lane.top, height: lane.height }}
      />
      <div
        className="pointer-events-none absolute z-[6] w-0"
        style={{ left: Math.max(4, drop.time * zoom), top: lane.top + 2, height: lane.height - 4 }}
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

/** Floating copies of the dragged clips that follow the pointer (snapped to the target lane). */
export function DragGhosts({ lanes, lanesHeight, zoom }: { lanes: LaneLayout[]; lanesHeight: number; zoom: number }) {
  const ghosts = useTimelineView((s) => s.ghosts);
  const names = useEditor((s) =>
    ghosts
      .map((g) => {
        const clip = getClip(s.project, g.clipId) ?? getClip(s.gestureBase ?? s.project, g.clipId);
        return clip ? clipName(clip, s.getAsset(clip.assetId)) : "";
      })
      .join("\n"),
  ).split("\n");
  if (ghosts.length === 0) return null;
  const newTrack = ghosts[0].newTrack;
  return (
    <>
      {newTrack && <NewTrackZone where={newTrack} lanesHeight={lanesHeight} />}
      {ghosts.map((ghost, i) => {
        const lane = ghost.trackId !== undefined ? lanes.find((l) => l.trackId === ghost.trackId) : null;
        const box = lane
          ? { top: lane.top + CLIP_INSET_Y, height: lane.height - CLIP_INSET_Y * 2, kind: lane.kind }
          : ghost.newTrack === "above"
            ? { top: 3, height: TOP_GUTTER - 6, kind: "video" as const }
            : { top: lanesHeight + CLIP_INSET_Y, height: AUDIO_LANE_HEIGHT - CLIP_INSET_Y * 2, kind: "audio" as const };
        if (ghost.trackId !== undefined && !lane) return null;
        return (
          <div
            key={ghost.clipId}
            className={cn(
              "pointer-events-none absolute z-[9] overflow-hidden rounded-md opacity-85 shadow-lg ring-2 ring-foreground",
              box.kind === "audio" ? "bg-clip-audio" : "bg-clip-video",
            )}
            style={{
              left: ghost.start * zoom,
              width: Math.max(2, ghost.duration * zoom),
              top: box.top,
              height: box.height,
            }}
          >
            {box.height >= 18 && (
              <div className="absolute top-1 left-1 max-w-[calc(100%-8px)] truncate rounded-[4px] bg-black/45 px-1.5 text-[10.5px] leading-4 font-medium text-white">
                {names[i]}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Outline of the selected gap (DaVinci-style), deleted with ⌫. */
export function SelectedGap({ lanes, zoom }: { lanes: LaneLayout[]; zoom: number }) {
  const gap = useEditor((s) => s.selectedGap);
  const lane = gap && lanes.find((l) => l.trackId === gap.trackId);
  if (!gap || !lane) return null;
  return (
    <div
      className="pointer-events-none absolute z-[2] rounded-md bg-foreground/[0.06] ring-2 ring-foreground ring-inset"
      style={{
        left: gap.start * zoom,
        width: (gap.end - gap.start) * zoom,
        top: lane.top + CLIP_INSET_Y,
        height: lane.height - CLIP_INSET_Y * 2,
      }}
    />
  );
}

/** Rubber-band selection rectangle. */
export function MarqueeBox() {
  const box = useTimelineView((s) => s.marquee);
  if (!box) return null;
  return (
    <div
      className="pointer-events-none absolute z-[8] rounded-[3px] border border-brand/70 bg-brand/10"
      style={{ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }}
    />
  );
}

/** Dashed call-to-action in the video lane while there's no video yet. */
export function EmptyVideoHint({ lane, width }: { lane: LaneLayout; width: number }) {
  const active = useTimelineView((s) => s.drop?.trackId === lane.trackId);
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
