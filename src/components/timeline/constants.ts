/** Layout + interaction constants for the timeline (all sizes in CSS px). */

export const HEADER_WIDTH = 152;
export const RULER_HEIGHT = 28;
export const TOOLBAR_HEIGHT = 40;
export const VIDEO_LANE_HEIGHT = 64;
export const AUDIO_LANE_HEIGHT = 48;
/** Vertical inset of a clip inside its lane. */
export const CLIP_INSET_Y = 4;
/** Empty strip above the first lane: drop a clip there to put it on a new video track. */
export const TOP_GUTTER = 22;
/** Minimum empty space below the last lane: drop there for a new audio track. */
export const BOTTOM_GUTTER = 56;

/** Pointer travel before a press on a clip becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
export const TRIM_THRESHOLD_PX = 2;
/** Pointer travel before a press on empty lane space becomes a marquee selection. */
export const MARQUEE_THRESHOLD_PX = 4;
/** Snap distance in screen pixels (converted to seconds with the zoom). */
export const SNAP_PX = 8;

/** Content is virtualised in chunks of this many px (plus one chunk of overscan each side). */
export const CHUNK_PX = 512;

/** Edge auto-scroll while dragging: zone width and max speed (px per frame). */
export const EDGE_SCROLL_ZONE = 48;
export const EDGE_SCROLL_MAX_SPEED = 22;

/** Keep the playhead at least this far from the right edge while playing. */
export const PAGE_MARGIN = 24;

export const PANEL_DEFAULT_HEIGHT = 300;
export const PANEL_MIN_HEIGHT = 180;
export const PANEL_MAX_FRACTION = 0.7;
