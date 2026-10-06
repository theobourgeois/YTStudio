/**
 * The Move tool's pointers over a layer's transform (Photoshop's): a double arrow along the way each handle pulls,
 * turned with the layer, and a curved arrow just outside a corner, where a drag rotates.
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

/** A curved double arrow (an SVG cursor, white with a dark edge so it reads on any picture), centred on its middle. */
const ROTATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 15.5a8 8 0 0 1 10-10" stroke="#111" stroke-width="4"/><path d="M5.5 15.5a8 8 0 0 1 10-10" stroke="#fff" stroke-width="1.8"/><path d="M3 12.5l2.5 3.5 3.5-2.5M12.5 3l3.5 2.5-2.5 3.5" stroke="#111" stroke-width="4"/><path d="M3 12.5l2.5 3.5 3.5-2.5M12.5 3l3.5 2.5-2.5 3.5" stroke="#fff" stroke-width="1.8"/></g></svg>`;

export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ROTATE_SVG)}") 12 12, grab`;
