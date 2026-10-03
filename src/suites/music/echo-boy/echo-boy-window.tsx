import { useEffect, useRef, useState, type ReactNode } from "react";
import { PiCaretLeft, PiCaretRight, PiDotsThreeVertical } from "react-icons/pi";
import { cn } from "cn";
import { mixerTrackName } from "@shared/music/automation";
import { ECHO_CONTROL_SPECS, NOTE_STEPS, RHYTHM_PATTERNS, echoTempo, knobToMs, layOutRhythm, msToKnob, rhythmStep, styleLabel, timeText, updateEchoBoy, updateRhythm, usePattern } from "@shared/music/echo-boy";
import { ECHO_PRESETS, PRESET_FOLDERS } from "@shared/music/echo-boy-library";
import { MAX_ECHO_BPM, MAX_ECHO_GAIN, MAX_TAPS, MIN_ECHO_BPM } from "@shared/music/echo-boy-presets";
import { ECHO_STYLES } from "@shared/music/echo-boy-styles";
import { type EchoBoy, type EchoSync, type MixerEffect, type MusicProject, RHYTHM_SHAPES, type RhythmShape } from "@shared/music/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PERCENT, percent } from "../knob";
import { Lcd } from "../lcd";
import { songGesture, useMusic, useSong } from "../store";
import { echoBoyWindow } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { choosePreset, closeEchoBoy, copyState, pasteState, stepPreset, tapTempo, toggleDrawer } from "./actions";
import { Caption, EchoKnob, EchoTimeControl, Key, LcdMenu, Leds, ModeDial, SyncKeys, Toggle } from "./controls";
import { StyleEditor, TweakPanel } from "./panels";
import { RhythmGrid } from "./rhythm-grid";
import { useEchoDrawer, useEchoUi } from "./store";
import { AutomateTouched } from "../automation/touched";

/** The window's width (Gross Beat's): the three sections side by side, the drawer under them. */
const WIDTH = 840;
const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);
const DB = { scale: 1, unit: "dB", digits: 1 };
const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const sided = (left: string, right: string) => (v: number) => (Math.abs(v) < 0.005 ? "Centre" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? left : right}`);

/** The effect in the song, by id (the object itself, so a selector of it is stable). */
function effectOf(song: MusicProject, effectId: string): MixerEffect | null {
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect;
  return null;
}
const trackOf = (song: MusicProject, effectId: string) => song.mixer.tracks.find((t) => t.effects.some((e) => e?.id === effectId))?.id ?? "";

/**
 * An EchoBoy's window (`docs/soundtoys/echoboy-manual.md`), Soundtoys' layout in our look: the preset bar; the
 * echo section (it changes with the mode), the centre (tempo, Groove, Feel, Mode) and the right (Saturation,
 * Input, Output, the Style); and under them the drawer Tweak and Style Edit open.
 */
export function EchoBoyWindow({ effectId, index }: { effectId: string; index: number }) {
  const effect = useSong((s) => effectOf(s, effectId));
  const owner = useSong((s) => mixerTrackName(s, trackOf(s, effectId)));
  const drawer = useEchoDrawer(effectId);
  const [initial] = useState(() => {
    const place = centredOnDesktop(WIDTH, 420);
    return { ...place, x: place.x + index * 28, y: Math.min(place.y, 40) + index * 28 };
  });
  const eb = effect?.echoBoy;
  // Its effect deleted (or replaced): its window goes, as a plugin's does.
  const gone = !eb;
  useEffect(() => {
    if (gone) closeEchoBoy(effectId);
  }, [gone, effectId]);
  if (!effect || !eb) return null;
  return (
    <MusicWindow id={echoBoyWindow(effectId)} title={`${effect.plugin.name} (${owner})`} initial={initial} onClose={() => closeEchoBoy(effectId)} controls={<AutomateTouched effectId={effectId} />}>
      <div className="flex flex-col bg-surface-0 text-xs select-none" style={{ width: WIDTH }} data-testid="echo-boy" data-effect={effectId} data-mode={eb.mode}>
        <PresetBar effectId={effectId} eb={eb} />
        <div className="flex items-stretch gap-2 p-2">
          <Plate className="min-w-0 flex-1">
            <EchoSection effectId={effectId} eb={eb} />
          </Plate>
          <Plate className="w-[238px] shrink-0">
            <Centre effectId={effectId} eb={eb} />
          </Plate>
          <Plate className="w-[176px] shrink-0">
            <Right effectId={effectId} eb={eb} />
          </Plate>
        </div>
        {drawer === "tweak" && <TweakPanel effectId={effectId} eb={eb} />}
        {drawer === "style" && <StyleEditor effectId={effectId} eb={eb} />}
      </div>
    </MusicWindow>
  );
}

/** One of EchoBoy's three sections. */
function Plate({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col rounded-lg border border-line bg-surface-1 p-2 shadow-[inset_0_1px_0_var(--bevel-highlight)]", className)}>{children}</div>;
}

// ---------------------------------------------------------------------------
// The preset bar
// ---------------------------------------------------------------------------

function PresetBar({ effectId, eb }: { effectId: string; eb: EchoBoy }) {
  const copied = useEchoUi((s) => s.copiedState !== null);
  const arrow = "grid h-6 w-6 place-items-center rounded-sm raised text-muted-foreground hover:raised-hover hover:text-foreground";
  return (
    <div className="flex items-center gap-1 border-b border-line bg-surface-1 px-2 py-1.5">
      <button type="button" aria-label="Previous preset" title="Previous preset" className={arrow} onClick={() => stepPreset(effectId, -1)}>
        <PiCaretLeft className="size-3" />
      </button>
      <button type="button" aria-label="Next preset" title="Next preset" className={arrow} onClick={() => stepPreset(effectId, 1)}>
        <PiCaretRight className="size-3" />
      </button>
      <LcdMenu label="Preset" text={eb.preset ?? (eb.preset === null && eb.custom ? "Custom" : "Untitled")} className="w-64 text-[12px]" testId="echo-preset">
        {PRESET_FOLDERS.map((folder) => (
          <DropdownMenuSub key={folder}>
            <DropdownMenuSubTrigger>{folder}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {ECHO_PRESETS.filter((p) => p.folder === folder).map((p) => (
                <DropdownMenuItem key={p.name} onSelect={() => choosePreset(effectId, p.name)}>
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </LcdMenu>
      <span className="ml-auto flex items-baseline gap-1.5 pr-1">
        <span className="text-[13px] font-bold tracking-tight">YT-Delay</span>
        <span className="text-[10px] text-muted-foreground">Analog Echo Processor</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="YT-Delay's options" className={arrow}>
            <PiDotsThreeVertical className="size-3.5" />
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
// The echo section
// ---------------------------------------------------------------------------

function EchoSection({ effectId, eb }: { effectId: string; eb: EchoBoy }) {
  const set = (patch: Parameters<typeof updateEchoBoy>[2]) => (s: MusicProject) => updateEchoBoy(s, effectId, patch);
  const mix = <EchoKnob label="Mix" ends={["Dry", "Wet"]} value={eb.mix} min={0} max={1} defaultValue={0.4} format={mixText} unit={PERCENT} target={{ kind: "echoBoy", effect: effectId, control: "mix" }} edit={(s, mix) => set({ mix })(s)} />;
  const feedback = <EchoKnob label="Feedback" ends={["Min", "Max"]} value={eb.feedback} min={0} max={1} defaultValue={0.35} format={feedbackText} unit={PERCENT} target={{ kind: "echoBoy", effect: effectId, control: "feedback" }} edit={(s, feedback) => set({ feedback })(s)} />;
  const cut = (which: "lowCut" | "highCut") => {
    const spec = ECHO_CONTROL_SPECS[which];
    return (
      <EchoKnob
        label={which === "lowCut" ? "Low Cut" : "High Cut"}
        ends={["Min", "Max"]}
        size={36}
        value={spec.fromControl(eb[which])}
        min={0}
        max={1}
        defaultValue={which === "lowCut" ? 0 : 1}
        format={(f) => spec.format(spec.toControl(f), eb)}
        unit={{ scale: 1, unit: "" }}
        target={{ kind: "echoBoy", effect: effectId, control: which }}
        fraction
        edit={(s, f) => set({ [which]: Math.round(spec.toControl(f)) })(s)}
      />
    );
  };
  const prime = <Toggle on={eb.primeNumbers} label="Prime Numbers" title="Times nudged to prime numbers of ms: lines that never ring together" onChange={(primeNumbers) => commit(set({ primeNumbers }))} />;
  const tweak = <Key on={useEchoDrawer(effectId) === "tweak"} label="Tweak" title="The mode's finer controls" onClick={() => toggleDrawer(effectId, "tweak")} className="min-w-14" />;

  if (eb.mode === "rhythm") return <RhythmSection effectId={effectId} eb={eb} mix={mix} feedback={feedback} lowCut={cut("lowCut")} highCut={cut("highCut")} prime={prime} tweak={tweak} />;
  const single = eb.mode === "single";
  const names = eb.mode === "pingPong" ? ["Ping", "Pong"] : ["Echo 1", "Echo 2"];
  return (
    <div className="flex flex-1 flex-col justify-between gap-2" data-testid="echo-section">
      {single ? (
        <div className="grid grid-cols-3 items-start justify-items-center gap-2">
          <div className="pt-4">{mix}</div>
          <EchoTimeControl effectId={effectId} eb={eb} which="echo1" label="Echo Time" />
          <div className="pt-4">{feedback}</div>
        </div>
      ) : (
        <div className="grid grid-cols-3 items-start justify-items-center gap-2">
          <EchoTimeControl effectId={effectId} eb={eb} which="echo1" label={names[0]} />
          <div className="flex flex-col items-center gap-2">
            {mix}
            {feedback}
          </div>
          <EchoTimeControl effectId={effectId} eb={eb} which="echo2" label={names[1]} />
        </div>
      )}
      <div className="grid grid-cols-3 items-end justify-items-center gap-2">
        {cut("lowCut")}
        <div className="flex flex-col items-center gap-2 pb-1">
          {prime}
          {tweak}
        </div>
        {cut("highCut")}
      </div>
    </div>
  );
}

const mixText = (m: number) => (Math.abs(m - 0.5) < 0.005 ? "50/50" : m < 0.5 ? `Wet ${Math.round(m * 200)}%` : `Dry ${Math.round((1 - m) * 200)}%`);
const feedbackText = (f: number) => `${Math.round(f * 115)}%`;

const SHAPE_NAMES: Record<RhythmShape, string> = { decay: "Decay", reverse: "Reverse", swell: "Swell", fade: "Fade", nonLin: "NonLin" };
const GROUP_NAMES = { bars: "Bars", notes: "Notes", dotted: "Dotted", triplet: "Triplet", presets: "Presets" } as const;

/** Rhythm Echo's section: Mix, Rhythm (and its pattern), Feedback; the cuts around the editor; Shape, Repeats. */
function RhythmSection({ effectId, eb, mix, feedback, lowCut, highCut, prime, tweak }: { effectId: string; eb: EchoBoy; mix: ReactNode; feedback: ReactNode; lowCut: ReactNode; highCut: ReactNode; prime: ReactNode; tweak: ReactNode }) {
  const r = eb.rhythm;
  const tempo = useSong((s) => s.settings.tempo);
  const bpm = echoTempo(eb, tempo);
  const repeatsGesture = useRef(songGesture()).current;
  const time = r.time;
  const knob = time.sync === "time" ? msToKnob(time.ms) : NOTE_STEPS.indexOf(time.note) / (NOTE_STEPS.length - 1);
  const layOut = (patch: Parameters<typeof layOutRhythm>[2]) => (s: MusicProject) => updateRhythm(s, effectId, (rr, b) => layOutRhythm(rr, b, patch));
  const knobTime = (f: number) => (time.sync === "time" ? { ...time, ms: knobToMs(f) } : { ...time, note: NOTE_STEPS[Math.round(f * (NOTE_STEPS.length - 1))] });
  return (
    <div className="flex flex-1 flex-col gap-1.5" data-testid="echo-section">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start justify-items-center gap-2">
        <div className="pt-4">{mix}</div>
        <div className="flex flex-col items-center gap-1">
          <EchoKnob label="Rhythm" size={42} value={knob} min={0} max={1} defaultValue={2 / 5} format={(f) => `${timeText(knobTime(f))} (${rhythmStep({ ...r, time: knobTime(f) }, bpm).toFixed(3)} beats)`} unit={PERCENT} target={{ kind: "echoBoy", effect: effectId, control: "rhythmTime" }} edit={(s, f) => layOut({ time: knobTime(f) })(s)} />
          <SyncKeys
            value={time.sync}
            onChange={(sync: EchoSync) => commit(layOut({ time: { ...time, sync } }))}
            extra={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" title="Patterns" className="h-[18px] min-w-[30px] rounded-sm px-0.5 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase raised hover:raised-hover hover:text-foreground" data-testid="echo-patt">
                    Patt
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {(Object.keys(GROUP_NAMES) as (keyof typeof GROUP_NAMES)[]).map((group) => (
                    <DropdownMenuSub key={group}>
                      <DropdownMenuSubTrigger>{GROUP_NAMES[group]}</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {RHYTHM_PATTERNS.filter((p) => p.group === group).map((p) => (
                          <DropdownMenuItem key={p.name} onSelect={() => commit((s) => updateRhythm(s, effectId, (rr) => usePattern(rr, p)))}>
                            {p.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          <div className="lcd flex h-6 w-[150px] items-center rounded px-1.5 font-mono text-[11px]" data-testid="echo-pattern-name">
            <span className="truncate">{r.pattern}</span>
          </div>
        </div>
        <div className="pt-4">{feedback}</div>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center justify-items-center gap-2">
        {lowCut}
        <RhythmGrid effectId={effectId} eb={eb} />
        {highCut}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end justify-items-center gap-2">
        <div className="flex flex-col items-center gap-1">
          <EchoKnob label="Shape" size={30} value={r.shapeAmount} min={0} max={1} defaultValue={0.5} format={percent} unit={PERCENT} target={{ kind: "echoBoy", effect: effectId, control: "rhythmShape" }} edit={(s, shapeAmount) => updateRhythm(s, effectId, (rr) => ({ ...rr, shapeAmount }))} />
          <LcdMenu label="Shape" text={SHAPE_NAMES[r.shape]} className="w-20" testId="echo-shape">
            <DropdownMenuRadioGroup value={r.shape} onValueChange={(v) => commit((s) => updateRhythm(s, effectId, (rr) => ({ ...rr, shape: v as RhythmShape })))}>
              {RHYTHM_SHAPES.map((shape) => (
                <DropdownMenuRadioItem key={shape} value={shape}>
                  {SHAPE_NAMES[shape]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </LcdMenu>
        </div>
        <div className="flex flex-col items-center gap-2 pb-1">
          {prime}
          {tweak}
        </div>
        <div className="flex flex-col items-center gap-1">
          <Caption className="text-foreground/80">Repeats</Caption>
          <Lcd
            value={r.repeats}
            min={1}
            max={MAX_TAPS}
            label="Repeats"
            className="lcd h-6 w-14 rounded border-0 text-[11px]"
            onBegin={() => repeatsGesture.begin()}
            onChange={(repeats) => repeatsGesture.apply(layOut({ repeats }))}
            onEnd={() => repeatsGesture.end()}
            onCancel={() => repeatsGesture.cancel()}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The centre: tempo, Groove, Feel, Mode
// ---------------------------------------------------------------------------

function Centre({ effectId, eb }: { effectId: string; eb: EchoBoy }) {
  const tempo = useSong((s) => s.settings.tempo);
  const gesture = useRef(songGesture()).current;
  const bpm = echoTempo(eb, tempo);
  const set = (patch: Parameters<typeof updateEchoBoy>[2]) => (s: MusicProject) => updateEchoBoy(s, effectId, patch);
  return (
    <div className="flex flex-1 flex-col items-center justify-between gap-2">
      <div className="flex w-full flex-col items-center gap-1 rounded-md border border-line px-2 pt-1 pb-1.5">
        <Caption className="text-foreground/80">Tap Tempo</Caption>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Tap Tempo"
            title={eb.followTempo ? "Tap to keep YT-Delay to a tempo of its own (MIDI goes off)" : "Tap in time"}
            className="size-7 rounded-md raised hover:raised-hover active:pressed"
            data-testid="echo-tap"
            onPointerDown={(e) => e.button === 0 && tapTempo(effectId)}
          />
          <Lcd
            value={Math.round(bpm)}
            min={MIN_ECHO_BPM}
            max={MAX_ECHO_BPM}
            label="YT-Delay's tempo"
            text={`${bpm.toFixed(1)} bpm`}
            derived={eb.followTempo}
            className="lcd h-6 w-[88px] rounded border-0 text-[11px]"
            typeIn={{
              initial: bpm.toFixed(1),
              onType: (text) => {
                const v = Number.parseFloat(text);
                if (Number.isFinite(v)) commit(set({ bpm: v, followTempo: false }));
              },
            }}
            onBegin={() => gesture.begin()}
            onChange={(v) => gesture.apply(set({ bpm: v, followTempo: false }))}
            onEnd={() => gesture.end()}
            onCancel={() => gesture.cancel()}
          />
          <Toggle on={eb.followTempo} label="MIDI" title="Keep to the song's tempo" onChange={(followTempo) => commit(set({ followTempo }))} />
        </div>
      </div>
      <div className="flex gap-5">
        <EchoKnob label="Groove" ends={["Shuffle", "Swing"]} size={34} bipolar value={eb.groove} min={-1} max={1} defaultValue={0} format={sided("shuffle", "swing")} unit={PERCENT} target={{ kind: "echoBoy", effect: effectId, control: "groove" }} edit={(s, groove) => set({ groove })(s)} />
        <EchoKnob label="Feel" ends={["Rushin'", "Draggin'"]} size={34} bipolar value={eb.feel} min={-1} max={1} defaultValue={0} format={(v) => `${v > 0 ? "+" : ""}${(v * 30).toFixed(1)} ms`} unit={PERCENT} target={{ kind: "echoBoy", effect: effectId, control: "feel" }} edit={(s, feel) => set({ feel })(s)} />
      </div>
      <ModeDial value={eb.mode} onChange={(mode) => commit(set({ mode }))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The right: Saturation, Input, Output, Style
// ---------------------------------------------------------------------------

function Right({ effectId, eb }: { effectId: string; eb: EchoBoy }) {
  const set = (patch: Parameters<typeof updateEchoBoy>[2]) => (s: MusicProject) => updateEchoBoy(s, effectId, patch);
  const styleOpen = useEchoDrawer(effectId) === "style";
  const level = (which: "input" | "output") => (
    <div className="flex flex-col items-center gap-1">
      <EchoKnob label={which === "input" ? "Input" : "Output"} ends={["-24", "+24"]} size={32} bipolar value={eb[which]} min={-MAX_ECHO_GAIN} max={MAX_ECHO_GAIN} defaultValue={0} format={db} unit={DB} target={{ kind: "echoBoy", effect: effectId, control: which }} edit={(s, v) => set({ [which]: v })(s)} />
      <Leds effectId={effectId} which={which} />
    </div>
  );
  return (
    <div className="flex flex-1 flex-col items-center justify-between gap-2">
      <EchoKnob label="Saturation" ends={["Min", "Max"]} size={34} value={eb.saturation} min={0} max={1} defaultValue={0.5} format={(v) => `${v >= 0.5 ? "+" : ""}${((v - 0.5) * 36).toFixed(1)} dB`} unit={PERCENT} target={{ kind: "echoBoy", effect: effectId, control: "saturation" }} edit={(s, saturation) => set({ saturation })(s)} />
      <div className="flex gap-4">
        {level("input")}
        {level("output")}
      </div>
      <div className="flex w-full flex-col items-center gap-1 rounded-md border border-line px-1.5 pt-1 pb-1.5">
        <Caption className="text-foreground/80">Style</Caption>
        <LcdMenu label="Echo Style" text={styleLabel(eb)} className="w-full" testId="echo-style">
          <DropdownMenuLabel className="text-[11px] text-muted-foreground">Echo Style</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={eb.custom ? "" : eb.style} onValueChange={(style) => commit(set({ style }))}>
            {ECHO_STYLES.map((s) => (
              <DropdownMenuRadioItem key={s.name} value={s.name} title={s.about}>
                <span className="flex min-w-0 flex-col">
                  <span>{s.name}</span>
                  <span className="truncate text-[10px] text-muted-foreground">{s.about}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {eb.custom && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">Custom, from {eb.style}</DropdownMenuLabel>
            </>
          )}
        </LcdMenu>
        <Key on={styleOpen} label="Style Edit" title="The style's settings: EQ, diffusion, wobble, saturation" onClick={() => toggleDrawer(effectId, "style")} className="min-w-16" />
      </div>
    </div>
  );
}
