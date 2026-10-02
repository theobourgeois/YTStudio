import { type ReactNode, useEffect, useRef } from "react";
import { PiCaretDownBold, PiGhost, PiMagnet, PiWrench } from "react-icons/pi";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { noteBounds } from "@shared/music/notes";
import type { Note } from "@shared/music/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useMusic } from "../store";
import { patternPositionNow } from "../playhead";
import { useTransport } from "../transport";
import { useMusicUi } from "../ui";
import { MusicWindow } from "../window";
import { chop, chopperResult, glue, legato, openChopper, pianoChannel, pianoContext, quantize } from "./actions";
import { applyDrag, rectSelection } from "./drag";
import { heldKeys, useMidi } from "../midi";
import { type Scene, drawGrid, drawHandle, drawKeys, drawLane, drawRuler, prepare, readPalette, stretchHandle } from "./draw";
import { onFade, vanishing } from "./fades";
import { MAX_ROW_HEIGHT, MIN_ROW_HEIGHT, SNAPS, SNAP_LABELS, type Snap, pitchToY, tickToX, wheelZoomFactor, zoomAt } from "./geometry";
import { gridCursor, gridPointerDown, keysPointerDown, lanePointerDown, rulerPointerDown, trackSliceHover } from "./pointer";
import { CURSORS } from "./cursors";
import { carriesSamples, dropAsChannels, dropOnChannel } from "../browser/drops";
import { DEFAULT_LANE_HEIGHT, MIN_LANE_HEIGHT, MIN_NOTES_HEIGHT, type PianoTool, usePiano } from "./store";
import { DeleteIcon, DrawIcon, MuteIcon, PaintIcon, PlaybackIcon, SelectIcon, SliceIcon } from "./tool-icons";

const KEYS_W = 72;
const RULER_H = 22;
const SCROLLBAR = 12;
const MIN_W = 480;
const MIN_H = 280;

const TOOLS: { tool: PianoTool; label: string; key: string; icon: (props: { className?: string }) => ReactNode }[] = [
  { tool: "draw", label: "Draw", key: "P", icon: DrawIcon },
  { tool: "paint", label: "Paint", key: "B", icon: PaintIcon },
  { tool: "delete", label: "Delete", key: "D", icon: DeleteIcon },
  { tool: "mute", label: "Mute", key: "T", icon: MuteIcon },
  { tool: "slice", label: "Slice", key: "C", icon: SliceIcon },
  { tool: "select", label: "Select", key: "E", icon: SelectIcon },
  { tool: "playback", label: "Playback", key: "Y", icon: PlaybackIcon },
];

const EMPTY: Note[] = [];

/**
 * The Piano roll (FL Studio's, `docs/fl-studio/piano-roll.md`): a window showing one channel's notes
 * in the current pattern, drawn on canvases (`draw.ts`) from the stores, once a frame when something
 * changed. The mouse is `pointer.ts`, the keys `keys.ts`, the commands `actions.ts`.
 */
export function PianoRoll() {
  const channel = useMusic((s) => {
    const song = s.history?.doc;
    return song ? pianoChannel(song, usePiano.getState().channelId, useMusicUi.getState().selectedChannelIds) : null;
  });
  // Re-read when the chosen channel changes (the selector above reads the store without subscribing).
  usePiano((s) => s.channelId);
  useMusicUi((s) => s.selectedChannelIds);
  // What loops and where play starts, on the element too (the tests read them there).
  const loop = useTransport((s) => `${s.loop.start}:${s.loop.ticks}`);
  const startTick = useTransport((s) => s.startTick);
  const selectedCount = usePiano((s) => s.selected.size);
  const rowHeight = usePiano((s) => Math.round(s.view.rowHeight));

  return (
    <MusicWindow
      id="piano"
      title={channel ? `Piano roll - ${channel.name}` : "Piano roll"}
      // It fills the desktop when it opens (as FL Studio's does); a double-click on its title puts it
      // in a window of this size.
      initial={{ x: 60, y: 40, width: 960, height: 600, snap: "full" }}
      resizable={{ minWidth: MIN_W, minHeight: MIN_H }}
      onClose={() => {
        useMusicUi.getState().setPianoOpen(false);
        // What loops is the time selection only while it can be seen.
        usePiano.setState({ time: null, drag: null, editing: null, chopping: false });
      }}
      heading={channel ? <ChannelMenu name={channel.name} /> : undefined}
      tools={<PianoControls />}
    >
      <div
        className="relative min-h-0 flex-1"
        data-testid="piano-roll"
        data-channel-name={channel?.name}
        data-loop={loop}
        data-start={startTick}
        data-selected={selectedCount}
        data-row-height={rowHeight}
        // A sample dropped on it is the sample of the channel it shows; a plugin channel can't take one,
        // so it becomes a channel of its own, shown here instead.
        onDragOver={(e) => {
          if (!carriesSamples(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          if (!carriesSamples(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          if (channel?.kind === "sampler") return dropOnChannel(e.dataTransfer, channel.id);
          void dropAsChannels(e.dataTransfer).then(([added]) => added && usePiano.getState().setChannel(added));
        }}
      >
        {channel ? <PianoBody /> : <p className="p-6 text-sm text-muted-foreground">Add a channel to the rack to write its notes here.</p>}
      </div>
    </MusicWindow>
  );
}

function PianoControls() {
  const tool = usePiano((s) => s.tool);
  const snap = usePiano((s) => s.snap);
  const ghosts = usePiano((s) => s.ghosts);
  return (
    <>
      <ToolsMenu />
      <div className="flex items-center gap-0.5" role="toolbar" aria-label="Piano roll tools">
        {TOOLS.map(({ tool: id, label, key, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={tool === id}
            title={`${label} (${key})`}
            className={cn("grid size-5.5 place-items-center rounded-sm", tool === id ? "pressed text-brand" : "border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground")}
            onClick={() => usePiano.getState().setTool(id)}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Snap" title="Snap" className="sunken flex h-5.5 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground hover:text-foreground">
            <PiMagnet className="size-3.5" />
            {SNAP_LABELS[snap]}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Snap (Alt: none)</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={snap} onValueChange={(value) => usePiano.getState().setSnap(value as Snap)}>
            {SNAPS.map((id) => (
              <DropdownMenuRadioItem key={id} value={id}>
                {SNAP_LABELS[id]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label="Ghost notes"
        aria-pressed={ghosts}
        title="Ghost notes: the other channels' notes (Alt+V)"
        className={cn("grid size-5.5 place-items-center rounded-sm", ghosts ? "pressed text-brand" : "border border-transparent text-muted-foreground hover:raised hover:raised-hover")}
        onClick={() => usePiano.setState({ ghosts: !ghosts })}
      >
        <PiGhost className="size-3.5" />
      </button>
    </>
  );
}

/** FL Studio's Tools menu (the wrench): what's done to the notes at once, and the Chopper. */
function ToolsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Piano roll tool menu" title="Tools" className="grid size-5.5 place-items-center rounded-sm border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground">
          <PiWrench className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>The selection, or every note</DropdownMenuLabel>
        <DropdownMenuItem onSelect={openChopper}>
          Chop… <DropdownMenuShortcut>⌥U</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={chop}>
          Quick chop <DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={glue}>
          Glue <DropdownMenuShortcut>⌘G</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => quantize("both")}>
          Quick quantize <DropdownMenuShortcut>⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => quantize("starts")}>
          Quantize start times <DropdownMenuShortcut>⇧Q</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={legato}>
          Quick legato <DropdownMenuShortcut>⌘L</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The title, "Piano roll - channel", is the target channel selector, as FL Studio's: a menu of the channels,
 * those with notes in this pattern first, then the rest.
 */
function ChannelMenu({ name }: { name: string }) {
  const channels = useMusic((s) => s.history!.doc.channels);
  const patternNotes = useMusic((s) => s.history!.doc.patterns.find((p) => p.id === s.patternId)?.notes ?? s.history!.doc.patterns[0].notes);
  const current = pianoContext()?.channel.id ?? "";
  usePiano((s) => s.channelId);
  const used = channels.filter((c) => patternNotes[c.id]?.length);
  const unused = channels.filter((c) => !patternNotes[c.id]?.length);
  const pick = (id: string) => usePiano.getState().setChannel(id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Target channel"
          title="The channel whose notes are shown (G / K, H / J)"
          className="flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-medium hover:bg-surface-2 data-[state=open]:bg-surface-2"
        >
          <span className="truncate">Piano roll - {name}</span>
          <PiCaretDownBold className="size-2.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuRadioGroup value={current} onValueChange={pick}>
          {used.length > 0 && <DropdownMenuLabel>In this pattern</DropdownMenuLabel>}
          {used.map((c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              {c.name}
            </DropdownMenuRadioItem>
          ))}
          {used.length > 0 && unused.length > 0 && <DropdownMenuSeparator />}
          {unused.length > 0 && <DropdownMenuLabel>Others</DropdownMenuLabel>}
          {unused.map((c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              {c.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The last drag preview worked out, to reuse while neither the notes nor the drag change. */
let previewCache: { notes: Note[]; drag: unknown; result: Note[]; created: number[]; selected: ReadonlySet<number> | null } | null = null;
/** The same for the Chopper's: what it would make of the notes, while its settings, the selection and the snap stay. */
let chopCache: { notes: Note[]; settings: unknown; selected: unknown; grid: number; result: Note[]; created: number[] } | null = null;

function PianoBody() {
  const grid = useRef<HTMLCanvasElement>(null);
  const ruler = useRef<HTMLCanvasElement>(null);
  const keys = useRef<HTMLCanvasElement>(null);
  const lane = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const gridBox = useRef<HTMLDivElement>(null);
  const laneHeight = usePiano((s) => s.laneHeight);
  const laneProperty = usePiano((s) => s.lane);
  // The event editor draws with the tool in hand: the pencil's, or else the brush (it paints values).
  const laneCursor = usePiano((s) => (s.tool === "draw" ? CURSORS.pencil : CURSORS.brush));

  // Drawing: once a frame, when anything it shows has changed.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = 0;
      const started = performance.now();
      const ctx = pianoContext();
      const box = gridBox.current;
      if (!ctx || !box || !grid.current || !ruler.current || !keys.current) return;
      const piano = usePiano.getState();
      const { gridWidth: width, gridHeight: height, view, drag } = piano;
      const palette = readPalette(box);
      let notes = ctx.notes;
      let selected: ReadonlySet<number> = ctx.selected;
      // While the Chopper is open, the notes are shown as it would leave them (until a drag starts).
      if (piano.chopping && !drag) {
        if (chopCache?.notes !== ctx.notes || chopCache.settings !== piano.chopper || chopCache.selected !== piano.selected || chopCache.grid !== ctx.grid) {
          const result = chopperResult(ctx, piano.chopper);
          chopCache = { notes: ctx.notes, settings: piano.chopper, selected: piano.selected, grid: ctx.grid, result: result?.notes ?? ctx.notes, created: result?.created ?? [] };
        }
        notes = chopCache.result;
        // The pieces of selected notes are as selected as the notes were.
        if (selected.size && chopCache.created.length) selected = new Set([...selected, ...chopCache.created]);
      }
      if (drag) {
        if (previewCache?.notes !== ctx.notes || previewCache.drag !== drag) {
          const result = applyDrag(ctx.notes, drag);
          previewCache = { notes: ctx.notes, drag, result: result.notes, created: result.created, selected: null };
        }
        notes = previewCache.result;
        // A slice shows the pieces it cuts off in the selected colour, so what it would do is seen.
        if (drag.kind === "slice" && previewCache.created.length) selected = new Set([...selected, ...previewCache.created]);
        // A selection rectangle selects what it covers as it's dragged (the selection itself changes when it's let go).
        if (drag.kind === "rect") selected = previewCache.selected ??= rectSelection(ctx.notes, drag, ctx.selected);
      }
      const fading = vanishing(performance.now());
      const scene: Scene = {
        view,
        width,
        height,
        notes,
        selected,
        vanishing: fading,
        // Shift's cut (and its hover) goes through the whole column: a line the grid's height.
        slice:
          drag?.kind === "slice"
            ? drag.column
              ? { x: Math.round(tickToX(view, drag.tick)) + 0.5, y1: 0, y2: height, full: true }
              : { x: Math.round(tickToX(view, drag.tick)) + 0.5, y1: pitchToY(view, Math.max(drag.low, drag.high)), y2: pitchToY(view, Math.min(drag.low, drag.high)) + view.rowHeight, full: false }
            : !drag && piano.sliceHover
              ? { x: Math.round(tickToX(view, piano.sliceHover.tick)) + 0.5, y1: 0, y2: height, full: true }
              : null,
        ghosts: piano.ghosts ? Object.entries(ctx.pattern.notes).flatMap(([id, list]) => (id === ctx.channel.id ? [] : [list])) : [],
        barTicks: ctx.barTicks,
        beatTicks: ctx.beatTicks,
        snap: piano.snap,
        patternTicks: ctx.patternTicks,
        time: piano.time,
        drag,
        palette,
      };
      const g = prepare(grid.current, width, height);
      if (g) {
        drawGrid(g, scene);
        const bounds = ctx.selected.size > 1 && !drag ? noteBounds(ctx.notes, ctx.selected) : null;
        if (bounds) drawHandle(g, stretchHandle(view, bounds), palette);
      }
      const r = prepare(ruler.current, width, RULER_H);
      if (r) drawRuler(r, { ...scene, height: RULER_H }, useTransport.getState().startTick);
      const k = prepare(keys.current, KEYS_W, height);
      if (k) {
        // The key the mouse holds, and those played on a keyboard on this channel.
        const held = new Set(heldKeys(ctx.channel.id));
        if (piano.heldKey !== null) held.add(piano.heldKey);
        drawKeys(k, view, KEYS_W, height, palette, held);
      }
      if (lane.current && piano.laneHeight) {
        const l = prepare(lane.current, width, piano.laneHeight);
        if (l) drawLane(l, { ...scene, height: piano.laneHeight }, piano.lane);
      }
      // How long a frame took, for the stress tests.
      box.dataset.drawMs = (performance.now() - started).toFixed(2);
      box.dataset.notes = String(notes.length);
      // Deleted notes still fading: another frame.
      if (fading.length) schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const stops = [
      useMusic.subscribe(schedule),
      usePiano.subscribe(schedule),
      useMusicUi.subscribe((s, p) => s.selectedChannelIds !== p.selectedChannelIds && schedule()),
      useTransport.subscribe((s, p) => s.startTick !== p.startTick && schedule()),
      useMidi.subscribe((s, p) => s.held !== p.held && schedule()),
      onFade(schedule),
    ];
    // The theme (light or dark) changes the colours.
    const theme = new MutationObserver(schedule);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    const resize = new ResizeObserver(() => {
      const box = gridBox.current;
      if (box) usePiano.setState({ gridWidth: box.clientWidth, gridHeight: box.clientHeight });
      schedule();
    });
    if (gridBox.current) resize.observe(gridBox.current);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      for (const stop of stops) stop();
      theme.disconnect();
      resize.disconnect();
    };
  }, []);

  // The pointer over the grid changes with the tool, and with Ctrl (selecting), without moving.
  useEffect(() => {
    let last: { clientX: number; clientY: number } | null = null;
    const canvas = grid.current;
    if (!canvas) return;
    const refresh = (keys?: { ctrlKey: boolean; metaKey: boolean }) => {
      if (last && !usePiano.getState().drag) canvas.style.cursor = gridCursor(canvas, { ...last, ...keys });
    };
    const track = (e: PointerEvent) => (last = e.buttons === 0 ? { clientX: e.clientX, clientY: e.clientY } : last);
    const leave = () => (last = null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") refresh(e);
      // Shift shows the slice tool's line where the pointer is, without it moving.
      if (e.key === "Shift") trackSliceHover(canvas, last && { ...last, altKey: e.altKey, shiftKey: e.type === "keydown" });
    };
    canvas.addEventListener("pointermove", track);
    canvas.addEventListener("pointerleave", leave);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    const stop = usePiano.subscribe((s, p) => s.tool !== p.tool && refresh());
    return () => {
      canvas.removeEventListener("pointermove", track);
      canvas.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      stop();
    };
  }, []);

  // The playhead, moved every frame while the song plays.
  useEffect(() => {
    let frame = 0;
    const move = () => {
      const line = playhead.current;
      if (line) {
        const tick = patternPositionNow();
        const x = tick === null ? -10 : tickToX(usePiano.getState().view, tick);
        line.style.transform = `translateX(${x}px)`;
        line.style.opacity = tick === null ? "0" : "1";
      }
      frame = requestAnimationFrame(move);
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, []);

  // The wheel: up and down the keyboard; Shift (or a sideways wheel) along time; Ctrl zooms about the
  // pointer; Alt changes the velocity of the note under it.
  useEffect(() => {
    const box = gridBox.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const piano = usePiano.getState();
      const { view } = piano;
      const x = e.clientX - box.getBoundingClientRect().left;
      if (e.ctrlKey || e.metaKey) return piano.setView(zoomAt(view, x, view.pxPerTick * wheelZoomFactor(e.deltaY, e.deltaMode)));
      if (e.altKey) return wheelVelocity(e, box);
      const sideways = e.shiftKey ? e.deltaY : e.deltaX;
      const down = e.shiftKey ? 0 : e.deltaY;
      piano.setView({
        ...view,
        scrollTick: Math.max(0, view.scrollTick + sideways / view.pxPerTick),
        topPitch: clamp(view.topPitch - down / view.rowHeight, piano.gridHeight / view.rowHeight - 1, 128),
      });
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      className="grid h-full select-none"
      // minmax(0, 1fr): the canvases never hold the rows open while the window shrinks (they're redrawn at the new size).
      style={{ gridTemplateColumns: `${KEYS_W}px minmax(0, 1fr) ${SCROLLBAR}px`, gridTemplateRows: `${RULER_H}px minmax(0, 1fr) ${laneHeight}px ${SCROLLBAR}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-r border-b bg-muted" />
      <div className="relative border-b">
        <canvas ref={ruler} className="absolute inset-0 size-full cursor-pointer" aria-label="Ruler" onPointerDown={rulerPointerDown} />
      </div>
      <div className="border-b bg-muted" />

      <div className="relative min-h-0 border-r">
        <canvas ref={keys} className="absolute inset-0 size-full" aria-label="Keyboard" onPointerDown={keysPointerDown} />
      </div>
      <div ref={gridBox} className="relative min-h-0 overflow-hidden" data-testid="piano-grid">
        <canvas
          ref={grid}
          className="absolute inset-0 size-full"
          aria-label="Notes"
          onPointerDown={gridPointerDown}
          // The pointer says what a press would do there; a drag sets its own while it lasts.
          onPointerMove={(e) => {
            if (e.buttons !== 0) return;
            e.currentTarget.style.cursor = gridCursor(e.currentTarget, e);
            trackSliceHover(e.currentTarget, e);
          }}
          onPointerLeave={(e) => trackSliceHover(e.currentTarget, null)}
          onPointerUp={(e) => (e.currentTarget.style.cursor = gridCursor(e.currentTarget, e))}
        />
        <div ref={playhead} className="pointer-events-none absolute inset-y-0 left-0 w-px bg-foreground opacity-0" />
      </div>
      <VerticalScrollbar />

      {/* Placed by row and column: the resizer spans row 3, and auto-placement would push these below it. */}
      {laneHeight > 0 && (
        <>
          <button
            type="button"
            style={{ gridRow: 3, gridColumn: 1 }}
            className="flex items-start border-t border-r bg-muted px-1 pt-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
            title="The property shown (F)"
            onClick={() => usePiano.setState({ lane: laneProperty === "velocity" ? "pan" : "velocity" })}
          >
            {laneProperty === "velocity" ? "Velocity" : "Pan"}
          </button>
          <div className="relative min-w-0 border-t" style={{ gridRow: 3, gridColumn: 2 }}>
            <canvas ref={lane} className="absolute inset-0 size-full" style={{ cursor: laneCursor }} aria-label="Event editor" onPointerDown={lanePointerDown} />
          </div>
          <div className="border-t" style={{ gridRow: 3, gridColumn: 3 }} />
          <LaneResizer />
        </>
      )}
      <div className="border-t bg-muted" />
      <HorizontalScrollbar />
      <div className="border-t bg-muted" />
    </div>
  );
}

/** The event editor's top edge: dragged to make it taller or shorter, double-clicked for its first height. */
function LaneResizer() {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the lane below the notes"
      title="Drag to resize the event editor"
      data-testid="lane-resizer"
      className="z-10 -mt-[3px] h-1.5 cursor-row-resize self-start hover:bg-brand/40"
      style={{ gridColumn: "1 / -1", gridRow: 3 }}
      onDoubleClick={() => usePiano.setState({ laneHeight: DEFAULT_LANE_HEIGHT, laneSize: DEFAULT_LANE_HEIGHT })}
      onPointerDown={(e) => {
        const start = e.clientY;
        const { laneHeight, gridHeight } = usePiano.getState();
        const max = Math.max(MIN_LANE_HEIGHT, laneHeight + gridHeight - MIN_NOTES_HEIGHT);
        startPointerDrag(e, {
          threshold: 0,
          onMove(ev) {
            const height = Math.round(clamp(laneHeight + start - ev.clientY, MIN_LANE_HEIGHT, max));
            usePiano.setState({ laneHeight: height, laneSize: height });
          },
          onCancel: () => usePiano.setState({ laneHeight, laneSize: laneHeight }),
        });
      }}
    />
  );
}

/** Alt+wheel over a note: its velocity (the selection's, if it's in it), a little at a time. */
function wheelVelocity(e: WheelEvent, box: HTMLElement) {
  const ctx = pianoContext();
  if (!ctx) return;
  const { view } = usePiano.getState();
  const rect = box.getBoundingClientRect();
  const tick = view.scrollTick + (e.clientX - rect.left) / view.pxPerTick;
  const pitch = Math.ceil(view.topPitch - (e.clientY - rect.top) / view.rowHeight);
  const note = ctx.notes.find((n) => n.pitch === pitch && tick >= n.start && tick < n.start + n.length);
  if (!note) return;
  const ids = ctx.selected.has(note.id) ? ctx.selected : new Set([note.id]);
  const by = (e.deltaY < 0 ? 1 : -1) * (e.ctrlKey || e.metaKey ? 0.005 : 0.02);
  usePiano.getState().setDrag(null);
  useMusic.getState().commit((song) => {
    const pattern = song.patterns.find((p) => p.id === ctx.pattern.id)!;
    const list = pattern.notes[ctx.channel.id] ?? EMPTY;
    const next = list.map((n) => (ids.has(n.id) ? { ...n, velocity: clamp(n.velocity + by, 0, 1) } : n));
    return { ...song, patterns: song.patterns.map((p) => (p === pattern ? { ...p, notes: { ...p.notes, [ctx.channel.id]: next } } : p)) };
  });
}

function HorizontalScrollbar() {
  const view = usePiano((s) => s.view);
  const width = usePiano((s) => s.gridWidth);
  const content = useMusic(() => {
    const ctx = pianoContext();
    return ctx ? Math.max(ctx.patternTicks, noteBounds(ctx.notes)?.end ?? 0) + ctx.barTicks * 8 : 0;
  });
  const total = Math.max(content, view.scrollTick + width / view.pxPerTick);
  const thumb = Math.max(24, (width * (width / view.pxPerTick)) / total);
  const left = ((width - thumb) * view.scrollTick) / Math.max(1, total - width / view.pxPerTick);
  return (
    <div className="relative border-t border-line bg-sunken" aria-label="Scroll along time">
      <div
        className="raised absolute top-0.5 bottom-0.5 rounded-sm hover:raised-hover"
        style={{ left, width: thumb }}
        onPointerDown={(e) => {
          const origin = e.clientX;
          const start = view.scrollTick;
          const perPx = (total - width / view.pxPerTick) / Math.max(1, width - thumb);
          startPointerDrag(e, { threshold: 0, onMove: (ev) => usePiano.getState().setView({ ...usePiano.getState().view, scrollTick: Math.max(0, start + (ev.clientX - origin) * perPx) }) });
        }}
      />
    </div>
  );
}

function VerticalScrollbar() {
  const view = usePiano((s) => s.view);
  const height = usePiano((s) => s.gridHeight);
  const rows = height / view.rowHeight;
  const total = 128;
  const thumb = Math.max(24, (height * rows) / total);
  const top = ((height - thumb) * (total - view.topPitch)) / Math.max(1, total - rows);
  return (
    <div
      className="relative border-l border-line bg-sunken"
      aria-label="Scroll up and down the keyboard"
      // Up and down: drag the thumb. Its box, dragged, zooms the rows.
      onDoubleClick={() => usePiano.getState().setView({ ...view, rowHeight: 16 })}
    >
      <div
        className="raised absolute right-0.5 left-0.5 rounded-sm hover:raised-hover"
        style={{ top, height: thumb }}
        onPointerDown={(e) => {
          const origin = e.clientY;
          const start = view.topPitch;
          const perPx = (total - rows) / Math.max(1, height - thumb);
          startPointerDrag(e, {
            threshold: 0,
            onMove: (ev) => usePiano.getState().setView({ ...usePiano.getState().view, topPitch: clamp(start - (ev.clientY - origin) * perPx, rows - 1, 128) }),
          });
        }}
        onWheel={(e) => {
          if (!e.altKey) return;
          const rowHeight = clamp(view.rowHeight + (e.deltaY < 0 ? 1 : -1), MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
          usePiano.getState().setView({ ...view, rowHeight });
        }}
      />
    </div>
  );
}
