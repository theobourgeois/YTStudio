/**
 * Extract stems (docs/fl-studio/stems-and-notes.md; FL Studio's "Extract stems from sample"): an audio clip's file
 * split into its parts by a separation model on the server (`server/music/stems.ts`), each part a file of the
 * project's own, and the parts placed in the song under the clip they came from, lined up with it, the clip
 * muted. What's chosen and not becomes "Other", so the stems always add up to the song.
 */
import { createId } from "../ids.ts";
import type { MediaAsset } from "../types.ts";
import { addClips, clipContext, clipEnd, type NewClip, setClipProps, updateTracks } from "./playlist.ts";
import { MAX_NAME, MAX_PLAYLIST_TRACKS, createAudioChannel } from "./project.ts";
import type { MusicProject, PlaylistClip } from "./types.ts";

/** The parts a song is split into, in the order they're offered and placed. */
export const STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"] as const;
export type Stem = (typeof STEMS)[number];

export const STEM_NAMES: Record<Stem, string> = { vocals: "Vocals", drums: "Drums", bass: "Bass", guitar: "Guitar", piano: "Piano", other: "Other" };

/** What's ticked the first time (FL's four: guitar and piano stay in Other until asked for). */
export const DEFAULT_STEMS: readonly Stem[] = ["vocals", "drums", "bass", "other"];

export const isStem = (value: unknown): value is Stem => typeof value === "string" && (STEMS as readonly string[]).includes(value);

/**
 * The model's sources each chosen stem is made of: its own, and for Other, every source not chosen (so Vocals
 * and Other is the song without its vocals). A stem not chosen goes nowhere unless Other is.
 */
export function stemSources(chosen: readonly Stem[]): Partial<Record<Stem, Stem[]>> {
  const picked = STEMS.filter((s) => chosen.includes(s));
  const out: Partial<Record<Stem, Stem[]>> = {};
  for (const stem of picked) out[stem] = stem === "other" ? STEMS.filter((s) => s === "other" || !picked.includes(s)) : [stem];
  return out;
}

/** `POST /api/music/stems`: split one of the project's files. */
export interface StemRequest {
  projectId: string;
  /** The media the clip plays (its channel's `sampleId`). */
  sampleId: string;
  /** At least one. */
  stems: Stem[];
}

export type StemJobState = "running" | "done" | "failed" | "cancelled";

/** A split, as `GET /api/music/stems/:id` tells it. */
export interface StemJob {
  id: string;
  projectId: string;
  sampleId: string;
  stems: Stem[];
  state: StemJobState;
  /** 0..1. */
  progress: number;
  error: string | null;
  /** Each stem's file, once it's done (the project's media). */
  media: Partial<Record<Stem, MediaAsset>>;
}

/** A request checked, or why it can't be. */
export function stemRequest(body: unknown): StemRequest | string {
  const b = (body ?? {}) as Partial<Record<keyof StemRequest, unknown>>;
  if (typeof b.projectId !== "string" || !b.projectId) return "projectId is missing";
  if (typeof b.sampleId !== "string" || !b.sampleId) return "sampleId is missing: the media of the audio clip to split";
  if (!Array.isArray(b.stems) || !b.stems.length) return `stems is missing: some of ${STEMS.join(", ")}`;
  const bad = b.stems.filter((s) => !isStem(s));
  if (bad.length) return `Unknown stems ${bad.join(", ")}: the stems are ${STEMS.join(", ")}`;
  return { projectId: b.projectId, sampleId: b.sampleId, stems: STEMS.filter((s) => (b.stems as unknown[]).includes(s)) };
}

/** What a stem's file is known by in the project's media, so splitting the same file again reuses it. */
export const stemOrigin = (sampleId: string, stem: Stem, sources: readonly Stem[]) => `stems:${sampleId}:${stem}=${[...sources].sort().join("+")}`;

/** The stem a file of the project's media is, if it is one (from its origin). */
export function stemOf(asset: Pick<MediaAsset, "origin"> | undefined): Stem | null {
  const match = /^stems:[^:]+:([a-z]+)=/.exec(asset?.origin ?? "");
  return match && isStem(match[1]) ? match[1] : null;
}

/** A stem's file to place: its media and length. */
export interface StemFile {
  stem: Stem;
  sampleId: string;
  /** The file's length in seconds. */
  seconds: number;
}

/**
 * The stems in the song: a channel of its own for each (in the rack's Audio group, named after the source's
 * channel and the stem, playing as that channel plays: its pitch, stretch and sample effects; its mixing is
 * left to the user, so they play into the master), and under each of `clipIds` (the source channel's clips) a
 * clip of each stem, as long and as far into the file as it, on the first free tracks below it (named after
 * the stem when they're new). `mute`: the clips they came from go silent. One edit; `ids` names the channels.
 */
export function placeStems(
  song: MusicProject,
  sourceChannelId: string,
  clipIds: readonly number[],
  files: readonly StemFile[],
  options: { mute: boolean },
  ids: () => string = () => createId("chan"),
): { song: MusicProject; channelIds: string[] } {
  const source = song.channels.find((c) => c.id === sourceChannelId);
  if (!source || !files.length) return { song, channelIds: [] };
  const ordered = STEMS.flatMap((stem) => files.filter((f) => f.stem === stem).slice(0, 1));
  const channels = ordered.map((file) => ({
    ...createAudioChannel(`${source.name} - ${STEM_NAMES[file.stem]}`.slice(0, MAX_NAME), file.sampleId, ids()),
    pitch: source.pitch,
    precomputed: source.precomputed,
    ...(source.stretch ? { stretch: source.stretch } : {}),
  }));
  let next: MusicProject = { ...song, channels: [...song.channels, ...channels] };
  const ctx = clipContext(next);
  const sources = song.playlist.clips.filter((c) => c.kind === "audio" && c.ref === sourceChannelId && clipIds.includes(c.id));
  let clips = next.playlist.clips;
  const named = new Map<number, string>();
  for (const clip of [...sources].sort((a, b) => a.track - b.track || a.start - b.start)) {
    const start = clip.start;
    const end = clipEnd(clip, ctx);
    const busy = (track: number) => clips.some((c) => c.track === track && c.start < end && clipEnd(c, ctx) > start);
    let track = clip.track;
    const placed: NewClip[] = channels.map((channel, i) => {
      track++;
      while (track < MAX_PLAYLIST_TRACKS - 1 && busy(track)) track++;
      track = Math.min(track, MAX_PLAYLIST_TRACKS - 1);
      if (!named.has(track) && !next.playlist.tracks[track]?.name && !clips.some((c) => c.track === track)) named.set(track, STEM_NAMES[ordered[i].stem]);
      return { ...copyOf(clip), ref: channel.id, track };
    });
    clips = addClips(clips, placed).clips;
  }
  if (options.mute) clips = setClipProps(clips, new Set(sources.map((c) => c.id)), { muted: true });
  next = { ...next, playlist: { ...next.playlist, clips } };
  for (const [track, name] of named) next = updateTracks(next, [track], { name });
  return { song: next, channelIds: channels.map((c) => c.id) };
}

/** An audio clip's window onto its file, its gain, fades and stretch: what a stem's clip copies so it lines up. */
function copyOf(clip: PlaylistClip): NewClip {
  const { kind, ref, track, start, length, offset, fadeIn, fadeOut, fadeInTension, fadeOutTension, gain, stretch } = clip;
  return { kind, ref, track, start, length, offset, fadeIn, fadeOut, fadeInTension, fadeOutTension, gain, stretch };
}
