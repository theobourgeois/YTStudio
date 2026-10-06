import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { PiArrowCounterClockwise, PiCircleHalfTilt, PiCrosshairSimple, PiIntersectSquare, PiPolygon, PiSpiral, PiSquare, PiSubtitles, PiTextT, PiVideoCamera, PiWarning } from "react-icons/pi";
import type { Clip, MediaAsset } from "@shared/types";
import { isNestedClip } from "@shared/sequences";
import { useEditor } from "@/stores/editor";
import { type ClipKind, OPACITY, SOLID, clipKind, findEffect, videoEffects } from "@shared/effects";
import { keyframeTimes, timelineTime } from "@shared/animation";
import { clipDuration, clipName, clipSpeed, sourceDelta, sourceEdge } from "@shared/timeline";
import { formatSpeed } from "@shared/format";
import { cn } from "cn";
import { ClipMarkers } from "./markers";
import { useAssistant } from "@/stores/assistant";
import { startClipMove, startClipTrim } from "./clip-gestures";
import { Filmstrip, PosterStrip, Waveform } from "./clip-media";
import { Spectrogram } from "./spectrogram";
import { useSignalView } from "@/stores/signal-view";
import { useSignals } from "@/stores/signals";
import { CLIP_INSET_Y } from "./constants";
import { useTimelineContext } from "./context";
import type { LaneLayout } from "./geometry";
import { useTimelineView } from "./view-store";
import { showPanel } from "@/stores/video-dock";

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
  const kind = clipKind(clip);
  const offline = !asset && kind === "media";
  const audioLane = lane.kind === "audio";
  const effectDrop = useTimelineView((s) => s.effectDrop === clip.id);
  // Just changed by the assistant.
  const flash = useAssistant((s) => s.highlights[clip.id]);
  const effects = videoEffects(clip);

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
      onDoubleClick={() => {
        // A nested sequence opens in its own tab (Premiere); anything else shows its properties.
        if (isNestedClip(clip)) useEditor.getState().openSequence(clip.assetId);
        else showPanel("properties");
      }}
    >
      <div
        className={cn(
          "absolute inset-0 overflow-hidden rounded-md border",
          offline
            ? "border-dashed border-muted-foreground/40 bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_6px,var(--color-accent)_6px_12px)]"
            : cn(
                "border-black/20 dark:border-white/10",
                kind === "text"
                  ? "bg-clip-graphic"
                  : kind === "adjustment"
                    ? "bg-clip-adjustment"
                    : kind === "solid" || kind === "shape"
                      ? "bg-clip-solid"
                      : kind === "camera"
                        ? "bg-clip-camera"
                        : kind === "null"
                          ? "bg-clip-null"
                          : audioLane
                        ? "bg-clip-audio"
                        : "bg-clip-video",
              ),
          muted && !offline && "opacity-55 saturate-50",
          placeholder && "opacity-30",
        )}
      >
        {!offline && (
          <ClipContent asset={asset} clip={clip} audioLane={audioLane} left={left} width={width} height={height} zoom={zoom} />
        )}
        {kind === "solid" && <SolidSwatch color={findEffect(clip, SOLID.type)?.params.color as string} />}
        {width >= 26 && (
          <ClipLabel
            offline={offline}
            kind={kind}
            matte={(findEffect(clip, OPACITY.type)?.params.trackMatte ?? "none") !== "none"}
            parented={!!clip.parent}
            caption={clip.caption === true}
            name={clipName(clip, asset)}
            effects={effects.map((e) => e.type)}
            effectsOn={effects.some((e) => e.enabled)}
            speed={clipSpeed(clip)}
            reversed={clip.reversed === true}
          />
        )}
        <ClipKeyframes clip={clip} zoom={zoom} />
      </div>
      {!placeholder && <ClipMarkers clip={clip} zoom={zoom} />}
      {selected && !placeholder && (
        <div className="pointer-events-none absolute -inset-px rounded-md ring-2 ring-foreground" />
      )}
      {effectDrop && <div className="pointer-events-none absolute -inset-px rounded-md bg-brand/20 ring-2 ring-brand" />}
      {flash !== undefined && (
        <div
          key={flash}
          data-assistant-flash
          className="pointer-events-none absolute -inset-px z-[4] animate-[assistant-flash_2.6s_ease-out_forwards] rounded-md ring-2 ring-brand"
        />
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
    a.clip.speed === b.clip.speed &&
    a.clip.reversed === b.clip.reversed &&
    a.clip.assetId === b.clip.assetId &&
    a.clip.parent?.id === b.clip.parent?.id &&
    a.clip.markers === b.clip.markers &&
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
  const spectrograms = useSignalView((s) => s.spectrograms);
  const analysed = useSignals((s) => !!asset && s.data.has(asset.id));
  if (!asset) return null;
  // Source time at the left edge, and how fast (and which way) it runs from there.
  const inPoint = sourceEdge(clip, clip.start);
  const rate = sourceDelta(clip, 1);
  if (audioLane && spectrograms && analysed) {
    return <Spectrogram assetId={asset.id} clipLeft={left} width={width} height={height - 2} inPoint={inPoint} zoom={zoom} rate={rate} />;
  }
  if (audioLane) {
    return (
      <Waveform url={asset.waveform} clipLeft={left} width={width} height={height - 2} inPoint={inPoint} zoom={zoom} rate={rate} />
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
        inPoint={inPoint}
        zoom={zoom}
        rate={rate}
      />
    );
  }
  return asset.poster ? <PosterStrip poster={asset.poster} /> : null;
}

/** A solid's colour, as a band along the bottom of its clip. */
function SolidSwatch({ color }: { color: string }) {
  return <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5" style={{ background: color }} data-solid-color={color} />;
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

function ClipLabel({
  offline,
  kind,
  matte,
  parented,
  caption,
  name,
  effects,
  effectsOn,
  speed,
  reversed,
}: {
  offline: boolean;
  kind: ClipKind;
  /** Drawn through a track matte (the clip on the track above). */
  matte: boolean;
  /** Follows another clip (parenting). */
  parented: boolean;
  caption: boolean;
  name: string;
  /** Its video effects' types. */
  effects: string[];
  /** Some of them are on. */
  effectsOn: boolean;
  speed: number;
  reversed: boolean;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-1 left-1 flex max-w-[calc(100%-8px)] items-center gap-1 rounded-[4px] px-1.5 text-[10.5px] leading-4 font-medium",
        offline ? "text-muted-foreground" : "bg-black/45 text-white",
      )}
    >
      {offline && <PiWarning className="size-3 shrink-0" />}
      {kind === "text" && (caption ? <PiSubtitles className="size-3 shrink-0" /> : <PiTextT className="size-3 shrink-0" />)}
      {kind === "adjustment" && <PiCircleHalfTilt className="size-3 shrink-0" />}
      {kind === "solid" && <PiSquare className="size-3 shrink-0" />}
      {kind === "shape" && <PiPolygon className="size-3 shrink-0" />}
      {kind === "camera" && <PiVideoCamera className="size-3 shrink-0" />}
      {kind === "null" && <PiCrosshairSimple className="size-3 shrink-0" />}
      {parented && <PiSpiral className="size-3 shrink-0 text-brand" aria-label="Parented" data-clip-parented />}
      {matte && <PiIntersectSquare className="size-3 shrink-0 text-sky-300" aria-label="Track matte" data-clip-matte />}
      <span className="truncate">{name}</span>
      {(speed !== 1 || reversed) && (
        // Premiere puts the speed after the name ("clip.mp4 [200%]"); a reversed clip's is negative.
        <span data-clip-speed={reversed ? -speed : speed} className="flex shrink-0 items-center gap-0.5 text-sky-300 tabular-nums">
          {reversed && <PiArrowCounterClockwise className="size-3" aria-label="Reversed" />}
          {speed !== 1 && formatSpeed(speed)}
        </span>
      )}
      {effects.length > 0 && (
        // Premiere's fx badge: coloured while an effect is on.
        <span
          data-clip-effects={effects.join(" ")}
          className={cn("shrink-0 font-serif font-semibold italic", effectsOn ? "text-amber-300" : "opacity-50")}
        >
          fx
        </span>
      )}
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
