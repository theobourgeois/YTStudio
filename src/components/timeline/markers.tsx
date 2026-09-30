/**
 * Markers on the timeline, like Premiere's: the sequence's on the ruler (drag one to move
 * it), a clip's along its top edge. A click goes to the marker; a double-click (or M on
 * it) opens its editor: a name, a colour, and Delete.
 */
import { memo, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { PiTrash } from "react-icons/pi";
import { MARKER_COLORS, clipMarkers, sequenceMarkers, updateClipMarker, updateMarker } from "@shared/markers";
import { snapPoints, snapTime } from "@shared/timeline";
import type { Clip, Marker, MarkerColor } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";
import { EditGesture } from "@/lib/edit-gesture";
import { cancelActiveDrag, startPointerDrag } from "@/lib/pointer-drag";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { type MarkerRef, deleteMarker, sameMarkerRef, useMarkerEditing } from "@/stores/markers";
import { usePlayback } from "@/stores/playback";
import { SNAP_PX } from "./constants";
import { lanePoint, useTimelineContext } from "./context";

/** Each colour's fill (Tailwind can't see class names built at run time). */
const FILL: Record<MarkerColor, string> = {
  green: "bg-emerald-400",
  red: "bg-red-400",
  orange: "bg-orange-400",
  yellow: "bg-yellow-300",
  blue: "bg-sky-400",
  purple: "bg-violet-400",
  white: "bg-white",
};

const fillOf = (marker: Pick<Marker, "color">) => FILL[marker.color ?? "green"];

/** The sequence's markers, on the ruler. */
export const RulerMarkers = memo(function RulerMarkers({ zoom }: { zoom: number }) {
  const markers = useEditor((s) => sequenceMarkers(s.project));
  if (!markers.length) return null;
  return (
    <>
      {markers.map((marker) => (
        <RulerMarker key={marker.id} marker={marker} zoom={zoom} />
      ))}
    </>
  );
});

function RulerMarker({ marker, zoom }: { marker: Marker; zoom: number }) {
  const ctx = useTimelineContext();
  const ref: MarkerRef = { id: marker.id };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    // Not the ruler's scrub.
    e.stopPropagation();
    const gesture = new EditGesture();
    startPointerDrag(e, {
      threshold: 3,
      cursor: "ew-resize",
      onStart: () => gesture.begin(),
      onMove(ev) {
        if (!gesture.active) return cancelActiveDrag();
        const p = lanePoint(ctx, ev.clientX, ev.clientY);
        if (!p) return;
        const { project, snapping, zoom: z } = useEditor.getState();
        const fps = project.settings.fps;
        let time = Math.max(0, p.x / z);
        // To clip edges and the playhead, else to the frame grid.
        const snapped = snapping ? snapTime(time, snapPoints(useEditor.getState().gestureBase ?? project, usePlayback.getState().time), SNAP_PX / z) : null;
        time = snapped?.snappedTo != null ? snapped.time : Math.round(time * fps) / fps;
        gesture.apply((proj) => updateMarker(proj, marker.id, { time }));
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
      onClick() {
        usePlayback.getState().pause();
        usePlayback.getState().seek(marker.time);
      },
    });
  };

  return (
    <MarkerEditor marker={marker} markerRef={ref}>
      <button
        type="button"
        data-marker={marker.id}
        aria-label={marker.label ? `Marker: ${marker.label}` : "Marker"}
        title={marker.label}
        className="group/marker absolute top-0 z-[9] flex h-full -translate-x-1/2 cursor-pointer touch-none flex-col items-center outline-none"
        style={{ left: marker.time * zoom }}
        onPointerDown={onPointerDown}
        onDoubleClick={() => useMarkerEditing.getState().edit(ref)}
      >
        <span
          className={cn(
            "mt-3 h-2.5 w-2.5 shadow-[0_0_0_1px_rgb(0_0_0/0.45)] transition-transform [clip-path:polygon(0_0,100%_0,100%_55%,50%_100%,0_55%)] group-hover/marker:scale-125 group-focus-visible/marker:scale-125",
            fillOf(marker),
          )}
        />
        {marker.label && (
          <span className="pointer-events-none absolute top-2.5 left-full ml-0.5 max-w-28 truncate rounded-[3px] bg-background/85 px-1 text-[10px] leading-3.5 font-medium whitespace-nowrap text-foreground/90">
            {marker.label}
          </span>
        )}
      </button>
    </MarkerEditor>
  );
}

/** A clip's markers along its top edge (those inside what it shows). */
export function ClipMarkers({ clip, zoom }: { clip: Clip; zoom: number }) {
  const markers = clipMarkers(clip);
  if (!markers.length) return null;
  return (
    <div className="absolute inset-x-0 top-0 z-[2] h-2.5" data-clip-markers={markers.length}>
      {markers.map(({ marker, time }) => {
        const ref: MarkerRef = { id: marker.id, clipId: clip.id };
        return (
          <MarkerEditor key={marker.id} marker={marker} markerRef={ref}>
            <button
              type="button"
              data-marker={marker.id}
              aria-label={marker.label ? `Clip marker: ${marker.label}` : "Clip marker"}
              title={marker.label}
              className="absolute top-0 h-2.5 w-2.5 -translate-x-1/2 cursor-pointer outline-none"
              style={{ left: (time - clip.start) * zoom }}
              // Not the clip's drag: a click goes to the marker, a double-click edits it.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                usePlayback.getState().pause();
                usePlayback.getState().seek(time);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                useMarkerEditing.getState().edit(ref);
              }}
            >
              <span className={cn("block h-2 w-2 shadow-[0_0_0_1px_rgb(0_0_0/0.5)] [clip-path:polygon(0_0,100%_0,50%_100%)]", fillOf(marker))} />
            </button>
          </MarkerEditor>
        );
      })}
    </div>
  );
}

/** A marker's editor, anchored to it: its name, its colour, and Delete. Open while it's the one being edited. */
function MarkerEditor({ marker, markerRef, children }: { marker: Marker; markerRef: MarkerRef; children: React.ReactNode }) {
  const open = useMarkerEditing((s) => sameMarkerRef(s.editing, markerRef));
  const input = useRef<HTMLInputElement>(null);
  const gesture = useRef<EditGesture | null>(null);
  const change = (patch: { label?: string; color?: MarkerColor }) => (p: Parameters<typeof updateMarker>[0]) =>
    markerRef.clipId ? updateClipMarker(p, markerRef.clipId, marker.id, patch) : updateMarker(p, marker.id, patch);
  // Typing a name is one undo step, however many letters.
  const finish = () => {
    gesture.current?.end();
    gesture.current = null;
  };
  useEffect(() => {
    if (!open) finish();
  }, [open]);
  useEffect(() => finish, []);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => !next && useMarkerEditing.getState().edit(null)}>
      <PopoverPrimitive.Anchor asChild>{children}</PopoverPrimitive.Anchor>
      {open && (
        <PopoverContent
          side="top"
          align="start"
          className="w-64 p-2.5"
          aria-label="Marker"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            input.current?.focus();
            input.current?.select();
          }}
          // Keys typed here are the name, not shortcuts.
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5">
            <Input
              ref={input}
              aria-label="Marker name"
              placeholder="Name"
              className="h-7 text-xs"
              defaultValue={marker.label ?? ""}
              onChange={(e) => {
                if (!gesture.current) {
                  gesture.current = new EditGesture();
                  gesture.current.begin();
                }
                gesture.current.apply(change({ label: e.target.value }));
              }}
              onBlur={finish}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") useMarkerEditing.getState().edit(null);
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete marker"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => {
                finish();
                deleteMarker(markerRef);
              }}
            >
              <PiTrash />
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-1.5" role="radiogroup" aria-label="Marker colour">
            {MARKER_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={(marker.color ?? "green") === c.value}
                aria-label={c.label}
                title={c.label}
                onClick={() => {
                  finish();
                  useEditor.getState().commit(change({ color: c.value }));
                }}
                className={cn(
                  "size-5 cursor-pointer rounded-full ring-offset-2 ring-offset-popover outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring",
                  FILL[c.value],
                  (marker.color ?? "green") === c.value && "ring-2 ring-foreground/70",
                )}
              />
            ))}
          </div>
        </PopoverContent>
      )}
    </PopoverPrimitive.Root>
  );
}
