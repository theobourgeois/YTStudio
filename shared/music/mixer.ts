/**
 * The mixer's queries and edits (`docs/fl-studio/mixer.md`): its tracks, routing channels to them,
 * sends between them and their effect slots. Pure `(MusicProject) => MusicProject`, returning **the
 * same instance** when nothing changed, like the rest of `edits.ts`.
 */
import { createId } from "../ids.ts";
import { clamp } from "../math.ts";
import { EFFECT_SLOTS, MASTER_TRACK_ID, MAX_INSERTS, MAX_LATENCY_OFFSET, MAX_NAME, createMixerTrack, reaches } from "./project.ts";
import type { Channel, MixerEffect, MixerGroup, MixerSend, MixerTrack, MusicProject, PluginRef } from "./types.ts";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getMixerTrack = (song: MusicProject, id: string | null) => song.mixer.tracks.find((t) => t.id === id);

/** A track's number: 0 for the master, then 1, 2, 3... as the mixer shows them. -1 if it isn't there. */
export const trackNumber = (song: MusicProject, id: string) => song.mixer.tracks.findIndex((t) => t.id === id);

/** What a track is called: its name, or "Master" / "Insert 3" until it has one. */
export function trackName(song: MusicProject, id: string): string {
  const index = trackNumber(song, id);
  const track = song.mixer.tracks[index];
  if (!track) return "";
  return track.name ?? (index === 0 ? "Master" : `Insert ${index}`);
}

/** The channels playing into a track. */
export const channelsOn = (song: MusicProject, trackId: string): Channel[] => song.channels.filter((c) => c.mixerTrack === trackId);

/** The tracks sending to a track. */
export const sendersTo = (song: MusicProject, trackId: string): MixerTrack[] => song.mixer.tracks.filter((t) => t.sends.some((s) => s.to === trackId));

const sendsOf = (song: MusicProject) => {
  const byId = new Map(song.mixer.tracks.map((t) => [t.id, t.sends]));
  return (id: string): readonly MixerSend[] => byId.get(id) ?? [];
};

/**
 * Whether `from` can send to `to`: both exist, they're different, the master sends nowhere, and `to`'s
 * sound doesn't already reach `from` (that would be a loop). FL greys out such tracks' send switches.
 */
export function canSend(song: MusicProject, from: string, to: string): boolean {
  if (from === to || from === MASTER_TRACK_ID || !getMixerTrack(song, from) || !getMixerTrack(song, to)) return false;
  return !reaches(sendsOf(song), to, from);
}

/** A track nothing uses yet: an insert, unnamed, no effects, no channel playing into it and no track sending to it. */
export function isFreeTrack(song: MusicProject, track: MixerTrack): boolean {
  return (
    track.id !== MASTER_TRACK_ID &&
    track.name === null &&
    track.effects.every((e) => e === null) &&
    !song.channels.some((c) => c.mixerTrack === track.id) &&
    !song.mixer.tracks.some((t) => t.sends.some((s) => s.to === track.id))
  );
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

const withTracks = (song: MusicProject, tracks: MixerTrack[]): MusicProject => ({ ...song, mixer: { ...song.mixer, tracks } });

/** Apply `update` to the tracks in `ids` (in one pass), keeping the song if none changes. */
function updateTracks(song: MusicProject, ids: readonly string[], update: (track: MixerTrack) => MixerTrack): MusicProject {
  const wanted = new Set(ids);
  let any = false;
  const tracks = song.mixer.tracks.map((track) => {
    if (!wanted.has(track.id)) return track;
    const next = update(track);
    any ||= next !== track;
    return next;
  });
  return any ? withTracks(song, tracks) : song;
}

/**
 * Add insert tracks right after `afterId` (FL's +: after the selected track), or at the end. `ids`
 * names them (otherwise new ones are made). A mixer stops at `MAX_INSERTS`.
 */
export function addMixerTracks(song: MusicProject, afterId: string | null, count = 1, ids: readonly string[] = []): MusicProject {
  const room = MAX_INSERTS - (song.mixer.tracks.length - 1);
  const n = Math.min(Math.max(0, Math.round(count)), room);
  if (!n) return song;
  const added = Array.from({ length: n }, (_, i) => createMixerTrack(ids[i] ?? createId("insert")));
  const at = afterId === null ? -1 : trackNumber(song, afterId);
  const index = at < 0 ? song.mixer.tracks.length : at + 1;
  return withTracks(song, [...song.mixer.tracks.slice(0, index), ...added, ...song.mixer.tracks.slice(index)]);
}

/**
 * Remove insert tracks (never the master). Channels playing into them go to the master, sends to them
 * go, and a track left sending nowhere because of it sends to the master instead, so nothing that was
 * heard falls silent.
 */
export function removeMixerTracks(song: MusicProject, ids: readonly string[]): MusicProject {
  const gone = new Set(ids.filter((id) => id !== MASTER_TRACK_ID && getMixerTrack(song, id)));
  if (!gone.size) return song;
  const tracks = song.mixer.tracks
    .filter((t) => !gone.has(t.id))
    .map((t) => {
      if (!t.sends.some((s) => gone.has(s.to))) return t;
      const sends = t.sends.filter((s) => !gone.has(s.to));
      return { ...t, sends: sends.length ? sends : [{ to: MASTER_TRACK_ID, level: 1 }] };
    });
  const channels = song.channels.some((c) => gone.has(c.mixerTrack))
    ? song.channels.map((c) => (gone.has(c.mixerTrack) ? { ...c, mixerTrack: MASTER_TRACK_ID } : c))
    : song.channels;
  const removed = { ...withTracks(song, tracks), channels };
  return withGroups(removed, keptGroups(removed));
}

/**
 * Move insert tracks one place left (-1) or right (1), together (FL's Alt+← / →). Their channels and
 * sends go with them (they're linked by id). The master stays first; tracks against an edge stay.
 */
export function moveMixerTracks(song: MusicProject, ids: readonly string[], direction: -1 | 1): MusicProject {
  const moving = new Set(ids);
  moving.delete(MASTER_TRACK_ID);
  const tracks = [...song.mixer.tracks];
  let any = false;
  const order = direction < 0 ? tracks.map((_, i) => i) : tracks.map((_, i) => tracks.length - 1 - i);
  for (const i of order) {
    const to = i + direction;
    if (!moving.has(tracks[i].id) || to < 1 || to >= tracks.length || moving.has(tracks[to].id)) continue;
    [tracks[i], tracks[to]] = [tracks[to], tracks[i]];
    any = true;
  }
  return any ? withTracks(song, tracks) : song;
}

export type MixerTrackPatch = Partial<Pick<MixerTrack, "name" | "color" | "dock" | "separator" | "volume" | "pan" | "muted" | "invert" | "swap" | "stereo" | "latencyOffset">>;

function patchedTrack(track: MixerTrack, patch: MixerTrackPatch): MixerTrack {
  // An empty name goes back to the track's number.
  const name = patch.name === undefined ? track.name : patch.name?.trim().slice(0, MAX_NAME) || null;
  const next = {
    ...track,
    name,
    color: patch.color === undefined ? track.color : patch.color && /^#[0-9a-f]{6}$/i.test(patch.color) ? patch.color.toLowerCase() : null,
    separator: patch.separator ?? track.separator,
    // The master stays on the left.
    dock: track.id === MASTER_TRACK_ID || (patch.dock !== "left" && patch.dock !== "middle" && patch.dock !== "right") ? track.dock : patch.dock,
    volume: clamp(patch.volume ?? track.volume, 0, 1),
    pan: clamp(patch.pan ?? track.pan, -1, 1),
    muted: patch.muted ?? track.muted,
    invert: patch.invert ?? track.invert,
    swap: patch.swap ?? track.swap,
    stereo: patch.stereo === undefined || !Number.isFinite(patch.stereo) ? track.stereo : clamp(patch.stereo, -1, 1),
    latencyOffset:
      patch.latencyOffset === undefined || !Number.isFinite(patch.latencyOffset)
        ? track.latencyOffset
        : Math.round(clamp(patch.latencyOffset, -MAX_LATENCY_OFFSET, MAX_LATENCY_OFFSET) * 100) / 100,
  };
  return (Object.keys(next) as (keyof MixerTrack)[]).every((key) => next[key] === track[key]) ? track : next;
}

export const updateMixerTrack = (song: MusicProject, id: string, patch: MixerTrackPatch) => updateTracks(song, [id], (t) => patchedTrack(t, patch));

/** The same change to several tracks at once (a colour or a name given to every selected track). */
export const updateMixerTracks = (song: MusicProject, ids: readonly string[], patch: MixerTrackPatch) => updateTracks(song, ids, (t) => patchedTrack(t, patch));

/** Set several tracks' faders at once, each to its own level (FL moves every selected track's fader together). */
export const setMixerVolumes = (song: MusicProject, volumes: ReadonlyMap<string, number>) =>
  updateTracks(song, [...volumes.keys()], (t) => {
    const volume = volumes.get(t.id)!;
    return Number.isFinite(volume) ? patchedTrack(t, { volume }) : t;
  });

export const setMixerMuted = (song: MusicProject, ids: readonly string[], muted: boolean) => updateTracks(song, ids, (t) => patchedTrack(t, { muted }));

/**
 * Solo a track, FL Studio's way: solo is a state of the mutes. Every other insert track is muted and
 * this one unmuted (the master never: it's what's heard); soloing a track that's already alone unmutes
 * them all. `linked` is FL's Alt solo: the tracks whose sound reaches this one, and those it reaches,
 * stay on too, so its whole path is heard.
 */
export function soloMixerTrack(song: MusicProject, id: string, linked = false): MusicProject {
  if (!getMixerTrack(song, id)) return song;
  const sends = sendsOf(song);
  const kept = (t: MixerTrack) => t.id === id || t.id === MASTER_TRACK_ID || (linked && (reaches(sends, t.id, id) || reaches(sends, id, t.id)));
  const keep = new Set(song.mixer.tracks.filter(kept).map((t) => t.id));
  const others = song.mixer.tracks.filter((t) => !keep.has(t.id)).map((t) => t.id);
  const alone = song.mixer.tracks.every((t) => (keep.has(t.id) ? !t.muted : t.muted));
  if (alone) return setMixerMuted(song, others, false);
  return setMixerMuted(setMixerMuted(song, others, true), [...keep], false);
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** Route channels to a mixer track (the rack's track selector, or FL's Ctrl+L on a track). */
export function routeChannels(song: MusicProject, channelIds: readonly string[], trackId: string): MusicProject {
  if (!getMixerTrack(song, trackId)) return song;
  const wanted = new Set(channelIds);
  if (!song.channels.some((c) => wanted.has(c.id) && c.mixerTrack !== trackId)) return song;
  return { ...song, channels: song.channels.map((c) => (wanted.has(c.id) && c.mixerTrack !== trackId ? { ...c, mixerTrack: trackId } : c)) };
}

/**
 * Route channels to a track and the ones after it, one each, in the rack's order (FL's Ctrl+Shift+L).
 * Each track that has no name yet takes its channel's (one already named keeps its own). Tracks are
 * added at the end when there aren't enough (`newIds` names them).
 */
export function routeChannelsFrom(song: MusicProject, channelIds: readonly string[], trackId: string, newIds: readonly string[] = []): MusicProject {
  const start = trackNumber(song, trackId);
  if (start < 0) return song;
  const wanted = new Set(channelIds);
  const channels = song.channels.filter((c) => wanted.has(c.id));
  if (!channels.length) return song;
  const missing = start + channels.length - song.mixer.tracks.length;
  let next = missing > 0 ? addMixerTracks(song, null, missing, newIds) : song;
  const count = Math.min(channels.length, next.mixer.tracks.length - start);
  for (let i = 0; i < count; i++) {
    const track = next.mixer.tracks[start + i];
    next = routeChannels(next, [channels[i].id], track.id);
    if (track.name === null && track.id !== MASTER_TRACK_ID) next = updateMixerTrack(next, track.id, { name: channels[i].name });
  }
  return next;
}

/**
 * Give each channel a free track of its own, named after it (FL's TRACK label, and the rack's "Assign
 * to free mixer tracks"): the first free one, or a new one at the end. `newIds` names any added.
 */
export function routeToFreeTracks(song: MusicProject, channelIds: readonly string[], newIds: readonly string[] = []): MusicProject {
  let next = song;
  let added = 0;
  for (const channelId of channelIds) {
    const channel = next.channels.find((c) => c.id === channelId);
    if (!channel) continue;
    let track = next.mixer.tracks.find((t) => isFreeTrack(next, t));
    if (!track) {
      const grown = addMixerTracks(next, null, 1, newIds.slice(added, added + 1));
      if (grown === next) break;
      next = grown;
      added++;
      track = next.mixer.tracks[next.mixer.tracks.length - 1];
    }
    next = updateMixerTrack(routeChannels(next, [channelId], track.id), track.id, { name: channel.name });
  }
  return next;
}

/**
 * Send `from`'s sound to `to` at `level` (0..1), changing the level of a send that's there; null
 * removes it. A send that would make a loop (`canSend`) isn't made.
 */
export function setSend(song: MusicProject, from: string, to: string, level: number | null): MusicProject {
  const track = getMixerTrack(song, from);
  if (!track) return song;
  const current = track.sends.find((s) => s.to === to);
  if (level === null) return current ? updateTracks(song, [from], (t) => ({ ...t, sends: t.sends.filter((s) => s !== current) })) : song;
  if (!Number.isFinite(level)) return song;
  const value = clamp(level, 0, 1);
  if (current) return current.level === value ? song : updateTracks(song, [from], (t) => ({ ...t, sends: t.sends.map((s) => (s === current ? { to, level: value } : s)) }));
  if (!canSend(song, from, to)) return song;
  return updateTracks(song, [from], (t) => ({ ...t, sends: [...t.sends, { to, level: value }] }));
}

/**
 * FL's "Route to this track only": `from` sends to `to` alone (keeping that send's level if it had one).
 * Refused, like any send, if it would make a loop.
 */
export function sendOnly(song: MusicProject, from: string, to: string): MusicProject {
  const track = getMixerTrack(song, from);
  if (!track || (!track.sends.some((s) => s.to === to) && !canSend(song, from, to))) return song;
  const level = track.sends.find((s) => s.to === to)?.level ?? 1;
  if (track.sends.length === 1 && track.sends[0].to === to) return song;
  return updateTracks(song, [from], (t) => ({ ...t, sends: [{ to, level }] }));
}

// ---------------------------------------------------------------------------
// Effect slots
// ---------------------------------------------------------------------------

const isSlot = (slot: number) => Number.isInteger(slot) && slot >= 0 && slot < EFFECT_SLOTS;

function updateSlots(song: MusicProject, trackId: string, update: (effects: (MixerEffect | null)[]) => (MixerEffect | null)[] | null): MusicProject {
  return updateTracks(song, [trackId], (track) => {
    const effects = update(track.effects);
    return effects ? { ...track, effects } : track;
  });
}

/**
 * Put an effect plugin in a slot (replacing what's there: its settings go with it), or empty the slot
 * with null. `id` names the new effect (its settings' file); otherwise a new one is made.
 */
export function setEffect(song: MusicProject, trackId: string, slot: number, plugin: PluginRef | null, id = createId("fx")): MusicProject {
  if (!isSlot(slot)) return song;
  return updateSlots(song, trackId, (effects) => {
    if (!plugin && !effects[slot]) return null;
    const next = [...effects];
    next[slot] = plugin ? { id, plugin, enabled: true, mix: 1 } : null;
    return next;
  });
}

export type EffectPatch = Partial<Pick<MixerEffect, "enabled" | "mix">>;

/** Bypass an effect or set its mix. */
export function updateEffect(song: MusicProject, trackId: string, slot: number, patch: EffectPatch): MusicProject {
  if (!isSlot(slot)) return song;
  return updateSlots(song, trackId, (effects) => {
    const effect = effects[slot];
    if (!effect) return null;
    const enabled = patch.enabled ?? effect.enabled;
    const mix = Number.isFinite(patch.mix) ? clamp(patch.mix!, 0, 1) : effect.mix;
    if (enabled === effect.enabled && mix === effect.mix) return null;
    const next = [...effects];
    next[slot] = { ...effect, enabled, mix };
    return next;
  });
}

/** Move an effect to another slot, swapping with what's there (a slot dragged onto another). */
export function moveEffectTo(song: MusicProject, trackId: string, from: number, to: number): MusicProject {
  if (!isSlot(from) || !isSlot(to) || from === to) return song;
  return updateSlots(song, trackId, (effects) => {
    if (!effects[from]) return null;
    const next = [...effects];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  });
}

/** Move an effect one slot up (-1) or down (1), swapping with what's there (FL's mouse wheel over a slot). */
export function moveEffect(song: MusicProject, trackId: string, slot: number, direction: -1 | 1): MusicProject {
  const to = slot + direction;
  if (!isSlot(slot) || !isSlot(to)) return song;
  return updateSlots(song, trackId, (effects) => {
    if (!effects[slot]) return null;
    const next = [...effects];
    [next[slot], next[to]] = [next[to], next[slot]];
    return next;
  });
}

// ---------------------------------------------------------------------------
// Track state (copy and paste)
// ---------------------------------------------------------------------------

/**
 * What FL's "Save mixer track state" keeps of a track: its effects and its own controls (not its name,
 * colour or routing). Pasted onto another track, its effects are copies with ids of their own.
 */
export type TrackState = Pick<MixerTrack, "effects" | "volume" | "pan" | "invert" | "swap" | "stereo" | "latencyOffset">;

export function trackState(song: MusicProject, id: string): TrackState | null {
  const track = getMixerTrack(song, id);
  if (!track) return null;
  const { effects, volume, pan, invert, swap, stereo, latencyOffset } = track;
  return { effects, volume, pan, invert, swap, stereo, latencyOffset };
}

/**
 * Put a copied state on a track. Each effect gets the id `newIds` has for it (by the copied effect's
 * id; their settings files are copied by the server, `CopyStatesRequest`), or a new one.
 */
export function pasteTrackState(song: MusicProject, id: string, state: TrackState, newIds: ReadonlyMap<string, string> = new Map()): MusicProject {
  if (!getMixerTrack(song, id)) return song;
  const effects = Array.from({ length: EFFECT_SLOTS }, (_, slot) => {
    const effect = state.effects[slot];
    return effect ? { ...effect, id: newIds.get(effect.id) ?? createId("fx") } : null;
  });
  const pasted = updateMixerTrack(song, id, { volume: state.volume, pan: state.pan, invert: state.invert, swap: state.swap, stereo: state.stereo, latencyOffset: state.latencyOffset });
  return updateTracks(pasted, [id], (track) => ({ ...track, effects }));
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const withGroups = (song: MusicProject, groups: MixerGroup[]): MusicProject => ({ ...song, mixer: { ...song.mixer, groups } });
/** The groups some track is still in (a group left empty goes). */
const keptGroups = (song: MusicProject) => song.mixer.groups.filter((g) => song.mixer.tracks.some((t) => t.group === g.id));

/** "Group 3": the first such name no group has. */
export function nextGroupName(song: MusicProject): string {
  const names = new Set(song.mixer.groups.map((g) => g.name));
  for (let n = song.mixer.groups.length + 1; ; n++) if (!names.has(`Group ${n}`)) return `Group ${n}`;
}

/** Put tracks in a new named group (FL's Create group), taking them out of any they were in. Never the master. */
export function createGroup(song: MusicProject, ids: readonly string[], name = nextGroupName(song), id = createId("group")): MusicProject {
  const members = ids.filter((t) => t !== MASTER_TRACK_ID && getMixerTrack(song, t));
  if (!members.length) return song;
  const grouped = updateTracks(song, members, (t) => ({ ...t, group: id }));
  return withGroups(grouped, [...keptGroups(grouped), { id, name: name.trim().slice(0, MAX_NAME) || nextGroupName(song) }]);
}

/** Take tracks out of their groups (a group left empty goes). */
export function ungroup(song: MusicProject, ids: readonly string[]): MusicProject {
  const next = updateTracks(song, ids, (t) => (t.group === null ? t : { ...t, group: null }));
  return next === song ? song : withGroups(next, keptGroups(next));
}

export function renameGroup(song: MusicProject, groupId: string, name: string): MusicProject {
  const trimmed = name.trim().slice(0, MAX_NAME);
  const group = song.mixer.groups.find((g) => g.id === groupId);
  if (!group || !trimmed || trimmed === group.name) return song;
  return withGroups(song, song.mixer.groups.map((g) => (g === group ? { ...g, name: trimmed } : g)));
}
