import { useEffect, useRef, useState } from "react";
import { PiArrowCounterClockwise, PiArrowsLeftRight, PiCaretDown, PiCaretLeft, PiCaretLeftFill, PiCaretRight, PiCaretRightFill, PiDotsThree } from "react-icons/pi";
import { cn } from "cn";
import { mixerTrackName } from "@shared/music/automation";
import { editorEvents, editorSteps, generatedShapePattern, generatedStepPattern, isPatternMode, isRhythmMode, isTriggerMode, panEdited, setPatternLayout, updatePanMan } from "@shared/music/panman";
import {
  MAX_PAN_BARS,
  MAX_PAN_BEATS_PER_BAR,
  MAX_PAN_CUTOFF,
  MAX_PAN_DIVIDER,
  MAX_PAN_FILTER_GAIN,
  MAX_PAN_GAIN,
  MAX_PAN_RATE,
  MAX_PAN_RATE_MOD,
  MAX_PAN_STEPS,
  MAX_PAN_TIME,
  MAX_PAN_WIDTH,
  MIN_PAN_CUTOFF,
  MIN_PAN_LEVEL,
  MIN_PAN_RATE,
  MIN_PAN_STEPS,
  PANMAN_PRESETS,
  PAN_CURVES,
  PAN_LIMIT,
  PAN_MODES,
  PAN_RHYTHMS,
  PAN_STYLES,
  dbText,
  degreesText,
  panRhythm,
  patternTicks,
  rateText,
} from "@shared/music/panman-presets";
import { type MixerEffect, type MusicProject, type PanDirection, type PanMan, PPQ } from "@shared/music/types";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MILLISECONDS, type ValueUnit, PERCENT, SongKnob, percent, seconds } from "../knob";
import { Lcd } from "../lcd";
import { prepare, readPalette } from "../piano/draw";
import { positionNow } from "../playhead";
import { songGesture, useMusic, useSong } from "../store";
import { useTransport } from "../transport";
import { panManWindow } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { closePanMan, copyState, loadPreset, manualTrigger, pasteState, revert, stepPreset, tap } from "./actions";
import { drawMeter, drawShapeEditor, drawStepEditor, panColours } from "./draw";
import { IO_LEDS, METER_LEDS, PAN_GRIDS, editorBox, gridTicks, hitEvent, hitPoint, ioLit, meterLeds } from "./geometry";
import { type EditorTarget, shapeCursor, shapePointerDown, stepCursor, stepPointerDown } from "./pointer";
import { usePanUi, usePanView } from "./store";
import { AutomateTouched } from "../automation/touched";

/** The window's width (it fits its content's height: the Tweak panel makes it taller). */
const WIDTH = 720;

const DEGREES: ValueUnit = { scale: 1, unit: "°" };
const DB: ValueUnit = { scale: 1, unit: "dB", digits: 1 };
const HZ: ValueUnit = { scale: 1, unit: "Hz", digits: 2 };
const OCTAVES: ValueUnit = { scale: 1, unit: "oct", digits: 2 };
const WHOLE: ValueUnit = { scale: 1, unit: "" };

/** The effect in the song, by id (the object itself, so a selector of it is stable). */
function effectOf(song: MusicProject, effectId: string): MixerEffect | null {
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect;
  return null;
}
const trackOf = (song: MusicProject, effectId: string) => song.mixer.tracks.find((t) => t.effects.some((e) => e?.id === effectId))?.id ?? "";
const set = (effectId: string, patch: Parameters<typeof updatePanMan>[2]) => useMusic.getState().commit((s) => updatePanMan(s, effectId, patch));
const modeName = (mode: PanMan["mode"]) => PAN_MODES.find((m) => m.id === mode)?.name ?? mode;

/**
 * A PanMan's window (`docs/soundtoys/panman.md`), Soundtoys' layout in our look: the preset bar; the
 * common knobs over the Pan Position Meter, the mode's own controls over the mode button, Input and
 * Output with their LEDs and Tweak; and the Tweak panel under them (the dynamics or the trigger's
 * filter, the Analog Style, the mode's editor).
 */
export function PanManWindow({ effectId, index }: { effectId: string; index: number }) {
  const effect = useSong((s) => effectOf(s, effectId));
  const owner = useSong((s) => mixerTrackName(s, trackOf(s, effectId)));
  const tweak = usePanView(effectId).tweak;
  const [initial] = useState(() => {
    const place = centredOnDesktop(WIDTH, 260);
    return { ...place, x: place.x + index * 28, y: Math.min(place.y, 60) + index * 28 };
  });
  const pm = effect?.panMan;
  // Its effect deleted (or replaced): its window goes, as a plugin's does.
  const gone = !pm;
  useEffect(() => {
    if (gone) closePanMan(effectId);
  }, [gone, effectId]);
  if (!effect || !pm) return null;
  return (
    <MusicWindow id={panManWindow(effectId)} title={`${effect.plugin.name} (${owner})`} initial={initial} onClose={() => closePanMan(effectId)} controls={<AutomateTouched effectId={effectId} />}>
      <div className="flex select-none flex-col text-xs" style={{ width: WIDTH }} data-testid="panman" data-effect={effectId} data-mode={pm.mode}>
        <PresetBar effectId={effectId} pm={pm} />
        <div className="flex items-stretch gap-2 bg-surface-1 p-2">
          <CommonSection effectId={effectId} pm={pm} />
          <ModeSection effectId={effectId} pm={pm} />
          <IoSection effectId={effectId} pm={pm} />
        </div>
        {tweak && <TweakPanel effectId={effectId} pm={pm} />}
      </div>
    </MusicWindow>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A knob as PanMan labels them: its name over it, its scale's ends under it. */
function PanKnob({ name, ends, ...knob }: Parameters<typeof SongKnob>[0] & { name: string; ends?: [string, string] }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{name}</span>
      <SongKnob size={36} {...knob} />
      {ends && (
        <div className="flex w-16 justify-between text-[8px] font-medium tracking-wide text-muted-foreground uppercase">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}

/** One of the three rounded sections of the panel. */
function Section({ className, children, label }: { className?: string; children: React.ReactNode; label: string }) {
  return (
    <section aria-label={label} className={cn("flex flex-col rounded-lg border border-line bg-surface-0 p-2 sunken", className)}>
      {children}
    </section>
  );
}

/** A number display (PanMan's LCDs) on the song: dragged or scrolled, one undo step. */
function SongLcd({ label, value, min, max, text, derived, edit, menu, className }: { label: string; value: number; min: number; max: number; text?: string; derived?: boolean; edit: (song: MusicProject, value: number) => MusicProject; menu?: React.ReactNode; className?: string }) {
  const gesture = useRef(songGesture()).current;
  return (
    <Lcd
      label={label}
      value={value}
      min={min}
      max={max}
      text={text}
      derived={derived}
      menu={menu}
      className={cn("font-mono text-[11px]", className)}
      onBegin={() => gesture.begin()}
      onChange={(v) => gesture.apply((song) => edit(song, v))}
      onEnd={() => gesture.end()}
      onCancel={() => gesture.cancel()}
    />
  );
}

function Labelled({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-0.5", className)}>
      <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  );
}

/** A small square button that's lit while it's on (the Direction buttons, Sync). */
function LitButton({ label, on, onClick, children, className }: { label: string; on: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={cn("grid h-6 min-w-7 place-items-center rounded-sm px-1 text-[10px] font-semibold", on ? "pressed text-brand" : "raised text-muted-foreground hover:raised-hover hover:text-foreground", className)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Runs `draw` once a frame while the component is there. */
function useFrame(draw: () => void, deps: unknown[]) {
  const latest = useRef(draw);
  latest.current = draw;
  useEffect(() => {
    let frame = 0;
    const run = () => {
      frame = requestAnimationFrame(run);
      latest.current();
    };
    run();
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ---------------------------------------------------------------------------
// The preset bar
// ---------------------------------------------------------------------------

/** ‹ › the preset's name (its menu), Revert (lit once it's changed), and Copy / Paste state. */
function PresetBar({ effectId, pm }: { effectId: string; pm: PanMan }) {
  const edited = panEdited(pm);
  const copied = usePanUi((s) => s.copied !== null);
  return (
    <div className="flex h-9 items-center gap-1 border-b border-line bg-surface-2 px-2">
      <span className="shrink-0 px-1 text-[13px] font-semibold tracking-wide">YT-Pan</span>
      <LitButton label="Previous preset" on={false} onClick={() => stepPreset(effectId, -1)}>
        <PiCaretLeft className="size-3.5" />
      </LitButton>
      <LitButton label="Next preset" on={false} onClick={() => stepPreset(effectId, 1)}>
        <PiCaretRight className="size-3.5" />
      </LitButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex h-6 w-60 items-center justify-between gap-1 rounded-sm px-2 font-mono text-[11px] sunken" aria-label={`Preset: ${pm.preset}${edited ? " (changed)" : ""}`} data-testid="panman-preset">
            <span className="truncate">
              {pm.preset}
              {edited && <span className="text-muted-foreground"> *</span>}
            </span>
            <PiCaretDown className="size-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 overflow-y-auto">
          {PAN_MODES.map((mode) => (
            <div key={mode.id}>
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">{mode.name}</DropdownMenuLabel>
              {PANMAN_PRESETS.filter((p) => p.settings.mode === mode.id).map((p) => (
                <DropdownMenuItem key={p.name} onSelect={() => loadPreset(effectId, p.name)} title={p.detail}>
                  <span className={cn(p.name === pm.preset && "font-semibold text-brand")}>{p.name}</span>
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={`Revert to ${pm.preset}`}
        title={edited ? `Revert to the preset ${pm.preset}` : "As the preset is"}
        disabled={!edited}
        className={cn("grid size-6 place-items-center rounded-sm", edited ? "raised text-brand hover:raised-hover" : "text-muted-foreground opacity-50")}
        onClick={() => revert(effectId)}
      >
        <PiArrowCounterClockwise className="size-3.5" />
      </button>
      <div className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="YT-Pan's menu" className="grid size-6 place-items-center rounded-sm text-muted-foreground raised hover:raised-hover">
            <PiDotsThree className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => copyState(effectId)}>Copy state</DropdownMenuItem>
          <DropdownMenuItem disabled={!copied} onSelect={() => pasteState(effectId)}>
            Paste state
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The left section: the common knobs and the meter
// ---------------------------------------------------------------------------

const feelText = (v: number) => (Math.abs(v) < 0.005 ? "On the beat" : `${v < 0 ? "Rush" : "Drag"} ${Math.round(Math.abs(v) * 100)}%`);
const grooveText = (v: number) => (Math.abs(v) < 0.005 ? "Straight" : `${v < 0 ? "Shuffle" : "Swing"} ${Math.round(Math.abs(v) * 100)}%`);

function CommonSection({ effectId, pm }: { effectId: string; pm: PanMan }) {
  return (
    <Section label="Position" className="flex-1 gap-2">
      <div className="flex items-start justify-around">
        {pm.mode === "rhythmStep" && (
          <PanKnob name="Feel" ends={["Rush", "Drag"]} label="Feel" value={pm.feel} min={-1} max={1} defaultValue={0} bipolar format={feelText} unit={PERCENT} target={{ kind: "panMan", effect: effectId, control: "feel" }} edit={(s, feel) => updatePanMan(s, effectId, { feel })} />
        )}
        {pm.mode === "rhythmShape" && (
          <PanKnob name="Groove" ends={["Shuf", "Swng"]} label="Groove" value={pm.groove} min={-1} max={1} defaultValue={0} bipolar format={grooveText} unit={PERCENT} target={{ kind: "panMan", effect: effectId, control: "groove" }} edit={(s, groove) => updatePanMan(s, effectId, { groove })} />
        )}
        <PanKnob
          name="Offset"
          ends={["Left", "Right"]}
          label="Offset"
          value={pm.offset}
          min={-PAN_LIMIT}
          max={PAN_LIMIT}
          defaultValue={0}
          bipolar
          format={degreesText}
          unit={DEGREES}
          target={{ kind: "panMan", effect: effectId, control: "offset" }}
          edit={(s, offset) => updatePanMan(s, effectId, { offset })}
        />
        <PanKnob
          name="Width"
          ends={["Min", "Max"]}
          label="Width"
          value={pm.width}
          min={0}
          max={MAX_PAN_WIDTH}
          defaultValue={180}
          format={(v) => `${Math.round(v)}°`}
          unit={DEGREES}
          target={{ kind: "panMan", effect: effectId, control: "width" }}
          edit={(s, width) => updatePanMan(s, effectId, { width })}
        />
        <PanKnob name="Smoothing" ends={["Hard", "Soft"]} label="Smoothing" value={pm.smoothing} min={0} max={1} defaultValue={0.5} format={percent} unit={PERCENT} target={{ kind: "panMan", effect: effectId, control: "smoothing" }} edit={(s, smoothing) => updatePanMan(s, effectId, { smoothing })} />
      </div>
      <PanMeter effectId={effectId} />
    </Section>
  );
}

/** The Pan Position Meter: where the engine says the sound is, the LEDs it passed fading (trails). */
function PanMeter({ effectId }: { effectId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const leds = useRef<number[]>(Array(METER_LEDS).fill(0));
  const said = useRef<unknown>(null);
  const width = 300;
  const height = 26;
  useFrame(() => {
    const element = canvas.current;
    if (!element) return;
    const state = useTransport.getState().panMen[effectId];
    // A new word from the engine lights where it's been since; between words, they fade.
    if (state && state !== said.current) {
      said.current = state;
      leds.current = meterLeds(leds.current, state.least, state.most, 0.82);
    } else leds.current = leds.current.map((v, i) => (state && i === Math.round(((state.position + PAN_LIMIT) / (2 * PAN_LIMIT)) * (METER_LEDS - 1)) ? Math.max(v, 1) : v * 0.82));
    const ctx = prepare(element, width, height);
    if (ctx) drawMeter(ctx, width, height, leds.current, panColours(element), readPalette(element));
  }, [effectId]);
  return <canvas ref={canvas} className="mx-auto" style={{ width, height }} role="img" aria-label="Pan position" data-testid="panman-meter" />;
}

// ---------------------------------------------------------------------------
// The centre section: the mode's controls
// ---------------------------------------------------------------------------

const DIRECTIONS: { id: PanDirection; label: string; icon: React.ReactNode }[] = [
  { id: "down", label: "Right to left", icon: <PiCaretLeftFill className="size-3" /> },
  { id: "both", label: "Back and forth", icon: <PiArrowsLeftRight className="size-3.5" /> },
  { id: "up", label: "Left to right", icon: <PiCaretRightFill className="size-3" /> },
];

function Direction({ effectId, pm }: { effectId: string; pm: PanMan }) {
  // In Rhythm Step, a custom pattern says the order itself (Direction does nothing).
  const idle = pm.mode === "rhythmStep" && pm.custom;
  return (
    <div className={cn("flex gap-1", idle && "opacity-50")} role="radiogroup" aria-label="Direction">
      {DIRECTIONS.map((d) => (
        <LitButton key={d.id} label={d.label} on={pm.direction === d.id} onClick={() => set(effectId, { direction: d.id })}>
          {d.icon}
        </LitButton>
      ))}
    </div>
  );
}

function ModeSection({ effectId, pm }: { effectId: string; pm: PanMan }) {
  return (
    <Section label="Modulation" className="w-[236px] items-center justify-between gap-2">
      <div className="flex flex-col items-center gap-2">
        {pm.mode === "lfo" && (
          <>
            <PanKnob
              name="Rate"
              ends={[".01 Hz", "10 Hz"]}
              label="Rate"
              value={pm.rate}
              min={MIN_PAN_RATE}
              max={MAX_PAN_RATE}
              defaultValue={0.5}
              taper="log"
              format={rateText}
              unit={HZ}
              target={{ kind: "panMan", effect: effectId, control: "rate" }}
              edit={(s, rate) => updatePanMan(s, effectId, { rate })}
            />
            <Direction effectId={effectId} pm={pm} />
          </>
        )}
        {(pm.mode === "rhythmStep" || pm.mode === "rhythmShape") && <Direction effectId={effectId} pm={pm} />}
        {isRhythmMode(pm.mode) && <RhythmControls effectId={effectId} pm={pm} />}
        {isTriggerMode(pm.mode) && <TriggerControls effectId={effectId} pm={pm} />}
      </div>
      <ModeButton effectId={effectId} pm={pm} />
    </Section>
  );
}

/** The mode's name over its button: a click opens the six modes. */
function ModeButton({ effectId, pm }: { effectId: string; pm: PanMan }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex h-6 items-center gap-1 rounded-sm px-2.5 text-[11px] font-semibold tracking-wider uppercase raised hover:raised-hover" aria-label={`Mode: ${modeName(pm.mode)}`} data-testid="panman-mode">
          {modeName(pm.mode)}
          <PiCaretDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={pm.mode} onValueChange={(mode) => set(effectId, { mode: mode as PanMan["mode"] })}>
          {PAN_MODES.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id}>
              {m.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Rhythm (and Steps in Rhythm Step), Tap Tempo and its BPM, and Sync (PanMan's MIDI switch). */
function RhythmControls({ effectId, pm }: { effectId: string; pm: PanMan }) {
  const songTempo = useSong((s) => s.settings.tempo);
  const rhythm = PAN_RHYTHMS.findIndex((r) => r.id === pm.rhythm);
  const custom = pm.custom && pm.mode !== "random";
  const openTweak = () => usePanUi.getState().setView(effectId, { tweak: true });
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-end gap-2">
        <Labelled label="Rhythm">
          <SongLcd
            label="Rhythm"
            value={rhythm}
            min={0}
            max={PAN_RHYTHMS.length - 1}
            text={custom ? "Custom" : PAN_RHYTHMS[rhythm].name}
            className="w-24 justify-center"
            edit={(s, v) => updatePanMan(s, effectId, { rhythm: PAN_RHYTHMS[v].id, custom: false })}
            menu={
              <>
                {PAN_RHYTHMS.map((r) => (
                  <ContextMenuItem key={r.id} onSelect={() => set(effectId, { rhythm: r.id, custom: false })}>
                    <span className={cn(r.id === pm.rhythm && !custom && "font-semibold text-brand")}>{r.name}</span>
                  </ContextMenuItem>
                ))}
                {pm.mode !== "random" && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={openTweak}>Edit…</ContextMenuItem>
                  </>
                )}
              </>
            }
          />
        </Labelled>
        {pm.mode === "rhythmStep" && (
          <Labelled label="Steps" className={cn(custom && "opacity-50")}>
            <SongLcd label="Steps" value={pm.steps} min={MIN_PAN_STEPS} max={MAX_PAN_STEPS} className="w-10 justify-center" edit={(s, steps) => updatePanMan(s, effectId, { steps })} />
          </Labelled>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className="h-6 rounded-sm px-2 text-[10px] font-semibold tracking-wider uppercase raised hover:raised-hover active:pressed" title="Tap Tempo: tap in time (three taps set the tempo, out of time with the song)" onClick={() => tap(effectId)}>
          Tap
        </button>
        <SongLcd
          label="Tempo"
          value={Math.round(pm.sync ? songTempo : pm.tempo)}
          min={20}
          max={999}
          text={`${(pm.sync ? songTempo : pm.tempo).toFixed(1)} bpm`}
          derived={pm.sync}
          className="w-[76px] justify-center"
          edit={(s, tempo) => updatePanMan(s, effectId, { tempo, sync: false })}
        />
        <LitButton label="Sync: in time with the song (YT-Pan's MIDI switch)" on={pm.sync} onClick={() => set(effectId, { sync: !pm.sync, tempo: pm.sync ? songTempo : pm.tempo })}>
          Sync
        </LitButton>
      </div>
    </div>
  );
}

/** Trigger (its level under it), the Manual Trigger, and Divider with its count. */
function TriggerControls({ effectId, pm }: { effectId: string; pm: PanMan }) {
  const count = useTransport((s) => s.panMen[effectId]?.count ?? 0);
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center gap-1">
        <PanKnob name="Trigger" ends={["-40", "Off"]} label="Trigger" value={pm.trigger} min={MIN_PAN_LEVEL} max={0} defaultValue={-20} format={(v) => (v >= -0.01 ? "Off" : dbText(v))} unit={DB} target={{ kind: "panMan", effect: effectId, control: "trigger" }} edit={(s, trigger) => updatePanMan(s, effectId, { trigger })} />
        <LevelStrip effectId={effectId} at={pm.trigger} />
        <button type="button" className="h-6 rounded-sm px-2 text-[10px] font-semibold tracking-wider uppercase raised hover:raised-hover active:pressed" title="Manual Trigger: a trigger now (only while the sound is under the Trigger's level)" onClick={() => void manualTrigger(effectId)}>
          Trigger
        </button>
      </div>
      <div className="flex flex-col items-center gap-1">
        <PanKnob
          name="Divider"
          ends={["1", "12"]}
          label="Divider"
          value={pm.divider}
          min={1}
          max={MAX_PAN_DIVIDER}
          defaultValue={1}
          format={(v) => `Every ${Math.round(v) === 1 ? "trigger" : `${Math.round(v)} triggers`}`}
          unit={WHOLE}
          target={{ kind: "panMan", effect: effectId, control: "divider" }}
          edit={(s, divider) => updatePanMan(s, effectId, { divider: Math.round(divider) })}
        />
        <div className="flex gap-0.5" aria-label={`Count: ${count} of ${pm.divider}`} data-testid="panman-count">
          {Array.from({ length: MAX_PAN_DIVIDER }, (_, i) => (
            <span key={i} className={cn("size-1.5 rounded-full", i >= pm.divider ? "bg-(--meter-off) opacity-40" : i < count ? "bg-(--meter-mid)" : "bg-(--meter-low)")} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The level the Threshold or Trigger knob sees (the ticks round PanMan's light red with it): a bar, the knob's level marked. */
function LevelStrip({ effectId, at }: { effectId: string; at: number }) {
  const bar = useRef<HTMLDivElement>(null);
  useFrame(() => {
    const level = useTransport.getState().panMen[effectId]?.level ?? -120;
    if (bar.current) bar.current.style.width = `${Math.max(0, Math.min(1, (level - MIN_PAN_LEVEL) / -MIN_PAN_LEVEL)) * 100}%`;
  }, [effectId]);
  return (
    <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-(--meter-off)" title="The level it hears">
      <div ref={bar} className="h-full bg-(--meter-high)" />
      <span className="absolute top-0 h-full w-px bg-foreground" style={{ left: `${((at - MIN_PAN_LEVEL) / -MIN_PAN_LEVEL) * 100}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The right section: Input, Output, Tweak
// ---------------------------------------------------------------------------

function IoSection({ effectId, pm }: { effectId: string; pm: PanMan }) {
  const tweak = usePanView(effectId).tweak;
  return (
    <Section label="Levels" className="items-center justify-between gap-2">
      <div className="flex gap-3">
        {(["input", "output"] as const).map((control) => (
          <div key={control} className="flex flex-col items-center gap-1">
            <PanKnob
              name={control === "input" ? "Input" : "Output"}
              ends={["-24", "+24"]}
              label={control === "input" ? "Input" : "Output"}
              value={pm[control]}
              min={-MAX_PAN_GAIN}
              max={MAX_PAN_GAIN}
              defaultValue={0}
              bipolar
              format={dbText}
              unit={DB}
              target={{ kind: "panMan", effect: effectId, control }}
              edit={(s, v) => updatePanMan(s, effectId, { [control]: v })}
            />
            <IoLeds effectId={effectId} which={control} />
          </div>
        ))}
      </div>
      <LitButton label="Tweak: more controls" on={tweak} className="px-3 tracking-wider uppercase" onClick={() => usePanUi.getState().setView(effectId, { tweak: !tweak })}>
        Tweak
      </LitButton>
    </Section>
  );
}

/** Five LEDs: three green, a yellow 6 dB under clipping, a red at it, held a moment. */
function IoLeds({ effectId, which }: { effectId: string; which: "input" | "output" }) {
  const leds = useRef<(HTMLSpanElement | null)[]>([]);
  const held = useRef(0);
  useFrame(() => {
    const peak = useTransport.getState().panMen[effectId]?.[which] ?? 0;
    held.current = Math.max(ioLit(peak), held.current * 0.94);
    leds.current.forEach((led, i) => led && (led.style.opacity = i < Math.round(held.current) ? "1" : "0.18"));
  }, [effectId, which]);
  return (
    <div className="flex gap-0.5" aria-hidden>
      {IO_LEDS.map((_, i) => (
        <span key={i} ref={(el) => void (leds.current[i] = el)} className={cn("size-1.5 rounded-full", i < 3 ? "bg-(--meter-low)" : i === 3 ? "bg-(--meter-mid)" : "bg-(--meter-high)")} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Tweak panel
// ---------------------------------------------------------------------------

function TweakPanel({ effectId, pm }: { effectId: string; pm: PanMan }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line bg-surface-1 p-2" data-testid="panman-tweak">
      <div className="flex items-stretch gap-2">
        {isPatternMode(pm.mode) && <Dynamics effectId={effectId} pm={pm} />}
        {isTriggerMode(pm.mode) && <TriggerFilter effectId={effectId} pm={pm} />}
        {pm.mode === "random" && <p className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-muted-foreground">Random moves on its own: there's nothing to tweak but its Analog Style.</p>}
        <AnalogStyle effectId={effectId} pm={pm} />
      </div>
      {pm.mode === "rhythmStep" && <PatternEditor effectId={effectId} pm={pm} editor="step" />}
      {pm.mode === "rhythmShape" && <PatternEditor effectId={effectId} pm={pm} editor="shape" />}
    </div>
  );
}

function Group({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("flex flex-col rounded-lg border border-line bg-surface-0 sunken", className)}>
      <h3 className="rounded-t-lg border-b border-line bg-surface-2 px-2 py-0.5 text-center text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      <div className="flex flex-1 items-start justify-around gap-2 p-2">{children}</div>
    </section>
  );
}

/** Two choices, each a small LED and its name (PanMan's Env / Gate, Monitor). */
function LedChoice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { id: T; name: string }[]; onChange: (v: T) => void }) {
  return (
    <Labelled label={label}>
      <div className="flex flex-col gap-1 pt-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className="flex items-center gap-1.5 text-[10px] font-medium uppercase hover:text-foreground" onClick={() => onChange(o.id)}>
            <span className={cn("size-2 rounded-full", value === o.id ? "bg-(--meter-high)" : "bg-(--meter-off)")} />
            <span className={value === o.id ? "text-foreground" : "text-muted-foreground"}>{o.name}</span>
          </button>
        ))}
      </div>
    </Labelled>
  );
}

const signedDegrees = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}°`;

function Dynamics({ effectId, pm }: { effectId: string; pm: PanMan }) {
  const edit = (patch: Parameters<typeof updatePanMan>[2]) => (s: MusicProject) => updatePanMan(s, effectId, patch);
  return (
    <Group title="Dynamics" className="flex-1">
      <div className="flex flex-col items-center gap-1">
        <PanKnob name="Threshold" ends={["-40 dB", "0 dB"]} label="Threshold" value={pm.threshold} min={MIN_PAN_LEVEL} max={0} defaultValue={-20} format={dbText} unit={DB} target={{ kind: "panMan", effect: effectId, control: "threshold" }} edit={(s, threshold) => edit({ threshold })(s)} />
        <LevelStrip effectId={effectId} at={pm.threshold} />
      </div>
      <PanKnob name="Attack" ends={["Min", "Max"]} label="Attack" value={pm.attack} min={0} max={MAX_PAN_TIME} defaultValue={0.01} format={seconds} unit={MILLISECONDS} target={{ kind: "panMan", effect: effectId, control: "attack" }} edit={(s, attack) => edit({ attack })(s)} />
      <PanKnob name="Release" ends={["Min", "Max"]} label="Release" value={pm.release} min={0} max={MAX_PAN_TIME} defaultValue={0.2} format={seconds} unit={MILLISECONDS} target={{ kind: "panMan", effect: effectId, control: "release" }} edit={(s, release) => edit({ release })(s)} />
      <LedChoice label="Mode" value={pm.gate ? "gate" : "env"} options={[{ id: "env", name: "Env" }, { id: "gate", name: "Gate" }]} onChange={(v) => set(effectId, { gate: v === "gate" })} />
      <PanKnob name="OffsetMod" ends={["Left", "Right"]} label="Offset Mod" value={pm.offsetMod} min={-PAN_LIMIT} max={PAN_LIMIT} defaultValue={0} bipolar format={signedDegrees} unit={DEGREES} target={{ kind: "panMan", effect: effectId, control: "offsetMod" }} edit={(s, offsetMod) => edit({ offsetMod })(s)} />
      <PanKnob name="WidthMod" ends={["Slim", "Wide"]} label="Width Mod" value={pm.widthMod} min={-MAX_PAN_WIDTH} max={MAX_PAN_WIDTH} defaultValue={0} bipolar format={signedDegrees} unit={DEGREES} target={{ kind: "panMan", effect: effectId, control: "widthMod" }} edit={(s, widthMod) => edit({ widthMod })(s)} />
      <PanKnob
        name="RateMod"
        ends={["Slow", "Fast"]}
        label="Rate Mod"
        value={pm.rateMod}
        min={-MAX_PAN_RATE_MOD}
        max={MAX_PAN_RATE_MOD}
        defaultValue={0}
        bipolar
        format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} oct`}
        unit={OCTAVES}
        target={{ kind: "panMan", effect: effectId, control: "rateMod" }}
          edit={(s, rateMod) => edit({ rateMod })(s)}
      />
    </Group>
  );
}

/** A 12 dB / octave filter's gain at `f` (the trigger filter's picture). */
function filterGain(type: PanMan["filter"], cutoff: number, f: number) {
  const r = (f / cutoff) ** 2;
  return type === "lpf" ? 1 / Math.sqrt(1 + r * r) : type === "hpf" ? r / Math.sqrt(1 + r * r) : 1;
}

function TriggerFilter({ effectId, pm }: { effectId: string; pm: PanMan }) {
  const edit = (patch: Parameters<typeof updatePanMan>[2]) => (s: MusicProject) => updatePanMan(s, effectId, patch);
  // Its curve from 20 Hz to 20 kHz, -24 dB at the bottom.
  const curve = Array.from({ length: 61 }, (_, i) => {
    const f = 20 * 1000 ** (i / 60);
    const db = 20 * Math.log10(Math.max(1e-6, filterGain(pm.filter, pm.cutoff, f)));
    return `${i === 0 ? "M" : "L"}${(i / 60) * 120},${Math.min(44, (-db / 24) * 40 + 4)}`;
  }).join(" ");
  return (
    <Group title="Trigger filter" className="flex-1">
      <LedChoice
        label="Type"
        value={pm.filter}
        options={[
          { id: "hpf", name: "HPF" },
          { id: "off", name: "Off" },
          { id: "lpf", name: "LPF" },
        ]}
        onChange={(filter) => set(effectId, { filter })}
      />
      <PanKnob name="Cutoff" ends={["100Hz", "15kHz"]} label="Cutoff" value={pm.cutoff} min={MIN_PAN_CUTOFF} max={MAX_PAN_CUTOFF} defaultValue={1000} taper="log" format={(v) => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(1)} kHz`)} unit={{ scale: 1, unit: "Hz" }} target={{ kind: "panMan", effect: effectId, control: "cutoff" }} edit={(s, cutoff) => edit({ cutoff })(s)} />
      <PanKnob name="Gain" ends={["-20dB", "20dB"]} label="Filter gain" value={pm.filterGain} min={-MAX_PAN_FILTER_GAIN} max={MAX_PAN_FILTER_GAIN} defaultValue={0} bipolar format={dbText} unit={DB} target={{ kind: "panMan", effect: effectId, control: "filterGain" }} edit={(s, filterGain) => edit({ filterGain })(s)} />
      <LedChoice label="Monitor" value={pm.monitor ? "on" : "off"} options={[{ id: "off", name: "Off" }, { id: "on", name: "On" }]} onChange={(v) => set(effectId, { monitor: v === "on" })} />
      <svg viewBox="0 0 120 48" className="h-12 w-[120px] self-center rounded-sm bg-surface-1 sunken" role="img" aria-label="The trigger filter's curve">
        <path d={`${curve} L120,48 L0,48 Z`} className="fill-brand/25 stroke-brand" strokeWidth={1.5} />
      </svg>
    </Group>
  );
}

function AnalogStyle({ effectId, pm }: { effectId: string; pm: PanMan }) {
  return (
    <Group title="Analog style" className="w-[168px]">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1" role="radiogroup" aria-label="Analog style">
        {PAN_STYLES.map((style) => (
          <button key={style.id} type="button" role="radio" aria-checked={pm.style === style.id} title={style.detail} className="flex items-center gap-1.5 text-[10px] font-medium uppercase" onClick={() => set(effectId, { style: style.id })}>
            <span className={cn("size-2 rounded-full", pm.style === style.id ? "bg-(--meter-high)" : "bg-(--meter-off)")} />
            <span className={pm.style === style.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"}>{style.name}</span>
          </button>
        ))}
      </div>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// The editors
// ---------------------------------------------------------------------------

const EDITOR_HEIGHT = 120;

/**
 * The Rhythm Step Editor (`editor` "step") or the Rhythm Editor ("shape"): one bar of the pattern on a
 * canvas, drawn each frame something changed (or while the song plays, for the locator), edited by mouse
 * (`pointer.ts`), and its menus under it.
 */
function PatternEditor({ effectId, pm, editor }: { effectId: string; pm: PanMan; editor: "step" | "shape" }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hot, setHot] = useState<number | null>(null);
  const view = usePanView(effectId);
  const pattern = editor === "step" ? pm.stepPattern : pm.shapePattern;
  const length = patternTicks(pattern);
  const barTicks = pattern.beatsPerBar * PPQ;
  const bar = Math.min(view.bar, pattern.bars - 1);
  const grid = gridTicks(view.grid);
  const box = editorBox(width, EDITOR_HEIGHT, barTicks, bar);
  const points = editor === "step" ? editorSteps(pm) : [];
  const events = editor === "shape" ? editorEvents(pm) : [];
  const target = (): EditorTarget => ({ effectId, box, grid, length });

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Drawn once a frame when what it shows changed: the pattern (or a drag's), the view, the size, the locator.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !width) return;
    let frame = 0;
    let last = "";
    let lastShown: unknown = null;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const drag = usePanUi.getState().drag;
      const dragged = drag?.effectId === effectId && drag.editor === editor ? drag : null;
      const shown = dragged ? (dragged.editor === "step" ? dragged.points : dragged.events) : editor === "step" ? points : events;
      // The locator, in time with the song: where the pattern is (its own, or the knobs' repeated).
      const tick = pm.sync ? positionNow() : null;
      const period = pm.custom ? length : editor === "step" ? generatedStepPattern(pm).length : generatedShapePattern(pm).length;
      const locator = tick === null ? null : ((tick % period) + period) % period;
      const key = `${locator === null ? "-" : Math.round(((locator - box.barStart) / barTicks) * box.width)}|${hot}|${document.documentElement.className}`;
      if (key === last && shown === lastShown) return;
      last = key;
      lastShown = shown;
      const ctx = prepare(element, width, EDITOR_HEIGHT);
      if (!ctx) return;
      const scene = { width, height: EDITOR_HEIGHT, box, grid, length, beatsPerBar: pattern.beatsPerBar, palette: readPalette(element), colours: panColours(element), locator, hot, generated: !pm.custom };
      if (editor === "step") drawStepEditor(ctx, scene, shown as typeof points, pm.smoothing, pm.stepPattern.curve);
      else drawShapeEditor(ctx, scene, shown as typeof events, pm.direction, pm.smoothing);
    };
    draw();
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectId, editor, pm, width, view, hot]);

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const layout = (patch: { bars?: number; beatsPerBar?: number }) => (s: MusicProject) => setPatternLayout(s, effectId, editor, patch);
  return (
    <Group title={editor === "step" ? "Rhythm Step Editor" : "Rhythm Editor"}>
      <div className="flex w-full flex-col gap-1.5">
        <div
          ref={wrap}
          className="relative w-full"
          style={{ height: EDITOR_HEIGHT }}
          data-testid={`panman-${editor}-editor`}
          data-custom={pm.custom || undefined}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            const { x, y } = local(e);
            if (editor === "step") stepPointerDown(e, wrap.current!, target(), points, x, y);
            else shapePointerDown(e, wrap.current!, target(), events, x);
          }}
          onPointerMove={(e) => {
            const { x, y } = local(e);
            e.currentTarget.style.cursor = editor === "step" ? stepCursor(target(), points, x, y) : shapeCursor(target(), events, x);
            const found = editor === "step" ? hitPoint(points, box, x, y) : (hitEvent(events, box, x)?.index ?? -1);
            if ((found < 0 ? null : found) !== hot) setHot(found < 0 ? null : found);
          }}
          onPointerLeave={() => setHot(null)}
        >
          <canvas ref={canvas} className="absolute inset-0 size-full" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Labelled label="Num bars">
            <SongLcd label="Num bars" value={pattern.bars} min={1} max={MAX_PAN_BARS} className="w-9 justify-center" edit={(s, bars) => layout({ bars })(s)} />
          </Labelled>
          <Labelled label="Beats/bar">
            <SongLcd label="Beats per bar" value={pattern.beatsPerBar} min={1} max={MAX_PAN_BEATS_PER_BAR} className="w-9 justify-center" edit={(s, beatsPerBar) => layout({ beatsPerBar })(s)} />
          </Labelled>
          <Labelled label="Bar">
            <Lcd label="Bar shown" value={bar + 1} min={1} max={pattern.bars} className="w-9 justify-center font-mono text-[11px]" onBegin={() => {}} onChange={(v) => usePanUi.getState().setView(effectId, { bar: v - 1 })} onEnd={() => {}} onCancel={() => {}} />
          </Labelled>
          <Labelled label="Grid">
            <Lcd
              label="Grid"
              value={Math.max(0, PAN_GRIDS.findIndex((g) => g.id === view.grid))}
              min={0}
              max={PAN_GRIDS.length - 1}
              text={(PAN_GRIDS.find((g) => g.id === view.grid) ?? PAN_GRIDS[1]).name}
              className="w-20 justify-center font-mono text-[11px]"
              onBegin={() => {}}
              onChange={(v) => usePanUi.getState().setView(effectId, { grid: PAN_GRIDS[v].id })}
              onEnd={() => {}}
              onCancel={() => {}}
            />
          </Labelled>
          {editor === "step" && (
            <Labelled label="Smoothing mode">
              <SongLcd
                label="Smoothing mode"
                value={Math.max(0, PAN_CURVES.findIndex((c) => c.id === pm.stepPattern.curve))}
                min={0}
                max={PAN_CURVES.length - 1}
                text={PAN_CURVES.find((c) => c.id === pm.stepPattern.curve)?.name}
                className="w-16 justify-center"
                edit={(s, v) => updatePanMan(s, effectId, { stepPattern: { curve: PAN_CURVES[v].id } })}
              />
            </Labelled>
          )}
          <div className="flex-1" />
          <Labelled label="Shape preset">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex h-6 w-28 items-center justify-between gap-1 rounded-sm px-2 font-mono text-[11px] sunken" aria-label="Shape preset">
                  <span className="truncate">{pm.custom ? "Custom" : panRhythm(pm.rhythm).name}</span>
                  <PiCaretDown className="size-3 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">The knobs' pattern, at</DropdownMenuLabel>
                {PAN_RHYTHMS.map((r) => (
                  <DropdownMenuItem key={r.id} onSelect={() => set(effectId, { rhythm: r.id, custom: false })}>
                    {r.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!pm.custom}
                  onSelect={() => set(effectId, editor === "step" ? { custom: true, stepPattern: { points: [] } } : { custom: true, shapePattern: { events: [] } })}
                >
                  Clear the pattern
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Labelled>
        </div>
      </div>
    </Group>
  );
}

