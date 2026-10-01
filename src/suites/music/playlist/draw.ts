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
import { type ClipContext, clipEnd, clipLength, visibleClips } from "@shared/music/playlist";
import type { Pattern, PlaylistClip, PlaylistTrack } from "@shared/music/types";
import type { WaveformData } from "@shared/types";
import { gridTicks } from "../piano/geometry";
import type { Palette } from "../piano/draw";
import { MENU_FROM, MENU_TO, TITLE_HEIGHT, type TrackLayout, tickToX, trackTop, visibleTracks, xToTick } from "./geometry";
import type { PlaylistDrag, PlaylistView, TimeRange } from "./store";

/** A clip's colours: its body, its title strip, what's drawn in it (notes, the waveform) and its name. */
interface ClipColours {
  body: string;
  title: string;
  content: string;
  text: string;
}

/** Content colours (the same in every theme): FL's pattern clips are blue-grey, audio clips greener. */
const PATTERN: ClipColours = { body: "#8fa6c4", title: "#647da0", content: "#1d2c42", text: "#f4f7fb" };
const AUDIO: ClipColours = { body: "#8fb8a2", title: "#5f9077", content: "#173326", text: "#f2f8f4" };
const SELECTED: ClipColours = { body: "#f0a19b", title: "#d0625b", content: "#4d1410", text: "#fff5f4" };

/** How opaque a clip's body is (its title strip and content are solid): the grid shows through, as in FL. */
const BODY_ALPHA = { light: 0.5, dark: 0.6 };
/** A clip on a muted track: its colours greyed towards this, and fainter. */
const MUTED_GREY = "#4a525c";
const MUTED_TRACK_ALPHA = 0.6;

/** A clip's colours on a muted track: greyed and darker, so it reads as off. */
function onMutedTrack(c: ClipColours): ClipColours {
  return { body: mix(c.body, MUTED_GREY, 0.6), title: mix(c.title, MUTED_GREY, 0.6), content: mix(c.content, MUTED_GREY, 0.3), text: mix(c.text, MUTED_GREY, 0.35) };
}

/** A clip on a coloured track takes the track's colour. */
function colouredBy(color: string): ClipColours {
  return { body: mix(color, "#ffffff", 0.45), title: color, content: mix(color, "#000000", 0.6), text: "#ffffff" };
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
  /** Clip titles: a pattern's or an audio clip channel's name, by ref. */
  names: ReadonlyMap<string, string>;
  /** An audio clip's waveform, by its channel's id, once it's loaded. */
  waveforms: ReadonlyMap<string, WaveformData>;
  barTicks: number;
  beatTicks: number;
  /** Where the song ends (and goes round). */
  songTicks: number;
  time: TimeRange | null;
  drag: PlaylistDrag | null;
  /** The slice tool's line (tick and tracks, or `all` of them), while it's dragged or Shift shows it. */
  slice: { tick: number; top: number; bottom: number; all: boolean } | null;
  palette: Palette;
}

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

/** An audio clip's waveform, mirrored about its middle, from its file's peaks. */
function drawWaveform(ctx: CanvasRenderingContext2D, scene: PlaylistScene, clip: PlaylistClip, data: WaveformData, x: number, y: number, w: number, h: number, colour: string) {
  if (h < 4 || !data.peaks.length) return;
  const { view } = scene;
  const mid = y + h / 2;
  const half = h / 2 - 1;
  const from = Math.max(0, Math.floor(x));
  const to = Math.min(scene.width, Math.ceil(x + w));
  ctx.fillStyle = colour;
  for (let px = from; px < to; px++) {
    // The file's seconds under this column, and the loudest peak among them.
    const a = clip.offset + (xToTick(view, px) - clip.start) * scene.ctx.secondsPerTick;
    const b = clip.offset + (xToTick(view, px + 1) - clip.start) * scene.ctx.secondsPerTick;
    const first = Math.floor(a * data.peaksPerSecond);
    const last = Math.max(first + 1, Math.ceil(b * data.peaksPerSecond));
    let peak = 0;
    for (let i = Math.max(0, first); i < Math.min(data.peaks.length, last); i++) peak = Math.max(peak, data.peaks[i]);
    if (peak <= 0) continue;
    const size = Math.max(0.5, peak * half);
    ctx.fillRect(px, mid - size, 1, size * 2);
  }
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
  const { view, width, clips, selected, layout, palette } = scene;
  const bodyAlpha = palette.dark ? BODY_ALPHA.dark : BODY_ALPHA.light;
  const [from, to] = visibleClips(clips, xToTick(view, 0), xToTick(view, width), scene.ctx);
  ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  for (let i = from; i < to; i++) {
    const clip = clips[i];
    if (clip.track < firstTrack || clip.track > lastTrack) continue;
    const x = tickToX(view, clip.start);
    const right = tickToX(view, clipEnd(clip, scene.ctx));
    if (right < 0 || x > width) continue;
    const y = Math.round(trackTop(layout, view, clip.track));
    const h = Math.round(trackTop(layout, view, clip.track + 1)) - y - 1;
    const w = Math.max(2, right - x);
    const track = scene.tracks[clip.track];
    const own = selected.has(clip.id) ? SELECTED : track?.color ? colouredBy(track.color) : clip.kind === "audio" ? AUDIO : PATTERN;
    const colours = track?.muted ? onMutedTrack(own) : own;
    const fade = (clip.muted ? 0.5 : 1) * (track?.muted ? MUTED_TRACK_ALPHA : 1);
    ctx.globalAlpha = bodyAlpha * fade * (clip.muted ? 0.8 : 1);
    ctx.fillStyle = colours.body;
    ctx.beginPath();
    ctx.roundRect(Math.round(x) + 0.5, y + 0.5, Math.round(w) - 1, h - 1, 2);
    ctx.fill();
    ctx.globalAlpha = fade;
    const title = Math.min(TITLE_HEIGHT, h);
    ctx.fillStyle = colours.title;
    ctx.fillRect(Math.round(x) + 1, y + 1, Math.round(w) - 2, title - 1);
    // Its content, under the title.
    const bodyY = y + title;
    const bodyH = h - title - 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(x) + 1, bodyY, Math.round(w) - 2, bodyH);
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
    } else {
      const data = scene.waveforms.get(clip.ref);
      if (data) drawWaveform(ctx, scene, clip, data, x, bodyY, w, bodyH, colours.content);
    }
    ctx.restore();
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
      ctx.fillText(scene.names.get(clip.ref) ?? "", textX, y + title / 2 + 0.5, Math.max(0, right - textX - 3));
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.strokeRect(Math.round(x) + 0.5, y + 0.5, Math.round(w) - 1, h - 1);
  }
  ctx.globalAlpha = 1;
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
  const barPx = barTicks * view.pxPerTick;
  const every = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, 28 / barPx))));
  ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "top";
  for (const [tick, weight] of gridLines(view, width, barTicks, beatTicks)) {
    const x = Math.round(tickToX(view, tick));
    const bar = tick / barTicks;
    ctx.fillStyle = palette.rulerText;
    ctx.globalAlpha = weight === 2 ? 0.8 : weight === 1 ? 0.5 : 0.28;
    const tall = weight === 2 ? height : weight === 1 ? 7 : 4;
    ctx.fillRect(x, height - tall, 1, tall);
    if (weight === 2 && bar % every === 0) {
      ctx.globalAlpha = 1;
      ctx.fillText(String(bar + 1), x + 4, 4);
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.tool;
  ctx.fillRect(Math.round(end) - 1, 0, 2, height);
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
  ctx.fillRect(start, 0, 1.5, height);
}

/** Each audio file's waveform peaks, fetched once (media never changes), and who's waiting for them. */
const peaks = new Map<string, WaveformData | "loading" | "failed">();
const waiting = new Set<() => void>();

/** The waveform at `url` if it's loaded; otherwise it starts loading, and `onLoad` listeners hear when it's there. */
export function waveformAt(url: string): WaveformData | null {
  const known = peaks.get(url);
  if (known && known !== "loading" && known !== "failed") return known;
  if (!known) {
    peaks.set(url, "loading");
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<WaveformData>) : Promise.reject(new Error(String(r.status)))))
      .then(
        (data) => peaks.set(url, data),
        () => peaks.set(url, "failed"),
      )
      .finally(() => {
        for (const listener of waiting) listener();
      });
  }
  return null;
}

/** Be told when a waveform has loaded (to draw again). Returns how to stop. */
export function onWaveform(listener: () => void): () => void {
  waiting.add(listener);
  return () => waiting.delete(listener);
}
