import { create } from "zustand";
import type { NewNote, NotePatch, QuantizeEnds } from "@shared/music/notes";
import type { SongScale, StampId } from "@shared/music/scales";
import type { Note } from "@shared/music/types";
import { useMusic } from "../store";
import { selectInRack } from "../ui";
import type { PianoCursor } from "./cursor";
import type { PianoView, Snap } from "./geometry";

export const PIANO_TOOLS = ["draw", "paint", "delete", "mute", "slice", "select", "zoom", "playback"] as const;
/** The Piano roll's tool: what the left button does on the grid (FL Studio's, with its keys). */
export type PianoTool = (typeof PIANO_TOOLS)[number];

/** A property of notes the event editor (the lane under the grid) shows and edits. */
export type LaneProperty = "velocity" | "pan";

/** The Chopper's settings (Alt+U): kept between openings, as FL Studio keeps them. */
export interface ChopperSettings {
  /** A chop pattern's id (`CHOP_PATTERNS`). */
  patternId: string;
  /** Time mul: how much faster the pattern goes (one of `TIME_MULS`). */
  timeMul: number;
  /** The Levels knobs, 0..1. */
  velocity: number;
  pan: number;
  absolute: boolean;
}

export const DEFAULT_CHOPPER: ChopperSettings = { patternId: "default", timeMul: 1, velocity: 0, pan: 0, absolute: true };

/** The Quantizer's settings (Alt+Q): its grid (a snap; "line", "cell" and none: the Piano roll's snap, else a step), and `QuantizeOptions`' others. Kept between openings. */
export interface QuantizerSettings {
  snap: Snap;
  start: number;
  duration: number;
  sensitivity: number;
  swing: number;
  ends: QuantizeEnds;
}

export const DEFAULT_QUANTIZER: QuantizerSettings = { snap: "line", start: 1, duration: 1, sensitivity: 1, swing: 0, ends: "leaveDuration" };

export interface TimeRange {
  start: number;
  end: number;
}

/**
 * What a drag in the grid is doing, before it's let go. Nothing in the song changes until then: the
 * canvas draws the notes as the drag would leave them (`previewNotes`), and one edit is committed at
 * the end. So a drag of thousands of notes costs a redraw per frame, not an edit, a save and a song
 * sent to the engine per mouse move; and it's one undo step.
 */
export type PianoDrag =
  /** `scale`: the song's, the notes landing on its nearest notes (FL's Snap to scale; Alt: none). */
  | { kind: "move"; ids: ReadonlySet<number>; ticks: number; semitones: number; clone: boolean; scale?: SongScale | null }
  | { kind: "resize"; ids: ReadonlySet<number>; ticks: number }
  | { kind: "stretch"; ids: ReadonlySet<number>; factor: number; anchor: number }
  /** Notes being drawn or painted, not yet in the song. */
  | { kind: "add"; notes: NewNote[] }
  /** Notes swept by the right button (or the delete tool): gone when it's let go. */
  | { kind: "erase"; ids: ReadonlySet<number> }
  | { kind: "mute"; ids: ReadonlySet<number>; muted: boolean }
  /** The selection rectangle, in ticks and pitches. `add`: with what's already selected. */
  | { kind: "rect"; from: number; to: number; low: number; high: number; add: boolean }
  /**
   * The slice tool's line: straight down at `tick` (on the grid), across the rows from `low` to `high`,
   * or (`column`, Shift) through every row.
   */
  | { kind: "slice"; tick: number; low: number; high: number; column: boolean }
  /** The playback tool (scrubbing): the notes at `tick` sound. Changes no notes. */
  | { kind: "playback"; tick: number }
  /** Values being drawn in the event editor. */
  | { kind: "values"; values: ReadonlyMap<number, NotePatch> }
  /** The zoom tool's rectangle (FL's Z): what the view zooms to when it's let go. */
  | { kind: "zoom"; from: number; to: number; low: number; high: number };

interface PianoState {
  /** The channel whose notes it shows, or null (it then shows the first). */
  channelId: string | null;
  tool: PianoTool;
  snap: Snap;
  view: PianoView;
  /** The grid's size (measured; the zoom commands need it). */
  gridWidth: number;
  gridHeight: number;
  /** The event editor's height (0: hidden), its height when it's shown (dragged by its top edge), and the property it shows. */
  laneHeight: number;
  laneSize: number;
  lane: LaneProperty;
  ghosts: boolean;
  /** Selected notes, by id (of the channel shown, in the pattern shown). */
  selected: ReadonlySet<number>;
  /** The time selection: the red range on the ruler, which playback loops. */
  time: TimeRange | null;
  /** The length a new note gets: that of the last note added, resized or clicked. */
  noteLength: number;
  drag: PianoDrag | null;
  /** Notes copied (Ctrl+C), relative to the first. */
  copied: Note[] | null;
  /** The note whose properties dialog is open. */
  editing: number | null;
  /** The Chopper's window is open: the notes are drawn chopped until it's accepted or closed. */
  chopping: boolean;
  chopper: ChopperSettings;
  /** The Quantizer's window is open (Alt+Q): the notes are drawn quantized until it's accepted or closed. */
  quantizing: boolean;
  quantizer: QuantizerSettings;
  /** FL's Stamp: what Draw places with a click (a chord, or the scale's own), or null for a note. */
  stamp: StampId | null;
  /** The view before the zoom tool last zoomed in: its right-click goes back (and forth). */
  zoomBack: PianoView | null;
  /** The key held down on the keyboard, lit while it sounds. */
  heldKey: number | null;
  /** Where the slice tool would cut if pressed now (the pointer over the grid, no button down, Shift held: the whole column). */
  sliceHover: { tick: number; pitch: number } | null;
  /**
   * The keyboard's cursor (`cursor.ts`): where Enter puts a note and step edit writes what's played. Null
   * (not drawn) until the keyboard moves it or step edit is turned on.
   */
  cursor: PianoCursor | null;
  /** Step edit (Ctrl+E, FL's): the notes played on a MIDI keyboard or the typing keyboard are written at the cursor. */
  stepEdit: boolean;

  setChannel: (channelId: string | null) => void;
  setTool: (tool: PianoTool) => void;
  setSnap: (snap: Snap) => void;
  setView: (view: PianoView) => void;
  select: (ids: Iterable<number>) => void;
  setTime: (time: TimeRange | null) => void;
  setDrag: (drag: PianoDrag | null) => void;
}

export const DEFAULT_LANE_HEIGHT = 96;
/** The event editor's least height, and the least the notes keep above it when it's dragged taller. */
export const MIN_LANE_HEIGHT = 40;
export const MIN_NOTES_HEIGHT = 80;

const INITIAL = {
  channelId: null,
  tool: "draw" as PianoTool,
  snap: "line" as Snap,
  // About four bars across, and three octaves up from C4.
  view: { scrollTick: 0, pxPerTick: 0.5, topPitch: 84, rowHeight: 16 },
  gridWidth: 800,
  gridHeight: 360,
  laneHeight: DEFAULT_LANE_HEIGHT,
  laneSize: DEFAULT_LANE_HEIGHT,
  lane: "velocity" as LaneProperty,
  ghosts: true,
  selected: new Set<number>(),
  time: null,
  noteLength: 96,
  drag: null,
  copied: null,
  editing: null,
  chopping: false,
  chopper: DEFAULT_CHOPPER,
  quantizing: false,
  quantizer: DEFAULT_QUANTIZER,
  stamp: null as StampId | null,
  zoomBack: null as PianoView | null,
  heldKey: null,
  sliceHover: null as { tick: number; pitch: number } | null,
  cursor: null as PianoCursor | null,
  stepEdit: false,
};

export const usePiano = create<PianoState>((set, get) => ({
  ...INITIAL,
  // Another channel's notes are other notes: nothing of this one's stays selected.
  setChannel(channelId) {
    if (channelId !== get().channelId) set({ channelId, selected: new Set(), drag: null, editing: null });
    if (channelId) selectInRack(channelId);
  },
  setTool: (tool) => set({ tool, sliceHover: null }),
  setSnap: (snap) => set({ snap }),
  setView: (view) => set({ view }),
  select: (ids) => set({ selected: new Set(ids) }),
  setTime: (time) => set({ time }),
  setDrag: (drag) => set({ drag }),
}));

// Another song, or another pattern: the selection and the time selection were the old one's.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) {
    const { copied, laneHeight, laneSize, chopper } = usePiano.getState();
    usePiano.setState({ ...INITIAL, copied, laneHeight, laneSize, chopper });
  }
  else if (state.patternId !== prev.patternId) usePiano.setState({ selected: new Set(), time: null, drag: null, editing: null });
});
