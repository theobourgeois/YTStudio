import { useState } from "react";
import { cn } from "cn";
import { type ChannelPatch, updateChannel } from "@shared/music/edits";
import { DEFAULT_ENVELOPE } from "@shared/music/project";
import {
  DEFAULT_FILTER,
  DEFAULT_LFO,
  DEFAULT_MOD_ENVELOPE,
  FILTER_TYPES,
  type FilterType,
  LFO_SHAPES,
  type Lfo,
  type LfoShape,
  MAX_LFO_BEATS,
  MAX_LFO_HZ,
  MIN_LFO_BEATS,
  MIN_LFO_HZ,
  type ModEnvelope,
  type ModTarget,
  PITCH_MOD_RANGE,
  cutoffHz,
  lfoWave,
  samplerOf,
} from "@shared/music/sampler";
import type { Channel, MusicProject } from "@shared/music/types";
import { MILLISECONDS, PERCENT, SongKnob, type ValueUnit, percent, seconds } from "./knob";
import { useMusic } from "./store";

/** What the envelope and LFO shown move: FL's targets (Mod X and Mod Y are the filter's cutoff and resonance). */
type Target = "volume" | ModTarget;
const TARGETS: { id: Target; label: string; name: string }[] = [
  { id: "volume", label: "VOL", name: "Volume" },
  { id: "pan", label: "PAN", name: "Panning" },
  { id: "cutoff", label: "CUT", name: "Filter cutoff" },
  { id: "resonance", label: "RES", name: "Filter resonance" },
  { id: "pitch", label: "PITCH", name: "Pitch" },
];

/** The envelope's and LFO's times go to 3 s on their knobs (more can be typed). */
const TIME_MAX = 3;
const SECONDS_UNIT: ValueUnit = MILLISECONDS;
const SIGNED: ValueUnit = { scale: 100, unit: "%" };
const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
const FILTER_NAMES: Record<FilterType, string> = { off: "Off", lowpass: "Low pass", bandpass: "Band pass", highpass: "High pass" };
const SHAPE_NAMES: Record<LfoShape, string> = { sine: "Sine", triangle: "Triangle", square: "Square", saw: "Saw" };

const commit = (channelId: string, patch: ChannelPatch) => useMusic.getState().commit((song) => updateChannel(song, channelId, patch));

/**
 * A sampler's Instrument settings (FL Studio's envelope and LFO page, `docs/fl-studio/channel-rack.md`):
 * a target chosen along the top (the volume, the pan, the filter's cutoff and resonance, the pitch), then
 * its envelope (FL's DAHDSR with tensions; for all but the volume, how far it moves it) and its LFO, and
 * the filter the cutoff and resonance belong to.
 */
export function InstrumentTab({ channel }: { channel: Channel }) {
  const [target, setTarget] = useState<Target>("volume");
  const sampler = samplerOf(channel);
  const id = channel.id;
  const envelope: ModEnvelope = target === "volume" ? { ...DEFAULT_MOD_ENVELOPE, ...volumeEnvelope(channel), amount: 1 } : sampler.mods[target].envelope;
  const lfo: Lfo = target === "volume" ? sampler.mods.volumeLfo : sampler.mods[target].lfo;
  /** A patch of the target's envelope, as `updateChannel` takes it. */
  const envelopePatch = (patch: Partial<ModEnvelope>): ChannelPatch => (target === "volume" ? { envelope: patch } : { mods: { [target]: { envelope: patch } } });
  const lfoPatch = (patch: Partial<Lfo>): ChannelPatch => (target === "volume" ? { mods: { volumeLfo: patch } } : { mods: { [target]: { lfo: patch } } });
  const editEnvelope = (song: MusicProject, patch: Partial<ModEnvelope>) => updateChannel(song, id, envelopePatch(patch));
  const editLfo = (song: MusicProject, patch: Partial<Lfo>) => updateChannel(song, id, lfoPatch(patch));
  const filterOff = sampler.filter.type === "off";
  const needsFilter = (target === "cutoff" || target === "resonance") && filterOff;
  const defaults = target === "volume" ? { ...DEFAULT_MOD_ENVELOPE, ...DEFAULT_ENVELOPE } : DEFAULT_MOD_ENVELOPE;

  return (
    <div className="flex flex-col gap-2.5 p-3" data-testid="instrument-tab">
      <div className="flex gap-1" role="radiogroup" aria-label="Target">
        {TARGETS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={target === t.id}
            aria-label={t.name}
            title={t.name}
            className={cn("h-6 flex-1 rounded-sm text-[11px] font-semibold tracking-wide", target === t.id ? "pressed text-brand" : "raised hover:raised-hover text-muted-foreground")}
            onClick={() => setTarget(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Section title={`${TARGETS.find((t) => t.id === target)!.name} envelope`}>
        <Light label="Envelope" on={envelope.enabled} onChange={(enabled) => commit(id, envelopePatch({ enabled }))} />
        {target === "volume" && <p className="mt-1 text-xs text-muted-foreground">{envelope.enabled ? "A note sounds for its own length, then fades." : "Off: every note plays the whole sample."}</p>}
        {needsFilter && <p className="mt-1 text-xs text-muted-foreground">Choose a filter below for this to move.</p>}
        <div className={cn("mt-2.5 flex flex-wrap gap-x-3.5 gap-y-2", !envelope.enabled && "pointer-events-none opacity-40")}>
          {(["delay", "attack", "hold", "decay"] as const).map((key) => (
            <Labelled key={key} label={key === "delay" ? "DEL" : key === "attack" ? "ATT" : key === "hold" ? "HOLD" : "DEC"}>
              <SongKnob size={26} label={`${capital(key)}`} value={Math.min(envelope[key], TIME_MAX)} min={0} max={TIME_MAX} defaultValue={defaults[key]} format={seconds} unit={SECONDS_UNIT} edit={(song, value) => editEnvelope(song, { [key]: value })} />
            </Labelled>
          ))}
          <Labelled label="SUS">
            <SongKnob size={26} label="Sustain" value={envelope.sustain} min={0} max={1} defaultValue={defaults.sustain} format={percent} unit={PERCENT} edit={(song, sustain) => editEnvelope(song, { sustain })} />
          </Labelled>
          <Labelled label="REL">
            <SongKnob size={26} label="Release" value={Math.min(envelope.release, TIME_MAX)} min={0} max={TIME_MAX} defaultValue={defaults.release} format={seconds} unit={SECONDS_UNIT} edit={(song, release) => editEnvelope(song, { release })} />
          </Labelled>
          {target !== "volume" && (
            <Labelled label="AMT">
              <SongKnob size={26} label="Envelope amount" value={envelope.amount} min={-1} max={1} defaultValue={DEFAULT_MOD_ENVELOPE.amount} bipolar format={amountText(target)} unit={SIGNED} edit={(song, amount) => editEnvelope(song, { amount })} />
            </Labelled>
          )}
        </div>
        <div className={cn("mt-2 flex items-center gap-3.5", !envelope.enabled && "pointer-events-none opacity-40")}>
          <span className="text-[10px] font-semibold tracking-wide text-muted-foreground">TENSION</span>
          {(["attackTension", "decayTension", "releaseTension"] as const).map((key) => (
            <Labelled key={key} label={key === "attackTension" ? "ATT" : key === "decayTension" ? "DEC" : "REL"}>
              <SongKnob size={20} label={`${capital(key.replace("Tension", ""))} tension`} value={envelope[key]} min={-1} max={1} defaultValue={0} bipolar format={signed} unit={SIGNED} edit={(song, value) => editEnvelope(song, { [key]: value })} />
            </Labelled>
          ))}
          <EnvelopeGraph envelope={envelope} />
        </div>
      </Section>

      <Section title={`${TARGETS.find((t) => t.id === target)!.name} LFO`}>
        <div className="flex items-center gap-3">
          <Light label="LFO" on={lfo.enabled} onChange={(enabled) => commit(id, lfoPatch({ enabled }))} />
          <div className={cn("ml-auto flex gap-0.5", !lfo.enabled && "pointer-events-none opacity-40")} role="radiogroup" aria-label="LFO shape">
            {LFO_SHAPES.map((shape) => (
              <button
                key={shape}
                type="button"
                role="radio"
                aria-checked={lfo.shape === shape}
                aria-label={SHAPE_NAMES[shape]}
                title={SHAPE_NAMES[shape]}
                className={cn("grid h-5 w-7 place-items-center rounded-sm", lfo.shape === shape ? "pressed text-brand" : "raised hover:raised-hover text-muted-foreground")}
                onClick={() => commit(id, lfoPatch({ shape }))}
              >
                <ShapeIcon shape={shape} />
              </button>
            ))}
          </div>
        </div>
        <div className={cn("mt-2.5 flex flex-wrap items-end gap-x-3.5 gap-y-2", !lfo.enabled && "pointer-events-none opacity-40")}>
          <Labelled label={lfo.sync ? "BEATS" : "SPEED"}>
            <SongKnob
              size={26}
              label="LFO speed"
              value={lfo.speed}
              min={lfo.sync ? MIN_LFO_BEATS : MIN_LFO_HZ}
              max={lfo.sync ? MAX_LFO_BEATS : MAX_LFO_HZ}
              defaultValue={lfo.sync ? 1 : DEFAULT_LFO.speed}
              format={(v) => (lfo.sync ? `${Number(v.toFixed(3))} beat${v === 1 ? "" : "s"} a cycle` : `${v.toFixed(2)} Hz`)}
              unit={{ scale: 1, unit: lfo.sync ? "beats" : "Hz" }}
              edit={(song, speed) => editLfo(song, { speed })}
            />
          </Labelled>
          <Labelled label="AMT">
            <SongKnob
              size={26}
              label="LFO amount"
              value={lfo.amount}
              min={target === "volume" ? 0 : -1}
              max={1}
              defaultValue={DEFAULT_LFO.amount}
              bipolar={target !== "volume"}
              format={target === "volume" ? percent : amountText(target)}
              unit={target === "volume" ? PERCENT : SIGNED}
              edit={(song, amount) => editLfo(song, { amount })}
            />
          </Labelled>
          <Labelled label="DEL">
            <SongKnob size={26} label="LFO delay" value={Math.min(lfo.delay, TIME_MAX)} min={0} max={TIME_MAX} defaultValue={0} format={seconds} unit={SECONDS_UNIT} edit={(song, delay) => editLfo(song, { delay })} />
          </Labelled>
          <Labelled label="ATT">
            <SongKnob size={26} label="LFO attack" value={Math.min(lfo.attack, TIME_MAX)} min={0} max={TIME_MAX} defaultValue={0} format={seconds} unit={SECONDS_UNIT} edit={(song, attack) => editLfo(song, { attack })} />
          </Labelled>
          <Light label="Tempo" on={lfo.sync} onChange={(sync) => commit(id, lfoPatch({ sync, speed: sync ? 1 : DEFAULT_LFO.speed }))} />
        </div>
      </Section>

      <Section title="Filter">
        <div className="flex items-end gap-4">
          <div className="flex gap-0.5" role="radiogroup" aria-label="Filter type">
            {FILTER_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={sampler.filter.type === type}
                className={cn("h-6 rounded-sm px-2 text-[11px]", sampler.filter.type === type ? "pressed text-brand" : "raised hover:raised-hover text-muted-foreground")}
                onClick={() => commit(id, { filter: { type } })}
              >
                {FILTER_NAMES[type]}
              </button>
            ))}
          </div>
          <div className={cn("flex gap-3.5", filterOff && "pointer-events-none opacity-40")}>
            <Labelled label="CUT">
              <SongKnob size={26} label="Cutoff" value={sampler.filter.cutoff} min={0} max={1} defaultValue={DEFAULT_FILTER.cutoff} format={(v) => hz(cutoffHz(v))} unit={PERCENT} edit={(song, cutoff) => updateChannel(song, id, { filter: { cutoff } })} />
            </Labelled>
            <Labelled label="RES">
              <SongKnob size={26} label="Resonance" value={sampler.filter.resonance} min={0} max={1} defaultValue={DEFAULT_FILTER.resonance} format={percent} unit={PERCENT} edit={(song, resonance) => updateChannel(song, id, { filter: { resonance } })} />
            </Labelled>
          </div>
        </div>
      </Section>
    </div>
  );
}

/** The volume envelope as the shape the others have (its delay, hold and tensions 0 until set). */
function volumeEnvelope(channel: Channel): Partial<ModEnvelope> {
  const { enabled, attack, decay, sustain, release, delay = 0, hold = 0, attackTension = 0, decayTension = 0, releaseTension = 0 } = channel.envelope;
  return { enabled, attack, decay, sustain, release, delay, hold, attackTension, decayTension, releaseTension };
}

const capital = (word: string) => word[0].toUpperCase() + word.slice(1);
const hz = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${Math.round(value)} Hz`);
/** What an amount moves its target by, said in its own terms. */
const amountText = (target: Target) => (v: number) =>
  target === "pitch" ? `${v > 0 ? "+" : ""}${(v * PITCH_MOD_RANGE).toFixed(1)} semitones` : target === "pan" ? `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "left" : "right"}` : signed(v);

/** The envelope's shape, drawn small (its stages at a glance). */
function EnvelopeGraph({ envelope }: { envelope: ModEnvelope }) {
  const W = 120;
  const H = 32;
  const total = envelope.delay + envelope.attack + envelope.hold + envelope.decay + 0.25 + envelope.release || 1;
  const x = (seconds: number) => (seconds / total) * W;
  const y = (level: number) => H - 2 - level * (H - 4);
  const points: [number, number][] = [];
  let t = 0;
  points.push([x(t), y(0)]);
  t += envelope.delay;
  points.push([x(t), y(0)]);
  t += envelope.attack;
  points.push([x(t), y(1)]);
  t += envelope.hold;
  points.push([x(t), y(1)]);
  t += envelope.decay;
  points.push([x(t), y(envelope.sustain)]);
  t += 0.25;
  points.push([x(t), y(envelope.sustain)]);
  t += envelope.release;
  points.push([x(t), y(0)]);
  return (
    <svg width={W} height={H} className="ml-auto rounded-sm border bg-background" aria-hidden>
      <polyline points={points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ")} className="fill-none stroke-brand" strokeWidth={1.5} />
    </svg>
  );
}

function ShapeIcon({ shape }: { shape: LfoShape }) {
  const points = Array.from({ length: 21 }, (_, i) => `${i * 0.7 + 1},${5 - lfoWave(shape, i / 20) * 3.5}`).join(" ");
  return (
    <svg width={16} height={10} aria-hidden>
      <polyline points={points} className="fill-none stroke-current" strokeWidth={1.2} />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border bg-muted/30" aria-label={title}>
      <h3 className="border-b px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{title}</h3>
      <div className="p-2.5">{children}</div>
    </section>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      {children}
      <span className="text-[9px] font-medium tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

/** A lit switch with its name, FL Studio's round toggles. */
export function Light({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="flex items-center gap-2 text-[13px]" onClick={() => onChange(!on)}>
      <span className={cn("size-3 rounded-full border", on ? "border-brand-edge bg-brand shadow-[0_0_5px] shadow-brand/70 inset-shadow-[0_1px_0_rgb(255_255_255/0.45)]" : "sunken")} />
      {label}
    </button>
  );
}
