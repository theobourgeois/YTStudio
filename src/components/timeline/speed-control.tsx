/**
 * Clip speed, like Premiere's Speed/Duration dialog (⌘R) made simple: a
 * speed (presets, a slider or typed), the length it gives, Reverse and Keep
 * pitch. It changes every selected video or sound clip; the clips after each
 * one on its track move with its end (Premiere's Ripple Edit), so nothing
 * overlaps and no gap opens.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { PiArrowCounterClockwise, PiGauge, PiWaveform } from "react-icons/pi";
import type { Clip, MediaAsset, Project } from "@shared/types";
import { formatSpeed, formatTime, parseSpeed } from "@shared/format";
import {
  MAX_SPEED,
  MIN_SPEED,
  type SpeedChange,
  canRetime,
  clampSpeed,
  clipDuration,
  clipSpeed,
  clipsById,
  setClipSpeed,
} from "@shared/timeline";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IS_MAC, SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { EditGesture } from "@/lib/edit-gesture";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";

/** The speeds offered as one-click presets. */
export const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2, 4] as const;

const editor = useEditor.getState;

/** Of `ids`, the clips that can play at another speed (videos and sounds, not stills or text). */
export function retimableIds(project: Project, assets: readonly MediaAsset[], ids: readonly string[]): string[] {
  const clips = clipsById(project);
  return ids.filter((id) => {
    const clip = clips.get(id);
    return !!clip && canRetime(clip, assets.find((a) => a.id === clip.assetId));
  });
}

/** The selected clips whose speed can change. */
export function useRetimableSelection(): string[] {
  return useEditor(useShallow((s) => retimableIds(s.project, s.assets, s.selectedClipIds)));
}

/** Change the speed of some clips as one undo step. */
export function commitSpeed(clipIds: readonly string[], change: SpeedChange) {
  if (clipIds.length) editor().commit((p) => setClipSpeed(p, clipIds, change));
}

/** Toolbar button: the selected clips' speed, in a popover (also opened with ⌘R). */
export function ClipSpeedButton() {
  const ids = useRetimableSelection();
  const open = useLayout((s) => s.speedOpen);
  const setOpen = useLayout((s) => s.setSpeedOpen);
  const clip = useEditor((s) => (ids.length ? clipsById(s.project).get(ids.at(-1)!) : undefined));
  const shown = open && !!clip;
  const retimed = !!clip && (clipSpeed(clip) !== 1 || clip.reversed === true);
  const label = clip ? `Speed (${formatSpeed(clipSpeed(clip))}${clip.reversed ? ", reversed" : ""})` : "Speed — select a video or sound clip";
  return (
    <Popover open={shown} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Wrapper keeps the tooltip working while the button is disabled. */}
          <span className="inline-flex">
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Speed"
                disabled={!clip}
                className={cn(
                  "text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
                  retimed && "text-sky-400",
                )}
              >
                <PiGauge />
              </Button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-2">
          <span>{label}</span>
          <kbd className="rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">{SHORTCUT_KEYS.speed}</kbd>
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="start"
        className="w-72 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Opened from the clip's menu (or ⌘R), focus goes back to the timeline: that mustn't close it.
        onFocusOutside={(e) => e.preventDefault()}
      >
        {clip && <SpeedControl clipIds={ids} clip={clip} />}
      </PopoverContent>
    </Popover>
  );
}

/** Slider position (0..1) for a speed, on a log scale so 1× sits in the middle. */
const toSlider = (speed: number) => Math.log(speed / MIN_SPEED) / Math.log(MAX_SPEED / MIN_SPEED);
const fromSlider = (x: number) => {
  const speed = MIN_SPEED * (MAX_SPEED / MIN_SPEED) ** x;
  // Round to steps that read well, and stick to 1× near the middle.
  const rounded = speed < 1 ? Math.round(speed * 100) / 100 : Math.round(speed * 20) / 20;
  return Math.abs(rounded - 1) < 0.04 ? 1 : rounded;
};
const SLIDER_STEPS = 1000;

/**
 * The speed settings of `clip` (the one the values are read from), applied to
 * every clip of `clipIds`.
 */
export function SpeedControl({ clipIds, clip }: { clipIds: readonly string[]; clip: Clip }) {
  const [gesture] = useState(() => new EditGesture());
  // Never leave a gesture open if the control goes away mid-drag.
  useEffect(() => () => gesture.end(), [gesture]);
  const hasSound = useEditor((s) =>
    clipIds.some((id) => s.assets.find((a) => a.id === clipsById(s.project).get(id)?.assetId)?.hasAudio),
  );
  const speed = clipSpeed(clip);
  const reversed = clip.reversed === true;
  const keepPitch = clip.keepPitch !== false;
  const several = clipIds.length > 1;

  const setSpeed = (value: number) => commitSpeed(clipIds, { speed: value });
  const drag = (value: number) =>
    gesture.apply((p) => setClipSpeed(editor().gestureBase ?? p, clipIds, { speed: value }));
  const endDrag = () => gesture.end();

  return (
    <div className="flex flex-col gap-3 text-sm" data-speed-control>
      <div className="flex items-center gap-2">
        <span className="font-medium">Speed</span>
        {several && <span className="text-xs text-muted-foreground">{clipIds.length} clips</span>}
        <SpeedInput speed={speed} onChange={setSpeed} clip={clip} />
      </div>
      <Slider
        aria-label="Speed"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={[Math.round(toSlider(speed) * SLIDER_STEPS)]}
        onPointerDown={(e) => {
          // Radix only captures (and later releases) the pointer for the primary button.
          if (e.button !== 0) return;
          gesture.begin();
        }}
        onPointerUp={endDrag}
        onLostPointerCapture={endDrag}
        onValueChange={([v]) => drag(fromSlider(v / SLIDER_STEPS))}
      />
      <div className="grid grid-cols-6 gap-1" role="group" aria-label="Speed presets">
        {SPEED_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={Math.abs(speed - preset) < 1e-6}
            onClick={() => setSpeed(preset)}
            className="h-7 cursor-pointer rounded-md text-xs tabular-nums text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-brand/15 aria-pressed:font-medium aria-pressed:text-brand"
          >
            {formatSpeed(preset)}
          </button>
        ))}
      </div>
      <p className="-mt-1 text-xs text-muted-foreground tabular-nums" data-speed-duration>
        {several ? "Each clip keeps its media; " : ""}
        {!several && <>Lasts {formatTime(clipDuration(clip))} · </>}
        clips after it on the track move with its end.
      </p>
      <div className="flex flex-col gap-2 border-t pt-3">
        <SwitchRow
          icon={<PiArrowCounterClockwise />}
          label="Reverse"
          hint="Play backwards"
          checked={reversed}
          onChange={(on) => commitSpeed(clipIds, { reversed: on })}
        />
        {hasSound && (
          <SwitchRow
            icon={<PiWaveform />}
            label="Keep pitch"
            hint={keepPitch ? "Voices sound natural at any speed" : "Faster sounds higher, slower lower"}
            checked={keepPitch}
            onChange={(on) => commitSpeed(clipIds, { keepPitch: on })}
          />
        )}
      </div>
      <p className="border-t pt-2.5 text-xs text-muted-foreground">
        Tip: hold <kbd className="font-sans">{IS_MAC ? "⌥" : "Alt"}</kbd> while dragging a clip's edge to stretch
        its speed to fit.
      </p>
    </div>
  );
}

/** The speed as text ("2×"); type a new one ("2", "0.5x", "50%") and press Enter. */
function SpeedInput({ speed, clip, onChange }: { speed: number; clip: Clip; onChange: (speed: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const apply = () => {
    if (draft === null) return;
    const parsed = parseSpeed(draft);
    setDraft(null);
    if (parsed !== null) onChange(clampSpeed(clip, parsed));
  };
  return (
    <input
      ref={ref}
      aria-label="Speed value"
      value={draft ?? formatSpeed(speed)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          apply();
          ref.current?.blur();
        } else if (e.key === "Escape") {
          setDraft(null);
          ref.current?.blur();
          e.stopPropagation();
        }
      }}
      className="ml-auto h-7 w-16 rounded-md border border-input bg-card px-2 text-right text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-white/[0.07] dark:bg-muted"
    />
  );
}

function SwitchRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-4 font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
