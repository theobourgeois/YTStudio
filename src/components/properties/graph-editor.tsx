/**
 * The graph editor (After Effects' Graph Editor, Premiere's value and velocity graphs):
 * under a property's keyframe lane, its curve over the clip. The Value Graph shows a
 * number's value; the Speed Graph how fast any animated value changes. Keyframes can be
 * dragged (in time, and in the value graph also in value), and each side of a keyframe
 * has a Bézier handle: in the value graph it shapes the curve directly, in the speed graph
 * its height is the speed at the keyframe and its length the influence. Handles move
 * together (a smooth keyframe) unless ⌥ is held, which breaks them apart.
 */
import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from "react";
import { type KeyframeRef, moveKeyframes, sameRef, setKeyframeHandles, setKeyframeValue, timelineTime } from "@shared/animation";
import { keyframeSpeed, keyframeValue } from "@shared/keyframes";
import { clamp, tidy } from "@shared/math";
import type { NumberSpec, Vec2Spec } from "@shared/params";
import { clipEnd, sourceAt, sourceDelta, sourceTime } from "@shared/timeline";
import type { Clip, Keyframe, Vec2 } from "@shared/types";
import { EditGesture } from "@/lib/edit-gesture";
import { startPointerDrag } from "@/lib/pointer-drag";
import { type GraphMode, useLayout } from "@/stores/layout";
import { PiChartLine } from "react-icons/pi";
import { useEditor } from "@/stores/editor";
import { cn } from "cn";
import {
  type GraphPoint,
  type Side,
  graphRange,
  handleFromSpeed,
  handleFromValue,
  handleSegment,
  matchingHandle,
  speedHandle,
  speedOfValuePoint,
  valueHandle,
} from "./graph-geometry";
import { LANE_PAD } from "./keyframe-geometry";
import { selectedKeyframes, useKeyframeSelection } from "./keyframe-selection";

const editor = useEditor.getState;

/** Height of a graph, px. */
export const GRAPH_HEIGHT = 136;
/** Room above and below the curve, px. */
const PAD_Y = 12;

/** How a graph shows its numbers: the stored value times `scale`, and the speed's own scale and unit. */
export interface GraphUnits {
  scale: number;
  unit: string;
  speedScale: number;
  speedUnit: string;
}

export function graphUnits(spec: NumberSpec | Vec2Spec): GraphUnits {
  const scale = spec.kind === "number" ? (spec.scale ?? 1) : 1;
  const unit = spec.kind === "number" ? (spec.unit ?? "") : "";
  return {
    scale,
    unit,
    speedScale: spec.kind === "number" && spec.speed ? spec.speed.scale : scale,
    speedUnit: spec.kind === "number" && spec.speed ? spec.speed.unit : `${unit}/s`,
  };
}

export function ParamGraph({
  clip,
  effectId,
  spec,
  mode,
}: {
  clip: Clip;
  effectId: string;
  spec: NumberSpec | Vec2Spec;
  mode: GraphMode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const keys = clip.effects.find((e) => e.id === effectId)?.keyframes?.[spec.key] ?? [];
  const selection = useKeyframeSelection((s) => (s.clipId === clip.id ? s.refs : null));
  const selected = selection ? selectedKeyframes(clip) : [];
  const value = mode === "value" && spec.kind === "number";
  const units = graphUnits(spec);
  // Speeds are per timeline second (a retimed clip's keyframes go by faster or backwards; a
  // point's speed along its path is never negative).
  const perSecond = sourceDelta(clip, 1);
  const speedFactor = units.speedScale * (spec.kind === "number" ? perSecond : Math.abs(perSecond));

  const start = clip.start;
  const end = clipEnd(clip);
  const inner = Math.max(1, width - 2 * LANE_PAD);
  const xOfTimeline = (t: number) => LANE_PAD + ((t - start) / Math.max(1e-9, end - start)) * inner;
  const xOf = (s: number) => xOfTimeline(timelineTime(clip, s));
  const timelineAtX = (x: number) => start + ((x - LANE_PAD) / inner) * (end - start);

  // The curve(s), sampled across the clip: [timeline x, value or speed] per component.
  const n = Math.max(24, Math.min(400, Math.round(inner / 3)));
  const components = spec.kind === "vec2" && mode === "value" ? 2 : 1;
  const curves: number[][] = Array.from({ length: components }, () => []);
  const xs: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = start + ((end - start) * i) / n;
    const s = sourceTime(clip, t);
    xs.push(xOfTimeline(t));
    if (!keys.length) continue;
    if (mode === "speed") curves[0].push(keyframeSpeed(keys, s) * speedFactor);
    else {
      const v = keyframeValue(keys, s);
      if (typeof v === "number") curves[0].push(v * units.scale);
      else if (Array.isArray(v)) v.forEach((c, j) => curves[j].push(c));
    }
  }

  /** Each keyframe's handles as graph points (display units), where it has a segment on that side. */
  const handles = keys.map((_, i) =>
    (["in", "out"] as const).map((side) => {
      const segment = handleSegment(keys, i, side);
      if (!segment) return null;
      const p = value ? valueHandle(segment[0], segment[1], side) : speedHandle(segment[0], segment[1], side);
      return { side, time: p.time, y: p.y * (value ? units.scale : speedFactor) };
    }),
  );
  const keyY = (k: Keyframe, i: number) => {
    if (value) return (k.value as number) * units.scale;
    // In the speed graph a keyframe sits at the speed it's passed at (its incoming side's, at the end).
    const hs = handles[i];
    return (hs[1] ?? hs[0])?.y ?? 0;
  };
  const range = graphRange([
    ...curves.flat(),
    ...keys.map(keyY),
    ...handles.flat().flatMap((h) => (h ? [h.y] : [])),
    ...(mode === "speed" ? [0] : []),
  ]);
  const yOf = (v: number) => PAD_Y + (1 - (v - range.min) / (range.max - range.min)) * (GRAPH_HEIGHT - 2 * PAD_Y);
  const valueAtY = (y: number) => range.min + (1 - (y - PAD_Y) / (GRAPH_HEIGHT - 2 * PAD_Y)) * (range.max - range.min);

  const path = (curve: number[]) => curve.map((v, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ");
  const zero = mode === "speed" ? yOf(0) : null;

  /** Pointer position -> (source time, stored value or speed), from a pointer event. */
  const pointerAt = (ev: PointerEvent | ReactPointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const t = timelineAtX(ev.clientX - rect.left);
    const shown = valueAtY(ev.clientY - rect.top);
    return { source: sourceAt(clip, t), timeline: t, stored: shown / (value ? units.scale : speedFactor) };
  };

  const onKeyDown = (e: ReactPointerEvent<SVGElement>, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const k = keys[index];
    const refOf = (time: number): KeyframeRef => ({ effectId, key: spec.key, time });
    const ref0 = refOf(k.time);
    useKeyframeSelection.getState().select(clip.id, [ref0], e.shiftKey || e.metaKey ? "toggle" : "replace");
    const fps = editor().project.settings.fps;
    const gesture = new EditGesture();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let time = k.time;
    startPointerDrag(e, {
      threshold: 3,
      cursor: value ? "move" : "ew-resize",
      onStart: () => gesture.begin(),
      onMove: (ev) => {
        const at = pointerAt(ev);
        // Shift keeps to one direction, whichever the drag went furthest in.
        const lockTime = ev.shiftKey && Math.abs(ev.clientY - y0) > Math.abs(ev.clientX - x0);
        const lockValue = ev.shiftKey && !lockTime;
        const snapped = Math.round(sourceTime(clip, Math.round(at.timeline * fps) / fps) * 1e6) / 1e6;
        const prev = keys[index - 1]?.time ?? -Infinity;
        const next = keys[index + 1]?.time ?? Infinity;
        time = lockTime ? k.time : clamp(snapped, prev + 1 / fps / 2, next - 1 / fps / 2);
        const delta = tidy(time - k.time);
        const v = value && !lockValue ? clamp(at.stored, spec.kind === "number" ? spec.min : -Infinity, spec.kind === "number" ? spec.max : Infinity) : null;
        gesture.apply((p) => {
          let q = moveKeyframes(editor().gestureBase ?? p, clip.id, [ref0], delta);
          if (v !== null) q = setKeyframeValue(q, clip.id, refOf(tidy(k.time + delta)), tidy(v));
          return q;
        });
      },
      onEnd: () => {
        gesture.end();
        useKeyframeSelection.getState().select(clip.id, [refOf(time)]);
      },
      onCancel: () => gesture.cancel(),
    });
  };

  const onHandleDown = (e: ReactPointerEvent<SVGElement>, index: number, side: Side) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const segment = handleSegment(keys, index, side);
    if (!segment) return;
    const [a, b] = segment;
    const k = keys[index];
    const ref0: KeyframeRef = { effectId, key: spec.key, time: k.time };
    const gesture = new EditGesture();
    startPointerDrag(e, {
      threshold: 0,
      cursor: "grabbing",
      onStart: () => gesture.begin(),
      onMove: (ev) => {
        const at = pointerAt(ev);
        let handle: Vec2 | null;
        let speed: number;
        if (value) {
          handle = handleFromValue(a, b, at.source, at.stored);
          speed = speedOfValuePoint(k, { time: at.source, y: at.stored } satisfies GraphPoint);
          // A flat segment only has a speed of zero: its handle only reaches further or not.
          if (!handle) handle = handleFromSpeed(a, b, side, at.source, 0) ?? [side === "out" ? 1 / 3 : 2 / 3, side === "out" ? 0 : 1];
        } else {
          speed = at.stored;
          handle = handleFromSpeed(a, b, side, at.source, speed);
          if (!handle) return;
        }
        const other: Side = side === "in" ? "out" : "in";
        const mirrored = ev.altKey ? null : matchingHandle(keys, index, other, speed);
        gesture.apply((p) =>
          setKeyframeHandles(editor().gestureBase ?? p, clip.id, ref0, { [side]: handle, ...(mirrored && { [other]: mirrored }) }),
        );
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
    });
  };

  const unit = mode === "speed" ? units.speedUnit : units.unit;
  const label = (v: number) => `${Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2)}${unit}`;

  return (
    <div
      ref={ref}
      data-graph={mode}
      className="relative w-full touch-none overflow-hidden select-none"
      style={{ height: GRAPH_HEIGHT }}
      aria-label={`${mode === "value" ? "Value" : "Speed"} graph`}
    >
      {width > 0 && (
        <svg width={width} height={GRAPH_HEIGHT} className="absolute inset-0">
          {/* Grid: the top and bottom of the range, and zero speed. */}
          <line x1={0} x2={width} y1={PAD_Y} y2={PAD_Y} className="stroke-border" strokeDasharray="2 3" />
          <line x1={0} x2={width} y1={GRAPH_HEIGHT - PAD_Y} y2={GRAPH_HEIGHT - PAD_Y} className="stroke-border" strokeDasharray="2 3" />
          {zero !== null && <line x1={0} x2={width} y1={zero} y2={zero} className="stroke-muted-foreground/40" />}
          <text x={4} y={PAD_Y - 3} className="fill-muted-foreground text-[9px] tabular-nums">
            {label(range.max)}
          </text>
          <text x={4} y={GRAPH_HEIGHT - 3} className="fill-muted-foreground text-[9px] tabular-nums">
            {label(range.min)}
          </text>
          {curves.map((curve, i) =>
            curve.length ? (
              <path
                key={i}
                d={path(curve)}
                fill="none"
                strokeWidth={1.5}
                className={components === 2 ? (i === 0 ? "stroke-red-400" : "stroke-emerald-400") : "stroke-brand"}
              />
            ) : null,
          )}
          {keys.map((k, i) => {
            const kx = xOf(k.time);
            const ky = yOf(keyY(k, i));
            const ref: KeyframeRef = { effectId, key: spec.key, time: k.time };
            const isSelected = selected.some((s) => sameRef(s, ref));
            const showHandles = components === 1 && k.easing !== "hold";
            return (
              <g key={k.time}>
                {showHandles &&
                  handles[i].map((h) => {
                    if (!h) return null;
                    const hx = xOf(h.time);
                    const hy = yOf(h.y);
                    // In the speed graph a handle leaves from its own side's speed, which may differ from the other side's.
                    const fromY = value ? ky : hy;
                    return (
                      <g key={h.side}>
                        <line x1={kx} y1={fromY} x2={hx} y2={hy} className="stroke-muted-foreground/70" />
                        {!value && <circle cx={kx} cy={hy} r={1.5} className="fill-muted-foreground/70" />}
                        <circle
                          cx={hx}
                          cy={hy}
                          r={4}
                          data-handle={h.side}
                          aria-label={`${h.side === "in" ? "Incoming" : "Outgoing"} handle`}
                          className="cursor-grab fill-background stroke-foreground/80 hover:fill-brand"
                          onPointerDown={(e) => onHandleDown(e, i, h.side)}
                        />
                      </g>
                    );
                  })}
                <rect
                  x={kx - 4.5}
                  y={ky - 4.5}
                  width={9}
                  height={9}
                  transform={`rotate(45 ${kx} ${ky})`}
                  data-refs={JSON.stringify([ref])}
                  data-graph-key={i}
                  className={cn("cursor-pointer stroke-background", isSelected ? "fill-brand" : "fill-foreground/85 hover:fill-brand/80")}
                  onPointerDown={(e) => onKeyDown(e, i)}
                />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** Opens or closes a property's graph editor (in its keyframe lane, at the right). */
export function GraphToggle({ id, spec, label }: { id: string; spec: NumberSpec | Vec2Spec; label: string }) {
  const mode = useLayout((s) => s.graphs[id]);
  const setGraph = useLayout((s) => s.setGraph);
  const text = mode ? `Hide ${label} graph` : `Show ${label} graph`;
  return (
    <button
      type="button"
      aria-label={text}
      title={text}
      aria-pressed={!!mode}
      onClick={() => setGraph(id, mode ? null : spec.kind === "number" ? "value" : "speed")}
      className={cn(
        "absolute top-1/2 right-1 z-[2] grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        mode ? "bg-accent text-brand" : "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
      )}
    >
      <PiChartLine className="size-3.5" />
    </button>
  );
}

/** Beside a graph: which one it shows (a point has no single value to draw, only a speed). */
export function GraphControls({ id, spec, label }: { id: string; spec: NumberSpec | Vec2Spec; label: string }) {
  const mode = useLayout((s) => s.graphs[id]) ?? "value";
  const setGraph = useLayout((s) => s.setGraph);
  const modes: { value: GraphMode; label: string }[] =
    spec.kind === "number"
      ? [
          { value: "value", label: "Value" },
          { value: "speed", label: "Speed" },
        ]
      : [{ value: "speed", label: "Speed" }];
  return (
    <div className="flex h-full flex-col gap-1.5 px-3 py-2 text-xs" style={{ minHeight: GRAPH_HEIGHT }}>
      <span className="truncate text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={`${label} graph`} className="flex w-fit rounded-md bg-muted p-0.5">
        {modes.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            onClick={() => setGraph(id, m.value)}
            className={cn(
              "cursor-pointer rounded px-2 py-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              mode === m.value ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mt-auto text-[11px] leading-snug text-muted-foreground/80">
        Drag a keyframe or a handle. ⌥ breaks a keyframe's handles apart; ⇧ keeps a drag straight.
      </p>
    </div>
  );
}
