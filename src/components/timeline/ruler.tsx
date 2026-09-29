import { memo, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { cn } from "cn";
import { lanePoint, useTimelineContext } from "./context";
import { rulerTicks } from "./geometry";
import { PlayheadHead } from "./playhead";
import { startPointerSession } from "./pointer-session";
import { setView, useVisibleWindow } from "./view-store";

const seekToX = (x: number) => usePlayback.getState().seek(Math.max(0, x / useEditor.getState().zoom));

/** Time ruler: adaptive ticks for the visible window; click or drag to scrub. */
export function Ruler({ width, zoom }: { width: number; zoom: number }) {
  const ctx = useTimelineContext();

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = lanePoint(ctx, e.clientX, e.clientY);
    if (!p) return;
    seekToX(p.x);
    const stop = () => setView({ scrubbing: false });
    startPointerSession(e, ctx, {
      threshold: 0,
      autoScroll: true,
      onStart: () => setView({ scrubbing: true }),
      onMove: (pt) => seekToX(pt.x),
      onEnd: stop,
      onCancel: stop,
    });
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
