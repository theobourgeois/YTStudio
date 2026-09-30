import type { ReactNode } from "react";
import {
  PiCaretLineLeft,
  PiCaretLineRight,
  PiCursor,
  PiPauseFill,
  PiPlayFill,
  PiSkipBack,
  PiSkipForward,
  PiTextT,
} from "react-icons/pi";
import { formatTime } from "@shared/format";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { type CanvasTool, PREVIEW_RESOLUTIONS, useLayout } from "@/stores/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePlayback } from "@/stores/playback";

/** Pause and move the playhead by whole frames, landing on the frame grid. */
function stepFrames(delta: number) {
  const fps = useEditor.getState().project.settings.fps;
  const playback = usePlayback.getState();
  playback.pause();
  playback.seek((Math.round(playback.time * fps) + delta) / fps);
}

export function Transport() {
  const empty = usePlayback((s) => s.duration <= 0);
  const playing = usePlayback((s) => s.playing);

  return (
    <div className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-4">
      <TimeReadout />
      <div className="flex items-center gap-1">
        <TransportButton
          label="Go to start"
          shortcut="Home"
          disabled={empty}
          onClick={() => usePlayback.getState().seek(0)}
        >
          <PiCaretLineLeft />
        </TransportButton>
        <TransportButton label="Previous frame" shortcut="←" disabled={empty} onClick={() => stepFrames(-1)}>
          <PiSkipBack />
        </TransportButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              className="mx-1.5 size-9 rounded-full bg-foreground text-background inset-shadow-none hover:bg-foreground/85"
              disabled={empty}
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => usePlayback.getState().toggle()}
            >
              {playing ? <PiPauseFill /> : <PiPlayFill />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <ShortcutHint label={playing ? "Pause" : "Play"} shortcut="Space" />
          </TooltipContent>
        </Tooltip>
        <TransportButton label="Next frame" shortcut="→" disabled={empty} onClick={() => stepFrames(1)}>
          <PiSkipForward />
        </TransportButton>
        <TransportButton
          label="Go to end"
          shortcut="End"
          disabled={empty}
          onClick={() => {
            const playback = usePlayback.getState();
            playback.pause();
            playback.seek(playback.duration);
          }}
        >
          <PiCaretLineRight />
        </TransportButton>
      </div>
      <div className="flex items-center gap-1.5 justify-self-end">
        <ResolutionPicker />
        <CanvasTools />
      </div>
    </div>
  );
}

const RESOLUTION_LABELS: Record<number, string> = { 1: "Full", 0.5: "1/2", 0.25: "1/4" };

/** Premiere's Playback Resolution: drawing fewer pixels keeps heavy edits (nests, effects) playing smoothly. */
function ResolutionPicker() {
  const resolution = useLayout((s) => s.previewResolution);
  return (
    <Select value={String(resolution)} onValueChange={(v) => useLayout.getState().setPreviewResolution(Number(v))}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger size="sm" aria-label="Preview resolution" className="h-7! w-auto gap-1 rounded-md border-none bg-muted px-2 text-xs shadow-none">
            <SelectValue />
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>Preview resolution (the export is always full)</TooltipContent>
      </Tooltip>
      <SelectContent position="popper" align="end">
        {PREVIEW_RESOLUTIONS.map((r) => (
          <SelectItem key={r} value={String(r)} className="text-xs">
            {RESOLUTION_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The canvas tools, like Premiere's Selection and Type tools. */
function CanvasTools() {
  const tool = useLayout((s) => s.tool);
  const tools: { id: CanvasTool; label: string; shortcut: string; icon: ReactNode }[] = [
    { id: "select", label: "Selection tool", shortcut: SHORTCUT_KEYS.selectTool, icon: <PiCursor /> },
    { id: "text", label: "Type tool: click the canvas to add text", shortcut: SHORTCUT_KEYS.textTool, icon: <PiTextT /> },
  ];
  return (
    <div role="toolbar" aria-label="Canvas tools" className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
      {tools.map((t) => (
        <Tooltip key={t.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t.label}
              aria-pressed={tool === t.id}
              onClick={() => useLayout.getState().setTool(t.id)}
              className={cn(
                "grid size-6 cursor-pointer place-items-center rounded-[5px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
                tool === t.id && "bg-background text-foreground shadow-xs dark:bg-accent",
              )}
            >
              {t.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <ShortcutHint label={t.label} shortcut={t.shortcut} />
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/** Only this re-renders while the clock runs. */
function TimeReadout() {
  const time = usePlayback((s) => formatTime(s.time));
  const duration = usePlayback((s) => formatTime(s.duration));
  return (
    <div className="font-mono text-xs tabular-nums">
      <span className="text-foreground">{time}</span>
      <span className="px-1.5 text-muted-foreground/60">/</span>
      <span className="text-muted-foreground">{duration}</span>
    </div>
  );
}

export function TransportButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          disabled={disabled}
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <ShortcutHint label={label} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}

export function ShortcutHint({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      <kbd className="rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">
        {shortcut}
      </kbd>
    </span>
  );
}
