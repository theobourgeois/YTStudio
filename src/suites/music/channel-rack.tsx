import { type RefObject, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PiCaretDownBold, PiCaretRightFill, PiChartBar, PiPlugs, PiSpinnerGap, PiWarning, PiWaveform } from "react-icons/pi";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { soundingChannels } from "@shared/music/compile";
import { type StepPatch, drawSteps, fillSteps, lengthOf, setPatternLength, setStepNotes, setSteps, setSwing, stepNotes, updateChannel } from "@shared/music/edits";
import { DEFAULT_VELOCITY, DEFAULT_VOLUME, MAX_STEPS, stepsPerBar } from "@shared/music/project";
import { type Channel, type MusicProject, type Note, ROOT_PITCH, STEP_TICKS } from "@shared/music/types";
import {
  ContextMenu,
  ContextMenuCell,
  ContextMenuCheckboxItem,
  ContextMenuColumns,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import { startPointerDrag } from "@/lib/pointer-drag";
import { audioFiles, carriesSamples, dropAsChannels, dropOnChannel } from "./browser/drops";
import { ChannelPicker, InstrumentPicker } from "./channel-picker";
import { openPianoRoll } from "./piano/actions";
import { PERCENT, SongKnob, panText, percent } from "./knob";
import { Lcd } from "./lcd";
import {
  assignFreeTracks,
  cloneSelected,
  copySteps,
  cutSteps,
  deleteChannels,
  deleteSelected,
  moveChannel,
  moveSelected,
  muteSelected,
  pasteSteps,
  replaceInstrument,
  rotate,
  selectRange,
  shownSteps,
  solo,
  toggleMute,
} from "./rack-actions";
import { currentPattern, songGesture, useCurrentPattern, useMusic, useSong } from "./store";
import { patternPositionNow } from "./playhead";
import { useTransport } from "./transport";
import { MIN_RACK_STEPS, type RackGroup, inRackGroup, selectedIn, useMusicUi } from "./ui";
import { chooseSource, openPlaylist } from "./playlist/actions";
import { usePlaylist } from "./playlist/store";
import { TrackSelector } from "./mixer/track-selector";
import { MusicWindow } from "./window";

/** A step's width and the gaps between steps and between beats (px): the lights, rows and graph share them. */
const STEP_W = 14;
const STEP_GAP = 2;
const BEAT_GAP = 4;
/** Steps to a beat, as the rack groups them. */
const GROUP = 4;
/** A row's height and the gap between rows (px): the two columns line up by these. */
const ROW_H = 24;
const ROW_GAP = 3;
/** The widest the rack is dragged (past this, the steps scroll). */
const MAX_DRAGGED_STEPS = 64;
/** How far the graph editor's note bars reach, in semitones either side of the sample's own pitch. */
const GRAPH_PITCH_RANGE = 12;
const GRAPH_HEIGHT = 64;
/** The strip of step lights above the rows. */
const LIGHTS_H = 5;

const stepLeft = (step: number) => step * (STEP_W + STEP_GAP) + Math.floor(step / GROUP) * BEAT_GAP;
const stepsWidth = (steps: number) => stepLeft(steps - 1) + STEP_W;
/** FL Studio's rack alternates two colours, beat by beat. */
const oddBeat = (step: number) => Math.floor(step / GROUP) % 2 === 1;
/** Width of everything left of the steps in a row, with the mixer track selectors (Alt+M) and without. */
const LEAD = "w-[212px]";
const LEAD_WITH_TRACK = "w-[246px]";

/** The element with `[data-<key>]` under a point, if it's inside `root`. */
function under(root: Element, x: number, y: number, key: string): HTMLElement | null {
  const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[data-${key}]`);
  return hit && root.contains(hit) ? hit : null;
}
/**
 * Where a file dragged over the rack would go: the index of the channel it goes before (the end past the
 * last) and the line to draw there, in the rack's coordinates. Null over a channel's button, which takes
 * the file itself (it replaces that channel's sample).
 */
function dropPlace(rack: HTMLElement, target: EventTarget, y: number): { index: number; top: number } | null {
  if ((target as Element).closest?.("[data-channel-button]")) return null;
  const rows = [...rack.querySelectorAll<HTMLElement>("[data-channel]")];
  const origin = rack.getBoundingClientRect().top;
  let index = rows.findIndex((row) => {
    const box = row.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
  if (index < 0) index = rows.length;
  if (!rows.length) return { index, top: LIGHTS_H };
  const edge = index < rows.length ? rows[index].getBoundingClientRect().top - ROW_GAP / 2 : rows[rows.length - 1].getBoundingClientRect().bottom + ROW_GAP / 2;
  return { index, top: edge - origin };
}

const stepAt = (root: Element, x: number, y: number) => {
  const hit = under(root, x, y, "step");
  return hit ? Number(hit.dataset.step) : null;
};

/** The channels making a sound now, while the song plays (their selectors light up); updated a frame at a time, only when it changes. */
function useSoundingChannels(): ReadonlySet<string> {
  const playing = useTransport((s) => s.playing);
  const [sounding, setSounding] = useState<ReadonlySet<string>>(NONE_SOUNDING);
  useEffect(() => {
    if (!playing) {
      setSounding(NONE_SOUNDING);
      return;
    }
    let frame = 0;
    let key = "";
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const { history, patternId } = useMusic.getState();
      if (!history) return;
      const song = history.doc;
      const tick = patternPositionNow();
      const next = tick === null ? NONE_SOUNDING : soundingChannels(song, currentPattern(song, patternId), tick);
      const nextKey = [...next].join(",");
      if (nextKey !== key) {
        key = nextKey;
        setSounding(next);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  return sounding;
}
const NONE_SOUNDING: ReadonlySet<string> = new Set();

/** How many steps the rack shows now. */
function useShownSteps(): number {
  const rackSteps = useMusicUi((s) => s.rackSteps);
  return useMusic((s) => shownSteps(s.history!.doc, s.patternId, rackSteps));
}

/**
 * The channel rack (FL Studio's, see `docs/fl-studio/channel-rack.md`), a window: a row per channel
 * with its mute light, pan and volume, its button (which opens its settings window), its selector and
 * the current pattern's steps. Left-click turns steps on and right-click turns them off; both paint
 * when dragged. Its right edge is dragged to show more steps.
 */
export function ChannelRack() {
  const allChannels = useSong((song) => song.channels);
  const group = useMusicUi((s) => s.rackGroup);
  const channels = allChannels.filter((c) => inRackGroup(c, group));
  const steps = useShownSteps();
  const graph = useMusicUi((s) => s.graphOpen);
  const selectedIdsNow = useMusicUi((s) => s.selectedChannelIds);
  const sounding = useSoundingChannels();
  const lead = useMusicUi((s) => s.trackSelectorsShown) ? LEAD_WITH_TRACK : LEAD;
  const selected = selectedIn({ channels } as MusicProject, selectedIdsNow);
  const file = useRef<HTMLInputElement>(null);
  const [drop, setDrop] = useState<{ index: number; top: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const room = useStepsRoom(scroller);

  return (
    <MusicWindow
      id="rack"
      title="Channel rack"
      initial={{ x: 16, y: 16 }}
      onClose={() => useMusicUi.getState().setRackOpen(false)}
      menu={<RackMenu onAddSamples={() => file.current?.click()} />}
      controls={
        <>
          <GroupMenu group={group} />
          <RackControls graph={graph} />
        </>
      }
    >
      <div
        className="relative flex flex-col gap-1.5 px-2.5 pt-1.5 pb-2 pr-3.5"
        data-testid="channel-rack"
        // Seen before a channel's button takes it, so the line goes away over one.
        onDragOverCapture={(e) => {
          if (!carriesSamples(e.dataTransfer)) return;
          const next = dropPlace(e.currentTarget, e.target, e.clientY);
          if (next?.index !== drop?.index || next?.top !== drop?.top) setDrop(next);
        }}
        onDragOver={(e) => {
          if (carriesSamples(e.dataTransfer)) e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
        }}
        onDrop={(e) => {
          // A file dropped on the rack (but not on a channel's button, which takes it) is a new channel,
          // between the channels it was dropped between; several files, a channel each.
          if (!carriesSamples(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          const at = dropPlace(e.currentTarget, e.target, e.clientY)?.index;
          setDrop(null);
          // What's dropped is what's worked on next: the new channels are selected.
          void dropAsChannels(e.dataTransfer, at).then((ids) => ids.length && useMusicUi.getState().setSelection(ids));
        }}
      >
        {drop && (
          <div
            aria-hidden
            data-testid="rack-drop-line"
            className="pointer-events-none absolute inset-x-2 z-10 h-0.5 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_4px] shadow-brand"
            style={{ top: drop.top }}
          />
        )}
        <div className="flex">
          <div className={cn("flex shrink-0 flex-col", lead)} style={{ gap: ROW_GAP, paddingTop: LIGHTS_H + ROW_GAP }} role="list" aria-label="Channels">
            {channels.map((channel) => (
              <ChannelLead key={channel.id} channel={channel} selected={selectedIdsNow.includes(channel.id)} sounding={sounding.has(channel.id)} />
            ))}
          </div>
          <div ref={scroller} className="ml-1.5 overflow-x-auto pb-1" style={{ maxWidth: `min(62vw, ${room}px)` }} data-testid="rack-steps">
            <div className="flex flex-col" style={{ gap: ROW_GAP, width: stepsWidth(steps) }}>
              <StepLights steps={steps} />
              {channels.map((channel) =>
                channel.kind === "audio" ? (
                  <AudioRow key={channel.id} channelId={channel.id} name={channel.name} steps={steps} />
                ) : (
                  <StepRow key={channel.id} channelId={channel.id} name={channel.name} steps={steps} />
                ),
              )}
              {graph && (selected[0] ?? channels[0]) && (selected[0] ?? channels[0]).kind !== "audio" && <GraphEditor channel={selected[0] ?? channels[0]} steps={steps} />}
            </div>
          </div>
        </div>

        <div className={cn("flex justify-center", lead)}>
          <ChannelPicker />
        </div>
        <input
          ref={file}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          data-testid="add-samples"
          onChange={(e) => {
            const audio = audioFiles(e.target.files);
            if (audio.length) void useMusic.getState().addSamples(audio);
            e.target.value = "";
          }}
        />
        {channels.length > 0 && <ResizeEdge steps={steps} />}
      </div>
    </MusicWindow>
  );
}

/** The steps' widest (px), and narrowest however little room is left. */
const MAX_STEPS_ROOM = 1180;
const MIN_STEPS_ROOM = 160;
/** What's right of the steps in the window: the content's padding and the window's edge. */
const RIGHT_OF_STEPS = 18;

/**
 * How wide the steps can be: up to the desktop's right edge from where they start, so the end of a long
 * pattern can always be scrolled to (the window fits what's in it, and the desktop hides what's past its
 * edge: with the Browser open or the page zoomed in, 62vw went past it). Measured again when the window
 * moves and when the desktop changes size.
 */
function useStepsRoom(scroller: RefObject<HTMLDivElement | null>): number {
  const place = useMusicUi((s) => s.places.rack);
  const [room, setRoom] = useState(MAX_STEPS_ROOM);
  useLayoutEffect(() => {
    const element = scroller.current;
    const desk = element?.closest("[data-desktop]");
    if (!element || !desk) return;
    const measure = () => {
      const space = desk.getBoundingClientRect().right - element.getBoundingClientRect().left - RIGHT_OF_STEPS;
      setRoom(Math.round(clamp(space, MIN_STEPS_ROOM, MAX_STEPS_ROOM)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(desk);
    return () => observer.disconnect();
  }, [scroller, place]);
  return room;
}

const GROUPS: { id: RackGroup; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unsorted", label: "Unsorted" },
  { id: "audio", label: "Audio" },
];

/**
 * FL Studio's group filter, on the title bar: Unsorted (every channel but the audio clips', the default),
 * Audio (theirs), or All (Théo).
 */
function GroupMenu({ group }: { group: RackGroup }) {
  const label = GROUPS.find((g) => g.id === group)!.label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Channel group"
          title="Which channels the rack shows: Unsorted (instruments and samples), Audio (the playlist's audio clips), or All"
          className="sunken flex h-5.5 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {label}
          <PiCaretDownBold className="size-2.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={group} onValueChange={(value) => useMusicUi.getState().setRackGroup(value as RackGroup)}>
          {GROUPS.map((g) => (
            <DropdownMenuRadioItem key={g.id} value={g.id}>
              {g.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An audio clip's channel in the rack: no steps (it plays from the playlist), a strip that shows its clips there. */
function AudioRow({ channelId, name, steps }: { channelId: string; name: string; steps: number }) {
  return (
    <button
      type="button"
      aria-label={`${name}: an audio clip, played from the playlist`}
      title="An audio clip: it plays from the playlist. Click to draw it there"
      data-audio-row={channelId}
      className="sunken flex shrink-0 items-center gap-1.5 rounded-[2px] px-2 text-[11px] text-muted-foreground hover:text-foreground"
      style={{ width: stepsWidth(steps), height: ROW_H }}
      onClick={() => {
        chooseSource({ kind: "audio", ref: channelId });
        openPlaylist();
      }}
    >
      <PiWaveform className="size-3.5 shrink-0" />
      <span className="truncate">Audio clip: plays from the playlist</span>
    </button>
  );
}

/** The rack's right edge: dragged to show more steps, or fewer (never fewer than the pattern has). */
function ResizeEdge({ steps }: { steps: number }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to show more steps"
      title="Drag to show more steps"
      className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none hover:bg-brand/30"
      onPointerDown={(e) => {
        const origin = e.clientX;
        startPointerDrag(e, {
          threshold: 2,
          cursor: "ew-resize",
          onMove(ev) {
            const added = Math.round((ev.clientX - origin) / (STEP_W + STEP_GAP + BEAT_GAP / GROUP));
            useMusicUi.getState().setRackSteps(clamp(steps + added, MIN_RACK_STEPS, MAX_DRAGGED_STEPS));
          },
        });
      }}
    />
  );
}

/** The window's menu (the arrow at its top-left): what's done to the selected channels, and adding some. */
function RackMenu({ onAddSamples }: { onAddSamples: () => void }) {
  const none = useMusicUi((s) => s.selectedChannelIds.length === 0);
  const selectorsShown = useMusicUi((s) => s.trackSelectorsShown);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Channel rack menu" className="text-muted-foreground hover:text-foreground">
          <PiCaretRightFill />
        </Button>
      </DropdownMenuTrigger>
      {/* A window it opened (Transpose selected) keeps the focus its field took. */}
      <DropdownMenuContent align="start" onCloseAutoFocus={(e) => useMusicUi.getState().transposeOpen && e.preventDefault()}>
        <DropdownMenuItem onSelect={onAddSamples}>Add samples…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void useMusic.getState().addStarterKit()}>Add starter kit</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={none} onSelect={cloneSelected}>
          Clone selected <DropdownMenuShortcut>⌥C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={none} onSelect={deleteSelected}>
          Delete selected <DropdownMenuShortcut>⌥⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={none} onSelect={() => moveSelected(-1)}>
          Move selected up <DropdownMenuShortcut>⌥↑</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={none} onSelect={() => moveSelected(1)}>
          Move selected down <DropdownMenuShortcut>⌥↓</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={none}
          onSelect={() => {
            // The rack's channels, not the patterns the Playlist's Picker last transposed.
            usePlaylist.setState({ transposing: null });
            useMusicUi.getState().setTransposeOpen(true);
          }}
        >
          Transpose selected…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={none} onSelect={() => muteSelected(true)}>
          Mute selected
        </DropdownMenuItem>
        <DropdownMenuItem disabled={none} onSelect={() => muteSelected(false)}>
          Unmute selected
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={none} onSelect={() => assignFreeTracks()}>
          Assign selected to free mixer tracks <DropdownMenuShortcut>⌘L</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={selectorsShown} onCheckedChange={(shown) => useMusicUi.getState().setTrackSelectorsShown(shown)}>
          Show mixer track selectors <DropdownMenuShortcut>⌥M</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** On the title bar, as in FL Studio: global swing, the pattern's length, the graph editor. */
function RackControls({ graph }: { graph: boolean }) {
  const swing = useSong((song) => song.settings.swing);
  const bar = useSong((song) => stepsPerBar(song.settings.timeSignature));
  const patternId = useCurrentPattern((pattern) => pattern.id);
  const set = useCurrentPattern((pattern) => pattern.length);
  const length = useCurrentPattern((pattern, song) => lengthOf(song, pattern));
  const gesture = useRef(songGesture()).current;
  const commit = (value: number | null) => useMusic.getState().commit((song) => setPatternLength(song, patternId, value));

  return (
    <>
      <span className="text-[11px] text-muted-foreground">Swing</span>
      <SongKnob size={18} label="Swing" value={swing} min={0} max={1} defaultValue={0} format={percent} unit={PERCENT} edit={setSwing} />
      <Lcd
        label={set === null ? "Pattern length: Auto (the last bar with notes)" : "Pattern length in steps"}
        value={length}
        min={1}
        max={MAX_STEPS}
        derived={set === null}
        className="ml-1"
        onBegin={() => gesture.begin()}
        onChange={(value) => gesture.apply((song) => setPatternLength(song, patternId, value))}
        onEnd={() => gesture.end()}
        onCancel={() => gesture.cancel()}
        menu={
          <>
            <ContextMenuCheckboxItem checked={set === null} onSelect={() => commit(null)}>
              Auto
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            {[1, 2, 4, 8].map((bars) => (
              <ContextMenuCheckboxItem key={bars} checked={set === bars * bar} onSelect={() => commit(bars * bar)}>
                {bars} bar{bars === 1 ? "" : "s"}
              </ContextMenuCheckboxItem>
            ))}
          </>
        }
      />
      <Toggle
        size="sm"
        className="h-5.5 min-w-5.5 px-1"
        pressed={graph}
        onPressedChange={(on) => useMusicUi.getState().setGraphOpen(on)}
        aria-label="Graph editor"
        title="Graph editor: the note and velocity of each step (Ctrl+K)"
      >
        <PiChartBar className="size-3.5" />
      </Toggle>
    </>
  );
}

/** A light per step above the rows; the one playing is lit. */
function StepLights({ steps }: { steps: number }) {
  const tempo = useSong((song) => song.settings.tempo);
  const loop = useCurrentPattern((pattern, song) => lengthOf(song, pattern));
  const playing = useTransport((s) => s.playing);
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (!playing) {
      setStep(null);
      return;
    }
    let frame = 0;
    const draw = () => {
      const tick = patternPositionNow();
      setStep(tick === null ? null : Math.floor(tick / STEP_TICKS));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing, tempo, loop]);

  return (
    <div className="relative shrink-0" style={{ height: LIGHTS_H }} data-playing-step={step ?? undefined} aria-hidden>
      {Array.from({ length: steps }, (_, i) => (
        <span
          key={i}
          className={cn("absolute top-0 h-[3px] rounded-full", i === step ? "bg-brand shadow-[0_0_4px] shadow-brand" : i >= loop ? "bg-foreground/5" : i % GROUP === 0 ? "bg-foreground/30" : "bg-foreground/12")}
          style={{ left: stepLeft(i), width: STEP_W }}
        />
      ))}
    </div>
  );
}

/** The left of a channel's row: mute light, pan, volume, its button and its selector. */
const ChannelLead = memo(function ChannelLead({ channel, selected, sounding }: { channel: Channel; selected: boolean; sounding: boolean }) {
  const isPlugin = channel.kind === "plugin";
  const unreadable = useTransport((s) => s.unreadable.includes(channel.id));
  const settingsOpen = useMusicUi((s) => s.openChannelIds.includes(channel.id));
  // A plugin channel's window is the plugin's own, which the engine shows.
  const pluginOpen = useTransport((s) => s.channels.loaded.some((c) => c.channel === channel.id && c.editorOpen));
  const pluginLoading = useTransport((s) => s.channels.loading.includes(channel.id));
  const pluginError = useTransport((s) => s.channels.failed.find((c) => c.channel === channel.id)?.error ?? null);
  const open = isPlugin ? pluginOpen : settingsOpen;
  const silent = isPlugin ? pluginError !== null : unreadable || !channel.sampleId;
  const canPaste = useMusicUi((s) => s.copiedSteps !== null);
  const trackSelectorShown = useMusicUi((s) => s.trackSelectorsShown);
  const [dropping, setDropping] = useState(false);
  const [replacing, setReplacing] = useState(false);
  /**
   * Replace… was chosen: the picker opens once the menu has let go of the focus (while it closes it
   * keeps the focus in itself, which would close the picker), and the focus isn't given back to the button.
   */
  const replacingNext = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  const commit = useMusic.getState().commit;
  const id = channel.id;
  /** The pattern and how many steps the rack shows, when a menu item is chosen. */
  const now = () => {
    const { history, patternId } = useMusic.getState();
    const song = history!.doc;
    return { patternId: currentPattern(song, patternId).id, steps: shownSteps(song, patternId, useMusicUi.getState().rackSteps) };
  };

  return (
    <div className="flex items-center gap-1" style={{ height: ROW_H }} role="listitem" data-channel={id} data-channel-name={channel.name}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            aria-label={channel.muted ? `Unmute ${channel.name}` : `Mute ${channel.name}`}
            aria-pressed={!channel.muted}
            title={channel.muted ? "Muted (right-click to solo)" : "Mute (right-click to solo)"}
            // A small light in a larger target, so it's easy to hit.
            className="group grid size-5 shrink-0 place-items-center rounded-full"
            // Ctrl or Alt with the click solos, as in FL Studio.
            onClick={(e) => (e.altKey || e.metaKey || e.ctrlKey ? solo(id) : toggleMute(id))}
          >
            {/* Lit with the accent while the channel plays, dark (sunken) when muted. */}
            <span
              className={cn(
                "size-2.5 rounded-full transition-[colors,filter] group-hover:brightness-125",
                channel.muted ? "sunken" : "border border-brand-edge bg-brand shadow-[0_0_5px] shadow-brand/70 inset-shadow-[0_1px_0_rgb(255_255_255/0.45)]",
              )}
            />
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => solo(id)}>Solo</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <SongKnob size={21} label="Pan" value={channel.pan} min={-1} max={1} defaultValue={0} bipolar format={panText} unit={PERCENT} edit={(song, pan) => updateChannel(song, id, { pan })} />
      <SongKnob
        size={21}
        label="Volume"
        value={channel.volume}
        min={0}
        max={1}
        defaultValue={DEFAULT_VOLUME}
        format={percent}
        unit={PERCENT}
        edit={(song, volume) => updateChannel(song, id, { volume })}
      />

      {trackSelectorShown && <TrackSelector channel={channel} className="ml-0.5 h-[22px] min-w-8 px-1 text-[11px]" />}
      <Popover open={replacing} onOpenChange={setReplacing}>
      <ContextMenu>
        <PopoverPrimitive.Anchor asChild>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            aria-expanded={open}
            // FL Studio's channel button: wide, the name in the middle, pushed in while its window is open,
            // red when it has nothing to play.
            className={cn(
              "relative ml-0.5 flex h-[22px] min-w-0 flex-1 items-center justify-center gap-1 rounded-sm px-5 text-[11px] font-medium",
              silent
                ? "border border-black/40 bg-destructive-solid text-white inset-shadow-[0_1px_0_rgb(255_255_255/0.25)]"
                : open
                  ? "pressed text-brand"
                  : "raised hover:raised-hover active:pressed",
              channel.muted && !silent && "text-muted-foreground",
              dropping && "ring-2 ring-brand",
            )}
            data-channel-button={id}
            title={pluginError ?? `${channel.name}: click for its ${isPlugin ? "window" : "settings"}, Ctrl+click to hear it`}
            // Its menu acts on the channel, so a right-click selects it (keeping a selection it's part of).
            onContextMenu={() => {
              if (!useMusicUi.getState().selectedChannelIds.includes(id)) useMusicUi.getState().selectChannel(id);
            }}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) useTransport.getState().audition(id);
              else if (isPlugin) useTransport.getState().showPlugin(id, !pluginOpen);
              else if (channel.kind === "audio") {
                chooseSource({ kind: "audio", ref: id });
                openPlaylist();
              } else useMusicUi.getState().toggleChannelWindow(id, e.altKey);
            }}
            onWheel={(e) => e.shiftKey && e.deltaY !== 0 && moveChannel(id, e.deltaY < 0 ? -1 : 1)}
            // A file dropped on the button replaces this channel's sample.
            onDragOver={(e) => {
              if (isPlugin || !carriesSamples(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              if (isPlugin) return;
              e.preventDefault();
              e.stopPropagation();
              setDropping(false);
              useMusicUi.getState().selectChannel(id);
              dropOnChannel(e.dataTransfer, id);
            }}
          >
            <span className="truncate">{channel.name}</span>
            {/* Its kind at the right end, as FL Studio's instrument icon. */}
            <span className="absolute right-1.5 flex items-center opacity-70">
              {pluginLoading ? (
                <PiSpinnerGap className="size-3 animate-spin" aria-label="Loading the plugin" />
              ) : silent ? (
                <PiWarning className="size-3" aria-label={isPlugin ? "The plugin couldn't be loaded" : "No sample to play"} />
              ) : isPlugin ? (
                <PiPlugs className="size-3" aria-hidden />
              ) : null}
            </span>
          </button>
        </ContextMenuTrigger>
        </PopoverPrimitive.Anchor>
        {/* FL Studio's channel menu: the channel on the left, its steps on the right. */}
        <ContextMenuContent
          className="p-0"
          data-testid="channel-menu"
          onCloseAutoFocus={(e) => {
            if (!replacingNext.current) return;
            e.preventDefault();
            replacingNext.current = false;
            setReplacing(true);
          }}
        >
          <ContextMenuColumns>
            <ContextMenuCell first>
              <ContextMenuItem inset onSelect={() => openPianoRoll(id)}>
                Piano roll
              </ContextMenuItem>
              <ContextMenuItem
                inset
                onSelect={() => {
                  useMusicUi.getState().setSelection([id]);
                  useMusicUi.getState().setGraphOpen(true);
                }}
              >
                Graph editor <ContextMenuShortcut>⌘K</ContextMenuShortcut>
              </ContextMenuItem>
              {isPlugin ? (
                <ContextMenuItem inset disabled={silent || pluginLoading} onSelect={() => useTransport.getState().showPlugin(id, true)}>
                  Open {channel.plugin?.name ?? "the plugin"}…
                </ContextMenuItem>
              ) : (
                <ContextMenuItem inset onSelect={() => useMusicUi.getState().openChannelWindow(id)}>
                  Channel settings…
                </ContextMenuItem>
              )}
            </ContextMenuCell>
            <ContextMenuCell>
              <ContextMenuItem inset onSelect={() => cutSteps(id)}>
                Cut
              </ContextMenuItem>
              <ContextMenuItem inset onSelect={() => copySteps(id)}>
                Copy
              </ContextMenuItem>
              <ContextMenuItem inset disabled={!canPaste} onSelect={() => pasteSteps(id)}>
                Paste
              </ContextMenuItem>
            </ContextMenuCell>
            <ContextMenuSeparator className="col-span-full m-0" />
            <ContextMenuCell first>
              {!isPlugin && (
                <ContextMenuItem inset onSelect={() => file.current?.click()}>
                  Load sample…
                </ContextMenuItem>
              )}
              {!isPlugin && (
                <ContextMenuCheckboxItem checked={channel.cutSelf} onSelect={() => commit((song) => updateChannel(song, id, { cutSelf: !channel.cutSelf }))}>
                  Cut itself
                </ContextMenuCheckboxItem>
              )}
              <ContextMenuItem inset disabled={silent} onSelect={() => useTransport.getState().audition(id)}>
                Hear it <ContextMenuShortcut>⌘click</ContextMenuShortcut>
              </ContextMenuItem>
            </ContextMenuCell>
            <ContextMenuCell>
              {[2, 4, 8].map((every) => (
                <ContextMenuItem inset key={every} onSelect={() => commit((song) => fillSteps(song, now().patternId, id, every, now().steps))}>
                  Fill each {every} steps
                </ContextMenuItem>
              ))}
              <ContextMenuItem inset onSelect={() => commit((song) => drawSteps(song, now().patternId, id, "-", MAX_STEPS))}>
                Clear steps
              </ContextMenuItem>
            </ContextMenuCell>
            <ContextMenuSeparator className="col-span-full m-0" />
            <ContextMenuCell first>
              {channel.kind !== "audio" && (
                <ContextMenuItem
                  inset
                  onSelect={() => {
                    replacingNext.current = true;
                  }}
                >
                  Replace…
                </ContextMenuItem>
              )}
              <ContextMenuItem
                inset
                onSelect={() => {
                  useMusicUi.getState().setSelection([id]);
                  cloneSelected();
                }}
              >
                Clone
              </ContextMenuItem>
              <ContextMenuItem inset variant="destructive" onSelect={() => deleteChannels([id])}>
                Delete
              </ContextMenuItem>
            </ContextMenuCell>
            <ContextMenuCell>
              <ContextMenuItem inset onSelect={() => rotate(-1, id)}>
                Rotate left <ContextMenuShortcut>⇧⌘←</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem inset onSelect={() => rotate(1, id)}>
                Rotate right <ContextMenuShortcut>⇧⌘→</ContextMenuShortcut>
              </ContextMenuItem>
            </ContextMenuCell>
          </ContextMenuColumns>
        </ContextMenuContent>
      </ContextMenu>
        <PopoverContent align="start" className="w-auto p-2" data-testid="replace-picker" onOpenAutoFocus={(e) => e.preventDefault()}>
          <InstrumentPicker
            open={replacing}
            onChoose={(plugin) => {
              setReplacing(false);
              replaceInstrument(id, plugin && { id: plugin.id, name: plugin.name, format: plugin.format });
            }}
          />
        </PopoverContent>
      </Popover>
      <input
        ref={file}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const [audio] = audioFiles(e.target.files);
          if (audio) void useMusic.getState().replaceSample(id, audio);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        data-selector={id}
        aria-label={`Select ${channel.name}`}
        aria-pressed={selected}
        title="Select (drag or Shift+click for a range, right-click to add one, double-click for its Piano roll)"
        data-sounding={sounding || undefined}
        // FL Studio's selector: a thin light after the button (in a wider target, so it's easy to hit),
        // outlined when the channel is selected and lit while it makes a sound.
        className="group flex h-[24px] w-4 shrink-0 touch-none justify-center"
        // Théo's, not FL's (which selects every channel): straight into its notes.
        onDoubleClick={() => channel.kind !== "audio" && openPianoRoll(id)}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          const rack = e.currentTarget.closest("[data-window]") ?? document.body;
          const ui = useMusicUi.getState();
          if (e.button === 0) {
            // Shift+click: everything from the last one clicked to this one.
            if (e.shiftKey) return selectRange(ui.anchorChannelId ?? id, id);
            // A click selects it alone; dragged along the selectors, everything from it to where the pointer is.
            startPointerDrag(e, {
              threshold: 3,
              onStart: () => useMusicUi.setState({ anchorChannelId: id }),
              onMove(ev) {
                const other = under(rack, ev.clientX, ev.clientY, "selector")?.dataset.selector;
                if (other) selectRange(id, other);
              },
              onClick: () => useMusicUi.getState().selectChannel(id),
            });
            return;
          }
          // The right button adds to the selection, and dragged down the selectors, selects each it passes.
          if (e.button !== 2) return;
          ui.selectChannel(id, "add");
          startPointerDrag(e, {
            button: 2,
            threshold: 0,
            onMove(ev) {
              const other = under(rack, ev.clientX, ev.clientY, "selector")?.dataset.selector;
              if (other && !useMusicUi.getState().selectedChannelIds.includes(other)) useMusicUi.getState().selectChannel(other, "add");
            },
          });
        }}
      >
        <span
          className={cn(
            "my-px w-1.5 rounded-[2px] transition-[background-color,box-shadow] duration-75",
            sounding ? "bg-brand shadow-[0_0_5px] shadow-brand/70" : "sunken group-hover:bg-surface-3",
            selected && "outline-[1.5px] outline-offset-1 outline-brand outline-solid",
          )}
        />
      </button>
    </div>
  );
});

const EMPTY: Note[] = [];

/**
 * A channel's steps in the current pattern. The left button turns steps on, the right one turns them
 * off, and either paints along the row when dragged: FL Studio's step sequencer.
 */
const StepRow = memo(function StepRow({ channelId, name, steps }: { channelId: string; name: string; steps: number }) {
  const patternId = useCurrentPattern((pattern) => pattern.id);
  const notes = useCurrentPattern((pattern) => pattern.notes[channelId] ?? EMPTY);
  const loop = useCurrentPattern((pattern, song) => lengthOf(song, pattern));
  const on = new Set(notes.filter((n) => n.start % STEP_TICKS === 0).map((n) => n.start / STEP_TICKS));
  const gesture = useRef(songGesture()).current;

  // Notes that aren't plain steps (written in the Piano roll): a picture of them instead, as in FL Studio.
  if (!plainSteps(notes)) return <NotesPreview channelId={channelId} name={name} notes={notes} steps={steps} loop={loop} />;

  return (
    <div
      className="relative shrink-0 touch-none"
      style={{ height: ROW_H }}
      role="group"
      aria-label={`${name} steps`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== 2) return;
        const root = e.currentTarget;
        const first = stepAt(root, e.clientX, e.clientY);
        if (first === null) return;
        const paint = e.button === 0;
        gesture.begin();
        gesture.apply((song) => setSteps(song, patternId, channelId, [first], paint));
        let last = first;
        const started = startPointerDrag(e, {
          button: paint ? 0 : 2,
          threshold: 0,
          onMove(ev) {
            const step = stepAt(root, ev.clientX, ev.clientY);
            if (step === null) return;
            // Every step since the last one seen: a fast sweep skips over some.
            const swept = Array.from({ length: Math.abs(step - last) + 1 }, (_, i) => Math.min(step, last) + i);
            last = step;
            gesture.apply((song) => setSteps(song, patternId, channelId, swept, paint));
          },
          onEnd: () => gesture.end(),
          onClick: () => gesture.end(),
          onCancel: () => gesture.cancel(),
        });
        if (!started) gesture.end();
      }}
    >
      {Array.from({ length: steps }, (_, step) => (
        <button
          key={step}
          type="button"
          data-step={step}
          aria-label={`${name} step ${step + 1}`}
          aria-pressed={on.has(step)}
          // FL Studio's step keys: beats in two alternating colours, dark when off, pale and lit when on
          // (`step-*` in index.css, coloured by the theme).
          className={cn(
            "absolute top-0 rounded-[2px] outline-none",
            on.has(step) ? (oddBeat(step) ? "step-on-alt" : "step-on") : oddBeat(step) ? "step-off-alt" : "step-off",
            // Past the pattern's end: there to be filled (Auto), or unheard (a set length).
            step >= loop && "opacity-45",
          )}
          style={{ left: stepLeft(step), width: STEP_W, height: ROW_H }}
          // The row's pointer handler does the work (so a drag paints); Enter turns a step on, Delete off.
          onKeyDown={(e) => {
            const turnOn = e.key === "Enter";
            if (!turnOn && e.key !== "Delete" && e.key !== "Backspace") return;
            e.preventDefault();
            e.stopPropagation();
            useMusic.getState().commit((song) => setSteps(song, patternId, channelId, [step], turnOn));
          }}
        />
      ))}
    </div>
  );
});

/** Steps: every note on a step, a step long. Anything else is the Piano roll's to show. */
const plainSteps = (notes: readonly Note[]) => notes.every((n) => n.start % STEP_TICKS === 0 && n.length === STEP_TICKS);

/** A miniature of a channel's notes in the rack's row; a click opens them in the Piano roll. */
function NotesPreview({ channelId, name, notes, steps, loop }: { channelId: string; name: string; notes: readonly Note[]; steps: number; loop: number }) {
  const width = stepsWidth(steps);
  const span = Math.max(steps, loop) * STEP_TICKS;
  let low = 127;
  let high = 0;
  for (const note of notes) {
    low = Math.min(low, note.pitch);
    high = Math.max(high, note.pitch);
  }
  const range = Math.max(12, high - low + 1);
  const shown = notes.length > 600 ? notes.slice(0, 600) : notes;
  return (
    <button
      type="button"
      aria-label={`${name}: open its notes in the Piano roll`}
      title="Open in the Piano roll"
      data-notes-preview={channelId}
      className="sunken relative shrink-0 overflow-hidden rounded-[2px] hover:border-brand/60"
      style={{ width, height: ROW_H }}
      onClick={() => openPianoRoll(channelId)}
    >
      {/* A lighter and a darker block per bar. */}
      {Array.from({ length: Math.ceil(span / (16 * STEP_TICKS)) }, (_, bar) => (
        <span key={bar} className={cn("absolute inset-y-0", bar % 2 ? "bg-foreground/6" : "")} style={{ left: (bar * 16 * STEP_TICKS * width) / span, width: (16 * STEP_TICKS * width) / span }} />
      ))}
      {shown.map((note) => (
        <span
          key={note.id}
          className={cn("absolute h-[2px] rounded-full", note.muted ? "bg-brand/30" : "bg-brand")}
          style={{
            left: (note.start * width) / span,
            width: Math.max(2, (note.length * width) / span),
            top: 3 + ((high - note.pitch) / range) * (ROW_H - 8) + ((range - (high - low + 1)) / range) * ((ROW_H - 8) / 2),
          }}
        />
      ))}
      <PreviewPlayhead width={width} span={span} />
    </button>
  );
}

/** A line across a notes preview where the pattern is playing; moved a frame at a time without rendering. */
function PreviewPlayhead({ width, span }: { width: number; span: number }) {
  const tempo = useSong((song) => song.settings.tempo);
  const playing = useTransport((s) => s.playing);
  const line = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const el = line.current;
      if (!el) return;
      const tick = patternPositionNow();
      el.style.display = tick === null ? "none" : "";
      if (tick !== null) el.style.transform = `translateX(${((tick % span) * width) / span}px)`;
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing, tempo, width, span]);

  if (!playing) return null;
  return <span ref={line} aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-px bg-brand shadow-[0_0_4px] shadow-brand" style={{ display: "none" }} />;
}

type GraphProperty = "note" | "velocity";
const GRAPH_TABS: { id: GraphProperty; label: string }[] = [
  { id: "note", label: "Note" },
  { id: "velocity", label: "Velocity" },
];

/** A step's value as the height of its bar, 0..1, and back. */
const levelOf = (note: Note, property: GraphProperty) => (property === "velocity" ? note.velocity : clamp((note.pitch - ROOT_PITCH) / GRAPH_PITCH_RANGE, -1, 1) / 2 + 0.5);
const patchOf = (level: number, property: GraphProperty): StepPatch =>
  property === "velocity" ? { velocity: level } : { pitch: ROOT_PITCH + Math.round((level * 2 - 1) * GRAPH_PITCH_RANGE) };
const DEFAULT_LEVEL: Record<GraphProperty, number> = { velocity: DEFAULT_VELOCITY, note: 0.5 };

/**
 * The graph editor: a bar per step of the selected channel. Drag sets values (sweep to draw), Ctrl
 * drags them all together, the right button ramps from where it's pressed to where it's dragged, and
 * Alt resets. Every drag is worked out from the steps as the drag found them.
 */
function GraphEditor({ channel, steps }: { channel: Channel; steps: number }) {
  const [property, setProperty] = useState<GraphProperty>("velocity");
  const patternId = useCurrentPattern((pattern) => pattern.id);
  // Select the pattern (the same object until it's edited), not what's made from it: a selector must return the same thing twice.
  const pattern = useCurrentPattern((current) => current);
  const byStep = stepNotes(pattern, channel.id, steps);
  const gesture = useRef(songGesture()).current;

  return (
    <div className="flex flex-col" data-testid="graph-editor" data-channel-name={channel.name}>
      <div
        className="sunken relative cursor-ns-resize touch-none rounded-t-sm"
        style={{ height: GRAPH_HEIGHT }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 2) return;
          const root = e.currentTarget;
          const top = root.getBoundingClientRect().top;
          const levelAt = (y: number) => clamp(1 - (y - top) / GRAPH_HEIGHT, 0, 1);
          const startLevel = levelAt(e.clientY);
          const first = stepAt(root, e.clientX, e.clientY);
          if (first === null) return;
          const mode = e.button === 2 ? "ramp" : e.altKey ? "reset" : e.ctrlKey || e.metaKey ? "scale" : "draw";
          // The steps as they are now: every move of the drag starts from these.
          const base = stepNotes(pattern, channel.id, steps);
          const grabbed = base[first] ? levelOf(base[first], property) : null;
          const drawn = new Map<number, StepPatch>();

          const patches = (x: number, y: number): Map<number, StepPatch> => {
            const step = stepAt(root, x, y) ?? first;
            const level = levelAt(y);
            if (mode === "draw" || mode === "reset") {
              drawn.set(step, patchOf(mode === "reset" ? DEFAULT_LEVEL[property] : level, property));
              return drawn;
            }
            const all = new Map<number, StepPatch>();
            base.forEach((note, i) => {
              if (!note) return;
              const was = levelOf(note, property);
              if (mode === "scale") {
                // Velocities keep their proportions; notes move together.
                const moved = grabbed === null ? was : property === "velocity" ? (grabbed > 0 ? (was * level) / grabbed : level) : was + level - grabbed;
                all.set(i, patchOf(clamp(moved, 0, 1), property));
              } else {
                const [from, to] = first <= step ? [first, step] : [step, first];
                const inside = i >= from && i <= to;
                const at = step === first ? 0 : (i - first) / (step - first);
                all.set(i, patchOf(inside ? startLevel + (level - startLevel) * at : was, property));
              }
            });
            return all;
          };

          gesture.begin();
          const apply = (x: number, y: number) => {
            const next = patches(x, y);
            gesture.apply((song) => setStepNotes(song, patternId, channel.id, next));
          };
          apply(e.clientX, e.clientY);
          const started = startPointerDrag(e, {
            button: e.button === 2 ? 2 : 0,
            threshold: 0,
            onMove: (ev) => apply(ev.clientX, ev.clientY),
            onEnd: () => gesture.end(),
            onClick: () => gesture.end(),
            onCancel: () => gesture.cancel(),
          });
          if (!started) gesture.end();
        }}
      >
        {property === "note" && <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-foreground/15" />}
        {byStep.map((note, step) => {
          const level = note ? levelOf(note, property) : 0;
          const text = !note ? "No note" : property === "velocity" ? percent(note.velocity) : `${note.pitch - ROOT_PITCH > 0 ? "+" : ""}${note.pitch - ROOT_PITCH} st`;
          return (
            <div key={step} data-step={step} data-level={note ? Math.round(level * 100) : undefined} title={text} className="absolute inset-y-0" style={{ left: stepLeft(step), width: STEP_W }}>
              {note &&
                (property === "velocity" ? (
                  <span className="absolute inset-x-0.5 bottom-0 rounded-t-sm bg-brand" style={{ height: `${level * 100}%` }} />
                ) : (
                  <span className="absolute inset-x-0.5 h-1 -translate-y-1/2 rounded-sm bg-brand" style={{ top: `${(1 - level) * 100}%` }} />
                ))}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-0.5 rounded-b-sm border-x border-b border-line bg-surface-1 px-1 py-0.5" role="tablist" aria-label="Graph shows">
        {GRAPH_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={property === tab.id}
            className={cn("rounded px-2 py-0.5 text-[11px]", property === tab.id ? "font-medium text-brand" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setProperty(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto truncate pr-1 text-[11px] text-muted-foreground">{channel.name}</span>
      </div>
    </div>
  );
}
