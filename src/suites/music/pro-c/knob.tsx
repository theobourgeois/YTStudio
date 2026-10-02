/**
 * Pro-C's controls (`docs/fabfilter/pro-c.md` 2.1), FabFilter's in our drawing: the knob (a dark dome, its
 * value a yellow arc inside its edge; the Threshold's ring is the key's level, the Ratio's dots jump to
 * fixed ratios, Wet's and Dry's thin pan ring), the arc sliders (Knee, Range, Lookahead, Hold) and the bar
 * sliders (Drive, Mix, Host Sync's, the side chain's Level). Each: drag (Shift fine), scroll, double-click to
 * type, Cmd-, Ctrl- or Alt-click to reset (an Alt-drag moves its reverse-linked partner the other way), its
 * menu on a right-click (automation too), its name and value on hover.
 */
import { type CSSProperties, type ReactNode, useId, useRef, useState } from "react";
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
import { draggedPan, panAngle } from "./geometry";

/** Pixels of drag for a control's whole travel (ten times that with Shift). */
const TRAVEL = 200;
/** A knob turns from 7 o'clock round to 5 o'clock. */
const SWEEP = 270;

const polar = (cx: number, cy: number, r: number, degrees: number) => {
  const a = ((degrees - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
};
function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const [x1, y1] = polar(cx, cy, r, a);
  const [x2, y2] = polar(cx, cy, r, b);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}
export const knobAngle = (fraction: number) => -SWEEP / 2 + clamp(fraction, 0, 1) * SWEEP;

// ---------------------------------------------------------------------------
// What every control shares: the gestures, the typing, the menu, the pop-up
// ---------------------------------------------------------------------------

export interface ControlProps {
  /** 0..1 of its travel. */
  value: number;
  defaultValue: number;
  /** Its name (the slider's label, and the pop-up's). */
  label: string;
  /** The value for people, from a fraction. */
  format: (fraction: number) => string;
  /** What's typed, as a fraction (null: not a value); and the value as it's typed. */
  parse?: (text: string) => number | null;
  typed?: (fraction: number) => string;
  /** Greyed (the style decides it): it doesn't turn, but its menu stays. */
  disabled?: boolean;
  /** A drag starts; `alt`: Alt held, for its reverse-linked partner. */
  onBegin: (alt: boolean) => void;
  onDrag: (fraction: number) => void;
  onEnd: () => void;
  onCancel: () => void;
  onSet: (fraction: number) => void;
  menu?: ReactNode;
  automated?: boolean;
  /** Its own value, when what it shows is automation's. */
  own?: number;
  testId?: string;
}

interface ShellProps extends ControlProps {
  /** Which way it's dragged. */
  axis: "vertical" | "horizontal";
  className?: string;
  style?: CSSProperties;
  /** A press it handles itself (a pan ring, a ratio dot): true if it did. */
  onPress?: (e: React.PointerEvent<HTMLDivElement>) => boolean;
  /** Where the pop-up goes: over it, or beside it. */
  popup?: "top" | "right";
  children: ReactNode;
}

/** A control's body: whatever it draws, made a slider that turns, types and has its menu. */
function ControlShell({ value, defaultValue, label, format, parse, typed, disabled, onBegin, onDrag, onEnd, onCancel, onSet, menu, automated, own = value, testId, axis, className, style, onPress, popup = "top", children }: ShellProps) {
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const element = useRef<HTMLDivElement>(null);
  useWheelValue(element, { value: () => own, min: 0, max: 1, step: (fine) => (fine ? 0.002 : 0.01), onBegin: () => onBegin(false), onDrag, onEnd }, !disabled);
  const canType = !!parse && !!typed;
  const commitTyped = () => {
    const fraction = typing === null || !parse ? null : parse(typing);
    if (fraction !== null && Number.isFinite(fraction)) onSet(clamp(fraction, 0, 1));
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
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={value}
              aria-valuetext={format(value)}
              // Greyed by the style, it doesn't turn, but its menu (automation) stays: read-only, not disabled.
              aria-readonly={disabled || undefined}
              data-testid={testId}
              className={cn("group relative shrink-0 touch-none outline-none", disabled ? "cursor-default" : axis === "vertical" ? "cursor-ns-resize" : "cursor-ew-resize", className)}
              style={style}
              onPointerEnter={() => setHover(true)}
              onPointerLeave={() => setHover(false)}
              onDoubleClick={() => !disabled && canType && setTyping(typed!(value))}
              onPointerDown={(e) => {
                if (disabled || e.button === 2) return;
                // FabFilter resets with Cmd-click, FL Studio with Alt-click or the middle button: all of them.
                // (Alt-dragged, it moves its partner the other way instead: the reset is Alt's click.)
                if (e.button === 1 || (e.button === 0 && (e.metaKey || e.ctrlKey))) {
                  e.preventDefault();
                  onSet(defaultValue);
                  return;
                }
                if (onPress?.(e)) return;
                const alt = e.altKey;
                let anchor = axis === "vertical" ? e.clientY : e.clientX;
                let start = own;
                let fine = e.shiftKey;
                let last = own;
                startPointerDrag(e, {
                  threshold: 1,
                  cursor: axis === "vertical" ? "ns-resize" : "ew-resize",
                  onStart() {
                    setDragging(true);
                    onBegin(alt);
                  },
                  onMove(ev) {
                    const at = axis === "vertical" ? ev.clientY : ev.clientX;
                    // Shift switched mid-drag: carry on from where it is, at the other speed.
                    if (ev.shiftKey !== fine) {
                      fine = ev.shiftKey;
                      anchor = at;
                      start = last;
                    }
                    const moved = axis === "vertical" ? anchor - at : at - anchor;
                    last = clamp(start + moved / (fine ? TRAVEL * 10 : TRAVEL), 0, 1);
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
                  onClick() {
                    if (alt) onSet(defaultValue);
                  },
                });
              }}
            >
              {children}
              {automated && <span aria-hidden className="absolute top-0 right-0 size-1.5 rounded-full bg-[var(--comp-arc)]" />}
              {(dragging || (hover && !disabled)) && typing === null && (
                <span
                  className={cn(
                    "pointer-events-none absolute z-30 rounded-sm border border-[var(--comp-panel-edge)] bg-[var(--comp-bar)]/95 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-[var(--comp-text)] tabular-nums shadow-md",
                    popup === "top" ? "-top-6 left-1/2 -translate-x-1/2" : "top-1/2 left-full ml-1.5 -translate-y-1/2",
                  )}
                >
                  <span className="text-[var(--comp-label)]">{label}</span> {format(value)}
                </span>
              )}
            </div>
          </PopoverPrimitive.Anchor>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem disabled={disabled} onSelect={() => onSet(defaultValue)}>
            Reset
          </ContextMenuItem>
          {canType && (
            <ContextMenuItem disabled={disabled} onSelect={() => setTimeout(() => setTyping(typed!(value)), 0)}>
              Type in value…
            </ContextMenuItem>
          )}
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
  );
}

/** A control's caption: its name in FabFilter's small capitals (with an AUTO before it, if it has one). */
export function Caption({ children, className, disabled }: { children: ReactNode; className?: string; disabled?: boolean }) {
  return <div className={cn("mt-1 flex items-center justify-center gap-1 text-[10.5px] leading-none font-medium tracking-[0.09em] whitespace-nowrap text-[var(--comp-text)] uppercase [text-shadow:0_1px_3px_rgb(0_0_0/0.95),0_0_6px_rgb(0_0_0/0.8)]", disabled && "opacity-40", className)}>{children}</div>;
}

/** An AUTO before a caption: lit (yellow) when on, a click toggles it (Pro-C's Auto Threshold, Auto Release, Auto Gain). */
export function AutoToggle({ on, label, onToggle, testId }: { on: boolean; label: string; onToggle: () => void; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn("tracking-[0.09em] uppercase transition-colors outline-none", on ? "text-[var(--comp-arc)]" : "text-[var(--comp-label)] hover:text-[var(--comp-text)]")}
      onClick={onToggle}
    >
      Auto
    </button>
  );
}

// ---------------------------------------------------------------------------
// The knob
// ---------------------------------------------------------------------------

/** The Threshold's ring: the key's level as a fraction of the knob's travel (null: nothing heard), and whether it's near the threshold. */
export interface KeyRing {
  fraction: number | null;
  hot: boolean;
}

/** A pan ring (Wet's mid / side, Dry's and the output panel's left / right): a dot on a thin ring, dragged up and down. */
export interface PanRing {
  value: number;
  label: string;
  format: (pan: number) => string;
  onBegin: () => void;
  onDrag: (pan: number) => void;
  onEnd: () => void;
  onCancel: () => void;
  onSet: (pan: number) => void;
}

export interface CompKnobProps extends ControlProps {
  size?: number;
  bipolar?: boolean;
  ring?: KeyRing;
  pan?: PanRing;
  /** Dots round it that jump to a value (the Ratio's). */
  dots?: { fraction: number; label: string }[];
  caption?: ReactNode;
}

export function CompKnob({ size = 64, bipolar, ring, pan, dots, caption, ...control }: CompKnobProps) {
  const gradient = `comp-dome-${useId().replace(/:/g, "")}`;
  const pad = ring || dots || pan ? 9 : 3;
  const box = size + pad * 2;
  const c = box / 2;
  const dome = size / 2;
  const angle = knobAngle(control.value);
  const small = !!pan;
  const arcR = dome - (small ? 5 : 6);
  const [dx, dy] = polar(c, c, small ? dome - 10 : dome - 12, angle);
  const from = bipolar ? 0 : -SWEEP / 2;

  /** A press on the pan ring or a ratio dot, outside the dome. */
  const onPress = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const distance = Math.hypot(x - c, y - c);
    if (dots && distance > dome - 2) {
      let best: { fraction: number; d: number } | null = null;
      for (const dot of dots) {
        const [px, py] = polar(c, c, dome + 5, knobAngle(dot.fraction));
        const d = Math.hypot(px - x, py - y);
        if (d < 7 && (!best || d < best.d)) best = { fraction: dot.fraction, d };
      }
      if (best) {
        control.onSet(best.fraction);
        return true;
      }
    }
    if (pan && distance > dome - 1) {
      if (e.altKey) {
        pan.onSet(0);
        return true;
      }
      const startY = e.clientY;
      const start = pan.value;
      startPointerDrag(e, {
        threshold: 1,
        cursor: "ns-resize",
        onStart: pan.onBegin,
        onMove: (ev) => pan.onDrag(draggedPan(start, startY - ev.clientY, ev.shiftKey)),
        onEnd: pan.onEnd,
        onCancel: pan.onCancel,
      });
      return true;
    }
    return false;
  };

  const panAt = pan ? panAngle(pan.value) : 0;
  const [panX, panY] = polar(c, c, dome + 5, panAt);
  return (
    <div className="flex flex-col items-center">
      <ControlShell {...control} axis="vertical" className="rounded-full" style={{ width: box, height: box }} onPress={onPress}>
        <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} className={cn("overflow-visible", control.disabled && "opacity-35")} aria-hidden>
          <defs>
            <radialGradient id={gradient} cx="38%" cy="28%" r="80%">
              <stop offset="0%" stopColor="var(--comp-knob-light)" />
              <stop offset="55%" stopColor="var(--comp-knob)" />
              <stop offset="100%" stopColor="var(--comp-knob-dark)" />
            </radialGradient>
          </defs>
          {ring && (
            <>
              <path d={arcPath(c, c, dome + 5, -SWEEP / 2, SWEEP / 2)} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={4} strokeLinecap="round" />
              {ring.fraction !== null && ring.fraction > 0.004 && (
                <path d={arcPath(c, c, dome + 5, -SWEEP / 2, knobAngle(ring.fraction))} fill="none" stroke={ring.hot ? "var(--comp-ring-hot)" : "var(--comp-ring)"} strokeWidth={4} strokeLinecap="round" />
              )}
            </>
          )}
          {dots?.map((dot) => {
            const [px, py] = polar(c, c, dome + 5, knobAngle(dot.fraction));
            const on = Math.abs(dot.fraction - control.value) < 0.004;
            return <circle key={dot.label} cx={px} cy={py} r={on ? 2.2 : 1.6} fill={on ? "var(--comp-arc)" : "var(--comp-label)"} />;
          })}
          {pan && (
            <>
              <circle cx={c} cy={c} r={dome + 5} fill="none" stroke="var(--comp-knob-edge)" strokeWidth={1.5} />
              <circle cx={panX} cy={panY} r={2.4} fill="var(--comp-arc)" />
            </>
          )}
          {/* A soft shadow under the dome, the dome, its rim. */}
          <circle cx={c} cy={c + 1.5} r={dome} fill="rgba(0,0,0,0.45)" />
          <circle cx={c} cy={c} r={dome} fill={`url(#${gradient})`} className="transition-[filter] group-hover:brightness-125" />
          <circle cx={c} cy={c} r={dome - 0.5} fill="none" stroke="var(--comp-knob-edge)" strokeWidth={1} />
          {!small && (
            <>
              <path d={arcPath(c, c, arcR, -SWEEP / 2, SWEEP / 2)} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={3} strokeLinecap="round" />
              {Math.abs(angle - from) > 0.5 && <path d={arcPath(c, c, arcR, from, angle)} fill="none" stroke="var(--comp-arc)" strokeWidth={3} strokeLinecap="round" />}
            </>
          )}
          <circle cx={dx} cy={dy} r={small ? 2.6 : 2.2} fill="var(--comp-arc)" />
        </svg>
      </ControlShell>
      {caption !== undefined ? caption : <Caption disabled={control.disabled}>{control.label}</Caption>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The arc slider and the bar slider
// ---------------------------------------------------------------------------

/** Knee, Range, Lookahead, Hold: a shallow arc, its value a yellow stretch along it. */
export function ArcSlider({ width = 104, caption, ...control }: ControlProps & { width?: number; caption?: ReactNode }) {
  const h = 18;
  const sag = 7;
  // A quadratic curve dipping in the middle: the point at t along it.
  const at = (t: number) => ({ x: 4 + t * (width - 8), y: 4 + 4 * sag * t * (1 - t) });
  const path = (t0: number, t1: number) => {
    const n = 24;
    let d = "";
    for (let i = 0; i <= n; i++) {
      const p = at(t0 + ((t1 - t0) * i) / n);
      d += `${i ? "L" : "M"} ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
    }
    return d;
  };
  const v = clamp(control.value, 0, 1);
  const tip = at(v);
  return (
    <div className="flex flex-col items-center">
      <ControlShell {...control} axis="horizontal" style={{ width, height: h }}>
        <svg width={width} height={h} className={cn("overflow-visible", control.disabled && "opacity-35")} aria-hidden>
          <path d={path(0, 1)} fill="none" stroke="var(--comp-knob-edge)" strokeWidth={1.5} strokeLinecap="round" />
          {v > 0.003 && <path d={path(0, v)} fill="none" stroke="var(--comp-arc)" strokeWidth={3} strokeLinecap="round" />}
          <circle cx={tip.x} cy={tip.y} r={2.6} fill={v > 0.003 ? "var(--comp-arc)" : "var(--comp-label)"} className="transition-transform group-hover:scale-125" style={{ transformOrigin: `${tip.x}px ${tip.y}px` }} />
        </svg>
      </ControlShell>
      {caption !== undefined ? caption : <Caption disabled={control.disabled}>{control.label}</Caption>}
    </div>
  );
}

/** A bar slider (Drive, Mix, Offset, Length), FabFilter's: a dark track filled yellow to its value; vertical for the side chain's Level. */
export function BarSlider({ length = 110, vertical, colour = "var(--comp-arc)", bipolar, ...control }: ControlProps & { length?: number; vertical?: boolean; colour?: string; bipolar?: boolean }) {
  const v = clamp(control.value, 0, 1);
  const from = bipolar ? 0.5 : 0;
  const [lo, hi] = v < from ? [v, from] : [from, v];
  return (
    <ControlShell {...control} axis={vertical ? "vertical" : "horizontal"} popup={vertical ? "right" : "top"} style={vertical ? { width: 16, height: length } : { width: length, height: 12 }}>
      <div className={cn("absolute rounded-full border border-black/40 bg-black/45 shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]", vertical ? "inset-y-0 left-1/2 w-[6px] -translate-x-1/2" : "inset-x-0 top-1/2 h-[6px] -translate-y-1/2", control.disabled && "opacity-35")}>
        <div className="absolute rounded-full" style={vertical ? { left: 0, right: 0, bottom: `${lo * 100}%`, top: `${(1 - hi) * 100}%`, background: colour } : { top: 0, bottom: 0, left: `${lo * 100}%`, right: `${(1 - hi) * 100}%`, background: colour }} />
      </div>
      {vertical && (
        <div
          className="absolute left-1/2 h-[9px] w-[18px] -translate-x-1/2 translate-y-1/2 rounded-[3px] border border-black/50 bg-gradient-to-b from-[var(--comp-handle-top)] to-[var(--comp-handle-bottom)] shadow-md"
          style={{ bottom: `${v * 100}%` }}
        />
      )}
    </ControlShell>
  );
}

// ---------------------------------------------------------------------------
// On the song
// ---------------------------------------------------------------------------

export interface SongControlOptions {
  /** The song with this control at `fraction`. */
  edit: (song: MusicProject, fraction: number) => MusicProject;
  /** The control it is, if it can be automated. */
  target?: AutomationTarget;
  /** Its own value in the control's units, and back to a fraction, for following automation (else it turns by automation's fraction). */
  automation?: { own: number; toFraction: (value: number) => number };
  /** Alt-dragged: its reverse-linked partner moves the other way (Wet ↔ Dry, Input ↔ Output, Threshold ↔ Drive). Called as the drag starts, from the song then. */
  linked?: (song: MusicProject) => (song: MusicProject, fraction: number) => MusicProject;
}

/** A control on the song: a drag is one undo step, heard as it turns; an automatable one follows its curve in song mode. */
export function useSongControl(value: number, { edit, target, automation, linked }: SongControlOptions) {
  const gesture = useRef(songGesture()).current;
  const link = useRef<((song: MusicProject, fraction: number) => MusicProject) | null>(null);
  const control = useAutomatedControl(target, automation?.own ?? value, automation ? "control" : "fraction");
  const shown = control.automated ? (automation ? automation.toFraction(control.value) : control.value) : value;
  return {
    value: shown,
    own: value,
    automated: control.automated,
    menu: target ? <AutomationMenuItems target={target} /> : undefined,
    onBegin(alt: boolean) {
      const song = useMusic.getState().history?.doc;
      link.current = alt && linked && song ? linked(song) : null;
      control.hold();
      gesture.begin();
    },
    onDrag: (fraction: number) => gesture.apply((song) => (link.current ? link.current(edit(song, fraction), fraction) : edit(song, fraction))),
    onEnd() {
      gesture.end();
      control.release();
    },
    onCancel() {
      gesture.cancel();
      control.release();
    },
    onSet: (fraction: number) => useMusic.getState().commit((song) => edit(song, fraction)),
  };
}

type SongProps<P> = Omit<P, "onBegin" | "onDrag" | "onEnd" | "onCancel" | "onSet" | "automated" | "menu" | "own"> & SongControlOptions;

export function SongCompKnob({ edit, target, automation, linked, ...knob }: SongProps<CompKnobProps>) {
  return <CompKnob {...knob} {...useSongControl(knob.value, { edit, target, automation, linked })} />;
}
export function SongArcSlider({ edit, target, automation, linked, ...slider }: SongProps<ControlProps & { width?: number; caption?: ReactNode }>) {
  return <ArcSlider {...slider} {...useSongControl(slider.value, { edit, target, automation, linked })} />;
}
export function SongBarSlider({ edit, target, automation, linked, ...slider }: SongProps<ControlProps & { length?: number; vertical?: boolean; colour?: string; bipolar?: boolean }>) {
  return <BarSlider {...slider} {...useSongControl(slider.value, { edit, target, automation, linked })} />;
}

/** A pan ring on the song: a drag one undo step. */
export function useSongPan(value: number, label: string, format: (pan: number) => string, edit: (song: MusicProject, pan: number) => MusicProject): PanRing {
  const gesture = useRef(songGesture()).current;
  return {
    value,
    label,
    format,
    onBegin: () => gesture.begin(),
    onDrag: (pan) => gesture.apply((song) => edit(song, Math.round(pan * 100) / 100)),
    onEnd: () => gesture.end(),
    onCancel: () => gesture.cancel(),
    onSet: (pan) => useMusic.getState().commit((song) => edit(song, pan)),
  };
}
