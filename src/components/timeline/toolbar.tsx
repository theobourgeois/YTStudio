import type { ReactNode } from "react";
import { PiArrowsOutSimple, PiMagnet, PiMagnifyingGlassMinus, PiMagnifyingGlassPlus, PiPlus, PiScissors, PiTrash } from "react-icons/pi";
import { addAudioTrack, projectDuration } from "@shared/timeline";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MAX_ZOOM, MIN_ZOOM, useEditor } from "@/stores/editor";
import { TOOLBAR_HEIGHT } from "./constants";
import { useTimelineContext } from "./context";
import { fitZoom, sliderToZoom, zoomToSlider } from "./geometry";
import { useTimelineView } from "./view-store";

const ZOOM_STEP = 1.5;
const SLIDER_MAX = 1000;

export function TimelineToolbar() {
  const ctx = useTimelineContext();
  const hasClips = useEditor((s) => s.project.clips.length > 0);
  const hasSelection = useEditor((s) => s.selectedClipId !== null);
  const snapping = useEditor((s) => s.snapping);
  const zoom = useEditor((s) => s.zoom);
  const duration = useEditor((s) => projectDuration(s.project));
  const viewWidth = useTimelineView((s) => s.viewWidth);

  const editor = useEditor.getState;
  const fit = fitZoom(duration, viewWidth, MIN_ZOOM, MAX_ZOOM);

  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b px-2"
      style={{ height: TOOLBAR_HEIGHT }}
    >
      <ToolButton label="Split at playhead" shortcut="S" disabled={!hasClips} onClick={() => editor().splitAtPlayhead()}>
        <PiScissors />
      </ToolButton>
      <ToolButton label="Delete clip" shortcut="⌫" disabled={!hasSelection} onClick={() => editor().deleteSelected()}>
        <PiTrash />
      </ToolButton>

      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            aria-label="Snapping"
            pressed={snapping}
            onPressedChange={() => editor().toggleSnapping()}
            className="size-8 min-w-8 text-muted-foreground data-[state=on]:bg-brand/15 data-[state=on]:text-brand hover:data-[state=on]:bg-brand/20 hover:data-[state=on]:text-brand"
          >
            <PiMagnet />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent side="top">Snapping {snapping ? "on" : "off"}</TooltipContent>
      </Tooltip>

      <ToolButton
        label="Add audio track"
        onClick={() => editor().commit((p) => addAudioTrack(p).project)}
        wide
        className="px-2 text-xs"
      >
        <PiPlus />
        <span>Audio track</span>
      </ToolButton>

      <div className="ml-auto flex items-center gap-1">
        <ToolButton label="Zoom out" shortcut="−" hint="or ⌘/Ctrl + scroll" disabled={zoom <= MIN_ZOOM} onClick={() => ctx.zoomTo(zoom / ZOOM_STEP)}>
          <PiMagnifyingGlassMinus />
        </ToolButton>
        <Slider
          aria-label="Zoom"
          className="w-28 [&_[data-slot=slider-thumb]]:size-3.5"
          min={0}
          max={SLIDER_MAX}
          step={5}
          value={[Math.round(zoomToSlider(zoom, MIN_ZOOM, MAX_ZOOM) * SLIDER_MAX)]}
          onValueChange={([v]) => ctx.zoomTo(sliderToZoom(v / SLIDER_MAX, MIN_ZOOM, MAX_ZOOM))}
        />
        <ToolButton label="Zoom in" shortcut="+" hint="or ⌘/Ctrl + scroll" disabled={zoom >= MAX_ZOOM} onClick={() => ctx.zoomTo(zoom * ZOOM_STEP)}>
          <PiMagnifyingGlassPlus />
        </ToolButton>
        <ToolButton
          label="Zoom to fit"
          disabled={fit === null}
          onClick={() => fit !== null && ctx.zoomTo(fit, { time: 0, vx: 0 })}
        >
          <PiArrowsOutSimple />
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  shortcut,
  hint,
  wide,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string;
  shortcut?: string;
  hint?: string;
  /** Icon + text instead of icon only. */
  wide?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Wrapper keeps the tooltip working while the button is disabled. */}
        <span className="inline-flex">
          <Button
            variant="ghost"
            size={wide ? "sm" : "icon-sm"}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={cn("text-muted-foreground hover:text-foreground", className)}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut && (
          <kbd className="rounded border border-background/25 px-1 font-sans text-[10px] leading-4 opacity-80">
            {shortcut}
          </kbd>
        )}
        {hint && <span className="opacity-60">{hint}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
