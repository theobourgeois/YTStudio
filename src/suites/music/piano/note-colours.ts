/**
 * Notes' colours by velocity: quieter notes are drawn darker, as FL Studio draws them, so a pattern's
 * dynamics show on the grid. Pure (hex in, hex out), worked out once per palette colour and level and
 * kept, so drawing thousands of notes costs a lookup each.
 */
import { DEFAULT_VELOCITY } from "@shared/music/project";

/** A note's colours: its body from top to bottom, its outline and its name. */
export interface NoteColours {
  top: string;
  bottom: string;
  edge: string;
  text: string;
}

/** The notes' colours: content, the same in every theme (the palette carries them, `readPalette`). */
export const NOTE: NoteColours = { top: "#c2defe", bottom: "#83b6f2", edge: "#2e5e9c", text: "#0f2f57" };
export const SELECTED: NoteColours = { top: "#ffc2bd", bottom: "#f48b84", edge: "#9b3934", text: "#561712" };
export const MUTED: NoteColours = { top: "#b9c1bb", bottom: "#98a29b", edge: "#5d6660", text: "#39413b" };

/** How many shades between silent and the default velocity (velocities are rounded to them). */
export const VELOCITY_LEVELS = 24;
/** How far a silent note's body goes towards its darkest: far enough to tell at a glance, not so far it's lost on the grid. */
const DARKEST = 0.6;

type Rgb = [number, number, number];

function parse(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1];
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
}

const format = (rgb: Rgb) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** `a` taken `t` (0..1) of the way to `b`; `a` itself if either isn't a hex colour. */
export function mix(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  return x && y ? format(mixRgb(x, y, t)) : a;
}

/** A colour's relative luminance (WCAG), 0 for anything that isn't a hex colour. */
export function luminance(hex: string): number {
  const rgb = parse(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio between two colours (WCAG: 1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A note's colours at `level` of `VELOCITY_LEVELS`: the body goes towards a deep shade of its own
 * outline (it stays blue, or red, rather than turning grey), the outline darkens a little, and the
 * name darkens with it, or turns light once that reads better.
 */
function shade(colours: NoteColours, level: number): NoteColours {
  const amount = DARKEST * (1 - level / VELOCITY_LEVELS);
  const deep = mix(colours.edge, "#000000", 0.5);
  const top = mix(colours.top, deep, amount);
  const bottom = mix(colours.bottom, deep, amount);
  const body = mix(top, bottom, 0.5);
  const dark = mix(colours.text, "#000000", amount);
  const light = mix(colours.top, "#ffffff", 0.75);
  return {
    top,
    bottom,
    edge: mix(colours.edge, "#000000", amount / 2),
    text: contrast(dark, body) >= contrast(light, body) ? dark : light,
  };
}

const shades = new WeakMap<NoteColours, NoteColours[]>();

/**
 * A note's colours at its velocity (0..1): the default velocity (most notes) and louder are the colours
 * themselves, quieter ones darker down to silence.
 */
export function velocityColours(colours: NoteColours, velocity: number): NoteColours {
  const level = Math.round(Math.min(1, Math.max(0, (velocity || 0) / DEFAULT_VELOCITY)) * VELOCITY_LEVELS);
  if (level >= VELOCITY_LEVELS) return colours;
  let list = shades.get(colours);
  if (!list) shades.set(colours, (list = []));
  return (list[level] ??= shade(colours, level));
}
