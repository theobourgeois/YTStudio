/**
 * The Piano roll's pointers: each tool has its own, as in FL Studio, and the same glyph as its button
 * (`tool-icons.tsx`): a pencil to draw, a brush to paint, the struck circle to delete, a muted speaker,
 * a knife to slice, a speaker to scrub. The pointer also says what a press would do where it is (move
 * a note, resize it by its edge). `gridCursor` picks one.
 *
 * They're FL's kind of cursor: white, outlined in near-black, so they read on light and dark grids
 * alike, each with its hot spot where the tool acts (the pencil's and the brush's tips, the knife's
 * point, the middle of the others).
 */

const DARK = "#15171a";

function cursor(body: string, x: number, y: number, fallback: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
}

/** A shape filled white, outlined dark. */
const solid = (d: string) => `<path d='${d}' fill='white' stroke='${DARK}' stroke-width='1.3'/>`;
/** A dark detail inside a shape. */
const ink = (d: string, width = 1.1) => `<path d='${d}' stroke='${DARK}' stroke-width='${width}'/>`;
/** A white line with a dark outline (drawn dark and wide, then white and narrow). */
const line = (d: string, width = 2.2) => `<path d='${d}' stroke='${DARK}' stroke-width='${width + 2}'/><path d='${d}' stroke='white' stroke-width='${width}'/>`;

const SPEAKER = "M3 9.2 H6.6 L11.6 5 V19 L6.6 14.8 H3 Z";

export const CURSORS = {
  // The pencil, its point at the bottom left.
  pencil: cursor(solid("M17.6 2.4 L21.6 6.4 L9.4 18.6 L2.6 21.4 L5.4 14.6 Z") + ink("M5.4 14.6 L9.4 18.6") + ink("M15.2 4.8 L19.2 8.8") + `<path d='M2.6 21.4 L3.7 18.6 L5.4 20.3 Z' fill='${DARK}'/>`, 3, 21, "crosshair"),
  // The brush, its bristles' tip at the bottom left.
  brush: cursor(
    solid("M2.6 21.4 Q3 15.4 6.8 12.6 L11.4 17.2 Q8.6 21 2.6 21.4 Z") + solid("M6.8 12.6 L9 10.4 L13.6 15 L11.4 17.2 Z") + solid("M10.9 10.9 L18.8 3 Q20.8 1.9 21 4 Q21.1 5 20.3 5.8 L13.1 13.1 Z"),
    3,
    21,
    "crosshair",
  ),
  // The struck circle: what it touches goes.
  eraser: cursor(line("M12 5.5 A6.5 6.5 0 1 1 11.99 5.5 Z M7.4 16.6 L16.6 7.4"), 12, 12, "not-allowed"),
  mute: cursor(solid(SPEAKER) + line("M15 9.6 L20 14.6 M20 9.6 L15 14.6", 2), 11, 12, "pointer"),
  // Upright, its straight edge down the cut and its point on the hot spot, where the line is drawn.
  knife: cursor(solid("M12 22 V9.5 H16.2 V14 Q16.2 19 12 22 Z") + `<path d='M11.8 9.5 V3 Q11.8 1.8 13 1.8 H15 Q16.2 1.8 16.2 3 V9.5 Z' fill='${DARK}' stroke='white' stroke-width='1'/>`, 12, 22, "crosshair"),
  speaker: cursor(solid(SPEAKER) + line("M15.6 8.8 V15.2 M19 7.2 V16.8", 2), 7, 12, "pointer"),
} as const;

/** A note's body (it's moved) and its right edge (it's resized). */
export const MOVE_CURSOR = "grab";
export const MOVING_CURSOR = "grabbing";
export const RESIZE_CURSOR = "ew-resize";
/** An audio clip's edge with the Playlist's Stretch on: a double arrow over a wave (its sound is stretched, not its window). */
export const STRETCH_CURSOR = cursor(
  line("M2.5 15 H21.5 M2.5 15 L5.8 11.7 M2.5 15 L5.8 18.3 M21.5 15 L18.2 11.7 M21.5 15 L18.2 18.3", 1.8) + line("M6 7 Q7.75 3.5 9.5 7 T13 7 T16.5 7 T18 6", 1.4),
  12,
  15,
  "ew-resize",
);
