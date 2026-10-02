/**
 * The pitch graph's maths (`auto-tune-window.tsx`, `draw.ts`): notes as rows, a keyboard down its left,
 * readings placed by when they were, the view following the voice, and the Pitch Change meter.
 */
import { clamp } from "@shared/math";

/** Px of the keyboard down the graph's left. */
export const KEYS_WIDTH = 46;
/** Semitones the graph shows top to bottom. */
export const GRAPH_SPAN = 19;
/** Seconds of readings across it. */
export const GRAPH_SECONDS = 5;

export interface GraphView {
  width: number;
  height: number;
  /** The MIDI note at the graph's middle (a fraction: it glides). */
  centre: number;
}

const pxPerSemitone = (view: GraphView) => view.height / GRAPH_SPAN;

/** A note's y (its row's middle). */
export const noteY = (view: GraphView, note: number) => view.height / 2 - (note - view.centre) * pxPerSemitone(view);
/** The note at a y, to the nearest. */
export const noteAt = (view: GraphView, y: number) => Math.round(view.centre + (view.height / 2 - y) / pxPerSemitone(view));
/** The whole notes whose rows show, lowest first. */
export function visibleNotes(view: GraphView): number[] {
  const half = GRAPH_SPAN / 2 + 1;
  const out: number[] = [];
  for (let n = Math.floor(view.centre - half); n <= Math.ceil(view.centre + half); n++) out.push(n);
  return out;
}

/** A reading's x, `ago` ms before now: now is the right edge, `GRAPH_SECONDS` back the keyboard's. */
export const agoX = (view: GraphView, ago: number) => view.width - (ago / 1000 / GRAPH_SECONDS) * (view.width - KEYS_WIDTH);

/**
 * Where the graph's middle goes next: towards the note being sung (kept in view with a few rows to
 * spare, so it doesn't move for every note), gliding over `dt` ms; held when nothing is sung.
 */
export function followCentre(centre: number, sung: number | null, dt: number): number {
  if (sung === null) return centre;
  const margin = GRAPH_SPAN / 2 - 4;
  const wanted = sung > centre + margin ? sung - margin : sung < centre - margin ? sung + margin : centre;
  // Far away (the first note, an octave leap): straight there.
  if (Math.abs(wanted - centre) > GRAPH_SPAN) return wanted;
  return centre + (wanted - centre) * (1 - Math.exp(-dt / 120));
}

export const isBlackKey = (note: number) => [1, 3, 6, 8, 10].includes(((note % 12) + 12) % 12);
export const pitchClass = (note: number) => ((note % 12) + 12) % 12;

/** The Pitch Change meter's reading, -1..1 of its ±100 cents (left: the voice is lowered, it was sharp). */
export const meterFraction = (cents: number) => clamp(cents / 100, -1, 1);
