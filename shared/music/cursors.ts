/**
 * FL Studio's own mouse pointers, for the music editor. They're Image-Line's artwork, so they aren't in the
 * app: the server reads them out of the FL Studio installed on this computer (`server/music/fl-cursors.ts`),
 * and with none the editor keeps its own (`src/suites/music/cursors.ts`).
 *
 * Each is named by what it's for, and says which of FL's cursor resources it is (in `FLEngine_x64.dll`).
 */
export const FL_CURSORS = {
  /** The Draw tool. */
  pen: "EEPEN",
  /** The Paint tool. */
  brush: "EEBRUSH",
  /** The Delete tool (and the right button sweeping). */
  delete: "EEDEL",
  /** The Mute tool. */
  mute: "EEMUTE",
  /** The Slice tool. */
  slice: "EECUT",
  /** The Playback tool. */
  play: "EEPLAY",
  /** The Select tool, and Ctrl held to select. */
  select: "EESEL",
  /** The Zoom tool. */
  zoom: "EEZOOM",
  /** The Playlist's Slip tool. */
  slip: "EESLIP",
  /** Over a note or a clip: a press takes it. */
  hand: "HAND3",
  /** A note or a clip being moved. */
  handDrag: "HANDDRAG",
  /** The open hand: what can be picked up and dragged (a window's title, a dial). */
  pan: "EEPAN",
  /** A point being dragged. */
  grabPoint: "MEGRABPOINT",
  /** Where a click adds a point. */
  addPoint: "ADDPOINT",
  /** An automation curve's tension. */
  tension: "MEMOVETENSION",
  /** Moved anywhere. */
  move: "MOVE",
  /** A value dragged up and down (a knob, a fader, a number). */
  moveV: "MOVEV",
  /** A value dragged sideways. */
  moveH: "MOVEH",
  /** A note's or a clip's start being moved. */
  sizeL: "SIZEL",
  /** A note's or a clip's end being moved. */
  sizeR: "SIZER",
  /** A split between rows (a track's height, the Piano roll's event pane). */
  rowSplit: "32764",
  /** A split between columns. */
  columnSplit: "32765",
} as const;

export type FlCursorName = keyof typeof FL_CURSORS;

/** One of them as a picture (a PNG `data:` URL) and its hot spot, in its pixels. */
export interface FlCursor {
  url: string;
  x: number;
  y: number;
}

/** `GET /api/music/cursors`: the ones this computer's FL Studio has; none without it. */
export interface FlCursorsResponse {
  cursors: Partial<Record<FlCursorName, FlCursor>>;
}
