/**
 * EchoBoy's drawers (`docs/soundtoys/echoboy-manual.md`): each mode's Tweak, and the Style Editor (EQ, Diffusion,
 * Wobble, Saturation), which drop down under its panel.
 */
import { type ReactNode, useRef } from "react";
import { cn } from "cn";
import { editStyle, revertStyle, styleOf, updateEchoBoy, updateRhythm } from "@shared/music/echo-boy";
import { EQ_GAIN_RANGE, HIGH_FREQ_RANGE, LOW_FREQ_RANGE, MAX_DIFFUSION_SIZE, MAX_ECHO_GAIN, MAX_OFFSET, MAX_RHYTHM_BEATS, MAX_WOBBLE_DEPTH, MID_FREQ_RANGE, MID_RES_RANGE, WOBBLE_RATE_RANGE } from "@shared/music/echo-boy-presets";
import { decayDb } from "@shared/music/echo-boy-styles";
import { ECHO_NOTES, ECHO_SATURATIONS, ECHO_WOBBLES, type EchoBoy, type EchoSaturation, type EchoStyle, type EchoWobble, type MusicProject, PAN_SHAPES, type PanShape } from "@shared/music/types";
import { DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PERCENT, type ValueUnit, percent } from "../knob";
import { Lcd } from "../lcd";
import { songGesture, useMusic } from "../store";
import { copyStyle, pasteStyle } from "./actions";
import { Caption, EchoKnob, LcdMenu, Toggle } from "./controls";
import { useEchoUi } from "./store";

const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);
const DB: ValueUnit = { scale: 1, unit: "dB", digits: 1 };
const MS: ValueUnit = { scale: 1, unit: "ms", digits: 1 };
const HZ: ValueUnit = { scale: 1, unit: "Hz" };
const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const sided = (left: string, right: string) => (v: number) => (Math.abs(v) < 0.005 ? "Centre" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? left : right}`);
export const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`);

/** A drawer's frame: its groups side by side, each under its name. */
function Drawer({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="flex flex-wrap items-start justify-center gap-2 border-t border-line bg-surface-0 px-2 pt-2 pb-2.5" data-testid={testId}>
      {children}
    </div>
  );
}
function Group({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col items-center gap-1.5 rounded-md border border-line bg-surface-1 px-2.5 pt-1.5 pb-2", className)}>
      <Caption className="w-full border-b border-line pb-1 text-center text-foreground/80">{title}</Caption>
      <div className="flex items-start gap-3">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tweak
// ---------------------------------------------------------------------------

/** The mode's Tweak: Single's Width, L/R Offset and Accent; Dual's and Ping-Pong's balances; Rhythm's pans and grid. */
export function TweakPanel({ effectId, eb }: { effectId: string; eb: EchoBoy }) {
  const set = (patch: Parameters<typeof updateEchoBoy>[2]) => (s: MusicProject) => updateEchoBoy(s, effectId, patch);
  const width = <EchoKnob key="width" label="Width" ends={["Min", "Max"]} size={34} value={eb.width} min={0} max={1} defaultValue={0.5} format={percent} unit={PERCENT} target={{ kind: "echoBoy", effect: effectId, control: "width" }} edit={(s, width) => set({ width })(s)} />;
  const offset = <EchoKnob key="offset" label="L/R Offset" ends={["0", "25"]} size={34} value={eb.offset} min={0} max={MAX_OFFSET} defaultValue={8} format={(v) => `${v.toFixed(1)} ms`} unit={MS} edit={(s, offset) => set({ offset })(s)} />;
  const balance = <EchoKnob key="balance" label="Balance" ends={["L", "R"]} size={34} bipolar value={eb.balance} min={-1} max={1} defaultValue={0} format={sided("left", "right")} unit={PERCENT} edit={(s, balance) => set({ balance })(s)} />;
  const accent = (key: "accent" | "accent2", label: string) => (
    <EchoKnob key={key} label={label} ends={["−", "+"]} size={34} bipolar value={eb[key]} min={-1} max={1} defaultValue={0} format={sided("even repeats", "odd repeats")} unit={PERCENT} edit={(s, v) => set({ [key]: v })(s)} />
  );
  let controls: ReactNode;
  switch (eb.mode) {
    case "single":
      controls = [width, offset, accent("accent", "Accent")];
      break;
    case "dual":
      controls = [
        balance,
        width,
        offset,
        accent("accent", "Accent 1"),
        accent("accent2", "Accent 2"),
        <EchoKnob key="fbmix" label="FB Mix" ends={["Min", "Cross"]} size={34} value={eb.feedbackMix} min={0} max={1} defaultValue={0} format={percent} unit={PERCENT} edit={(s, feedbackMix) => set({ feedbackMix })(s)} />,
        <EchoKnob key="fbbal" label="FB Bal" ends={["L", "R"]} size={34} bipolar value={eb.feedbackBalance} min={-1} max={1} defaultValue={0} format={sided("left", "right")} unit={PERCENT} edit={(s, feedbackBalance) => set({ feedbackBalance })(s)} />,
      ];
      break;
    case "pingPong":
      controls = [width, balance];
      break;
    case "rhythm":
      controls = <RhythmTweak effectId={effectId} eb={eb} offset={offset} width={width} />;
      break;
  }
  return (
    <Drawer testId="echo-tweak">
      <Group title={`Tweak: ${{ single: "Single Echo", dual: "Dual Echo", pingPong: "Ping-Pong", rhythm: "Rhythm Echo" }[eb.mode]}`}>{controls}</Group>
    </Drawer>
  );
}

const PAN_NAMES: Record<PanShape, string> = { double: "Double", center: "Center", alt1: "Alt 1", alt2: "Alt 2", alt3: "Alt 3", sweepL: "Sweep L", sweepR: "Sweep R", pan: "Pan" };

/** Rhythm Echo's Tweak: L/R Offset (with Double), Width, Pan Shape, Accent (Warp with Time), the grid, the length. */
function RhythmTweak({ effectId, eb, offset, width }: { effectId: string; eb: EchoBoy; offset: ReactNode; width: ReactNode }) {
  const r = eb.rhythm;
  const gesture = useRef(songGesture()).current;
  const warp = r.time.sync === "time";
  const setRhythm = (patch: Partial<EchoBoy["rhythm"]>) => (s: MusicProject) => updateRhythm(s, effectId, (rr) => ({ ...rr, ...patch }));
  return (
    <>
      {offset}
      {width}
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <Caption className="text-foreground/80">Pan Shape</Caption>
        <LcdMenu label="Pan Shape" text={PAN_NAMES[r.panShape]} className="w-20" testId="echo-pan-shape">
          <DropdownMenuRadioGroup value={r.panShape} onValueChange={(v) => commit(setRhythm({ panShape: v as PanShape }))}>
            {PAN_SHAPES.map((p) => (
              <DropdownMenuRadioItem key={p} value={p}>
                {PAN_NAMES[p]}
                {p === "double" && <span className="ml-2 text-muted-foreground">(8 stereo pairs)</span>}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </LcdMenu>
      </div>
      <EchoKnob
        label={warp ? "Warp" : "Accent"}
        ends={["−", "+"]}
        size={34}
        bipolar
        value={r.accent}
        min={-1}
        max={1}
        defaultValue={0}
        format={warp ? sided("to the start", "to the end") : sided("even taps", "odd taps")}
        unit={PERCENT}
        edit={(s, accent) => setRhythm({ accent })(s)}
      />
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <Caption className="text-foreground/80">Rhythm Grid</Caption>
        <LcdMenu label="Rhythm Grid" text={`1/${r.grid}`} className="w-16" testId="echo-rhythm-grid-note">
          <DropdownMenuRadioGroup value={String(r.grid)} onValueChange={(v) => commit(setRhythm({ grid: Number(v) as EchoBoy["rhythm"]["grid"] }))}>
            {ECHO_NOTES.map((n) => (
              <DropdownMenuRadioItem key={n} value={String(n)}>
                1/{n} note
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </LcdMenu>
      </div>
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <Caption className="text-foreground/80">Length</Caption>
        <Lcd
          value={r.length * 2}
          min={2}
          max={MAX_RHYTHM_BEATS * 2}
          label="Length (beats)"
          text={`${r.length} beat${r.length === 1 ? "" : "s"}`}
          className="lcd h-6 w-20 rounded border-0 text-[11px]"
          onBegin={() => gesture.begin()}
          onChange={(v) => gesture.apply((s) => updateRhythm(s, effectId, (rr) => ({ ...rr, length: v / 2, taps: rr.taps.filter((t) => t.beat < v / 2) })))}
          onEnd={() => gesture.end()}
          onCancel={() => gesture.cancel()}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The Style Editor
// ---------------------------------------------------------------------------

/** A knob of the Style Editor (a log taper for frequencies), editing the style (it becomes Custom). */
function StyleKnob({
  effectId,
  label,
  ends,
  value,
  range,
  log,
  defaultValue,
  format,
  unit,
  bipolar,
  change,
}: {
  effectId: string;
  label: string;
  ends: [string, string];
  value: number;
  range: readonly [number, number];
  log?: boolean;
  defaultValue: number;
  format: (v: number) => string;
  unit: ValueUnit;
  bipolar?: boolean;
  change: (style: EchoStyle, value: number) => EchoStyle;
}) {
  const [min, max] = range;
  const toFraction = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const toValue = (f: number) => (log ? min * (max / min) ** f : min + f * (max - min));
  return (
    <EchoKnob
      label={label}
      ends={ends}
      size={32}
      bipolar={bipolar}
      value={toFraction(value)}
      min={0}
      max={1}
      defaultValue={toFraction(defaultValue)}
      format={(f) => format(toValue(f))}
      unit={log ? { scale: 1, unit: "" } : unit}
      edit={(s, f) => editStyle(s, effectId, (st) => change(st, Math.round(toValue(f) * 100) / 100))}
    />
  );
}

const SATURATION_NAMES: Record<EchoSaturation, string> = {
  clean: "Clean",
  tape: "Tape",
  warm: "Warm",
  pump: "Pump",
  dirt: "Dirt",
  hardLimit: "Hard Limit",
  softLimit: "Soft Limit",
  warmLimit: "Warm Limit",
  brightLimit: "Bright Limit",
};
const WOBBLE_NAMES: Record<EchoWobble, string> = { triangle: "Triangle", sine: "Sine", square: "Square", randomWalk: "Random Walk", randomHold: "Random S/H" };
const decayText = (v: number) => `${v.toFixed(0)} (${decayDb(v) > 0 ? "+" : ""}${decayDb(v).toFixed(2)} dB a repeat)`;

/** The Style Editor: the style's settings, every one a knob (EchoBoy's EQ, Diffusion, Wobble, Saturation). */
export function StyleEditor({ effectId, eb }: { effectId: string; eb: EchoBoy }) {
  const st = styleOf(eb);
  const copied = useEchoUi((s) => s.copiedStyle !== null);
  const k = (label: string, ends: [string, string], value: number, range: readonly [number, number], defaultValue: number, format: (v: number) => string, change: (s: EchoStyle, v: number) => EchoStyle, opts: { log?: boolean; unit?: ValueUnit; bipolar?: boolean } = {}) => (
    <StyleKnob key={label} effectId={effectId} label={label} ends={ends} value={value} range={range} defaultValue={defaultValue} format={format} change={change} unit={opts.unit ?? DB} log={opts.log} bipolar={opts.bipolar} />
  );
  const gainEnds: [string, string] = ["-40", "+18"];
  return (
    <Drawer testId="echo-style-editor">
      <Group title="Low EQ">
        {k("Freq", ["20", "2K"], st.low.freq, LOW_FREQ_RANGE, 20, hz, (s, freq) => ({ ...s, low: { ...s.low, freq } }), { log: true, unit: HZ })}
        {k("Gain", gainEnds, st.low.gain, EQ_GAIN_RANGE, 0, db, (s, gain) => ({ ...s, low: { ...s.low, gain } }))}
        {k("Decay", gainEnds, st.low.decay, EQ_GAIN_RANGE, 0, decayText, (s, decay) => ({ ...s, low: { ...s.low, decay } }))}
      </Group>
      <Group title="Mid EQ">
        {k("Freq", ["20", "5K"], st.mid.freq, MID_FREQ_RANGE, 1000, hz, (s, freq) => ({ ...s, mid: { ...s.mid, freq } }), { log: true, unit: HZ })}
        {k("Res", ["-12", "+24"], st.mid.res, MID_RES_RANGE, 0, (v) => v.toFixed(1), (s, res) => ({ ...s, mid: { ...s.mid, res } }), { unit: { scale: 1, unit: "" } })}
        {k("Gain", gainEnds, st.mid.gain, EQ_GAIN_RANGE, 0, db, (s, gain) => ({ ...s, mid: { ...s.mid, gain } }))}
        {k("Decay", gainEnds, st.mid.decay, EQ_GAIN_RANGE, 0, decayText, (s, decay) => ({ ...s, mid: { ...s.mid, decay } }))}
      </Group>
      <Group title="High EQ">
        {k("Freq", ["500", "12K"], st.high.freq, HIGH_FREQ_RANGE, 12_000, hz, (s, freq) => ({ ...s, high: { ...s.high, freq } }), { log: true, unit: HZ })}
        {k("Gain", gainEnds, st.high.gain, EQ_GAIN_RANGE, 0, db, (s, gain) => ({ ...s, high: { ...s.high, gain } }))}
        {k("Decay", gainEnds, st.high.decay, EQ_GAIN_RANGE, 0, decayText, (s, decay) => ({ ...s, high: { ...s.high, decay } }))}
      </Group>
      <Group title="Diffusion">
        {k("Amount", ["Off", "Max"], st.diffusion.amount, [0, 1], 0, percent, (s, amount) => ({ ...s, diffusion: { ...s.diffusion, amount } }), { unit: PERCENT })}
        <div className="flex flex-col items-center gap-1.5">
          {k("Size", ["0", "50"], st.diffusion.size, [0, MAX_DIFFUSION_SIZE], 10, (v) => v.toFixed(1), (s, size) => ({ ...s, diffusion: { ...s.diffusion, size } }), { unit: { scale: 1, unit: "" } })}
          <div className="flex flex-col items-start" role="radiogroup" aria-label="Diffusion: in the loop or after it">
            <Toggle on={st.diffusion.loop} label="Loop" title="In the feedback loop: each repeat more diffused" onChange={() => commit((s) => editStyle(s, effectId, (x) => ({ ...x, diffusion: { ...x.diffusion, loop: true } })))} />
            <Toggle on={!st.diffusion.loop} label="Post" title="After the loop: every repeat diffused alike" onChange={() => commit((s) => editStyle(s, effectId, (x) => ({ ...x, diffusion: { ...x.diffusion, loop: false } })))} />
          </div>
        </div>
      </Group>
      <Group title="Wobble">
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-start gap-3">
            {k("Depth", ["Off", "1200"], st.wobble.depth, [0, MAX_WOBBLE_DEPTH], 0, (v) => `${v.toFixed(1)} cents`, (s, depth) => ({ ...s, wobble: { ...s.wobble, depth } }), { unit: { scale: 1, unit: "cents" } })}
            {k("Rate", [".01", "50"], st.wobble.rate, WOBBLE_RATE_RANGE, 0.5, (v) => `${v.toFixed(2)} Hz`, (s, rate) => ({ ...s, wobble: { ...s.wobble, rate } }), { log: true, unit: HZ })}
            {k("Sync", ["−", "+"], st.wobble.sync, [-1, 1], 0, sided("rates apart", "phases apart"), (s, sync) => ({ ...s, wobble: { ...s.wobble, sync } }), { bipolar: true, unit: PERCENT })}
          </div>
          <div className="flex items-center gap-2">
            <Toggle on={st.wobble.feedback} label="FB" title="Wobble the repeats (in the loop)" onChange={(feedback) => commit((s) => editStyle(s, effectId, (x) => ({ ...x, wobble: { ...x.wobble, feedback } })))} />
            <Toggle on={st.wobble.out} label="Out" title="Wobble the echo's output" onChange={(out) => commit((s) => editStyle(s, effectId, (x) => ({ ...x, wobble: { ...x.wobble, out } })))} />
            <LcdMenu label="Wobble shape" text={WOBBLE_NAMES[st.wobble.shape]} className="w-28" testId="echo-wobble-shape">
              <DropdownMenuRadioGroup value={st.wobble.shape} onValueChange={(v) => commit((s) => editStyle(s, effectId, (x) => ({ ...x, wobble: { ...x.wobble, shape: v as EchoWobble } })))}>
                {ECHO_WOBBLES.map((w) => (
                  <DropdownMenuRadioItem key={w} value={w}>
                    {WOBBLE_NAMES[w]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </LcdMenu>
          </div>
        </div>
      </Group>
      <Group title="Saturation">
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-start gap-3">
            {k("Decay Sat", ["-24", "+24"], st.saturation.decay, [-MAX_ECHO_GAIN, MAX_ECHO_GAIN], 0, db, (s, decay) => ({ ...s, saturation: { ...s.saturation, decay } }), { bipolar: true })}
            {k("Out Sat", ["-24", "+24"], st.saturation.out, [-MAX_ECHO_GAIN, MAX_ECHO_GAIN], 0, db, (s, out) => ({ ...s, saturation: { ...s.saturation, out } }), { bipolar: true })}
          </div>
          <LcdMenu label="Saturation type" text={SATURATION_NAMES[st.saturation.type]} className="w-28" testId="echo-saturation-type">
            <DropdownMenuRadioGroup value={st.saturation.type} onValueChange={(v) => commit((s) => editStyle(s, effectId, (x) => ({ ...x, saturation: { ...x.saturation, type: v as EchoSaturation } })))}>
              {ECHO_SATURATIONS.map((t) => (
                <DropdownMenuRadioItem key={t} value={t}>
                  {SATURATION_NAMES[t]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => copyStyle(effectId)}>Copy style</DropdownMenuItem>
            <DropdownMenuItem disabled={!copied} onSelect={() => pasteStyle(effectId)}>
              Paste style
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!eb.custom} onSelect={() => commit((s) => revertStyle(s, effectId))}>
              Back to {eb.style}
            </DropdownMenuItem>
          </LcdMenu>
        </div>
      </Group>
    </Drawer>
  );
}
