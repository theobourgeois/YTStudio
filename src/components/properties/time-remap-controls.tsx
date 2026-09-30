/**
 * Time Remapping in the Speed section (Premiere's speed keyframes, After Effects' Time
 * Remap): a switch that turns it on (two keyframes that change nothing), then a speed per
 * stretch between its keyframes (a velocity edit), a freeze frame and a section played
 * backwards at the playhead. Its Source Time keyframes, and their ramps in the graph editor,
 * are in the Time Remapping section below.
 */
import { useRef } from "react";
import { PiArrowCounterClockwise, PiPause } from "react-icons/pi";
import { remapKeys } from "@shared/effects";
import { formatTime } from "@shared/format";
import { MAX_REMAP_SPEED, MIN_REMAP_SPEED, addFreezeFrame, addReverseSection, remapSegments, setSegmentSpeed, setTimeRemap } from "@shared/time-remap";
import { clipEnd, getClip } from "@shared/timeline";
import type { Clip } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EditGesture } from "@/lib/edit-gesture";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { ScrubNumber } from "./scrub-number";

const editor = useEditor.getState;
/** How long a freeze frame lasts when added (seconds). */
const FREEZE_LENGTH = 1;

/** The media's length for each clip (a nested sequence's is its sequence's). */
const durations = (ids: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, editor().getAsset(getClip(editor().project, id)?.assetId ?? "")?.duration ?? Infinity]));

export function TimeRemapSwitch({ clipIds, clip }: { clipIds: string[]; clip: Clip }) {
  const on = !!remapKeys(clip);
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span>
        <span className="font-medium text-foreground">Time Remapping</span>
        <span className="block text-muted-foreground">Keyframe the speed: ramps, freezes, reverses.</span>
      </span>
      <Switch
        aria-label="Time Remapping"
        checked={on}
        onCheckedChange={(checked) => editor().commit((p) => setTimeRemap(p, clipIds, checked, durations(clipIds)))}
      />
    </label>
  );
}

/** A remapped clip's stretches with their speeds, and the freeze and reverse actions. */
export function RemapControls({ clip }: { clip: Clip }) {
  const segments = remapSegments(clip);
  const playhead = usePlayback((s) => s.time);
  const inside = playhead >= clip.start - 1e-6 && playhead <= clipEnd(clip) + 1e-6;
  const around = segments.find((s) => playhead >= s.start - 1e-6 && playhead < s.end - 1e-6);
  return (
    <div className="grid gap-2 pt-2">
      <div className="grid gap-0.5" role="list" aria-label="Speed by stretch">
        {segments.map((seg) => (
          <SegmentRow key={seg.index} clipId={clip.id} seg={seg} clipStart={clip.start} />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={!inside}
          title="Hold the frame at the playhead for a second, then play on"
          onClick={() => editor().commit((p) => addFreezeFrame(p, clip.id, usePlayback.getState().time, FREEZE_LENGTH))}
        >
          <PiPause /> Freeze frame
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={!around || around.speed === 0}
          title="Play the stretch under the playhead backwards, then forwards again"
          onClick={() => around && editor().commit((p) => addReverseSection(p, clip.id, around.start, around.end))}
        >
          <PiArrowCounterClockwise /> Reverse section
        </Button>
      </div>
    </div>
  );
}

function SegmentRow({ clipId, seg, clipStart }: { clipId: string; seg: ReturnType<typeof remapSegments>[number]; clipStart: number }) {
  const frozen = seg.speed === 0;
  const backwards = seg.speed < 0;
  // One gesture for a whole scrub (the row re-renders as the speed changes).
  const gesture = useRef(new EditGesture()).current;
  return (
    <div role="listitem" className="grid grid-cols-[1fr_auto] items-center gap-2 rounded px-1 text-xs hover:bg-accent/40" data-remap-segment={seg.index}>
      <button
        type="button"
        className="cursor-pointer truncate text-left text-muted-foreground tabular-nums hover:text-foreground"
        title="Go to this stretch"
        onClick={() => usePlayback.getState().seek(seg.start)}
      >
        {formatTime(seg.start - clipStart)}–{formatTime(seg.end - clipStart)}
        {backwards && " · backwards"}
      </button>
      {frozen ? (
        <span className="px-1 text-muted-foreground">Freeze</span>
      ) : (
        <span className="w-16 text-right">
          <ScrubNumber
            value={Math.round(Math.abs(seg.speed) * 1000) / 10}
            display={{ min: MIN_REMAP_SPEED * 100, max: MAX_REMAP_SPEED * 100, step: 1, decimals: 0, unit: "%" }}
            label={`Speed from ${formatTime(seg.start - clipStart)}`}
            onBegin={() => gesture.begin()}
            onChange={(v) => gesture.apply((p) => setSegmentSpeed(editor().gestureBase ?? p, clipId, seg.index, v / 100))}
            onEnd={() => gesture.end()}
          />
        </span>
      )}
    </div>
  );
}
