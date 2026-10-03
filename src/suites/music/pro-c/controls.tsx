/**
 * Pro-C's main controls (`docs/fabfilter/pro-c.md` 2.2–2.5, 4.1), floating over its display's lower part
 * as FabFilter's do: Threshold (its ring the key's level, Audition Triggering, AUTO), Ratio (its dots),
 * Style and Character, Attack, Release (AUTO), Wet (AUTO GAIN, its pan ring mid / side) over Dry; under
 * them the arcs: Knee, Range, Lookahead, Hold. A style changes the face: Vocal greys Ratio and Knee, Vox
 * is one Compression knob with a Gate and a Ceiling, and a Vintage style shows its unit's own knobs
 * (Input or Peak Reduction, the ratio buttons, the time dials) and switches.
 */
import type { ReactNode } from "react";
import { PiHeadphones } from "react-icons/pi";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { formatTime, setProCControl, updateProC } from "@shared/music/pro-c";
import {
  DIODE_ATTACKS,
  DIODE_RECOVERIES,
  PRO_C_CEILING_RANGE,
  PRO_C_GATE_RANGE,
  PRO_C_LIMITER_RANGE,
  PRO_C_THRESHOLD_RANGE,
  VINTAGE_RATIOS,
  VINTAGE_TIMES,
  type VintageDial,
  isVintage,
  ratioOf,
  slopeOf,
} from "@shared/music/pro-c-presets";
import { PRO_C_AUDIO_MODES, PRO_C_DETECTORS, PRO_C_TIME_MODES, type MusicProject, type ProC, type ProCAudioMode, type ProCDetector, type ProCOptions, type ProCRecovery, type ProCTimeMode } from "@shared/music/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { audition, setProC } from "./actions";
import { RATIO_DOT_FRACTIONS, dialFraction, dialText, inputOfThreshold, peakReductionOf, ringHot, secondsAtDial, thresholdOfInput, thresholdOfPeakReduction, VINTAGE_INPUT_MAX } from "./geometry";
import { AutoToggle, Caption, SongArcSlider, SongCompKnob, useSongPan } from "./knob";
import { controlProps, linkedEdit } from "./specs";
import { CharacterButton, StyleButton } from "./style-menu";
import { useCompUi } from "./store";

/** The big knobs' size, and the small ones' (Wet, Dry). */
const BIG = 60;
const SMALL = 34;
/** The controls' columns (px): Threshold, Ratio, Style, Attack, Release, Wet / Dry. */
const COLUMNS = "104px 104px 132px 104px 104px 78px";
const db = (v: number) => `${v > 0.05 ? "+" : v < -0.05 ? "−" : ""}${Math.abs(v).toFixed(1)} dB`;
const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);
const setOptions = (effectId: string, options: Partial<ProCOptions>) => setProC(effectId, { options });

export function MainControls({ effectId, proC }: { effectId: string; proC: ProC }) {
  const vintage = isVintage(proC.style);
  const vox = proC.style === "vox";
  return (
    <div className="grid items-start gap-x-1.5" style={{ gridTemplateColumns: COLUMNS }} data-testid="pro-c-controls" data-style={proC.style}>
      {/* The big knobs. */}
      <Cell>{vox ? <CompressionKnob effectId={effectId} proC={proC} /> : vintage ? <InputKnob effectId={effectId} proC={proC} /> : <ThresholdKnob effectId={effectId} proC={proC} />}</Cell>
      <Cell>{vox ? <GateKnob effectId={effectId} proC={proC} /> : <RatioSlot effectId={effectId} proC={proC} />}</Cell>
      <div className="flex flex-col items-center gap-1 pt-[22px]">
        <StyleButton effectId={effectId} proC={proC} />
        <CharacterButton effectId={effectId} proC={proC} />
      </div>
      <Cell>{vox ? <CeilingKnob effectId={effectId} proC={proC} /> : <AttackSlot effectId={effectId} proC={proC} />}</Cell>
      <Cell>{vox ? <AutomaticTimes /> : <ReleaseSlot effectId={effectId} proC={proC} />}</Cell>
      <Cell className="pt-0">
        <WetKnob effectId={effectId} proC={proC} />
      </Cell>

      {/* The arcs, the unit's switches and Dry. */}
      <div className="col-span-2 grid grid-cols-2 items-start justify-items-center pt-2.5">
        {vox ? <span /> : <SongArcSlider {...controlProps(effectId, proC, "knee")} testId="pro-c-knob-knee" disabled={vintage || proC.style === "vocal"} />}
        <SongArcSlider {...controlProps(effectId, proC, "range")} testId="pro-c-knob-range" />
      </div>
      <div className="flex justify-center pt-1">{vintage && <VintageSwitches effectId={effectId} proC={proC} />}</div>
      <div className="col-span-2 grid grid-cols-2 items-start justify-items-center pt-2.5">
        <LookaheadSlider effectId={effectId} proC={proC} />
        <SongArcSlider {...controlProps(effectId, proC, "hold")} testId="pro-c-knob-hold" />
      </div>
      <Cell className="pt-1">
        <DryKnob effectId={effectId} proC={proC} />
      </Cell>
    </div>
  );
}

function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative flex justify-center", className)}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Threshold, and what it becomes
// ---------------------------------------------------------------------------

/** The key's level round the Threshold (live: only while it plays), on the threshold's scale. */
function useKeyRing(effectId: string, threshold: number) {
  const key = useTransport((s) => {
    const live = s.playing ? s.proCs[effectId] : undefined;
    return live ? Math.round(live.key * 2) / 2 : null;
  });
  const at = useTransport((s) => (s.playing ? (s.proCs[effectId]?.threshold ?? null) : null));
  const [lo, hi] = PRO_C_THRESHOLD_RANGE;
  return { fraction: key === null ? null : clamp((key - lo) / (hi - lo), 0, 1), hot: key !== null && ringHot(key, at ?? threshold) };
}

/** Audition Triggering (the headphones at the Threshold's top left): hear what the compression takes away. */
function TriggeringButton({ effectId }: { effectId: string }) {
  const on = useCompUi((s) => s.audition?.effectId === effectId && s.audition.mode === "triggering");
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label="Audition triggering"
      title="Audition triggering: hear what the compression takes away (click again to stop)"
      className={cn("absolute top-0.5 left-1 z-10 grid size-[22px] place-items-center rounded-full border outline-none", on ? "border-[var(--comp-arc)] bg-[var(--comp-arc)]/20 text-[var(--comp-arc)]" : "border-[var(--comp-knob-edge)] bg-black/40 text-[var(--comp-label)] hover:text-[var(--comp-text)]")}
      onClick={() => audition(effectId, on ? null : "triggering")}
    >
      <PiHeadphones className="size-3" />
    </button>
  );
}

function ThresholdKnob({ effectId, proC }: { effectId: string; proC: ProC }) {
  const ring = useKeyRing(effectId, proC.threshold);
  return (
    <>
      <TriggeringButton effectId={effectId} />
      <SongCompKnob
        {...controlProps(effectId, proC, "threshold")}
        size={BIG}
        ring={ring}
        testId="pro-c-knob-threshold"
        linked={linkedEdit(effectId, "threshold")}
        caption={
          <Caption>
            <AutoToggle on={proC.autoThreshold} label="Auto threshold" testId="pro-c-auto-threshold" onToggle={() => setProC(effectId, { autoThreshold: !proC.autoThreshold })} />
            Threshold
          </Caption>
        }
      />
    </>
  );
}

/** Vox's one fader (RVox's): the threshold as Compression, the ratio and make-up following it. */
function CompressionKnob({ effectId, proC }: { effectId: string; proC: ProC }) {
  const ring = useKeyRing(effectId, proC.threshold);
  const props = controlProps(effectId, proC, "threshold");
  return (
    <>
      <TriggeringButton effectId={effectId} />
      <SongCompKnob {...props} label="Compression" size={BIG} ring={ring} testId="pro-c-knob-threshold" caption={<Caption>Compression</Caption>} />
    </>
  );
}

/**
 * A Vintage style's Input (0..48 dB of drive into its fixed threshold), or Opto 2A's Peak Reduction
 * (0..100): the threshold, shown the unit's way.
 */
function InputKnob({ effectId, proC }: { effectId: string; proC: ProC }) {
  const props = controlProps(effectId, proC, "threshold");
  const opto2a = proC.style === "opto2a";
  const toFraction = opto2a ? (threshold: number) => peakReductionOf(threshold) / 100 : (threshold: number) => inputOfThreshold(threshold) / VINTAGE_INPUT_MAX;
  const toThreshold = opto2a ? (f: number) => thresholdOfPeakReduction(f * 100) : (f: number) => thresholdOfInput(f * VINTAGE_INPUT_MAX);
  const label = opto2a ? "Peak Reduction" : "Input";
  return (
    <SongCompKnob
      label={label}
      value={toFraction(proC.threshold)}
      defaultValue={toFraction(-18)}
      format={(f) => (opto2a ? `${Math.round(f * 100)}` : `${(f * VINTAGE_INPUT_MAX).toFixed(1)} dB`)}
      typed={(f) => (opto2a ? String(Math.round(f * 100)) : (f * VINTAGE_INPUT_MAX).toFixed(1))}
      parse={(t) => {
        const n = Number.parseFloat(t);
        return Number.isFinite(n) ? (opto2a ? n / 100 : n / VINTAGE_INPUT_MAX) : null;
      }}
      size={BIG}
      testId="pro-c-knob-threshold"
      target={props.target}
      automation={{ own: proC.threshold, toFraction }}
      edit={(s, f) => setProCControl(s, effectId, "threshold", Math.round(toThreshold(f) * 10) / 10)}
      caption={<Caption>{label}</Caption>}
    />
  );
}

/** Vox's gate: off at the bottom, then its threshold. */
function GateKnob({ effectId, proC }: { effectId: string; proC: ProC }) {
  const [lo, hi] = PRO_C_GATE_RANGE;
  const toFraction = (gate: number | null) => (gate === null ? 0 : clamp((gate - lo) / (hi - lo), 0.01, 1));
  const ofFraction = (f: number) => (f <= 0.005 ? null : Math.round((lo + f * (hi - lo)) * 10) / 10);
  return (
    <LooseSongKnob
      label="Gate"
      value={toFraction(proC.options.gate)}
      defaultValue={0}
      format={(f) => (ofFraction(f) === null ? "Off" : db(ofFraction(f)!))}
      edit={(s, f) => updateProC(s, effectId, { options: { gate: ofFraction(f) } })}
      testId="pro-c-knob-gate"
    />
  );
}

/** Vox's ceiling: what comes out never goes over it. */
function CeilingKnob({ effectId, proC }: { effectId: string; proC: ProC }) {
  const [lo, hi] = PRO_C_CEILING_RANGE;
  return (
    <LooseSongKnob
      label="Ceiling"
      value={(proC.options.ceiling - lo) / (hi - lo)}
      defaultValue={1}
      format={(f) => db(lo + f * (hi - lo))}
      edit={(s, f) => updateProC(s, effectId, { options: { ceiling: Math.round((lo + f * (hi - lo)) * 10) / 10 } })}
      testId="pro-c-knob-ceiling"
    />
  );
}

/** Vox works out its own times: what's in Release's place says so. */
function AutomaticTimes() {
  return (
    <div className="mt-4 flex w-[100px] flex-col items-center justify-center gap-1 rounded-md border border-[var(--comp-panel-edge)] bg-[var(--comp-knee-bg)]/90 px-1.5 py-2 text-center">
      <span className="rounded-sm border border-[var(--comp-knob-edge)] px-1.5 py-0.5 text-[9.5px] font-semibold tracking-[0.12em] text-[var(--comp-arc)]">AUTO</span>
      <span className="text-[10px] leading-tight text-[var(--comp-label)]">Ratio, knee and times follow Compression</span>
    </div>
  );
}

/** A knob on the song that isn't automatable (a style's own setting: Vox's gate and ceiling). */
function LooseSongKnob({ label, value, defaultValue, format, edit, testId, size = BIG }: { label: string; value: number; defaultValue: number; format: (f: number) => string; edit: (s: MusicProject, f: number) => MusicProject; testId: string; size?: number }) {
  return (
    <SongCompKnob
      label={label}
      value={value}
      defaultValue={defaultValue}
      format={format}
      size={size}
      testId={testId}
      edit={edit}
      caption={<Caption>{label}</Caption>}
    />
  );
}

// ---------------------------------------------------------------------------
// Ratio, and the units' buttons
// ---------------------------------------------------------------------------

function RatioSlot({ effectId, proC }: { effectId: string; proC: ProC }) {
  const ratios = VINTAGE_RATIOS[proC.style];
  if (proC.style === "opto2a") return <SongCompKnob {...controlProps(effectId, proC, "emphasis")} size={BIG} testId="pro-c-knob-emphasis" caption={<Caption>Emphasis</Caption>} />;
  if (ratios) {
    const now = ratioOf(proC.slope);
    const columns = ratios.length > 5 ? 4 : ratios.length === 5 ? 3 : 2;
    return (
      <div className="flex h-[96px] flex-col items-center justify-center gap-1.5" role="radiogroup" aria-label="Ratio" data-testid="pro-c-ratio-buttons">
        <div className={cn("grid", columns === 4 ? "gap-0.5" : "gap-1")} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {ratios.map((r) => {
            const on = (Number.isFinite(r.ratio) ? Math.abs(Math.log(Math.min(now, 1e4) / r.ratio)) < 0.02 : !Number.isFinite(now)) && !(proC.style === "fet" && proC.options.allButtons);
            return (
              <UnitButton key={r.label} on={on} role="radio" className={columns === 4 ? "min-w-[24px] px-0.5 text-[9.5px]" : undefined} title={Number.isFinite(r.ratio) ? `${r.ratio}:1` : "Nuke: ∞:1"} onClick={() => commit((s) => updateProC(s, effectId, { slope: slopeOf(r.ratio), ...(proC.style === "fet" && { options: { allButtons: false } }) }))}>
                {columns === 4 ? r.label.replace(/:1$/, "") : r.label}
              </UnitButton>
            );
          })}
          {proC.style === "fet" && (
            <UnitButton on={proC.options.allButtons} className="col-span-2" title="All buttons in: the 1176's crush" onClick={() => setOptions(effectId, { allButtons: !proC.options.allButtons })}>
              ALL
            </UnitButton>
          )}
        </div>
        <Caption className="mt-0.5">Ratio</Caption>
      </div>
    );
  }
  return (
    <SongCompKnob
      {...controlProps(effectId, proC, "ratio")}
      size={BIG}
      testId="pro-c-knob-ratio"
      disabled={proC.style === "vocal"}
      dots={proC.style === "optoTube" ? undefined : RATIO_DOT_FRACTIONS.map((d) => ({ fraction: d.fraction, label: Number.isFinite(d.ratio) ? `${d.ratio}:1` : "∞:1" }))}
    />
  );
}

/** One of a unit's push buttons (a ratio, a recovery, FAST / SLOW): lit while it's in. */
function UnitButton({ on, children, onClick, className, title, role }: { on: boolean; children: ReactNode; onClick: () => void; className?: string; title?: string; role?: "radio" }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role ? on : undefined}
      aria-pressed={role ? undefined : on}
      title={title}
      className={cn(
        "h-[19px] min-w-[30px] rounded-[4px] border px-1 text-[10px] font-semibold tabular-nums transition-colors outline-none",
        on ? "border-[var(--comp-arc)]/70 bg-[var(--comp-arc)]/15 text-[var(--comp-arc)] shadow-[0_0_6px_var(--comp-arc)]/20" : "border-[var(--comp-knob-edge)] bg-gradient-to-b from-[var(--comp-button-top)] to-[var(--comp-button-bottom)] text-[var(--comp-text)] hover:from-[var(--comp-button-hover)]",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Attack and Release, and the units' dials
// ---------------------------------------------------------------------------

/** A Vintage unit's time dial (the 1176's 1–7, fastest at 7; the Distressor's 0–10): the dial's number, the time on hover. */
function DialKnob({ effectId, proC, control, dial, disabled }: { effectId: string; proC: ProC; control: "attack" | "release"; dial: VintageDial; disabled?: boolean }) {
  const props = controlProps(effectId, proC, control);
  const name = control === "attack" ? "Attack" : "Release";
  return (
    <SongCompKnob
      label={name}
      value={dialFraction(dial, proC[control])}
      defaultValue={dialFraction(dial, Math.sqrt(dial.min * dial.max))}
      format={(f) => `${dialText(dial, f)} (${formatTime(secondsAtDial(dial, f))})`}
      typed={(f) => dialText(dial, f)}
      parse={(t) => {
        const n = Number.parseFloat(t);
        if (!Number.isFinite(n)) return null;
        const lo = Math.min(dial.from, dial.to);
        const hi = Math.max(dial.from, dial.to);
        return (n - lo) / (hi - lo);
      }}
      size={BIG}
      disabled={disabled}
      testId={`pro-c-knob-${control}`}
      target={props.target}
      automation={{ own: proC[control], toFraction: (seconds) => dialFraction(dial, seconds) }}
      edit={(s, f) => setProCControl(s, effectId, control, Number(secondsAtDial(dial, f).toPrecision(3)))}
      caption={<Caption disabled={disabled}>{name}</Caption>}
    />
  );
}

function AttackSlot({ effectId, proC }: { effectId: string; proC: ProC }) {
  const dial = VINTAGE_TIMES[proC.style]?.attack;
  if (dial) return <DialKnob effectId={effectId} proC={proC} control="attack" dial={dial} disabled={proC.style === "optoTube" && proC.options.timeMode === "fixed"} />;
  if (proC.style === "diode609")
    return (
      <div className="flex h-[96px] flex-col items-center justify-center gap-1" role="radiogroup" aria-label="Attack">
        {DIODE_ATTACKS.map((a, i) => (
          <UnitButton key={a} role="radio" on={Math.abs(proC.attack - a) < 1e-6} className="w-[64px]" title={`${a * 1000} ms${i ? ", with the side chain's 100 Hz high-pass" : ""}`} onClick={() => setProC(effectId, { attack: a })}>
            {i ? "SLOW" : "FAST"}
          </UnitButton>
        ))}
        <Caption className="mt-1">Attack</Caption>
      </div>
    );
  const cell = proC.style === "opto2a";
  const auto = proC.style === "vca160" && proC.options.auto;
  return <SongCompKnob {...controlProps(effectId, proC, "attack")} size={BIG} testId="pro-c-knob-attack" disabled={cell || auto} />;
}

const RECOVERY_NAMES = ["100", "400", "800", "1.5s"];

function ReleaseSlot({ effectId, proC }: { effectId: string; proC: ProC }) {
  const dial = VINTAGE_TIMES[proC.style]?.release;
  if (dial) return <DialKnob effectId={effectId} proC={proC} control="release" dial={dial} disabled={proC.style === "optoTube" && proC.options.timeMode === "fixed"} />;
  if (proC.style === "diode609") {
    const pick = (recovery: ProCRecovery, release?: number) => setProC(effectId, { options: { recovery }, ...(release !== undefined && { release }) });
    return (
      <div className="flex h-[96px] flex-col items-center justify-center gap-1" role="radiogroup" aria-label="Recovery">
        <div className="grid grid-cols-3 gap-1">
          {DIODE_RECOVERIES.map((r, i) => (
            <UnitButton key={r} role="radio" on={proC.options.recovery === "manual" && Math.abs(proC.release - r) < 1e-6} title={`${r * 1000} ms`} onClick={() => pick("manual", r)}>
              {RECOVERY_NAMES[i]}
            </UnitButton>
          ))}
          <UnitButton role="radio" on={proC.options.recovery === "a1"} title="a1: 100 ms after peaks, 2 s after long passages" onClick={() => pick("a1")}>
            A1
          </UnitButton>
          <UnitButton role="radio" on={proC.options.recovery === "a2"} title="a2: 50 ms after peaks, 5 s after long passages" onClick={() => pick("a2")}>
            A2
          </UnitButton>
        </div>
        <Caption className="mt-1">Recovery</Caption>
      </div>
    );
  }
  const auto = proC.style === "vca160" && proC.options.auto;
  const greyed = proC.style === "opto2a" || auto;
  return (
    <SongCompKnob
      {...controlProps(effectId, proC, "release")}
      size={BIG}
      testId="pro-c-knob-release"
      disabled={greyed}
      caption={
        <Caption disabled={greyed}>
          {!isVintage(proC.style) && <AutoToggle on={proC.autoRelease} label="Auto release" testId="pro-c-auto-release" onToggle={() => setProC(effectId, { autoRelease: !proC.autoRelease })} />}
          Release
        </Caption>
      }
    />
  );
}

/** Lookahead: up to the bottom bar's Maximum Lookahead (dimmed while that's Off). Not automatable: moving it moves where the gain lands. */
function LookaheadSlider({ effectId, proC }: { effectId: string; proC: ProC }) {
  const max = proC.maxLookahead;
  return (
    <SongArcSlider
      label="Lookahead"
      value={max > 0 ? proC.lookahead / max : 0}
      defaultValue={0}
      format={(f) => (max > 0 ? formatTime(f * max) : "Off (Maximum Lookahead is Off)")}
      typed={(f) => String(Number((f * max * 1000).toPrecision(3)))}
      parse={(t) => {
        const n = Number.parseFloat(t);
        return Number.isFinite(n) && max > 0 ? n / 1000 / max : null;
      }}
      disabled={max <= 0}
      testId="pro-c-knob-lookahead"
      edit={(s, f) => updateProC(s, effectId, { lookahead: Number((f * max).toPrecision(3)) })}
    />
  );
}

// ---------------------------------------------------------------------------
// Wet and Dry
// ---------------------------------------------------------------------------

const msText = (pan: number) => (Math.abs(pan) < 0.005 ? "Centre" : `${Math.round(Math.abs(pan) * 100)}% ${pan < 0 ? "mid" : "side"}`);
const lrText = (pan: number) => (Math.abs(pan) < 0.005 ? "Centre" : `${Math.round(Math.abs(pan) * 100)}% ${pan < 0 ? "left" : "right"}`);

function WetKnob({ effectId, proC }: { effectId: string; proC: ProC }) {
  const pan = useSongPan(proC.wetPan, "Wet pan", msText, (s, wetPan) => updateProC(s, effectId, { wetPan }));
  const vintage = isVintage(proC.style);
  return (
    <SongCompKnob
      {...controlProps(effectId, proC, "wet")}
      size={SMALL}
      bipolar
      pan={pan}
      testId="pro-c-knob-wet"
      linked={linkedEdit(effectId, "wet")}
      caption={
        <Caption className="text-[9.5px]" disabled={false}>
          {vintage || proC.style === "vox" ? (
            "Wet Gain"
          ) : (
            <>
              <AutoToggle on={proC.autoGain} label="Auto gain" testId="pro-c-auto-gain" onToggle={() => setProC(effectId, { autoGain: !proC.autoGain })} />
              Gain
            </>
          )}
        </Caption>
      }
    />
  );
}

function DryKnob({ effectId, proC }: { effectId: string; proC: ProC }) {
  const pan = useSongPan(proC.dryPan, "Dry pan", lrText, (s, dryPan) => updateProC(s, effectId, { dryPan }));
  return <SongCompKnob {...controlProps(effectId, proC, "dry")} size={SMALL} pan={pan} testId="pro-c-knob-dry" linked={linkedEdit(effectId, "dry")} caption={<Caption className="text-[9.5px]">Dry</Caption>} />;
}

// ---------------------------------------------------------------------------
// A Vintage unit's own switches
// ---------------------------------------------------------------------------

function Switch({ on, children, onClick, title, testId }: { on: boolean; children: ReactNode; onClick: () => void; title: string; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      data-testid={testId}
      className={cn("flex h-[18px] items-center gap-1 rounded-[4px] border px-1.5 text-[9.5px] font-semibold tracking-wider whitespace-nowrap outline-none", on ? "border-[var(--comp-arc)]/60 text-[var(--comp-arc)]" : "border-[var(--comp-knob-edge)] text-[var(--comp-label)] hover:text-[var(--comp-text)]")}
      onClick={onClick}
    >
      <span className={cn("size-[5px] rounded-full", on ? "bg-[var(--comp-arc)] shadow-[0_0_4px_var(--comp-arc)]" : "bg-white/15")} />
      {children}
    </button>
  );
}

/** A switch with several positions (Opto Tube's time mode, Distress's Detector and Audio): its name and position, a menu. */
function Selector<T extends string>({ name, value, values, names, onChange, testId }: { name: string; value: T; values: readonly T[]; names: Record<T, string>; onChange: (v: T) => void; testId?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={name} data-testid={testId} className="flex h-[18px] items-center gap-1 rounded-[4px] border border-[var(--comp-knob-edge)] px-1.5 text-[9.5px] font-semibold tracking-wider whitespace-nowrap text-[var(--comp-label)] outline-none hover:text-[var(--comp-text)]">
          {name} <span className="text-[var(--comp-arc)]">{names[value]}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {values.map((v) => (
            <DropdownMenuRadioItem key={v} value={v}>
              {names[v]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TIME_MODE_NAMES: Record<ProCTimeMode, string> = { fixed: "Fixed", manual: "Manual", fixMan: "Fix / Man" };
const DETECTOR_NAMES: Record<ProCDetector, string> = { norm: "Norm", hp: "HP", band: "Band", hpBand: "HP + Band" };
const AUDIO_NAMES: Record<ProCAudioMode, string> = { norm: "Norm", hp: "HP", dist2: "Dist 2", dist2hp: "Dist 2 + HP", dist3: "Dist 3", dist3hp: "Dist 3 + HP" };

/** The row under the Style button in a Vintage style (`docs/fabfilter/pro-c.md` 4.1): its unit's switches, and Output Link. */
function VintageSwitches({ effectId, proC }: { effectId: string; proC: ProC }) {
  const o = proC.options;
  const set = (options: Partial<ProCOptions>) => setOptions(effectId, options);
  const items: ReactNode[] = [];
  switch (proC.style) {
    case "opto2a":
      items.push(
        <Switch key="limit" on={o.limit} title={o.limit ? "Limit: a higher ratio, a harder knee" : "Compress: the LA-2A's gentle curve"} testId="pro-c-limit" onClick={() => set({ limit: !o.limit })}>
          {o.limit ? "LIMIT" : "COMPRESS"}
        </Switch>,
      );
      break;
    case "optoTube":
      items.push(<Selector key="time" name="TIME" value={o.timeMode} values={PRO_C_TIME_MODES} names={TIME_MODE_NAMES} onChange={(timeMode) => set({ timeMode })} testId="pro-c-time-mode" />);
      break;
    case "distress":
      items.push(
        <Selector key="det" name="DET" value={o.detector} values={PRO_C_DETECTORS} names={DETECTOR_NAMES} onChange={(detector) => set({ detector })} testId="pro-c-detector" />,
        <Selector key="audio" name="AUDIO" value={o.audio} values={PRO_C_AUDIO_MODES} names={AUDIO_NAMES} onChange={(audio) => set({ audio })} testId="pro-c-audio" />,
        <Switch key="brit" on={o.british} title="British Mode: the 1176's all buttons on any ratio" onClick={() => set({ british: !o.british })}>
          BRIT
        </Switch>,
      );
      break;
    case "vca160":
      items.push(
        <Switch key="easy" on={o.overEasy} title="Over Easy: a soft knee" onClick={() => set({ overEasy: !o.overEasy })}>
          OVER EASY
        </Switch>,
        <Switch key="auto" on={o.auto} title="Auto: the RMS detector's own times (the knobs unused)" onClick={() => set({ auto: !o.auto })}>
          AUTO
        </Switch>,
      );
      break;
    case "diode609":
      items.push(<DiodeLimiter key="limiter" effectId={effectId} proC={proC} />);
      break;
  }
  items.push(
    <Switch key="link" on={o.link} title="Output Link: the output follows the Input, so driving harder compresses harder without getting louder" testId="pro-c-output-link" onClick={() => set({ link: !o.link })}>
      LINK
    </Switch>,
  );
  return (
    <div className="flex w-[128px] flex-wrap items-center justify-center gap-1 rounded-md border border-[var(--comp-panel-edge)] bg-black/25 p-1" data-testid="pro-c-vintage-switches">
      {items}
    </div>
  );
}

/** Diode 609's limiter: off, or its threshold. */
function DiodeLimiter({ effectId, proC }: { effectId: string; proC: ProC }) {
  const [lo, hi] = PRO_C_LIMITER_RANGE;
  const on = proC.options.limiter !== null;
  return (
    <div className="flex items-center gap-1">
      <Switch on={on} title="The 33609's limiter, after the compressor" onClick={() => setOptions(effectId, { limiter: on ? null : -6 })}>
        LIMIT
      </Switch>
      {on && (
        <SongCompKnob
          label="Limiter threshold"
          size={20}
          value={(proC.options.limiter! - lo) / (hi - lo)}
          defaultValue={(-6 - lo) / (hi - lo)}
          format={(f) => db(lo + f * (hi - lo))}
          edit={(s, f) => updateProC(s, effectId, { options: { limiter: Math.round((lo + f * (hi - lo)) * 10) / 10 } })}
          caption={null}
        />
      )}
    </div>
  );
}
