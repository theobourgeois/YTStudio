import { useEffect, useRef, useState } from "react";
import { PiCaretDown, PiDotsThreeBold, PiMagicWand, PiPause, PiPlay, PiWaveSawtooth, PiWaveSine, PiWaveSquare, PiProhibit } from "react-icons/pi";
import { cn } from "cn";
import { mixerTrackName } from "@shared/music/automation";
import { type AutoTunePatch, currentPreset, keyText, notesEdited, updateAutoTune } from "@shared/music/auto-tune";
import {
  AUTO_TUNE_PRESETS,
  INPUT_TYPES,
  MAX_DETUNE,
  MAX_NATURAL_VIBRATO,
  MAX_ONSET,
  MAX_RETUNE,
  MAX_THROAT,
  MAX_TRANSPOSE,
  MAX_VIBRATO_AMPLITUDE,
  MIN_THROAT,
  NOTE_NAMES,
  SCALES,
  noteName,
  scaleNotes,
} from "@shared/music/auto-tune-presets";
import { AUTO_TUNE_INPUTS, AUTO_TUNE_SCALES, type AutoTune, type AutoTuneControl, type AutoTuneNote, type MixerEffect, type MusicProject, type VibratoShape } from "@shared/music/types";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SongKnob, type ValueUnit } from "../knob";
import { prepare, readPalette } from "../piano/draw";
import { useSong } from "../store";
import { autoTuneWindow } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { closeAutoTune, copyTuneState, detectSongKey, pasteTuneState, applyPreset, setAll, setNote, setTune } from "./actions";
import { drawGraph, tuneColours } from "./draw";
import { type GraphView, KEYS_WIDTH, followCentre, meterFraction, noteAt, pitchClass } from "./geometry";
import { latestPitch, pitchHistory } from "./pitch-history";
import { useTuneUi, useTuneView } from "./store";
import { AutomateTouched } from "../automation/touched";

const WIDTH = 900;
const HEIGHT = 640;
const MIN_WIDTH = 820;

/** The effect in the song, by id (the object itself, so a selector of it is stable). */
function effectOf(song: MusicProject, effectId: string): MixerEffect | null {
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect;
  return null;
}
const trackOf = (song: MusicProject, effectId: string) => song.mixer.tracks.find((t) => t.effects.some((e) => e?.id === effectId))?.id ?? "";

// How each knob's value reads and is typed.
const MS: ValueUnit = { scale: 1, unit: "ms" };
const AMOUNT: ValueUnit = { scale: 100, unit: "" };
const DB: ValueUnit = { scale: 1, unit: "dB", digits: 1 };
const SEMITONES: ValueUnit = { scale: 1, unit: "st" };
const CENTS_UNIT: ValueUnit = { scale: 1, unit: "cents" };
const HZ: ValueUnit = { scale: 1, unit: "Hz", digits: 1 };
const amount = (v: number) => String(Math.round(v * 100));
const signed = (v: number, digits = 0, unit = "") => `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;

/**
 * An Auto-Tune's window (`docs/antares/auto-tune.md`), Auto-Tune Pro's Auto mode in our look: along the
 * top its Input Type, key and scale, Detune, Tracking, presets, Formant and Classic; the note it's tuning
 * to and the Pitch Change meter; the pitch graph (what was sung and what it was tuned to, over a keyboard
 * of the scale's notes); the knobs, Retune Speed first; and Edit Scale or Create Vibrato below.
 */
export function AutoTuneWindow({ effectId, index }: { effectId: string; index: number }) {
  const effect = useSong((s) => effectOf(s, effectId));
  const owner = useSong((s) => mixerTrackName(s, trackOf(s, effectId)));
  const [initial] = useState(() => {
    const width = Math.max(MIN_WIDTH, Math.min(WIDTH, (document.querySelector('[data-desktop="music"]')?.getBoundingClientRect().width ?? WIDTH) - 16));
    const place = centredOnDesktop(width, HEIGHT);
    return { ...place, x: place.x + index * 28, y: Math.min(place.y, 32) + index * 28, width, height: HEIGHT };
  });
  const at = effect?.autoTune;
  // Its effect deleted (or replaced): its window goes, as a plugin's does.
  const gone = !at;
  useEffect(() => {
    if (gone) closeAutoTune(effectId);
  }, [gone, effectId]);
  if (!effect || !at) return null;
  return (
    <MusicWindow id={autoTuneWindow(effectId)} title={`${effect.plugin.name} (${owner})`} initial={initial} resizable={{ minWidth: MIN_WIDTH, minHeight: 560 }} onClose={() => closeAutoTune(effectId)} controls={<AutomateTouched effectId={effectId} />}>
      <div className="flex h-full min-h-0 flex-col text-xs select-none" data-testid="auto-tune" data-effect={effectId}>
        <TopBar effectId={effectId} at={at} />
        <Display effectId={effectId} at={at} />
        <Knobs effectId={effectId} at={at} />
        <LowerPanel effectId={effectId} at={at} />
      </div>
    </MusicWindow>
  );
}

// ---------------------------------------------------------------------------
// The top bar
// ---------------------------------------------------------------------------

/** A choice on the bar: its label small, its value, a menu of the rest. */
function Choice<T extends string | number>({ label, value, options, onChange, testId }: { label: string; value: T; options: readonly { value: T; text: string }[]; onChange: (value: T) => void; testId?: string }) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 raised hover:raised-hover" aria-label={`${label}: ${current?.text ?? String(value)}`} data-testid={testId}>
          <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</span>
          <span className="font-medium">{current?.text ?? String(value)}</span>
          <PiCaretDown className="size-2.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuRadioGroup value={String(value)} onValueChange={(v) => onChange(options.find((o) => String(o.value) === v)!.value)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={String(o.value)} value={String(o.value)}>
              {o.text}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A switch on the bar (Formant, Classic): lit while on. */
function Toggle({ label, on, title, onClick, disabled }: { label: string; on: boolean; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-7 shrink-0 rounded-sm px-2.5 text-[10px] font-semibold tracking-wider uppercase",
        on ? "pressed text-tune-tuned" : "raised text-muted-foreground hover:raised-hover hover:text-foreground",
        disabled && "opacity-40",
      )}
    >
      <span className={cn("mr-1.5 inline-block size-1.5 rounded-full align-middle", on ? "bg-tune-tuned shadow-[0_0_6px_var(--tune-tuned)]" : "bg-muted-foreground/40")} />
      {label}
    </button>
  );
}

function TopBar({ effectId, at }: { effectId: string; at: AutoTune }) {
  const preset = currentPreset(at);
  const copied = useTuneUi((s) => s.copiedState !== null);
  return (
    <div className="@container flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-surface-1 px-2">
      <span className="shrink-0 px-1 text-[13px] font-semibold tracking-wide">YT-Tune</span>
      <Choice label="Input" testId="tune-input" value={at.input} options={AUTO_TUNE_INPUTS.map((v) => ({ value: v, text: INPUT_TYPES[v].name }))} onChange={(input) => setTune(effectId, { input })} />
      <span className="mx-0.5 h-5 w-px bg-line" />
      <Choice label="Key" testId="tune-key" value={at.key} options={NOTE_NAMES.map((name, key) => ({ value: key, text: name }))} onChange={(key) => setTune(effectId, { key })} />
      <Choice label="Scale" testId="tune-scale" value={at.scale} options={AUTO_TUNE_SCALES.map((v) => ({ value: v, text: SCALES[v].name }))} onChange={(scale) => setTune(effectId, { scale })} />
      <button
        type="button"
        className="flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 raised text-muted-foreground hover:raised-hover hover:text-foreground"
        title="Detect key: set the key and scale from the song's notes"
        aria-label="Detect key from the song"
        onClick={() => detectSongKey(effectId)}
      >
        <PiMagicWand className="size-3.5" />
        <span className="hidden text-[11px] @[52rem]:inline">Detect</span>
      </button>
      <span className="mx-0.5 h-5 w-px bg-line" />
      <LabelledKnob label="Detune" value={`${(440 * 2 ** (at.detune / 1200)).toFixed(1)} Hz`} small>
        <SongKnob
          size={24}
          label="Detune"
          value={at.detune}
          min={-MAX_DETUNE}
          max={MAX_DETUNE}
          defaultValue={0}
          bipolar
          format={(v) => `${signed(v, 0)} cents (A4 ${(440 * 2 ** (v / 1200)).toFixed(1)} Hz)`}
          unit={CENTS_UNIT}
          target={target(effectId, "detune")}
          edit={(s, detune) => editTune(s, effectId, { detune })}
        />
      </LabelledKnob>
      <LabelledKnob label="Tracking" value={amount(at.tracking)} small>
        <SongKnob
          size={24}
          label="Tracking (Choosy to Relaxed)"
          value={at.tracking}
          min={0}
          max={1}
          defaultValue={0.5}
          format={(v) => `${amount(v)} (${v < 0.35 ? "choosy" : v > 0.65 ? "relaxed" : "balanced"})`}
          unit={AMOUNT}
          target={target(effectId, "tracking")}
          edit={(s, tracking) => editTune(s, effectId, { tracking })}
        />
      </LabelledKnob>
      <div className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex h-7 min-w-28 shrink items-center gap-1.5 rounded-sm px-2 raised hover:raised-hover" aria-label={`Preset: ${preset ?? "Custom"}`} data-testid="tune-preset">
            <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">Preset</span>
            <span className="truncate font-medium">{preset ?? "Custom"}</span>
            <PiCaretDown className="ml-auto size-2.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {AUTO_TUNE_PRESETS.map((p) => (
            <DropdownMenuItem key={p.name} onSelect={() => applyPreset(effectId, p.name)} className="flex-col items-start gap-0">
              <span className={cn("font-medium", p.name === preset && "text-tune-tuned")}>{p.name}</span>
              <span className="text-[10px] text-muted-foreground">{p.detail}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Toggle
        label="Formant"
        on={at.formant && !at.classic}
        disabled={at.classic}
        title={at.classic ? "Classic mode has no formant correction" : "Formant: keep the voice's character when its pitch moves (off, it moves with the pitch, as a tape would)"}
        onClick={() => setTune(effectId, { formant: !at.formant })}
      />
      <Toggle label="Classic" on={at.classic} title="Classic mode: sharper pitch correction between notes (no Formant, Throat, Transpose or Flex-Tune)" onClick={() => setTune(effectId, { classic: !at.classic })} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Options" title="Options" className="grid size-7 shrink-0 place-items-center rounded-sm raised text-muted-foreground hover:raised-hover hover:text-foreground">
            <PiDotsThreeBold className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="tune-options">
          <DropdownMenuCheckboxItem checked={at.ignoreVibrato} onCheckedChange={(ignoreVibrato) => setTune(effectId, { ignoreVibrato })}>
            Targeting ignores vibrato
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => copyTuneState(effectId)}>Copy state</DropdownMenuItem>
          <DropdownMenuItem disabled={!copied} onSelect={() => pasteTuneState(effectId)}>
            Paste state
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** A knob with its name above and its value below (Auto-Tune shows its numbers). */
function LabelledKnob({ label, value, children, small, disabled, title }: { label: string; value: string; children: React.ReactNode; small?: boolean; disabled?: boolean; title?: string }) {
  return (
    <div className={cn("flex flex-col items-center", small ? "gap-0 px-0.5" : "gap-1 px-1", disabled && "pointer-events-none opacity-35")} title={title}>
      <span className={cn("font-semibold tracking-wider text-muted-foreground uppercase", small ? "text-[8px]" : "text-[9px]")}>{label}</span>
      {children}
      <span className={cn("tabular-nums", small ? "text-[9px] text-muted-foreground" : "text-[11px] font-medium")}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The note, the meter and the pitch graph
// ---------------------------------------------------------------------------

/** The display: the note it's tuning to and the Pitch Change meter over the pitch graph. */
function Display({ effectId, at }: { effectId: string; at: AutoTune }) {
  const hold = useTuneView(effectId).hold;
  const note = useRef<HTMLSpanElement>(null);
  const correction = useRef<HTMLSpanElement>(null);
  const meter = useRef<HTMLCanvasElement>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-0">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-3">
        <div className="flex w-24 shrink-0 flex-col items-start leading-none">
          <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">Note</span>
          <span ref={note} className="mt-0.5 text-[26px] font-bold tracking-tight text-tune-tuned tabular-nums" data-testid="tune-note">
            –
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline justify-between text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">
            <span>Pitch change</span>
            <span ref={correction} className="tabular-nums normal-case" data-testid="tune-correction" />
          </div>
          <canvas ref={meter} className="h-5 w-full rounded-sm sunken" aria-label="Pitch change meter" />
          <div className="flex justify-between px-px text-[8px] text-muted-foreground tabular-nums">
            <span>-100</span>
            <span>-50</span>
            <span>0</span>
            <span>+50</span>
            <span>+100</span>
          </div>
        </div>
        <div className="flex w-32 shrink-0 flex-col items-end gap-1 text-right leading-tight">
          <span className="font-medium" data-testid="tune-key-text">
            {keyText(at.key, at.scale)}
            {notesEdited(at) ? <span className="text-muted-foreground"> (edited)</span> : null}
          </span>
          <button
            type="button"
            aria-pressed={hold}
            title="Hold: freeze the graph and meter to look at what was sung"
            className={cn("flex h-6 items-center gap-1 rounded-sm px-2 text-[10px] font-semibold tracking-wider uppercase", hold ? "pressed text-tune-tuned" : "raised text-muted-foreground hover:raised-hover")}
            onClick={() => useTuneUi.getState().setView(effectId, { hold: !hold })}
          >
            {hold ? <PiPlay className="size-3" /> : <PiPause className="size-3" />}
            Hold
          </button>
        </div>
      </div>
      <Graph effectId={effectId} at={at} hold={hold} note={note} correction={correction} meter={meter} />
    </div>
  );
}

/**
 * The pitch graph, drawn every frame from what the engine said (`pitch-history.ts`), with the note and
 * the meter above it (written straight into their elements: nothing re-renders as readings arrive). The
 * keyboard down its left edits the scale: a click tunes to a note, a right-click removes it, Shift+click
 * bypasses it.
 */
function Graph({
  effectId,
  at,
  hold,
  note,
  correction,
  meter,
}: {
  effectId: string;
  at: AutoTune;
  hold: boolean;
  note: React.RefObject<HTMLSpanElement | null>;
  correction: React.RefObject<HTMLSpanElement | null>;
  meter: React.RefObject<HTMLCanvasElement | null>;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const centre = useRef(60);
  const frozenAt = useRef<number | null>(null);
  frozenAt.current = hold ? (frozenAt.current ?? performance.now()) : null;

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !size.width || !size.height) return;
    let frame = 0;
    let last = performance.now();
    let said = "";
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const wall = performance.now();
      const dt = wall - last;
      last = wall;
      const now = frozenAt.current ?? wall;
      const history = pitchHistory(effectId);
      const latest = latestPitch(history, now);
      if (!frozenAt.current) centre.current = followCentre(centre.current, latest ? latest.sung : null, dt);
      const ctx = prepare(element, size.width, size.height);
      if (!ctx) return;
      const view: GraphView = { width: size.width, height: size.height, centre: centre.current };
      drawGraph(ctx, {
        view,
        notes: at.notes,
        history,
        now,
        sung: latest?.sung ?? null,
        target: latest && latest.target >= 0 ? latest.target : null,
        hover,
        palette: readPalette(element),
        colours: tuneColours(element),
      });
      // The note and the meter: what it's doing now.
      const cents = latest ? Math.round((latest.tuned - latest.sung) * 100) : null;
      const text = latest && latest.target >= 0 ? noteName(latest.target) : "–";
      const words = cents === null ? "" : cents === 0 ? "in tune" : `${signed(cents)} cents (${cents < 0 ? "was sharp" : "was flat"})`;
      if (`${text}|${words}` !== said) {
        said = `${text}|${words}`;
        if (note.current) note.current.textContent = text;
        if (correction.current) correction.current.textContent = words;
      }
      drawMeter(meter.current, cents, element);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [effectId, at.notes, size, hover, note, correction, meter]);

  const keyAt = (e: React.PointerEvent) => {
    const rect = wrap.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x > KEYS_WIDTH) return null;
    return noteAt({ width: size.width, height: size.height, centre: centre.current }, e.clientY - rect.top);
  };
  return (
    <div
      ref={wrap}
      className="relative min-h-0 flex-1 overflow-hidden"
      data-testid="tune-graph"
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={(e) => {
        const key = keyAt(e);
        if (key !== hover) setHover(key);
        e.currentTarget.style.cursor = key === null ? "default" : "pointer";
      }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        const key = keyAt(e);
        if (key === null) return;
        const pc = pitchClass(key);
        // FL's mouse: left turns on (a target), right turns off (removed); Shift bypasses (or un-bypasses).
        const next: AutoTuneNote = e.button === 2 ? "remove" : e.shiftKey ? (at.notes[pc] === "bypass" ? "tune" : "bypass") : "tune";
        setNote(effectId, pc, next);
      }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      <div className="pointer-events-none absolute right-2 bottom-1.5 flex gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-px w-3 bg-tune-sung" />
          Sung
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded-full bg-tune-tuned" />
          Tuned
        </span>
      </div>
    </div>
  );
}

/** The Pitch Change meter (Antares'): a bar from the middle, orange to the left (brought down), blue to the right (up). */
function drawMeter(element: HTMLCanvasElement | null, cents: number | null, from: Element) {
  if (!element) return;
  const width = element.clientWidth;
  const height = element.clientHeight;
  const ctx = prepare(element, width, height);
  if (!ctx) return;
  const colours = tuneColours(from);
  const palette = readPalette(from);
  ctx.clearRect(0, 0, width, height);
  const middle = width / 2;
  ctx.strokeStyle = palette.beatLine;
  for (const f of [-1, -0.5, 0, 0.5, 1]) {
    const x = Math.round(middle + (f * (width - 4)) / 2) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, f === 0 ? 2 : height - 5);
    ctx.lineTo(x, height - 2);
    ctx.stroke();
  }
  if (cents === null) return;
  const f = meterFraction(cents);
  const x = middle + (f * (width - 4)) / 2;
  ctx.save();
  ctx.fillStyle = f < 0 ? colours.sharp : colours.flat;
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 6;
  ctx.fillRect(Math.min(middle, x), 4, Math.max(2, Math.abs(x - middle)), height - 8);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The knobs
// ---------------------------------------------------------------------------

/** A knob's edit of the song, as a `SongKnob` wants it. */
const editTune = (song: MusicProject, effectId: string, patch: AutoTunePatch) => updateAutoTune(song, effectId, patch);

const target = (effectId: string, control: AutoTuneControl) => ({ kind: "autoTune" as const, effect: effectId, control });

function Knobs({ effectId, at }: { effectId: string; at: AutoTune }) {
  const retune = at.retuneSpeed;
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface-1 px-3 py-2">
      {/* Retune Speed: the knob that matters most, large, its value said as Auto-Tune users say it. */}
      <div className="flex items-center gap-2.5 rounded-lg bg-surface-2 py-1.5 pr-4 pl-1.5 raised">
        <SongKnob
          size={64}
          label="Retune Speed"
          value={retune}
          min={0}
          max={MAX_RETUNE}
          defaultValue={0}
          format={(v) => `${Math.round(v)} ms`}
          unit={MS}
          target={target(effectId, "retuneSpeed")}
          edit={(s, retuneSpeed) => editTune(s, effectId, { retuneSpeed })}
        />
        <div className="flex flex-col leading-tight">
          <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">Retune speed</span>
          <span className="text-[22px] font-bold text-tune-tuned tabular-nums" data-testid="tune-retune">
            {Math.round(retune)}
            <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">ms</span>
          </span>
          <span className="text-[10px] text-muted-foreground">{retune < 3 ? "Hard tune" : retune < 20 ? "Fast" : retune < 80 ? "Natural" : "Slow"}</span>
        </div>
      </div>
      <div className="flex flex-1 items-start justify-around">
        <LabelledKnob label="Humanize" value={amount(at.humanize)}>
          <SongKnob size={40} label="Humanize" value={at.humanize} min={0} max={1} defaultValue={0} format={amount} unit={AMOUNT} target={target(effectId, "humanize")} edit={(s, humanize) => editTune(s, effectId, { humanize })} />
        </LabelledKnob>
        <LabelledKnob label="Flex-Tune" value={amount(at.flexTune)} disabled={at.classic} title={at.classic ? "Classic mode has no Flex-Tune" : undefined}>
          <SongKnob size={40} label="Flex-Tune" value={at.flexTune} min={0} max={1} defaultValue={0} format={amount} unit={AMOUNT} target={target(effectId, "flexTune")} edit={(s, flexTune) => editTune(s, effectId, { flexTune })} />
        </LabelledKnob>
        <LabelledKnob label="Natural vibrato" value={signed(at.naturalVibrato, 1, " dB")}>
          <SongKnob
            size={40}
            label="Natural Vibrato"
            value={at.naturalVibrato}
            min={-MAX_NATURAL_VIBRATO}
            max={MAX_NATURAL_VIBRATO}
            defaultValue={0}
            bipolar
            format={(v) => signed(v, 1, " dB")}
            unit={DB}
            target={target(effectId, "naturalVibrato")}
            edit={(s, naturalVibrato) => editTune(s, effectId, { naturalVibrato })}
          />
        </LabelledKnob>
        <LabelledKnob label="Transpose" value={signed(at.transpose, 0, " st")} disabled={at.classic} title={at.classic ? "Classic mode has no Transpose" : undefined}>
          <SongKnob
            size={40}
            label="Transpose"
            value={at.transpose}
            min={-MAX_TRANSPOSE}
            max={MAX_TRANSPOSE}
            defaultValue={0}
            bipolar
            format={(v) => signed(Math.round(v), 0, " st")}
            unit={SEMITONES}
            target={target(effectId, "transpose")}
            edit={(s, transpose) => editTune(s, effectId, { transpose })}
          />
        </LabelledKnob>
        <LabelledKnob label="Throat" value={amount(at.throat)} disabled={!at.formant || at.classic} title={!at.formant || at.classic ? "Throat Length works with Formant on" : undefined}>
          <SongKnob
            size={40}
            label="Throat Length"
            value={at.throat}
            min={MIN_THROAT}
            max={MAX_THROAT}
            defaultValue={1}
            format={(v) => `${amount(v)} (${v > 1.02 ? "deeper" : v < 0.98 ? "brighter" : "as sung"})`}
            unit={AMOUNT}
            target={target(effectId, "throat")}
            edit={(s, throat) => editTune(s, effectId, { throat })}
          />
        </LabelledKnob>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Scale and Create Vibrato
// ---------------------------------------------------------------------------

function LowerPanel({ effectId, at }: { effectId: string; at: AutoTune }) {
  const panel = useTuneView(effectId).panel;
  return (
    <div className="flex h-[148px] shrink-0 flex-col border-t border-line bg-surface-1">
      <div className="flex h-7 shrink-0 items-end gap-1 border-b border-line px-2" role="tablist">
        {(
          [
            ["scale", "Edit scale"],
            ["vibrato", "Create vibrato"],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={panel === id}
            className={cn("-mb-px h-6 rounded-t-sm border border-b-0 px-3 text-[11px]", panel === id ? "border-line bg-surface-2 font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
            onClick={() => useTuneUi.getState().setView(effectId, { panel: id })}
          >
            {text}
            {id === "vibrato" && at.vibrato.shape !== "none" && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-tune-tuned align-middle" />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 bg-surface-2 p-2">{panel === "scale" ? <EditScale effectId={effectId} at={at} /> : <CreateVibrato effectId={effectId} at={at} />}</div>
    </div>
  );
}

const NOTE_TEXT: Record<AutoTuneNote, string> = { tune: "On", bypass: "Bypass", remove: "Remove" };

/** Edit Scale: each note On, Bypass or Remove (every octave alike), and the buttons that set them all. */
function EditScale({ effectId, at }: { effectId: string; at: AutoTune }) {
  return (
    <div className="flex h-full gap-3">
      <div className="grid min-w-0 flex-1 grid-cols-12 gap-px rounded-sm bg-line p-px" data-testid="tune-scale-notes">
        {NOTE_NAMES.map((name, pc) => {
          const state = at.notes[pc];
          const black = name.includes("#");
          return (
            <div key={name} className={cn("flex min-w-0 flex-col items-stretch gap-0.5 p-1", black ? "bg-surface-1" : "bg-surface-3")} data-note={name} data-state={state}>
              <button
                type="button"
                title={`${name}: ${NOTE_TEXT[state]} (click: on or removed)`}
                aria-label={`${name}: ${NOTE_TEXT[state]}`}
                className={cn(
                  "h-7 rounded-sm text-[11px] font-semibold",
                  state === "tune" ? "bg-tune-tuned text-brand-foreground shadow-[0_0_8px_-2px_var(--tune-tuned)]" : state === "bypass" ? "bg-tune-bypass text-black/80" : "sunken text-muted-foreground",
                )}
                onClick={() => setNote(effectId, pc, state === "tune" ? "remove" : "tune")}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setNote(effectId, pc, "remove");
                }}
              >
                {name}
              </button>
              <button
                type="button"
                aria-pressed={state === "bypass"}
                title="Bypass: this note passes as it's sung"
                className={cn("h-5 rounded-sm text-[9px] font-semibold", state === "bypass" ? "pressed text-tune-bypass" : "raised text-muted-foreground hover:raised-hover")}
                onClick={() => setNote(effectId, pc, state === "bypass" ? "tune" : "bypass")}
              >
                B
              </button>
              <button
                type="button"
                aria-pressed={state === "remove"}
                title="Remove: never a target (the nearest other note is)"
                className={cn("h-5 rounded-sm text-[9px] font-semibold", state === "remove" ? "pressed text-foreground" : "raised text-muted-foreground hover:raised-hover")}
                onClick={() => setNote(effectId, pc, state === "remove" ? "tune" : "remove")}
              >
                R
              </button>
            </div>
          );
        })}
      </div>
      <div className="grid w-44 shrink-0 grid-cols-2 content-start gap-1">
        <ScaleButton onClick={() => setAll(effectId, "tune")}>Set all</ScaleButton>
        <ScaleButton onClick={() => setTune(effectId, { notes: scaleNotes(at.key, at.scale) })}>Reset scale</ScaleButton>
        <ScaleButton onClick={() => setAll(effectId, "bypass")}>Bypass all</ScaleButton>
        <ScaleButton onClick={() => setAll(effectId, "remove")}>Remove all</ScaleButton>
        <ScaleButton onClick={() => setTune(effectId, { scale: "major" })}>Set major</ScaleButton>
        <ScaleButton onClick={() => setTune(effectId, { scale: "minor" })}>Set minor</ScaleButton>
      </div>
    </div>
  );
}

function ScaleButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="h-6 rounded-sm px-2 text-[11px] raised hover:raised-hover" onClick={onClick}>
      {children}
    </button>
  );
}

const SHAPES: { value: VibratoShape; text: string; icon: typeof PiWaveSine }[] = [
  { value: "none", text: "Off", icon: PiProhibit },
  { value: "sine", text: "Sine", icon: PiWaveSine },
  { value: "square", text: "Square", icon: PiWaveSquare },
  { value: "saw", text: "Saw", icon: PiWaveSawtooth },
];

/** Create Vibrato: its shape, then its rate, onset, variation and how much it moves the pitch, level and formants. */
function CreateVibrato({ effectId, at }: { effectId: string; at: AutoTune }) {
  const v = at.vibrato;
  const off = v.shape === "none";
  const vib = (patch: Partial<AutoTune["vibrato"]>) => (s: MusicProject) => editTune(s, effectId, { vibrato: patch });
  return (
    <div className="flex h-full items-center gap-4">
      <div className="flex flex-col gap-1" role="radiogroup" aria-label="Vibrato shape">
        <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">Shape</span>
        <div className="flex gap-0.5">
          {SHAPES.map(({ value, text, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={v.shape === value}
              title={text}
              className={cn("flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-sm text-[9px]", v.shape === value ? "pressed text-tune-tuned" : "raised text-muted-foreground hover:raised-hover")}
              onClick={() => setTune(effectId, { vibrato: { shape: value } })}
            >
              <Icon className="size-5" />
              {text}
            </button>
          ))}
        </div>
      </div>
      <div className={cn("flex flex-1 items-start justify-around", off && "opacity-50")}>
        <LabelledKnob label="Rate" value={`${v.rate.toFixed(1)} Hz`}>
          <SongKnob size={34} label="Vibrato rate" value={v.rate} min={0.1} max={10} defaultValue={5.5} format={(x) => `${x.toFixed(1)} Hz`} unit={HZ} target={target(effectId, "vibratoRate")} edit={(s, rate) => vib({ rate })(s)} />
        </LabelledKnob>
        <LabelledKnob label="Onset delay" value={`${Math.round(v.delay)} ms`}>
          <SongKnob size={34} label="Onset delay" value={v.delay} min={0} max={MAX_ONSET} defaultValue={500} format={(x) => `${Math.round(x)} ms`} unit={MS} target={target(effectId, "vibratoDelay")} edit={(s, delay) => vib({ delay })(s)} />
        </LabelledKnob>
        <LabelledKnob label="Onset rate" value={`${Math.round(v.onset)} ms`}>
          <SongKnob size={34} label="Onset rate" value={v.onset} min={0} max={MAX_ONSET} defaultValue={500} format={(x) => `${Math.round(x)} ms`} unit={MS} target={target(effectId, "vibratoOnset")} edit={(s, onset) => vib({ onset })(s)} />
        </LabelledKnob>
        <LabelledKnob label="Variation" value={amount(v.variation)}>
          <SongKnob size={34} label="Variation" value={v.variation} min={0} max={1} defaultValue={0.2} format={amount} unit={AMOUNT} target={target(effectId, "vibratoVariation")} edit={(s, variation) => vib({ variation })(s)} />
        </LabelledKnob>
        <LabelledKnob label="Pitch" value={`${Math.round(v.pitch)}¢`}>
          <SongKnob size={34} label="Pitch amount" value={v.pitch} min={0} max={100} defaultValue={18} format={(x) => `${Math.round(x)} cents`} unit={CENTS_UNIT} target={target(effectId, "vibratoPitch")} edit={(s, pitch) => vib({ pitch })(s)} />
        </LabelledKnob>
        <LabelledKnob label="Amplitude" value={amount(v.amplitude)}>
          <SongKnob size={34} label="Amplitude amount" value={v.amplitude} min={0} max={MAX_VIBRATO_AMPLITUDE} defaultValue={0.1} format={amount} unit={AMOUNT} target={target(effectId, "vibratoAmplitude")} edit={(s, amplitude) => vib({ amplitude })(s)} />
        </LabelledKnob>
        <LabelledKnob label="Formant" value={amount(v.formant)}>
          <SongKnob size={34} label="Formant amount" value={v.formant} min={0} max={1} defaultValue={0.7} format={amount} unit={AMOUNT} target={target(effectId, "vibratoFormant")} edit={(s, formant) => vib({ formant })(s)} />
        </LabelledKnob>
      </div>
    </div>
  );
}
