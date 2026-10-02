import { type ReactNode, useId, useRef, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "cn";
import { clamp } from "@shared/math";
import type { AutomationTarget, MusicProject } from "@shared/music/types";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";
import { startPointerDrag } from "@/lib/pointer-drag";
import { AutomationMenuItems, useAutomatedControl } from "../automation/control";
import { songGesture, useMusic } from "../store";
import { useWheelValue } from "../wheel";

/** Pixels of drag for a knob's whole travel (ten times that with Shift, Pro-Q's fine). */
const TRAVEL = 180;
/** From 7 o'clock round to 5 o'clock. */
const SWEEP = 270;

const polar = (c: number, r: number, degrees: number) => {
  const a = ((degrees - 90) * Math.PI) / 180;
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
};
function arc(c: number, r: number, from: number, to: number): string {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const [x1, y1] = polar(c, r, a);
  const [x2, y2] = polar(c, r, b);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}
const angleOf = (fraction: number) => -SWEEP / 2 + clamp(fraction, 0, 1) * SWEEP;

/** The ring round Pro-Q's Gain knob: a dynamic band's range (red) and where its dynamics have it now (yellow). */
export interface DynamicRing {
  /** Fractions of the knob's travel: its gain, its gain plus range, and its gain now. */
  from: number;
  to: number;
  live: number | null;
  /** Drag the ring: the range, as a fraction of the travel from the gain. */
  onBegin: () => void;
  onDrag: (fraction: number) => void;
  onEnd: () => void;
  onCancel: () => void;
}

export interface EqKnobProps {
  /** 0..1 of its travel. */
  value: number;
  defaultValue: number;
  label: string;
  /** Under the knob: its ends ("10 Hz", "30 kHz"). */
  ends?: [string, string];
  /** The value for people, from a fraction. */
  format: (fraction: number) => string;
  /** What's typed, as a fraction (null: not a value). */
  parse: (text: string) => number | null;
  /** As it's typed: the value now, in the field. */
  typed: (fraction: number) => string;
  size?: number;
  bipolar?: boolean;
  disabled?: boolean;
  onBegin: () => void;
  onDrag: (fraction: number) => void;
  onEnd: () => void;
  onCancel: () => void;
  onSet: (fraction: number) => void;
  ring?: DynamicRing;
  menu?: ReactNode;
  automated?: boolean;
  /** Its own value, when what it shows is automation's. */
  own?: number;
  className?: string;
}

/**
 * Pro-Q's knob (FabFilter's): a grey dome with a white tab where it points, in a dark well whose arc shows
 * the value. Drag up and down (Shift: fine), scroll, double-click to type (Pro-Q's shortcuts: "1k", "A4",
 * "2x"), Cmd- or Alt-click to reset, right-click for its menu. The Gain knob carries the dynamic ring.
 */
export function EqKnob({ value, defaultValue, label, ends, format, parse, typed, size = 46, bipolar, disabled, onBegin, onDrag, onEnd, onCancel, onSet, ring, menu, automated, own = value, className }: EqKnobProps) {
  const [dragging, setDragging] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const gradient = `eq-dome-${useId().replace(/:/g, "")}`;
  useWheelValue(element, { value: () => own, min: 0, max: 1, step: (fine) => (fine ? 0.002 : 0.01), onBegin, onDrag, onEnd }, !disabled);
  const pad = ring ? 7 : 0;
  const box = size + pad * 2;
  const c = box / 2;
  const well = size / 2;
  const dome = well - 5;
  const angle = angleOf(value);
  const [tx, ty] = polar(c, dome - 2, angle);
  const commitTyped = () => {
    const fraction = typing === null ? null : parse(typing);
    if (fraction !== null && Number.isFinite(fraction)) onSet(clamp(fraction, 0, 1));
    setTyping(null);
  };

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <PopoverPrimitive.Root open={typing !== null} onOpenChange={(open) => !open && setTyping(null)}>
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={disabled}>
            <PopoverPrimitive.Anchor asChild>
              <div
                ref={element}
                role="slider"
                tabIndex={0}
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={value}
                aria-valuetext={format(value)}
                aria-disabled={disabled || undefined}
                title={`${label}: ${format(value)}${automated ? " (automated)" : ""}`}
                className={cn("group relative shrink-0 touch-none rounded-full outline-none", disabled ? "opacity-40" : "cursor-ns-resize")}
                style={{ width: box, height: box }}
                onDoubleClick={() => !disabled && setTyping(typed(value))}
                onPointerDown={(e) => {
                  if (disabled) return;
                  // Pro-Q resets with Cmd-click; FL Studio with Alt-click or the middle button: all of them.
                  if (e.button === 1 || (e.button === 0 && (e.metaKey || e.ctrlKey || e.altKey))) {
                    e.preventDefault();
                    onSet(defaultValue);
                    return;
                  }
                  // The ring (outside the well): the dynamic range.
                  const rect = e.currentTarget.getBoundingClientRect();
                  const distance = Math.hypot(e.clientX - rect.left - c, e.clientY - rect.top - c);
                  if (ring && distance > well) {
                    const startY = e.clientY;
                    const start = ring.to - ring.from;
                    startPointerDrag(e, {
                      threshold: 1,
                      cursor: "ns-resize",
                      onStart: ring.onBegin,
                      onMove: (ev) => ring.onDrag(start + (startY - ev.clientY) / (ev.shiftKey ? TRAVEL * 10 : TRAVEL)),
                      onEnd: ring.onEnd,
                      onCancel: ring.onCancel,
                    });
                    return;
                  }
                  let anchorY = e.clientY;
                  let anchor = own;
                  let fine = e.shiftKey;
                  let last = own;
                  startPointerDrag(e, {
                    threshold: 1,
                    cursor: "ns-resize",
                    onStart() {
                      setDragging(true);
                      onBegin();
                    },
                    onMove(ev) {
                      // Shift switched mid-drag: carry on from where it is, at the other speed.
                      if (ev.shiftKey !== fine) {
                        fine = ev.shiftKey;
                        anchorY = ev.clientY;
                        anchor = last;
                      }
                      last = clamp(anchor + (anchorY - ev.clientY) / (fine ? TRAVEL * 10 : TRAVEL), 0, 1);
                      onDrag(last);
                    },
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
              >
                <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} className="overflow-visible" aria-hidden>
                  <defs>
                    <radialGradient id={gradient} cx="40%" cy="30%" r="75%">
                      <stop offset="0%" stopColor="var(--eq-knob-light)" />
                      <stop offset="55%" stopColor="var(--eq-knob)" />
                      <stop offset="100%" stopColor="var(--eq-knob-dark)" />
                    </radialGradient>
                  </defs>
                  {ring && (
                    <>
                      <path d={arc(c, well + 3.5, -SWEEP / 2, SWEEP / 2)} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={4} />
                      {Math.abs(ring.to - ring.from) > 0.002 && (
                        <path d={arc(c, well + 3.5, angleOf(ring.from), angleOf(ring.to))} fill="none" stroke="var(--eq-dynamic)" strokeWidth={4} />
                      )}
                      {ring.live !== null && Math.abs(ring.live - ring.from) > 0.002 && (
                        <path d={arc(c, well + 3.5, angleOf(ring.from), angleOf(ring.live))} fill="none" stroke="var(--eq-curve)" strokeWidth={4} />
                      )}
                    </>
                  )}
                  {/* The well, its track, and the value's arc (from the middle for a bipolar knob). */}
                  <circle cx={c} cy={c} r={well} fill="var(--eq-knob-ring)" />
                  <path d={arc(c, well - 2, -SWEEP / 2, SWEEP / 2)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={2.5} />
                  {Math.abs(angle - (bipolar ? 0 : -SWEEP / 2)) > 0.5 && (
                    <path d={arc(c, well - 2, bipolar ? 0 : -SWEEP / 2, angle)} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2.5} />
                  )}
                  <circle cx={c} cy={c} r={dome} fill={`url(#${gradient})`} className="transition-[filter] group-hover:brightness-110" />
                  <circle cx={c} cy={c} r={dome - 0.5} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
                  {/* The tab: a white wedge at the dome's edge, pointing. */}
                  <circle cx={tx} cy={ty} r={Math.max(3, size * 0.09)} fill="#f2f0f3" stroke="rgba(0,0,0,0.3)" strokeWidth={0.5} />
                </svg>
                {automated && <span aria-hidden className="absolute top-0 right-0 size-1.5 rounded-full bg-[var(--eq-curve)]" />}
                {dragging && (
                  <span className="pointer-events-none absolute -top-5 left-1/2 z-20 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-[var(--eq-text)] tabular-nums">
                    {format(value)}
                  </span>
                )}
              </div>
            </PopoverPrimitive.Anchor>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => onSet(defaultValue)}>Reset</ContextMenuItem>
            <ContextMenuItem onSelect={() => setTimeout(() => setTyping(typed(value)), 0)}>Type in value…</ContextMenuItem>
            {menu && <ContextMenuSeparator />}
            {menu}
          </ContextMenuContent>
        </ContextMenu>
        <PopoverContent className="w-32 p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
          <Input
            autoFocus
            aria-label={`${label} value`}
            className="h-7 text-xs"
            value={typing ?? ""}
            onChange={(e) => setTyping(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTyped();
              if (e.key === "Escape") setTyping(null);
              e.stopPropagation();
            }}
          />
        </PopoverContent>
      </PopoverPrimitive.Root>
      {ends && (
        <div className="mt-0.5 flex justify-between text-[9px] leading-none text-[var(--eq-label)] tabular-nums" style={{ width: Math.max(box + 26, 74) }}>
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
      <span className="text-[10px] font-semibold tracking-wider text-[var(--eq-text)]">{label}</span>
    </div>
  );
}

type SongEqKnobProps = Omit<EqKnobProps, "onBegin" | "onDrag" | "onEnd" | "onCancel" | "onSet" | "automated" | "menu" | "own"> & {
  /** The song with this knob at `fraction`. */
  edit: (song: MusicProject, fraction: number) => MusicProject;
  /** The control it is, if it can be automated; and its value as automation has it (a fraction) from its own. */
  target?: AutomationTarget;
  /** Its own value (in the control's units) and back to a fraction, for following automation. */
  automation?: { own: number; toFraction: (value: number) => number };
};

/** A Pro-Q knob on the song: a drag is one undo step, heard as it turns; one that can be automated follows its curve in song mode. */
export function SongEqKnob({ edit, target, automation, value, ...knob }: SongEqKnobProps) {
  const gesture = useRef(songGesture()).current;
  const control = useAutomatedControl(target, automation?.own ?? 0);
  const shown = automation && control.automated ? automation.toFraction(control.value) : value;
  return (
    <EqKnob
      {...knob}
      value={shown}
      own={value}
      automated={control.automated}
      menu={target && <AutomationMenuItems target={target} />}
      onBegin={() => {
        control.hold();
        gesture.begin();
      }}
      onDrag={(fraction) => gesture.apply((song) => edit(song, fraction))}
      onEnd={() => {
        gesture.end();
        control.release();
      }}
      onCancel={() => {
        gesture.cancel();
        control.release();
      }}
      onSet={(fraction) => useMusic.getState().commit((song) => edit(song, fraction))}
    />
  );
}
