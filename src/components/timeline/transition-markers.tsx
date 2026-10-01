/**
 * Transitions drawn on top of the clips they join, like Premiere: a box over
 * the stretch the transition plays, named when there's room. Click to select
 * it (its properties are in the Properties tab), drag an edge to change its
 * length, ⌫ to delete it.
 */
import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { PiIntersectSquareFill } from "react-icons/pi";
import {
  type TransitionRef,
  type TransitionWindow,
  durationForEdge,
  findWindow,
  projectTransitions,
  refKey,
  sameRef,
  setTransitionParams,
} from "@shared/transition-windows";
import { MIN_TRANSITION_DURATION } from "@shared/transitions";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { CLIP_INSET_Y, TRIM_THRESHOLD_PX } from "./constants";
import { type TimelineContextValue, useTimelineContext } from "./context";
import type { LaneLayout } from "./geometry";
import { startPointerSession } from "./pointer-session";
import { useTimelineView, useVisibleWindow } from "./view-store";
import { showPanel } from "@/stores/video-dock";

/** Narrowest a marker is drawn, so short transitions stay clickable. */
const MIN_WIDTH = 14;

export function TransitionMarkers({ lanes, zoom }: { lanes: LaneLayout[]; zoom: number }) {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedTransition);
  const [x0, x1] = useVisibleWindow();
  const laneById = new Map(lanes.map((l) => [l.trackId, l]));
  return (
    <>
      {projectTransitions(project).map((w) => {
        const lane = laneById.get(w.trackId);
        // Like clips, only the ones in view (markers are at least MIN_WIDTH wide around their middle).
        const mid = ((w.start + w.end) / 2) * zoom;
        const half = Math.max(MIN_WIDTH, (w.end - w.start) * zoom) / 2;
        if (!lane || mid + half < x0 || mid - half > x1) return null;
        return <Marker key={refKey(w.ref)} window={w} lane={lane} zoom={zoom} selected={sameRef(w.ref, selected)} />;
      })}
    </>
  );
}

const Marker = memo(function Marker({
  window: w,
  lane,
  zoom,
  selected,
}: {
  window: TransitionWindow;
  lane: LaneLayout;
  zoom: number;
  selected: boolean;
}) {
  const ctx = useTimelineContext();
  const width = Math.max(MIN_WIDTH, (w.end - w.start) * zoom);
  const left = ((w.start + w.end) / 2) * zoom - width / 2;
  const height = lane.height - CLIP_INSET_Y * 2;
  const top = lane.top + CLIP_INSET_Y;
  // A transition at a free edge can only grow into its clip.
  const edges: ("start" | "end")[] = w.from && w.to ? ["start", "end"] : w.to ? ["end"] : ["start"];

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    useEditor.getState().selectTransition(w.ref);
  };

  return (
    <div
      data-transition={refKey(w.ref)}
      className={cn(
        "group/transition absolute z-[4] flex touch-none items-center justify-center overflow-hidden rounded-md border select-none",
        "bg-[linear-gradient(to_top_right,transparent_calc(50%-0.5px),rgb(255_255_255/0.35)_50%,transparent_calc(50%+0.5px))] backdrop-blur-[1.5px]",
        selected ? "border-transparent bg-brand/45 ring-2 ring-foreground" : "border-white/35 bg-black/45 hover:bg-black/30",
      )}
      style={{ left, width, top, height }}
      title={w.def.label}
      onPointerDown={onPointerDown}
      onDoubleClick={() => showPanel("properties")}
    >
      {width >= 40 && (
        <span className="pointer-events-none flex max-w-full items-center gap-1 rounded-[4px] bg-black/55 px-1.5 text-[10.5px] leading-4 font-medium text-white">
          <PiIntersectSquareFill className="size-3 shrink-0" />
          {width >= 96 && <span className="truncate">{w.def.label}</span>}
        </span>
      )}
      {edges.map((side) => (
        <div
          key={side}
          aria-hidden
          className={cn("absolute inset-y-0 w-1.5 cursor-ew-resize", side === "start" ? "left-0" : "right-0")}
          onPointerDown={(e) => {
            e.stopPropagation();
            useEditor.getState().selectTransition(w.ref);
            startDurationDrag(e, w.ref, side, ctx);
          }}
        />
      ))}
    </div>
  );
});

/** Drag one edge of a transition to change its length (one undo step). */
function startDurationDrag(
  e: ReactPointerEvent<HTMLElement>,
  ref: TransitionRef,
  side: "start" | "end",
  ctx: TimelineContextValue,
) {
  let gestureId = -1;
  startPointerSession(e, ctx, {
    threshold: TRIM_THRESHOLD_PX,
    autoScroll: true,
    cursor: "ew-resize",
    onStart() {
      gestureId = useEditor.getState().beginGesture();
    },
    onMove(p) {
      const s = useEditor.getState();
      const base = s.gestureId === gestureId ? s.gestureBase : null;
      const w = base && findWindow(base, ref);
      if (!base || !w) return;
      const duration = Math.max(MIN_TRANSITION_DURATION, durationForEdge(w, side, p.x / s.zoom));
      s.preview(() => setTransitionParams(base, ref, { duration }));
    },
    onEnd() {
      useEditor.getState().endGesture(gestureId);
    },
    onCancel() {
      useEditor.getState().cancelGesture(gestureId);
    },
  });
}

/** Where a transition being dragged in from the library will go. */
export function TransitionDropIndicator({ lanes, zoom }: { lanes: LaneLayout[]; zoom: number }) {
  const drop = useTimelineView((s) => s.transitionDrop);
  const lane = drop && lanes.find((l) => l.trackId === drop.trackId);
  if (!drop || !lane) return null;
  const width = Math.max(MIN_WIDTH, (drop.end - drop.start) * zoom);
  return (
    <div
      className="pointer-events-none absolute z-[6] rounded-md bg-brand/35 ring-2 ring-brand"
      style={{
        left: ((drop.start + drop.end) / 2) * zoom - width / 2,
        width,
        top: lane.top + CLIP_INSET_Y,
        height: lane.height - CLIP_INSET_Y * 2,
      }}
    />
  );
}
