/**
 * The Signals window (the visualizer, docs/visualizer/README.md): the video's own signals, Trapcode Sound
 * Keys' way. A band is chosen on the spectrum at the playhead and shaped (gain, threshold, attack, release,
 * curve), with a meter of what it reads now; hits are placed at the playhead, on the beat or on the kicks,
 * quantised or cleared (and dragged on the timeline's signal lanes). Links and expressions use them by name.
 */
import { useRef, useState } from "react";
import { PiPlus, PiTrash, PiWaveform, PiMetronome } from "react-icons/pi";
import { MASTER, currentSignalReader, customSignalLevel, eventTimes, sourceHits } from "@shared/audio-signals";
import { createId } from "@shared/ids";
import { BAND_DEFAULTS, SIGNAL_COLORS, SIGNAL_ROLES, defineSignal, deleteSignal, setSignalEvents, uniqueSignalName } from "@shared/links";
import { projectDuration } from "@shared/timeline";
import type { Project, SignalDef, SignalEvent, SignalRole } from "@shared/types";
import { ScrubNumber } from "@/components/scrub-number";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FloatingWindow, centredOnDesktop } from "@/components/windows/floating-window";
import { EditGesture } from "@/lib/edit-gesture";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { SIGNALS_WINDOW, useSignalView } from "@/stores/signal-view";
import { useSignals } from "@/stores/signals";
import { cn } from "cn";
import { addEvent, quantizeEvents } from "./geometry";
import { Spectrum } from "./spectrum";

type Band = Extract<SignalDef, { kind: "band" }>;
type Hits = Extract<SignalDef, { kind: "events" }>;

const ROLE_LABELS: Record<SignalRole, string> = { kick: "Kick", snare: "Snare", hats: "Hats", bass: "Bass", vocal: "Vocal", lead: "Lead", mix: "Mix" };
const NO_ROLE = "none";

/** A new signal's colour: the next one along. */
const nextColour = (view: Project) => SIGNAL_COLORS[(view.signals?.length ?? 0) % SIGNAL_COLORS.length];

/** Edits to one signal: one-shot, or a gesture while a number is dragged. */
function useSignalEdits() {
  const gesture = useRef<EditGesture | null>(null);
  const write = (def: SignalDef) => (p: Project) => defineSignal(p, def);
  return {
    set: (def: SignalDef) => useEditor.getState().commit(write(def)),
    begin: () => {
      gesture.current = new EditGesture();
      gesture.current.begin();
    },
    change: (def: SignalDef) => {
      if (gesture.current) gesture.current.apply(write(def));
      else useEditor.getState().commit(write(def));
    },
    end: () => {
      gesture.current?.end();
      gesture.current = null;
    },
  };
}

export function SignalsWindow() {
  const open = useSignalView((s) => s.open);
  if (!open) return null;
  return <SignalsWindowBody />;
}

function SignalsWindowBody() {
  const [initial] = useState(() => ({ ...centredOnDesktop(720, 480, "video"), width: 720, height: 480 }));
  const view = useEditor((s) => s.project);
  const signals = view.signals ?? [];
  const selectedId = useSignalView((s) => s.selected);
  const selected = signals.find((d) => d.id === selectedId) ?? signals[0];
  const lanes = useSignalView((s) => s.lanes);
  const spectrograms = useSignalView((s) => s.spectrograms);

  const make = (kind: "band" | "events") => {
    const id = createId("sig");
    const taken = signals.map((d) => d.name);
    const def: SignalDef =
      kind === "band"
        ? { id, name: uniqueSignalName("Kick", taken), color: nextColour(view), role: "kick", kind: "band", source: MASTER, low: 40, high: 120, ...BAND_DEFAULTS, threshold: 0.35, onsets: true }
        : { id, name: uniqueSignalName("Hits", taken), color: nextColour(view), kind: "events", events: [] };
    useEditor.getState().commit((p) => defineSignal(p, def));
    useSignalView.getState().select(id);
  };

  return (
    <FloatingWindow
      id={SIGNALS_WINDOW}
      title="Signals"
      initial={initial}
      resizable={{ minWidth: 560, minHeight: 360 }}
      onClose={() => useSignalView.getState().close()}
    >
      <div className="flex h-full min-h-0 flex-col text-xs" data-signals-window>
        <div className="flex items-center gap-1.5 border-b px-3 py-2">
          <Button size="sm" variant="outline" onClick={() => make("band")}>
            <PiWaveform /> New band
          </Button>
          <Button size="sm" variant="outline" onClick={() => make("events")}>
            <PiMetronome /> New hits
          </Button>
          <label className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            Lanes on the timeline
            <Switch checked={lanes} onCheckedChange={(on) => useSignalView.getState().setLanes(on)} aria-label="Signal lanes on the timeline" />
          </label>
          <label className="ml-3 flex items-center gap-1.5 text-muted-foreground">
            Spectrograms
            <Switch checked={spectrograms} onCheckedChange={(on) => useSignalView.getState().setSpectrograms(on)} aria-label="Spectrograms on audio clips" />
          </label>
        </div>
        <div className="flex min-h-0 flex-1">
          <ul className="w-44 shrink-0 overflow-y-auto border-r p-1.5" aria-label="The video's signals">
            {signals.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  aria-current={d.id === selected?.id}
                  onClick={() => useSignalView.getState().select(d.id)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent/60",
                    d.id === selected?.id && "bg-accent",
                  )}
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <span className="text-[10px] text-muted-foreground">{d.kind === "band" ? "band" : d.kind === "events" ? "hits" : "curve"}</span>
                </button>
              </li>
            ))}
            {!signals.length && <li className="px-2 py-1.5 text-muted-foreground">No signals yet.</li>}
          </ul>
          <div className="min-w-0 flex-1 overflow-y-auto p-3">
            {selected ? (
              <SignalEditor key={selected.id} def={selected} view={view} />
            ) : (
              <p className="max-w-sm text-[13px] leading-snug text-muted-foreground">
                A signal is a sound of your own to react to: a band of frequencies of the song (a kick, a snare's crack, a voice), or hits you place.
                Links (the button by each stopwatch) and expressions (<code className="font-mono">signal("Kick")</code>) follow it by name.
              </p>
            )}
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}

function SignalEditor({ def, view }: { def: SignalDef; view: Project }) {
  const edits = useSignalEdits();
  const [name, setName] = useState(def.name);
  const rename = () => {
    const next = name.trim();
    if (next && next !== def.name) edits.set({ ...def, name: next });
    else setName(def.name);
  };
  return (
    <div className="space-y-3" data-signal-editor={def.id}>
      <div className="flex items-center gap-2">
        <span className="size-3 shrink-0 rounded-full" style={{ background: def.color }} />
        <Input
          aria-label="Signal name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="h-7 max-w-48 text-xs"
        />
        <Select value={def.role ?? NO_ROLE} onValueChange={(v) => edits.set({ ...def, role: v === NO_ROLE ? undefined : (v as SignalRole) })}>
          <SelectTrigger size="sm" className="w-28" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_ROLE}>No role</SelectItem>
            {SIGNAL_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-7"
          aria-label={`Delete ${def.name}`}
          onClick={() => {
            useEditor.getState().commit((p) => deleteSignal(p, def.id));
            useSignalView.getState().select(null);
          }}
        >
          <PiTrash />
        </Button>
      </div>
      {def.kind === "band" && <BandEditor def={def} view={view} edits={edits} />}
      {def.kind === "events" && <HitsEditor def={def} view={view} />}
      {def.kind === "curve" && <p className="text-muted-foreground">A recorded curve of {def.points.length} points.</p>}
      <LevelMeter def={def} />
    </div>
  );
}

const MS = { min: 0, max: 10_000, step: 5, decimals: 0, unit: "ms" };

function BandEditor({ def, view, edits }: { def: Band; view: Project; edits: ReturnType<typeof useSignalEdits> }) {
  const sequenceId = useEditor((s) => s.sequenceId);
  // A drag across the spectrum is one undo step.
  const rangeGesture = useRef(false);
  const field = (title: string, value: number, display: { min: number; max: number; step: number; decimals: number; unit?: string }, set: (v: number) => SignalDef) => (
    <label className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{title}</span>
      <ScrubNumber value={value} display={display} label={`${def.name} ${title}`} onBegin={edits.begin} onChange={(v) => edits.change(set(v))} onEnd={edits.end} />
    </label>
  );
  const audioTracks = view.tracks.filter((t) => t.kind === "audio");
  const source = def.source.kind === "track" ? `t:${def.source.trackId}` : "master";
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Listens to</span>
        <Select
          value={source}
          onValueChange={(v) => edits.set({ ...def, source: v.startsWith("t:") ? { kind: "track", trackId: v.slice(2) } : MASTER })}
        >
          <SelectTrigger size="sm" className="w-40" aria-label={`${def.name} listens to`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="master">The mix</SelectItem>
            {audioTracks.map((t) => (
              <SelectItem key={t.id} value={`t:${t.id}`}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Spectrum
        source={def.source}
        sequenceId={sequenceId}
        low={def.low}
        high={def.high}
        onRange={(range) => {
          if (!rangeGesture.current) edits.begin();
          rangeGesture.current = true;
          edits.change({ ...def, ...range });
        }}
        onRangeEnd={() => {
          rangeGesture.current = false;
          edits.end();
        }}
      />
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 lg:grid-cols-3">
        {field("Low", def.low, { min: 20, max: 20_000, step: 1, decimals: 0, unit: "Hz" }, (v) => ({ ...def, low: Math.min(v, def.high - 1) }))}
        {field("High", def.high, { min: 20, max: 20_000, step: 1, decimals: 0, unit: "Hz" }, (v) => ({ ...def, high: Math.max(v, def.low + 1) }))}
        {field("Gain", def.gain, { min: -24, max: 24, step: 0.5, decimals: 1, unit: "dB" }, (v) => ({ ...def, gain: v }))}
        {field("Threshold", def.threshold * 100, { min: 0, max: 99, step: 1, decimals: 0, unit: "%" }, (v) => ({ ...def, threshold: v / 100 }))}
        {field("Attack", def.attack * 1000, MS, (v) => ({ ...def, attack: v / 1000 }))}
        {field("Release", def.release * 1000, MS, (v) => ({ ...def, release: v / 1000 }))}
        {field("Curve", def.curve, { min: 0.1, max: 10, step: 0.05, decimals: 2 }, (v) => ({ ...def, curve: v }))}
      </div>
      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-muted-foreground" title="1 is as loud as the sound's own loud parts (a quiet song reacts as much as a loud one)">
          <Switch checked={def.autoGain} onCheckedChange={(on) => edits.set({ ...def, autoGain: on })} aria-label={`${def.name} auto-gain`} />
          Auto-gain
        </label>
        <label className="flex items-center gap-2 text-muted-foreground" title="A hit each time it rises out of silence: for punches and flashes">
          <Switch checked={def.onsets} onCheckedChange={(on) => edits.set({ ...def, onsets: on })} aria-label={`${def.name} onsets`} />
          Hits where it starts
        </label>
      </div>
    </>
  );
}

function HitsEditor({ def, view }: { def: Hits; view: Project }) {
  const write = (events: SignalEvent[]) => useEditor.getState().commit((p) => setSignalEvents(p, def.id, events));
  const reader = currentSignalReader();
  const length = projectDuration(view);
  const times = (kind: "beats" | "bars") => (reader ? eventTimes(reader, null, MASTER, kind, 0, length) : []);
  const beats = times("beats");
  const fill = (hits: [number, number][]) => write([...def.events, ...hits.map(([time, velocity]) => ({ time, velocity }))].sort((a, b) => a.time - b.time));
  return (
    <>
      <p className="text-muted-foreground" data-hit-count={def.events.length}>
        {def.events.length} {def.events.length === 1 ? "hit" : "hits"}
        {def.events.length ? `, from ${def.events[0].time.toFixed(2)} s to ${def.events.at(-1)!.time.toFixed(2)} s` : ""}. Drag them on the timeline's lane;
        double-click the lane to add one.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => write(addEvent(def.events, usePlayback.getState().time))}>
          <PiPlus /> At the playhead
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={!reader}>
              Fill…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={!beats.length} onSelect={() => fill(beats.map((t) => [t, 1]))}>
              On every beat
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!beats.length} onSelect={() => fill(times("bars").map((t) => [t, 1]))}>
              On every bar
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!reader} onSelect={() => reader && fill(sourceHits(reader, null, MASTER, "onsetLow").map(([t, v]) => [t, v]))}>
              On the kicks
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!reader} onSelect={() => reader && fill(sourceHits(reader, null, MASTER, "onsetHigh").map(([t, v]) => [t, v]))}>
              On the hats
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={!def.events.length || beats.length < 2}>
              Quantise…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {[
              [1, "To beats"],
              [2, "To eighths"],
              [4, "To sixteenths"],
            ].map(([n, label]) => (
              <DropdownMenuItem key={n} onSelect={() => write(quantizeEvents(def.events, beats, n as number))}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" variant="ghost" disabled={!def.events.length} onClick={() => write([])}>
          Clear
        </Button>
      </div>
    </>
  );
}

/** What the signal reads at the playhead, 0..1 (with a band's threshold marked). */
function LevelMeter({ def }: { def: SignalDef }) {
  const time = usePlayback((s) => s.time);
  const sequenceId = useEditor((s) => s.sequenceId);
  useSignals((s) => s.data);
  const reader = currentSignalReader();
  const level = reader ? customSignalLevel(reader, def, sequenceId, time) : 0;
  return (
    <div className="space-y-1" data-signal-meter>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%`, background: def.color }} />
      </div>
      <p className="text-[10px] text-muted-foreground tabular-nums">Now {Math.round(level * 100)}%</p>
    </div>
  );
}
