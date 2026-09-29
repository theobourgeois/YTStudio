import { useEffect, useRef } from "react";
import { PiSpeakerHigh, PiSpeakerLow, PiSpeakerSlash } from "react-icons/pi";
import type { Project } from "@shared/types";
import { getClip, updateClip } from "@shared/timeline";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "@/stores/editor";

/** Toolbar button: the selected clip's volume, in a popover. Needs exactly one selected clip. */
export function ClipVolumeButton() {
  const clip = useEditor((s) => (s.selectedClipIds.length === 1 ? getClip(s.project, s.selectedClipIds[0]) : undefined));
  const Icon = !clip || clip.volume >= 0.5 ? PiSpeakerHigh : clip.volume === 0 ? PiSpeakerSlash : PiSpeakerLow;
  const contentRef = useRef<HTMLDivElement>(null);
  const label = clip ? `Clip volume (${Math.round(clip.volume * 100)}%)` : "Clip volume — select one clip";
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Wrapper keeps the tooltip working while the button is disabled. */}
          <span className="inline-flex">
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clip volume"
                disabled={!clip}
                className="text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
              >
                <Icon />
              </Button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        ref={contentRef}
        side="top"
        align="start"
        className="w-64 py-2 pr-3 pl-2.5"
        // Focus the slider (arrow keys adjust it), not the mute button, whose tooltip would pop up.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current?.querySelector<HTMLElement>("[role=slider]")?.focus();
        }}
      >
        {clip && <VolumeControl clipId={clip.id} volume={clip.volume} />}
      </PopoverContent>
    </Popover>
  );
}

const withVolume = (clipId: string, volume: number) => (p: Project) =>
  getClip(p, clipId)?.volume === volume ? p : updateClip(p, clipId, { volume });

/**
 * Volume slider. A pointer drag is one gesture (live preview, one undo step);
 * keyboard changes commit directly.
 */
export function VolumeControl({ clipId, volume }: { clipId: string; volume: number }) {
  /** Id of the gesture this slider drag owns, or null when not dragging. */
  const gesture = useRef<number | null>(null);
  /** Volume to restore when un-muting. */
  const restore = useRef(1);
  const percent = Math.round(volume * 100);

  const setVolume = (v: number) => {
    const editor = useEditor.getState();
    const ownsGesture = gesture.current !== null && editor.gestureId === gesture.current && editor.gestureBase;
    if (ownsGesture) editor.preview(withVolume(clipId, v));
    else editor.commit(withVolume(clipId, v));
  };
  const endDrag = () => {
    if (gesture.current === null) return;
    useEditor.getState().endGesture(gesture.current);
    gesture.current = null;
  };
  // Never leave a gesture open if the inspector unmounts mid-drag.
  useEffect(() => endDrag, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleMute = () => {
    if (volume > 0) {
      restore.current = volume;
      setVolume(0);
    } else {
      setVolume(restore.current);
    }
  };

  const Icon = volume === 0 ? PiSpeakerSlash : volume < 0.5 ? PiSpeakerLow : PiSpeakerHigh;
  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label={volume === 0 ? "Unmute clip" : "Mute clip"}
            onClick={toggleMute}
          >
            <Icon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{volume === 0 ? "Unmute" : "Mute"}</TooltipContent>
      </Tooltip>
      <Slider
        aria-label="Volume"
        min={0}
        max={100}
        step={1}
        value={[percent]}
        onPointerDown={(e) => {
          // Radix only captures (and later releases) the pointer for the primary button.
          if (e.button !== 0) return;
          gesture.current = useEditor.getState().beginGesture();
        }}
        onPointerUp={endDrag}
        onLostPointerCapture={endDrag}
        onValueChange={([v]) => setVolume(v / 100)}
      />
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{percent}%</span>
    </div>
  );
}
