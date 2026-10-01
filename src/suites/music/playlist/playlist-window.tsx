import { type ReactNode, useEffect, useRef } from "react";
import { PiCaretDownBold, PiMagnet, PiSidebarSimple } from "react-icons/pi";
import { cn } from "cn";
import { applyDrag } from "./drag";
import { clipContext, songTicks } from "@shared/music/playlist";
import type { PlaylistClip } from "@shared/music/types";
import type { WaveformData } from "@shared/types";
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
import { carriesSamples, dropAsAudioClips } from "../browser/drops";
import { type Palette, prepare, readPalette } from "../piano/draw";
import { SNAPS, SNAP_LABELS, type Snap, snapTick, wheelZoomFactor } from "../piano/geometry";
import { DeleteIcon, DrawIcon, MuteIcon, PaintIcon, PlaybackIcon, SelectIcon, SliceIcon } from "../piano/tool-icons";
import { positionNow } from "../playhead";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { useMusicUi } from "../ui";
import { MusicWindow } from "../window";
import { clipSource, commitDrag, deleteSelected, duplicate, newClip, playlistContext, quantize, selectAll, setMuted, splitPattern } from "./actions";
import { type PlaylistScene, drawRuler, drawTracks, onWaveform, waveformAt } from "./draw";
import { MAX_PX_PER_TICK, MIN_PX_PER_TICK, scrollViewBy, tickToX, xToTick, yToTrack, zoomAt, zoomTracksAt } from "./geometry";
import { CLIP_DRAG_TYPE, Picker } from "./picker";
import { gridCursor, gridPointerDown, rulerPointerDown, trackSliceHover } from "./pointer";
import { type PlaylistTool, usePlaylist } from "./store";
import { TrackHeaders } from "./track-headers";

const HEADERS_W = 128;
const RULER_H = 22;
const SCROLLBAR = 12;
const MIN_W = 520;
const MIN_H = 260;

/** The slip tool's icon: a clip's content, moved inside it. */
function SlipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="12" height="8" rx="1" />
      <path d="M5 8h6M5 8l1.5-1.5M5 8l1.5 1.5M11 8l-1.5-1.5M11 8l-1.5 1.5" />
    </svg>
  );
}

const TOOLS: { tool: PlaylistTool; label: string; key: string; icon: (props: { className?: string }) => ReactNode }[] = [
  { tool: "draw", label: "Draw", key: "P", icon: DrawIcon },
  { tool: "paint", label: "Paint", key: "B", icon: PaintIcon },
  { tool: "delete", label: "Delete", key: "D", icon: DeleteIcon },
  { tool: "mute", label: "Mute", key: "T", icon: MuteIcon },
  { tool: "slip", label: "Slip", key: "S", icon: SlipIcon },
  { tool: "slice", label: "Slice", key: "C", icon: SliceIcon },
  { tool: "select", label: "Select", key: "E", icon: SelectIcon },
  { tool: "playback", label: "Playback", key: "Y", icon: PlaybackIcon },
];

/**
 * The Playlist (FL Studio's, `docs/fl-studio/playlist.md`): the song's arrangement, a window of tracks
 * with clips of patterns and audio on them, drawn on canvases (`draw.ts`) once a frame when something
 * changed. The mouse is `pointer.ts`, the keys `keys.ts`, the commands `actions.ts`. On its left, the
 * Picker panel (`picker.tsx`) and the track headers (`track-headers.tsx`).
 */
export function PlaylistWindow() {
  const pickerOpen = usePlaylist((s) => s.pickerOpen);
  const selectedCount = usePlaylist((s) => s.selected.size);
  const clipCount = useMusic((s) => s.history!.doc.playlist.clips.length);
  const songStart = useTransport((s) => s.songStartTick);
  const loop = useTransport((s) => `${s.loop.start}:${s.loop.ticks}`);
  return (
    <MusicWindow
      id="playlist"
      title="Playlist"
      // Maximised when it opens, as FL Studio's usually is; the rack and the Piano roll float over it.
      initial={{ x: 40, y: 30, width: 1000, height: 560, snap: "full" }}
      resizable={{ minWidth: MIN_W, minHeight: MIN_H }}
      onClose={() => {
        useMusicUi.getState().setPlaylistOpen(false);
        usePlaylist.setState({ drag: null });
      }}
      heading={<SourceMenu />}
      controls={<PlaylistControls />}
    >
      <div
        className="relative flex min-h-0 flex-1"
        data-testid="playlist"
        data-selected={selectedCount}
        data-clips={clipCount}
        data-start={songStart}
        data-loop={loop}
      >
        {pickerOpen && <Picker />}
        <PlaylistBody />
      </div>
    </MusicWindow>
  );
}

function PlaylistControls() {
  const tool = usePlaylist((s) => s.tool);
  const snap = usePlaylist((s) => s.snap);
  const pickerOpen = usePlaylist((s) => s.pickerOpen);
  return (
    <>
      <EditMenu />
      <button
        type="button"
        aria-label="Picker panel"
        aria-pressed={pickerOpen}
        title="Picker panel: the patterns and audio clips (Alt+P)"
        className={cn("grid size-5.5 place-items-center rounded-sm", pickerOpen ? "pressed text-brand" : "border border-transparent text-muted-foreground hover:raised hover:raised-hover")}
        onClick={() => usePlaylist.setState({ pickerOpen: !pickerOpen })}
      >
        <PiSidebarSimple className="size-3.5" />
      </button>
      <div className="flex items-center gap-0.5" role="toolbar" aria-label="Playlist tools">
        {TOOLS.map(({ tool: id, label, key, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={tool === id}
            title={`${label} (${key})`}
            className={cn("grid size-5.5 place-items-center rounded-sm", tool === id ? "pressed text-brand" : "border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground")}
            onClick={() => usePlaylist.getState().setTool(id)}
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
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Snap (Alt: none)</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={snap} onValueChange={(value) => usePlaylist.setState({ snap: value as Snap })}>
            {SNAPS.map((id) => (
              <DropdownMenuRadioItem key={id} value={id}>
                {SNAP_LABELS[id]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** The Playlist's Edit menu (the arrow): what's done to the selected clips, or all of them. */
function EditMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Playlist menu" title="Edit" className="grid size-5.5 place-items-center rounded-sm border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground">
          <PiCaretDownBold className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>The selection, or every clip</DropdownMenuLabel>
        <DropdownMenuItem onSelect={duplicate}>
          Duplicate <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={deleteSelected}>
          Delete <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setMuted(true)}>
          Mute <DropdownMenuShortcut>⌥M</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setMuted(false)}>
          Unmute <DropdownMenuShortcut>⌥⇧M</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={quantize}>
          Quick quantize start times <DropdownMenuShortcut>⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={selectAll}>
          Select all <DropdownMenuShortcut>⌘A</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The title, "Playlist › source", is the clip source selector, as in FL Studio: what Draw and Paint add.
 * Its menu lists the patterns and the audio clips.
 */
function SourceMenu() {
  const song = useMusic((s) => s.history!.doc);
  usePlaylist((s) => s.source);
  useMusic((s) => s.patternId);
  const source = clipSource(song);
  const name = source.kind === "pattern" ? song.patterns.find((p) => p.id === source.ref)?.name : song.channels.find((c) => c.id === source.ref)?.name;
  const audio = song.channels.filter((c) => c.kind === "audio");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Clip source"
          title="What Draw and Paint add (the clip source)"
          className="flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-medium hover:bg-surface-2 data-[state=open]:bg-surface-2"
        >
          <span className="truncate">Playlist › {name ?? "Pattern"}</span>
          <PiCaretDownBold className="size-2.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuRadioGroup
          value={`${source.kind}:${source.ref}`}
          onValueChange={(value) => {
            const [kind, ref] = value.split(/:(.*)/s);
            usePlaylist.setState({ source: { kind: kind as "pattern" | "audio", ref } });
            if (kind === "pattern") useMusic.getState().selectPattern(ref);
          }}
        >
          <DropdownMenuLabel>Patterns</DropdownMenuLabel>
          {song.patterns.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={`pattern:${p.id}`}>
              {p.name}
            </DropdownMenuRadioItem>
          ))}
          {audio.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Audio clips</DropdownMenuLabel>
              {audio.map((c) => (
                <DropdownMenuRadioItem key={c.id} value={`audio:${c.id}`}>
                  {c.name}
                </DropdownMenuRadioItem>
              ))}
            </>
          )}
        </DropdownMenuRadioGroup>
        {source.kind === "pattern" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => splitPattern(source.ref)}>Split by channel</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The last drag preview worked out, to reuse while neither the clips nor the drag change. */
let previewCache: { clips: PlaylistClip[]; drag: unknown; result: PlaylistClip[] } | null = null;

function PlaylistBody() {
  const grid = useRef<HTMLCanvasElement>(null);
  const ruler = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const gridBox = useRef<HTMLDivElement>(null);

  // Drawing: once a frame, when anything it shows has changed.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = 0;
      const started = performance.now();
      const p = playlistContext();
      const box = gridBox.current;
      if (!p || !box || !grid.current || !ruler.current) return;
      const playlist = usePlaylist.getState();
      const { gridWidth: width, gridHeight: height, view, drag } = playlist;
      let clips = p.clips;
      if (drag) {
        if (previewCache?.clips !== p.clips || previewCache.drag !== drag) previewCache = { clips: p.clips, drag, result: applyDrag(p.clips, drag, p.ctx).clips };
        clips = previewCache.result;
      }
      const { song } = p;
      const assets = useMusic.getState().assets;
      const waveforms = new Map<string, WaveformData>();
      for (const channel of song.channels) {
        if (channel.kind !== "audio") continue;
        const url = assets.find((a) => a.id === channel.sampleId)?.waveform;
        const data = url ? waveformAt(url) : null;
        if (data) waveforms.set(channel.id, data);
      }
      const palette: Palette = readPalette(box);
      const scene: PlaylistScene = {
        view,
        width,
        height,
        ctx: p.ctx,
        clips,
        selected: p.selected,
        tracks: song.playlist.tracks,
        layout: p.layout,
        patterns: new Map(song.patterns.map((pattern) => [pattern.id, pattern])),
        names: new Map([...song.patterns.map((pattern) => [pattern.id, pattern.name] as const), ...song.channels.map((c) => [c.id, c.name] as const)]),
        waveforms,
        barTicks: p.barTicks,
        beatTicks: p.beatTicks,
        songTicks: songTicks(song),
        time: playlist.time,
        drag,
        slice:
          drag?.kind === "slice"
            ? { tick: drag.tick, top: drag.top, bottom: drag.bottom }
            : !drag && playlist.sliceHover
              ? { tick: playlist.sliceHover.tick, top: playlist.sliceHover.track, bottom: playlist.sliceHover.track }
              : null,
        palette,
      };
      const g = prepare(grid.current, width, height);
      if (g) drawTracks(g, scene);
      const r = prepare(ruler.current, width, RULER_H);
      if (r) drawRuler(r, { ...scene, height: RULER_H }, useTransport.getState().songStartTick);
      box.dataset.drawMs = (performance.now() - started).toFixed(2);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const stops = [
      useMusic.subscribe(schedule),
      usePlaylist.subscribe(schedule),
      useTransport.subscribe((s, p) => s.songStartTick !== p.songStartTick && schedule()),
      onWaveform(schedule),
    ];
    const theme = new MutationObserver(schedule);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    const resize = new ResizeObserver(() => {
      const box = gridBox.current;
      if (box) usePlaylist.setState({ gridWidth: box.clientWidth, gridHeight: box.clientHeight });
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

  // Audio clips' waveforms are made after their file is added: ask for the media again until they're there.
  useEffect(() => {
    const timer = setInterval(() => {
      const { history, assets, projectId } = useMusic.getState();
      if (!history || !projectId) return;
      const missing = history.doc.channels.some((c) => c.kind === "audio" && assets.find((a) => a.id === c.sampleId)?.waveform === null);
      if (missing) void useMusic.getState().refreshAssets();
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // The pointer over the tracks changes with the tool, and with Ctrl (selecting), without moving.
  useEffect(() => {
    let last: { clientX: number; clientY: number } | null = null;
    const canvas = grid.current;
    if (!canvas) return;
    const refresh = (keys?: { ctrlKey: boolean; metaKey: boolean }) => {
      if (last && !usePlaylist.getState().drag) canvas.style.cursor = gridCursor(canvas, { ...last, ...keys });
    };
    const track = (e: PointerEvent) => (last = e.buttons === 0 ? { clientX: e.clientX, clientY: e.clientY } : last);
    const leave = () => (last = null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") refresh(e);
      if (e.key === "Shift") trackSliceHover(canvas, last && { ...last, altKey: e.altKey, shiftKey: e.type === "keydown" });
    };
    canvas.addEventListener("pointermove", track);
    canvas.addEventListener("pointerleave", leave);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    const stop = usePlaylist.subscribe((s, p) => s.tool !== p.tool && refresh());
    return () => {
      canvas.removeEventListener("pointermove", track);
      canvas.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      stop();
    };
  }, []);

  // The playhead, moved every frame while the song plays (song mode only: in pattern mode it's the pattern that plays).
  useEffect(() => {
    let frame = 0;
    const move = () => {
      const line = playhead.current;
      if (line) {
        const tick = useTransport.getState().mode === "song" ? positionNow() : null;
        const x = tick === null ? -10 : tickToX(usePlaylist.getState().view, tick);
        line.style.transform = `translateX(${x}px)`;
        line.style.opacity = tick === null ? "0" : "1";
      }
      frame = requestAnimationFrame(move);
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, []);

  // The wheel: up and down the tracks; Shift (or a sideways wheel) along time; Ctrl zooms about the pointer
  // (with Alt, the tracks' height).
  useEffect(() => {
    const box = gridBox.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const playlist = usePlaylist.getState();
      const { view } = playlist;
      const rect = box.getBoundingClientRect();
      if ((e.ctrlKey || e.metaKey) && e.altKey) return playlist.setView(zoomTracksAt(view, e.clientY - rect.top, view.trackHeight * wheelZoomFactor(e.deltaY, e.deltaMode)));
      if (e.ctrlKey || e.metaKey) return playlist.setView(zoomAt(view, e.clientX - rect.left, Math.min(MAX_PX_PER_TICK, Math.max(MIN_PX_PER_TICK, view.pxPerTick * wheelZoomFactor(e.deltaY, e.deltaMode)))));
      const p = playlistContext();
      const sideways = e.shiftKey ? e.deltaY : e.deltaX;
      const down = e.shiftKey ? 0 : e.deltaY;
      playlist.setView(scrollViewBy(view, sideways, down, p ? p.layout[p.layout.length - 1] : 0));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      className="grid min-w-0 flex-1 select-none"
      style={{ gridTemplateColumns: `${HEADERS_W}px minmax(0, 1fr) ${SCROLLBAR}px`, gridTemplateRows: `${RULER_H}px minmax(0, 1fr) ${SCROLLBAR}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-r border-b bg-muted" />
      <div className="relative border-b">
        <canvas ref={ruler} className="absolute inset-0 size-full cursor-pointer" aria-label="Ruler" onPointerDown={rulerPointerDown} />
      </div>
      <div className="border-b bg-muted" />

      <TrackHeaders />
      <div
        ref={gridBox}
        className="relative min-h-0 overflow-hidden"
        data-testid="playlist-grid"
        // Patterns and audio clips from the Picker, and audio files from the Browser and Finder.
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(CLIP_DRAG_TYPE) || carriesSamples(e.dataTransfer)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDrop={(e) => {
          const p = playlistContext();
          if (!p) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const { view } = usePlaylist.getState();
          const start = snapTick(xToTick(view, e.clientX - rect.left), e.altKey ? 1 : p.grid, "cell");
          const track = Math.min(yToTrack(p.layout, view, e.clientY - rect.top), p.trackCount - 1);
          if (e.dataTransfer.types.includes(CLIP_DRAG_TYPE)) {
            e.preventDefault();
            e.stopPropagation();
            dropClip(e.dataTransfer.getData(CLIP_DRAG_TYPE), start, track);
            return;
          }
          if (!carriesSamples(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          void dropAsAudioClips(e.dataTransfer, { start, track, after: e.shiftKey });
        }}
      >
        <canvas
          ref={grid}
          className="absolute inset-0 size-full"
          aria-label="Clips"
          onPointerDown={gridPointerDown}
          onPointerMove={(e) => {
            if (e.buttons !== 0) return;
            e.currentTarget.style.cursor = gridCursor(e.currentTarget, e);
            trackSliceHover(e.currentTarget, e);
          }}
          onPointerLeave={(e) => trackSliceHover(e.currentTarget, null)}
          onPointerUp={(e) => (e.currentTarget.style.cursor = gridCursor(e.currentTarget, e))}
        />
        <div ref={playhead} className="pointer-events-none absolute inset-y-0 left-0 w-px bg-foreground opacity-0" data-testid="playlist-playhead" />
      </div>
      <VerticalScrollbar />

      <div className="border-t border-r bg-muted" />
      <HorizontalScrollbar />
      <div className="border-t bg-muted" />
    </div>
  );
}

/** A clip dragged from the Picker, dropped at a tick on a track. */
function dropClip(data: string, start: number, track: number) {
  try {
    const source = JSON.parse(data) as { kind: "pattern" | "audio"; ref: string };
    if (source.kind !== "pattern" && source.kind !== "audio") return;
    usePlaylist.setState({ source });
    if (source.kind === "pattern") useMusic.getState().selectPattern(source.ref);
    const song = useMusic.getState().history?.doc;
    if (!song) return;
    usePlaylist.getState().setDrag({ kind: "add", clips: [newClip(song, source, start, track)] });
    commitDrag();
  } catch {
    // Not one of ours.
  }
}

function HorizontalScrollbar() {
  const view = usePlaylist((s) => s.view);
  const width = usePlaylist((s) => s.gridWidth);
  const content = useMusic((s) => songTicks(s.history!.doc) + clipContext(s.history!.doc).barTicks * 16);
  const total = Math.max(content, view.scrollTick + width / view.pxPerTick);
  const thumb = Math.max(24, (width * (width / view.pxPerTick)) / total);
  const left = ((width - thumb) * view.scrollTick) / Math.max(1, total - width / view.pxPerTick);
  return (
    <div className="relative border-t border-line bg-sunken" aria-label="Scroll along the song">
      <div
        className="raised absolute top-0.5 bottom-0.5 rounded-sm hover:raised-hover"
        style={{ left, width: thumb }}
        onPointerDown={(e) => {
          const origin = e.clientX;
          const start = view.scrollTick;
          const perPx = (total - width / view.pxPerTick) / Math.max(1, width - thumb);
          startPointerDrag(e, { threshold: 0, onMove: (ev) => usePlaylist.getState().setView({ ...usePlaylist.getState().view, scrollTick: Math.max(0, start + (ev.clientX - origin) * perPx) }) });
        }}
      />
    </div>
  );
}

function VerticalScrollbar() {
  const view = usePlaylist((s) => s.view);
  const height = usePlaylist((s) => s.gridHeight);
  // The tracks' whole height (the context's layout), read when anything it's made from changes.
  const total = useMusic((s) => {
    void s.history?.doc.playlist;
    return playlistContext()?.layout.at(-1) ?? height;
  });
  usePlaylist((s) => s.view.trackHeight);
  const content = Math.max(total, view.scrollY + height);
  const thumb = Math.max(24, (height * height) / Math.max(1, content));
  const top = ((height - thumb) * view.scrollY) / Math.max(1, content - height);
  return (
    <div className="relative border-l border-line bg-sunken" aria-label="Scroll up and down the tracks">
      <div
        className="raised absolute right-0.5 left-0.5 rounded-sm hover:raised-hover"
        style={{ top, height: thumb }}
        onPointerDown={(e) => {
          const origin = e.clientY;
          const start = view.scrollY;
          const perPx = (content - height) / Math.max(1, height - thumb);
          startPointerDrag(e, { threshold: 0, onMove: (ev) => usePlaylist.getState().setView({ ...usePlaylist.getState().view, scrollY: Math.max(0, Math.min(content - height, start + (ev.clientY - origin) * perPx)) }) });
        }}
      />
    </div>
  );
}
