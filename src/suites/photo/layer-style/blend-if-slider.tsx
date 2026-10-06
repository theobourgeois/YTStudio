/**
 * One of Blend If's bars (docs/photo/layer-style/advanced-blending.md, "Blend If"): a 0..255 ramp with a black and
 * a white handle. ⌥-dragging a handle splits it into halves that move apart (the ramp between them feathers the
 * cut); a split handle's halves move one at a time, a whole one moves as one. The handles never cross. The values
 * show above, "low/high" for a split one, as Photoshop's do. Arrow keys move the focused handle (⇧: by 10).
 */
import { useRef } from "react";
import { cn } from "cn";
import type { BlendRange } from "@shared/photo/types";
import { startPointerDrag } from "@/lib/pointer-drag";

const WIDTH = 256;

/** The range with handle `i` (0..3) or the pair `[i, i + 1]` moved to `value`, kept in order and on 0..255. */
export function moveHandle(range: BlendRange, indices: readonly number[], value: number): BlendRange {
  const r = [...range] as BlendRange;
  const v = Math.round(Math.max(0, Math.min(255, value)));
  if (indices.length === 2) {
    const [a, b] = indices;
    const gap = r[b] - r[a];
    const lo = a > 0 ? r[a - 1] : 0;
    const hi = b < 3 ? r[b + 1] - gap : 255 - gap;
    r[a] = Math.max(lo, Math.min(hi, v));
    r[b] = r[a] + gap;
    return r;
  }
  const i = indices[0];
  r[i] = Math.max(i > 0 ? r[i - 1] : 0, Math.min(i < 3 ? r[i + 1] : 255, v));
  return r;
}

export function BlendIfSlider({ label, range, colour, onChange }: { label: string; range: BlendRange; colour: string; onChange: (range: BlendRange) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const value = (clientX: number) => ((clientX - bar.current!.getBoundingClientRect().left) / bar.current!.getBoundingClientRect().width) * 255;
  const show = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo}/${hi}`);

  const press = (e: React.PointerEvent, handle: 0 | 1) => {
    e.preventDefault();
    e.stopPropagation();
    const [lo, hi] = handle === 0 ? [0, 1] : [2, 3];
    const split = range[lo] !== range[hi];
    const start = range;
    // A whole handle moves as one; ⌥ splits it, the half towards the pointer moving. A split one moves the half pressed.
    const x = value(e.clientX);
    const nearest = Math.abs(x - start[lo]) <= Math.abs(x - start[hi]) ? lo : hi;
    let indices: number[] = split ? [nearest] : [lo, hi];
    let alt = e.altKey;
    startPointerDrag(e as React.PointerEvent<Element>, {
      threshold: 0,
      cursor: "ew-resize",
      onMove: (ev) => {
        const v = value(ev.clientX);
        if (!split && ev.altKey && !alt) alt = true;
        if (!split && alt) indices = [v < start[lo] ? lo : hi];
        onChange(moveHandle(start, indices, v));
      },
    });
  };

  const key = (e: React.KeyboardEvent, handle: 0 | 1) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const [lo, hi] = handle === 0 ? [0, 1] : [2, 3];
    const indices = range[lo] === range[hi] ? [lo, hi] : [handle === 0 ? lo : hi];
    onChange(moveHandle(range, indices, range[indices[0]] + step * (e.shiftKey ? 10 : 1)));
  };

  const at = (v: number) => `${(v / 255) * 100}%`;
  const triangle = (v: number, half: "whole" | "left" | "right", fill: string) => (
    <svg key={`${half}${v}`} className="pointer-events-none absolute top-0 -translate-x-1/2 overflow-visible" style={{ left: at(v) }} width="12" height="10" viewBox="0 0 12 10" aria-hidden>
      <path d={half === "whole" ? "M6 0.5 L11.5 9.5 L0.5 9.5 Z" : half === "left" ? "M6 0.5 L6 9.5 L0.5 9.5 Z" : "M6 0.5 L11.5 9.5 L6 9.5 Z"} fill={fill} stroke="var(--muted-foreground)" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
  const handle = (i: 0 | 1) => {
    const [lo, hi] = i === 0 ? [range[0], range[1]] : [range[2], range[3]];
    const fill = i === 0 ? "#000" : "#fff";
    const name = i === 0 ? "black" : "white";
    return (
      <div key={name}>
        {lo === hi ? triangle(lo, "whole", fill) : [triangle(lo, "left", fill), triangle(hi, "right", fill)]}
        <div
          role="slider"
          tabIndex={0}
          aria-label={`${label} ${name} handle`}
          aria-valuemin={0}
          aria-valuemax={255}
          aria-valuenow={i === 0 ? hi : lo}
          aria-valuetext={show(lo, hi)}
          className="absolute inset-y-0 cursor-ew-resize rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-brand"
          style={{ left: `calc(${at(lo)} - 7px)`, width: `calc(${at(hi)} - ${at(lo)} + 14px)` }}
          onPointerDown={(e) => press(e, i)}
          onKeyDown={(e) => key(e, i)}
          data-handle={name}
        />
      </div>
    );
  };
  return (
    <div className="grid grid-cols-[6.5rem_auto] items-end gap-x-2 gap-y-0.5 text-xs" data-blend-if={label}>
      <span className="row-span-2 self-start pt-px">{label}:</span>
      <span className="flex justify-between tabular-nums text-muted-foreground" style={{ width: WIDTH }} data-values>
        <span>{show(range[0], range[1])}</span>
        <span>{show(range[2], range[3])}</span>
      </span>
      <div style={{ width: WIDTH }}>
        <div ref={bar} className={cn("h-3 rounded-sm border border-line")} style={{ background: `linear-gradient(to right, #000, ${colour})` }} />
        <div className="relative h-2.5">
          {handle(0)}
          {handle(1)}
        </div>
      </div>
    </div>
  );
}
