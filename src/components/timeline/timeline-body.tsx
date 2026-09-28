/**
 * The scrollable part of the timeline. One scroll container holds a sticky
 * ruler row and a sticky header column, so headers, ruler and lanes can never
 * drift out of alignment. Horizontal positions inside the lane area are
 * `time * zoom`; the header column is `HEADER_WIDTH` wide.
 */
import { useLayoutEffect, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import type { Clip } from "@shared/types";
import { MAIN_TRACK_ID, projectDuration } from "@shared/timeline";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { HEADER_WIDTH, RULER_HEIGHT } from "./constants";
import { lanePoint, useTimelineContext } from "./context";
import { contentWidth, layoutLanes } from "./geometry";
import { DragGhost, DropIndicator, EmptyMainHint, LaneBackgrounds, SnapGuide } from "./lane-overlays";
import { PlayheadLine, usePlayheadFollow } from "./playhead";
import { Ruler } from "./ruler";
import { TimelineClip } from "./timeline-clip";
import { TrackHeaders } from "./track-headers";
import { useScrollZoom } from "./use-scroll-zoom";
import { useTimelineDrop } from "./use-timeline-drop";
import { useTimelineView } from "./view-store";

/** Stable DOM order (by id) so reordering never moves a node that holds pointer capture. */
const byId = (a: Clip, b: Clip) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function TimelineBody() {
  const ctx = useTimelineContext();
  const tracks = useEditor((s) => s.project.tracks);
  const clips = useEditor((s) => s.project.clips);
  const assets = useEditor((s) => s.assets);
  const zoom = useEditor((s) => s.zoom);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  // Don't let the content shrink under the pointer mid-drag.
  const duration = useEditor((s) =>
    Math.max(projectDuration(s.project), s.gestureBase ? projectDuration(s.gestureBase) : 0),
  );
  const viewWidth = useTimelineView((s) => s.viewWidth);
  const dragClipId = useTimelineView((s) => s.dragClipId);

  const { lanes, height: lanesHeight } = useMemo(() => layoutLanes(tracks), [tracks]);
  useLayoutEffect(() => {
    ctx.lanesLayout.current = lanes;
  }, [ctx, lanes]);

  const width = contentWidth(duration, zoom, viewWidth);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const laneById = useMemo(() => new Map(lanes.map((l) => [l.trackId, l])), [lanes]);
  const muted = useMemo(() => new Set(tracks.filter((t) => t.muted).map((t) => t.id)), [tracks]);
  const ordered = useMemo(() => [...clips].sort(byId), [clips]);
  const mainLane = laneById.get(MAIN_TRACK_ID);
  const mainEmpty = !clips.some((c) => c.trackId === MAIN_TRACK_ID);

  useScrollZoom(ctx, zoom);
  usePlayheadFollow(ctx.scrollerRef);
  const drop = useTimelineDrop(ctx);

  // Empty lane space: clear the selection and seek.
  const onLanesPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = lanePoint(ctx, e.clientX, e.clientY);
    if (!p) return;
    useEditor.getState().select(null);
    usePlayback.getState().seek(Math.max(0, p.x / zoom));
  };

  return (
    <div
      ref={ctx.scrollerRef}
      className="relative min-h-0 flex-1 overflow-auto overscroll-none [scrollbar-width:thin]"
      {...drop}
    >
      <div className="relative flex min-h-full flex-col" style={{ width: HEADER_WIDTH + width }}>
        <div className="sticky top-0 z-40 flex shrink-0 border-b bg-timeline" style={{ height: RULER_HEIGHT }}>
          <div className="sticky left-0 z-20 shrink-0 border-r bg-timeline" style={{ width: HEADER_WIDTH }} />
          <Ruler width={width} zoom={zoom} />
        </div>
        <div className="flex flex-1">
          <TrackHeaders tracks={tracks} lanes={lanes} />
          <div
            ref={ctx.lanesRef}
            className="relative isolate flex-none select-none"
            style={{ width, minHeight: lanesHeight }}
            onPointerDown={onLanesPointerDown}
          >
            <LaneBackgrounds lanes={lanes} tracks={tracks} />
            {mainLane && mainEmpty && <EmptyMainHint lane={mainLane} width={Math.min(width, viewWidth)} />}
            {ordered.map((clip) => {
              const lane = laneById.get(clip.trackId);
              if (!lane) return null;
              return (
                <TimelineClip
                  key={clip.id}
                  clip={clip}
                  asset={assetById.get(clip.assetId)}
                  lane={lane}
                  zoom={zoom}
                  selected={clip.id === selectedClipId}
                  placeholder={clip.id === dragClipId}
                  muted={muted.has(clip.trackId)}
                  animate={dragClipId !== null}
                />
              );
            })}
            <DropIndicator lanes={lanes} lanesHeight={lanesHeight} zoom={zoom} />
            <SnapGuide zoom={zoom} />
            <DragGhost lanes={lanes} zoom={zoom} />
            <PlayheadLine />
          </div>
        </div>
      </div>
    </div>
  );
}
