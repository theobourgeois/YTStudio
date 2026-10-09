/**
 * Consolidate and Render as audio clip (FL's, `docs/fl-studio/playlist.md`), done our way (decided with Théo,
 * 2026-10-09): the clips are rendered as they reach their mixer tracks, before the tracks' effects, fader and
 * pan, a file for each mixer track they play into, and each file's clip plays back into that track. So the
 * song sounds as it did and the mixer stays live (FL renders the master's output, which bakes the fader in and
 * runs the master's effects twice). Consolidate keeps the clips it replaces inside the new ones
 * (`PlaylistClip.consolidated`, `Playlist.consolidations`): Unconsolidate puts them back where the new clips are now, Re-render renders them
 * again. Pure: the tab renders (`src/suites/music/playlist/bounce.ts`).
 */
import { createId } from "../ids.ts";
import { clamp } from "../math.ts";
import { removeChannels } from "./edits.ts";
import { type ClipContext, type ClipIds, type NewClip, addClips, clipContext, clipEnd, clipLength, contentAt, removeClips } from "./playlist.ts";
import { DEFAULT_VOLUME, MASTER_TRACK_ID, MAX_PLAYLIST_TRACKS, byClipStart, createAudioChannel, createMixerTrack } from "./project.ts";
import type { AutomationTarget, Channel, Consolidation, MusicProject, Playlist, PlaylistClip } from "./types.ts";

/** The stand-in tracks of a render's song (`bounce_1`, `bounce_2`...): the engine writes each one's input as a stem of that name. */
const STAND_IN = "bounce_";

/** The mixer track a channel plays into (one that's gone: the master). */
function intoOf(song: MusicProject, channel: Channel): string {
  return song.mixer.tracks.some((t) => t.id === channel.mixerTrack) ? channel.mixerTrack : MASTER_TRACK_ID;
}

/** The channels a clip plays: an audio clip's own, a pattern's that have notes in it (and aren't muted). */
function channelsOf(song: MusicProject, clip: PlaylistClip): Channel[] {
  if (clip.kind === "audio") return song.channels.filter((c) => c.id === clip.ref && !c.muted);
  if (clip.kind !== "pattern") return [];
  const pattern = song.patterns.find((p) => p.id === clip.ref);
  if (!pattern) return [];
  return song.channels.filter((c) => !c.muted && (pattern.notes[c.id]?.length ?? 0) > 0);
}

/**
 * The mixer tracks clips play into, each with the clips that do: in the order of their highest clip on the
 * playlist, then the mixer's.
 */
export function playedInto(song: MusicProject, clips: readonly PlaylistClip[]): { into: string; clips: PlaylistClip[] }[] {
  const groups = new Map<string, PlaylistClip[]>();
  for (const clip of clips) {
    for (const into of new Set(channelsOf(song, clip).map((c) => intoOf(song, c)))) groups.set(into, [...(groups.get(into) ?? []), clip]);
  }
  const order = (into: string) => song.mixer.tracks.findIndex((t) => t.id === into);
  const top = (list: PlaylistClip[]) => Math.min(...list.map((c) => c.track));
  return [...groups]
    .map(([into, list]) => ({ into, clips: list }))
    .sort((a, b) => top(a.clips) - top(b.clips) || order(a.into) - order(b.into));
}

/** Automation that shapes what the channels make (theirs, their plugins', the tempo), which a render keeps; the mixer's is left out with the mixer. */
const shapesChannels = (target: AutomationTarget) => target.kind === "channel" || target.kind === "tempo" || (target.kind === "plugin" && target.owner === "channel");

/** A song to render clips in (`bounceRender`), where they start and end, and which mixer track each stand-in track's stem is the input of. */
export interface BounceRender {
  song: MusicProject;
  start: number;
  end: number;
  stems: { track: string; into: string }[];
}

/**
 * The song that renders `clips` as they reach their mixer tracks: only them (and the automation of their
 * channels and of the tempo), every track of the playlist playing, and a mixer of plain tracks, each standing
 * for a mixer track they play into, with no effects, at 0 dB and in the centre, so each one's stem is what goes
 * into the track it stands for. Null when they play nothing.
 */
export function bounceRender(song: MusicProject, clips: readonly PlaylistClip[]): BounceRender | null {
  const sources = clips.filter((c) => c.kind !== "automation");
  const groups = playedInto(song, sources);
  if (!groups.length) return null;
  const ctx = clipContext(song);
  const stems = groups.map((g, i) => ({ track: `${STAND_IN}${i + 1}`, into: g.into }));
  const standIn = new Map(stems.map((s) => [s.into, s.track]));
  const master = { ...createMixerTrack(MASTER_TRACK_ID), dock: "left" as const, sends: [] };
  const automations = song.automations.filter((a) => shapesChannels(a.target));
  const kept = new Set(automations.map((a) => a.id));
  const automationClips = song.playlist.clips.filter((c) => c.kind === "automation" && kept.has(c.ref));
  let id = automationClips.reduce((max, c) => Math.max(max, c.id), 0);
  const played = sources.map(({ consolidated: _, ...c }) => ({ ...c, id: ++id, muted: false }));
  return {
    song: {
      ...song,
      settings: { ...song.settings, volume: DEFAULT_VOLUME },
      channels: song.channels.map((c) => ({ ...c, mixerTrack: standIn.get(intoOf(song, c)) ?? MASTER_TRACK_ID })),
      playlist: {
        tracks: song.playlist.tracks.map((t) => ({ ...t, muted: false, mixerTrack: null })),
        clips: [...automationClips, ...played].sort(byClipStart),
      },
      mixer: { tracks: [master, ...stems.map((s) => createMixerTrack(s.track))], groups: [] },
      automations,
      modulators: song.modulators.flatMap((m) => {
        if (m.source.kind !== "notes") return [];
        const links = m.links.filter((l) => shapesChannels(l.target));
        return links.length ? [{ ...m, links }] : [];
      }),
    },
    start: Math.min(...sources.map((c) => c.start)),
    end: Math.max(...sources.map((c) => clipEnd(c, ctx))),
    stems,
  };
}

/** A rendered file: the mixer track it's the input of, the project's media it became, its length and the name its channel gets. */
export interface BouncedFile {
  into: string;
  sampleId: string;
  seconds: number;
  name: string;
}

/** The first track from `from` down with no clip over `[start, end)` (else the last). */
export function freeTrack(clips: readonly PlaylistClip[], ctx: ClipContext, from: number, start: number, end: number): number {
  const busy = (track: number) => clips.some((c) => c.track === track && c.start < end && clipEnd(c, ctx) > start);
  let track = clamp(from, 0, MAX_PLAYLIST_TRACKS - 1);
  while (track < MAX_PLAYLIST_TRACKS - 1 && busy(track)) track++;
  return track;
}

/** A clip's colour, for the audio clip made of it: its pattern's or its channel's. */
function colourOf(song: MusicProject, clip: PlaylistClip | undefined): string | null {
  if (!clip) return null;
  if (clip.kind === "pattern") return song.patterns.find((p) => p.id === clip.ref)?.color ?? null;
  return song.channels.find((c) => c.id === clip.ref)?.color ?? null;
}

/** A new audio clip channel for a rendered file, playing into the track it's the input of. */
function channelFor(song: MusicProject, file: BouncedFile, color: string | null, id: string): Channel {
  const into = song.mixer.tracks.some((t) => t.id === file.into) ? file.into : MASTER_TRACK_ID;
  return { ...createAudioChannel(file.name, file.sampleId, id), mixerTrack: into, color };
}

/** The song with clips and channels added, and the new clips' ids. */
export interface Placed {
  song: MusicProject;
  clipIds: number[];
}

/**
 * Place the rendered files of the clips in `ids` (in `playedInto`'s order), each an audio clip of its own
 * channel from where the first of them started. With a `consolidation` id (Consolidate), they replace the
 * clips, which go inside them: the first on the highest of their tracks, each other where its first clip was
 * (or the first free track below). Without (Render as audio clip), the clips stay and the new ones go on the
 * first free tracks below them.
 */
export function placeBounced(song: MusicProject, ids: ClipIds, files: readonly BouncedFile[], consolidation: string | null, channelIds: () => string = () => createId("chan")): Placed {
  const ctx = clipContext(song);
  const sources = song.playlist.clips.filter((c) => ids.has(c.id) && c.kind !== "automation");
  if (!sources.length || !files.length) return { song, clipIds: [] };
  const start = Math.min(...sources.map((c) => c.start));
  const top = Math.min(...sources.map((c) => c.track));
  const bottom = Math.max(...sources.map((c) => c.track));
  const firstTracks = new Map(playedInto(song, sources).map((g) => [g.into, Math.min(...g.clips.map((c) => c.track))]));
  const color = colourOf(song, [...sources].sort((a, b) => a.track - b.track || a.start - b.start)[0]);
  let clips = consolidation ? removeClips(song.playlist.clips, new Set(sources.map((c) => c.id))) : song.playlist.clips;
  const channels: Channel[] = [];
  const clipIds: number[] = [];
  files.forEach((file, i) => {
    const length = Math.max(1, Math.round(file.seconds / ctx.secondsPerTick));
    const from = consolidation ? (i === 0 ? top : (firstTracks.get(file.into) ?? top)) : bottom + 1;
    const track = freeTrack(clips, ctx, from, start, start + length);
    const channel = channelFor(song, file, color, channelIds());
    const clip: NewClip = { kind: "audio", ref: channel.id, track, start, length, offset: 0 };
    if (consolidation) clip.consolidated = { id: consolidation, into: file.into, start, track };
    const added = addClips(clips, [clip]);
    clips = added.clips;
    clipIds.push(...added.created);
    channels.push(channel);
  });
  const playlist = consolidation ? { ...song.playlist, clips, consolidations: { ...song.playlist.consolidations, [consolidation]: sources } } : { ...song.playlist, clips };
  return { song: { ...song, channels: [...song.channels, ...channels], playlist }, clipIds };
}

/** The clips a consolidation replaced (none if it has none any more). */
export const insideOf = (song: Pick<MusicProject, "playlist">, id: string): PlaylistClip[] => song.playlist.consolidations?.[id] ?? [];

/** The playlist without the consolidations no clip is of any more (on it, or inside one that is). */
function withoutUnused(playlist: Playlist): Playlist {
  const all = playlist.consolidations;
  if (!all) return playlist;
  const used = new Set<string>();
  const visit = (clips: readonly PlaylistClip[]) => {
    for (const clip of clips) {
      const id = clip.consolidated?.id;
      if (!id || used.has(id) || !all[id]) continue;
      used.add(id);
      visit(all[id]);
    }
  };
  visit(playlist.clips);
  if (used.size === Object.keys(all).length) return playlist;
  const { consolidations: _, ...rest } = playlist;
  return used.size ? { ...rest, consolidations: Object.fromEntries([...used].map((id) => [id, all[id]])) } : rest;
}

/** Where a clip's file starts in the song: the clips of one placement of a consolidation (its slices, its other mixer tracks' clips) share it. */
const originOf = (clip: PlaylistClip, ctx: ClipContext) => Math.round(clip.start - (clip.kind === "audio" ? clip.offset / ctx.fileSecondsPerTick(clip) : clip.offset));

/** The clips of a consolidation in one place: those of the consolidation `id` whose files start at `origin`. */
function placementOf(clips: readonly PlaylistClip[], ctx: ClipContext, id: string, origin: number): PlaylistClip[] {
  return clips.filter((c) => c.consolidated?.id === id && originOf(c, ctx) === origin);
}

/** Channels of `refs` nothing plays any more (no clip, no notes), to remove with the clips that played them. */
function unused(song: MusicProject, refs: Iterable<string>): string[] {
  return [...new Set(refs)].filter((ref) => !song.playlist.clips.some((c) => c.kind === "audio" && c.ref === ref) && !song.patterns.some((p) => (p.notes[ref]?.length ?? 0) > 0));
}

/**
 * Unconsolidate: each consolidated clip in `ids` gives back the clips it was made from, moved as far as it has
 * moved since (in time and tracks), and only what's inside it (a slice of it gives back its part). The other
 * clips of the same placement (its other slices, the other mixer tracks' clips) go too, and the channels that
 * played them; copies of it elsewhere stay. Clips whose pattern or channel was deleted since don't come back.
 */
export function unconsolidate(song: MusicProject, ids: ClipIds): { song: MusicProject; restored: number[] } {
  const ctx = clipContext(song);
  const all = song.playlist.clips;
  const placements = new Map<string, PlaylistClip[]>();
  for (const clip of all) {
    if (!ids.has(clip.id) || !clip.consolidated) continue;
    const origin = originOf(clip, ctx);
    const key = `${clip.consolidated.id}@${origin}`;
    if (!placements.has(key)) placements.set(key, placementOf(all, ctx, clip.consolidated.id, origin));
  }
  if (!placements.size) return { song, restored: [] };
  const exists = (clip: PlaylistClip) =>
    clip.kind === "pattern" ? song.patterns.some((p) => p.id === clip.ref) : song.channels.some((c) => c.id === clip.ref && c.kind === "audio");
  const removed = new Set<number>();
  const back: NewClip[] = [];
  for (const placement of placements.values()) {
    const first = placement.reduce((a, b) => (b.track < a.track ? b : a));
    const made = first.consolidated!;
    const inside = insideOf(song, made.id);
    const dt = originOf(first, ctx) - made.start;
    const dk = first.track - made.track;
    const from = Math.min(...placement.map((c) => c.start));
    const to = Math.max(...placement.map((c) => clipEnd(c, ctx)));
    for (const clip of placement) removed.add(clip.id);
    for (const original of inside.filter(exists)) {
      const moved: PlaylistClip = { ...original, start: original.start + dt, track: clamp(original.track + dk, 0, MAX_PLAYLIST_TRACKS - 1) };
      const end = moved.start + clipLength(moved, ctx);
      const start = Math.max(moved.start, from, 0);
      const stop = Math.min(end, to);
      if (stop <= start) continue;
      const whole = start === moved.start && stop === end;
      back.push(whole ? moved : { ...moved, start, length: stop - start, offset: contentAt(moved, start, ctx) });
    }
  }
  const gone = all.filter((c) => removed.has(c.id));
  const added = addClips(removeClips(all, removed), back);
  const next = { ...song, playlist: withoutUnused({ ...song.playlist, clips: added.clips }) };
  return { song: removeChannels(next, unused(next, gone.map((c) => c.ref))), restored: added.created };
}

/** The consolidation a clip is of, and the clips it replaced, or null. */
export function consolidationOf(song: MusicProject, clipId: number): { id: string; clips: PlaylistClip[] } | null {
  const id = song.playlist.clips.find((c) => c.id === clipId)?.consolidated?.id;
  return id ? { id, clips: insideOf(song, id) } : null;
}

/**
 * Re-render: a consolidation's files rendered again (from the clips inside it, as their patterns and channels
 * are now) take the old ones' place. Each mixer track's channel plays its new file, so every copy, slice and
 * chop of it does; a clip that was the whole old file becomes the whole new one (`oldTicks`: an old file's
 * length, in ticks). A mixer track the clips play into now that they didn't gets a clip of its own in each
 * placement (on the first free track below it); one they don't play into any more loses its clips.
 */
export function rerendered(
  song: MusicProject,
  id: string,
  files: readonly BouncedFile[],
  oldTicks: (sampleId: string) => number | null,
  channelIds: () => string = () => createId("chan"),
): Placed {
  const ctx = clipContext(song);
  const made = song.playlist.clips.filter((c) => c.consolidated?.id === id);
  if (!made.length) return { song, clipIds: [] };
  const intos = new Set(files.map((f) => f.into));
  const dropped = new Set(made.filter((c) => !intos.has(c.consolidated!.into)).map((c) => c.id));
  let clips = removeClips(song.playlist.clips, dropped);
  let channels = song.channels;
  const clipIds: number[] = [];
  for (const file of files) {
    const into = made.filter((c) => c.consolidated!.into === file.into);
    const length = Math.max(1, Math.round(file.seconds / ctx.secondsPerTick));
    if (into.length) {
      const refs = new Set(into.map((c) => c.ref));
      const whole = new Set(
        into.filter((c) => {
          const old = oldTicks(channels.find((ch) => ch.id === c.ref)?.sampleId ?? "");
          return c.offset === 0 && old !== null && Math.abs(clipLength(c, ctx) - old) <= 1;
        }).map((c) => c.id),
      );
      channels = channels.map((c) => (refs.has(c.id) ? { ...c, sampleId: file.sampleId } : c));
      clips = clips.map((c) => (whole.has(c.id) ? { ...c, length } : c));
      continue;
    }
    // A mixer track they play into now: a clip in each placement, below its clips.
    const origins = new Map<number, PlaylistClip[]>();
    for (const clip of made) origins.set(originOf(clip, ctx), [...(origins.get(originOf(clip, ctx)) ?? []), clip]);
    const first = made[0];
    const channel = channelFor(song, file, colourOf(song, insideOf(song, id)[0]), channelIds());
    channels = [...channels, channel];
    for (const [origin, placement] of origins) {
      const start = Math.max(0, origin);
      const track = freeTrack(clips, ctx, Math.max(...placement.map((c) => c.track)) + 1, start, start + length);
      const consolidated: Consolidation = { ...placement[0].consolidated!, into: file.into, start: first.consolidated!.start, track: track - (placement[0].track - placement[0].consolidated!.track) };
      const added = addClips(clips, [{ kind: "audio", ref: channel.id, track, start, length, offset: 0, consolidated }]);
      clips = added.clips;
      clipIds.push(...added.created);
    }
  }
  const next = { ...song, channels, playlist: withoutUnused({ ...song.playlist, clips }) };
  return { song: removeChannels(next, unused(next, made.filter((c) => dropped.has(c.id)).map((c) => c.ref))), clipIds };
}
