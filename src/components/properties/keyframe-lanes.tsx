/**
 * The Effect Controls' timeline view (Premiere): next to each property, a
 * lane spanning the selected clip with its keyframes, under a ruler that
 * scrubs the playhead. Keyframes are selected by clicking (Shift/⌘ to add)
 * or by dragging a box, dragged in time (snapping to the playhead, other
 * keyframes and frames; ⌥-dragging the first or last of several stretches
 * them), given an interpolation from their right-click menu, copied and pasted
 * (⌘C / ⌘V: at the playhead, or onto another property from its lane's menu)
 * and deleted with ⌫. An effect's own row sums up its keyframes.
 */
import { LinkedCurve } from "./linked-curve";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PiArrowsOutLineHorizontal, PiClipboardText, PiCopy, PiLineSegments, PiTrash, PiWaveSine } from "react-icons/pi";
import {
  type KeyframeRef,
  clipKeyframes,
  deleteKeyframes,
  keyframeTime,
  keyframeTimes,
  moveKeyframes,
  roveKeyframes,
  sameRef,
  scaleKeyframes,
  smoothMotionPath,
  setKeyframeEasing,
  setKeyframeInfluence,
  timelineTime,
} from "@shared/animation";
import { easesIn, easesOut, influenceOf, isDynamic } from "@shared/keyframes";
import { allMarkers } from "@shared/markers";
import { tidy } from "@shared/math";
import { clipEnd, getClip, sourceDelta } from "@shared/timeline";
import type { Clip, Easing, Keyframe } from "@shared/types";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { EditGesture } from "@/lib/edit-gesture";
import { startPointerDrag } from "@/lib/pointer-drag";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { type LaneRange, clampDelta, laneLeft, laneTicks, pxPerSecond, snapTime, timeAtX } from "./keyframe-geometry";
import { copySelectedKeyframes, pasteCopiedKeyframes, selectedKeyframes, useKeyframeSelection } from "./keyframe-selection";

const editor = useEditor.getState;
/** Pointer distance (px) within which a dragged keyframe snaps. */
const SNAP_PX = 6;

export const laneRange = (clip: Clip): LaneRange => ({ start: clip.start, end: clipEnd(clip) });

/** The interpolations offered, Premiere's names first. */
export const EASING_LABELS: { value: Easing; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "ease-in", label: "Ease In" },
  { value: "ease-out", label: "Ease Out" },
  { value: "ease", label: "Ease In and Out" },
  { value: "hold", label: "Hold" },
  { value: "overshoot", label: "Overshoot" },
  { value: "spring", label: "Spring" },
  { value: "bounce", label: "Bounce" },
];

/**
 * How far eased keyframes' handles reach (After Effects' velocity influence): Premiere's
 * ease, then snappier curves that hang near the keyframes and whip across in between.
 */
export const INFLUENCES: { value: number; label: string }[] = [
  { value: 1 / 3, label: "33% (Premiere)" },
  { value: 0.5, label: "50%" },
  { value: 0.75, label: "75% (Smooth)" },
  { value: 0.9, label: "90% (Snappy)" },
  { value: 1, label: "100% (Whip)" },
];

/** The refs a diamond stands for, stored on its element (for box selection and the menu). */
const refsOf = (el: Element): KeyframeRef[] => JSON.parse((el as HTMLElement).dataset.refs ?? "[]");

/** The keyframes currently selected on `clipId`, kept in step with the project. */
function useSelected(clip: Clip): KeyframeRef[] {
  const selection = useKeyframeSelection((s) => (s.clipId === clip.id ? s.refs : null));
  return selection ? selectedKeyframes(clip) : [];
}

// ---------------------------------------------------------------------------
// The wrapper: context menu, playhead line
// ---------------------------------------------------------------------------

/**
 * Wraps the Properties content while the lanes are shown: right-clicking a
 * keyframe opens its menu, and a playhead line runs down the lanes' column
 * (which starts `offset` from the left).
 */
export function KeyframesRoot({ clip, offset, children }: { clip: Clip; offset: string; children: ReactNode }) {
  const [menuRefs, setMenuRefs] = useState<KeyframeRef[]>([]);
  // A lane's own menu (right-clicking its empty part): the property to paste onto.
  const [menuLane, setMenuLane] = useState<{ effectId: string; key: string; label: string } | null>(null);
  // Keyframes that aren't on screen can't stay selected (⌫ would delete them unseen).
  useEffect(() => () => useKeyframeSelection.getState().clear(), []);

  const onContextMenu = (e: React.MouseEvent) => {
    const diamond = (e.target as Element).closest("[data-refs]");
    const lane = (e.target as Element).closest<HTMLElement>("[data-lane-param]");
    if (!diamond && lane && !editor().gestureBase && useKeyframeSelection.getState().clipboard) {
      const [effectId, key] = JSON.parse(lane.dataset.laneParam!) as [string, string];
      setMenuLane({ effectId, key, label: lane.getAttribute("aria-label")?.replace(/ keyframes$/, "") ?? key });
      return;
    }
    if (!diamond || editor().gestureBase) {
      e.preventDefault(); // keeps the menu closed
      return;
    }
    setMenuLane(null);
    const refs = refsOf(diamond);
    const selected = selectedKeyframes(clip);
    // Like a file browser: right-clicking outside the selection selects what's under the pointer.
    const target = refs.every((r) => selected.some((s) => sameRef(s, r))) ? selected : refs;
    if (target === refs) useKeyframeSelection.getState().select(clip.id, refs);
    setMenuRefs(target);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
        <div className="relative" data-keyframes-root>
          {children}
          <PlayheadLine clip={clip} offset={offset} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {menuLane ? <LaneMenuItems lane={menuLane} /> : <KeyframeMenuItems clip={clip} refs={menuRefs} />}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A lane's menu: paste the copied keyframes onto its property (one property's, of the same kind), first at the playhead. */
function LaneMenuItems({ lane }: { lane: { effectId: string; key: string; label: string } }) {
  const clipboard = useKeyframeSelection((s) => s.clipboard);
  const single = clipboard?.items.length === 1;
  return (
    <>
      <ContextMenuItem disabled={!single} onSelect={() => pasteCopiedKeyframes({ effectId: lane.effectId, key: lane.key })}>
        <PiClipboardText /> Paste onto {lane.label}
      </ContextMenuItem>
      <ContextMenuItem disabled={!clipboard} onSelect={() => pasteCopiedKeyframes()}>
        <PiClipboardText /> Paste at the playhead
        <ContextMenuShortcut>{SHORTCUT_KEYS.paste}</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}

function KeyframeMenuItems({ clip, refs }: { clip: Clip; refs: KeyframeRef[] }) {
  const easing = commonEasing(clip, refs);
  const influence = commonInfluence(clip, refs);
  const commit = editor().commit;
  const one = refs.length === 1;
  const keys = keyframesOf(clip, refs);
  // Points travel along a path, which can bend at each keyframe.
  const points = keys.length > 0 && keys.every((k) => Array.isArray(k.value));
  const bent = keys.some((k) => k.spatialIn || k.spatialOut);
  return (
    <>
      <ContextMenuLabel className="text-xs text-muted-foreground">
        {one ? "Keyframe interpolation" : `Interpolation of ${refs.length} keyframes`}
      </ContextMenuLabel>
      <ContextMenuRadioGroup
        value={easing ?? ""}
        onValueChange={(v) => commit((p) => setKeyframeEasing(p, clip.id, refs, v as Easing))}
      >
        {EASING_LABELS.map((e) => (
          <ContextMenuRadioItem key={e.value} value={e.value}>
            <EasingIcon easing={e.value} />
            {e.label}
          </ContextMenuRadioItem>
        ))}
      </ContextMenuRadioGroup>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={easing === "linear" || easing === "hold" || easing === "bounce"}>
          Influence
          <span className="ml-auto pl-2 text-xs text-muted-foreground tabular-nums">
            {influence === null ? "" : `${Math.round(influence * 100)}%`}
          </span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-44">
          <ContextMenuRadioGroup
            value={influence === null ? "" : String(influence)}
            onValueChange={(v) => commit((p) => setKeyframeInfluence(p, clip.id, refs, Number(v)))}
          >
            {INFLUENCES.map((i) => (
              <ContextMenuRadioItem key={i.value} value={String(i.value)}>
                {i.label}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => commit((p) => setKeyframeEasing(p, clip.id, refs, "ease"))}>
        <PiWaveSine /> Easy Ease
        <ContextMenuShortcut>{SHORTCUT_KEYS.easyEase}</ContextMenuShortcut>
      </ContextMenuItem>
      {points && (
        <ContextMenuItem onSelect={() => commit((p) => smoothMotionPath(p, clip.id, refs, !bent))}>
          <PiLineSegments /> {bent ? "Straight path through here" : "Smooth path through here"}
        </ContextMenuItem>
      )}
      <ContextMenuItem disabled={refs.length < 3} onSelect={() => commit((p) => roveKeyframes(p, clip.id, refs))}>
        <PiArrowsOutLineHorizontal /> Rove across time (even speed)
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => copySelectedKeyframes()}>
        <PiCopy /> {one ? "Copy keyframe" : "Copy keyframes"}
        <ContextMenuShortcut>{SHORTCUT_KEYS.copy}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onSelect={() => deleteSelectedKeyframes(clip.id)}>
        <PiTrash /> {one ? "Delete keyframe" : "Delete keyframes"}
        <ContextMenuShortcut>{SHORTCUT_KEYS.delete}</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}

/** The keyframes `refs` stand for. */
function keyframesOf(clip: Clip, refs: KeyframeRef[]): Keyframe[] {
  return refs.flatMap((r) => {
    const k = clip.effects.find((e) => e.id === r.effectId)?.keyframes?.[r.key]?.find((kf) => sameRef(r, { ...r, time: kf.time }));
    return k ? [k] : [];
  });
}

/** The interpolation all of `refs` share, if they do. */
function commonEasing(clip: Clip, refs: KeyframeRef[]): Easing | null {
  const easings = new Set(keyframesOf(clip, refs).map((k) => k.easing));
  return easings.size === 1 ? [...easings][0] : null;
}

/** The influence all of `refs` share (one of `INFLUENCES`), if they do. */
function commonInfluence(clip: Clip, refs: KeyframeRef[]): number | null {
  const values = new Set(keyframesOf(clip, refs).map(influenceOf));
  const [only] = values;
  return values.size === 1 ? (INFLUENCES.find((i) => Math.abs(i.value - only) < 1e-6)?.value ?? null) : null;
}

/** Delete the selected keyframes of `clipId` (a parameter left without any keeps the value at the playhead). */
export function deleteSelectedKeyframes(clipId: string): boolean {
  const { project } = editor();
  const clip = getClip(project, clipId);
  const refs = selectedKeyframes(clip);
  if (!clip || refs.length === 0) return false;
  const time = keyframeTime(clip, usePlayback.getState().time, project.settings.fps);
  editor().commit((p) => deleteKeyframes(p, clipId, refs, time));
  useKeyframeSelection.getState().clear();
  return true;
}

/** The playhead, as a line down the lanes (moved without re-rendering). */
function PlayheadLine({ clip, offset }: { clip: Clip; offset: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const range = laneRange(clip);
  const { start, end } = range;
  useLayoutEffect(() => {
    const place = (t: number) => {
      const el = ref.current;
      if (!el) return;
      const inside = t >= start - 1e-6 && t <= end + 1e-6;
      el.style.display = inside ? "" : "none";
      if (inside) el.style.left = laneLeft({ start, end }, t);
    };
    place(usePlayback.getState().time);
    return usePlayback.subscribe((s) => place(s.time));
  }, [start, end]);
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-[4]" style={{ left: offset }}>
      <div ref={ref} className="absolute inset-y-0 w-px -translate-x-1/2 bg-playhead" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ruler
// ---------------------------------------------------------------------------

/** Time labels over the lanes; pressing or dragging on it moves the playhead (within the clip). */
export function KeyframeRuler({ clip }: { clip: Clip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const range = laneRange(clip);
  const ticks = width > 0 ? laneTicks(range, width) : [];

  const seekTo = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const fps = editor().project.settings.fps;
    const t = Math.round(timeAtX(range, clientX - rect.left, rect.width) * fps) / fps;
    // The clip's last frame, not the first frame after it.
    usePlayback.getState().seek(Math.min(Math.max(t, range.start), range.end - 1 / fps));
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    usePlayback.getState().pause();
    seekTo(e.clientX);
    startPointerDrag(e, { threshold: 0, cursor: "ew-resize", onMove: (ev) => seekTo(ev.clientX) });
  };

  return (
    <div
      ref={ref}
      aria-label="Keyframe ruler"
      className="absolute inset-x-0 bottom-0 h-6 cursor-ew-resize touch-none overflow-hidden select-none"
      onPointerDown={onPointerDown}
    >
      {ticks.map((tick) => (
        <div
          key={tick.time}
          className={cn("absolute bottom-0 w-px", tick.major ? "h-2 bg-muted-foreground/60" : "h-1 bg-muted-foreground/30")}
          style={{ left: laneLeft(range, tick.time) }}
        >
          {tick.label && (
            <span className="absolute bottom-2 left-1 font-mono text-[10px] leading-none whitespace-nowrap text-muted-foreground tabular-nums">
              {tick.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

/** A property's keyframes. */
export function ParamLane({ clip, effectId, paramKey, label }: { clip: Clip; effectId: string; paramKey: string; label: string }) {
  const keys = clip.effects.find((e) => e.id === effectId)?.keyframes?.[paramKey] ?? [];
  const selected = useSelected(clip);
  const range = laneRange(clip);
  return (
    <Lane clip={clip} label={`${label} keyframes`} param={[effectId, paramKey]}>
      <LinkedCurve clip={clip} effectId={effectId} paramKey={paramKey} />
      {keys.map((k) => {
        const ref: KeyframeRef = { effectId, key: paramKey, time: k.time };
        return (
          <Diamond
            key={k.time}
            clip={clip}
            range={range}
            refs={[ref]}
            keyframe={k}
            label={label}
            selected={selected.some((s) => sameRef(s, ref))}
          />
        );
      })}
    </Lane>
  );
}

/** An effect's keyframes, summed up: one diamond per time any of its properties has one. */
export function EffectLane({ clip, effectId, label }: { clip: Clip; effectId: string; label: string }) {
  const selected = useSelected(clip);
  const range = laneRange(clip);
  const times = keyframeTimes(clip, { effectId });
  if (times.length === 0) return <Lane clip={clip} label={`All ${label} keyframes`} />;
  return (
    <Lane clip={clip} label={`All ${label} keyframes`}>
      {times.map((time) => {
        const refs = clipKeyframes(clip, { time, effectId });
        return (
          <Diamond
            key={time}
            clip={clip}
            range={range}
            refs={refs}
            label={label}
            summary
            selected={refs.every((r) => selected.some((s) => sameRef(s, r)))}
          />
        );
      })}
    </Lane>
  );
}

/** A lane's background: dragging on it draws a selection box; a click clears the selection. */
function Lane({ clip, label, param, children }: { clip: Clip; label: string; param?: [effectId: string, key: string]; children?: ReactNode }) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    startMarquee(e, clip.id);
  };
  return (
    <div
      data-lane
      data-lane-param={param && JSON.stringify(param)}
      role="group"
      aria-label={label}
      className="absolute inset-0 touch-none"
      onPointerDown={onPointerDown}
    >
      {children}
    </div>
  );
}

/** Box selection over the lanes: selects every keyframe the box touches (Shift/⌘ adds to the selection). */
function startMarquee(e: ReactPointerEvent<HTMLElement>, clipId: string) {
  const root = e.currentTarget.closest("[data-keyframes-root]");
  if (!root) return;
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  const selection = useKeyframeSelection.getState();
  const base = additive && selection.clipId === clipId ? selection.refs : [];
  const x0 = e.clientX;
  const y0 = e.clientY;
  let box: HTMLDivElement | null = null;

  startPointerDrag(e, {
    threshold: 3,
    onStart: () => {
      box = document.createElement("div");
      box.className = "pointer-events-none fixed z-50 rounded-[2px] border border-brand bg-brand/10";
      document.body.append(box);
    },
    onMove: (ev) => {
      const r = {
        left: Math.min(x0, ev.clientX),
        right: Math.max(x0, ev.clientX),
        top: Math.min(y0, ev.clientY),
        bottom: Math.max(y0, ev.clientY),
      };
      Object.assign(box!.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
      const hit: KeyframeRef[] = [];
      for (const el of root.querySelectorAll("[data-refs]")) {
        const d = el.getBoundingClientRect();
        if (d.right >= r.left && d.left <= r.right && d.bottom >= r.top && d.top <= r.bottom) hit.push(...refsOf(el));
      }
      useKeyframeSelection.getState().select(clipId, [...base, ...hit.filter((h) => !base.some((b) => sameRef(b, h)))]);
    },
    onEnd: () => box?.remove(),
    onCancel: () => {
      box?.remove();
      useKeyframeSelection.getState().select(clipId, base);
    },
    onClick: () => {
      if (!additive) useKeyframeSelection.getState().clear();
    },
  });
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

function Diamond({
  clip,
  range,
  refs,
  keyframe,
  label,
  summary,
  selected,
}: {
  clip: Clip;
  range: LaneRange;
  refs: KeyframeRef[];
  /** The keyframe (a property's lane), for its shape. */
  keyframe?: Keyframe;
  label: string;
  /** An effect's summary of several keyframes. */
  summary?: boolean;
  selected: boolean;
}) {
  const t = timelineTime(clip, refs[0].time);
  if (t < range.start - 1e-6 || t > range.end + 1e-6) return null;
  return (
    <div
      data-refs={JSON.stringify(refs)}
      data-selected={selected || undefined}
      role="button"
      aria-label={`${label} keyframe at ${formatSeconds(t - clip.start)}`}
      aria-pressed={selected}
      className="group/kf absolute top-1/2 z-[1] grid size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer touch-none place-items-center"
      style={{ left: laneLeft(range, t) }}
      onPointerDown={(e) => startKeyframeDrag(e, clip.id, refs)}
      onDoubleClick={() => usePlayback.getState().seek(t)}
    >
      <KeyframeShape
        easing={keyframe?.easing ?? "linear"}
        className={cn(
          "transition-transform group-hover/kf:scale-125",
          summary ? "size-2.5" : "size-3.5",
          selected ? "fill-brand stroke-brand" : summary ? "fill-muted-foreground stroke-background" : "fill-foreground/80 stroke-background",
        )}
      />
    </div>
  );
}

/** "0.53s", "2.00s": where a keyframe sits in its clip. */
const formatSeconds = (s: number) => `${Math.max(0, s).toFixed(2)}s`;

/**
 * Premiere's keyframe glyphs: each half shows how the keyframe is passed
 * through on that side: a point (linear), a curve (eased) or a square (hold).
 */
export function KeyframeShape({ easing, className }: { easing: Easing; className?: string }) {
  // One outline: down the left side (top to bottom), then back up the right.
  // Arrived at with a wobble: a zigzag on its incoming side.
  const left = isDynamic(easing) ? "L1.5 2.5 L3.5 5 L0 5 L3.5 7.5 L5 10" : easesIn(easing) ? "A5 5 0 0 0 5 10" : "L0 5 L5 10";
  const right = easing === "hold" ? "L9.5 10 L9.5 0 Z" : easesOut(easing) ? "A5 5 0 0 0 5 0 Z" : "L10 5 Z";
  return (
    <svg viewBox="-1 -1 12 12" aria-hidden className={className} strokeWidth={1} strokeLinejoin="round">
      <path d={`M5 0 ${left} ${right}`} />
    </svg>
  );
}

function EasingIcon({ easing }: { easing: Easing }) {
  return <KeyframeShape easing={easing} className="size-3 fill-current stroke-none" />;
}

/**
 * Press on a keyframe: select it (Shift/⌘ toggles it in the selection), then
 * dragging moves every selected keyframe, as one undo step.
 */
function startKeyframeDrag(e: ReactPointerEvent<HTMLElement>, clipId: string, refs: KeyframeRef[]) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const { project } = editor();
  const clip = getClip(project, clipId);
  const lane = e.currentTarget.closest("[data-lane]");
  if (!clip || !lane) return;
  const selection = useKeyframeSelection.getState();
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  const before = selectedKeyframes(clip);
  const wasSelected = refs.every((r) => before.some((s) => sameRef(s, r)));
  if (additive) selection.select(clipId, refs, "toggle");
  else if (!wasSelected) selection.select(clipId, refs);
  const moving = selectedKeyframes(clip);
  if (!refs.every((r) => moving.some((m) => sameRef(m, r)))) return; // just toggled off

  const fps = project.settings.fps;
  const range = laneRange(clip);
  const pps = pxPerSecond(range, lane.getBoundingClientRect().width);
  const anchor = timelineTime(clip, refs[0].time);
  const sources = moving.map((m) => m.time);
  const stillTimes = keyframeTimes(clip)
    .filter((t) => !sources.some((s) => Math.abs(s - t) < 1e-3))
    .map((s) => timelineTime(clip, s));
  // Markers (the sequence's and any clip's) are worth landing on: a beat, a cue.
  const markerTimes = allMarkers(project).map((m) => m.time);
  const x0 = e.clientX;
  const gesture = new EditGesture();
  let delta = 0;
  // ⌥-dragging the first or last of several selected keyframes stretches them all about the other end (After Effects).
  const [firstTime, lastTime] = [Math.min(...sources), Math.max(...sources)];
  const pressed = refs[0].time;
  const stretch = e.altKey && lastTime - firstTime > 1e-3 && (Math.abs(pressed - firstTime) < 1e-3 || Math.abs(pressed - lastTime) < 1e-3);
  const pivot = Math.abs(pressed - firstTime) < 1e-3 ? lastTime : firstTime;
  let factor = 1;

  startPointerDrag(e, {
    threshold: 3,
    cursor: "ew-resize",
    onStart: () => gesture.begin(),
    onMove: (ev) => {
      const raw = anchor + (ev.clientX - x0) / pps;
      const targets = editor().snapping ? [usePlayback.getState().time, range.start, range.end, ...stillTimes, ...markerTimes] : [];
      const snapped = snapTime(raw, targets, SNAP_PX / pps, fps);
      if (stretch) {
        // Never through the pivot: at least a frame's worth of the stretch stays.
        const to = pressed + sourceDelta(clip, snapped - anchor);
        const least = 1 / fps / (lastTime - firstTime);
        factor = Math.max(least, (to - pivot) / (pressed - pivot));
        gesture.apply((p) => scaleKeyframes(editor().gestureBase ?? p, clipId, moving, pivot, factor));
        return;
      }
      // The lane is in timeline time; keyframes move in source time (faster, or backwards, on a retimed clip).
      delta = tidy(clampDelta(sourceDelta(clip, snapped - anchor), sources, clip.in, clip.out));
      // Always from where they started (the gesture's base), not from the last preview.
      gesture.apply((p) => moveKeyframes(editor().gestureBase ?? p, clipId, moving, delta));
    },
    onEnd: () => {
      gesture.end();
      const landed = (time: number) => (stretch ? tidy(pivot + (time - pivot) * factor) : tidy(time + delta));
      useKeyframeSelection.getState().select(clipId, moving.map((m) => ({ ...m, time: landed(m.time) })));
    },
    onCancel: () => gesture.cancel(),
    onClick: () => {
      // A plain click on one of several selected keyframes selects just it.
      if (!additive && wasSelected && before.length > refs.length) useKeyframeSelection.getState().select(clipId, refs);
    },
  });
}
