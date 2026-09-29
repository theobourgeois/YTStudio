import { memo, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { editPoints, nearestPoint } from "@shared/timeline";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { cn } from "cn";
import { lanePoint, useTimelineContext } from "./context";
import { rulerTicks } from "./geometry";
import { PlayheadHead } from "./playhead";
import { startPointerSession } from "./pointer-session";
import { setView, useVisibleWindow } from "./view-store";

const isSnapKey = (e: KeyboardEvent) => e.key === "Meta" || e.key === "Control";

/**
 * Time ruler: adaptive ticks for the visible window; click or drag to scrub. Holding ⌘ (Ctrl)
 * the playhead goes to the nearest clip start or end instead, hopping between them.
 */
export function Ruler({ width, zoom }: { width: number; zoom: number }) {
  const ctx = useTimelineContext();

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = lanePoint(ctx, e.clientX, e.clientY);
    if (!p) return;
    const edges = editPoints(useEditor.getState().project);
    let x = p.x;
    let toEdge = e.metaKey || e.ctrlKey;
    const seek = () => {
      const time = Math.max(0, x / useEditor.getState().zoom);
      usePlayback.getState().seek(toEdge ? nearestPoint(edges, time) : time);
    };
    seek();
    // Pressing or letting go of ⌘ mid-scrub takes effect without moving the mouse.
    const onKey = (ev: KeyboardEvent) => {
      if (!isSnapKey(ev)) return;
      toEdge = ev.type === "keydown";
      seek();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    const stop = () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      setView({ scrubbing: false });
    };
    const started = startPointerSession(e, ctx, {
      threshold: 0,
      autoScroll: true,
      onStart: () => setView({ scrubbing: true }),
      onMove: (pt, mods) => {
        x = pt.x;
        toEdge = mods.metaKey || mods.ctrlKey;
        seek();
      },
      onEnd: stop,
      onCancel: stop,
      onClick: stop,
    });
    if (!started) stop();
  };

  return (
    <div className="relative h-full touch-none select-none" style={{ width }} onPointerDown={onPointerDown}>
      <Ticks width={width} zoom={zoom} />
      <PlayheadHead />
    </div>
  );
}

const Ticks = memo(function Ticks({ width, zoom }: { width: number; zoom: number }) {
  const [x0, x1] = useVisibleWindow();
  const ticks = useMemo(() => rulerTicks(zoom, x0, Math.min(x1, width)), [zoom, x0, x1, width]);
  return (
    <>
      {ticks.map((t) => (
        <div key={t.time} className="pointer-events-none absolute inset-y-0" style={{ left: t.x }}>
          <div
            className={cn(
              "absolute bottom-0 w-px",
              t.major ? "h-2.5 bg-muted-foreground/55" : "h-1.5 bg-muted-foreground/30",
            )}
          />
          {t.label && (
            <span className="absolute top-1 left-1 text-[10px] leading-3 font-medium whitespace-nowrap text-muted-foreground tabular-nums">
              {t.label}
            </span>
          )}
        </div>
      ))}
    </>
  );
});
