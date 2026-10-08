import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { addWindowListener, isElement, ownerDocument } from "@/lib/window-events";
import { PiFolders, PiKeyboard, PiListDashes, PiMetronome, PiPauseFill, PiPianoKeys, PiPlayFill, PiRows, PiSlidersHorizontal, PiStopFill, PiWarning } from "react-icons/pi";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "cn";
import { lengthOf, setMainVolume, setTempo } from "@shared/music/edits";
import { METRONOME_SOUNDS, type MetronomeSound } from "@shared/music/engine";
import { NOTE_QUANTIZE, type NoteQuantize } from "@shared/music/recording";
import { songTicks } from "@shared/music/playlist";
import { DEFAULT_TEMPO, DEFAULT_VOLUME, MAX_TEMPO, MIN_TEMPO, stepsPerBar } from "@shared/music/project";
import { STEP_TICKS } from "@shared/music/types";
import { HeaderActions } from "@/components/header/header-actions";
import { MenuBarSlot } from "@/components/home/menu-bar";
import { ProjectName } from "@/components/header/project-name";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { canRedo, canUndo } from "@/lib/document-history";
import { IS_MAC, keyLabel } from "@/lib/key-labels";
import { startPointerDrag } from "@/lib/pointer-drag";
import type { AutomationTarget } from "@shared/music/types";
import { PERCENT, SongKnob, percent } from "./knob";
import { ModeLights } from "./mode-switch";
import { CpuGraph, OutputGraph } from "./monitors";
import { PatternPicker } from "./pattern-picker";
import { openPianoRoll } from "./piano/actions";
import { positionNow } from "./playhead";
import { openPlaylist } from "./playlist/actions";
import { positionAt, positionText, splitTail, tempoText, timeText } from "./position";
import { useSongExport } from "./export/store";
import { titleOf } from "@/components/ui/title-tips";
import { COUNT_IN_BARS, useMusicPreferences } from "./preferences";
import { useRecording } from "./recording";
import { useMidi } from "./midi";
import { currentPattern, songGesture, useMusic, useSong } from "./store";
import { switchMode, useTransport } from "./transport";
import { useMusicUi } from "./ui";
import { useBrowser } from "./browser/store";
import { addTap, tappedTempo } from "./tap-tempo";
import { AutomationMenuItems, useAutomatedControl } from "./automation/control";
import { TEMPO_TARGET, engineTick, tempoMap } from "@shared/music/tempo";
import { useWheelValue } from "./wheel";

/** The main volume as an automation target (a constant, so the knob's menu and hook see one target). */
const MAIN_VOLUME: AutomationTarget = { kind: "main" };

/**
 * The music editor's header, FL Studio's toolbar (`docs/fl-studio/toolbar.md`), with only what Vaudio does, in two
 * rows to save height: the menus start the first and the song's name and FL's hint bar the second (no menu row of
 * its own, as other suites have), the app's own (undo, Settings, Export, the assistant) at the first's end; the tools
 * as dense as FL's, every button in them one size (`TOOL`): the transport
 * (PAT / SONG, play and stop in one pill, record), tempo, position, then the typing keyboard, the count-in and
 * the metronome, the main volume, the windows, the pattern selector and the song position, the engine's output
 * and load; groups apart by grooves.
 */
export function MusicToolbar() {
  const name = useSong((song) => song.name);
  const error = useTransport((s) => s.error);

  return (
    // Two rows, FL's: the menus then what plays and what it sounds like; the song's name and the hint bar then
    // what's shown and where in it. The left column is as wide as the menus (the hint cell adds nothing to it).
    <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-1 border-b border-line bg-surface-1 px-3 py-1.5 select-none">
      <div className="-ml-1 flex h-8 items-center">
        <MenuBarSlot />
      </div>
      <div className="flex h-8 min-w-0 items-center gap-1.5">
        <Groove className="mx-1 h-7 self-center" />
        <div className="flex shrink-0 items-center gap-1.5" role="toolbar" aria-label="Transport">
          <TransportPill />
          <RecordButton />
          <TempoLcd />
          <PositionLcd />
          {/* After the time, as FL's: the typing keyboard, the count-in and the metronome. */}
          <div className="flex items-center gap-1">
            <TypingKeyboardToggle />
            <CountInToggle />
            <MetronomeToggle />
          </div>
          <MainVolume />
        </div>
        <OutputGraph className="w-32 min-w-14 shrink" />
        <Groove className="mx-1 h-7 self-center" />
        <CpuGraph className="w-32 min-w-14 shrink" />
        {error && (
          <span className="flex max-w-60 min-w-0 items-center gap-1.5 text-xs text-destructive" role="alert" title={error}>
            <PiWarning className="shrink-0" />
            <span className="truncate">{error}</span>
          </span>
        )}
        <Actions />
      </div>
      {/* It drags the desktop app's window, as the menu row does (the tools don't: the LCDs and the slider drag). */}
      <div data-titlebar="header" className="flex h-8 w-0 min-w-full items-center gap-2">
        <ProjectName name={name} onRename={(next) => void useMusic.getState().rename(next)} className="-ml-1 h-6 max-w-40 shrink-0 px-1 text-[13px] font-semibold" />
        <span aria-hidden className="text-muted-foreground/50">·</span>
        <HintBar />
      </div>
      <div className="flex h-8 min-w-0 items-center gap-1.5">
        <Groove className="mx-1 h-7 self-center" />
        <div className="flex shrink-0 items-center gap-1">
          <WindowToggles />
        </div>
        <Groove className="mx-1 h-6 self-center" />
        <div className="w-60 shrink-0">
          <PatternPicker />
        </div>
        <PositionSlider />
      </div>
    </div>
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
    // What's under the pointer, in the page or in one of the editor's windows (native ones are windows of their own).
    const over = (e: Event) => {
      // Its tip (a title, moved aside while the pointer is on it: `TitleTips`), else its name.
      const target = isElement(e.target) ? e.target.closest("[title], [data-title], [aria-label]") : null;
      const ours = target && (root.contains(target) || target.closest("[data-window]"));
      setHint(ours ? (titleOf(target) ?? target.getAttribute("aria-label") ?? "") : "");
    };
    const leave = () => setHint("");
    const stops = [addWindowListener("pointerover", over), addWindowListener("blur", leave)];
    root.addEventListener("pointerleave", leave);
    return () => {
      for (const stop of stops) stop();
      root.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <div className="min-w-0 flex-1 truncate text-[12px] leading-4 text-muted-foreground" aria-live="off" data-testid="hint-bar">
      {hint || " "}
    </div>
  );
}

/**
 * FL Studio's PAT / SONG switch (L): play plays the pattern shown, looped, or the playlist. Two lights,
 * the one lit is what plays.
 */
function ModeSwitch() {
  const mode = useTransport((s) => s.mode);
  return <ModeLights mode={mode} onChange={(next) => switchMode(next)} />;
}

/**
 * FL Studio's transport pill: PAT / SONG, Play and Stop as one raised piece, rounded at both ends, the
 * parts divided by grooves (record is its own round button beside it).
 */
function TransportPill() {
  return (
    <div className="raised flex h-[30px] shrink-0 overflow-hidden rounded-[11px]" role="group" aria-label="Play and stop">
      <ModeSwitch />
      <PlayButtons />
    </div>
  );
}

/** A part of the transport pill: the pill's face, brighter hovered, pushed in held. `on`: its icon is lit. */
function PillButton({ label, title, on, onClick, children }: { label: string; title: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tip text={title}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        className={cn(
          "grid h-full w-[34px] place-items-center border-l border-[var(--bevel-shadow)] shadow-[inset_1px_0_0_var(--bevel-highlight)] transition-colors hover:bg-[image:var(--raised-hover)] active:bg-[image:var(--pressed)] active:shadow-[var(--inset)]",
          on ? "text-brand" : "text-foreground/80 hover:text-foreground",
        )}
        onClick={onClick}
      >
        {children}
      </button>
    </Tip>
  );
}

/** Every button of the toolbar, FL Studio's: one size, so the transport, the switches and the windows' line up. */
const TOOL = "size-[30px] [&_svg:not([class*=size-])]:size-[18px]";

/** A toolbar button's face: raised, lit as FL's while hovered (`lit`) and while it's on, a shade darker held. */
const toolFace = (on?: boolean) => cn("raised grid place-items-center rounded-[4px] active:brightness-90", TOOL, on ? "lit" : "text-foreground/80 hover:lit");

/** A button of the toolbar, FL Studio's: a switch (`on`) or a command. `menu`: its right-click menu. */
function TransportButton({ label, title, on, onClick, className, menu, children }: { label: string; title: string; on?: boolean; onClick: () => void; className?: string; menu?: ReactNode; children: ReactNode }) {
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      className={cn(toolFace(on), className)}
      onClick={onClick}
    >
      {children}
    </button>
  );
  if (!menu) return <Tip text={title}>{button}</Tip>;
  return (
    <ContextMenu>
      <Tip text={title}>
        <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
      </Tip>
      <ContextMenuContent>{menu}</ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Play and Stop, joined, as FL Studio's. Playing, Play is Pause: it stops where it is, and the next
 * play goes on from there (Space still plays and stops). Stop goes back to where play starts.
 */
function PlayButtons() {
  const playing = useTransport((s) => s.playing);
  return (
    <>
      <PillButton
        label="Play"
        title={playing ? "Pause (Space stops)" : "Play (Space)"}
        on={playing}
        onClick={() => {
          const transport = useTransport.getState();
          if (transport.playing) transport.pause(positionNow() ?? transport.startOf());
          else transport.play();
        }}
      >
        {playing ? <PiPauseFill className="size-[17px]" /> : <PiPlayFill className="size-[17px]" />}
      </PillButton>
      <PillButton label="Stop" title="Stop (Space); press it again, stopped, to silence delays and reverbs still ringing" onClick={() => useTransport.getState().stop()}>
        <PiStopFill className="size-[15px]" />
      </PillButton>
    </>
  );
}

/**
 * FL Studio's Record (R), a round button with a red dot: while it's on (all red), Play records the armed
 * mixer tracks and the notes played on the selected channel (`docs/fl-studio/midi.md`), after the count-in. It pulses while recording. Its right-click menu has FL's recording options: the count-in,
 * Loop record (a take each pass round the loop), Blend (hear earlier passes) and Disarm on stop.
 */
function RecordButton() {
  const on = useRecording((s) => s.on);
  const recording = useRecording((s) => s.active !== null);
  const options = useMusicPreferences((s) => s.recording);
  const set = useMusicPreferences((s) => s.setRecording);
  const title = recording
    ? "Recording (Space stops)"
    : on
      ? "Record is on: Play records the armed tracks and the notes played on the selected channel (R)"
      : "Record (R): then Play records the mixer tracks armed and the notes you play. Right-click for its options";
  const button = (
    <button
      type="button"
      aria-label="Record"
      aria-pressed={on}
      data-recording={recording || undefined}
      className={cn("grid place-items-center rounded-full transition-colors", TOOL, on ? "active:brightness-90" : "raised hover:raised-hover active:pressed", recording && "animate-pulse")}
      // On, the whole button is red, its dot a brighter red in it; off, a round button with a red dot.
      style={on ? { background: "var(--destructive-solid)", boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.25), 0 0 0 1px color-mix(in oklab, var(--destructive-solid) 70%, #000)" } : undefined}
      onClick={() => useRecording.getState().setOn(!on)}
    >
      <span
        aria-hidden
        className="size-3 rounded-full"
        style={{
          background: on ? "color-mix(in oklab, var(--destructive-solid) 55%, #fff)" : "var(--destructive)",
          boxShadow: on ? "0 0 0 1px rgb(0 0 0 / 0.15)" : "inset 0 1px 1px rgb(0 0 0 / 0.25)",
        }}
      />
    </button>
  );
  return (
    <ContextMenu>
      <Tip text={title}>
        <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
      </Tip>
      <ContextMenuContent>
        <ContextMenuCheckboxItem checked={options.countIn} onCheckedChange={(countIn) => set({ countIn })}>
          Count-in
        </ContextMenuCheckboxItem>
        <CountInBars />
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem checked={options.loop} onCheckedChange={(loop) => set({ loop })}>
          Loop record
        </ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem checked={options.blend} onCheckedChange={(blend) => set({ blend })} disabled={!options.loop}>
          Blend (hear earlier takes)
        </ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem checked={options.disarmOnStop} onCheckedChange={(disarmOnStop) => set({ disarmOnStop })}>
          Disarm on stop
        </ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        <ContextMenuLabel className="text-[11px] font-normal text-muted-foreground">Recorded notes (on the Piano roll's snap)</ContextMenuLabel>
        <ContextMenuRadioGroup value={options.quantize} onValueChange={(value) => set({ quantize: value as NoteQuantize })}>
          {NOTE_QUANTIZE.map((mode) => (
            <ContextMenuRadioItem key={mode} value={mode}>
              {QUANTIZE_LABELS[mode]}
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Record's menu: what of recorded notes is quantized (FL's). */
const QUANTIZE_LABELS: Record<NoteQuantize, string> = {
  none: "Don't quantize",
  start: "Quantize start times",
  end: "Quantize end times",
  both: "Quantize starts and ends",
  startKeepLength: "Quantize starts, keeping lengths",
};

/**
 * FL Studio's typing keyboard to piano keyboard (Ctrl+T): while it's on, the letter rows play the
 * selected channel (Z and Q are Cs an octave apart; `[` and `]` move them). Its light blinks when a
 * note comes in, from it or a MIDI keyboard (FL's MIDI activity light).
 */
function TypingKeyboardToggle() {
  const typing = useMidi((s) => s.typing);
  const lastNoteAt = useMidi((s) => s.lastNoteAt);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (!lastNoteAt) return;
    setLit(true);
    const timer = setTimeout(() => setLit(false), 150);
    return () => clearTimeout(timer);
  }, [lastNoteAt]);
  return (
    <TransportButton
      label="Typing keyboard"
      title={keyLabel(`Typing piano ${typing ? "on" : "off"} (⌘T)`)}
      on={typing}
      className="relative"
      onClick={() => useMidi.getState().setTyping(!typing)}
    >
      <PiKeyboard />
      <span
        aria-hidden
        data-midi-activity={lit || undefined}
        className={cn("absolute top-[3px] right-[3px] size-1.5 rounded-full bg-current transition-opacity duration-150", lit ? "opacity-100" : "opacity-0")}
      />
    </TransportButton>
  );
}

/** How many bars the count-in is, in a menu (Record's and the count-in switch's). */
function CountInBars() {
  const bars = useMusicPreferences((s) => s.recording.countInBars);
  const set = useMusicPreferences((s) => s.setRecording);
  return (
    <>
      <ContextMenuLabel className="text-[11px] font-normal text-muted-foreground">Count-in length</ContextMenuLabel>
      <ContextMenuRadioGroup value={String(bars)} onValueChange={(value) => set({ countInBars: Number(value), countIn: true })}>
        {COUNT_IN_BARS.map((n) => (
          <ContextMenuRadioItem key={n} value={String(n)}>
            {n === 1 ? "1 bar" : `${n} bars`}
          </ContextMenuRadioItem>
        ))}
      </ContextMenuRadioGroup>
    </>
  );
}

/**
 * FL Studio's count-in switch, beside Record: on (the default), recording starts after the metronome
 * counts in (its length on the right-click); off, it starts at once. Kept in this browser, so it's the
 * same in every song.
 */
function CountInToggle() {
  const options = useMusicPreferences((s) => s.recording);
  const bars = options.countInBars;
  return (
    <TransportButton
      label="Count-in"
      title={options.countIn ? `Count-in: ${bars} bar${bars === 1 ? "" : "s"} of clicks before recording (right-click for how long)` : "Count-in is off: recording starts at once"}
      on={options.countIn}
      onClick={() => useMusicPreferences.getState().setRecording({ countIn: !options.countIn })}
      menu={<CountInBars />}
    >
      <span className="text-[11px] leading-none font-semibold tracking-tight tabular-nums">3·2·1</span>
    </TransportButton>
  );
}

/** Pixels of drag per beat per minute on the tempo LCD. */
const TEMPO_DRAG = 4;

/**
 * The tempo, FL Studio's LCD: dragged up and down (one undo step; the pointer is locked, so it goes on
 * past the screen's edge), or clicked to type it (Enter or leaving the field sets it, Escape doesn't; the
 * arrow keys nudge it). Its right-click menu taps the tempo and makes it the one new songs start at.
 */
function TempoLcd() {
  const tempo = useSong((song) => song.settings.tempo);
  // Automated (song mode), it shows the tempo where the song is; what's edited is the song's own.
  const automated = useAutomatedControl(TEMPO_TARGET, tempo);
  const defaultTempo = useMusicPreferences((s) => s.defaultTempo);
  const [tapping, setTapping] = useState(false);
  /** Tap tempo… was chosen: its popover opens once the menu has let go of the focus (or it would close at once). */
  const tappingNext = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const gesture = useRef(songGesture()).current;
  const set = (value: number) => useMusic.getState().commit((song) => setTempo(song, value));
  const input = useRef<HTMLInputElement>(null);
  // Scrolled over (not while it's being typed in): a beat per minute a notch, a tenth with Ctrl.
  useWheelValue(
    input,
    {
      value: () => tempo,
      min: MIN_TEMPO,
      max: MAX_TEMPO,
      step: (fine) => (fine ? 0.1 : 1),
      onBegin: () => gesture.begin(),
      onDrag: (value) => gesture.apply((song) => setTempo(song, value)),
      onEnd: () => gesture.end(),
    },
    draft === null,
  );

  const [whole, decimals] = splitTail(tempoText(automated.value), ".");
  // The field covers the whole display, on top of everything in it (so the desktop app's window dragging, which
  // the header has, can't come back through the digits), and only shows while it's typed in; otherwise the
  // digits under it do, FL's way.
  const lcd = (
    <Lcd label="BPM" className="group w-[86px]">
      <LcdDigits main={whole} tail={decimals} className="group-focus-within:invisible" />
      <input
        ref={input}
        aria-label="Tempo"
        data-automated={automated.automated || undefined}
        title="Tempo: drag up and down, or click to type it"
        inputMode="decimal"
        className="absolute inset-0 z-10 w-full cursor-ns-resize rounded-[5px] bg-transparent px-2 pt-2.5 pb-[3px] text-right font-sans text-[20px] leading-none font-medium text-transparent tabular-nums caret-transparent outline-none selection:bg-brand/40 focus:cursor-text focus:text-[var(--lcd-text)] focus:caret-[var(--lcd-text)]"
        value={draft ?? String(tempo)}
        onPointerDown={(e) => {
          const input = e.currentTarget;
          // While typing, the pointer places the caret.
          if (ownerDocument(input).activeElement === input || e.button !== 0) return;
          e.preventDefault();
          const start = Math.round(tempo);
          startPointerDrag(e, {
            threshold: 3,
            cursor: "ns-resize",
            lock: true,
            onStart: () => gesture.begin(),
            onMove: (_, travel) => {
              const value = Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, start - Math.round(travel.y / TEMPO_DRAG)));
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

  return (
    <Popover open={tapping} onOpenChange={setTapping}>
      <ContextMenu>
        <PopoverPrimitive.Anchor asChild>
          <ContextMenuTrigger asChild>
            <div>{lcd}</div>
          </ContextMenuTrigger>
        </PopoverPrimitive.Anchor>
        <ContextMenuContent
          // The menu mustn't take the focus back to the field as it closes: a click on it is for typing.
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (tappingNext.current) setTapping(true);
            tappingNext.current = false;
          }}
        >
          <ContextMenuItem onSelect={() => (tappingNext.current = true)}>Tap tempo…</ContextMenuItem>
          <AutomationMenuItems target={TEMPO_TARGET} />
          <ContextMenuSeparator />
          <ContextMenuItem disabled={tempo === (defaultTempo ?? DEFAULT_TEMPO)} onSelect={() => useMusicPreferences.getState().setDefaultTempo(tempo)}>
            Make {tempo} BPM the default
          </ContextMenuItem>
          <ContextMenuItem disabled={defaultTempo === null} onSelect={() => useMusicPreferences.getState().setDefaultTempo(null)}>
            Reset the default ({DEFAULT_TEMPO} BPM)
          </ContextMenuItem>
          <ContextMenuLabel className="text-[11px] font-normal text-muted-foreground">New songs start at {defaultTempo ?? DEFAULT_TEMPO} BPM</ContextMenuLabel>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent align="start" className="w-56 p-3">
        {tapping && <TapTempo onSet={(value) => set(value)} onDone={() => setTapping(false)} />}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Tap tempo: tap along to a song (click the pad, or press any key) and its tempo is worked out from the
 * taps (`tap-tempo.ts`); Set tempo gives it to the song, to the nearest whole BPM.
 */
function TapTempo({ onSet, onDone }: { onSet: (tempo: number) => void; onDone: () => void }) {
  const [taps, setTaps] = useState<number[]>([]);
  const bpm = tappedTempo(taps);
  const pad = useRef<HTMLButtonElement>(null);
  const tap = () => setTaps((taps) => addTap(taps, performance.now()));
  const apply = () => {
    if (bpm === null) return;
    onSet(Math.round(bpm));
    onDone();
  };
  useEffect(() => pad.current?.focus(), []);
  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        // The popover's own keys: Escape closes, Enter sets it. Every other key taps (and isn't the editor's).
        if (e.key === "Escape" || e.key === "Tab" || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Enter") apply();
        else if (!e.repeat) tap();
      }}
    >
      <p className="text-xs text-muted-foreground">Tap along to the beat: click the pad or press any key, at least three times.</p>
      <button
        ref={pad}
        type="button"
        aria-label="Tap"
        className="raised raised-hover active:pressed flex h-16 flex-col items-center justify-center rounded-md font-mono tabular-nums"
        // On the press, not the release: a tap's moment is when the finger lands.
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          tap();
        }}
      >
        <span className="text-2xl leading-none" data-testid="tapped-tempo">
          {bpm === null ? "—" : Math.round(bpm)}
        </span>
        <span className="mt-1 text-[10px] text-muted-foreground">{bpm === null ? `${taps.length} of 3 taps` : `${bpm.toFixed(1)} BPM tapped`}</span>
      </button>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setTaps([])} disabled={taps.length === 0}>
          Reset
        </Button>
        <Button size="sm" onClick={apply} disabled={bpm === null}>
          Set tempo
        </Button>
      </div>
    </div>
  );
}

/** A number display with its small label in the corner, FL Studio's: dark, recessed, light digits (`lcd`). */
function Lcd({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div data-no-drag className={cn("lcd relative flex h-8 shrink-0 items-end justify-end rounded-[5px] px-2 pb-[3px]", className)}>
      <span className="pointer-events-none absolute top-[2px] right-2 text-[7px] leading-none font-semibold tracking-[0.08em] text-[var(--lcd-dim)]">{label}</span>
      {children}
    </div>
  );
}

/** An LCD's digits: the number, then its last part smaller, as FL Studio draws "140.000" and "1:01:00". */
function LcdDigits({ main = "", tail = "", className, mainRef, tailRef }: { main?: string; tail?: string; className?: string; mainRef?: Ref<HTMLSpanElement>; tailRef?: Ref<HTMLSpanElement> }) {
  return (
    <span className={cn("pointer-events-none flex items-baseline font-sans leading-none font-medium", className)}>
      <span ref={mainRef} className="text-[20px]">
        {[...main].map((ch, i) => (
          <span key={i} className={cellClass(ch)}>
            {ch}
          </span>
        ))}
      </span>
      <span ref={tailRef} className="text-[12px] opacity-80">
        {[...tail].map((ch, i) => (
          <span key={i} className={cellClass(ch)}>
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * Each character of an LCD in a cell of its own, digits all as wide, so a running display doesn't shift as its
 * digits change (whatever the font: not every one has figures of a width).
 */
const cellClass = (ch: string) => (/\d/.test(ch) ? "inline-block w-[0.6em] text-center" : "inline-block w-[0.3em] text-center");

/** Write `text` into an LCD's digits, a cell a character, touching only the cells that change (every frame while playing). */
function writeCells(element: HTMLElement, text: string) {
  while (element.childElementCount > text.length) element.lastElementChild!.remove();
  while (element.childElementCount < text.length) element.append(document.createElement("span"));
  for (let i = 0; i < text.length; i++) {
    const cell = element.children[i] as HTMLElement;
    if (cell.textContent === text[i]) continue;
    cell.textContent = text[i];
    cell.className = cellClass(text[i]);
  }
}

/** Where play is now (or starts) in the mode playing, frame by frame while it plays, written straight into the display. */
function usePlayTick(onTick: (tick: number) => void, deps: unknown[] = []) {
  const playing = useTransport((s) => s.playing);
  const mode = useTransport((s) => s.mode);
  // Paused, where it paused.
  const startTick = useTransport((s) => s.pausedAt ?? (mode === "song" ? s.songStartTick : s.startTick));
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
      latest.current(positionNow() ?? startTick);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, startTick, tempo, mode, ...deps]);
}

/**
 * FL Studio's position display: where the pattern (or the song) is playing, or where play starts, in
 * bars:steps:ticks or minutes:seconds:centiseconds; a click switches (kept in the browser).
 */
function PositionLcd() {
  const barSteps = useSong((song) => stepsPerBar(song.settings.timeSignature));
  const tempo = useSong((song) => song.settings.tempo);
  const mode = useTransport((s) => s.mode);
  const format = useMusicPreferences((s) => s.timeFormat);
  const main = useRef<HTMLSpanElement>(null);
  const tail = useRef<HTMLSpanElement>(null);
  usePlayTick(
    (tick) => {
      // In song mode, tempo clips change how long the song takes to get there.
      const song = useMusic.getState().history?.doc;
      const time = mode === "song" && song ? engineTick(tempoMap(song), tick) : tick;
      const [a, b] = splitTail(format === "mscs" ? timeText(time, tempo) : positionText(tick, barSteps), ":");
      if (main.current) writeCells(main.current, a);
      if (tail.current) writeCells(tail.current, b);
    },
    [format, barSteps, mode],
  );
  const title =
    format === "mscs"
      ? "Where the pattern (or the song) is playing, or where play starts (minutes:seconds:hundredths). Click for bars:steps:ticks"
      : "Where the pattern (or the song) is playing, or where play starts (bar:step:tick). Click for minutes:seconds";
  return (
    <button
      type="button"
      className="rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={title}
      onClick={() => useMusicPreferences.getState().setTimeFormat(format === "mscs" ? "bst" : "mscs")}
    >
      <Lcd label={format === "mscs" ? "M:S:CS" : "B:S:T"} className="w-[96px]">
        <span aria-label="Position" data-format={format}>
          <LcdDigits mainRef={main} tailRef={tail} />
        </span>
      </Lcd>
    </button>
  );
}

/** FL Studio's main volume knob: everything the song puts out (the song's, `settings.volume`). */
function MainVolume() {
  const volume = useSong((song) => song.settings.volume);
  return <SongKnob value={volume} min={0} max={1} defaultValue={DEFAULT_VOLUME} label="Main volume" format={percent} unit={PERCENT} size={28} target={MAIN_VOLUME} edit={setMainVolume} className="mx-0.5" />;
}

/** The song position slider's thumb, in px. */
const THUMB = 16;

/**
 * The song position slider: along the pattern (or the song, in song mode), where play is (it moves while
 * playing), lit with the accent up to there. A press or a drag moves play there, to the step (the thumb
 * follows the pointer while it's held); the arrow keys move it a step, Home and End to the ends.
 */
function PositionSlider() {
  const mode = useTransport((s) => s.mode);
  const patternTicks = useMusic((s) => (mode === "song" ? songTicks(s.history!.doc) : lengthOf(s.history!.doc, currentPattern(s.history!.doc, s.patternId)) * STEP_TICKS));
  const startOf = () => useTransport.getState().startOf();
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
    if (mode === "song") useTransport.getState().jumpSongTo(tick);
    else useTransport.getState().jumpTo(tick);
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
      className="relative ml-1 h-6 max-w-[280px] min-w-24 flex-1 cursor-pointer touch-none outline-none"
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
          const tick = startOf();
          if (patternTicks > 0) show(tick / patternTicks);
        };
        const started = startPointerDrag(e, { threshold: 0, onMove: (ev) => moveTo(ev.clientX), onEnd: release, onCancel: release, onClick: release });
        if (!started) release();
      }}
      onKeyDown={(e) => {
        const from = startOf();
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

/** The metronome, on or off; its right-click menu picks its sound (heard once as it's chosen). */
function MetronomeToggle() {
  const metronome = useTransport((s) => s.metronome);
  const sound = useMusicPreferences((s) => s.metronomeSound);
  return (
    <TransportButton
      label="Metronome"
      title="Metronome (right-click for its sound)"
      on={metronome}
      onClick={() => useTransport.getState().setMetronome(!metronome, sound)}
      menu={
        <>
          <ContextMenuLabel className="text-[11px] font-normal text-muted-foreground">Metronome sound</ContextMenuLabel>
          <ContextMenuRadioGroup
            value={sound}
            onValueChange={(value) => {
              useMusicPreferences.getState().setMetronomeSound(value as MetronomeSound);
              useTransport.getState().setMetronomeSound(value as MetronomeSound);
            }}
          >
            {METRONOME_SOUNDS.map((s) => (
              <ContextMenuRadioItem key={s.id} value={s.id}>
                {s.name}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </>
      }
    >
      <PiMetronome />
    </TransportButton>
  );
}

/**
 * Buttons that bring up the windows, as FL Studio's toolbar has for each of its own: a press opens the
 * window, or brings it to the front if it's open. F6, F7 and F9 are the toggles.
 */
function WindowToggles() {
  // A Mac's F keys need Fn, so it's told Alt+1…5; elsewhere FL's own F keys.
  const key = (mac: string, other: string) => (IS_MAC ? mac : other);
  return (
    <>
      <WindowButton onOpen={() => openPlaylist()} label="Playlist" title={`Playlist: the song's arrangement (${key("⌥1", "F5")})`}>
        <PiListDashes />
      </WindowButton>
      <WindowButton onOpen={() => useMusicUi.getState().setRackOpen(true)} label="Channel rack" title={`Channel rack (${key("⌥2", "F6")})`}>
        <PiRows />
      </WindowButton>
      <WindowButton onOpen={() => openPianoRoll()} label="Piano roll" title={`Piano roll: the selected channel's notes (${key("⌥3", "F7")})`}>
        <PiPianoKeys />
      </WindowButton>
      <WindowButton onOpen={() => useMusicUi.getState().setMixerOpen(true)} label="Mixer" title={`Mixer (${key("⌥4", "F9")})`}>
        <PiSlidersHorizontal className="rotate-90" />
      </WindowButton>
      <WindowButton onOpen={() => useBrowser.getState().setOpen(!useBrowser.getState().open)} label="Browser" title={`Browser: your sample folders (${key("⌥5", "Alt+F8")})`}>
        <PiFolders />
      </WindowButton>
    </>
  );
}

/** A window's button: the toolbar's face, the same whether its window is open or not (it opens it, or brings it forward: it doesn't toggle). */
function WindowButton({ onOpen, label, title, children }: { onOpen: () => void; label: string; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={toolFace()}
      onClick={onOpen}
      aria-label={label}
      title={title}
    >
      {children}
    </button>
  );
}

/** The header's end, as every suite's: undo and redo, Settings, Export (FL's File → Export: the save dialog, then the export window), the assistant. */
function Actions() {
  const history = useMusic((s) => s.history);
  const exporting = useTransport((s) => s.exporting);
  return (
    <HeaderActions
      canUndo={!!history && canUndo(history)}
      canRedo={!!history && canRedo(history)}
      onUndo={() => useMusic.getState().undo()}
      onRedo={() => useMusic.getState().redo()}
      exportAction={{ onClick: () => void useSongExport.getState().begin(), busy: exporting }}
    />
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
