/**
 * Drawing OTT's display (`docs/xfer/ott.md`): a row a band (H, M, L), each on its own canvas, its upward range brown on the left
 * (to its upward knee), its downward range green on the right (from its downward knee), the gap between
 * them its row's colour; a grid every 12 dB; what comes out a yellow bar, and the band's level a white
 * marker. A compressor switched off is greyed. Colours are the theme's `--ott-*` tokens.
 */
import { OTT_FLOOR_DB, levelX } from "./geometry";

export interface OttColours {
  screen: string;
  row: string;
  grid: string;
  label: string;
  up: string;
  upEdge: string;
  down: string;
  downEdge: string;
  off: string;
  input: string;
  output: string;
  /** The page's sans-serif, for the rows' letters. */
  font: string;
}

let cached: { key: string; colours: OttColours } | null = null;
/** The display's colours (read again when the theme changes). */
export function ottColours(element: Element): OttColours {
  const key = `${document.documentElement.className}|${element.closest(".dark") !== null}`;
  if (cached?.key === key) return cached.colours;
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(`--ott-${name}`).trim();
  const colours: OttColours = {
    screen: read("screen"),
    row: read("row"),
    grid: read("grid"),
    label: read("label"),
    up: read("up"),
    upEdge: read("up-edge"),
    down: read("down"),
    downEdge: read("down-edge"),
    off: read("off"),
    input: read("input"),
    output: read("output"),
    font: style.getPropertyValue("--font-sans").trim() || "sans-serif",
  };
  cached = { key, colours };
  return colours;
}

/** A row as drawn: its band's knees (dB), which compressors are on, its level and what comes out (dB; null: nothing heard). */
export interface OttRow {
  upKnee: number;
  downKnee: number;
  upward: boolean;
  downward: boolean;
  level: number | null;
  output: number | null;
  /** Being dragged or under the pointer: its gap is lit. */
  hot: boolean;
}

/** Draw one band's row, `width` × `height` px, lettered `label`. */
export function drawRow(ctx: CanvasRenderingContext2D, width: number, height: number, row: OttRow, label: string, c: OttColours) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = c.row;
  ctx.fillRect(0, 0, width, height);

  const upX = Math.round(levelX(row.upKnee, width));
  const downX = Math.round(levelX(row.downKnee, width));
  // The two ranges, filled, each edged at its knee.
  ctx.fillStyle = row.upward ? c.up : c.off;
  ctx.fillRect(0, 0, upX, height);
  ctx.fillStyle = row.downward ? c.down : c.off;
  ctx.fillRect(downX, 0, width - downX, height);
  const edge = row.hot ? 2 : 1;
  ctx.fillStyle = row.upward ? c.upEdge : c.grid;
  ctx.fillRect(upX - edge, 0, edge, height);
  ctx.fillStyle = row.downward ? c.downEdge : c.grid;
  ctx.fillRect(downX, 0, edge, height);

  // The grid: a tick every 12 dB.
  ctx.fillStyle = c.grid;
  for (let db = OTT_FLOOR_DB + 12; db < 0; db += 12) ctx.fillRect(Math.round(levelX(db, width)), height - 4, 1, 4);

  // What comes out: a yellow bar along the row's middle; the level in, a white marker.
  if (row.output !== null && row.output > OTT_FLOOR_DB) {
    ctx.fillStyle = c.output;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, Math.round(height / 2) - 3, Math.round(levelX(row.output, width)), 6);
    ctx.globalAlpha = 1;
  }
  if (row.level !== null && row.level > OTT_FLOOR_DB) {
    ctx.fillStyle = c.input;
    ctx.fillRect(Math.round(levelX(row.level, width)) - 1, 4, 2, height - 8);
  }

  // Its letter, in the upward range's corner.
  ctx.fillStyle = c.label;
  ctx.font = `600 10px ${c.font}`;
  ctx.textBaseline = "top";
  ctx.fillText(label, 5, 4);
}
