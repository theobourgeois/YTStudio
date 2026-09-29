import { type PointerEvent as ReactPointerEvent, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { MediaAsset } from "@shared/types";
import { formatTime } from "@shared/format";
import { clamp } from "@shared/math";
import { filmstripFrameUrl } from "@/lib/api";
import { startPointerDrag } from "@/lib/pointer-drag";
import type { MarkSide } from "@/lib/source-marks";
import { cn } from "cn";
import { peakInRange } from "@/components/timeline/geometry";
import { useWaveformData } from "@/components/timeline/waveform-cache";
import { useSourceMarks } from "@/stores/source-marks";
import { useSourcePreview } from "@/stores/source-preview";
import { percentAt, stripTiles } from "./trimmer-geometry";

const STRIP_HEIGHT = 56;

/**
 * The source preview's trimmer: the whole file as a filmstrip (or its waveform), with a
 * frame around the part that goes on the timeline. Drag the frame's handles to set In and
 * Out, press anywhere else to seek and scrub. The picture follows whatever is dragged.
 */
export function SourceTrimmer({ asset, time, duration }: { asset: MediaAsset; time: number; duration: number }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const width = useWidth(stripRef);
  const marks = useSourceMarks(useShallow((s) => s.marks[asset.id] ?? {}));
  const [dragging, setDragging] = useState<MarkSide | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const controller = () => useSourcePreview.getState().controller;
  const length = Math.max(duration, 0.01);
  const pct = (t: number) => percentAt(t, length);
  const inAt = marks.in ?? 0;
  const outAt = marks.out ?? length;
  const trimmed = marks.in !== undefined || marks.out !== undefined;

  const timeAt = (clientX: number) => {
    const rect = stripRef.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1) * length;
  };

  const scrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    controller()?.seek(timeAt(e.clientX));
    startPointerDrag(e, { threshold: 0, onMove: (ev) => controller()?.seek(timeAt(ev.clientX)) });
  };

  const trim = (side: MarkSide) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const source = controller();
    source?.pause();
    const markAt = () => {
      const m = useSourceMarks.getState().marks[asset.id];
      return side === "in" ? (m?.in ?? 0) : (m?.out ?? duration);
    };
    // Where the handle was grabbed, so the mark doesn't jump to the pointer.
    const grab = timeAt(e.clientX) - markAt();
    const before = useSourceMarks.getState().marks[asset.id];
    startPointerDrag(e, {
      threshold: 0,
      cursor: "ew-resize",
      onStart: () => setDragging(side),
      onMove: (ev) => {
        useSourceMarks.getState().drag(asset.id, side, timeAt(ev.clientX) - grab, duration);
        source?.seek(markAt());
      },
      onEnd: () => setDragging(null),
      onCancel: () => {
        setDragging(null);
        useSourceMarks.getState().restore(asset.id, before);
      },
    });
  };

  const hoverTime = hoverX === null || dragging ? null : (hoverX / Math.max(1, width)) * length;

  return (
    <div className="relative pt-5 pb-2">
      {/* The time under the pointer, or of the handle being dragged. */}
      {dragging ? (
        <TimeTag at={pct(dragging === "in" ? inAt : outAt)} brand>
          {formatTime(dragging === "in" ? inAt : outAt)}
        </TimeTag>
      ) : (
        hoverTime !== null && <TimeTag at={pct(hoverTime)}>{formatTime(hoverTime)}</TimeTag>
      )}

      <div
        ref={stripRef}
        role="slider"
        tabIndex={0}
        aria-label="Preview position"
        aria-valuemin={0}
        aria-valuemax={length}
        aria-valuenow={time}
        aria-valuetext={formatTime(time)}
        className="relative cursor-pointer touch-none rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{ height: STRIP_HEIGHT }}
        onPointerDown={scrub}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse") return;
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverX(clamp(e.clientX - rect.left, 0, rect.width));
        }}
        onPointerLeave={() => setHoverX(null)}
      >
        <div className="absolute inset-0 overflow-hidden rounded-lg bg-muted">
          <StripPicture asset={asset} width={width} />
          {/* What's left out is dimmed. */}
          <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: pct(inAt) }} />
          <div className="absolute inset-y-0 right-0 bg-black/60" style={{ left: pct(outAt) }} />
        </div>

        {hoverTime !== null && (
          <span className="pointer-events-none absolute inset-y-0 w-px bg-white/40" style={{ left: hoverX! }} />
        )}

        {/* The frame around what's kept, with its two handles. */}
        <div
          data-trim-frame
          className={cn(
            "pointer-events-none absolute inset-y-0 rounded-lg border-y-[3px] transition-colors",
            trimmed ? "border-brand" : "border-white/70",
          )}
          style={{ left: pct(inAt), right: `calc(100% - ${pct(outAt)})` }}
        >
          <TrimHandle side="in" trimmed={trimmed} active={dragging === "in"} onPointerDown={trim("in")} />
          <TrimHandle side="out" trimmed={trimmed} active={dragging === "out"} onPointerDown={trim("out")} />
        </div>

        {/* The playhead. */}
        <span
          className="pointer-events-none absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
          style={{ left: pct(time) }}
        />
      </div>
    </div>
  );
}

/** One side of the frame: a grip to drag, inside the frame so it never leaves the strip. */
function TrimHandle({
  side,
  trimmed,
  active,
  onPointerDown,
}: {
  side: MarkSide;
  trimmed: boolean;
  active: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      data-mark={side}
      role="presentation"
      title={side === "in" ? "Drag to trim the start (I marks it at the playhead)" : "Drag to trim the end (O marks it at the playhead)"}
      className={cn(
        "pointer-events-auto absolute -inset-y-[3px] grid w-3.5 cursor-ew-resize place-items-center transition-colors",
        side === "in" ? "left-0 rounded-l-lg" : "right-0 rounded-r-lg",
        trimmed ? "bg-brand" : "bg-white/70 hover:bg-white",
        active && "brightness-110",
      )}
      onPointerDown={onPointerDown}
    >
      <span className={cn("h-4 w-0.5 rounded-full", trimmed ? "bg-brand-foreground/80" : "bg-black/50")} />
    </div>
  );
}

function TimeTag({ at, brand, children }: { at: string; brand?: boolean; children: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute top-0 -translate-x-1/2 rounded px-1 font-mono text-[10px] leading-4 tabular-nums",
        brand ? "bg-brand text-brand-foreground" : "bg-foreground text-background",
      )}
      style={{ left: `clamp(1.5rem, ${at}, calc(100% - 1.5rem))` }}
    >
      {children}
    </span>
  );
}

/** The whole file across the strip: filmstrip frames, the poster while they're made, or the sound's waveform. */
function StripPicture({ asset, width }: { asset: MediaAsset; width: number }) {
  if (!asset.hasVideo) return <StripWaveform url={asset.waveform} duration={asset.duration} width={width} />;
  const strip = asset.filmstrip;
  if (!strip) {
    return asset.poster ? (
      <div
        className="absolute inset-0 bg-repeat-x"
        style={{ backgroundImage: `url("${asset.poster}")`, backgroundSize: "auto 100%" }}
      />
    ) : null;
  }
  const tileWidth = Math.max(24, (STRIP_HEIGHT * strip.width) / Math.max(1, strip.height));
  return (
    <>
      {stripTiles(width, tileWidth, strip.count).map((t) => (
        <img
          key={t.x}
          src={filmstripFrameUrl(strip.urlPattern, t.frame)}
          alt=""
          draggable={false}
          decoding="async"
          className="absolute top-0 h-full object-cover"
          style={{ left: t.x, width: t.width }}
        />
      ))}
    </>
  );
}

function StripWaveform({ url, duration, width }: { url: string | null; duration: number; width: number }) {
  const data = useWaveformData(url);
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !data || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(STRIP_HEIGHT * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = "rgba(255, 255, 255, 0.7)";
    const mid = canvas.height / 2;
    const maxBar = canvas.height - 12 * dpr;
    const step = duration / canvas.width;
    for (let px = 0; px < canvas.width; px++) {
      const bar = Math.max(dpr, peakInRange(data.peaks, data.peaksPerSecond, px * step, (px + 1) * step) * maxBar);
      g.fillRect(px, mid - bar / 2, 1, bar);
    }
  }, [data, duration, width]);
  return (
    <div className="absolute inset-0 bg-clip-audio/60">
      <canvas ref={ref} className="absolute inset-0 size-full" />
    </div>
  );
}

/** An element's width in px, kept up to date. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
