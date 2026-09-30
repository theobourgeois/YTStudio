import { useEffect, useRef, useState } from "react";
import { PiCaretDownBold, PiEraser, PiGhost, PiKnife, PiMagnet, PiPaintBrush, PiPencilSimple, PiSelection, PiSpeakerSlash } from "react-icons/pi";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { noteBounds } from "@shared/music/notes";
import { type Note, PPQ } from "@shared/music/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useMusic } from "../store";
import { patternTickNow, useTransport } from "../transport";
import { useMusicUi } from "../ui";
import { MusicWindow } from "../window";
import { pianoChannel, pianoContext } from "./actions";
import { applyDrag } from "./drag";
import { type Scene, drawGrid, drawHandle, drawKeys, drawLane, drawRuler, prepare, readPalette, stretchHandle } from "./draw";
import { MAX_ROW_HEIGHT, MIN_ROW_HEIGHT, SNAPS, SNAP_LABELS, type Snap, tickToX, zoomAt } from "./geometry";
import { NoteProperties } from "./note-properties";
import { gridCursor, gridPointerDown, keysPointerDown, lanePointerDown, rulerPointerDown } from "./pointer";
import { type PianoTool, usePiano } from "./store";

const KEYS_W = 56;
const RULER_H = 22;
const SCROLLBAR = 12;
const MIN_W = 480;
const MIN_H = 280;

const TOOLS: { tool: PianoTool; label: string; key: string; icon: typeof PiPencilSimple }[] = [
  { tool: "draw", label: "Draw", key: "P", icon: PiPencilSimple },
  { tool: "paint", label: "Paint", key: "B", icon: PiPaintBrush },
  { tool: "delete", label: "Delete", key: "D", icon: PiEraser },
  { tool: "mute", label: "Mute", key: "T", icon: PiSpeakerSlash },
  { tool: "slice", label: "Slice", key: "C", icon: PiKnife },
  { tool: "select", label: "Select", key: "E", icon: PiSelection },
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
  const editing = usePiano((s) => s.editing);
  const width = usePiano((s) => s.width);
  const height = usePiano((s) => s.height);
  // What loops and where play starts, on the element too (the tests read them there).
  const loop = useTransport((s) => `${s.loop.start}:${s.loop.ticks}`);
  const startTick = useTransport((s) => s.startTick);
  const selectedCount = usePiano((s) => s.selected.size);

  return (
    <MusicWindow
      id="piano"
      title={channel ? `Piano roll - ${channel.name}` : "Piano roll"}
      initial={{ x: 70, y: 70 }}
      onClose={() => {
        useMusicUi.getState().setPianoOpen(false);
        // What loops is the time selection only while it can be seen.
        usePiano.setState({ time: null, drag: null });
      }}
      controls={<PianoControls />}
    >
      <div
        className="relative"
        style={{ width, height }}
        data-testid="piano-roll"
        data-channel-name={channel?.name}
        data-loop={loop}
        data-start={startTick}
        data-selected={selectedCount}
      >
        {channel ? <PianoBody /> : <p className="p-6 text-sm text-muted-foreground">Add a channel to the rack to write its notes here.</p>}
        <ResizeCorner />
      </div>
      {editing !== null && <NoteProperties />}
    </MusicWindow>
  );
}

function PianoControls() {
  const tool = usePiano((s) => s.tool);
  const snap = usePiano((s) => s.snap);
  const ghosts = usePiano((s) => s.ghosts);
  return (
    <>
      <div className="flex items-center gap-0.5" role="toolbar" aria-label="Piano roll tools">
        {TOOLS.map(({ tool: id, label, key, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={tool === id}
            title={`${label} (${key})`}
            className={cn("grid size-6 place-items-center rounded-md", tool === id ? "bg-brand/20 text-brand" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
            onClick={() => usePiano.getState().setTool(id)}
          >
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Snap" title="Snap" className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
            <PiMagnet className="size-3.5" />
            {SNAP_LABELS[snap]}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
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
      <ChannelMenu />
      <button
        type="button"
        aria-label="Ghost notes"
        aria-pressed={ghosts}
        title="Ghost notes: the other channels' notes (Alt+V)"
        className={cn("grid size-6 place-items-center rounded-md", ghosts ? "text-foreground" : "text-muted-foreground/60", "hover:bg-accent")}
        onClick={() => usePiano.setState({ ghosts: !ghosts })}
      >
        <PiGhost className="size-3.5" />
      </button>
    </>
  );
}

/** The target channel: the channels with notes in this pattern first, then the rest. */
function ChannelMenu() {
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
        <button type="button" aria-label="Target channel" title="The channel whose notes are shown (G / K, H / J)" className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <PiCaretDownBold className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
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

/** The window's bottom-right corner, dragged to make it bigger or smaller. */
function ResizeCorner() {
  return (
    <div
      aria-label="Resize the Piano roll"
      className="absolute right-0 bottom-0 z-10 size-3 cursor-nwse-resize"
      onPointerDown={(e) => {
        const { width, height } = usePiano.getState();
        const origin = { x: e.clientX, y: e.clientY };
        startPointerDrag(e, {
          threshold: 0,
          cursor: "nwse-resize",
          onMove: (ev) => usePiano.setState({ width: Math.max(MIN_W, width + ev.clientX - origin.x), height: Math.max(MIN_H, height + ev.clientY - origin.y) }),
        });
      }}
    />
  );
}

/** The last drag preview worked out, to reuse while neither the notes nor the drag change. */
let previewCache: { notes: Note[]; drag: unknown; grid: number; result: Note[] } | null = null;

function PianoBody() {
  const grid = useRef<HTMLCanvasElement>(null);
  const ruler = useRef<HTMLCanvasElement>(null);
  const keys = useRef<HTMLCanvasElement>(null);
  const lane = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const gridBox = useRef<HTMLDivElement>(null);
  const laneHeight = usePiano((s) => s.laneHeight);
  const laneProperty = usePiano((s) => s.lane);
  const [cursor, setCursor] = useState("crosshair");

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
      if (drag) {
        if (previewCache?.notes !== ctx.notes || previewCache.drag !== drag || previewCache.grid !== ctx.grid) {
          previewCache = { notes: ctx.notes, drag, grid: ctx.grid, result: applyDrag(ctx.notes, drag, ctx.grid).notes };
        }
        notes = previewCache.result;
      }
      const scene: Scene = {
        view,
        width,
        height,
        notes,
        selected: ctx.selected,
        ghosts: piano.ghosts ? Object.entries(ctx.pattern.notes).flatMap(([id, list]) => (id === ctx.channel.id ? [] : [list])) : [],
        barTicks: ctx.barTicks,
        beatTicks: ctx.beatTicks,
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
      if (k) drawKeys(k, view, KEYS_W, height, palette, piano.heldKey);
      if (lane.current && piano.laneHeight) {
        const l = prepare(lane.current, width, piano.laneHeight);
        if (l) drawLane(l, { ...scene, height: piano.laneHeight }, piano.lane);
      }
      // How long a frame took, for the stress tests.
      box.dataset.drawMs = (performance.now() - started).toFixed(2);
      box.dataset.notes = String(notes.length);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const stops = [
      useMusic.subscribe(schedule),
      usePiano.subscribe(schedule),
      useMusicUi.subscribe((s, p) => s.selectedChannelIds !== p.selectedChannelIds && schedule()),
      useTransport.subscribe((s, p) => s.startTick !== p.startTick && schedule()),
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

  // The playhead, moved every frame while the song plays.
  useEffect(() => {
    let frame = 0;
    const move = () => {
      const line = playhead.current;
      const song = useMusic.getState().history?.doc;
      if (line && song) {
        const tick = patternTickNow(useTransport.getState(), performance.now(), song.settings.tempo, PPQ);
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
      if (e.ctrlKey || e.metaKey) return piano.setView(zoomAt(view, x, view.pxPerTick * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
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
      style={{ gridTemplateColumns: `${KEYS_W}px 1fr ${SCROLLBAR}px`, gridTemplateRows: `${RULER_H}px 1fr ${laneHeight}px ${SCROLLBAR}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-r border-b bg-muted" />
      <div className="relative border-b">
        <canvas ref={ruler} className="absolute inset-0 size-full cursor-pointer" aria-label="Ruler" onPointerDown={rulerPointerDown} />
      </div>
      <div className="border-b bg-muted" />

      <canvas ref={keys} className="size-full border-r" aria-label="Keyboard" onPointerDown={keysPointerDown} />
      <div ref={gridBox} className="relative min-h-0 overflow-hidden" data-testid="piano-grid">
        <canvas
          ref={grid}
          className="absolute inset-0 size-full"
          style={{ cursor }}
          aria-label="Notes"
          onPointerDown={(e) => {
            // The grid's keys go to it: the window it's in comes to the front first.
            gridPointerDown(e);
          }}
          onPointerMove={(e) => e.buttons === 0 && setCursor(gridCursor(e.currentTarget, e))}
        />
        <div ref={playhead} className="pointer-events-none absolute inset-y-0 left-0 w-px bg-foreground opacity-0" />
      </div>
      <VerticalScrollbar />

      {laneHeight > 0 && (
        <>
          <button
            type="button"
            className="border-t border-r bg-muted px-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
            title="The property shown (F)"
            onClick={() => usePiano.setState({ lane: laneProperty === "velocity" ? "pan" : "velocity" })}
          >
            {laneProperty === "velocity" ? "Velocity" : "Pan"}
          </button>
          <canvas ref={lane} className="size-full cursor-ns-resize border-t" aria-label="Event editor" onPointerDown={lanePointerDown} />
          <div className="border-t" />
        </>
      )}
      <div className="border-t bg-muted" />
      <HorizontalScrollbar />
      <div className="border-t bg-muted" />
    </div>
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
    <div className="relative border-t bg-muted/60" aria-label="Scroll along time">
      <div
        className="absolute top-0.5 bottom-0.5 rounded-full bg-foreground/25 hover:bg-foreground/40"
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
      className="relative border-l bg-muted/60"
      aria-label="Scroll up and down the keyboard"
      // Up and down: drag the thumb. Its box, dragged, zooms the rows.
      onDoubleClick={() => usePiano.getState().setView({ ...view, rowHeight: 16 })}
    >
      <div
        className="absolute right-0.5 left-0.5 rounded-full bg-foreground/25 hover:bg-foreground/40"
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
