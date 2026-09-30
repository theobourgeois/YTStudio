import { useRef, useState } from "react";
import { cn } from "cn";
import { Popover as PopoverPrimitive } from "radix-ui";
import { create } from "zustand";
import { clamp } from "@shared/math";
import type { MusicProject } from "@shared/music/types";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";
import { startPointerDrag } from "@/lib/pointer-drag";
import { songGesture, useMusic } from "./store";

/** Pixels of drag for the knob's whole range (ten times that with Ctrl, for fine changes). */
const DRAG_RANGE = 150;
/** How far the pointer sweeps: from 7 o'clock round to 5 o'clock. */
const SWEEP = 270;

/**
 * The value last copied from a control (its menu's Copy value), as a fraction of that control's
 * range: pasted into another, it lands at the same place in its range, as in FL Studio.
 */
const useCopiedValue = create<{ fraction: number | null }>(() => ({ fraction: null }));

/** How a value reads and is typed: `value * scale`, then the unit ("%", "st", "ms"). */
export interface ValueUnit {
  scale: number;
  unit: string;
  /** Decimals shown. */
  digits?: number;
}

export const PERCENT: ValueUnit = { scale: 100, unit: "%" };
export const SEMITONES: ValueUnit = { scale: 1, unit: "st", digits: 2 };
export const MILLISECONDS: ValueUnit = { scale: 1000, unit: "ms" };

const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;
const typed = (value: number, unit: ValueUnit) => String(round(value * unit.scale, unit.digits));

interface KnobProps {
  value: number;
  min: number;
  max: number;
  /** What Reset puts it back to. */
  defaultValue: number;
  label: string;
  /** The value for people ("78%", "12% left"). */
  format: (value: number) => string;
  /** How it's typed in (Type in value). */
  unit: ValueUnit;
  /** The arc grows from the middle (pan, pitch) rather than from the start. */
  bipolar?: boolean;
  size?: number;
  className?: string;
  /** A drag starts, moves, and ends or is cancelled. */
  onBegin: () => void;
  onDrag: (value: number) => void;
  onEnd: () => void;
  onCancel: () => void;
  /** Set outright: a reset, a paste, a typed value, a key. */
  onSet: (value: number) => void;
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

/**
 * A knob that works like FL Studio's (`docs/fl-studio/README.md`): drag up and down, Ctrl for fine
 * changes; Alt+click or a middle click resets it; a right-click opens its menu (Reset, Copy value,
 * Paste value, Type in value).
 */
export function Knob({ value, min, max, defaultValue, label, format, unit, bipolar, size = 22, className, onBegin, onDrag, onEnd, onCancel, onSet }: KnobProps) {
  const [dragging, setDragging] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const copied = useCopiedValue((s) => s.fraction);
  const fraction = (value - min) / (max - min);
  const angle = -SWEEP / 2 + fraction * SWEEP;
  const c = size / 2;
  const r = c - 2;
  const [px, py] = polar(c, c, r - 1.5, angle);
  const [ix, iy] = polar(c, c, r * 0.35, angle);

  const commitTyped = () => {
    const number = typing === null ? NaN : Number(typing.replace(",", "."));
    if (Number.isFinite(number)) onSet(clamp(number / unit.scale, min, max));
    setTyping(null);
  };

  return (
    <PopoverPrimitive.Root open={typing !== null} onOpenChange={(open) => !open && setTyping(null)}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <PopoverPrimitive.Anchor asChild>
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
                // A middle click, or Alt+click: back to its default.
                if (e.button === 1 || (e.button === 0 && e.altKey)) {
                  e.preventDefault();
                  onSet(defaultValue);
                  return;
                }
                const origin = e.clientY;
                const start = value;
                startPointerDrag(e, {
                  threshold: 2,
                  cursor: "ns-resize",
                  onStart() {
                    setDragging(true);
                    onBegin();
                  },
                  onMove: (ev) => onDrag(clamp(start + ((origin - ev.clientY) / (ev.ctrlKey || ev.metaKey ? DRAG_RANGE * 10 : DRAG_RANGE)) * (max - min), min, max)),
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
              onKeyDown={(e) => {
                const step = (max - min) / (e.ctrlKey || e.metaKey ? 200 : 40);
                if (e.key === "ArrowUp" || e.key === "ArrowRight") onSet(clamp(value + step, min, max));
                else if (e.key === "ArrowDown" || e.key === "ArrowLeft") onSet(clamp(value - step, min, max));
                else return;
                e.preventDefault();
                // The arrows are the knob's here, not the rack's.
                e.stopPropagation();
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
          </PopoverPrimitive.Anchor>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onSet(defaultValue)}>Reset</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => useCopiedValue.setState({ fraction })}>Copy value</ContextMenuItem>
          <ContextMenuItem disabled={copied === null} onSelect={() => copied !== null && onSet(min + copied * (max - min))}>
            Paste value
          </ContextMenuItem>
          {/* After the menu has closed and given the focus back, or the field would lose it at once. */}
          <ContextMenuItem onSelect={() => setTimeout(() => setTyping(typed(value, unit)), 0)}>Type in value…</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent className="w-36 p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Input
            autoFocus
            aria-label={`${label} value`}
            inputMode="decimal"
            className="h-7"
            value={typing ?? ""}
            onChange={(e) => setTyping(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTyped();
              e.stopPropagation();
            }}
          />
          {unit.unit}
        </label>
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}

type SongKnobProps = Omit<KnobProps, "onBegin" | "onDrag" | "onEnd" | "onCancel" | "onSet"> & {
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
      onDrag={(value) => gesture.apply((song) => edit(song, value))}
      onEnd={() => gesture.end()}
      onCancel={() => gesture.cancel()}
      onSet={(value) => useMusic.getState().commit((song) => edit(song, value))}
    />
  );
}

export const percent = (v: number) => `${Math.round(v * 100)}%`;
export const panText = (v: number) => (Math.abs(v) < 0.005 ? "Centre" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "left" : "right"}`);
export const semitones = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100) / 100} st`;
export const seconds = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
