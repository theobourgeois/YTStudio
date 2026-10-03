/**
 * The Reverb's controls (`docs/reverb/reverb.md` 4.2, 4.3): the main row (Pre-delay with its Sync menu,
 * Decay, Size, Distance, Diffusion │ Mod Rate, Depth │ Width │ Low Cut, High Cut), the vocal row (De-ess,
 * Duck) and the advanced panel's four groups (Input, Early & late, Ducking, Output). Every knob is Pro-C's
 * control drawn in the Reverb's tokens, turns by its spec's taper, types a value in its units, and can be
 * automated (its right-click menu).
 */
import type { ReactNode } from "react";
import { PiCaretDown } from "react-icons/pi";
import { cn } from "cn";
import { REVERB_CONTROL_SPECS, formatNote, reverbKey, setReverbControl, setReverbKey } from "@shared/music/reverb";
import { REVERB_MODE_SPECS } from "@shared/music/reverb-modes";
import { VARIATION_RANGE } from "@shared/music/reverb-presets";
import { trackName } from "@shared/music/mixer";
import { type MusicProject, REVERB_NOTES, type Reverb, type ReverbControl, type ReverbNote } from "@shared/music/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AutoToggle, Caption, SongCompKnob } from "../pro-c/knob";
import { useMusic, useSong } from "../store";
import { parseControl, typedControl } from "./typing";
import { setReverb } from "./actions";

/** A knob of the Reverb's: its spec's taper, its edit, its automation, its typing. */
export function VerbKnob({ effectId, reverb, control, label, size = 46, bipolar, disabled, caption, format }: { effectId: string; reverb: Reverb; control: ReverbControl; label?: string; size?: number; bipolar?: boolean; disabled?: boolean; caption?: ReactNode; format?: (fraction: number) => string }) {
  const spec = REVERB_CONTROL_SPECS[control];
  return (
    <SongCompKnob
      value={spec.fromControl(spec.get(reverb))}
      defaultValue={spec.fromControl(spec.defaultValue)}
      label={label ?? spec.name}
      format={format ?? ((f) => spec.format(spec.toControl(f)))}
      parse={(text) => parseControl(control, text)}
      typed={(f) => typedControl(control, f)}
      size={size}
      bipolar={bipolar}
      disabled={disabled}
      caption={caption}
      testId={`reverb-knob-${control}`}
      target={{ kind: "reverb", effect: effectId, control }}
      edit={(s, f) => setReverbControl(s, effectId, control, spec.toControl(f))}
    />
  );
}

/** The note values a synced time can be, shortest first: 1/64 .. 1/2, each straight, dotted, triplet. */
const NOTE_CHOICES: ReverbNote[] = [...REVERB_NOTES].reverse().flatMap((note) => (["triplet", "straight", "dotted"] as const).map((feel) => ({ note, feel })));
const noteKey = (n: ReverbNote) => `${n.note}:${n.feel}`;

/** The Sync menu under a time (Pre-delay, the duck's Release): Time, or a note value at the song's tempo. */
function SyncMenu({ synced, note, onChoose, label, testId }: { synced: boolean; note: ReverbNote; onChoose: (note: ReverbNote | null) => void; label: string; testId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`${label} sync`} data-testid={testId} className="mt-0.5 flex items-center gap-0.5 rounded-sm px-1 text-[9.5px] font-semibold tracking-wider text-[var(--verb-label)] uppercase outline-none hover:text-[var(--verb-text)]">
          {synced ? formatNote(note) : "Time"}
          <PiCaretDown className="size-2" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={synced ? noteKey(note) : "time"} onValueChange={(v) => onChoose(v === "time" ? null : (NOTE_CHOICES.find((n) => noteKey(n) === v) ?? null))}>
          <DropdownMenuRadioItem value="time">Time (ms)</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {NOTE_CHOICES.map((n) => (
            <DropdownMenuRadioItem key={noteKey(n)} value={noteKey(n)}>
              {formatNote(n)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A group of controls, divided from the next. */
function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-start gap-3 border-r border-[var(--verb-panel-edge)] px-3 last:border-r-0", className)}>{children}</div>;
}

/** The main row and the vocal row. */
export function MainControls({ effectId, reverb }: { effectId: string; reverb: Reverb }) {
  const knob = (control: ReverbControl, extra: Partial<Parameters<typeof VerbKnob>[0]> = {}) => <VerbKnob effectId={effectId} reverb={reverb} control={control} {...extra} />;
  const bpm = useSong((s) => s.settings.tempo);
  return (
    <div className="flex flex-col gap-1.5" data-testid="reverb-controls">
      <div className="flex items-start justify-center">
        <Group>
          <div className="flex flex-col items-center">
            {knob("predelay", {
              disabled: reverb.sync,
              caption: <Caption>Pre-delay</Caption>,
              format: reverb.sync ? () => `${formatNote(reverb.predelayNote)} (${Math.round((60_000 / bpm) * (4 / reverb.predelayNote.note) * (reverb.predelayNote.feel === "dotted" ? 1.5 : reverb.predelayNote.feel === "triplet" ? 2 / 3 : 1) * reverb.predelayOffset)} ms)` : undefined,
            })}
            <SyncMenu synced={reverb.sync} note={reverb.predelayNote} label="Pre-delay" testId="reverb-predelay-sync" onChoose={(note) => setReverb(effectId, note ? { sync: true, predelayNote: note } : { sync: false })} />
          </div>
          {knob("decay", { size: 56 })}
          {knob("size")}
          {knob("distance")}
          {knob("diffusion")}
        </Group>
        <Group>
          {knob("modRate", { label: "Mod Rate" })}
          {knob("modDepth", { label: "Depth", caption: <Caption>Depth</Caption> })}
        </Group>
        <Group>{knob("width")}</Group>
        <Group>
          {knob("lowCut")}
          {knob("highCut")}
        </Group>
      </div>
    </div>
  );
}

/** A small select in the advanced panel. */
function Select<T extends string>({ label, value, options, onChange, testId }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={label} data-testid={testId} className="flex h-6 min-w-[56px] items-center justify-between gap-1 rounded-[4px] border border-[var(--verb-panel-edge)] bg-black/30 px-1.5 text-[10.5px] text-[var(--verb-text)] outline-none hover:bg-black/45">
            <span className="truncate">{options.find((o) => o.value === value)?.label ?? value}</span>
            <PiCaretDown className="size-2.5 shrink-0 text-[var(--verb-label)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
            {options.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Caption className="text-[8.5px] tracking-[0.02em]">{label}</Caption>
    </div>
  );
}

/** A switch in the advanced panel. */
function Toggle({ label, on, onToggle, testId, title }: { label: string; on: boolean; onToggle: () => void; testId?: string; title?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        aria-pressed={on}
        aria-label={label}
        title={title}
        data-testid={testId}
        className={cn("h-6 min-w-[52px] rounded-[4px] border px-2 text-[10.5px] font-semibold outline-none", on ? "border-[var(--verb-decay)] bg-[var(--verb-decay)]/15 text-[var(--verb-decay)]" : "border-[var(--verb-panel-edge)] bg-black/30 text-[var(--verb-label)] hover:text-[var(--verb-text)]")}
        onClick={onToggle}
      >
        {on ? "On" : "Off"}
      </button>
      <Caption className="text-[8.5px] tracking-[0.02em]">{label}</Caption>
    </div>
  );
}

/** A heading for one of the advanced panel's groups. */
const Heading = ({ children }: { children: ReactNode }) => <div className="mb-1 text-[9.5px] font-semibold tracking-[0.18em] text-[var(--verb-decay)] uppercase">{children}</div>;

/** The advanced panel (▸ Advanced): Input, Early & late, Ducking, Output. */
export function AdvancedPanel({ effectId, reverb }: { effectId: string; reverb: Reverb }) {
  // Smaller, their names short, so the four groups fit the window's width.
  const knob = (control: ReverbControl, extra: Partial<Parameters<typeof VerbKnob>[0]> = {}) => (
    <VerbKnob effectId={effectId} reverb={reverb} control={control} size={30} caption={extra.caption ?? <Caption className="text-[8.5px] tracking-[0.02em]">{extra.label ?? REVERB_CONTROL_SPECS[control].name}</Caption>} {...extra} />
  );
  // The tracks it can be keyed from, by value (so a drag elsewhere doesn't re-render it).
  const tracks = useSong((s) => {
    const own = s.mixer.tracks.find((t) => t.effects.some((e) => e?.id === effectId))?.id;
    return JSON.stringify(s.mixer.tracks.filter((t) => t.id !== own).map((t) => ({ value: t.id, label: trackName(s, t.id) })));
  });
  const keyOptions = [{ value: "self", label: "This track" }, ...(JSON.parse(tracks) as { value: string; label: string }[])];
  // Its slot's key (`docs/sidechain.md`), which the Mixer's Sidechain input menu sets too.
  const key = useSong((s) => reverbKey(s, effectId));
  const commit = (update: (s: MusicProject) => MusicProject) => useMusic.getState().commit(update);
  return (
    <div className="grid shrink-0 grid-cols-[auto_auto_auto_auto] justify-center gap-0 overflow-x-auto border-t border-[var(--verb-panel-edge)] bg-[var(--verb-section)] py-2" data-testid="reverb-advanced">
      <Group className="flex-col gap-1 px-1">
        <Heading>Input</Heading>
        <div className="flex items-start gap-0.5">
          <Select
            label="Input"
            testId="reverb-input-mode"
            value={reverb.input.mode}
            options={[
              { value: "auto", label: REVERB_MODE_SPECS[reverb.mode].stereo ? "Auto: st." : "Auto: mono" },
              { value: "mono", label: "Mono" },
              { value: "stereo", label: "Stereo" },
            ]}
            onChange={(mode) => setReverb(effectId, { input: { mode } })}
          />
          {knob("inputCross", { label: "Cross" })}
          {knob("inputLowCut", { label: "Low Cut" })}
          {knob("inputHighCut", { label: "High Cut" })}
        </div>
        <div className="flex items-start gap-0.5">
          {knob("deEssFreq", { label: "De-ess Freq" })}
          {knob("predelayOffset", { label: "Offset", disabled: !reverb.sync })}
          {knob("vlfCut", { label: "VLF Cut" })}
        </div>
      </Group>
      <Group className="flex-col gap-1 px-1">
        <Heading>Early &amp; late</Heading>
        <div className="flex items-start gap-0.5">
          {knob("earlySend", { label: "Early Send" })}
          {knob("earlyCross", { label: "Early Cross" })}
          {knob("lateDiffusion", { label: "Late Diff." })}
        </div>
        <div className="flex items-start gap-0.5">
          <Select
            label="Mod Shape"
            testId="reverb-mod-shape"
            value={reverb.late.modShape}
            options={[
              { value: "chorus", label: "Chorus" },
              { value: "random", label: "Random" },
            ]}
            onChange={(modShape) => setReverb(effectId, { late: { modShape } })}
          />
          <div className="flex flex-col items-center gap-1">
            <div className="flex h-6 items-center gap-1">
              <button type="button" aria-label="Previous variation" className="rounded-sm px-1 text-[var(--verb-label)] hover:text-[var(--verb-text)]" onClick={() => setReverb(effectId, { late: { variation: Math.max(VARIATION_RANGE[0], reverb.late.variation - 1) } })}>
                ‹
              </button>
              <span className="w-8 text-center text-[11px] text-[var(--verb-text)] tabular-nums" data-testid="reverb-variation">
                {reverb.late.variation}
              </span>
              <button type="button" aria-label="Next variation" className="rounded-sm px-1 text-[var(--verb-label)] hover:text-[var(--verb-text)]" onClick={() => setReverb(effectId, { late: { variation: Math.min(VARIATION_RANGE[1], reverb.late.variation + 1) } })}>
                ›
              </button>
            </div>
            <Caption className="text-[8.5px] tracking-[0.02em]">Variation</Caption>
          </div>
          <Toggle label="Tone Lock" on={reverb.late.toneLock} testId="reverb-tone-lock" title="The Decay EQ changes how long each band rings, not how loud (Jot's tone corrector)" onToggle={() => setReverb(effectId, { late: { toneLock: !reverb.late.toneLock } })} />
        </div>
      </Group>
      <Group className="flex-col gap-1 px-1">
        <Heading>Ducking</Heading>
        <div className="flex items-start gap-0.5">
          <Select label="Key" testId="reverb-duck-key" value={key ?? "self"} options={keyOptions} onChange={(v) => commit((s) => setReverbKey(s, effectId, v === "self" ? null : v))} />
          {knob("threshold", {
            disabled: reverb.ducking.threshold === null,
            caption: (
              <Caption className="text-[8.5px] tracking-[0.02em]">
                <AutoToggle on={reverb.ducking.threshold === null} label="Auto threshold" testId="reverb-auto-threshold" onToggle={() => setReverb(effectId, { ducking: { threshold: reverb.ducking.threshold === null ? -30 : null } })} />
                Thresh
              </Caption>
            ),
          })}
          {knob("attack")}
          <div className="flex flex-col items-center">
            {knob("release", { disabled: reverb.ducking.releaseSync })}
            <SyncMenu synced={reverb.ducking.releaseSync} note={reverb.ducking.releaseNote} label="Release" testId="reverb-release-sync" onChoose={(note) => setReverb(effectId, { ducking: note ? { releaseSync: true, releaseNote: note } : { releaseSync: false } })} />
          </div>
        </div>
        <div className="flex items-start gap-0.5">
          {knob("hold")}
          <Select
            label="Duck What"
            testId="reverb-duck-what"
            value={reverb.ducking.what}
            options={[
              { value: "tail", label: "Tail" },
              { value: "all", label: "All" },
            ]}
            onChange={(what) => setReverb(effectId, { ducking: { what } })}
          />
          {knob("autoDecay", { label: "Auto-Decay" })}
          {knob("recovery")}
        </div>
      </Group>
      <Group className="flex-col gap-1 px-1">
        <Heading>Output</Heading>
        <div className="flex items-start gap-0.5">
          {knob("lowShelfFreq", { label: "Low Shelf" })}
          {knob("lowShelfGain", { label: "Gain", bipolar: true })}
          {knob("highShelfFreq", { label: "High Shelf" })}
          {knob("highShelfGain", { label: "Gain", bipolar: true })}
        </div>
        <div className="flex items-start gap-0.5">
          <Toggle label="Studio" on={reverb.output.studio} testId="reverb-studio" title="Abbey Road's send filters: 600 Hz and 10 kHz, steep" onToggle={() => setReverb(effectId, { output: { studio: !reverb.output.studio } })} />
          {knob("monoBelow", { label: "Mono Below" })}
          {knob("level", { label: "Output", bipolar: true })}
          <div className="flex flex-col items-center gap-1">
            <Select
              label="Cut Slope"
              testId="reverb-cut-slope"
              value={String(reverb.lowCutSlope === 24 || reverb.highCutSlope === 24 ? 24 : 12) as "12" | "24"}
              options={[
                { value: "12", label: "12 dB" },
                { value: "24", label: "24 dB" },
              ]}
              onChange={(v) => setReverb(effectId, { lowCutSlope: Number(v) as 12 | 24, highCutSlope: Number(v) as 12 | 24 })}
            />
          </div>
        </div>
      </Group>
    </div>
  );
}

/** The vocal row: De-ess and Duck, the de-esser's lamp, and the advanced panel's switch. */
export function VocalControls({ effectId, reverb, deEssing }: { effectId: string; reverb: Reverb; deEssing: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-4">
      <span className="text-[9.5px] font-semibold tracking-[0.2em] text-[var(--verb-label)] uppercase">Vocal</span>
      <div className="flex items-center gap-1.5">
        <VerbKnob effectId={effectId} reverb={reverb} control="deEss" size={36} />
        {deEssing}
      </div>
      <VerbKnob effectId={effectId} reverb={reverb} control="duck" size={36} />
      <button
        type="button"
        aria-expanded={reverb.view.advanced}
        data-testid="reverb-advanced-toggle"
        className="ml-2 flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10.5px] text-[var(--verb-label)] outline-none hover:text-[var(--verb-text)]"
        onClick={() => setReverb(effectId, { view: { advanced: !reverb.view.advanced } })}
      >
        <span className={cn("inline-block transition-transform", reverb.view.advanced && "rotate-90")}>▸</span> Advanced
      </button>
    </div>
  );
}
