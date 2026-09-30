import { type ReactNode, useEffect, useRef, useState } from "react";
import { PiArrowUUpLeft, PiArrowUUpRight, PiMetronome, PiPianoKeys, PiPlayFill, PiRows, PiStopFill, PiWarning } from "react-icons/pi";
import { cn } from "cn";
import { lengthOf, setTempo } from "@shared/music/edits";
import { MAX_TEMPO, MIN_TEMPO, stepsPerBar } from "@shared/music/project";
import { PPQ, STEP_TICKS } from "@shared/music/types";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { SettleButton, SettledBadge, SidebarLead } from "@/components/header/header";
import { ProjectName } from "@/components/header/project-name";
import { ThemeMenu } from "@/components/header/theme-menu";
import { Button } from "@/components/ui/button";
import { Toggle, toggleVariants } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { canRedo, canUndo } from "@/lib/document-history";
import { startPointerDrag } from "@/lib/pointer-drag";
import { AudioDialog } from "./audio-dialog";
import { PatternPicker } from "./pattern-picker";
import { openPianoRoll } from "./piano/actions";
import { positionAt, positionText } from "./position";
import { songGesture, useCurrentPattern, useMusic, useSong } from "./store";
import { patternTickNow, useTransport } from "./transport";
import { useMusicUi } from "./ui";

/**
 * The music editor's toolbar, FL Studio's (`docs/fl-studio/toolbar.md`), with only what Vaudio does: the
 * title and the hint bar, the transport (play, stop, the metronome, tempo, position), the windows,
 * the pattern selector and the song position, the engine's load and output, and at the right end the
 * app's own (undo, theme, Settle, the assistant). In the middle, two rows: the transport and the
 * monitors above, the windows, the pattern and the song position below; groups apart by grooves.
 */
export function MusicToolbar() {
  const name = useSong((song) => song.name);
  const error = useTransport((s) => s.error);

  return (
    <header data-titlebar="header" className="flex h-[98px] shrink-0 items-stretch gap-3 border-b border-line bg-surface-1 px-3 py-2 select-none">
      <div className="flex items-center">
        <SidebarLead />
      </div>
      <div className="flex w-36 min-w-20 flex-col justify-center gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <ProjectName name={name} onRename={(next) => void useMusic.getState().rename(next)} className="-ml-1 h-7 px-1 text-[14px]" />
          <SettledBadge />
        </div>
        <HintBar />
      </div>
      <Groove />

      {/* Two rows: what plays and what it sounds like, then what's shown and where in it. */}
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex h-10 min-w-0 items-center gap-2">
          <div className="flex items-center gap-2" role="toolbar" aria-label="Transport">
            <PlayButtons />
            <MetronomeToggle />
            <TempoLcd />
            <PositionLcd />
          </div>
          <Groove className="mx-1 h-8 self-center" />
          <Monitor />
          <AudioDialog />
          {error && (
            <span className="flex max-w-60 min-w-0 items-center gap-1.5 text-xs text-destructive" role="alert" title={error}>
              <PiWarning className="shrink-0" />
              <span className="truncate">{error}</span>
            </span>
          )}
        </div>
        <div className="flex h-8 min-w-0 items-center gap-2">
          <div className="flex items-center gap-1">
            <WindowToggles />
          </div>
          <Groove className="mx-1 h-6 self-center" />
          <div className="w-60 shrink-0">
            <PatternPicker />
          </div>
          <PositionSlider />
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Groove className="mr-1.5 h-6 self-center" />
        <HistoryButtons />
        <Groove className="mx-1.5 h-6 self-center" />
        <ThemeMenu />
        <div className="ml-1.5 flex items-center">
          <SettleButton />
        </div>
        <Groove className="mx-1.5 h-6 self-center" />
        <AssistantButton />
      </div>
    </header>
  );
}

/** A groove between groups: a dark line with a lit one beside it. */
function Groove({ className }: { className?: string }) {
  return <div aria-hidden className={cn("w-px shrink-0 self-stretch bg-line shadow-[1px_0_0_var(--bevel-highlight)]", className)} />;
}

/**
 * FL Studio's hint bar: what's under the pointer, anywhere in the music editor, from its title (or its
 * accessible name). Only the text changes, as the pointer crosses into another control.
 */
function HintBar() {
  const [hint, setHint] = useState("");
  useEffect(() => {
    const root = document.querySelector('[data-suite="music"]');
    if (!root) return;
    const over = (e: Event) => {
      const target = (e.target as Element).closest?.("[title], [aria-label]");
      setHint(target && root.contains(target) ? (target.getAttribute("title") ?? target.getAttribute("aria-label") ?? "") : "");
    };
    const leave = () => setHint("");
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerleave", leave);
    return () => {
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <div className="truncate text-[11px] leading-4 text-muted-foreground" aria-live="off" data-testid="hint-bar">
      {hint || " "}
    </div>
  );
}

/** Play (lit while playing; pressed again it stops, there's no pause yet) and Stop. */
function PlayButtons() {
  const playing = useTransport((s) => s.playing);
  return (
    <div className="flex items-center gap-1">
      <Tip text="Play (Space)">
        <Button
          size="icon"
          variant={playing ? "default" : "outline"}
          className="size-10"
          aria-label="Play"
          aria-pressed={playing}
          onClick={() => useTransport.getState().toggle()}
        >
          <PiPlayFill className="size-[18px]" />
        </Button>
      </Tip>
      <Tip text="Stop (Space)">
        <Button size="icon" variant="outline" className="size-10" aria-label="Stop" onClick={() => useTransport.getState().stop()}>
          <PiStopFill className="size-[18px]" />
        </Button>
      </Tip>
    </div>
  );
}

/** Pixels of drag per beat per minute on the tempo LCD. */
const TEMPO_DRAG = 4;

/**
 * The tempo, FL Studio's LCD: dragged up and down (one undo step), or clicked to type it (Enter or
 * leaving the field sets it, Escape doesn't; the arrow keys nudge it).
 */
function TempoLcd() {
  const tempo = useSong((song) => song.settings.tempo);
  const [draft, setDraft] = useState<string | null>(null);
  const gesture = useRef(songGesture()).current;
  const set = (value: number) => useMusic.getState().commit((song) => setTempo(song, value));

  return (
    <Lcd label="BPM" className="w-[76px]">
      <input
        aria-label="Tempo"
        title="Tempo: drag up and down, or click to type it"
        inputMode="decimal"
        className="w-full cursor-ns-resize bg-transparent text-right font-mono text-[18px] leading-none tabular-nums outline-none focus:cursor-text"
        value={draft ?? String(tempo)}
        onPointerDown={(e) => {
          const input = e.currentTarget;
          // While typing, the pointer places the caret.
          if (document.activeElement === input || e.button !== 0) return;
          e.preventDefault();
          const origin = e.clientY;
          const start = Math.round(tempo);
          startPointerDrag(e, {
            threshold: 3,
            cursor: "ns-resize",
            onStart: () => gesture.begin(),
            onMove: (ev) => {
              const value = Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, start + Math.round((origin - ev.clientY) / TEMPO_DRAG)));
              gesture.apply((song) => setTempo(song, value));
            },
            onEnd: () => gesture.end(),
            onCancel: () => gesture.cancel(),
            onClick: () => input.focus(),
          });
        }}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          if (draft !== null) set(Number(draft));
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(null);
            // After the draft is dropped, or the blur would set it.
            const input = e.currentTarget;
            requestAnimationFrame(() => input.blur());
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setDraft(null);
            set(Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(tempo) + (e.key === "ArrowUp" ? 1 : -1))));
          }
        }}
      />
    </Lcd>
  );
}

/** A recessed number display with its small label in the corner, as FL Studio's toolbar has. */
function Lcd({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("sunken relative flex h-10 items-end rounded-sm px-2 pt-3 pb-2", className)}>
      <span className="pointer-events-none absolute top-0.5 right-1.5 text-[8px] leading-none font-semibold tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Where play is now (or starts), frame by frame while it plays, written straight into the display. */
function usePlayTick(onTick: (tick: number) => void) {
  const playing = useTransport((s) => s.playing);
  const startTick = useTransport((s) => s.startTick);
  const tempo = useSong((song) => song.settings.tempo);
  const latest = useRef(onTick);
  latest.current = onTick;
  useEffect(() => {
    if (!playing) {
      latest.current(startTick);
      return;
    }
    let frame = 0;
    const draw = () => {
      latest.current(patternTickNow(useTransport.getState(), performance.now(), tempo, PPQ) ?? startTick);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing, startTick, tempo]);
}

/** FL Studio's position display, in bars:steps:ticks. */
function PositionLcd() {
  const barSteps = useSong((song) => stepsPerBar(song.settings.timeSignature));
  const text = useRef<HTMLSpanElement>(null);
  usePlayTick((tick) => {
    if (text.current) text.current.textContent = positionText(tick, barSteps);
  });
  return (
    <Lcd label="B:S:T" className="w-[96px] justify-end">
      <span ref={text} className="font-mono text-[18px] leading-none tabular-nums" title="Where the pattern is playing, or where play starts (bar:step:tick)" aria-label="Position">
        1:01:00
      </span>
    </Lcd>
  );
}

/** The song position slider's thumb, in px. */
const THUMB = 16;

/**
 * The song position slider: along the pattern, where play is (it moves while playing), lit with the
 * accent up to there. A press or a drag moves play there, to the step (the thumb follows the pointer
 * while it's held); the arrow keys move it a step, Home and End to the ends.
 */
function PositionSlider() {
  const patternTicks = useCurrentPattern((pattern, song) => lengthOf(song, pattern) * STEP_TICKS);
  const thumb = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const held = useRef(false);
  /** Where this press last sent play: while playing, each jump restarts the engine there, so only a new step does. */
  const sent = useRef<number | null>(null);
  const [now, setNow] = useState(0);
  const show = (fraction: number) => {
    const x = fraction * Math.max(0, (track.current?.clientWidth ?? 0) - THUMB);
    if (thumb.current) thumb.current.style.transform = `translateX(${x}px)`;
    if (fill.current) fill.current.style.width = fraction > 0 ? `${x + THUMB / 2}px` : "0px";
  };
  usePlayTick((tick) => {
    if (held.current) return;
    show(patternTicks > 0 ? Math.min(1, Math.max(0, tick / patternTicks)) : 0);
  });
  const jump = (tick: number) => {
    setNow(tick);
    if (tick === sent.current) return;
    sent.current = tick;
    useTransport.getState().jumpTo(tick);
  };
  const moveTo = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left - THUMB / 2) / Math.max(1, rect.width - THUMB)));
    show(fraction);
    jump(positionAt(fraction, patternTicks));
  };
  const lastStep = Math.max(0, patternTicks - STEP_TICKS);
  return (
    <div
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label="Song position"
      aria-valuemin={0}
      aria-valuemax={patternTicks}
      aria-valuenow={now}
      title="Song position: drag to move where play is"
      className="relative ml-1 h-6 max-w-[520px] min-w-24 flex-1 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        held.current = true;
        sent.current = null;
        moveTo(e.clientX);
        const release = () => {
          held.current = false;
          // On its step, if it's not playing (playing, the next frame puts it where play is).
          const tick = useTransport.getState().startTick;
          if (patternTicks > 0) show(tick / patternTicks);
        };
        const started = startPointerDrag(e, { threshold: 0, onMove: (ev) => moveTo(ev.clientX), onEnd: release, onCancel: release, onClick: release });
        if (!started) release();
      }}
      onKeyDown={(e) => {
        const from = useTransport.getState().startTick;
        const to =
          e.key === "ArrowLeft" || e.key === "ArrowDown" ? from - STEP_TICKS
          : e.key === "ArrowRight" || e.key === "ArrowUp" ? from + STEP_TICKS
          : e.key === "Home" ? 0
          : e.key === "End" ? lastStep
          : null;
        if (to === null) return;
        e.preventDefault();
        e.stopPropagation();
        sent.current = null;
        jump(Math.min(lastStep, Math.max(0, to)));
      }}
    >
      <div className="sunken absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full">
        <div ref={fill} className="h-full w-0 rounded-full bg-brand" />
      </div>
      <div ref={thumb} className="raised absolute top-1 left-0 size-4 rounded-full" />
    </div>
  );
}

function MetronomeToggle() {
  const metronome = useTransport((s) => s.metronome);
  return (
    <Toggle className="size-10 min-w-10 px-0 [&_svg:not([class*=size-])]:size-5" pressed={metronome} onPressedChange={(on) => useTransport.getState().setMetronome(on)} aria-label="Metronome" title="Metronome">
      <PiMetronome />
    </Toggle>
  );
}

/**
 * Buttons that bring up the windows, as FL Studio's toolbar has for each of its own: a press opens the
 * window, or brings it to the front if it's open. F6 and F7 are the toggles.
 */
function WindowToggles() {
  return (
    <>
      <WindowButton onOpen={() => openPianoRoll()} label="Piano roll" title="Piano roll: the selected channel's notes (F7)">
        <PiPianoKeys />
      </WindowButton>
      <WindowButton onOpen={() => useMusicUi.getState().setRackOpen(true)} label="Channel rack" title="Channel rack (F6)">
        <PiRows />
      </WindowButton>
    </>
  );
}

function WindowButton({ onOpen, label, title, children }: { onOpen: () => void; label: string; title: string; children: ReactNode }) {
  // A plain button (it opens, it doesn't toggle): lit only while hovered.
  return (
    <button
      type="button"
      className={cn(toggleVariants({ size: "sm" }), "size-7 min-w-7 px-0 hover:text-brand [&_svg:not([class*=size-])]:size-[18px]")}
      onClick={onOpen}
      aria-label={label}
      title={title}
    >
      {children}
    </button>
  );
}

/** The engine's load and the output's level (the last 48 dB fill the bar), in one recessed panel. */
function Monitor() {
  const peak = useTransport((s) => s.peak);
  const cpu = useTransport((s) => Math.round(s.cpu * 100));
  // The engine only speaks while something sounds: let the bar fall when it goes quiet.
  const [, tick] = useState(0);
  useEffect(() => {
    if (peak <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), 300);
    return () => clearTimeout(timer);
  }, [peak]);
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const level = Math.max(0, Math.min(1, (db + 48) / 48));
  return (
    <div
      className="sunken flex h-10 w-24 shrink-0 flex-col justify-center gap-1.5 rounded-sm px-2"
      title={`Output ${Number.isFinite(db) ? `${db.toFixed(1)} dB` : "silent"} · engine ${cpu}%`}
    >
      <div className="flex items-baseline justify-between text-[10px] leading-none text-muted-foreground">
        <span className="font-semibold tracking-wide">CPU</span>
        <span className="font-mono tabular-nums text-foreground">{cpu}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-[1px] bg-foreground/10" role="meter" aria-label="Output level" aria-valuenow={Math.round(level * 100)}>
        <div className={cn("h-full transition-[width] duration-100", peak >= 1 ? "bg-destructive" : "bg-brand")} style={{ width: `${level * 100}%` }} />
      </div>
    </div>
  );
}

function HistoryButtons() {
  const undoable = useMusic((s) => !!s.history && canUndo(s.history));
  const redoable = useMusic((s) => !!s.history && canRedo(s.history));
  return (
    <>
      <Tip text="Undo (⌘Z)">
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label="Undo" disabled={!undoable} onClick={() => useMusic.getState().undo()}>
          <PiArrowUUpLeft />
        </Button>
      </Tip>
      <Tip text="Redo (⇧⌘Z)">
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label="Redo" disabled={!redoable} onClick={() => useMusic.getState().redo()}>
          <PiArrowUUpRight />
        </Button>
      </Tip>
    </>
  );
}

function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{text}</TooltipContent>
    </Tooltip>
  );
}
