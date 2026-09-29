import { useEffect, useRef, useState } from "react";
import { PiMusicNotes, PiPauseFill, PiPlayFill, PiPlus, PiX } from "react-icons/pi";
import type { MediaAsset } from "@shared/types";
import { formatTime } from "@shared/format";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { useLibrary } from "@/stores/library";
import { useSourcePreview } from "@/stores/source-preview";

/** A roomy scrubber: the whole strip seeks, the track thickens and the thumb appears on hover. */
const scrubberClass = cn(
  "py-2.5",
  "[&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:transition-[height] hover:[&_[data-slot=slider-track]]:h-1.5",
  "[&_[data-slot=slider-thumb]]:opacity-0 [&_[data-slot=slider-thumb]]:transition-opacity hover:[&_[data-slot=slider-thumb]]:opacity-100 [&_[data-slot=slider-thumb]:focus-visible]:opacity-100",
);

/** Shows one media or Library file on its own, in place of the timeline preview. */
export function SourcePreview({ asset }: { asset: MediaAsset }) {
  return asset.kind === "image" ? <StillPreview asset={asset} /> : <PlayingPreview asset={asset} />;
}

const close = () => useSourcePreview.getState().close();

function StillPreview({ asset }: { asset: MediaAsset }) {
  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 pt-12">
        <PreviewBadge name={asset.name} />
        <img
          src={asset.src}
          alt={asset.name}
          draggable={false}
          className="max-h-full max-w-full min-h-0 rounded-lg bg-[repeating-conic-gradient(var(--color-muted)_0_25%,transparent_0_50%)] bg-size-[16px_16px] object-contain shadow-xl ring-1 shadow-black/20 ring-black/10 dark:ring-white/10"
        />
      </div>
      <div className="grid h-12 shrink-0 grid-cols-[1fr_auto] items-center px-4">
        <span className="text-xs text-muted-foreground tabular-nums">
          {asset.width && asset.height ? `${asset.width} × ${asset.height}` : "Image"}
        </span>
        <SourceActions asset={asset} />
      </div>
    </>
  );
}

function PreviewBadge({ name }: { name: string }) {
  return (
    <div className="absolute top-3 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border bg-background/80 py-1 pr-1 pl-3 text-xs backdrop-blur-sm">
      <span className="font-medium text-brand">Preview</span>
      <span className="truncate text-muted-foreground">{name}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Back to timeline"
            onClick={close}
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <PiX className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Back to timeline
          <kbd className="ml-2 rounded border bg-muted px-1 text-[10px] leading-4 text-muted-foreground">Esc</kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function SourceActions({ asset }: { asset: MediaAsset }) {
  const add = () => {
    const itemId = useSourcePreview.getState().libraryItemId;
    if (itemId) void useLibrary.getState().addToTimeline(itemId);
    else useEditor.getState().addAssetsToTimeline([asset.id]);
  };
  return (
    <div className="flex items-center justify-end gap-1.5">
      {asset.duration > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={add}
        >
          <PiPlus />
          Add to timeline
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground" onClick={close}>
        Back to timeline
      </Button>
    </div>
  );
}

function PlayingPreview({ asset }: { asset: MediaAsset }) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(asset.duration);
  const [playing, setPlaying] = useState(false);

  // The asset object is replaced while it's processing (filmstrip, waveform), so
  // only a different file restarts playback.
  const fallbackDuration = asset.duration;
  useEffect(() => {
    const el = mediaRef.current!;
    const clamp = (t: number) => Math.min(Math.max(0, t), el.duration || fallbackDuration);
    const controller = {
      toggle: () => void (el.paused ? el.play().catch(() => {}) : el.pause()),
      play: () => void el.play().catch(() => {}),
      pause: () => el.pause(),
      seek: (t: number) => (el.currentTime = clamp(t)),
      step: (s: number) => {
        el.pause();
        el.currentTime = clamp(el.currentTime + s);
      },
      duration: () => el.duration || fallbackDuration,
    };
    useSourcePreview.getState().setController(controller);
    // Opened from a click, so autoplay is allowed.
    controller.play();
    return () => {
      el.pause();
      if (useSourcePreview.getState().controller === controller) useSourcePreview.getState().setController(null);
    };
  }, [asset.id, asset.src, fallbackDuration]);

  const controller = () => useSourcePreview.getState().controller;
  const mediaProps = {
    ref: mediaRef,
    src: asset.src,
    preload: "auto",
    onTimeUpdate: () => setTime(mediaRef.current!.currentTime),
    onSeeked: () => setTime(mediaRef.current!.currentTime),
    onLoadedMetadata: () => setDuration(mediaRef.current!.duration || asset.duration),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
  } as const;

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 pt-12">
        <PreviewBadge name={asset.name} />

        {asset.hasVideo ? (
          <video
            {...mediaProps}
            playsInline
            onClick={() => controller()?.toggle()}
            className="max-h-full max-w-full min-h-0 cursor-pointer rounded-lg bg-black shadow-xl ring-1 shadow-black/20 ring-black/10 dark:ring-white/10"
          />
        ) : (
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border bg-card px-8 py-10 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-clip-audio/15 text-clip-audio">
              <PiMusicNotes className="size-6" />
            </span>
            <p className="max-w-full truncate text-sm font-medium" title={asset.name}>
              {asset.name}
            </p>
            <audio {...mediaProps} />
          </div>
        )}
      </div>

      <div className="px-4">
        <Slider
          aria-label="Preview position"
          className={scrubberClass}
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          value={[time]}
          onValueChange={([t]) => controller()?.seek(t)}
        />
      </div>

      <div className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-4">
        <div className="font-mono text-xs tabular-nums">
          <span className="text-foreground">{formatTime(time)}</span>
          <span className="px-1.5 text-muted-foreground/60">/</span>
          <span className="text-muted-foreground">{formatTime(duration)}</span>
        </div>
        <Button
          size="icon"
          className="size-9 rounded-full bg-foreground text-background inset-shadow-none hover:bg-foreground/85"
          aria-label={playing ? "Pause preview" : "Play preview"}
          onClick={() => controller()?.toggle()}
        >
          {playing ? <PiPauseFill /> : <PiPlayFill />}
        </Button>
        <SourceActions asset={asset} />
      </div>
    </>
  );
}
