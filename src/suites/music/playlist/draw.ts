/**
 * Drawing the Playlist: its tracks with their clips, and its ruler, each a canvas. Only what's in view is
 * drawn (`visibleClips`), so a song of thousands of clips draws in the time of a screenful. The component
 * calls these once a frame when something changed.
 *
 * The look is FL Studio's in our colours: the grid in bars shaded in turn (the Piano roll's theme colours,
 * `readPalette`), clips with a title strip over their content (a pattern's notes in miniature, an audio
 * file's waveform), their bodies see-through so the grid shows, red when selected, greyed when muted, and
 * darker on a muted track (as a muted mixer track is).
 */
import { type ClipContext, clipEnd, clipEnvelope, clipLength, clipSecondsPerTick, fadeShape, visibleClips } from "@shared/music/playlist";
import { AUTOMATION_COLOR } from "@shared/music/automation";
import type { Automation, Pattern, PlaylistClip, PlaylistTrack } from "@shared/music/types";
import { CURVE_PAD } from "../automation/curve-geometry";
import { drawCurve } from "../automation/draw-curve";
import { gridTicks } from "../piano/geometry";
import { type Palette, rulerMarks } from "../piano/draw";
import { MENU_FROM, MENU_TO, TITLE_HEIGHT, type TrackLayout, clipHandles, tickToX, trackTop, visibleTracks, xToTick } from "./geometry";
import type { VanishingClip } from "./fades";
import { type WavePeaks, peakRange } from "./waveforms";
import type { PlaylistDrag, PlaylistView, TimeRange } from "./store";

/** A clip's colours: its body, its title strip, what's drawn in it (notes, the waveform) and its name. */
export interface ClipColours {
  body: string;
  title: string;
  content: string;
  text: string;
}

/**
 * A clip's colours, FL Studio's way, all from one colour: its title strip that colour, its body a dark
 * shade of it (the grid faint behind), and what's drawn in it (notes, a waveform) a light tint of it, so
 * each clip reads as one hue (Théo). The same in every theme.
 */
export function clipColours(color: string): ClipColours {
  return { title: color, body: mix(color, "#101318", 0.55), content: mix(color, "#ffffff", 0.62), text: mix(color, "#ffffff", 0.88) };
}

/** FL's own: pattern clips blue-grey, audio clips green, automation clips violet; a selected clip red. */
export const PATTERN = clipColours("#5a78a6");
export const AUDIO = clipColours("#4f946c");
export const AUTOMATION = clipColours(AUTOMATION_COLOR);

/** The usual colours of a kind of clip. */
export const KIND_COLOURS = { pattern: PATTERN, audio: AUDIO, automation: AUTOMATION } as const;
const SELECTED = clipColours("#cc5a50");

/** How opaque a clip's body is (its title strip and content are solid): the grid shows faintly through, as in FL. */
const BODY_ALPHA = { light: 0.82, dark: 0.85 };
/** A clip on a muted track: its colours greyed towards this, and fainter. */
const MUTED_GREY = "#4a525c";
const MUTED_TRACK_ALPHA = 0.6;

/** A clip's colours on a muted track: greyed and darker, so it reads as off. */
function onMutedTrack(c: ClipColours): ClipColours {
  return { body: mix(c.body, MUTED_GREY, 0.6), title: mix(c.title, MUTED_GREY, 0.6), content: mix(c.content, MUTED_GREY, 0.55), text: mix(c.text, MUTED_GREY, 0.35) };
}

/** Two "#rrggbb" colours mixed, `amount` of the second. */
function mix(a: string, b: string, amount: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const part = (i: number) => Math.round(channel(a, i) * (1 - amount) + channel(b, i) * amount);
  return `#${[0, 1, 2].map((i) => part(i).toString(16).padStart(2, "0")).join("")}`;
}

export interface PlaylistScene {
  view: PlaylistView;
  width: number;
  height: number;
  ctx: ClipContext;
  /** The clips as the drag in progress would leave them. */
  clips: readonly PlaylistClip[];
  selected: ReadonlySet<number>;
  tracks: readonly PlaylistTrack[];
  layout: TrackLayout;
  patterns: ReadonlyMap<string, Pattern>;
  /** The automation clips by id (with the curve being dragged, as it would be left). */
  automations: ReadonlyMap<string, Automation>;
  /** Clip titles: a pattern's, an audio clip channel's or an automation clip's name, by ref. */
  names: ReadonlyMap<string, string>;
  /** The colours patterns and audio clip channels have been given, by ref (their clips take them). */
  colors: ReadonlyMap<string, string>;
  /** Audio files dragged over the tracks, drawn where they'd land (`incoming.ts`); their names are in `names`. */
  incoming: readonly PlaylistClip[];
  /** Clips just deleted, fading out (`fades.ts`). */
  vanishing: readonly VanishingClip[];
  /** An audio clip's waveform, by its channel's id, once it's loaded. */
  waveforms: ReadonlyMap<string, WavePeaks>;
  barTicks: number;
  beatTicks: number;
  /** Where the song ends (and goes round). */
  songTicks: number;
  time: TimeRange | null;
  drag: PlaylistDrag | null;
  /** Takes being recorded, drawn as they grow (until their clips come): on which track, and their levels. */
  recording: readonly LiveTakeDrawing[];
  /** The slice tool's line (tick and tracks, or `all` of them), while it's dragged or Shift shows it. */
  slice: { tick: number; top: number; bottom: number; all: boolean } | null;
  palette: Palette;
}

/** A take being recorded, as the Playlist draws it: from `from` (ticks), each level up to its tick. */
export interface LiveTakeDrawing {
  track: number;
  label: string;
  from: number;
  ticks: readonly number[];
  levels: readonly number[];
}

/** A take being recorded: FL's recording red. */
const RECORDING = clipColours("#c0453c");

/** The grid lines in view: `[tick, weight]`, weight 2 for bars, 1 for beats, 0 for the rest. */
function gridLines(view: PlaylistView, width: number, barTicks: number, beatTicks: number): [number, number][] {
  const grid = gridTicks(view.pxPerTick, barTicks, beatTicks);
  const lines: [number, number][] = [];
  const last = xToTick(view, width);
  for (let tick = Math.floor(view.scrollTick / grid) * grid; tick <= last; tick += grid) {
    if (tick < 0) continue;
    lines.push([tick, tick % barTicks === 0 ? 2 : tick % beatTicks === 0 ? 1 : 0]);
  }
  return lines;
}

/** A pattern's notes, every channel's, sorted by start, with their pitch range: what its clips draw. */
interface NoteSummary {
  starts: Float64Array;
  ends: Float64Array;
  pitches: Uint8Array;
  low: number;
  high: number;
}

const summaries = new WeakMap<Pattern["notes"], NoteSummary>();

function summary(pattern: Pattern): NoteSummary {
  let found = summaries.get(pattern.notes);
  if (!found) {
    const notes = Object.values(pattern.notes)
      .flat()
      .filter((n) => !n.muted)
      .sort((a, b) => a.start - b.start);
    let low = 127;
    let high = 0;
    for (const note of notes) {
      low = Math.min(low, note.pitch);
      high = Math.max(high, note.pitch);
    }
    found = {
      starts: Float64Array.from(notes, (n) => n.start),
      ends: Float64Array.from(notes, (n) => n.start + n.length),
      pitches: Uint8Array.from(notes, (n) => n.pitch),
      low: notes.length ? low : 60,
      high: notes.length ? high : 60,
    };
    summaries.set(pattern.notes, found);
  }
  return found;
}

/** The index of the first note starting at or after `tick`. */
function firstFrom(starts: Float64Array, tick: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (starts[mid] < tick) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The longest a pattern's notes are, so notes starting before what's in view can still be found. */
const longestNote = (s: NoteSummary) => {
  let longest = 0;
  for (let i = 0; i < s.starts.length; i++) longest = Math.max(longest, s.ends[i] - s.starts[i]);
  return longest;
};
const longest = new WeakMap<NoteSummary, number>();

/** A pattern clip's notes, in miniature: its window of the pattern, nothing past the pattern's end. */
function drawNotes(ctx: CanvasRenderingContext2D, scene: PlaylistScene, clip: PlaylistClip, pattern: Pattern, x: number, y: number, w: number, h: number, colour: string) {
  const s = summary(pattern);
  if (!s.starts.length || h < 4) return;
  let reach = longest.get(s);
  if (reach === undefined) longest.set(s, (reach = longestNote(s)));
  const { view } = scene;
  const offset = clip.offset;
  const patternEnd = scene.ctx.patternTicks(pattern.id);
  const end = Math.min(offset + clipLength(clip, scene.ctx), patternEnd);
  // Only the part of the clip in view.
  const fromTick = Math.max(offset, xToTick(view, Math.max(0, x)) - clip.start + offset);
  const toTick = Math.min(end, xToTick(view, Math.min(scene.width, x + w)) - clip.start + offset);
  if (toTick <= fromTick) return;
  const range = Math.max(12, s.high - s.low + 1);
  const pad = 2;
  const rowH = Math.max(1, Math.min(3, (h - pad * 2) / range));
  const top = y + pad + (h - pad * 2 - rowH * range) / 2;
  ctx.fillStyle = colour;
  for (let i = firstFrom(s.starts, fromTick - reach); i < s.starts.length && s.starts[i] < toTick; i++) {
    const start = Math.max(s.starts[i], offset);
    const stop = Math.min(s.ends[i], offset + clipLength(clip, scene.ctx));
    if (stop <= start || s.starts[i] >= end) continue;
    const nx = tickToX(view, clip.start + start - offset);
    const nw = Math.max(1, (stop - start) * view.pxPerTick - 1);
    ctx.fillRect(nx, top + (s.high - s.pitches[i]) * rowH + (range - (s.high - s.low + 1)) * rowH * 0.5, nw, rowH);
  }
}

/**
 * An audio clip's waveform, as FL Studio draws it: one filled shape along the highest sample under each
 * column and back along the lowest, from where the clip's window starts in its file.
 */
function drawWaveform(ctx: CanvasRenderingContext2D, scene: PlaylistScene, clip: PlaylistClip, peaks: WavePeaks, x: number, y: number, w: number, h: number, colour: string) {
  if (h < 4) return;
  const { view } = scene;
  const mid = y + h / 2;
  const half = h / 2 - 1.5;
  const from = Math.max(0, Math.floor(x));
  const to = Math.min(scene.width, Math.ceil(x + w));
  const count = to - from;
  if (count <= 0) return;
  // Where the file runs out, nothing more is drawn. A stretched clip goes through it more slowly.
  const fileEnd = peaks.samples.length;
  const perTick = clipSecondsPerTick(clip, scene.ctx);
  const sampleAt = (px: number) => (clip.offset + (xToTick(view, px) - clip.start) * perTick) * peaks.rate;
  // Its own gain and fades shape what's drawn, as they shape what's heard (louder than full scale draws full).
  const length = clipLength(clip, scene.ctx);
  const shaped = clip.gain !== undefined || clip.fadeIn !== undefined || clip.fadeOut !== undefined;
  const tops = new Float32Array(count);
  const bottoms = new Float32Array(count);
  let last = count;
  for (let i = 0; i < count; i++) {
    const a = sampleAt(from + i);
    if (a >= fileEnd) {
      last = i;
      break;
    }
    const [low, high] = peakRange(peaks, a, Math.max(a + 1, sampleAt(from + i + 1)));
    const level = shaped ? clipEnvelope(clip, length, xToTick(view, from + i + 0.5) - clip.start) : 1;
    // Never thinner than a hairline, so quiet parts still draw.
    tops[i] = mid - Math.max(0.5, Math.min(1, high * level) * half);
    bottoms[i] = mid - Math.min(-0.5, Math.max(-1, low * level) * half);
  }
  if (!last) return;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(from, tops[0]);
  for (let i = 0; i < last; i++) ctx.lineTo(from + i + 0.5, tops[i]);
  for (let i = last - 1; i >= 0; i--) ctx.lineTo(from + i + 0.5, bottoms[i]);
  ctx.closePath();
  ctx.fill();
}

export function drawTracks(ctx: CanvasRenderingContext2D, scene: PlaylistScene) {
  const { view, width, height, palette, layout, barTicks, beatTicks, time, drag } = scene;
  ctx.fillStyle = palette.row;
  ctx.fillRect(0, 0, width, height);
  // FL's time segments: every other bar a shade darker.
  const firstBar = Math.floor(view.scrollTick / barTicks);
  for (let bar = firstBar; tickToX(view, bar * barTicks) < width; bar++) {
    if (bar % 2 === 0) continue;
    ctx.fillStyle = palette.blackRow;
    ctx.fillRect(tickToX(view, bar * barTicks), 0, barTicks * view.pxPerTick, height);
  }
  for (const [tick, weight] of gridLines(view, width, barTicks, beatTicks)) {
    ctx.fillStyle = weight === 2 ? palette.barLine : weight === 1 ? palette.beatLine : palette.line;
    ctx.globalAlpha = weight === 2 ? 0.8 : 1;
    ctx.fillRect(Math.round(tickToX(view, tick)), 0, 1, height);
  }
  ctx.globalAlpha = 1;
  // Track separators, and what's below the last track.
  const [firstTrack, lastTrack] = visibleTracks(layout, view, height);
  for (let track = firstTrack; track <= lastTrack + 1 && track < layout.length; track++) {
    ctx.fillStyle = palette.beatLine;
    ctx.fillRect(0, Math.round(trackTop(layout, view, track)) - 1, width, 1);
  }
  // Muted tracks, shaded: what's on them doesn't play.
  for (let track = firstTrack; track <= lastTrack && track < layout.length - 1; track++) {
    if (!scene.tracks[track]?.muted) continue;
    const top = Math.round(trackTop(layout, view, track));
    ctx.fillStyle = palette.outside;
    ctx.fillRect(0, top, width, Math.round(trackTop(layout, view, track + 1)) - top - 1);
  }
  const bottom = trackTop(layout, view, layout.length - 1);
  if (bottom < height) {
    ctx.fillStyle = palette.outside;
    ctx.fillRect(0, Math.max(0, bottom), width, height - Math.max(0, bottom));
  }
  // Past the song's end.
  const end = tickToX(view, scene.songTicks);
  if (end < width) {
    ctx.fillStyle = palette.outside;
    ctx.fillRect(Math.max(0, end), 0, width - Math.max(0, end), Math.min(height, Math.max(0, bottom)));
  }
  if (time) {
    ctx.globalAlpha = palette.dark ? 0.12 : 0.09;
    ctx.fillStyle = palette.time;
    ctx.fillRect(tickToX(view, time.start), 0, (time.end - time.start) * view.pxPerTick, height);
    ctx.globalAlpha = 0.6;
    ctx.fillRect(Math.round(tickToX(view, time.start)), 0, 1, height);
    ctx.fillRect(Math.round(tickToX(view, time.end)) - 1, 0, 1, height);
    ctx.globalAlpha = 1;
  }

  drawClips(ctx, scene, firstTrack, lastTrack);
  for (const take of scene.recording) if (take.track >= firstTrack && take.track <= lastTrack) drawLiveTake(ctx, scene, take);

  if (drag?.kind === "rect") {
    const x = Math.round(tickToX(view, Math.min(drag.from, drag.to)));
    const y = Math.round(trackTop(layout, view, Math.min(drag.top, drag.bottom)));
    const w = Math.round(Math.abs(drag.to - drag.from) * view.pxPerTick);
    const h = Math.round(trackTop(layout, view, Math.max(drag.top, drag.bottom) + 1)) - y;
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = palette.time;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.time;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }
  if (scene.slice) {
    const x = Math.round(tickToX(view, scene.slice.tick)) + 0.5;
    const y1 = scene.slice.all ? 0 : trackTop(layout, view, Math.min(scene.slice.top, scene.slice.bottom));
    const y2 = scene.slice.all ? Math.min(height, bottom) : trackTop(layout, view, Math.max(scene.slice.top, scene.slice.bottom) + 1);
    ctx.strokeStyle = palette.tool;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  if (drag?.kind === "playback") {
    ctx.fillStyle = palette.tool;
    ctx.fillRect(Math.round(tickToX(view, drag.tick)), 0, 2, height);
  }
}

function drawClips(ctx: CanvasRenderingContext2D, scene: PlaylistScene, firstTrack: number, lastTrack: number) {
  const { view, width, clips, selected } = scene;
  const [from, to] = visibleClips(clips, xToTick(view, 0), xToTick(view, width), scene.ctx);
  ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  for (let i = from; i < to; i++) {
    const clip = clips[i];
    if (clip.track < firstTrack || clip.track > lastTrack) continue;
    drawClip(ctx, scene, clip, selected.has(clip.id), 1);
  }
  // Files being dragged in, see-through where they'd land.
  for (const clip of scene.incoming) drawClip(ctx, scene, clip, false, 0.7);
  // Clips just deleted, shrinking and fading where they were.
  for (const { clip, selected: was, progress } of scene.vanishing) {
    if (clip.track < firstTrack || clip.track > lastTrack) continue;
    const eased = 1 - (1 - progress) ** 2;
    const x = tickToX(view, clip.start);
    const w = clipEnd(clip, scene.ctx) * view.pxPerTick - clip.start * view.pxPerTick;
    const y = trackTop(scene.layout, view, clip.track);
    const h = trackTop(scene.layout, view, clip.track + 1) - y;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(1 - 0.15 * eased, 1 - 0.5 * eased);
    ctx.translate(-(x + w / 2), -(y + h / 2));
    drawClip(ctx, scene, clip, was, 1 - eased);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** Text widths in the clips' font, measured once each. */
const widths = new Map<string, number>();
const measure = (ctx: CanvasRenderingContext2D, text: string) => {
  let width = widths.get(text);
  if (width === undefined) {
    if (widths.size > 5000) widths.clear();
    widths.set(text, (width = ctx.measureText(text).width));
  }
  return width;
};

/** `text` cut to fit `width` with "…" at its end (never squeezed narrower), or nothing if not even a letter fits. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (width <= 0) return "";
  if (measure(ctx, text) <= width) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (measure(ctx, `${text.slice(0, mid).trimEnd()}…`) <= width) low = mid;
    else high = mid - 1;
  }
  return low ? `${text.slice(0, low).trimEnd()}…` : "";
}

/** One clip: its body, title strip and content (`alpha`: how much of it shows, for one fading out). */
function drawClip(ctx: CanvasRenderingContext2D, scene: PlaylistScene, clip: PlaylistClip, isSelected: boolean, alpha: number) {
  const { view, width, layout, palette } = scene;
  const bodyAlpha = palette.dark ? BODY_ALPHA.dark : BODY_ALPHA.light;
  const x = tickToX(view, clip.start);
  const right = tickToX(view, clipEnd(clip, scene.ctx));
  if (right < 0 || x > width) return;
  const y = Math.round(trackTop(layout, view, clip.track));
  const h = Math.round(trackTop(layout, view, clip.track + 1)) - y - 1;
  const w = Math.max(2, right - x);
  const track = scene.tracks[clip.track];
  // Its source's colour, else its track's, else the usual for its kind (FL's order).
  const color = scene.colors.get(clip.ref) ?? track?.color;
  const own = isSelected ? SELECTED : color ? clipColours(color) : KIND_COLOURS[clip.kind];
  const colours = track?.muted ? onMutedTrack(own) : own;
  const fade = (clip.muted ? 0.5 : 1) * (track?.muted ? MUTED_TRACK_ALPHA : 1) * alpha;
  // On whole pixels, edge to edge: clips one after another meet at their outlines, with no gap between.
  const left = Math.round(x);
  const across = Math.max(2, Math.round(right) - left);
  ctx.globalAlpha = bodyAlpha * fade * (clip.muted ? 0.8 : 1);
  ctx.fillStyle = colours.body;
  ctx.fillRect(left, y, across, h);
  ctx.globalAlpha = fade;
  const title = Math.min(TITLE_HEIGHT, h);
  ctx.fillStyle = colours.title;
  ctx.fillRect(left, y, across, title);
  // Its content, under the title.
  const bodyY = y + title;
  const bodyH = h - title - 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left + 1, bodyY, across - 2, bodyH);
  ctx.clip();
  if (clip.kind === "pattern") {
    const pattern = scene.patterns.get(clip.ref);
    if (pattern) {
      // Past the pattern's end, the clip plays nothing: drawn hollow there.
      const contentEnd = tickToX(view, clip.start + scene.ctx.patternTicks(pattern.id) - clip.offset);
      if (contentEnd < right) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
        ctx.fillRect(Math.max(x, contentEnd), bodyY, right - Math.max(x, contentEnd), bodyH);
      }
      drawNotes(ctx, scene, clip, pattern, x, bodyY, w, bodyH, colours.content);
    }
  } else if (clip.kind === "automation") {
    const automation = scene.automations.get(clip.ref);
    if (automation) {
      // Its curve from where the clip's window starts on it; past its end, the last value is held (drawn so).
      const box = { x0: x - clip.offset * view.pxPerTick, pxPerTick: view.pxPerTick, top: bodyY, height: bodyH };
      drawCurve(ctx, automation, box, x + 1, right - 1, { line: colours.content, point: colours.title }, bodyH >= 14 + CURVE_PAD * 2, scene.barTicks);
    }
  } else {
    const data = scene.waveforms.get(clip.ref);
    if (data) drawWaveform(ctx, scene, clip, data, x, bodyY, w, bodyH, colours.content);
    drawFades(ctx, scene, clip, x, bodyY, right, bodyH, colours.text);
  }
  ctx.restore();
  if (clip.kind === "audio") drawHandles(ctx, scene, clip, colours.text);
  // Its menu's arrow (FL's clip menu), then its name, kept in view as the playlist scrolls (FL's "Keep labels on screen").
  const arrow = w > MENU_TO + 4 && title >= 9;
  if (arrow) {
    const ax = x + MENU_FROM + 2;
    const ay = y + title / 2;
    ctx.fillStyle = colours.text;
    ctx.beginPath();
    ctx.moveTo(ax, ay - 2.5);
    ctx.lineTo(ax + 6, ay - 2.5);
    ctx.lineTo(ax + 3, ay + 2);
    ctx.closePath();
    ctx.fill();
  }
  if (w > 16 && title >= 9) {
    ctx.fillStyle = colours.text;
    const textX = Math.max(x + (arrow ? MENU_TO : 0), 0) + 4;
    ctx.fillText(ellipsize(ctx, clipTitle(scene, clip), right - textX - 3), textX, y + title / 2 + 0.5);
  }
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.strokeRect(left + 0.5, y + 0.5, across - 1, h - 1);
  ctx.globalAlpha = 1;
}

/** A clip's title: its source's name, and an audio clip's own gain and stretch when it has them ("Vocal · +3.5 dB · 2×"). */
function clipTitle(scene: PlaylistScene, clip: PlaylistClip): string {
  const name = scene.names.get(clip.ref) ?? "";
  if (clip.kind !== "audio" || (clip.gain === undefined && clip.stretch === undefined)) return name;
  const parts = [name];
  if (clip.gain !== undefined) parts.push(clip.gain > 0 ? `${clip.gain > 1 ? "+" : ""}${(20 * Math.log10(clip.gain)).toFixed(1)} dB` : "-∞ dB");
  if (clip.stretch !== undefined) parts.push(`${Number(clip.stretch.toFixed(3))}×`);
  return parts.join(" · ");
}

/** An audio clip's fades (FL's): what each takes off shaded above its curve, and the curve. */
function drawFades(ctx: CanvasRenderingContext2D, scene: PlaylistScene, clip: PlaylistClip, x: number, top: number, right: number, height: number, colour: string) {
  const { pxPerTick } = scene.view;
  const fade = (from: number, width: number, tension: number | undefined, rising: boolean) => {
    if (width < 1) return;
    const steps = Math.max(4, Math.min(64, Math.ceil(width / 3)));
    const point = (i: number) => {
      const t = i / steps;
      return { px: from + t * width, py: top + height - fadeShape(rising ? t : 1 - t, tension) * height };
    };
    ctx.beginPath();
    ctx.moveTo(from, top);
    for (let i = 0; i <= steps; i++) ctx.lineTo(point(i).px, point(i).py);
    ctx.lineTo(from + width, top);
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, point(i).px, point(i).py);
    ctx.strokeStyle = colour;
    ctx.globalAlpha *= 0.8;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha /= 0.8;
  };
  if (clip.fadeIn) fade(x, clip.fadeIn * pxPerTick, clip.fadeInTension, true);
  if (clip.fadeOut) fade(right - clip.fadeOut * pxPerTick, clip.fadeOut * pxPerTick, clip.fadeOutTension, false);
}

/** An audio clip's handles (FL's, when it's big enough to show them): triangles at its fades' corners, circles mid-curve, a half-circle for its gain. */
function drawHandles(ctx: CanvasRenderingContext2D, scene: PlaylistScene, clip: PlaylistClip, colour: string) {
  const handles = clipHandles(clip, scene.ctx, scene.layout, scene.view);
  if (!handles) return;
  ctx.fillStyle = colour;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = 1;
  const triangle = (at: { x: number; y: number }, towards: 1 | -1) => {
    ctx.beginPath();
    ctx.moveTo(at.x, at.y - 3);
    ctx.lineTo(at.x + towards * 5, at.y - 3);
    ctx.lineTo(at.x, at.y + 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  if (handles.fadeIn) triangle(handles.fadeIn, -1);
  if (handles.fadeOut) triangle(handles.fadeOut, 1);
  for (const at of [handles.fadeInTension, handles.fadeOutTension]) {
    if (!at) continue;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  if (handles.gain) {
    ctx.beginPath();
    ctx.arc(handles.gain.x, handles.gain.y + 3, 4, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * A take as it's recorded (the clip it'll be, growing): a red clip from where it began to where it's got
 * to, its title the track recording it, and the input's level drawn as a waveform as it comes.
 */
function drawLiveTake(ctx: CanvasRenderingContext2D, scene: PlaylistScene, take: LiveTakeDrawing) {
  const { view, layout, palette } = scene;
  const end = take.ticks.at(-1) ?? take.from;
  const left = Math.round(tickToX(view, take.from));
  const right = Math.round(tickToX(view, end));
  if (right < 0 || left > scene.width) return;
  const across = Math.max(2, right - left);
  const y = Math.round(trackTop(layout, view, take.track));
  const h = Math.round(trackTop(layout, view, take.track + 1)) - y - 1;
  ctx.globalAlpha = palette.dark ? BODY_ALPHA.dark : BODY_ALPHA.light;
  ctx.fillStyle = RECORDING.body;
  ctx.fillRect(left, y, across, h);
  ctx.globalAlpha = 1;
  const title = Math.min(TITLE_HEIGHT, h);
  ctx.fillStyle = RECORDING.title;
  ctx.fillRect(left, y, across, title);
  // The input so far, as finished clips draw their files: one shape along each peak and back below,
  // mirrored about the middle (a peak every 5 ms, so it's the take's own waveform as it comes).
  const bodyY = y + title;
  const bodyH = h - title - 1;
  if (bodyH >= 4 && take.levels.length) {
    const mid = bodyY + bodyH / 2;
    const half = bodyH / 2 - 1.5;
    // Only the peaks in view (and one either side), so a long take draws in the time of a screenful.
    let first = 0;
    while (first < take.ticks.length - 1 && tickToX(view, take.ticks[first + 1]) < 0) first++;
    let last = first;
    while (last < take.ticks.length - 1 && tickToX(view, take.ticks[last]) <= scene.width) last++;
    const height = (i: number) => Math.max(0.5, Math.min(1, take.levels[i]) * half);
    ctx.fillStyle = RECORDING.content;
    ctx.beginPath();
    ctx.moveTo(tickToX(view, first ? take.ticks[first - 1] : take.from), mid);
    for (let i = first; i <= last; i++) ctx.lineTo(tickToX(view, take.ticks[i]), mid - height(i));
    for (let i = last; i >= first; i--) ctx.lineTo(tickToX(view, take.ticks[i]), mid + height(i));
    ctx.closePath();
    ctx.fill();
  }
  if (across > 16 && title >= 9) {
    ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = RECORDING.text;
    const textX = Math.max(left, 0) + 4;
    ctx.fillText(ellipsize(ctx, `● ${take.label}`, right - textX - 3), textX, y + title / 2 + 0.5);
  }
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.strokeRect(left + 0.5, y + 0.5, across - 1, h - 1);
}

/** The ruler: bar numbers, the time selection in red, where the song ends, and where play starts. */
export function drawRuler(ctx: CanvasRenderingContext2D, scene: PlaylistScene, startTick: number) {
  const { view, width, height, palette, barTicks, beatTicks, time } = scene;
  ctx.fillStyle = palette.ruler;
  ctx.fillRect(0, 0, width, height);
  const end = tickToX(view, scene.songTicks);
  if (end < width) {
    ctx.fillStyle = palette.outside;
    ctx.fillRect(Math.max(0, end), 0, width - Math.max(0, end), height);
  }
  if (time) {
    const x = tickToX(view, time.start);
    const w = (time.end - time.start) * view.pxPerTick;
    ctx.fillStyle = palette.time;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(x, 0, w, height);
    ctx.globalAlpha = 1;
    ctx.fillRect(x, height - 6, w, 6);
  }
  rulerMarks(ctx, palette, height, barTicks, beatTicks, view.pxPerTick, (tick) => tickToX(view, tick), xToTick(view, 0), xToTick(view, width));
  // Where the song ends (and goes round).
  ctx.fillStyle = palette.tool;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(Math.round(end) - 1, 0, 1, height);
  ctx.globalAlpha = 1;
  // Where play starts: FL Studio's marker.
  const start = Math.round(tickToX(view, startTick));
  ctx.fillStyle = palette.start;
  ctx.beginPath();
  ctx.moveTo(start, 0);
  ctx.lineTo(start + 9, 0);
  ctx.lineTo(start + 9, 5);
  ctx.lineTo(start, 12);
  ctx.closePath();
  ctx.fill();
}

/**
 * The Picker's preview of a pattern (FL's): all its notes, every channel's, across the item, as its clips
 * show them. `width` and `height` in CSS pixels; `ticks` is the pattern's length.
 */
export function drawPatternPreview(ctx: CanvasRenderingContext2D, pattern: Pattern, ticks: number, width: number, height: number, colour: string) {
  ctx.clearRect(0, 0, width, height);
  const s = summary(pattern);
  if (!s.starts.length || ticks <= 0) return;
  const range = Math.max(12, s.high - s.low + 1);
  const rowH = Math.max(1, Math.min(2, (height - 4) / range));
  const top = 2 + (height - 4 - rowH * range) / 2 + (range - (s.high - s.low + 1)) * rowH * 0.5;
  const scale = width / ticks;
  ctx.fillStyle = colour;
  for (let i = 0; i < s.starts.length && s.starts[i] < ticks; i++) {
    const x = s.starts[i] * scale;
    ctx.fillRect(x, top + (s.high - s.pitches[i]) * rowH, Math.max(1, Math.min(s.ends[i], ticks) * scale - x - 0.5), rowH);
  }
}

/** The Picker's preview of an automation clip: its whole curve across the item, as its clips draw it. */
export function drawAutomationPreview(ctx: CanvasRenderingContext2D, automation: Automation, width: number, height: number, colour: string, barTicks: number) {
  ctx.clearRect(0, 0, width, height);
  drawCurve(ctx, automation, { x0: 0, pxPerTick: width / Math.max(1, automation.length), top: -1, height: height + 2 }, 0, width, { line: colour, point: colour }, false, barTicks);
}

/** The Picker's preview of an audio clip: its whole file's waveform across the item, as its clips draw it. */
export function drawWaveformPreview(ctx: CanvasRenderingContext2D, peaks: WavePeaks, width: number, height: number, colour: string) {
  ctx.clearRect(0, 0, width, height);
  const columns = Math.max(1, Math.floor(width));
  const per = peaks.samples.length / columns;
  const mid = height / 2;
  const half = height / 2 - 1;
  ctx.fillStyle = colour;
  ctx.beginPath();
  const bottoms: number[] = [];
  for (let x = 0; x < columns; x++) {
    const [low, high] = peakRange(peaks, x * per, (x + 1) * per);
    const y = mid - Math.max(0.5, Math.min(1, high) * half);
    if (x) ctx.lineTo(x + 0.5, y);
    else ctx.moveTo(0, y);
    bottoms.push(mid - Math.min(-0.5, Math.max(-1, low) * half));
  }
  for (let x = columns - 1; x >= 0; x--) ctx.lineTo(x + 0.5, bottoms[x]);
  ctx.closePath();
  ctx.fill();
}
