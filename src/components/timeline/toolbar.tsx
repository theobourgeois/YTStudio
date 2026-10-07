import type { ReactNode } from "react";
import {
  PiArrowsOutSimple,
  PiCircleHalfTilt,
  PiFilmStrip,
  PiKeyboard,
  PiLink,
  PiMagnet,
  PiMagnifyingGlassMinus,
  PiMagnifyingGlassPlus,
  PiMusicNotes,
  PiPlus,
  PiScissors,
  PiPolygon,
  PiSquare,
  PiStack,
  PiVideoCamera,
  PiSubtitles,
  PiTrash,
  PiCrosshairSimple,
  PiWaveform,
} from "react-icons/pi";
import { type LayerKind, addTrack } from "@shared/timeline";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { cn } from "cn";
import { useCaptions } from "@/stores/captions";
import { useSignalView } from "@/stores/signal-view";
import { MAX_ZOOM, useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { TOOLBAR_HEIGHT } from "./constants";
import { useTimelineContext } from "./context";
import { sliderToZoom, zoomToSlider } from "./geometry";
import { timelineCommands, useMinZoom } from "./view-store";
import { ClipSpeedButton } from "./speed-control";
import { ClipVolumeButton } from "./volume-control";
import { RenderControl } from "./render-control";
import { showPanel } from "@/stores/video-dock";

const ZOOM_STEP = 1.5;
const SLIDER_MAX = 1000;

export function TimelineToolbar() {
  const ctx = useTimelineContext();
  const hasClips = useEditor((s) => s.project.clips.length > 0);
  const selected = useEditor((s) => s.selectedClipIds.length);
  const gapSelected = useEditor((s) => s.selectedGap !== null);
  const snapping = useEditor((s) => s.snapping);
  const autoRipple = useEditor((s) => s.autoRipple);
  const zoom = useEditor((s) => s.zoom);
  const minZoom = useMinZoom();
  const hasSound = useEditor((s) => s.project.clips.some((c) => s.assets.find((a) => a.id === c.assetId)?.hasAudio));

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
        label={gapSelected ? "Close gap" : selected > 1 ? `Delete ${selected} clips` : "Delete clip"}
        shortcut={SHORTCUT_KEYS.delete}
        hint={gapSelected ? undefined : autoRipple ? "Auto ripple closes the gap" : `${SHORTCUT_KEYS.rippleDelete} closes the gap`}
        disabled={selected === 0 && !gapSelected}
        onClick={() => editor().deleteSelected()}
      >
        <PiTrash />
      </ToolButton>

      <ClipVolumeButton />
      <ClipSpeedButton />

      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            aria-label="Snapping"
            pressed={snapping}
            onPressedChange={() => editor().toggleSnapping()}
            // The tooltip trigger replaces the toggle's data-state with its own, so style off aria-pressed.
            className="size-8 min-w-8 text-muted-foreground aria-pressed:bg-brand/15 aria-pressed:text-brand hover:aria-pressed:bg-brand/20 hover:aria-pressed:text-brand"
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

      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            aria-label="Auto ripple"
            pressed={autoRipple}
            onPressedChange={() => editor().toggleAutoRipple()}
            className="size-8 min-w-8 text-muted-foreground aria-pressed:bg-brand/15 aria-pressed:text-brand hover:aria-pressed:bg-brand/20 hover:aria-pressed:text-brand"
          >
            <PiLink />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex max-w-60 flex-col gap-0.5">
          <span>Auto ripple {autoRipple ? "on" : "off"}</span>
          <span className="text-muted-foreground">
            Deleting or trimming a clip moves the clips after it on its track to keep them joined, and media dropped
            onto a track pushes them along.
          </span>
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

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="New layer"
                className="px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <PiStack />
                <span>Layer</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64">
            Add an adjustment layer (its effects change everything below it), a solid (a colour for effects to draw on),
            a shape layer (vector shapes, drawn with the Pen, Rectangle and Ellipse tools too), a camera (3D layers are
            seen through it), a null object (clips parented to it follow its Motion) or a visualizer (spectrum bars
            that move with the song; the Effects tab's Audio category has more).
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={() => newLayer("adjustment")}>
            <PiCircleHalfTilt /> Adjustment layer
            <DropdownMenuShortcut>{SHORTCUT_KEYS.newAdjustmentLayer}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => newLayer("solid")}>
            <PiSquare /> Solid
            <DropdownMenuShortcut>{SHORTCUT_KEYS.newSolid}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => newLayer("shape")}>
            <PiPolygon /> Shape layer
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => newLayer("camera")}>
            <PiVideoCamera /> Camera
            <DropdownMenuShortcut>{SHORTCUT_KEYS.newCamera}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => newLayer("null")}>
            <PiCrosshairSimple /> Null object
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => newLayer("visualizer")}>
            <PiWaveform /> Visualizer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ToolButton
        label="Auto captions"
        hint="Turn the speech in your clips into captions"
        wide
        disabled={!hasSound}
        onClick={() => useCaptions.getState().openDialog()}
        className="px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <PiSubtitles />
        <span>Captions</span>
      </ToolButton>

      <ToolButton
        label="Signals"
        hint="Sounds of your own to react to: a band of the song, or hits you place"
        wide
        onClick={() => useSignalView.getState().show()}
        className="px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <PiWaveform />
        <span>Signals</span>
      </ToolButton>

      <div className="ml-auto flex items-center gap-1">
        <RenderControl />
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
        <ToolButton label="Zoom out" shortcut={SHORTCUT_KEYS.zoomOut} hint="or ⌘/Ctrl + scroll" disabled={zoom <= minZoom} onClick={() => ctx.zoomTo(zoom / ZOOM_STEP)}>
          <PiMagnifyingGlassMinus />
        </ToolButton>
        <Slider
          aria-label="Zoom"
          className="w-28 [&_[data-slot=slider-thumb]]:size-3.5"
          min={0}
          max={SLIDER_MAX}
          step={5}
          value={[Math.round(zoomToSlider(zoom, minZoom, MAX_ZOOM) * SLIDER_MAX)]}
          onValueChange={([v]) => ctx.zoomTo(sliderToZoom(v / SLIDER_MAX, minZoom, MAX_ZOOM))}
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

/** Add a layer over the selection (or at the playhead) and show its properties. */
function newLayer(kind: LayerKind) {
  useEditor.getState().addLayer(kind);
  showPanel("properties");
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
