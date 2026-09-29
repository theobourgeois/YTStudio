import { type DragEvent, useEffect, useRef, useState } from "react";
import { PiMusicNotes, PiPauseFill, PiPlayFill, PiPlus, PiX } from "react-icons/pi";
import { useShallow } from "zustand/react/shallow";
import type { MediaAsset } from "@shared/types";
import { formatTime } from "@shared/format";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { setAssetDragData, setLibraryDragData } from "@/lib/dnd";
import type { MarkSide } from "@/lib/source-marks";
import { useEditor } from "@/stores/editor";
import { useLibrary } from "@/stores/library";
import { assetMarkedRange, useSourceMarks } from "@/stores/source-marks";
import { useSourcePreview } from "@/stores/source-preview";
import { SourceTrimmer } from "./source-trimmer";
import { ShortcutHint, TransportButton } from "./transport";

/**
 * Shows one media or Library file on its own, in place of the timeline preview (Premiere's
 * Source Monitor). A video or sound can be trimmed first with In/Out marks: only the marked
 * part goes on the timeline.
 */
export function SourcePreview({ asset }: { asset: MediaAsset }) {
  return asset.kind === "image" ? <StillPreview asset={asset} /> : <PlayingPreview asset={asset} />;
}

const close = () => useSourcePreview.getState().close();

/** Drag the file itself onto the timeline (its marked part), from the picture. */
function dragSource(e: DragEvent, asset: MediaAsset) {
  const itemId = useSourcePreview.getState().libraryItemId;
  if (itemId) setLibraryDragData(e.dataTransfer, itemId);
  else setAssetDragData(e.dataTransfer, { assetIds: [asset.id] });
}

function StillPreview({ asset }: { asset: MediaAsset }) {
  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 pt-12">
        <PreviewBadge name={asset.name} />
        <img
          src={asset.src}
          alt={asset.name}
          draggable
          title="Drag onto the timeline"
          onDragStart={(e) => dragSource(e, asset)}
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
  const marked = useSourceMarks((s) => assetMarkedRange(asset, s.marks) !== null);
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
          title={marked ? "Adds the part between In and Out" : undefined}
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
      time: () => el.currentTime,
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
            draggable
            title="Click to play or pause, drag onto the timeline"
            onDragStart={(e) => dragSource(e, asset)}
            onClick={() => controller()?.toggle()}
            className="max-h-full max-w-full min-h-0 cursor-pointer rounded-lg bg-black shadow-xl ring-1 shadow-black/20 ring-black/10 dark:ring-white/10"
          />
        ) : (
          <div
            draggable
            title="Drag onto the timeline"
            onDragStart={(e) => dragSource(e, asset)}
            className="flex w-full max-w-sm cursor-grab flex-col items-center gap-4 rounded-xl border bg-card px-8 py-10 text-center"
          >
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
        <SourceTrimmer asset={asset} time={time} duration={duration} />
      </div>

      <div className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3 font-mono text-xs tabular-nums">
          <span className="shrink-0">
            <span className="text-foreground">{formatTime(time)}</span>
            <span className="px-1.5 text-muted-foreground/60">/</span>
            <span className="text-muted-foreground">{formatTime(duration)}</span>
          </span>
          <MarkedRange asset={asset} duration={duration} />
        </div>
        <div className="flex items-center gap-1">
          <MarkButton side="in" asset={asset} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                className="mx-1.5 size-9 rounded-full bg-foreground text-background inset-shadow-none hover:bg-foreground/85"
                aria-label={playing ? "Pause preview" : "Play preview"}
                onClick={() => controller()?.toggle()}
              >
                {playing ? <PiPauseFill /> : <PiPlayFill />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <ShortcutHint label={playing ? "Pause" : "Play"} shortcut="Space" />
            </TooltipContent>
          </Tooltip>
          <MarkButton side="out" asset={asset} />
        </div>
        <SourceActions asset={asset} />
      </div>
    </>
  );
}

/** Mark In or Out where the preview is (like the I and O keys). */
function MarkButton({ side, asset }: { side: MarkSide; asset: MediaAsset }) {
  const mark = () => {
    const source = useSourcePreview.getState().controller;
    if (source) useSourceMarks.getState().mark(asset.id, side, source.time(), source.duration());
  };
  return (
    <TransportButton
      label={side === "in" ? "Mark In" : "Mark Out"}
      shortcut={side === "in" ? SHORTCUT_KEYS.markIn : SHORTCUT_KEYS.markOut}
      disabled={false}
      onClick={mark}
    >
      <MarkIcon side={side} />
    </TransportButton>
  );
}

/** Premiere's brackets: `{` marks In, `}` marks Out. */
function MarkIcon({ side }: { side: MarkSide }) {
  return (
    <svg viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth={20} strokeLinecap="round" strokeLinejoin="round">
      {side === "in" ? (
        <path d="M152 40h-24c-24 0-32 12-32 32v32c0 16-8 24-32 24 24 0 32 8 32 24v32c0 20 8 32 32 32h24" />
      ) : (
        <path d="M104 40h24c24 0 32 12 32 32v32c0 16 8 24 32 24-24 0-32 8-32 24v32c0 20-8 32-32 32h-24" />
      )}
    </svg>
  );
}

/** How long the marked part is, and a way to clear the marks. */
function MarkedRange({ asset, duration }: { asset: MediaAsset; duration: number }) {
  const range = useSourceMarks(useShallow((s) => assetMarkedRange({ ...asset, duration }, s.marks)));
  if (!range) return null;
  return (
    <span
      className="flex min-w-0 items-center gap-1 rounded-full bg-brand/15 py-0.5 pr-0.5 pl-2 text-brand"
      title={`In ${formatTime(range.in)} · Out ${formatTime(range.out)}`}
    >
      <span className="truncate">{formatTime(range.out - range.in)}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Clear In and Out"
            onClick={() => useSourceMarks.getState().clear(asset.id)}
            className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full transition-colors outline-none hover:bg-brand/20 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <PiX className="size-2.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <ShortcutHint label="Clear In and Out" shortcut={SHORTCUT_KEYS.clearMarks} />
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
