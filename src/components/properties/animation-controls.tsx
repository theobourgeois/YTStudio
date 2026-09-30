/**
 * Premiere's animation controls for one property: the stopwatch (animate or
 * not) before its name, and the keyframe navigator (previous, add/remove at
 * the playhead, next) after its value while it's animated.
 */
import { PiCaretLeft, PiCaretRight, PiDiamond, PiDiamondFill, PiTimer, PiTimerFill } from "react-icons/pi";
import { adjacentKeyframe, keyframeTime, setAnimated, toggleKeyframe } from "@shared/animation";
import { keyframeAt } from "@shared/keyframes";
import { getClip } from "@shared/timeline";
import type { Clip } from "@shared/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";

interface Target {
  clipId: string;
  effectId: string;
  paramKey: string;
  label: string;
}

const editor = useEditor.getState;

/** The clip as it is now, and where an edit at the playhead lands (source time). */
function now(clipId: string): { clip: Clip; time: number; playhead: number; fps: number } | null {
  const { project } = editor();
  const clip = getClip(project, clipId);
  if (!clip) return null;
  const playhead = usePlayback.getState().time;
  const fps = project.settings.fps;
  return { clip, playhead, fps, time: keyframeTime(clip, playhead, fps) };
}

export function Stopwatch({
  clipId,
  effectId,
  paramKey,
  label,
  animated,
  onAltClick,
}: Target & { animated: boolean; /** ⌥-click (After Effects: add or remove the property's expression). */ onAltClick?: () => void }) {
  const toggle = (e: React.MouseEvent) => {
    if (e.altKey && onAltClick) return onAltClick();
    const at = now(clipId);
    if (at) editor().commit((p) => setAnimated(p, clipId, effectId, paramKey, at.time, !animated));
  };
  const Icon = animated ? PiTimerFill : PiTimer;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Animate ${label}`}
          aria-pressed={animated}
          onClick={toggle}
          className={cn(
            "grid size-5 cursor-pointer place-items-center rounded transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
            animated ? "text-brand" : "text-muted-foreground/70 hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {animated ? `Stop animating ${label} (removes its keyframes)` : `Animate ${label}`}
        {onAltClick && <span className="block text-muted-foreground">⌥-click: add or remove an expression</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** ◀ ◆ ▶ for an animated property. */
export function KeyframeNavigator({ clipId, effectId, paramKey, label }: Target) {
  const only = { effectId, key: paramKey };
  const clip = useEditor((s) => getClip(s.project, clipId));
  const fps = useEditor((s) => s.project.settings.fps);
  const playhead = usePlayback((s) => s.time);
  const keys = clip?.effects.find((e) => e.id === effectId)?.keyframes?.[paramKey];
  if (!clip || !keys) return null;
  // An edit here would land on (or replace) one of its keyframes.
  const on = !!keyframeAt(keys, keyframeTime(clip, playhead, fps));
  const prev = adjacentKeyframe(clip, playhead, -1, fps, only);
  const next = adjacentKeyframe(clip, playhead, 1, fps, only);
  const seek = (t: number | null) => t !== null && usePlayback.getState().seek(t);
  const toggle = () => {
    const at = now(clipId);
    if (at) editor().commit((p) => toggleKeyframe(p, clipId, effectId, paramKey, at.time));
  };

  return (
    <div className="flex items-center" role="group" aria-label={`${label} keyframe navigator`}>
      <NavButton label={`Previous ${label} keyframe`} disabled={prev === null} onClick={() => seek(prev)}>
        <PiCaretLeft className="size-3" />
      </NavButton>
      <NavButton label={on ? `Remove ${label} keyframe` : `Add ${label} keyframe`} pressed={on} onClick={toggle}>
        {on ? <PiDiamondFill className="size-3 text-brand" /> : <PiDiamond className="size-3" />}
      </NavButton>
      <NavButton label={`Next ${label} keyframe`} disabled={next === null} onClick={() => seek(next)}>
        <PiCaretRight className="size-3" />
      </NavButton>
    </div>
  );
}

function NavButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="grid h-5 w-4.5 cursor-pointer place-items-center rounded text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
