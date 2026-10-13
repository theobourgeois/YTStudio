import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { addWindowListener } from "@/lib/window-events";
import { PiArrowLineRight, PiArrowsOutLineHorizontal, PiCaretDownBold, PiMagnet, PiMagnifyingGlass, PiSidebarSimple, PiStairs } from "react-icons/pi";
import { cn } from "cn";
import { applyDrag, shownSelection } from "./drag";
import { type ClipContext, clipLength, songTicks } from "@shared/music/playlist";
import { MAX_PLAYLIST_TRACKS } from "@shared/music/project";
import { type MusicProject, type PlaylistClip, STEP_TICKS } from "@shared/music/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { startPointerDrag } from "@/lib/pointer-drag";
import { carriedPaths, carriesSamples, dropAsAudioClips } from "../browser/drops";
import { type Palette, prepare, readPalette } from "../piano/draw";
import { SNAPS, SNAP_LABELS, type Snap, snapTick } from "../piano/geometry";
import { DeleteIcon, DrawIcon, MuteIcon, PaintIcon, PlaybackIcon, SelectIcon, SliceIcon } from "../piano/tool-icons";
import { positionNow } from "../playhead";
import { liveTakes, useRecording } from "../recording";
import { liveTakeTracks } from "@shared/music/recording";
import { trackName as mixerTrackName } from "@shared/music/mixer";
import { useMusic } from "../store";
import { createRails, isPinch, isPreciseWheel, watchControlKey, wheelScroll, wheelZoom } from "../wheel";
import { useTransport } from "../transport";
import { useMusicUi } from "../ui";
import { MusicWindow } from "../window";
import { ColorSwatches } from "../color-swatches";
import { bounceWithToast, rerenderWithToast, unconsolidateClips } from "./bounce";
import { StretchMenuItems } from "../stretch-menu";
import { autodetectTempo } from "../stretching";
import {
  cancelDrag,
  chopClip,
  clipSource,
  commitDrag,
  deleteSelected,
  duplicate,
  makeClipUnique,
  newClip,
  openClip,
  playlistContext,
  quantize,
  recolorSource,
  renameSource,
  selectAll,
  selectSimilar,
  consolidateSelected,
  setMuted,
  sourceName,
  splitPattern,
  zoomFloor,
  markersOf,
} from "./actions";
import { CURVE_NAMES, controlOf, deletePoint, editPoints, updatePoint } from "@shared/music/automation";
import { CURVE_TYPES, type CurveType, type MarkerKind } from "@shared/music/types";
import { AUTOMATION_TOOLS, type AutomationTool, createAutomationClip, openAutomationWindow, runTool } from "../automation/actions";
import { markerName, removeMarker, updateMarker } from "@shared/music/markers";
import { editClips, removeClips, setClipFades, setClipGain, setClipProps } from "@shared/music/playlist";
import { fadeOutClips, onClipFade, vanishingClips } from "./fades";
import { type PlaylistScene, drawRuler, drawTracks } from "./draw";
import { type WavePeaks, clipPeaks, onWaveform } from "./waveforms";
import { MAX_PX_PER_TICK, OVERVIEW_EDGE, scrollViewBy, tickToX, trackZoomDrag, xToTick, yToTrack, zoomAt, zoomTracksAt } from "./geometry";
import { CLIP_DRAG_TYPE, Picker } from "./picker";
import { clearIncoming, showIncoming } from "./incoming";
import { holdClipPreview } from "./preview";
import { openConvert } from "../convert/actions";
import { openExtractStems } from "../stems/actions";
import { gridCursor, gridPointerDown, rulerPointerDown, trackCurveHover, trackSliceHover } from "./pointer";
import { RULER_HEIGHT } from "./geometry";
import { type ClipSource, type PlaylistDrag, type PlaylistTool, usePlaylist } from "./store";
import { TrackHeaders } from "./track-headers";
import { OVERVIEW_HEIGHT, PlaylistOverview } from "./overview";

const HEADERS_W = 128;
const RULER_H = RULER_HEIGHT;
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
  { tool: "zoom", label: "Zoom", key: "Z", icon: ({ className }) => <PiMagnifyingGlass className={className} /> },
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
      tools={<PlaylistControls />}
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
  const stretch = usePlaylist((s) => s.stretch);
  const curveStep = usePlaylist((s) => s.curveStep);
  const curveSlide = usePlaylist((s) => s.curveSlide);
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
      <button
        type="button"
        aria-label="Stretch"
        aria-pressed={stretch}
        title="Stretch: an audio clip's edge stretches its sound instead of resizing it (Shift+M)"
        className={cn("grid size-5.5 place-items-center rounded-sm", stretch ? "pressed text-brand" : "border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground")}
        onClick={() => usePlaylist.setState({ stretch: !stretch })}
      >
        <PiArrowsOutLineHorizontal className="size-4" />
      </button>
      {/* FL's automation editing modes: how a drag on an automation clip's curve edits it. */}
      <button
        type="button"
        aria-label="Step mode"
        aria-pressed={curveStep}
        title="Step mode: a drag on an automation curve paints steps, one per grid cell"
        className={cn("grid size-5.5 place-items-center rounded-sm", curveStep ? "pressed text-brand" : "border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground")}
        onClick={() => usePlaylist.setState({ curveStep: !curveStep })}
      >
        <PiStairs className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Slide mode"
        aria-pressed={curveSlide}
        title="Slide mode: moving an automation point moves every point after it"
        className={cn("grid size-5.5 place-items-center rounded-sm", curveSlide ? "pressed text-brand" : "border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground")}
        onClick={() => usePlaylist.setState({ curveSlide: !curveSlide })}
      >
        <PiArrowLineRight className="size-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Snap" title="Snap" className="sunken flex h-5.5 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground hover:text-foreground">
            <PiMagnet className="size-3.5" />
            {SNAP_LABELS[snap]}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
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
        <DropdownMenuItem onSelect={consolidateSelected}>
          Consolidate <DropdownMenuShortcut>⌘⌥C</DropdownMenuShortcut>
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
  const name = sourceName(song, source);
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
            usePlaylist.setState({ source: { kind: kind as ClipSource["kind"], ref } });
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
          {song.automations.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Automation clips</DropdownMenuLabel>
              {song.automations.map((a) => (
                <DropdownMenuRadioItem key={a.id} value={`automation:${a.id}`}>
                  {a.name}
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
/** The selection as shown (a rectangle's, live), likewise. */
let selectionCache: { clips: PlaylistClip[]; drag: unknown; selected: ReadonlySet<number>; result: ReadonlySet<number> } | null = null;

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
      const sc = selectionCache;
      if (sc?.clips !== p.clips || sc.drag !== drag || sc.selected !== playlist.selected) {
        selectionCache = { clips: p.clips, drag, selected: playlist.selected, result: shownSelection(p.clips, drag, p.selected, p.ctx) };
      }
      const assets = useMusic.getState().assets;
      const waveforms = new Map<string, WavePeaks>();
      for (const channel of song.channels) {
        if (channel.kind !== "audio") continue;
        const url = assets.find((a) => a.id === channel.sampleId)?.src;
        const data = url ? clipPeaks(url, channel.precomputed) : null;
        if (data) waveforms.set(channel.id, data);
      }
      const palette: Palette = readPalette(box);
      const incoming = incomingClips(playlist.incoming, p.ctx);
      const fading = vanishingClips(performance.now());
      // Takes being recorded, where they'll land if they ended now.
      const takes = [...liveTakes()];
      const takeTracks = liveTakeTracks(
        song,
        takes.map(([track, pass]) => ({ track, start: pass.from, end: pass.ticks.at(-1) ?? pass.from })),
      );
      const scene: PlaylistScene = {
        view,
        width,
        height,
        ctx: p.ctx,
        clips,
        selected: selectionCache!.result,
        tracks: song.playlist.tracks,
        layout: p.layout,
        patterns: new Map(song.patterns.map((pattern) => [pattern.id, pattern])),
        // A curve being shaped is drawn as it would be left.
        automations: new Map(song.automations.map((a) => [a.id, drag?.kind === "curve" && drag.automationId === a.id ? { ...a, points: drag.points } : a])),
        names: new Map([
          ...song.patterns.map((pattern) => [pattern.id, pattern.name] as const),
          ...song.channels.map((c) => [c.id, c.name] as const),
          ...song.automations.map((a) => [a.id, a.name] as const),
          ...(playlist.incoming?.files.map((f, i) => [incoming[i].ref, f.name] as const) ?? []),
        ]),
        incoming,
        colors: new Map([...song.patterns, ...song.channels, ...song.automations].flatMap((source) => (source.color ? [[source.id, source.color] as const] : []))),
        waveforms,
        vanishing: fading,
        recording: takes.map(([track, pass], i) => ({ track: takeTracks[i], label: mixerTrackName(song, track), ...pass })),
        barTicks: p.barTicks,
        beatTicks: p.beatTicks,
        songTicks: songTicks(song),
        time: playlist.time,
        drag,
        // A marker being dragged is drawn where it'd be left.
        markers: drag?.kind === "marker" ? markersOf(song).map((m) => (m.id === drag.id ? { ...m, tick: drag.tick } : m)) : markersOf(song),
        slice:
          drag?.kind === "slice"
            ? { tick: drag.tick, top: drag.top, bottom: drag.bottom, all: drag.all }
            : !drag && playlist.sliceHover
              ? { tick: playlist.sliceHover.tick, top: 0, bottom: 0, all: true }
              : null,
        curveFocus: curveFocusOf(song, drag, playlist.curveHover),
        palette,
      };
      const g = prepare(grid.current, width, height);
      if (g) drawTracks(g, scene);
      const r = prepare(ruler.current, width, RULER_H);
      if (r) drawRuler(r, { ...scene, height: RULER_H }, useTransport.getState().songStartTick);
      box.dataset.drawMs = (performance.now() - started).toFixed(2);
      // The takes drawn as they record, on which tracks ("1,2"): for tests, which can't see the canvas.
      box.dataset.liveTakes = takeTracks.join(",");
      // Deleted clips still fading: another frame.
      if (fading.length) schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const stops = [
      // Not for what it doesn't draw: a mixer knob turned, a plugin's state, the pattern picked.
      useMusic.subscribe((state, prev) => {
        if (state.history !== prev.history) {
          const a = state.history?.doc;
          const b = prev.history?.doc;
          if (!a || !b || a.playlist !== b.playlist || a.patterns !== b.patterns || a.channels !== b.channels || a.automations !== b.automations || a.settings !== b.settings) schedule();
          return;
        }
        schedule();
      }),
      usePlaylist.subscribe(schedule),
      useTransport.subscribe((s, p) => s.songStartTick !== p.songStartTick && schedule()),
      onWaveform(schedule),
      onClipFade(schedule),
      useRecording.subscribe((s, p) => s.liveVersion !== p.liveVersion && schedule()),
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
    const stopKeys = [addWindowListener("keydown", onKey), addWindowListener("keyup", onKey)];
    const stop = usePlaylist.subscribe((s, p) => s.tool !== p.tool && refresh());
    return () => {
      canvas.removeEventListener("pointermove", track);
      canvas.removeEventListener("pointerleave", leave);
      for (const stopKey of stopKeys) stopKey();
      stop();
    };
  }, []);

  // The playhead, moved every frame while the song plays (song mode only: in pattern mode it's the pattern that plays).
  // Recording, it's red (the takes grow behind it as clips: `drawLiveTake`).
  useEffect(() => {
    let frame = 0;
    let shown = "";
    let wasInView = false;
    let lastTick: number | null = null;
    const move = () => {
      const line = playhead.current;
      if (line) {
        const transport = useTransport.getState();
        const tick = transport.mode === "song" ? positionNow() : null;
        let view = usePlaylist.getState().view;
        let x = tick === null ? -10 : tickToX(view, tick);
        // Playing, the view follows the playhead a page at a time, as FL's: once it runs off the right edge
        // (from in view: one scrolled away from stays where it was put), and not while something's dragged.
        const width = usePlaylist.getState().gridWidth;
        // Gone round the loop back to its start: back there too.
        const wrapped = tick !== null && lastTick !== null && tick < lastTick - 1 && (x < 0 || x > width - 2);
        lastTick = tick;
        if (tick !== null && transport.playing && wasInView && (x > width - 2 || wrapped) && !usePlaylist.getState().drag) {
          view = { ...view, scrollTick: Math.max(0, tick - (width * 0.02) / view.pxPerTick) };
          usePlaylist.getState().setView(view);
          x = tickToX(view, tick);
        }
        wasInView = x >= 0 && x <= width - 2;
        const active = useRecording.getState().active;
        const recording = active !== null && tick !== null && performance.now() >= active.movesAt;
        // Only what changed is written: stopped, the line stays put and the page has nothing to do.
        const next = `${x}|${tick === null}|${recording}`;
        if (next !== shown) {
          shown = next;
          line.style.transform = `translateX(${x}px)`;
          line.style.opacity = tick === null ? "0" : "1";
          line.style.background = recording ? "var(--destructive)" : "";
        }
      }
      frame = requestAnimationFrame(move);
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, []);

  // The wheel: up and down the tracks; Shift (or a sideways wheel) along time, a trackpad's held to the way
  // it set off; Ctrl, ⌘ or a pinch zooms about the pointer (with Alt, the tracks' height).
  useEffect(() => {
    const box = gridBox.current;
    if (!box) return;
    watchControlKey();
    const rails = createRails();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const playlist = usePlaylist.getState();
      const { view } = playlist;
      const rect = box.getBoundingClientRect();
      if ((e.ctrlKey || e.metaKey) && e.altKey) return playlist.setView(zoomTracksAt(view, e.clientY - rect.top, view.trackHeight * wheelZoom(e, isPinch(e))));
      if (e.ctrlKey || e.metaKey) {
        const min = zoomFloor();
        return playlist.setView(zoomAt(view, e.clientX - rect.left, Math.min(MAX_PX_PER_TICK, Math.max(min, view.pxPerTick * wheelZoom(e, isPinch(e)))), min));
      }
      const p = playlistContext();
      const { x: sideways, y: down } = isPreciseWheel(e) ? rails(wheelScroll(e), e.timeStamp) : wheelScroll(e);
      playlist.setView(scrollViewBy(view, sideways, down, p ? p.layout[p.layout.length - 1] : 0));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      className="grid min-w-0 flex-1 select-none"
      // The overview along the top is the scrollbar along time, as FL's is.
      style={{ gridTemplateColumns: `${HEADERS_W}px minmax(0, 1fr) ${SCROLLBAR}px`, gridTemplateRows: `${OVERVIEW_HEIGHT}px ${RULER_H}px minmax(0, 1fr)` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="row-span-2 border-r border-b bg-muted" />
      <PlaylistOverview />
      <div className="row-span-2 border-b bg-muted" />
      <div className="relative border-b">
        <canvas ref={ruler} className="absolute inset-0 size-full cursor-pointer" aria-label="Ruler" onPointerDown={rulerPointerDown} />
        <MarkerMenu />
        <MarkerRename />
      </div>

      <TrackHeaders />
      <div
        ref={gridBox}
        className="relative min-h-0 overflow-hidden"
        data-testid="playlist-grid"
        // Patterns and audio clips from the Picker (drawn where they'd land while they're dragged), and
        // audio files from the Browser and Finder.
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(CLIP_DRAG_TYPE)) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            const carried = usePlaylist.getState().carried;
            if (carried) showCarried(carried, e.currentTarget, e);
            return;
          }
          if (carriesSamples(e.dataTransfer)) {
            e.preventDefault();
            e.stopPropagation();
            // Shown where they'd land, as a pattern from the Picker is.
            const at = dropPoint(e.currentTarget, e);
            if (at) showIncoming(carriedPaths(), e.dataTransfer.items.length, at.start, at.track, e.shiftKey);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          if (usePlaylist.getState().drag?.kind === "add") cancelDrag();
          clearIncoming();
        }}
        onDrop={(e) => {
          const p = playlistContext();
          if (!p) return;
          if (e.dataTransfer.types.includes(CLIP_DRAG_TYPE)) {
            e.preventDefault();
            e.stopPropagation();
            dropClip(e.dataTransfer.getData(CLIP_DRAG_TYPE), e.currentTarget, e);
            return;
          }
          clearIncoming();
          const at = dropPoint(e.currentTarget, e);
          if (!at || !carriesSamples(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          // Selected once they're in, as clips from the Picker are.
          void dropAsAudioClips(e.dataTransfer, { ...at, after: e.shiftKey }).then((ids) => ids.length && usePlaylist.getState().select(ids));
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
            trackCurveHover(e.currentTarget, e);
          }}
          onPointerLeave={(e) => {
            trackSliceHover(e.currentTarget, null);
            trackCurveHover(e.currentTarget, null);
          }}
          onPointerUp={(e) => (e.currentTarget.style.cursor = gridCursor(e.currentTarget, e))}
        />
        <div ref={playhead} className="pointer-events-none absolute inset-y-0 left-0 w-px bg-foreground opacity-0" data-testid="playlist-playhead" />
        <ClipMenu />
        <PointMenu />
        <SourceEditor />
      </div>
      <VerticalScrollbar />
    </div>
  );
}

/**
 * A clip's menu (FL's, from the arrow at the start of its title): hear it on its own (held), open what
 * it plays, rename and recolour its source, make it unique, split its pattern by channel, chop it, select
 * the clips like it, mute it, delete it.
 */
function ClipMenu() {
  const menu = usePlaylist((s) => s.clipMenu);
  const clip = useMusic((s) => (menu ? s.history!.doc.playlist.clips.find((c) => c.id === menu.clipId) : undefined));
  if (!menu || !clip) return null;
  const close = () => usePlaylist.setState({ clipMenu: null });
  const only = new Set([clip.id]);
  const selected = usePlaylist.getState().selected;
  const stretchTarget = { kind: "clips" as const, ids: selected.has(clip.id) ? selected : only };
  const commit = (update: Parameters<typeof editClips>[1]) => useMusic.getState().commit((song) => editClips(song, update));
  const source = { kind: clip.kind, ref: clip.ref };
  const color = useMusic.getState().history?.doc && sourceColor(useMusic.getState().history!.doc, source);
  const p = playlistContext();
  const chops = p
    ? [
        { label: "Every bar", ticks: p.barTicks },
        { label: "Every beat", ticks: p.beatTicks },
        { label: "Every step", ticks: STEP_TICKS },
        ...(p.grid > 1 && ![p.barTicks, p.beatTicks, STEP_TICKS].includes(p.grid) ? [{ label: "At the snap", ticks: p.grid }] : []),
      ]
    : [];
  return (
    <DropdownMenu open onOpenChange={(open) => !open && close()}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none absolute size-px" style={{ left: menu.x, top: menu.y }} />
      </DropdownMenuTrigger>
      {/* Its trigger is only a point on the grid: focus stays where it goes next (the Rename and color box). */}
      <DropdownMenuContent align="start" data-testid="clip-menu" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem
          title="Hold to hear the clip on its own"
          // Held, as in FL Studio: it plays while the button's down, and the menu stays.
          onPointerDown={(e) => e.button === 0 && holdClipPreview(clip.id)}
          onSelect={(e) => e.preventDefault()}
        >
          Preview <DropdownMenuShortcut>hold</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openClip(clip)}>{clip.kind === "pattern" ? "Edit pattern" : clip.kind === "automation" ? "Automation settings" : "Channel settings"}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Opened once the menu has gone, so its closing doesn't close the box too. */}
        <DropdownMenuItem onSelect={() => setTimeout(() => usePlaylist.setState({ recoloring: { source, x: menu.x, y: menu.y } }))}>Rename and color…</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Change color</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto">
            <ColorSwatches value={color ?? null} onPick={(picked) => recolorSource(source, picked)} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {clip.kind === "pattern" ? (
          <>
            <DropdownMenuItem onSelect={() => makeClipUnique(clip.id)}>Make unique</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => splitPattern(clip.ref)}>Split by channel</DropdownMenuItem>
          </>
        ) : clip.kind === "automation" ? (
          <>
            {/* A curve of its own for this clip, so shaping it changes no other. */}
            <DropdownMenuItem onSelect={() => makeClipUnique(clip.id)}>Make unique</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Tools</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(Object.keys(AUTOMATION_TOOLS) as AutomationTool[]).map((tool) => (
                  <DropdownMenuItem key={tool} onSelect={() => runTool(clip.ref, tool)}>
                    {AUTOMATION_TOOLS[tool].name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : (
          <>
            {/* A channel of its own for this clip (the same file), so its pitch or volume changes it alone. */}
            <DropdownMenuItem onSelect={() => makeClipUnique(clip.id)}>Make unique as sample</DropdownMenuItem>
            {/* Its own stretch (FL 2025's variant), the selection's with it if it's selected. */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Stretch</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <StretchMenuItems target={stretchTarget} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => void autodetectTempo(stretchTarget)}>Detect tempo</DropdownMenuItem>
            {/* The models' (docs/fl-studio/stems-and-notes.md): its file split into stems, or heard as notes. Opened after the menu lets go of the focus. */}
            <DropdownMenuItem title="Split its file into vocals, drums, bass… on the tracks below it (FL's Extract stems from sample)" onSelect={() => setTimeout(() => openExtractStems({ channelId: clip.ref, clipId: clip.id }))}>
              Extract stems…
            </DropdownMenuItem>
            <DropdownMenuItem title="The notes played in it, as a pattern on a sampler under it" onSelect={() => setTimeout(() => openConvert({ channelId: clip.ref, clipId: clip.id }))}>
              Convert to notes…
            </DropdownMenuItem>
            {/* FL's Automate: an automation clip of its channel's volume or pan, over the clip. */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Automate</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(["volume", "pan"] as const).map((control) => (
                  <DropdownMenuItem
                    key={control}
                    onSelect={() => p && createAutomationClip({ kind: "channel", channel: clip.ref, control }, undefined, { start: clip.start, length: clipLength(clip, p.ctx), track: clip.track + 1 })}
                  >
                    {control === "volume" ? "Volume" : "Panning"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={clip.fadeIn === undefined && clip.fadeOut === undefined && clip.gain === undefined}
              onSelect={() => commit((clips) => setClipGain(setClipFades(clips, only, { fadeIn: 0, fadeOut: 0 }), only, 1))}
            >
              Reset fades and gain
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Chop</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {chops.map(({ label, ticks }) => (
              <DropdownMenuItem key={label} onSelect={() => chopClip(clip.id, ticks)}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {clip.kind !== "automation" && (
          <>
            <DropdownMenuItem
              title="Render it (and the clips selected with it) into audio clips in their place, one per mixer track they play into, before its effects; the clips go inside them (FL's Consolidate)"
              onSelect={() => void bounceWithToast(selected.has(clip.id) ? selected : only, true)}
            >
              Consolidate <DropdownMenuShortcut>⌘⌥C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              title="Render it (and the clips selected with it) into audio clips on the first free tracks below, the clips left as they are (FL's Render as audio clip)"
              onSelect={() => void bounceWithToast(selected.has(clip.id) ? selected : only, false)}
            >
              Render as audio clip
            </DropdownMenuItem>
          </>
        )}
        {clip.consolidated && (
          <>
            <DropdownMenuItem title="Render the clips inside it again, as their patterns and instruments are now: its copies and slices play the new file" onSelect={() => void rerenderWithToast(clip.id)}>
              Re-render
            </DropdownMenuItem>
            <DropdownMenuItem title="Put back the clips it was made from, where it is now" onSelect={() => unconsolidateClips(selected.has(clip.id) ? selected : only)}>
              Unconsolidate
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem
          onSelect={() => {
            usePlaylist.getState().select([clip.id]);
            selectSimilar();
          }}
        >
          Select all similar clips <DropdownMenuShortcut>⇧C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => commit((clips) => setClipProps(clips, only, { muted: !clip.muted }))}>{clip.muted ? "Unmute" : "Mute"}</DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            fadeOutClips([clip], usePlaylist.getState().selected);
            commit((clips) => removeClips(clips, only));
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A time marker's menu (a right-click on it, FL's): rename it, what it does (a marker, or where a recording starts or stops), delete it. */
function MarkerMenu() {
  const menu = usePlaylist((s) => s.markerMenu);
  const marker = useMusic((s) => (menu && s.history ? (s.history.doc.playlist.markers ?? []).find((m) => m.id === menu.id) : undefined));
  if (!menu || !marker) return null;
  const close = () => usePlaylist.setState({ markerMenu: null });
  const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);
  return (
    <DropdownMenu open onOpenChange={(open) => !open && close()}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none absolute bottom-0 size-px" style={{ left: menu.x }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="marker-menu" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel>{marker.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setTimeout(() => usePlaylist.setState({ renamingMarker: { id: marker.id, x: menu.x } }))}>Rename…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={marker.kind}
          onValueChange={(kind) =>
            commit((song) => {
              // Named for what it does when it's still called what it was.
              const was = markerName(song, marker.kind);
              const named = marker.name === was || marker.name === "Start recording" || marker.name === "Stop recording";
              return updateMarker(song, marker.id, { kind: kind as MarkerKind, ...(named && { name: markerName(song, kind as MarkerKind) }) });
            })
          }
        >
          <DropdownMenuRadioItem value="marker">Marker</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="punchIn">Start recording</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="punchOut">Stop recording</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => commit((song) => removeMarker(song, marker.id))}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A time marker's name being typed, in place on the ruler (Enter or leaving it keeps it, Escape doesn't). */
function MarkerRename() {
  const renaming = usePlaylist((s) => s.renamingMarker);
  const marker = useMusic((s) => (renaming && s.history ? (s.history.doc.playlist.markers ?? []).find((m) => m.id === renaming.id) : undefined));
  if (!renaming || !marker) return null;
  const done = (name: string | null) => {
    usePlaylist.setState({ renamingMarker: null });
    if (name !== null) useMusic.getState().commit((song) => updateMarker(song, marker.id, { name }));
  };
  return (
    <input
      aria-label="Marker name"
      defaultValue={marker.name}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      className="sunken absolute bottom-0 z-10 h-[13px] w-36 rounded-sm px-1 text-[10px] outline-none"
      style={{ left: renaming.x + 7 }}
      onBlur={(e) => done(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          usePlaylist.setState({ renamingMarker: null });
        }
      }}
    />
  );
}

/** The colour a clip's source has been given, if any. */
function sourceColor(song: MusicProject, source: ClipSource): string | null {
  const list = source.kind === "pattern" ? song.patterns : source.kind === "automation" ? song.automations : song.channels;
  return list.find((item) => item.id === source.ref)?.color ?? null;
}

/** The automation point to draw larger with its value: the one being dragged, else the one under the pointer. */
function curveFocusOf(song: MusicProject, drag: PlaylistDrag | null, hover: { automationId: string; index: number } | null) {
  const focus = drag?.kind === "curve" ? (drag.index === undefined ? null : { automationId: drag.automationId, index: drag.index, points: drag.points }) : drag ? null : hover;
  if (!focus) return null;
  const automation = song.automations.find((a) => a.id === focus.automationId);
  const point = ("points" in focus ? focus.points : automation?.points)?.[focus.index];
  if (!automation || !point) return null;
  const label = controlOf(song, automation.target).format(automation.min + point.value * (automation.max - automation.min));
  return { automationId: automation.id, index: focus.index, label };
}

/**
 * A point of an automation clip's curve, its menu (a right-click on it, FL's): the shape of the segment
 * arriving at it (the curve types), its value typed in, its tension straightened, deleting it.
 */
function PointMenu() {
  const menu = usePlaylist((s) => s.pointMenu);
  const automation = useMusic((s) => (menu ? s.history!.doc.automations.find((a) => a.id === menu.automationId) : undefined));
  const [typing, setTyping] = useState<string | null>(null);
  if (!menu || !automation) return null;
  const point = automation.points[menu.index];
  if (!point) return null;
  const close = () => usePlaylist.setState({ pointMenu: null });
  const commit = (change: Parameters<typeof editPoints>[2]) => useMusic.getState().commit((song) => editPoints(song, automation.id, change));
  const song = useMusic.getState().history!.doc;
  const info = controlOf(song, automation.target);
  const first = menu.index === 0;
  if (typing !== null) {
    return (
      <Popover open onOpenChange={(open) => !open && (setTyping(null), close())}>
        <PopoverTrigger asChild>
          <span aria-hidden className="pointer-events-none absolute size-px" style={{ left: menu.x, top: menu.y }} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-2" data-testid="point-value">
          <form
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(typing.replace(",", "."));
              if (Number.isFinite(value)) commit((points) => updatePoint(points, menu.index, { value: value / 100 }));
              setTyping(null);
              close();
            }}
          >
            <Input autoFocus aria-label="Point value" inputMode="decimal" className="h-7" value={typing} onChange={(e) => setTyping(e.target.value)} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => e.stopPropagation()} />
            % of its range
          </form>
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <DropdownMenu open onOpenChange={(open) => !open && close()}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none absolute size-px" style={{ left: menu.x, top: menu.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="point-menu" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          {info.name}: {info.format(automation.min + point.value * (automation.max - automation.min))}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={first ? "" : point.curve} onValueChange={(curve) => commit((points) => updatePoint(points, menu.index, { curve: curve as CurveType }))}>
          {CURVE_TYPES.map((curve) => (
            <DropdownMenuRadioItem key={curve} value={curve} disabled={first}>
              {CURVE_NAMES[curve]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {/* Opened once the menu has gone. */}
        <DropdownMenuItem onSelect={(e) => (e.preventDefault(), setTyping(String(Math.round(point.value * 1000) / 10)))}>Type in value…</DropdownMenuItem>
        <DropdownMenuItem disabled={first || point.tension === 0} onSelect={() => commit((points) => updatePoint(points, menu.index, { tension: 0 }))}>
          Reset tension
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled={first} onSelect={() => commit((points) => deletePoint(points, menu.index))}>
          Delete <DropdownMenuShortcut>⌥click</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openAutomationWindow(automation.id)}>Automation settings…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The clip menu's Rename and color (FL's dialog): the name of what the clip plays (its pattern, or its
 * audio clip's channel) and its colour, which every clip of it shows. Enter or a click away keeps the name;
 * Esc leaves it.
 */
function SourceEditor() {
  const editing = usePlaylist((s) => s.recoloring);
  const song = useMusic((s) => s.history?.doc);
  if (!editing || !song) return null;
  const { source } = editing;
  const name = sourceName(song, source) ?? "";
  const close = () => usePlaylist.setState({ recoloring: null });
  return (
    <Popover open onOpenChange={(open) => !open && close()}>
      <PopoverTrigger asChild>
        <span aria-hidden className="pointer-events-none absolute size-px" style={{ left: editing.x, top: editing.y }} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2" data-testid="rename-and-color" onFocusOutside={(e) => e.preventDefault()}>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("name");
            if (typeof value === "string") renameSource(source, value);
            close();
          }}
        >
          <Input
            name="name"
            aria-label={source.kind === "pattern" ? "Pattern name" : source.kind === "automation" ? "Automation clip name" : "Audio clip name"}
            className="h-7 text-xs"
            defaultValue={name}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => renameSource(source, e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.currentTarget.value = name;
                close();
              }
            }}
          />
          <ColorSwatches value={sourceColor(song, source)} onPick={(picked) => recolorSource(source, picked)} />
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** The files dragged over the tracks as clips, where they'd land: one per track down, or one after another (Shift). */
function incomingClips(incoming: ReturnType<typeof usePlaylist.getState>["incoming"], ctx: ClipContext): PlaylistClip[] {
  if (!incoming) return [];
  let start = incoming.start;
  return incoming.files.map((file, i) => {
    const length = file.seconds === null ? ctx.barTicks : Math.max(1, Math.round(file.seconds / ctx.secondsPerTick));
    const clip: PlaylistClip = { id: -1 - i, kind: "audio", ref: `incoming:${i}`, track: incoming.after ? incoming.track : incoming.track + i, start, length, offset: 0, muted: false };
    if (incoming.after) start += length;
    return clip;
  });
}

/** Where a clip dragged over the tracks would land: the cell under the pointer (Alt: no snap), on its track. */
function dropPoint(box: Element, ev: { clientX: number; clientY: number; altKey: boolean }): { start: number; track: number } | null {
  const p = playlistContext();
  if (!p) return null;
  const rect = box.getBoundingClientRect();
  const { view } = usePlaylist.getState();
  return {
    start: Math.max(0, snapTick(xToTick(view, ev.clientX - rect.left), ev.altKey ? 1 : p.grid, "cell")),
    track: Math.min(yToTrack(p.layout, view, ev.clientY - rect.top), p.trackCount - 1),
  };
}

/**
 * Clips being dragged from the Picker, shown where they'd land: an "add" drag, drawn as clips. Several
 * start together, a track under each other from the one under the pointer.
 */
function showCarried(sources: readonly ClipSource[], box: Element, ev: { clientX: number; clientY: number; altKey: boolean }) {
  const song = useMusic.getState().history?.doc;
  const at = dropPoint(box, ev);
  if (!song || !at || !sources.length) return;
  const drag = usePlaylist.getState().drag;
  const shown = drag?.kind === "add" ? drag.clips : null;
  if (shown?.length === sources.length && shown[0].start === at.start && shown[0].track === at.track && shown.every((c, i) => c.ref === sources[i].ref)) return;
  usePlaylist.getState().setDrag({ kind: "add", clips: sources.map((source, i) => newClip(song, source, at.start, Math.min(at.track + i, MAX_PLAYLIST_TRACKS - 1))) });
}

/** What a drag from the Picker carries: one source, or a list (several selected). */
function carriedSources(data: string): ClipSource[] | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    const list = (Array.isArray(parsed) ? parsed : [parsed]) as ClipSource[];
    return list.length && list.every((s) => s && (s.kind === "pattern" || s.kind === "audio" || s.kind === "automation") && typeof s.ref === "string") ? list : null;
  } catch {
    return null;
  }
}

/** Clips dragged from the Picker, dropped: they're added where they were shown, and the first becomes the clip source. */
function dropClip(data: string, box: Element, ev: { clientX: number; clientY: number; altKey: boolean }) {
  const sources = carriedSources(data);
  if (!sources) return cancelDrag(); // Not one of ours.
  const [source] = sources;
  usePlaylist.setState({ source, carried: null });
  if (source.kind === "pattern") useMusic.getState().selectPattern(source.ref);
  showCarried(sources, box, ev);
  commitDrag(true);
}

/** The scrollbar down the tracks: its window drags to scroll, and its ends to change the tracks' height (as the overview's zoom along time). */
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
  const zoom = (e: ReactPointerEvent, edge: "start" | "end") => {
    e.stopPropagation();
    const origin = e.clientY;
    const start = view;
    startPointerDrag(e, { threshold: 0, cursor: "ns-resize", onMove: (ev) => usePlaylist.getState().setView(trackZoomDrag(start, edge, ev.clientY - origin, thumb, height)) });
  };
  return (
    <div className="relative border-l border-line bg-sunken" aria-label="Scroll up and down the tracks">
      <div
        className="raised absolute right-0.5 left-0.5 rounded-sm hover:raised-hover"
        style={{ top, height: thumb }}
        data-testid="playlist-vertical-window"
        onPointerDown={(e) => {
          const origin = e.clientY;
          const start = view.scrollY;
          const perPx = (content - height) / Math.max(1, height - thumb);
          startPointerDrag(e, { threshold: 0, onMove: (ev) => usePlaylist.getState().setView({ ...usePlaylist.getState().view, scrollY: Math.max(0, Math.min(content - height, start + (ev.clientY - origin) * perPx)) }) });
        }}
      >
        <div className="absolute inset-x-0 top-0 cursor-ns-resize" style={{ height: OVERVIEW_EDGE }} onPointerDown={(e) => zoom(e, "start")} />
        <div className="absolute inset-x-0 bottom-0 cursor-ns-resize" style={{ height: OVERVIEW_EDGE }} onPointerDown={(e) => zoom(e, "end")} />
      </div>
    </div>
  );
}
