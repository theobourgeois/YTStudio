import type { ReactNode } from "react";
import { PiCaretLineLeft, PiCaretLineRight, PiPauseFill, PiPlayFill, PiSkipBack, PiSkipForward } from "react-icons/pi";
import { formatTime } from "@shared/format";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "@/stores/editor";
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

function TransportButton({
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

function ShortcutHint({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      <kbd className="rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">
        {shortcut}
      </kbd>
    </span>
  );
}
