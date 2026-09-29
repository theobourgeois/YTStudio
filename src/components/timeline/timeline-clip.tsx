import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { PiTextT, PiWarning } from "react-icons/pi";
import type { Clip, MediaAsset } from "@shared/types";
import { isTextClip } from "@shared/effects";
import { keyframeTimes, timelineTime } from "@shared/animation";
import { clipDuration, clipName } from "@shared/timeline";
import { cn } from "cn";
import { useLayout } from "@/stores/layout";
import { startClipMove, startClipTrim } from "./clip-gestures";
import { Filmstrip, PosterStrip, Waveform } from "./clip-media";
import { CLIP_INSET_Y } from "./constants";
import { useTimelineContext } from "./context";
import type { LaneLayout } from "./geometry";

interface TimelineClipProps {
  clip: Clip;
  asset: MediaAsset | undefined;
  lane: LaneLayout;
  zoom: number;
  selected: boolean;
  /** This clip is being moved: draw it as a placeholder in its laid-out slot. */
  placeholder: boolean;
  muted: boolean;
  /** Slide into new positions (while another clip is being dragged). */
  animate: boolean;
}

export const TimelineClip = memo(function TimelineClip({
  clip,
  asset,
  lane,
  zoom,
  selected,
  placeholder,
  muted,
  animate,
}: TimelineClipProps) {
  const ctx = useTimelineContext();
  const left = clip.start * zoom;
  const width = Math.max(2, clipDuration(clip) * zoom);
  const height = lane.height - CLIP_INSET_Y * 2;
  const text = isTextClip(clip);
  const offline = !asset && !text;
  const audioLane = lane.kind === "audio";

  return (
    <div
      data-clip-id={clip.id}
      data-selected={selected || undefined}
      className={cn(
        "group/clip absolute touch-none select-none",
        selected ? "z-[3]" : "z-[1]",
        animate && "transition-[left,top] duration-150 ease-out",
      )}
      style={{ left, top: lane.top + CLIP_INSET_Y, width, height }}
      onPointerDown={(e) => startClipMove(e, clip.id, ctx)}
      onDoubleClick={() => useLayout.getState().setLeftPanel("properties")}
    >
      <div
        className={cn(
          "absolute inset-0 overflow-hidden rounded-md border",
          offline
            ? "border-dashed border-muted-foreground/40 bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_6px,var(--color-accent)_6px_12px)]"
            : cn("border-black/20 dark:border-white/10", text ? "bg-clip-graphic" : audioLane ? "bg-clip-audio" : "bg-clip-video"),
          muted && !offline && "opacity-55 saturate-50",
          placeholder && "opacity-30",
        )}
      >
        {!offline && (
          <ClipContent asset={asset} clip={clip} audioLane={audioLane} left={left} width={width} height={height} zoom={zoom} />
        )}
        {width >= 26 && <ClipLabel offline={offline} text={text} name={clipName(clip, asset)} />}
        <ClipKeyframes clip={clip} zoom={zoom} />
      </div>
      {selected && !placeholder && (
        <div className="pointer-events-none absolute -inset-px rounded-md ring-2 ring-foreground" />
      )}
      {!placeholder && (
        <>
          <TrimHandle edge="start" width={width} selected={selected} onPointerDown={(e) => startClipTrim(e, clip.id, "start", ctx)} />
          <TrimHandle edge="end" width={width} selected={selected} onPointerDown={(e) => startClipTrim(e, clip.id, "end", ctx)} />
        </>
      )}
    </div>
  );
}, sameClipProps);

function sameClipProps(a: TimelineClipProps, b: TimelineClipProps) {
  return (
    a.clip.id === b.clip.id &&
    a.clip.start === b.clip.start &&
    a.clip.in === b.clip.in &&
    a.clip.out === b.clip.out &&
    a.clip.assetId === b.clip.assetId &&
    // A text clip's label is its text.
    a.clip.effects === b.clip.effects &&
    a.asset === b.asset &&
    a.lane.top === b.lane.top &&
    a.lane.height === b.lane.height &&
    a.lane.kind === b.lane.kind &&
    a.zoom === b.zoom &&
    a.selected === b.selected &&
    a.placeholder === b.placeholder &&
    a.muted === b.muted &&
    a.animate === b.animate
  );
}

function ClipContent({
  asset,
  clip,
  audioLane,
  left,
  width,
  height,
  zoom,
}: {
  asset: MediaAsset | undefined;
  clip: Clip;
  audioLane: boolean;
  left: number;
  width: number;
  height: number;
  zoom: number;
}) {
  if (!asset) return null;
  if (audioLane) {
    return (
      <Waveform url={asset.waveform} clipLeft={left} width={width} height={height - 2} inPoint={clip.in} zoom={zoom} />
    );
  }
  if (asset.filmstrip) {
    return (
      <Filmstrip
        filmstrip={asset.filmstrip}
        assetDuration={asset.duration}
        clipLeft={left}
        width={width}
        height={height - 2}
        inPoint={clip.in}
        zoom={zoom}
      />
    );
  }
  return asset.poster ? <PosterStrip poster={asset.poster} /> : null;
}

/** A mark at each of the clip's keyframes (any property), along its bottom edge. */
function ClipKeyframes({ clip, zoom }: { clip: Clip; zoom: number }) {
  const times = keyframeTimes(clip)
    .map((s) => timelineTime(clip, s) - clip.start)
    .filter((t) => t >= -1e-6 && t <= clipDuration(clip) + 1e-6);
  if (times.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0.5 h-2" data-clip-keyframes={times.length}>
      {times.map((t) => (
        <div
          key={t}
          className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
          style={{ left: Math.max(3, Math.min(t * zoom, clipDuration(clip) * zoom - 3)) }}
        />
      ))}
    </div>
  );
}

function ClipLabel({ offline, text, name }: { offline: boolean; text: boolean; name: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-1 left-1 flex max-w-[calc(100%-8px)] items-center gap-1 rounded-[4px] px-1.5 text-[10.5px] leading-4 font-medium",
        offline ? "text-muted-foreground" : "bg-black/45 text-white",
      )}
    >
      {offline && <PiWarning className="size-3 shrink-0" />}
      {text && <PiTextT className="size-3 shrink-0" />}
      <span className="truncate">{name}</span>
    </div>
  );
}

function TrimHandle({
  edge,
  width,
  selected,
  onPointerDown,
}: {
  edge: "start" | "end";
  width: number;
  selected: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  // Comfortable hit area that never swallows the whole clip; a selected clip
  // gets a few extra px outside its edges so tiny clips stay trimmable.
  const inside = Math.min(10, Math.max(3, width / 3));
  const outside = selected ? 4 : 0;
  const start = edge === "start";
  return (
    <div
      aria-hidden
      className={cn(
        "group/handle absolute inset-y-0 z-[2] flex cursor-ew-resize touch-none",
        start ? "justify-start" : "justify-end",
      )}
      style={{ width: inside + outside, [start ? "left" : "right"]: -outside }}
      onPointerDown={onPointerDown}
    >
      <div
        className={cn(
          "pointer-events-none flex h-full items-center justify-center bg-white shadow-sm transition-opacity",
          start ? "rounded-l-md" : "rounded-r-md",
          selected
            ? "opacity-100"
            : "opacity-0 group-hover/clip:opacity-70 group-hover/handle:opacity-100",
        )}
        style={{ width: Math.min(6, inside), marginLeft: start ? outside : 0, marginRight: start ? 0 : outside }}
      >
        <div className="h-3 w-px rounded-full bg-black/40" />
      </div>
    </div>
  );
}
