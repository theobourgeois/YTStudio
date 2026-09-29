import type { ReactNode } from "react";
import {
  PiArrowsOutSimple,
  PiFilmStrip,
  PiKeyboard,
  PiMagnet,
  PiMagnifyingGlassMinus,
  PiMagnifyingGlassPlus,
  PiMusicNotes,
  PiPlus,
  PiScissors,
  PiTrash,
} from "react-icons/pi";
import { addTrack } from "@shared/timeline";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { cn } from "@/lib/utils";
import { MAX_ZOOM, MIN_ZOOM, useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { TOOLBAR_HEIGHT } from "./constants";
import { useTimelineContext } from "./context";
import { sliderToZoom, zoomToSlider } from "./geometry";
import { timelineCommands } from "./view-store";
import { ClipVolumeButton } from "./volume-control";

const ZOOM_STEP = 1.5;
const SLIDER_MAX = 1000;

export function TimelineToolbar() {
  const ctx = useTimelineContext();
  const hasClips = useEditor((s) => s.project.clips.length > 0);
  const selected = useEditor((s) => s.selectedClipIds.length);
  const snapping = useEditor((s) => s.snapping);
  const zoom = useEditor((s) => s.zoom);

  const editor = useEditor.getState;

  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b px-2"
      style={{ height: TOOLBAR_HEIGHT }}
    >
      <ToolButton label="Split at playhead" shortcut={SHORTCUT_KEYS.split} disabled={!hasClips} onClick={() => editor().splitAtPlayhead()}>
        <PiScissors />
      </ToolButton>
      <ToolButton
        label={selected > 1 ? `Delete ${selected} clips` : "Delete clip"}
        shortcut={SHORTCUT_KEYS.delete}
        hint={`${SHORTCUT_KEYS.rippleDelete} closes the gap`}
        disabled={selected === 0}
        onClick={() => editor().deleteSelected()}
      >
        <PiTrash />
      </ToolButton>

      <ClipVolumeButton />

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
        <TooltipContent side="top" className="flex max-w-60 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            Snapping {snapping ? "on" : "off"}
            <Kbd>{SHORTCUT_KEYS.toggleSnapping}</Kbd>
          </span>
          <span className="text-muted-foreground">Clip edges stick to other clips, the playhead and the start.</span>
        </TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Add track"
                className="px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <PiPlus />
                <span>Track</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-60">
            Add a track. You can also drag a clip above the top track or below the bottom one.
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => editor().commit((p) => addTrack(p, "video").project)}>
            <PiFilmStrip /> Video track
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor().commit((p) => addTrack(p, "audio").project)}>
            <PiMusicNotes /> Audio track
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-1">
        <ToolButton label="Zoom out" shortcut={SHORTCUT_KEYS.zoomOut} hint="or ⌘/Ctrl + scroll" disabled={zoom <= MIN_ZOOM} onClick={() => ctx.zoomTo(zoom / ZOOM_STEP)}>
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
        <ToolButton label="Zoom in" shortcut={SHORTCUT_KEYS.zoomIn} hint="or ⌘/Ctrl + scroll" disabled={zoom >= MAX_ZOOM} onClick={() => ctx.zoomTo(zoom * ZOOM_STEP)}>
          <PiMagnifyingGlassPlus />
        </ToolButton>
        <ToolButton label="Zoom to fit" shortcut={SHORTCUT_KEYS.zoomFit} disabled={!hasClips} onClick={() => timelineCommands.zoomToFit()}>
          <PiArrowsOutSimple />
        </ToolButton>
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
        <ToolButton label="Keyboard shortcuts" shortcut={SHORTCUT_KEYS.showShortcuts} onClick={() => useLayout.getState().setShortcutsOpen(true)}>
          <PiKeyboard />
        </ToolButton>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">
      {children}
    </kbd>
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
        {shortcut && <Kbd>{shortcut}</Kbd>}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
