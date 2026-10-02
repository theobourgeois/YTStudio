/**
 * OTT's display (`docs/xfer/ott.md`): a row a band, high at the top (H, M, L), its level across from the
 * display's floor (left) to full scale (right). Pure, so it's tested.
 */
import { clamp } from "@shared/math";
import { OTT_THRESHOLD_SHIFT } from "@shared/music/ott";
import { MAX_OTT_STRENGTH } from "@shared/music/ott-presets";

/** The display's left edge (dB); its right is full scale. */
export const OTT_FLOOR_DB = -84;
/** The bands as the rows show them, top to bottom: high, mid, low (their indexes in the song). */
export const ROW_BANDS = [2, 1, 0] as const;
export const ROW_LABELS = ["H", "M", "L"] as const;

/** Where a level (dB) is across a row `width` px wide. */
export const levelX = (db: number, width: number) => (clamp((db - OTT_FLOOR_DB) / -OTT_FLOOR_DB, 0, 1) * width);
/** The level (dB) at `x` px across a row. */
export const xLevel = (x: number, width: number) => OTT_FLOOR_DB + (clamp(x, 0, width) / width) * -OTT_FLOOR_DB;

/** The row (0..2, top first) at `y` px down a display of rows `rowHeight` px tall with `gap` px between them, or null between rows. */
export function rowAt(y: number, rowHeight: number, gap: number): number | null {
  const row = Math.floor(y / (rowHeight + gap));
  if (row < 0 || row > 2 || y - row * (rowHeight + gap) > rowHeight) return null;
  return row;
}

/** Which part of a band's row a level is in: its upward range (left of the upward knee), its downward range (right of the downward knee), or the gap between. */
export function zoneAt(db: number, upKnee: number, downKnee: number): "up" | "down" | "gap" {
  if (db <= upKnee) return "up";
  if (db >= downKnee) return "down";
  return "gap";
}

/** A band's threshold after its gap has been dragged `dx` px across a row `width` px wide (from `start`). */
export function draggedThreshold(band: number, start: number, dx: number, width: number): number {
  const db = (dx / width) * -OTT_FLOOR_DB;
  return clamp(start + db / OTT_THRESHOLD_SHIFT[band], 0, MAX_OTT_STRENGTH);
}

/** A level said for the display's tooltip. */
export const dbText = (db: number) => (db <= OTT_FLOOR_DB ? "−∞ dB" : `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`);
