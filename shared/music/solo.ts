/**
 * Solo, the way Reaper, Logic, Studio One and Ableton's group tracks have it rather than FL Studio's:
 * a state of its own (`MixerTrack.solo`), never a rewrite of the mutes, and one that follows the routing.
 * Soloing a track keeps on every track its sound goes through on the way to the master (its buses), and
 * soloing a bus keeps on every track that feeds it. Everything else is silenced while any track is soloed,
 * except a track that's solo safe (`MixerTrack.soloSafe`: a reverb return, a reference) and the master.
 * Clearing the solos leaves the mutes exactly as they were. Pure: `compileSong` plays through `heardMixer`,
 * and the Mixer draws `hearing`.
 */
import { MASTER_TRACK_ID } from "./project.ts";
import type { Mixer, MixerTrack, MusicProject } from "./types.ts";

/** What a track sounds like with the solos and mutes as they are. */
export interface Hearing {
  /** Silenced by other tracks' solo: it isn't soloed, safe, nor on a soloed track's path. */
  soloedOut: boolean;
  /** Kept on only because a soloed track's sound goes through it, or it feeds one. */
  implied: boolean;
  /** It makes no sound of its own: muted, or soloed out. */
  silent: boolean;
  /**
   * Its sound reaches the master: it isn't silent, and one of its sends (not a silent sidechain) goes to a
   * track that's heard. A track that isn't silent itself but isn't heard is cut off further down (a muted bus).
   */
  heard: boolean;
}

/** Whether any track is soloed. */
export const soloActive = (mixer: Mixer) => mixer.tracks.some((t) => t.solo);

/** Every track reached from `start` by `next`, step after step (`start` itself only if it's reached again). */
function walk(start: Iterable<string>, next: (id: string) => readonly string[]): Set<string> {
  const found = new Set<string>();
  const stack = [...start];
  while (stack.length) {
    const id = stack.pop()!;
    for (const to of next(id)) if (!found.has(to)) found.add(to), stack.push(to);
  }
  return found;
}

/** The tracks the solos keep on (null when nothing is soloed: all of them). */
export function soloKept(mixer: Mixer): Set<string> | null {
  if (!soloActive(mixer)) return null;
  // Only sends that carry sound: a sidechain at 0 is no path for it.
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const track of mixer.tracks)
    for (const send of track.sends) {
      if (send.level <= 0) continue;
      out.set(track.id, [...(out.get(track.id) ?? []), send.to]);
      into.set(send.to, [...(into.get(send.to) ?? []), track.id]);
    }
  const soloed = mixer.tracks.filter((t) => t.solo).map((t) => t.id);
  const safe = mixer.tracks.filter((t) => t.soloSafe).map((t) => t.id);
  const kept = new Set([MASTER_TRACK_ID, ...soloed, ...safe]);
  for (const id of walk(soloed, (id) => out.get(id) ?? [])) kept.add(id);
  for (const id of walk(soloed, (id) => into.get(id) ?? [])) kept.add(id);
  // A safe track is heard through its own way out too.
  for (const id of walk(safe, (id) => out.get(id) ?? [])) kept.add(id);
  return kept;
}

/** Every track's `Hearing`, by id. */
export function hearing(mixer: Mixer): Map<string, Hearing> {
  const kept = soloKept(mixer);
  const byId = new Map(mixer.tracks.map((t) => [t.id, t]));
  const silent = (t: MixerTrack) => t.muted || (kept !== null && !kept.has(t.id));
  // Sends never loop, so this always ends.
  const heard = new Map<string, boolean>();
  const isHeard = (id: string): boolean => {
    const known = heard.get(id);
    if (known !== undefined) return known;
    const track = byId.get(id);
    const result = !!track && !silent(track) && (id === MASTER_TRACK_ID || track.sends.some((s) => s.level > 0 && isHeard(s.to)));
    heard.set(id, result);
    return result;
  };
  return new Map(
    mixer.tracks.map((t) => {
      const soloedOut = kept !== null && !kept.has(t.id);
      return [t.id, { soloedOut, implied: kept !== null && !soloedOut && !t.solo && !t.soloSafe && t.id !== MASTER_TRACK_ID, silent: silent(t), heard: isHeard(t.id) }];
    }),
  );
}

/**
 * The song as it's heard: every track the solos silence is muted. What `compileSong` plays; the song
 * itself keeps its mutes and solos apart. The same song back when nothing is soloed.
 */
export function heardMixer(song: MusicProject): MusicProject {
  const kept = soloKept(song.mixer);
  if (!kept) return song;
  const tracks = song.mixer.tracks.map((t) => (t.muted || kept.has(t.id) ? t : { ...t, muted: true }));
  return { ...song, mixer: { ...song.mixer, tracks } };
}

/**
 * Why a track that makes sound isn't heard: the silent tracks (muted, or soloed out) that its ways to the
 * master run into, the first on each. Empty when it's heard, silent itself, or sends nowhere.
 */
export function cutOffBy(mixer: Mixer, id: string, heard: ReadonlyMap<string, Hearing>): string[] {
  const byId = new Map(mixer.tracks.map((t) => [t.id, t]));
  const found = new Set<string>();
  const seen = new Set<string>();
  const visit = (from: string) => {
    for (const send of byId.get(from)?.sends ?? []) {
      if (send.level <= 0 || seen.has(send.to)) continue;
      seen.add(send.to);
      const h = heard.get(send.to);
      if (!h || h.heard) continue;
      if (h.silent) found.add(send.to);
      else visit(send.to);
    }
  };
  const own = heard.get(id);
  if (own && !own.silent && !own.heard) visit(id);
  return [...found];
}
