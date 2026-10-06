/**
 * Curves in Properties (docs/photo/research/adjustments.md, "Curves"): Photoshop's graph, input along the bottom
 * and output up the side, 0..255 in the image's encoded values, a curve per channel and the composite. Click to add
 * a point (and drag it), drag one to move it between its neighbours, drag it off the graph or press Delete to remove
 * it. Each drag is one undo step; Input and Output can be typed.
 */
import { useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { curveFunction } from "@shared/photo/effects/curve-math";
import { CHANNEL_LABELS } from "@shared/photo/effects/index";
import { CURVE_CHANNELS, type CurveChannel } from "@shared/photo/effects/params";
import { setEffectParams } from "@shared/photo/edits";
import type { AdjustmentLayer, CurvePoints, CurveSet } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { startPointerDrag } from "@/lib/pointer-drag";
import { photoGesture, usePhoto } from "../store";
import { addPoint, movePoint, removePoint } from "./curve-points";
import { NumberField } from "./fields";

/** How far past the graph (in levels) a dragged point goes before it's removed. */
const OFF = 24;

/** The channels' colours on the graph (the composite in the page's text colour). */
const STROKES: Record<CurveChannel, string> = { rgb: "currentColor", red: "#e5484d", green: "#30a46c", blue: "#3e8ef7" };

const withChannel = (set: CurveSet, channel: CurveChannel, points: CurvePoints): CurveSet => ({ ...set, [channel]: points });

export function CurvesEditor({ layer }: { layer: AdjustmentLayer }) {
  const set = layer.effect.params.curves as CurveSet;
  const [channel, setChannel] = useState<CurveChannel>("rgb");
  const [selected, setSelected] = useState<number | null>(null);
  const graph = useRef<SVGSVGElement>(null);
  const points = set[channel];
  const point = selected !== null && selected < points.length ? points[selected] : null;
  const commit = (next: CurvePoints) => usePhoto.getState().commit((d) => setEffectParams(d, layer.id, { curves: withChannel(set, channel, next) }));

  /** A pointer position in levels: x along the bottom, y up the side (may be past the graph). */
  const levelsAt = (clientX: number, clientY: number) => {
    const r = graph.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * 255, y: (1 - (clientY - r.top) / r.height) * 255 };
  };

  /** Drags point `index` of `base` (a curve, maybe with the point just added) as one undo step. */
  const drag = (e: React.PointerEvent, base: CurvePoints, index: number, gesture = photoGesture()) => {
    if (!gesture.active) gesture.begin();
    setSelected(index);
    const startSet = set;
    const apply = (next: CurvePoints) => gesture.apply((d) => setEffectParams(d, layer.id, { curves: withChannel(startSet, channel, next) }));
    startPointerDrag(e, {
      threshold: 0,
      cursor: "grabbing",
      onMove: (ev) => {
        const at = levelsAt(ev.clientX, ev.clientY);
        const off = at.x < -OFF || at.x > 255 + OFF || at.y < -OFF || at.y > 255 + OFF;
        if (off && base.length > 2) {
          apply(removePoint(base, index));
          setSelected(null);
        } else {
          apply(movePoint(base, index, at.x, at.y));
          setSelected(index);
        }
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
      onClick: () => gesture.end(),
    });
  };

  const onGraphDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    graph.current!.focus();
    const at = levelsAt(e.clientX, e.clientY);
    // On a point (within 6 levels): it's dragged; elsewhere a point is added there and dragged.
    const near = points.findIndex((p) => Math.hypot(p[0] - at.x, p[1] - at.y) < 8);
    if (near >= 0) return drag(e, points, near);
    const added = addPoint(points, at.x, at.y);
    if (!added) return;
    const gesture = photoGesture();
    gesture.begin();
    gesture.apply((d) => setEffectParams(d, layer.id, { curves: withChannel(set, channel, added.points) }));
    drag(e, added.points, added.index, gesture);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selected !== null && points.length > 2) {
      e.preventDefault();
      e.stopPropagation();
      commit(removePoint(points, selected));
      setSelected(null);
    }
  };

  const others = channel === "rgb" ? CURVE_CHANNELS.filter((c) => c !== "rgb" && !isStraight(set[c])) : [];
  return (
    <div className="flex flex-col gap-2" data-curves-editor>
      <div className="flex gap-0.5" role="radiogroup" aria-label="Channel">
        {CURVE_CHANNELS.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={channel === c ? "secondary" : "ghost"}
            role="radio"
            aria-checked={channel === c}
            className="h-6 flex-1 px-1 text-xs"
            onClick={() => {
              setChannel(c);
              setSelected(null);
            }}
          >
            {CHANNEL_LABELS[c]}
          </Button>
        ))}
      </div>
      <svg
        ref={graph}
        viewBox="0 0 255 255"
        preserveAspectRatio="none"
        tabIndex={0}
        role="application"
        aria-label={`${CHANNEL_LABELS[channel]} curve`}
        className="sunken aspect-square w-full cursor-crosshair touch-none overflow-visible rounded text-foreground outline-none"
        onPointerDown={onGraphDown}
        onKeyDown={onKey}
        data-channel={channel}
      >
        {[64, 128, 191].map((v) => (
          <g key={v} className="stroke-line" strokeWidth={0.6} vectorEffect="non-scaling-stroke">
            <line x1={v} y1={0} x2={v} y2={255} vectorEffect="non-scaling-stroke" />
            <line x1={0} y1={v} x2={255} y2={v} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        <line x1={0} y1={255} x2={255} y2={0} className="stroke-muted-foreground/40" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {others.map((c) => (
          <CurvePath key={c} points={set[c]} stroke={STROKES[c]} opacity={0.5} />
        ))}
        <CurvePath points={points} stroke={STROKES[channel]} opacity={1} />
        {points.map((p, i) => (
          <rect
            key={i}
            x={p[0] - 3.5}
            y={255 - p[1] - 3.5}
            width={7}
            height={7}
            className={cn("cursor-grab", i === selected ? "fill-foreground" : "fill-surface-1")}
            stroke={STROKES[channel]}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            data-point={i}
          />
        ))}
      </svg>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Input" value={point ? point[0] : 0} disabled={!point} onCommit={(x) => selected !== null && commit(movePoint(points, selected, x, points[selected][1]))} />
        <NumberField label="Output" value={point ? point[1] : 0} disabled={!point} onCommit={(y) => selected !== null && commit(movePoint(points, selected, points[selected][0], y))} />
      </div>
    </div>
  );
}

const isStraight = (points: CurvePoints) => points.length === 2 && points[0][0] === 0 && points[0][1] === 0 && points[1][0] === 255 && points[1][1] === 255;

function CurvePath({ points, stroke, opacity }: { points: CurvePoints; stroke: string; opacity: number }) {
  const d = useMemo(() => {
    const f = curveFunction(points);
    const parts: string[] = [];
    for (let i = 0; i <= 128; i++) {
      const x = i / 128;
      parts.push(`${i ? "L" : "M"}${(x * 255).toFixed(2)},${(255 - f(x) * 255).toFixed(2)}`);
    }
    return parts.join("");
  }, [points]);
  return <path d={d} fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
}
