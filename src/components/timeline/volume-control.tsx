import { useEffect, useRef, useState } from "react";
import { PiSpeakerHigh, PiSpeakerLow, PiSpeakerSlash } from "react-icons/pi";
import { keyframeTime } from "@shared/animation";
import { VOLUME, hasKeyframes, isTextClip, setParams, volumeAt } from "@shared/effects";
import { getClip, sourceTime } from "@shared/timeline";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EditGesture } from "@/lib/edit-gesture";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";

/** Toolbar button: the selected clip's volume, in a popover. Needs exactly one selected clip. */
export function ClipVolumeButton() {
  const selected = useEditor((s) => (s.selectedClipIds.length === 1 ? getClip(s.project, s.selectedClipIds[0]) : undefined));
  // Text has no sound.
  const clip = selected && !isTextClip(selected) ? selected : undefined;
  // Source time the level is read and set at; it only matters (and follows the playhead) once it's keyframed.
  const time = usePlayback((s) => (clip && hasKeyframes(clip) ? sourceTime(clip, s.time) : (clip?.in ?? 0)));
  const volume = clip ? volumeAt(clip, time) : 1;
  const Icon = !clip || volume >= 0.5 ? PiSpeakerHigh : volume === 0 ? PiSpeakerSlash : PiSpeakerLow;
  const contentRef = useRef<HTMLDivElement>(null);
  const label = clip ? `Clip volume (${Math.round(volume * 100)}%)` : "Clip volume — select one clip";
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
        {clip && <VolumeControl clipId={clip.id} volume={volume} time={time} />}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Volume slider. A pointer drag is one gesture (live preview, one undo step);
 * keyboard changes commit directly.
 */
export function VolumeControl({ clipId, volume, time }: { clipId: string; volume: number; time: number }) {
  const [gesture] = useState(() => new EditGesture());
  /** Volume to restore when un-muting. */
  const restore = useRef(1);
  const percent = Math.round(volume * 100);

  // An animated level is keyframed at the frame under the playhead (or a keyframe right next to it).
  const editTime = () => {
    const { project } = useEditor.getState();
    const clip = getClip(project, clipId);
    return clip ? keyframeTime(clip, usePlayback.getState().time, project.settings.fps) : time;
  };
  const setVolume = (v: number) => gesture.apply((p) => setParams(p, clipId, VOLUME.type, { level: v }, editTime()));
  const endDrag = () => gesture.end();
  // Never leave a gesture open if the popover closes mid-drag.
  useEffect(() => () => gesture.end(), [gesture]);
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
          gesture.begin();
        }}
        onPointerUp={endDrag}
        onLostPointerCapture={endDrag}
        onValueChange={([v]) => setVolume(v / 100)}
      />
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{percent}%</span>
    </div>
  );
}
