import { clipContext, clipLength, songTicks } from "./playlist.ts";
import { patternSteps, stepsPerBar } from "./project.ts";
import { STEP_TICKS, type MusicProject, type PlaylistClipKind } from "./types.ts";

/**
 * A song's arrangement in miniature, small enough to keep with the recents: what its Home card draws, FL's
 * Playlist at a glance. Blocks in rows: its clips on the tracks they're on, or, before it has any, its
 * busiest pattern's notes by channel (as the step sequencer shows them).
 */
export interface SongOutline {
  kind: "playlist" | "pattern";
  rows: number;
  /** How many bars it spans (the grid's lines). */
  bars: number;
  /** `[row, start, length, style]`: start and length in thousandths of the song (or the pattern); style indexes `styles`. */
  blocks: [number, number, number, number][];
  /** A block's colour ("#rrggbb", null for its kind's usual: FL's blue-grey patterns, green audio, violet automation). */
  styles: { kind: PlaylistClipKind | "note"; color: string | null }[];
}

/** Tracks (or channels) past these are left out: a card is small. */
export const OUTLINE_ROWS = 10;
export const OUTLINE_BLOCKS = 240;

/** The song's outline, or null when there's nothing to draw (no clips, no notes). */
export function songOutline(song: MusicProject): SongOutline | null {
  return song.playlist.clips.length > 0 ? playlistOutline(song) : patternOutline(song);
}

function playlistOutline(song: MusicProject): SongOutline | null {
  const ctx = clipContext(song);
  const span = songTicks(song);
  // Only the tracks something is on, in order: a song on tracks 1, 2 and 9 draws three rows.
  const used = [...new Set(song.playlist.clips.map((c) => c.track))].sort((a, b) => a - b).slice(0, OUTLINE_ROWS);
  const rowOf = new Map(used.map((track, row) => [track, row]));
  const colors = new Map<string, string | null>([
    ...song.patterns.map((p) => [p.id, p.color] as const),
    ...song.channels.map((c) => [c.id, c.color] as const),
    ...song.automations.map((a) => [a.id, a.color] as const),
  ]);
  const styles = new Styles();
  const blocks: SongOutline["blocks"] = [];
  for (const clip of song.playlist.clips) {
    const row = rowOf.get(clip.track);
    if (row === undefined || clip.muted) continue;
    const color = colors.get(clip.ref) ?? song.playlist.tracks[clip.track]?.color ?? null;
    blocks.push([row, thousandths(clip.start, span), Math.max(1, thousandths(clipLength(clip, ctx), span)), styles.of(clip.kind, color)]);
    if (blocks.length === OUTLINE_BLOCKS) break;
  }
  return blocks.length ? { kind: "playlist", rows: used.length, bars: Math.round(span / ctx.barTicks), blocks, styles: styles.list } : null;
}

function patternOutline(song: MusicProject): SongOutline | null {
  const count = (p: MusicProject["patterns"][number]) => Object.values(p.notes).reduce((n, notes) => n + notes.length, 0);
  const pattern = song.patterns.reduce<MusicProject["patterns"][number] | null>((best, p) => (count(p) > (best ? count(best) : 0) ? p : best), null);
  if (!pattern) return null;
  const steps = patternSteps(pattern, song.settings.timeSignature);
  const span = steps * STEP_TICKS;
  const channels = song.channels.filter((c) => pattern.notes[c.id]?.length).slice(0, OUTLINE_ROWS);
  const styles = new Styles();
  const blocks: SongOutline["blocks"] = [];
  channels.forEach((channel, row) => {
    const style = styles.of("note", channel.color);
    for (const note of pattern.notes[channel.id]) {
      if (note.muted || blocks.length >= OUTLINE_BLOCKS) continue;
      blocks.push([row, thousandths(note.start, span), Math.max(1, thousandths(note.length, span)), style]);
    }
  });
  return blocks.length ? { kind: "pattern", rows: channels.length, bars: Math.max(1, Math.round(steps / stepsPerBar(song.settings.timeSignature))), blocks, styles: styles.list } : null;
}

const thousandths = (ticks: number, span: number) => Math.min(1000, Math.round((ticks / span) * 1000));

/** Each kind and colour once, indexed by the blocks. */
class Styles {
  readonly list: SongOutline["styles"] = [];
  of(kind: SongOutline["styles"][number]["kind"], color: string | null): number {
    const at = this.list.findIndex((s) => s.kind === kind && s.color === color);
    if (at >= 0) return at;
    this.list.push({ kind, color });
    return this.list.length - 1;
  }
}
