/**
 * The scrollable part of the timeline. One scroll container holds a sticky
 * ruler row and a sticky header column, so headers, ruler and lanes can never
 * drift out of alignment. Horizontal positions inside the lane area are
 * `time * zoom`; the header column is `HEADER_WIDTH` wide.
 */
import { useLayoutEffect, useMemo } from "react";
import type { Clip } from "@shared/types";
import { clipEnd, projectDuration } from "@shared/timeline";
import { useEditor } from "@/stores/editor";
import { startMarquee } from "./clip-gestures";
import { BOTTOM_GUTTER, HEADER_WIDTH, RULER_HEIGHT } from "./constants";
import { useTimelineContext } from "./context";
import { contentWidth, layoutLanes } from "./geometry";
import { DragGhosts, DropIndicator, EmptyVideoHint, LaneBackgrounds, MarqueeBox, SelectedGap, SnapGuide } from "./lane-overlays";
import { PlayheadLine, usePlayheadFollow } from "./playhead";
import { Ruler } from "./ruler";
import { SignalLanes, SignalLanesToggle } from "./signal-lanes";
import { TimelineClip } from "./timeline-clip";
import { LanesContextMenu } from "./timeline-menus";
import { TrackHeaders } from "./track-headers";
import { TransitionDropIndicator, TransitionMarkers } from "./transition-markers";
import { useScrollZoom } from "./use-scroll-zoom";
import { useTimelineDrop } from "./use-timeline-drop";
import { useTimelineView, useVisibleWindow } from "./view-store";

/** Stable DOM order (by id) so reordering never moves a node that holds pointer capture. */
const byId = (a: Clip, b: Clip) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function TimelineBody() {
  const ctx = useTimelineContext();
  const tracks = useEditor((s) => s.project.tracks);
  const clips = useEditor((s) => s.project.clips);
  const assets = useEditor((s) => s.assets);
  const zoom = useEditor((s) => s.zoom);
  const selectedClipIds = useEditor((s) => s.selectedClipIds);
  // Don't let the content shrink under the pointer mid-drag.
  const duration = useEditor((s) =>
    Math.max(projectDuration(s.project), s.gestureBase ? projectDuration(s.gestureBase) : 0),
  );
  const viewWidth = useTimelineView((s) => s.viewWidth);
  const dragClipIds = useTimelineView((s) => s.dragClipIds);
  const heldClipId = useTimelineView((s) => s.heldClipId);
  const [x0, x1] = useVisibleWindow();

  const { lanes, height: lanesHeight } = useMemo(() => layoutLanes(tracks), [tracks]);
  useLayoutEffect(() => {
    ctx.lanesLayout.current = lanes;
  }, [ctx, lanes]);

  const width = contentWidth(duration, zoom, viewWidth);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const laneById = useMemo(() => new Map(lanes.map((l) => [l.trackId, l])), [lanes]);
  const dimmed = useMemo(() => new Set(tracks.filter((t) => t.muted || t.hidden).map((t) => t.id)), [tracks]);
  const ordered = useMemo(() => [...clips].sort(byId), [clips]);
  // Only clips in (or near) view are rendered, so a long edit costs what's on screen. The window moves
  // in chunks (see `useVisibleWindow`), so scrolling re-renders this only now and then.
  const shown = useMemo(
    () => ordered.filter((c) => (c.start * zoom < x1 && clipEnd(c) * zoom > x0) || c.id === heldClipId),
    [ordered, zoom, x0, x1, heldClipId],
  );
  const selected = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const dragging = useMemo(() => new Set(dragClipIds), [dragClipIds]);
  // Until there's any video, point at the bottom (home) video lane.
  const videoLanes = lanes.filter((l) => l.kind === "video");
  const hintLane = clips.some((c) => laneById.get(c.trackId)?.kind === "video") ? null : videoLanes.at(-1);

  useScrollZoom(ctx, zoom);
  usePlayheadFollow(ctx.scrollerRef);
  const drop = useTimelineDrop(ctx);

  return (
    <div
      ref={ctx.scrollerRef}
      className="relative min-h-0 flex-1 overflow-auto overscroll-none "
      {...drop}
    >
      <div className="relative flex min-h-full flex-col" style={{ width: HEADER_WIDTH + width }}>
        <div className="sticky top-0 z-40 flex shrink-0 border-b bg-timeline" style={{ height: RULER_HEIGHT }}>
          <div className="sticky left-0 z-20 shrink-0 border-r bg-timeline" style={{ width: HEADER_WIDTH }}>
            <SignalLanesToggle />
          </div>
          <Ruler width={width} zoom={zoom} />
        </div>
        <SignalLanes width={width} zoom={zoom} />
        <div className="flex flex-1">
          <TrackHeaders tracks={tracks} lanes={lanes} />
          <LanesContextMenu>
            <div
              ref={ctx.lanesRef}
              data-timeline-lanes=""
              className="relative isolate flex-none select-none"
              style={{ width, minHeight: lanesHeight + BOTTOM_GUTTER }}
              onPointerDown={(e) => startMarquee(e, ctx)}
            >
              <LaneBackgrounds lanes={lanes} tracks={tracks} />
              {hintLane && <EmptyVideoHint lane={hintLane} width={Math.min(width, viewWidth)} />}
              {shown.map((clip) => {
                const lane = laneById.get(clip.trackId);
                if (!lane) return null;
                return (
                  <TimelineClip
                    key={clip.id}
                    clip={clip}
                    asset={assetById.get(clip.assetId)}
                    lane={lane}
                    zoom={zoom}
                    selected={selected.has(clip.id)}
                    placeholder={dragging.has(clip.id)}
                    dimmed={dimmed.has(clip.trackId)}
                    animate={dragging.size > 0 && !dragging.has(clip.id)}
                  />
                );
              })}
              <TransitionMarkers lanes={lanes} zoom={zoom} />
              <TransitionDropIndicator lanes={lanes} zoom={zoom} />
              <DropIndicator lanes={lanes} lanesHeight={lanesHeight} zoom={zoom} />
              <SelectedGap lanes={lanes} zoom={zoom} />
              <SnapGuide zoom={zoom} />
              <DragGhosts lanes={lanes} lanesHeight={lanesHeight} zoom={zoom} />
              <MarqueeBox />
              <PlayheadLine />
            </div>
          </LanesContextMenu>
        </div>
      </div>
    </div>
  );
}
