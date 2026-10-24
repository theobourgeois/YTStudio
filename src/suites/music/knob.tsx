import { type ReactNode, useId, useRef, useState } from "react";
import { cn } from "cn";
import { Popover as PopoverPrimitive } from "radix-ui";
import { create } from "zustand";
import { clamp } from "@shared/math";
import type { AutomationTarget, MusicProject } from "@shared/music/types";
import { AutomationMenuItems, useAutomatedControl } from "./automation/control";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";
import { startPointerDrag } from "@/lib/pointer-drag";
import { songGesture, useMusic } from "./store";
import { resolveControlKey } from "./control-keys";
import { useWheelValue } from "./wheel";

/** Pixels of drag for the knob's whole range (ten times that with Ctrl, for fine changes). */
const DRAG_RANGE = 150;
/** The room (px from the top of the page) a knob needs above it to show its value there while it's dragged. */
const VALUE_ROOM = 64;
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
/** Pitch, kept in semitones, shown and typed in cents (100 to a semitone), as FL Studio does. */
export const CENTS: ValueUnit = { scale: 100, unit: "cents" };
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
  /** How its travel spreads over its range: evenly, or along a log scale (a rate in Hz; `min` must be over 0). */
  taper?: "linear" | "log";
  size?: number;
  className?: string;
  /** A drag starts, moves, and ends or is cancelled. */
  onBegin: () => void;
  onDrag: (value: number) => void;
  onEnd: () => void;
  onCancel: () => void;
  /** Set outright: a reset, a paste, a typed value, a key. */
  onSet: (value: number) => void;
  /** Automation drives it (in song mode): marked, as FL marks an automated control. */
  automated?: boolean;
  /**
   * Its own value, when what it shows is automation's: drags, keys and the wheel start from it (the hand
   * changes the control's own value, never the curve's). Default: `value`.
   */
  own?: number;
  /** More of its right-click menu's items (Create automation clip). */
  menu?: ReactNode;
  /** Modulated (`docs/sidechain.md`): where its modulator takes it at full level, drawn as a ring from its own value. */
  modulatedTo?: number | null;
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
 * A knob that works like FL Studio's (`docs/fl-studio/README.md`): drag up and down or scroll, Ctrl for fine
 * changes; Alt+click or a middle click resets it; a right-click opens its menu (Reset, Copy value,
 * Paste value, Type in value).
 */
export function Knob({ value, min, max, defaultValue, label, format, unit, bipolar, taper, size = 22, className, onBegin, onDrag, onEnd, onCancel, onSet, automated, own = value, menu, modulatedTo = null }: KnobProps) {
  // While it's dragged, where its value shows: above it, or under it when there's no room above (the toolbar's, at the window's top).
  const [dragging, setDragging] = useState<"above" | "below" | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const typingNext = useRef(false);
  // Typed in by typing a number on it: the field starts with that character, the caret after it.
  const caretAtEnd = useRef(false);
  const element = useRef<HTMLDivElement>(null);
  const copied = useCopiedValue((s) => s.fraction);
  // Everything moves in fractions of its travel (0..1), so a log knob turns as evenly as a linear one.
  const log = taper === "log" && min > 0;
  const toTravel = (v: number) => clamp(log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min), 0, 1);
  const fromTravel = (f: number) => (log ? min * (max / min) ** clamp(f, 0, 1) : min + clamp(f, 0, 1) * (max - min));
  useWheelValue(element, { value: () => toTravel(own), min: 0, max: 1, step: (fine) => (fine ? 1 / 200 : 1 / 40), onBegin, onDrag: (f) => onDrag(fromTravel(f)), onEnd });
  const fraction = toTravel(value);
  const angle = -SWEEP / 2 + fraction * SWEEP;
  const c = size / 2;
  const gradient = useId().replace(/:/g, "");
  // FL Studio's: the value an arc on the outside, then a darker ring (the well), then the cap. Big knobs have
  // no pointer (their arc says it all, as the mixer's do in FL); small ones keep a notch, to be read at a glance.
  const arcWidth = Math.max(2, size * 0.11);
  const arcRadius = c - arcWidth / 2;
  const wellRadius = c - arcWidth - 0.5;
  const capRadius = wellRadius - Math.max(1.5, size * 0.07);
  const notched = size < 26;
  const [px, py] = polar(c, c, capRadius - 1, angle);
  const [ix, iy] = polar(c, c, capRadius * 0.45, angle);

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
              ref={element}
              role="slider"
              tabIndex={0}
              aria-label={label}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={value}
              aria-valuetext={format(value)}
              title={`${label}: ${format(value)}${automated ? " (automated)" : ""}${modulatedTo !== null ? ` (modulated, to ${format(modulatedTo)})` : ""}`}
              data-automated={automated || undefined}
              data-modulated={modulatedTo !== null || undefined}
              className={cn("relative shrink-0 cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60", className)}
              style={{ width: size, height: size }}
              onPointerDown={(e) => {
                // A middle click, or Alt+click: back to its default.
                if (e.button === 1 || (e.button === 0 && e.altKey)) {
                  e.preventDefault();
                  onSet(defaultValue);
                  return;
                }
                // Each move adds to where it got to (Ctrl: finely), so pressing or letting go of Ctrl
                // midway doesn't make it jump. The pointer is held where it was pressed and hidden (FL's):
                // the drag goes on past the screen's edge.
                let at = toTravel(own);
                let lastY = 0;
                startPointerDrag(e, {
                  threshold: 2,
                  cursor: "ns-resize",
                  lock: true,
                  onStart() {
                    setDragging((element.current?.getBoundingClientRect().top ?? 100) < VALUE_ROOM ? "below" : "above");
                    onBegin();
                  },
                  onMove: (ev, travel) => {
                    const dy = travel.y - lastY;
                    lastY = travel.y;
                    at = clamp(at - dy / (ev.ctrlKey || ev.metaKey ? DRAG_RANGE * 10 : DRAG_RANGE), 0, 1);
                    onDrag(fromTravel(at));
                  },
                  onEnd() {
                    setDragging(null);
                    onEnd();
                  },
                  onCancel() {
                    setDragging(null);
                    onCancel();
                  },
                });
              }}
              onKeyDown={(e) => {
                const key = resolveControlKey(e, { horizontal: true, resets: true });
                if (!key) return;
                if (key.type === "step") onSet(fromTravel(toTravel(own) + key.direction / { fine: 200, normal: 40, coarse: 8 }[key.size]));
                else if (key.type === "edge") onSet(key.edge === "min" ? min : max);
                else if (key.type === "reset") onSet(defaultValue);
                else {
                  caretAtEnd.current = key.text !== undefined;
                  setTyping(key.text ?? typed(own, unit));
                }
                e.preventDefault();
                // The keys are the knob's here, not the rack's.
                e.stopPropagation();
              }}
            >
              {/*
                FL Studio's knob: a dark cap with a soft top light, sitting in a recessed well, its value an arc
                round the well over its unlit track (from the start, or from the middle for pan), a small notch on the cap for where
                it points. The colours are the theme's (--knob-*).
              */}
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="relative overflow-visible" aria-hidden>
                <defs>
                  <linearGradient id={`${gradient}-cap`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--knob-cap-light)" />
                    <stop offset="45%" stopColor="var(--knob-cap)" />
                    <stop offset="100%" stopColor="var(--knob-cap-dark)" />
                  </linearGradient>
                </defs>
                {/* The arc's unlit track, the whole sweep: a knob at its start still has its ring. */}
                <path d={arc(c, c, arcRadius, -SWEEP / 2, SWEEP / 2)} fill="none" stroke="var(--knob-track)" strokeWidth={arcWidth} strokeLinecap="butt" />
                {Math.abs(angle - (bipolar ? 0 : -SWEEP / 2)) > 1 && (
                  <path d={arc(c, c, arcRadius, bipolar ? 0 : -SWEEP / 2, angle)} fill="none" stroke="var(--knob-arc)" strokeWidth={arcWidth} strokeLinecap="butt" />
                )}
                <circle cx={c} cy={c} r={wellRadius} fill="var(--knob-well)" stroke="var(--knob-well-edge)" strokeWidth={0.75} />
                <circle cx={c} cy={c} r={capRadius} fill={`url(#${gradient}-cap)`} />
                {/* Its rim: lit along the top, dark along the bottom. */}
                <path d={arc(c, c, capRadius - 0.4, -70, 70)} fill="none" stroke="rgb(255 255 255 / 0.16)" strokeWidth={0.8} />
                <path d={arc(c, c, capRadius - 0.4, 110, 250)} fill="none" stroke="rgb(0 0 0 / 0.35)" strokeWidth={0.8} />
                {notched && <line x1={ix} y1={iy} x2={px} y2={py} stroke="var(--knob-notch)" strokeWidth={Math.max(1.25, size * 0.06)} strokeLinecap="round" />}
                {/* Modulated (Bitwig's ring): from its own value to where its modulator takes it, just outside. */}
                {modulatedTo !== null && Math.abs(toTravel(modulatedTo) - toTravel(own)) > 0.004 && (
                  <path
                    d={arc(c, c, c + 1.5, -SWEEP / 2 + toTravel(own) * SWEEP, -SWEEP / 2 + toTravel(modulatedTo) * SWEEP)}
                    fill="none"
                    stroke="var(--brand)"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    opacity={0.85}
                  />
                )}
              </svg>
              {/* Automated: a small mark in the accent at its top right. */}
              {automated && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full border border-black/40 bg-brand" />}
              {dragging && (
                <span className={cn("floating pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-sm px-1.5 py-0.5 text-[10px] whitespace-nowrap tabular-nums", dragging === "below" ? "top-full mt-1" : "-top-6")}>
                  {format(value)}
                </span>
              )}
            </div>
          </PopoverPrimitive.Anchor>
        </ContextMenuTrigger>
        {/* Choosing Type in value: the menu mustn't give the focus back to the control as it closes, or the field loses it and closes. */}
        <ContextMenuContent
          onCloseAutoFocus={(e) => {
            if (!typingNext.current) return;
            e.preventDefault();
            typingNext.current = false;
          }}
        >
          <ContextMenuItem onSelect={() => onSet(defaultValue)}>Reset</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => useCopiedValue.setState({ fraction })}>Copy value</ContextMenuItem>
          <ContextMenuItem disabled={copied === null} onSelect={() => copied !== null && onSet(fromTravel(copied))}>
            Paste value
          </ContextMenuItem>
          {/* After the menu has closed and given the focus back, or the field would lose it at once. */}
          <ContextMenuItem
            onSelect={() => {
              typingNext.current = true;
              setTimeout(() => setTyping(typed(value, unit)), 0);
            }}
          >
            Type in value…
          </ContextMenuItem>
          {menu}
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent
        className="w-36 p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Typed (or let go), the keyboard is back on the knob, for the next key.
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          element.current?.focus();
        }}
      >
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Input
            autoFocus
            aria-label={`${label} value`}
            inputMode="decimal"
            className="h-7"
            value={typing ?? ""}
            onChange={(e) => setTyping(e.target.value)}
            onFocus={(e) => (caretAtEnd.current ? e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length) : e.currentTarget.select())}
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

type SongKnobProps = Omit<KnobProps, "onBegin" | "onDrag" | "onEnd" | "onCancel" | "onSet" | "automated" | "menu"> & {
  /** The song with this knob at `value`. */
  edit: (song: MusicProject, value: number) => MusicProject;
  /** The control it is, if it can be automated (its menu then has Create automation clip). */
  target?: AutomationTarget;
  /** It turns by its automation's fraction (0..1, a tapered control's), not in the control's own units. */
  fraction?: boolean;
};

/**
 * A knob on the open song: a drag is one undo step, heard as it turns. One that can be automated
 * (`target`) follows its automation in song mode, and while it's held the hand wins (the engine leaves
 * its automation out until it's let go).
 */
export function SongKnob({ edit, target, fraction, ...knob }: SongKnobProps) {
  const gesture = useRef(songGesture()).current;
  const control = useAutomatedControl(target, knob.value, fraction ? "fraction" : "control");
  return (
    <Knob
      {...knob}
      value={control.value}
      own={knob.value}
      automated={control.automated}
      modulatedTo={control.modulatedTo}
      menu={target && <AutomationMenuItems target={target} />}
      onBegin={() => {
        control.hold();
        gesture.begin();
      }}
      onDrag={(value) => gesture.apply((song) => edit(song, value))}
      onEnd={() => {
        gesture.end();
        control.release();
      }}
      onCancel={() => {
        gesture.cancel();
        control.release();
      }}
      onSet={(value) => useMusic.getState().commit((song) => edit(song, value))}
    />
  );
}

export const percent = (v: number) => `${Math.round(v * 100)}%`;
export const panText = (v: number) => (Math.abs(v) < 0.005 ? "Centre" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "left" : "right"}`);
export const cents = (semitones: number) => `${semitones > 0 ? "+" : ""}${Math.round(semitones * 100)} cents`;
export const seconds = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
