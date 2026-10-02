import { useEffect, useRef, useState } from "react";
import { PiFolderOpen, PiPlug, PiWaveform, PiWaveSine } from "react-icons/pi";
import { cn } from "cn";
import { levelGain, panGains } from "@shared/music/compile";
import { updateChannel } from "@shared/music/edits";
import { pitchSpeed } from "@shared/music/playlist";
import { DEFAULT_PRECOMPUTED, DEFAULT_VOLUME, MAX_SAMPLE_START, MIN_SAMPLE_LENGTH, PITCH_KNOB_RANGE, precomputedUntouched } from "@shared/music/project";
import type { Channel, Precomputed } from "@shared/music/types";
import { type SampleLoop, samplerOf } from "@shared/music/sampler";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { STRETCH_MODE_NAMES } from "@shared/music/stretch";
import { STRETCH_MODES } from "@shared/music/types";
import { StretchMenuItems } from "./stretch-menu";
import { clearStretch, setStretchMode, stretchLabel } from "./stretching";
import { CENTS, PERCENT, SongKnob, type ValueUnit, cents, panText, percent } from "./knob";
import { solo, toggleMute } from "./rack-actions";
import { musicApi } from "./api";
import { useMusic } from "./store";
import { useTransport } from "./transport";
import { channelWindow, useMusicUi } from "./ui";
import { carriesSamples, dropOnChannel } from "./browser/drops";
import { loadSamples, waveformColumns } from "./waveform";
import { routeToFreeTrack } from "./mixer/actions";
import { TrackSelector } from "./mixer/track-selector";
import { MusicWindow, cascadedOnDesktop } from "./window";
import { PluginTab } from "./plugin-tab";
import { InstrumentTab } from "./instrument-tab";

/** A plugin channel's PITCH: whole semitones its keys are moved by. */
const SEMITONES: ValueUnit = { scale: 1, unit: "semitones" };
const semitones = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)} semitone${Math.abs(Math.round(v)) === 1 ? "" : "s"}`;

type Tab = "sample" | "envelope";

/**
 * A sampler channel's settings, FL Studio's Channel Settings window (`docs/fl-studio/channel-rack.md`):
 * along the top its tabs and the channel's own ON, PAN, VOL and PITCH; under them the sample tab
 * (the file, the precomputed effects, the waveform) or the envelope tab. An audio clip's channel has a
 * cut-down one (a double-click on one of its clips opens it); a plugin channel's is FL's wrapper: the
 * same controls over the plugin and its presets (`plugin-tab.tsx`).
 */
export function ChannelSettingsWindow({ channel, index }: { channel: Channel; index: number }) {
  const [tab, setTab] = useState<Tab>("sample");
  const id = channel.id;
  // An audio clip's channel (FL's cut-down sampler): its file streams from the Playlist, so it has no
  // envelope; its pitch plays the file faster or slower (FL's Resample).
  const audio = channel.kind === "audio";
  const plugin = channel.kind === "plugin";
  // Cascaded by its place in the rack, but always in view: an audio clip's channel can be far down it.
  const [initial] = useState(() => cascadedOnDesktop(index, { x: 120, y: 190 }, 28, { width: 440, height: WINDOW_HEIGHT }));

  return (
    <MusicWindow
      id={channelWindow(id)}
      title={channel.name}
      initial={initial}
      onClose={() => useMusicUi.getState().closeChannelWindow(id)}
      className="w-[440px]"
    >
      <div
        data-testid="channel-settings"
        data-channel-name={channel.name}
        // A sample dropped anywhere on its window becomes the channel's.
        onDragOver={(e) => {
          if (plugin || !carriesSamples(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          if (plugin || !carriesSamples(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          dropOnChannel(e.dataTransfer, id);
        }}
      >
        <div className="flex items-end gap-3 border-b px-3 pt-2 pb-2">
          <div className="flex gap-1" role="tablist" aria-label="Settings">
            {plugin ? (
              <TabButton label="Plugin" selected onSelect={() => {}}>
                <PiPlug />
              </TabButton>
            ) : (
              <TabButton label="Sample" selected={tab === "sample"} onSelect={() => setTab("sample")}>
                <PiWaveform />
              </TabButton>
            )}
            {!audio && !plugin && (
              <TabButton label="Envelope" selected={tab === "envelope"} onSelect={() => setTab("envelope")}>
                <PiWaveSine />
              </TabButton>
            )}
          </div>
          <div className="ml-auto flex items-end gap-3">
            <Labelled label="ON">
              <button
                type="button"
                aria-label={channel.muted ? `Unmute ${channel.name}` : `Mute ${channel.name}`}
                aria-pressed={!channel.muted}
                className={cn("my-1.5 size-3.5 rounded-full border", channel.muted ? "sunken" : "border-brand-edge bg-brand shadow-[0_0_5px] shadow-brand/70 inset-shadow-[0_1px_0_rgb(255_255_255/0.45)]")}
                onClick={(e) => (e.altKey || e.metaKey || e.ctrlKey ? solo(id) : toggleMute(id))}
              />
            </Labelled>
            <Labelled label="PAN">
              <SongKnob
                size={26}
                label="Pan"
                value={channel.pan}
                min={-1}
                max={1}
                defaultValue={0}
                bipolar
                format={panText}
                unit={PERCENT}
                target={{ kind: "channel", channel: id, control: "pan" }}
                edit={(song, pan) => updateChannel(song, id, { pan })}
              />
            </Labelled>
            <Labelled label="VOL">
              <SongKnob
                size={26}
                label="Volume"
                value={channel.volume}
                min={0}
                max={1}
                defaultValue={DEFAULT_VOLUME}
                format={percent}
                unit={PERCENT}
                target={{ kind: "channel", channel: id, control: "volume" }}
                edit={(song, volume) => updateChannel(song, id, { volume })}
              />
            </Labelled>
            <Labelled label="PITCH">
              <SongKnob
                size={26}
                label="Pitch"
                value={clampPitch(channel.pitch)}
                min={-PITCH_KNOB_RANGE}
                max={PITCH_KNOB_RANGE}
                defaultValue={0}
                bipolar
                // A plugin's keys are moved by whole semitones (ours: FL's wrapper bends within the plugin's range).
                format={plugin ? semitones : cents}
                unit={plugin ? SEMITONES : CENTS}
                // Automated, a sampler's notes bend as they sound; a plugin channel's move by whole semitones. An audio clip's channel's clips can't follow it.
                target={audio ? undefined : { kind: "channel", channel: id, control: "pitch" }}
                // Whole semitones as it turns; cents are typed in. An audio clip plays faster pitched up (FL's Resample).
                edit={(song, pitch) => updateChannel(song, id, { pitch: !plugin && Number.isInteger(pitch * 100) && !Number.isInteger(pitch) ? pitch : Math.round(pitch) })}
              />
            </Labelled>
            {!audio && (
              <Labelled label="SWING">
                <SongKnob
                  size={26}
                  label="Swing mix"
                  value={channel.swingMix ?? 1}
                  min={0}
                  max={1}
                  defaultValue={1}
                  format={(v) => `${Math.round(v * 100)}% of the song's swing`}
                  unit={PERCENT}
                  edit={(song, swingMix) => updateChannel(song, id, { swingMix })}
                />
              </Labelled>
            )}
            <div className="flex flex-col items-center gap-0.5">
              <TrackSelector channel={channel} className="my-0.5 h-[22px] min-w-9 text-[11px]" />
              {/* A click on its name gives the channel a free track of its own, as in FL Studio. */}
              <button type="button" className="text-[9px] font-medium tracking-wide text-muted-foreground hover:text-foreground" title="Route to a free mixer track" onClick={() => routeToFreeTrack(id)}>
                TRACK
              </button>
            </div>
          </div>
        </div>

        {plugin ? <PluginTab channel={channel} /> : tab === "sample" || audio ? <SampleTab channel={channel} /> : <InstrumentTab channel={channel} />}
      </div>
    </MusicWindow>
  );
}

const clampPitch = (pitch: number) => Math.min(PITCH_KNOB_RANGE, Math.max(-PITCH_KNOB_RANGE, pitch));

function TabButton({ label, selected, onSelect, children }: { label: string; selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={label}
      title={label}
      className={cn("grid size-9 place-items-center rounded-md text-lg", selected ? "bg-accent text-brand" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

/** A control with its name under it, as on FL Studio's panels. */
function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      {children}
      <span className="text-[9px] font-medium tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border bg-muted/30">
      <h3 className="border-b px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{title}</h3>
      <div className="p-2.5">{children}</div>
    </section>
  );
}

/** A lit switch with its name, FL Studio's round toggles. */
function Light({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="flex items-center gap-2 text-[13px]" onClick={() => onChange(!on)}>
      <span className={cn("size-3 rounded-full border", on ? "border-brand-edge bg-brand shadow-[0_0_5px] shadow-brand/70 inset-shadow-[0_1px_0_rgb(255_255_255/0.45)]" : "sunken")} />
      {label}
    </button>
  );
}

const PRECOMPUTED_KNOBS: { key: "start" | "length" | "fadeIn" | "fadeOut"; label: string; name: string; min: number; max: number }[] = [
  { key: "start", label: "SMP START", name: "Sample start", min: 0, max: MAX_SAMPLE_START },
  { key: "length", label: "LENGTH", name: "Length", min: MIN_SAMPLE_LENGTH, max: 1 },
  { key: "fadeIn", label: "IN", name: "Fade in", min: 0, max: 1 },
  { key: "fadeOut", label: "OUT", name: "Fade out", min: 0, max: 1 },
];

function SampleTab({ channel }: { channel: Channel }) {
  const asset = useMusic((s) => s.assets.find((a) => a.id === channel.sampleId) ?? null);
  const unreadable = useTransport((s) => s.unreadable.includes(channel.id));
  const [name, setName] = useState(channel.name);
  const file = useRef<HTMLInputElement>(null);
  const commit = useMusic.getState().commit;
  const id = channel.id;
  const set = (patch: Partial<Precomputed>) => commit((song) => updateChannel(song, id, { precomputed: patch }));
  useEffect(() => setName(channel.name), [channel.name]);

  return (
    <div className="flex flex-col gap-2.5 p-3">
      <Section title="File">
        <div className="flex items-center gap-2">
          <Input
            aria-label="Channel name"
            className="h-7 w-32"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => commit((song) => updateChannel(song, id, { name }))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" title={asset?.name}>
            {asset?.name ?? "No sample"}
            {unreadable && <span className="text-destructive"> (can't be read)</span>}
          </p>
          <button
            type="button"
            aria-label="Load sample"
            title="Load a sample"
            className="grid size-7 place-items-center rounded-md border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground dark:border-white/[0.07]"
            onClick={() => file.current?.click()}
          >
            <PiFolderOpen />
          </button>
          <input
            ref={file}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) void useMusic.getState().replaceSample(id, picked);
              e.target.value = "";
            }}
          />
        </div>
      </Section>

      <Section title="Precomputed effects">
        <div className="flex gap-6">
          <Light label="Normalize" on={channel.precomputed.normalize} onChange={(normalize) => set({ normalize })} />
          <Light label="Reverse" on={channel.precomputed.reverse} onChange={(reverse) => set({ reverse })} />
        </div>
        <div className="mt-3 flex gap-5">
          {PRECOMPUTED_KNOBS.map(({ key, label, name: knobName, min, max }) => (
            <Labelled key={key} label={label}>
              <SongKnob
                size={30}
                label={knobName}
                value={channel.precomputed[key]}
                min={min}
                max={max}
                defaultValue={DEFAULT_PRECOMPUTED[key]}
                format={percent}
                unit={PERCENT}
                edit={(song, value) => updateChannel(song, id, { precomputed: { [key]: value } })}
              />
            </Labelled>
          ))}
        </div>
      </Section>

      {channel.kind === "sampler" && <LoopSection channel={channel} />}
      {channel.kind === "audio" && <TimeStretching channel={channel} />}

      <Waveform url={asset?.src ?? null} precomputed={channel.precomputed} loop={channel.kind === "sampler" ? samplerOf(channel).loop : null} onPlay={() => hearChannel(channel)} />
    </div>
  );
}

/**
 * FL's Time stretching (an audio clip channel's): its MODE, and its TIME with FL's menu (none,
 * Autodetect, Project tempo, beats and bars, twice or half as long). Its clips that have no stretch of
 * their own play by it.
 */
function TimeStretching({ channel }: { channel: Channel }) {
  const target = { kind: "channel" as const, id: channel.id };
  const stretch = channel.stretch ?? null;
  return (
    <Section title="Time stretching">
      <div className="flex items-center gap-5">
        {STRETCH_MODES.map((mode) => (
          <Light key={mode} label={STRETCH_MODE_NAMES[mode]} on={stretch?.mode === mode} onChange={(on) => (on ? setStretchMode(target, mode) : clearStretch(target))} />
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[9px] font-medium tracking-wide text-muted-foreground">TIME</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Time" title="How long the file lasts (FL's TIME): its menu" className="sunken flex h-6 min-w-20 items-center justify-end rounded px-1.5 font-mono text-xs tabular-nums">
                {stretchLabel(stretch)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <StretchMenuItems target={target} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Section>
  );
}

/** FL's sample loop: while a note is held, the sample goes round between its points (on the waveform below), crossfaded. */
function LoopSection({ channel }: { channel: Channel }) {
  const { loop } = samplerOf(channel);
  const id = channel.id;
  return (
    <Section title="Loop">
      <div className="flex items-end gap-5">
        <Light label="Loop while held" on={loop.enabled} onChange={(enabled) => useMusic.getState().commit((song) => updateChannel(song, id, { loop: { enabled } }))} />
        <div className={cn("flex gap-4", !loop.enabled && "pointer-events-none opacity-40")}>
          <Labelled label="START">
            <SongKnob size={26} label="Loop start" value={loop.start} min={0} max={1} defaultValue={0} format={percent} unit={PERCENT} edit={(song, start) => updateChannel(song, id, { loop: { start } })} />
          </Labelled>
          <Labelled label="END">
            <SongKnob size={26} label="Loop end" value={loop.end} min={0} max={1} defaultValue={1} format={percent} unit={PERCENT} edit={(song, end) => updateChannel(song, id, { loop: { end } })} />
          </Labelled>
          <Labelled label="XFADE">
            <SongKnob size={26} label="Loop crossfade" value={loop.crossfade} min={0} max={0.5} defaultValue={0} format={percent} unit={PERCENT} edit={(song, crossfade) => updateChannel(song, id, { loop: { crossfade } })} />
          </Labelled>
        </div>
      </div>
    </Section>
  );
}

/** About as tall as the window is (its sample tab), to open it where it fits. */
const WINDOW_HEIGHT = 480;
const WAVE_W = 414;
const WAVE_H = 84;

/**
 * Hear a channel's sample, as a click on its waveform does: a sampler plays it as a note would; an audio
 * clip's channel, its whole file (streamed, as the Browser's previews are).
 */
function hearChannel(channel: Channel) {
  if (!channel.sampleId) return;
  // A sampler plays it as a note would; so does an audio clip's channel with precomputed effects (the
  // engine has it prepared in memory, as its clips play it). Otherwise its file is streamed.
  if (channel.kind !== "audio" || !precomputedUntouched(channel.precomputed)) return useTransport.getState().audition(channel.id);
  const projectId = useMusic.getState().projectId;
  // As its clips sound: its volume, pan and pitch (whether it's on or not, so it can be heard while muted).
  const [left, right] = panGains(channel.pan);
  const gain = levelGain(channel.volume, DEFAULT_VOLUME);
  const request = { projectId: projectId ?? "", sampleId: channel.sampleId, id: channel.id, gainLeft: gain * left, gainRight: gain * right, speed: pitchSpeed(channel.pitch) };
  if (projectId) void musicApi.previewSample(request).catch(() => {});
}

/** The sample as it will play, after the precomputed effects: its real waveform. Press it to hear the channel. */
function Waveform({ url, precomputed, loop, onPlay }: { url: string | null; precomputed: Precomputed; loop: SampleLoop | null; onPlay: () => void }) {
  const [samples, setSamples] = useState<Float32Array | null>(null);
  useEffect(() => {
    setSamples(null);
    if (!url) return;
    let current = true;
    loadSamples(url).then(
      (loaded) => current && setSamples(loaded),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [url]);

  const mid = WAVE_H / 2;
  const scale = mid - 3;
  // A closed shape: along the top of every column, then back along the bottom.
  let path = "";
  if (samples) {
    const { min, max } = waveformColumns(samples, precomputed, WAVE_W);
    // Never thinner than a hairline, so silence still draws.
    const y = (value: number, nudge: number) => (mid - Math.max(-1, Math.min(1, value)) * scale + nudge).toFixed(1);
    for (let x = 0; x < WAVE_W; x++) path += `${x ? "L" : "M"}${x} ${y(max[x], -0.5)}`;
    for (let x = WAVE_W - 1; x >= 0; x--) path += `L${x} ${y(min[x], 0.5)}`;
    path += "Z";
  }

  return (
    <button
      type="button"
      aria-label="Hear the sample"
      title="Click to hear it"
      data-testid="sample-waveform"
      data-loaded={samples !== null}
      className="block overflow-hidden rounded-md border bg-background outline-none hover:border-brand/50"
      // On the press, not the click (which waits for the button to come up): it's heard at once, as in FL Studio.
      onPointerDown={(e) => e.button === 0 && onPlay()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPlay())}
    >
      <svg width={WAVE_W} height={WAVE_H} viewBox={`0 0 ${WAVE_W} ${WAVE_H}`} className="block" aria-hidden>
        <line x1={0} x2={WAVE_W} y1={mid} y2={mid} className="stroke-border" />
        <path d={path} className="fill-brand" />
        {/* Its loop, while it has one: the part that goes round, between its points. */}
        {loop?.enabled && (
          <g data-testid="loop-region">
            <rect x={loop.start * WAVE_W} y={0} width={(loop.end - loop.start) * WAVE_W} height={WAVE_H} className="fill-foreground/10" />
            <line x1={loop.start * WAVE_W} x2={loop.start * WAVE_W} y1={0} y2={WAVE_H} className="stroke-foreground" strokeWidth={1.5} />
            <line x1={loop.end * WAVE_W} x2={loop.end * WAVE_W} y1={0} y2={WAVE_H} className="stroke-foreground" strokeWidth={1.5} />
          </g>
        )}
      </svg>
    </button>
  );
}
