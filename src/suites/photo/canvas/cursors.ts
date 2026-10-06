/**
 * The Move tool's pointers over a layer's transform (Photoshop's): a double arrow along the way each handle pulls,
 * turned with the layer, and a curved arrow just outside a corner, where a drag rotates, bowed around that corner.
 */

/**
 * The resize cursor for a handle that pulls along `angle` (degrees, screen space: 0 is right, 90 is down). The CSS
 * cursors come in four directions, so the angle is taken to the nearest one (either way along the line is the same).
 */
export function resizeCursor(angle: number): string {
  const a = ((angle % 180) + 180) % 180;
  const octant = Math.round(a / 45) % 4;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][octant];
}

/**
 * A curved double arrow (an SVG cursor, white with a dark edge so it reads on any picture), centred on its middle,
 * drawn bowed outwards to the right: `rotateCursor` turns it to bow around whichever corner it's outside.
 */
const ROTATE_PATHS = `<path d="M9.74 3.81a10 10 0 0 1 0 16.38" stroke="#111" stroke-width="4"/><path d="M9.74 3.81a10 10 0 0 1 0 16.38" stroke="#fff" stroke-width="1.8"/><path d="M13.92 3.07L9.74 3.81l.74 4.18M13.92 20.93l-4.18-.74.74-4.18" stroke="#111" stroke-width="4"/><path d="M13.92 3.07L9.74 3.81l.74 4.18M13.92 20.93l-4.18-.74.74-4.18" stroke="#fff" stroke-width="1.8"/>`;

const rotateCursors = new Map<number, string>();

/**
 * The rotate cursor outside a point lying `angle` (degrees, screen space: 0 is right, 90 is down) from the frame's
 * centre, Photoshop's: its arc bows around that corner. Taken to the nearest 15° so there are few cursors to make.
 */
export function rotateCursor(angle: number): string {
  const a = (((Math.round(angle / 15) * 15) % 360) + 360) % 360;
  let cursor = rotateCursors.get(a);
  if (!cursor) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round" transform="rotate(${a} 12 12)">${ROTATE_PATHS}</g></svg>`;
    cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, grab`;
    rotateCursors.set(a, cursor);
  }
  return cursor;
}
