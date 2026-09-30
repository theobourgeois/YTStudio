import { useRef, useState } from "react";
import { cn } from "cn";
import { clamp } from "@shared/math";
import type { MusicProject } from "@shared/music/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { songGesture, useMusic } from "./store";

/** Pixels of drag for the knob's whole range (ten times that with Shift, for fine changes). */
const DRAG_RANGE = 150;
/** How far the pointer sweeps: from 7 o'clock round to 5 o'clock. */
const SWEEP = 270;

interface KnobProps {
  value: number;
  min: number;
  max: number;
  /** Where a double-click puts it back. */
  defaultValue: number;
  label: string;
  /** The value for people ("78%", "12 L"). */
  format: (value: number) => string;
  /** The arc grows from the middle (pan, pitch) rather than from the start. */
  bipolar?: boolean;
  size?: number;
  className?: string;
  /** A drag starts, moves (or a key nudges it, outside any drag), and ends or is cancelled. */
  onBegin: () => void;
  onChange: (value: number) => void;
  onEnd: () => void;
  onCancel: () => void;
}

const polar = (cx: number, cy: number, r: number, degrees: number) => {
  const a = ((degrees - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const [x1, y1] = polar(cx, cy, r, a);
  const [x2, y2] = polar(cx, cy, r, b);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/** A rotary control, as on FL Studio's channel rack: drag up and down, double-click to reset. */
export function Knob({ value, min, max, defaultValue, label, format, bipolar, size = 22, className, onBegin, onChange, onEnd, onCancel }: KnobProps) {
  const [dragging, setDragging] = useState(false);
  const fraction = (value - min) / (max - min);
  const angle = -SWEEP / 2 + fraction * SWEEP;
  const c = size / 2;
  const r = c - 2;
  const [px, py] = polar(c, c, r - 1.5, angle);
  const [ix, iy] = polar(c, c, r * 0.35, angle);

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      title={`${label}: ${format(value)}`}
      className={cn("relative shrink-0 cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60", className)}
      style={{ width: size, height: size }}
      onPointerDown={(e) => {
        const origin = e.clientY;
        const start = value;
        startPointerDrag(e, {
          threshold: 2,
          cursor: "ns-resize",
          onStart() {
            setDragging(true);
            onBegin();
          },
          onMove: (ev) => onChange(clamp(start + ((origin - ev.clientY) / (ev.shiftKey ? DRAG_RANGE * 10 : DRAG_RANGE)) * (max - min), min, max)),
          onEnd() {
            setDragging(false);
            onEnd();
          },
          onCancel() {
            setDragging(false);
            onCancel();
          },
        });
      }}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={(e) => {
        const step = (max - min) / (e.shiftKey ? 200 : 40);
        if (e.key === "ArrowUp" || e.key === "ArrowRight") onChange(clamp(value + step, min, max));
        else if (e.key === "ArrowDown" || e.key === "ArrowLeft") onChange(clamp(value - step, min, max));
        else if (e.key === "Home" || e.key === "Backspace") onChange(defaultValue);
        else return;
        e.preventDefault();
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={c} cy={c} r={r - 1.5} className="fill-muted stroke-border" strokeWidth={1} />
        <path d={arc(c, c, r, -SWEEP / 2, SWEEP / 2)} className="fill-none stroke-foreground/15" strokeWidth={1.5} strokeLinecap="round" />
        {Math.abs(angle - (bipolar ? 0 : -SWEEP / 2)) > 1 && (
          <path d={arc(c, c, r, bipolar ? 0 : -SWEEP / 2, angle)} className="fill-none stroke-brand" strokeWidth={1.5} strokeLinecap="round" />
        )}
        <line x1={ix} y1={iy} x2={px} y2={py} className="stroke-foreground" strokeWidth={1.5} strokeLinecap="round" />
      </svg>
      {dragging && (
        <span className="pointer-events-none absolute -top-6 left-1/2 z-20 -translate-x-1/2 rounded bg-popover px-1.5 py-0.5 text-[10px] whitespace-nowrap text-popover-foreground tabular-nums shadow-md ring-1 ring-border">
          {format(value)}
        </span>
      )}
    </div>
  );
}

type SongKnobProps = Omit<KnobProps, "onBegin" | "onChange" | "onEnd" | "onCancel"> & {
  /** The song with this knob at `value`. */
  edit: (song: MusicProject, value: number) => MusicProject;
};

/** A knob on the open song: a drag is one undo step, heard as it turns. */
export function SongKnob({ edit, ...knob }: SongKnobProps) {
  const gesture = useRef(songGesture()).current;
  return (
    <Knob
      {...knob}
      onBegin={() => gesture.begin()}
      onChange={(value) => {
        // A key, or a double-click: an edit of its own.
        if (gesture.active) gesture.apply((song) => edit(song, value));
        else useMusic.getState().commit((song) => edit(song, value));
      }}
      onEnd={() => gesture.end()}
      onCancel={() => gesture.cancel()}
    />
  );
}

export const percent = (v: number) => `${Math.round(v * 100)}%`;
export const panText = (v: number) => (Math.abs(v) < 0.005 ? "Centre" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "left" : "right"}`);
export const semitones = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100) / 100} st`;
export const seconds = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
