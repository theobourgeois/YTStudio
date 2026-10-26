/**
 * The music editor's mouse pointers: FL Studio's own, read out of the FL Studio on this computer
 * (`GET /api/music/cursors`, `shared/music/cursors.ts`), and ours where there's none. Each pointer here is a
 * CSS variable that `useFlCursors` defines while the editor is open, falling back to ours: so a cursor set
 * from code (`CURSOR.pen`) and one set by a class (`cursor-ns-resize`, overridden in `flCursorCss`) both
 * become FL's, in every window the page draws in (the stylesheet goes with the page's).
 *
 * Ours are FL's kind of cursor: white, outlined in near-black, so they read on light and dark grids
 * alike, each with its hot spot where the tool acts (the pencil's and the brush's tips, the knife's
 * point, the middle of the others).
 */
import { useEffect } from "react";
import { FL_CURSORS, type FlCursorName, type FlCursorsResponse } from "@shared/music/cursors";
import { musicApi } from "./api";

const DARK = "#15171a";

function svgCursor(body: string, x: number, y: number, fallback: string): string {
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

/** Ours, for when FL Studio isn't on this computer: what each falls back to. */
const OWN: Record<FlCursorName, string> = {
  // The pencil, its point at the bottom left.
  pen: svgCursor(solid("M17.6 2.4 L21.6 6.4 L9.4 18.6 L2.6 21.4 L5.4 14.6 Z") + ink("M5.4 14.6 L9.4 18.6") + ink("M15.2 4.8 L19.2 8.8") + `<path d='M2.6 21.4 L3.7 18.6 L5.4 20.3 Z' fill='${DARK}'/>`, 3, 21, "crosshair"),
  // The brush, its bristles' tip at the bottom left.
  brush: svgCursor(
    solid("M2.6 21.4 Q3 15.4 6.8 12.6 L11.4 17.2 Q8.6 21 2.6 21.4 Z") + solid("M6.8 12.6 L9 10.4 L13.6 15 L11.4 17.2 Z") + solid("M10.9 10.9 L18.8 3 Q20.8 1.9 21 4 Q21.1 5 20.3 5.8 L13.1 13.1 Z"),
    3,
    21,
    "crosshair",
  ),
  // The struck circle: what it touches goes.
  delete: svgCursor(line("M12 5.5 A6.5 6.5 0 1 1 11.99 5.5 Z M7.4 16.6 L16.6 7.4"), 12, 12, "not-allowed"),
  mute: svgCursor(solid(SPEAKER) + line("M15 9.6 L20 14.6 M20 9.6 L15 14.6", 2), 11, 12, "pointer"),
  // Upright, its straight edge down the cut and its point on the hot spot, where the line is drawn.
  slice: svgCursor(solid("M12 22 V9.5 H16.2 V14 Q16.2 19 12 22 Z") + `<path d='M11.8 9.5 V3 Q11.8 1.8 13 1.8 H15 Q16.2 1.8 16.2 3 V9.5 Z' fill='${DARK}' stroke='white' stroke-width='1'/>`, 12, 22, "crosshair"),
  play: svgCursor(solid(SPEAKER) + line("M15.6 8.8 V15.2 M19 7.2 V16.8", 2), 7, 12, "pointer"),
  select: "crosshair",
  zoom: "zoom-in",
  slip: "ew-resize",
  hand: "grab",
  handDrag: "grabbing",
  pan: "grab",
  grabPoint: "grabbing",
  addPoint: "crosshair",
  tension: "ns-resize",
  move: "move",
  moveV: "ns-resize",
  moveH: "ew-resize",
  sizeL: "ew-resize",
  sizeR: "ew-resize",
  rowSplit: "row-resize",
  columnSplit: "col-resize",
};

/** The keyword a cursor's picture falls back to (CSS wants one after the pictures). */
const keyword = (cursor: string) => cursor.slice(cursor.lastIndexOf(",") + 1).trim();

const variable = (name: FlCursorName) => `--fl-cursor-${name}`;

/** Every pointer the music editor shows, as a `cursor` value: FL Studio's when it's here, else ours. */
export const CURSOR = Object.fromEntries((Object.keys(FL_CURSORS) as FlCursorName[]).map((name) => [name, `var(${variable(name)}, ${OWN[name]})`])) as Record<FlCursorName, string>;

/** An audio clip's edge with the Playlist's Stretch on: a double arrow over a wave (its sound is stretched, not its window). FL has none of its own. */
export const STRETCH_CURSOR = svgCursor(
  line("M2.5 15 H21.5 M2.5 15 L5.8 11.7 M2.5 15 L5.8 18.3 M21.5 15 L18.2 11.7 M21.5 15 L18.2 18.3", 1.8) + line("M6 7 Q7.75 3.5 9.5 7 T13 7 T16.5 7 T18 6", 1.4),
  12,
  15,
  "ew-resize",
);

/** The plain pointers our classes ask for (Tailwind's `cursor-*`), and which of FL's each becomes, in this order (a later one wins). */
const CLASSES: [string, FlCursorName][] = [
  ["ns-resize", "moveV"],
  ["ew-resize", "moveH"],
  ["row-resize", "rowSplit"],
  ["col-resize", "columnSplit"],
  ["move", "move"],
  ["crosshair", "addPoint"],
  ["zoom-in", "zoom"],
  ["grab", "pan"],
  ["grabbing", "grabPoint"],
];

/**
 * The stylesheet that makes the editor wear FL's pointers: each as a variable (its picture, hot spot and the
 * plain one under it), and the plain pointers' classes made FL's, in Tailwind's utilities layer so a variant
 * (`focus:cursor-text`, `active:cursor-grabbing`) still wins over them as it did.
 */
export function flCursorCss(cursors: FlCursorsResponse["cursors"]): string {
  const names = (Object.keys(FL_CURSORS) as FlCursorName[]).filter((name) => cursors[name]);
  const variables = names.map((name) => {
    const { url, x, y } = cursors[name]!;
    return `  ${variable(name)}: url("${url}") ${x} ${y}, ${keyword(OWN[name])};`;
  });
  const classes = CLASSES.filter(([, name]) => cursors[name]).map(([plain, name]) => `  .cursor-${plain} { cursor: ${CURSOR[name]}; }`);
  return `:root {\n${variables.join("\n")}\n}\n@layer utilities {\n${classes.join("\n")}\n}\n`;
}

let loading: Promise<FlCursorsResponse["cursors"]> | null = null;

/** FL Studio's pointers, asked for once (none if the server can't say). */
function loadFlCursors(): Promise<FlCursorsResponse["cursors"]> {
  loading ??= musicApi.flCursors().then(
    (r) => r.cursors,
    () => ({}),
  );
  return loading;
}

/** Wear FL Studio's pointers while the music editor is open (and ours again once it's closed). */
export function useFlCursors(): void {
  useEffect(() => {
    let gone = false;
    let style: HTMLStyleElement | null = null;
    void loadFlCursors().then((cursors) => {
      if (gone || Object.keys(cursors).length === 0) return;
      style = document.createElement("style");
      style.dataset.flCursors = "";
      style.textContent = flCursorCss(cursors);
      document.head.append(style);
    });
    return () => {
      gone = true;
      style?.remove();
    };
  }, []);
}
