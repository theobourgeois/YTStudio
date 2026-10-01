import { create } from "zustand";
import type { NewClip } from "@shared/music/playlist";
import type { PlaylistClip, PlaylistClipKind } from "@shared/music/types";
import type { Snap } from "../piano/geometry";
import { DEFAULT_TRACK_HEIGHT } from "./geometry";
import { useMusic } from "../store";
import { useMusicUi } from "../ui";

export const PLAYLIST_TOOLS = ["draw", "paint", "delete", "mute", "slip", "slice", "select", "playback"] as const;
/** The Playlist's tool: what the left button does on the tracks (FL Studio's, with its keys). */
export type PlaylistTool = (typeof PLAYLIST_TOOLS)[number];

/** How the tracks are scrolled and zoomed. */
export interface PlaylistView {
  /** The tick at the grid's left edge, and how wide a tick is. */
  scrollTick: number;
  pxPerTick: number;
  /** How far down the tracks are scrolled, in px, and a track's height at size 1. */
  scrollY: number;
  trackHeight: number;
}

/** What Draw and Paint add (FL's clip source): a pattern, or an audio clip's channel. */
export interface ClipSource {
  kind: PlaylistClipKind;
  ref: string;
}

export interface TimeRange {
  start: number;
  end: number;
}

/**
 * What a drag on the tracks is doing, before it's let go: nothing in the song changes until then. The
 * canvas draws the clips as the drag would leave them (`applyDrag`, `drag.ts`), and one edit is made at
 * the end (`commitDrag`), as in the Piano roll.
 */
export type PlaylistDrag =
  | { kind: "move"; ids: ReadonlySet<number>; ticks: number; tracks: number; clone: boolean }
  /** An edge dragged: the start (the window moves over the content) or the end. */
  | { kind: "resize"; ids: ReadonlySet<number>; edge: "start" | "end"; ticks: number }
  /** The slip tool: the content moves inside the windows. */
  | { kind: "slip"; ids: ReadonlySet<number>; ticks: number }
  /** Clips being drawn or painted, not yet in the song. */
  | { kind: "add"; clips: NewClip[] }
  /** Clips swept by the right button (or the delete tool): gone when it's let go. */
  | { kind: "erase"; ids: ReadonlySet<number> }
  | { kind: "mute"; ids: ReadonlySet<number>; muted: boolean }
  /** The selection rectangle, in ticks and tracks. `add`: with what's already selected. */
  | { kind: "rect"; from: number; to: number; top: number; bottom: number; add: boolean }
  /** The slice tool's line: straight down at `tick`, across the tracks from `top` to `bottom` (`all`, Shift: every track). */
  | { kind: "slice"; tick: number; top: number; bottom: number; all: boolean }
  /** The playback tool: where it's heard from. Changes no clips. */
  | { kind: "playback"; tick: number };

interface PlaylistState {
  tool: PlaylistTool;
  snap: Snap;
  view: PlaylistView;
  /** The grid's size (measured; zooming needs it). */
  gridWidth: number;
  gridHeight: number;
  /** Selected clips, by id. */
  selected: ReadonlySet<number>;
  /** The time selection on the ruler (song ticks), which song mode loops. */
  time: TimeRange | null;
  drag: PlaylistDrag | null;
  /** What Draw and Paint add; null: the current pattern. */
  source: ClipSource | null;
  /** Clips copied (Ctrl+C), relative to the first. */
  copied: PlaylistClip[] | null;
  /** The Picker panel (Alt+P) is shown. */
  pickerOpen: boolean;
  /** The track whose name is being typed, or null. */
  renaming: number | null;
  /** Where the slice tool would cut every track if pressed now (Shift held over the grid). */
  sliceHover: { tick: number } | null;
  /** A clip's menu, open (its arrow was clicked): which clip, and where in the grid. */
  clipMenu: { clipId: number; x: number; y: number } | null;
  /**
   * The patterns selected in the Picker (⌘-click, Shift+click), by id: what its menu and Alt+↑ / ↓ act
   * on. Empty: the pattern that's the clip source (`pickedPatterns`).
   */
  patternSelection: ReadonlySet<string>;
  /** The pattern last clicked in the Picker, where a Shift+click's range starts. */
  patternAnchor: string | null;
  /** What's being dragged from the Picker, while it's dragged (a drag's data can't be read until it's dropped). */
  carried: ClipSource | null;
  /** The patterns the Transpose window moves, while it's open for the Picker (null: the rack's channels). */
  transposing: readonly string[] | null;

  setTool: (tool: PlaylistTool) => void;
  setView: (view: PlaylistView) => void;
  select: (ids: Iterable<number>) => void;
  setDrag: (drag: PlaylistDrag | null) => void;
}


const INITIAL = {
  tool: "draw" as PlaylistTool,
  snap: "line" as Snap,
  // About sixteen bars across.
  view: { scrollTick: 0, pxPerTick: 0.15, scrollY: 0, trackHeight: DEFAULT_TRACK_HEIGHT },
  gridWidth: 900,
  gridHeight: 400,
  selected: new Set<number>() as ReadonlySet<number>,
  time: null as TimeRange | null,
  drag: null as PlaylistDrag | null,
  source: null as ClipSource | null,
  copied: null as PlaylistClip[] | null,
  pickerOpen: true,
  renaming: null as number | null,
  sliceHover: null as { tick: number } | null,
  clipMenu: null as { clipId: number; x: number; y: number } | null,
  patternSelection: new Set<string>() as ReadonlySet<string>,
  patternAnchor: null as string | null,
  carried: null as ClipSource | null,
  transposing: null as readonly string[] | null,
};

export const usePlaylist = create<PlaylistState>((set) => ({
  ...INITIAL,
  setTool: (tool) => set({ tool, sliceHover: null }),
  setView: (view) => set({ view }),
  select: (ids) => set({ selected: new Set(ids) }),
  setDrag: (drag) => set({ drag }),
}));

// The Transpose window closed (whichever way): it's the rack's again next time.
useMusicUi.subscribe((state, prev) => {
  if (prev.transposeOpen && !state.transposeOpen && usePlaylist.getState().transposing) usePlaylist.setState({ transposing: null });
});

// Another song: its own playlist (the clips copied stay, as notes copied do; so do the Picker and the zoom).
useMusic.subscribe((state, prev) => {
  if (state.projectId === prev.projectId) return;
  const { copied, pickerOpen, view } = usePlaylist.getState();
  usePlaylist.setState({ ...INITIAL, copied, pickerOpen, view: { ...view, scrollTick: 0, scrollY: 0 } });
});

// The pattern shown changed elsewhere (the toolbar, the rack): the Picker's selection follows it.
useMusic.subscribe((state, prev) => {
  if (state.patternId === prev.patternId || !state.patternId) return;
  const { patternSelection } = usePlaylist.getState();
  if (patternSelection.size && !patternSelection.has(state.patternId)) usePlaylist.setState({ patternSelection: new Set(), patternAnchor: state.patternId });
});
