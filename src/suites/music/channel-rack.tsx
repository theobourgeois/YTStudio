import { memo, useEffect, useRef, useState } from "react";
import { PiChartBar, PiPlus, PiWarning } from "react-icons/pi";
import { cn } from "cn";
import { clamp } from "@shared/math";
import {
  channelNotes,
  cloneChannel,
  drawSteps,
  fillSteps,
  removeChannel,
  setPatternSteps,
  setStepNote,
  setSteps,
  setSwing,
  stepNotes,
  updateChannel,
} from "@shared/music/edits";
import { DEFAULT_VELOCITY, DEFAULT_VOLUME, stepsPerBar } from "@shared/music/project";
import { type Channel, type Note, PPQ, ROOT_PITCH, STEP_TICKS } from "@shared/music/types";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { startPointerDrag } from "@/lib/pointer-drag";
import { ChannelSettings } from "./channel-settings";
import { SongKnob, panText, percent } from "./knob";
import { songGesture, useCurrentPattern, useMusic, useSong } from "./store";
import { tickNow, useTransport } from "./transport";

/** A step's width and the gaps between steps and between beats (px): the header, rows and graph share them. */
const STEP_W = 20;
const STEP_GAP = 2;
const BEAT_GAP = 5;
/** Steps to a beat, as the rack groups them. */
const GROUP = 4;
/** How far the graph editor's pitch bars reach, in semitones either side of the sample's own pitch. */
const GRAPH_PITCH_RANGE = 12;

const stepLeft = (step: number) => step * (STEP_W + STEP_GAP) + Math.floor(step / GROUP) * BEAT_GAP;
const stepsWidth = (steps: number) => stepLeft(steps - 1) + STEP_W;
/** FL Studio's rack alternates two colours, beat by beat. */
const oddBeat = (step: number) => Math.floor(step / GROUP) % 2 === 1;

/** The step under a point, within the rack row (or graph) `root` belongs to. */
function stepAt(root: Element, x: number, y: number): number | null {
  const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-step]");
  return hit && root.contains(hit) ? Number(hit.dataset.step) : null;
}

/**
 * The channel rack (FL Studio's): a row per channel with its mute light, pan and volume, its button
 * (which opens its settings) and the current pattern's steps. The graph editor, under the rows, edits
 * the selected channel's steps' velocity and pitch.
 */
export function ChannelRack() {
  const channels = useSong((song) => song.channels);
  const steps = useCurrentPattern((pattern) => pattern.steps);
  const [graph, setGraph] = useState(false);
  const selectedId = useMusic((s) => s.selectedChannelId);
  const selected = channels.find((c) => c.id === selectedId) ?? channels[0];
  const file = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);

  const addFiles = (files: FileList | null) => {
    const audio = [...(files ?? [])].filter((f) => f.type.startsWith("audio/") || /\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(f.name));
    if (audio.length) void useMusic.getState().addSamples(audio);
  };

  return (
    <div
      className={cn("flex flex-col gap-2", dropping && "rounded-lg ring-2 ring-brand/60")}
      data-testid="channel-rack"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <RackHeader steps={steps} graph={graph} onGraph={setGraph} />

      {channels.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">No channels yet. Start with four drums, or bring your own samples.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void useMusic.getState().addStarterKit()}>
              Add starter kit
            </Button>
            <Button size="sm" variant="outline" onClick={() => file.current?.click()}>
              Add samples…
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1 overflow-x-auto pb-1" role="list" aria-label="Channels">
          {channels.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} selected={channel.id === selected?.id} />
          ))}
        </div>
      )}

      {graph && selected && <GraphEditor channel={selected} />}

      {channels.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => file.current?.click()}>
            <PiPlus />
            Add samples
          </Button>
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept="audio/*"
        multiple
        className="hidden"
        data-testid="add-samples"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Width of everything left of the steps in a row, so the header's lights line up with them. */
const LEAD = "w-[252px]";

function RackHeader({ steps, graph, onGraph }: { steps: number; graph: boolean; onGraph: (on: boolean) => void }) {
  const swing = useSong((song) => song.settings.swing);
  const bar = useSong((song) => stepsPerBar(song.settings.timeSignature));
  const patternId = useCurrentPattern((pattern) => pattern.id);
  const lengths = [...new Set([bar, bar * 2, bar * 4, bar * 8, steps])].sort((a, b) => a - b);

  return (
    <div className="flex items-end">
      <div className={cn("flex shrink-0 items-center gap-2", LEAD)}>
        <div className="flex items-center gap-1.5">
          <SongKnob label="Swing" value={swing} min={0} max={1} defaultValue={0} format={percent} edit={setSwing} />
          <span className="text-[11px] text-muted-foreground">Swing</span>
        </div>
        <Select value={String(steps)} onValueChange={(value) => useMusic.getState().commit((song) => setPatternSteps(song, patternId, Number(value)))}>
          <SelectTrigger size="sm" className="h-7 gap-1 px-2 text-xs" aria-label="Pattern length">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {lengths.map((length) => (
              <SelectItem key={length} value={String(length)}>
                {length % bar === 0 ? `${length / bar} bar${length === bar ? "" : "s"}` : `${length} steps`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Toggle size="sm" className="ml-auto h-7 px-2" pressed={graph} onPressedChange={onGraph} aria-label="Graph editor" title="Graph editor: velocity and pitch of each step">
          <PiChartBar />
        </Toggle>
      </div>
      <StepLights steps={steps} />
    </div>
  );
}

/** A light per step above the rows; the one playing is lit. */
function StepLights({ steps }: { steps: number }) {
  const tempo = useSong((song) => song.settings.tempo);
  const playing = useTransport((s) => s.playing);
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (!playing) {
      setStep(null);
      return;
    }
    let frame = 0;
    const draw = () => {
      const tick = tickNow(useTransport.getState(), performance.now(), tempo, PPQ, steps * STEP_TICKS);
      setStep(tick === null ? null : Math.floor(tick / STEP_TICKS));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing, tempo, steps]);

  return (
    <div className="relative ml-2 h-2 shrink-0" style={{ width: stepsWidth(steps) }} data-playing-step={step ?? undefined} aria-hidden>
      {Array.from({ length: steps }, (_, i) => (
        <span
          key={i}
          className={cn("absolute top-0 h-1 rounded-full", i === step ? "bg-brand" : i % GROUP === 0 ? "bg-foreground/25" : "bg-foreground/10")}
          style={{ left: stepLeft(i), width: STEP_W }}
        />
      ))}
    </div>
  );
}

const EMPTY: Note[] = [];

const ChannelRow = memo(function ChannelRow({ channel, selected }: { channel: Channel; selected: boolean }) {
  const patternId = useCurrentPattern((pattern) => pattern.id);
  const unreadable = useTransport((s) => s.unreadable.includes(channel.id));
  const [settings, setSettings] = useState(false);
  const commit = useMusic.getState().commit;
  const id = channel.id;

  return (
    <div className="flex items-center" role="listitem" data-channel={id} data-channel-name={channel.name}>
      <div className={cn("flex shrink-0 items-center gap-1.5", LEAD)}>
        <button
          type="button"
          aria-label={channel.muted ? `Unmute ${channel.name}` : `Mute ${channel.name}`}
          aria-pressed={!channel.muted}
          title={channel.muted ? "Muted" : "Mute"}
          className={cn("size-3 shrink-0 rounded-full border transition-colors", channel.muted ? "border-border bg-muted" : "border-emerald-600/50 bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/60")}
          onClick={() => commit((song) => updateChannel(song, id, { muted: !channel.muted }))}
        />
        <SongKnob label="Pan" value={channel.pan} min={-1} max={1} defaultValue={0} bipolar format={panText} edit={(song, pan) => updateChannel(song, id, { pan })} />
        <SongKnob label="Volume" value={channel.volume} min={0} max={1} defaultValue={DEFAULT_VOLUME} format={percent} edit={(song, volume) => updateChannel(song, id, { volume })} />

        <Popover open={settings} onOpenChange={setSettings}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border bg-secondary px-2 text-left text-xs font-medium shadow-xs hover:bg-accent dark:border-white/[0.07]",
                    channel.muted && "text-muted-foreground",
                    !channel.sampleId && "italic",
                  )}
                  title={`${channel.name}: settings`}
                  onClick={() => useMusic.getState().selectChannel(id)}
                >
                  <span className="truncate">{channel.name}</span>
                  {(unreadable || !channel.sampleId) && <PiWarning className="ml-auto size-3.5 shrink-0 text-amber-500" aria-label="No sample to play" />}
                </button>
              </PopoverTrigger>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => setSettings(true)}>Channel settings…</ContextMenuItem>
              <ContextMenuItem disabled={!channel.sampleId} onSelect={() => useTransport.getState().audition(id)}>
                Hear it
              </ContextMenuItem>
              <ContextMenuSeparator />
              {[2, 4, 8].map((every) => (
                <ContextMenuItem key={every} onSelect={() => commit((song) => fillSteps(song, patternId, id, every))}>
                  Fill each {every} steps
                </ContextMenuItem>
              ))}
              <ContextMenuItem onSelect={() => commit((song) => drawSteps(song, patternId, id, "-"))}>Clear steps</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => commit((song) => cloneChannel(song, id))}>Clone</ContextMenuItem>
              <ContextMenuItem variant="destructive" onSelect={() => commit((song) => removeChannel(song, id))}>
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <PopoverContent align="start" className="w-80">
            <ChannelSettings channel={channel} />
          </PopoverContent>
        </Popover>

        <button
          type="button"
          aria-label={`Select ${channel.name}`}
          aria-pressed={selected}
          title="Select (the graph editor shows the selected channel)"
          className={cn("h-7 w-2 shrink-0 rounded-sm", selected ? "bg-emerald-400" : "bg-muted hover:bg-muted-foreground/30")}
          onClick={() => useMusic.getState().selectChannel(id)}
        />
      </div>
      <StepRow channelId={id} name={channel.name} />
    </div>
  );
});

/** A channel's steps in the current pattern: click to toggle, drag to paint, right-click to clear. */
function StepRow({ channelId, name }: { channelId: string; name: string }) {
  const steps = useCurrentPattern((pattern) => pattern.steps);
  const patternId = useCurrentPattern((pattern) => pattern.id);
  const notes = useCurrentPattern((pattern) => pattern.notes[channelId] ?? EMPTY);
  const on = new Set(notes.filter((n) => n.start % STEP_TICKS === 0).map((n) => n.start / STEP_TICKS));
  const gesture = useRef(songGesture()).current;

  return (
    <div
      className="relative ml-2 h-7 shrink-0 touch-none"
      style={{ width: stepsWidth(steps) }}
      role="group"
      aria-label={`${name} steps`}
      onPointerDown={(e) => {
        const root = e.currentTarget;
        const first = stepAt(root, e.clientX, e.clientY);
        if (first === null) return;
        // The first step decides: pressing an empty one paints, pressing a lit one erases.
        const paint = !on.has(first);
        useMusic.getState().selectChannel(channelId);
        gesture.begin();
        gesture.apply((song) => setSteps(song, patternId, channelId, [first], paint));
        const started = startPointerDrag(e, {
          threshold: 0,
          onMove(ev) {
            const step = stepAt(root, ev.clientX, ev.clientY);
            if (step !== null) gesture.apply((song) => setSteps(song, patternId, channelId, [step], paint));
          },
          onEnd: () => gesture.end(),
          onClick: () => gesture.end(),
          onCancel: () => gesture.cancel(),
        });
        if (!started) gesture.end();
      }}
      onContextMenu={(e) => {
        const step = stepAt(e.currentTarget, e.clientX, e.clientY);
        if (step === null) return;
        e.preventDefault();
        useMusic.getState().commit((song) => setSteps(song, patternId, channelId, [step], false));
      }}
    >
      {Array.from({ length: steps }, (_, step) => (
        <button
          key={step}
          type="button"
          data-step={step}
          aria-label={`${name} step ${step + 1}`}
          aria-pressed={on.has(step)}
          className={cn(
            "absolute top-0 h-7 rounded-[3px] border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 dark:border-white/5",
            on.has(step)
              ? oddBeat(step)
                ? "bg-rose-400 dark:bg-rose-300"
                : "bg-foreground/80"
              : oddBeat(step)
                ? "bg-rose-500/20 hover:bg-rose-500/30"
                : "bg-muted-foreground/20 hover:bg-muted-foreground/30",
          )}
          style={{ left: stepLeft(step), width: STEP_W }}
          // The row's pointer handler does the work (so a drag paints); keys toggle one step.
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            useMusic.getState().commit((song) => setSteps(song, patternId, channelId, [step], !on.has(step)));
          }}
        />
      ))}
    </div>
  );
}

type GraphMode = "velocity" | "pitch";

/** The graph editor: a bar per step of the selected channel, dragged to set its velocity or pitch. */
function GraphEditor({ channel }: { channel: Channel }) {
  const [mode, setMode] = useState<GraphMode>("velocity");
  const steps = useCurrentPattern((pattern) => pattern.steps);
  const patternId = useCurrentPattern((pattern) => pattern.id);
  // Select the pattern (the same object until it's edited), not what's made from it: a selector must return the same thing twice.
  const pattern = useCurrentPattern((current) => current);
  const byStep = channelNotes(pattern, channel.id).length ? stepNotes(pattern, channel.id) : null;
  const gesture = useRef(songGesture()).current;
  const HEIGHT = 64;

  /** The value a pointer height means: the top is full velocity, or an octave up. */
  const valueAt = (root: HTMLElement, y: number) => {
    const level = clamp(1 - (y - root.getBoundingClientRect().top) / HEIGHT, 0, 1);
    return mode === "velocity" ? { velocity: level } : { pitch: ROOT_PITCH + Math.round((level * 2 - 1) * GRAPH_PITCH_RANGE) };
  };

  return (
    <div className="flex items-start" data-testid="graph-editor">
      <div className={cn("flex shrink-0 flex-col gap-1.5 pr-2", LEAD)}>
        <p className="truncate text-xs font-medium">{channel.name}</p>
        <Select value={mode} onValueChange={(value) => setMode(value as GraphMode)}>
          <SelectTrigger size="sm" className="h-7 w-32 px-2 text-xs" aria-label="Graph shows">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="velocity">Velocity</SelectItem>
            <SelectItem value="pitch">Pitch</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div
        className="relative ml-2 shrink-0 cursor-ns-resize touch-none rounded-md bg-muted/50"
        style={{ width: stepsWidth(steps), height: HEIGHT }}
        onPointerDown={(e) => {
          const root = e.currentTarget;
          const set = (x: number, y: number) => {
            const step = stepAt(root, x, y);
            if (step !== null) gesture.apply((song) => setStepNote(song, patternId, channel.id, step, valueAt(root, y)));
          };
          gesture.begin();
          set(e.clientX, e.clientY);
          const started = startPointerDrag(e, {
            threshold: 0,
            onMove: (ev) => set(ev.clientX, ev.clientY),
            onEnd: () => gesture.end(),
            onClick: () => gesture.end(),
            onCancel: () => gesture.cancel(),
          });
          if (!started) gesture.end();
        }}
      >
        {mode === "pitch" && <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-foreground/15" />}
        {Array.from({ length: steps }, (_, step) => {
          const note = byStep?.[step] ?? null;
          const level = !note ? 0 : mode === "velocity" ? note.velocity : clamp((note.pitch - ROOT_PITCH) / GRAPH_PITCH_RANGE, -1, 1) / 2 + 0.5;
          const text = !note ? "No note" : mode === "velocity" ? percent(note.velocity) : `${note.pitch - ROOT_PITCH > 0 ? "+" : ""}${note.pitch - ROOT_PITCH} st`;
          return (
            <div key={step} data-step={step} data-level={note ? Math.round(level * 100) : undefined} title={text} className="absolute inset-y-0" style={{ left: stepLeft(step), width: STEP_W }}>
              {note &&
                (mode === "velocity" ? (
                  <span className={cn("absolute inset-x-0.5 bottom-0 rounded-t-sm", note.velocity === DEFAULT_VELOCITY ? "bg-brand/70" : "bg-brand")} style={{ height: `${level * 100}%` }} />
                ) : (
                  <span className="absolute inset-x-0.5 h-1 -translate-y-1/2 rounded-sm bg-brand" style={{ top: `${(1 - level) * 100}%` }} />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
