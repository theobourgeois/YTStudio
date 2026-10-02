/**
 * EchoBoy's controls, its layout's pieces in our look: a knob with its name over it and its ends under it
 * ("DRY", "WET"), an echo's time (its knob, Time / Note / Dot / Trip, its LCD with nudge arrows), the
 * LED meters under Input and Output, an LCD that opens a menu (the style, the shapes), a toggle with its
 * light, and the Mode dial.
 */
import { type ReactNode, useRef } from "react";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import { cn } from "cn";
import { ECHO_CONTROL_SPECS, NOTE_STEPS, editEchoBoy, parseEchoTime, timeText, updateEchoBoy } from "@shared/music/echo-boy";
import { MAX_ECHO_MS } from "@shared/music/echo-boy-presets";
import { type AutomationTarget, ECHO_MODES, type EchoBoy, type EchoMode, type EchoSync, type EchoTime, type MusicProject } from "@shared/music/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type ValueUnit, SongKnob } from "../knob";
import { Lcd } from "../lcd";
import { songGesture, useMusic } from "../store";
import { useTransport } from "../transport";

const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);

/** A small caption, EchoBoy's engraved labels. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[9px] leading-none font-semibold tracking-[0.08em] text-muted-foreground uppercase", className)}>{children}</span>;
}

interface EchoKnobProps {
  label: string;
  /** The words at its ends, under it ("Dry", "Wet"; "Min", "Max"). */
  ends?: [string, string];
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  format: (value: number) => string;
  unit: ValueUnit;
  bipolar?: boolean;
  size?: number;
  target?: AutomationTarget;
  /** It turns by its automation's fraction (a tapered knob: the cuts). */
  fraction?: boolean;
  edit: (song: MusicProject, value: number) => MusicProject;
  className?: string;
}

/** A knob as EchoBoy lays them out: its name over it, its ends under it. */
export function EchoKnob({ label, ends, size = 40, className, ...knob }: EchoKnobProps) {
  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <Caption className="text-foreground/80">{label}</Caption>
      <SongKnob size={size} label={label} {...knob} />
      {ends && (
        <div className="flex w-full min-w-14 justify-between gap-2 px-0.5">
          <Caption className="text-[8px]">{ends[0]}</Caption>
          <Caption className="text-[8px]">{ends[1]}</Caption>
        </div>
      )}
    </div>
  );
}

/** A small key (EchoBoy's beige buttons: Time, Note, Dot, Trip; Tweak, Style Edit), lit while it's on. */
export function Key({ on, label, title, onClick, className }: { on?: boolean; label: string; title?: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title ?? label}
      className={cn("h-[18px] min-w-[30px] rounded-sm px-0.5 text-[9px] font-semibold tracking-wide uppercase", on ? "pressed text-brand" : "raised text-muted-foreground hover:raised-hover hover:text-foreground", className)}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** A toggle with its light (Prime Numbers, MIDI, the wobble's FB and Out, Loop / Post). */
export function Toggle({ on, label, onChange, title }: { on: boolean; label: string; onChange: (on: boolean) => void; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title ?? label}
      className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 hover:bg-surface-2"
      onClick={() => onChange(!on)}
    >
      <span aria-hidden className={cn("size-2 rounded-full border border-black/30", on ? "bg-brand shadow-[0_0_6px_var(--brand)]" : "bg-surface-3")} />
      <Caption className={on ? "text-foreground" : undefined}>{label}</Caption>
    </button>
  );
}

/** An LCD that opens a menu (the style, the pan and rhythm shapes, the wobble's, the saturation's). */
export function LcdMenu({ label, text, children, className, testId }: { label: string; text: string; children: ReactNode; className?: string; testId?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`${label}: ${text}`} data-testid={testId} className={cn("lcd flex h-6 min-w-0 items-center gap-1 rounded px-1.5 font-mono text-[11px] tabular-nums", className)}>
          <PiCaretDown className="size-2.5 shrink-0 opacity-70" />
          <span className="truncate">{text}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 overflow-y-auto">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SYNCS: { sync: EchoSync; label: string; title: string }[] = [
  { sync: "time", label: "Time", title: "Milliseconds: turning it bends the pitch, as tape does" },
  { sync: "note", label: "Note", title: "A note value at the tempo" },
  { sync: "dot", label: "Dot", title: "A dotted note value" },
  { sync: "trip", label: "Trip", title: "A triplet note value" },
];

/** Time, Note, Dot, Trip: how an echo's time is set. */
export function SyncKeys({ value, onChange, extra }: { value: EchoSync; onChange: (sync: EchoSync) => void; extra?: ReactNode }) {
  return (
    <div className="flex gap-0.5" role="radiogroup" aria-label="Time or note value">
      {SYNCS.map((s) => (
        <Key key={s.sync} on={value === s.sync} label={s.label} title={s.title} onClick={() => onChange(s.sync)} />
      ))}
      {extra}
    </div>
  );
}

/** An echo time's LCD: dragged or nudged a ms (or a note value) at a time, typed in ("126.2", "1/8 dot"). */
export function TimeLcd({ time, label, edit, testId }: { time: EchoTime; label: string; edit: (song: MusicProject, patch: Partial<EchoTime>) => MusicProject; testId?: string }) {
  const gesture = useRef(songGesture()).current;
  const ms = time.sync === "time";
  // The LCD's steps: ms, or note values (up is a longer note, as the knob turns).
  const last = NOTE_STEPS.length - 1;
  const value = ms ? Math.round(time.ms) : last - NOTE_STEPS.indexOf(time.note);
  const patchFor = (v: number): Partial<EchoTime> => (ms ? { ms: v } : { note: NOTE_STEPS[last - v] });
  const nudge = (by: number) => commit((s) => edit(s, patchFor(Math.max(0, Math.min(ms ? MAX_ECHO_MS : last, value + by)))));
  return (
    <div className="flex items-center gap-0.5" data-testid={testId}>
      <div className="flex flex-col">
        <button type="button" aria-label={`${label}: up`} className="grid h-3 w-3.5 place-items-center rounded-t-sm raised hover:raised-hover" onClick={() => nudge(1)}>
          <PiCaretUp className="size-2" />
        </button>
        <button type="button" aria-label={`${label}: down`} className="grid h-3 w-3.5 place-items-center rounded-b-sm raised hover:raised-hover" onClick={() => nudge(-1)}>
          <PiCaretDown className="size-2" />
        </button>
      </div>
      <Lcd
        value={value}
        min={0}
        max={ms ? MAX_ECHO_MS : last}
        label={label}
        text={timeText(time)}
        className="lcd h-6 w-[84px] justify-start rounded border-0 text-[11px]"
        typeIn={{
          initial: timeText(time),
          onType: (text) => {
            const parsed = parseEchoTime(text);
            if (parsed) commit((s) => edit(s, parsed));
          },
        }}
        onBegin={() => gesture.begin()}
        onChange={(v) => gesture.apply((s) => edit(s, patchFor(v)))}
        onEnd={() => gesture.end()}
        onCancel={() => gesture.cancel()}
      />
    </div>
  );
}

/** An echo's time: its knob, its keys, its LCD, as EchoBoy lays out Echo 1 and Echo 2 (and Single's Echo Time). */
export function EchoTimeControl({ effectId, eb, which, label }: { effectId: string; eb: EchoBoy; which: "echo1" | "echo2"; label: string }) {
  const spec = ECHO_CONTROL_SPECS[which];
  const time = eb[which];
  const edit = (song: MusicProject, patch: Partial<EchoTime>) => updateEchoBoy(song, effectId, { [which]: patch });
  return (
    <div className="flex flex-col items-center gap-1" data-testid={`echo-time-${which}`}>
      <EchoKnob
        label={label}
        size={44}
        value={spec.get(eb)}
        min={0}
        max={1}
        defaultValue={spec.get({ ...eb, [which]: { ...time, ms: 250, note: 8 } })}
        format={(v) => spec.format(v, eb)}
        unit={{ scale: 100, unit: "%" }}
        target={{ kind: "echoBoy", effect: effectId, control: which }}
        edit={(s, v) => editEchoBoy(s, effectId, (e) => spec.set(e, v))}
      />
      <SyncKeys value={time.sync} onChange={(sync) => commit((s) => edit(s, { sync }))} />
      <TimeLcd time={time} label={label} edit={edit} testId={`echo-lcd-${which}`} />
    </div>
  );
}

/** The LEDs' levels (dB): four green, a yellow (6 dB below clipping), a red (clipping). */
const LEDS = [-36, -24, -18, -12, -6, -0.5];
const toDb = (level: number) => (level > 0 ? 20 * Math.log10(level) : -Infinity);

/** EchoBoy's six LEDs under Input or Output, from what the engine last said it heard. */
export function Leds({ effectId, which }: { effectId: string; which: "input" | "output" }) {
  const level = useTransport((s) => {
    const said = s.echoBoys[effectId]?.[which];
    // Rounded to the LEDs' steps, so the store's 25 updates a second don't redraw this for nothing.
    const db = said ? toDb(Math.max(said[0], said[1])) : -Infinity;
    return LEDS.filter((at) => db >= at).length;
  });
  return (
    <div className="flex gap-[3px]" aria-label={`${which === "input" ? "Input" : "Output"} level`} role="meter" aria-valuenow={level} aria-valuemin={0} aria-valuemax={LEDS.length}>
      {LEDS.map((_, i) => (
        <span
          key={i}
          aria-hidden
          className="size-[7px] rounded-full border border-black/30"
          style={{ background: i < level ? (i === 5 ? "var(--meter-high)" : i === 4 ? "var(--meter-mid)" : "var(--meter-low)") : "var(--meter-off)" }}
        />
      ))}
    </div>
  );
}

const MODE_NAMES: Record<EchoMode, string> = { single: "Single Echo", dual: "Dual Echo", pingPong: "Ping-Pong", rhythm: "Rhythm Echo" };
/** Where the dial points for each mode (degrees from 12 o'clock), and where its name sits. */
const MODE_PLACES: Record<EchoMode, { angle: number; className: string }> = {
  dual: { angle: -50, className: "top-0 right-[calc(50%+14px)]" },
  pingPong: { angle: 50, className: "top-0 left-[calc(50%+14px)]" },
  single: { angle: -90, className: "top-[22px] right-[calc(50%+22px)]" },
  rhythm: { angle: 90, className: "top-[22px] left-[calc(50%+22px)]" },
};

/** The Mode dial: a click on a mode's name (or the dial, to the next) picks it. */
export function ModeDial({ value, onChange }: { value: EchoMode; onChange: (mode: EchoMode) => void }) {
  const angle = MODE_PLACES[value].angle;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-[46px] w-[230px]" role="radiogroup" aria-label="Mode">
        {ECHO_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={value === mode}
            className={cn("absolute text-[9px] font-semibold tracking-wide whitespace-nowrap uppercase", MODE_PLACES[mode].className, value === mode ? "text-brand" : "text-muted-foreground hover:text-foreground")}
            onClick={() => onChange(mode)}
          >
            {MODE_NAMES[mode]}
          </button>
        ))}
        <button
          type="button"
          aria-label={`Mode: ${MODE_NAMES[value]} (click for the next)`}
          className="absolute top-[12px] left-1/2 size-8 -translate-x-1/2 rounded-full"
          onClick={() => onChange(ECHO_MODES[(ECHO_MODES.indexOf(value) + 1) % ECHO_MODES.length])}
        >
          <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
            <circle cx="16" cy="16" r="14" fill="var(--knob-cap)" stroke="var(--knob-cap-edge)" />
            <g transform={`rotate(${angle} 16 16)`}>
              <rect x="14.5" y="2" width="3" height="11" rx="1.5" fill="var(--knob-notch)" />
            </g>
          </svg>
        </button>
      </div>
      <Caption>Mode</Caption>
    </div>
  );
}

export const modeName = (mode: EchoMode) => MODE_NAMES[mode];
