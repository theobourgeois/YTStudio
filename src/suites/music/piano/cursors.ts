/**
 * The Piano roll's pointers: each tool has its own, as in FL Studio (a pencil to draw, a brush to
 * paint, an eraser, a muted speaker, a knife to slice, a speaker to scrub), and the pointer says what
 * a press would do where it is (move a note, resize it by its edge). `gridCursor` picks one.
 *
 * They're small SVGs, black lines on a white halo so they read on light and dark grids alike, each
 * with its hot spot where the tool acts (a pencil's tip, the knife's point).
 */

function cursor(body: string, x: number, y: number, fallback: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'>` +
    `<g stroke='white' stroke-width='3.6'>${body}</g><g stroke='#15171a' stroke-width='1.5'>${body}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
}

const PAPER = "fill='#f4f5f6'";
const INK = "fill='#15171a'";

export const CURSORS = {
  pencil: cursor(`<path d='M4 20 L5.4 15.1 L15.8 4.7 L19.3 8.2 L8.9 18.6 Z' ${PAPER}/><path d='M13.9 6.6 L17.4 10.1'/><path d='M4 20 L5.4 15.1 L8.9 18.6 Z' ${INK}/>`, 4, 20, "crosshair"),
  brush: cursor(
    `<path d='M20 4 L12.6 11.4'/><path d='M12.9 10.3 L13.7 11.1 Q14.5 12 13.6 13 L11.8 14.9 Q10 16.5 8 16 Q6.5 18.8 4 20 Q4.6 16.4 7 15 Q6.6 13 8.4 11.3 L10.3 9.5 Q11.3 8.6 12.1 9.5 Z' ${PAPER}/>`,
    4,
    20,
    "crosshair",
  ),
  eraser: cursor(`<path d='M3.5 15 L12 6.5 L18.5 13 L10.5 21 H6.5 Z' ${PAPER}/><path d='M7.8 10.7 L14.3 17.2' /><path d='M10.5 21 H20'/>`, 5, 18, "not-allowed"),
  mute: cursor(`<path d='M3 9.5 H6.5 L11.5 5.5 V18.5 L6.5 14.5 H3 Z' ${PAPER}/><path d='M15 9.5 L20 14.5 M20 9.5 L15 14.5'/>`, 11, 12, "pointer"),
  knife: cursor(`<path d='M12 23 L12 9 L16 5 L16 23 Z' ${PAPER}/><path d='M12.5 5 L12.5 1.5 H15.5 V5' ${INK}/>`, 12, 23, "crosshair"),
  speaker: cursor(`<path d='M3 9.5 H6.5 L11.5 5.5 V18.5 L6.5 14.5 H3 Z' ${PAPER}/><path d='M14.6 9.2 Q16.6 12 14.6 14.8 M17.4 6.6 Q21.3 12 17.4 17.4'/>`, 7, 12, "pointer"),
} as const;

/** A note's body (it's moved) and its right edge (it's resized). */
export const MOVE_CURSOR = "grab";
export const MOVING_CURSOR = "grabbing";
export const RESIZE_CURSOR = "ew-resize";
