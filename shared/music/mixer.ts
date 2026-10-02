/**
 * The mixer's queries and edits (`docs/fl-studio/mixer.md`): its tracks, routing channels to them,
 * sends between them and their effect slots. Pure `(MusicProject) => MusicProject`, returning **the
 * same instance** when nothing changed, like the rest of `edits.ts`.
 */
import { createId } from "../ids.ts";
import { clamp } from "../math.ts";
import { AUTO_TUNE_PLUGIN, DEFAULT_AUTO_TUNE, isAutoTune } from "./auto-tune-presets.ts";
import { DEFAULT_ECHO_BOY, ECHO_BOY_PLUGIN, isEchoBoy } from "./echo-boy-presets.ts";
import { DEFAULT_PITCH_WHEEL, PITCH_WHEEL_PLUGIN, isPitchWheel } from "./pitch-wheel-presets.ts";
import { GROSS_BEAT_PLUGIN, isGrossBeat } from "./gross-beat-presets.ts";
import { DEFAULT_PANMAN, PANMAN_PLUGIN, isPanMan } from "./panman-presets.ts";
import { PRO_Q_PLUGIN, isProQ } from "./pro-q-presets.ts";
import { DEFAULT_OTT, OTT_PLUGIN, isOtt } from "./ott-presets.ts";
import { DEFAULT_GROSS_BEAT, DEFAULT_PRO_Q, EFFECT_SLOTS, INPUT_MONITORS, MASTER_TRACK_ID, MAX_INPUT_OFFSET, MAX_INSERTS, MAX_LATENCY_OFFSET, MAX_NAME, createMixerTrack, normalizeInput, reaches, trimTracks } from "./project.ts";
import type { Channel, MixerDock, MixerEffect, MixerGroup, MixerSend, MixerTrack, MusicProject, PluginRef } from "./types.ts";

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
  // A playlist track linked to one of them is an ordinary track again.
  const playlist = song.playlist.tracks.some((t) => t.mixerTrack && gone.has(t.mixerTrack))
    ? { ...song.playlist, tracks: trimTracks(song.playlist.tracks.map((t) => (t.mixerTrack && gone.has(t.mixerTrack) ? { ...t, mixerTrack: null } : t))) }
    : song.playlist;
  const removed = { ...withTracks(song, tracks), channels, playlist };
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

/**
 * Insert tracks dragged to another place (by their numbers): put before `before` (null: at the end), in
 * their order, never before the master. With `dock`, they take that dock (dropped among its tracks).
 * Their channels and sends go with them (they're linked by id).
 */
export function moveMixerTracksTo(song: MusicProject, ids: readonly string[], before: string | null, dock?: MixerDock): MusicProject {
  const wanted = new Set(ids);
  const moving = song.mixer.tracks.filter((t) => wanted.has(t.id) && t.id !== MASTER_TRACK_ID);
  if (!moving.length) return song;
  // Before one of those moving: before the first after it that isn't.
  let anchor = before;
  if (anchor !== null && wanted.has(anchor)) {
    const from = trackNumber(song, anchor);
    anchor = song.mixer.tracks.slice(from).find((t) => !wanted.has(t.id))?.id ?? null;
  }
  const rest = song.mixer.tracks.filter((t) => !wanted.has(t.id) || t.id === MASTER_TRACK_ID);
  const found = anchor === null ? rest.length : rest.findIndex((t) => t.id === anchor);
  if (found < 0) return song;
  const at = Math.max(1, found);
  const placed = moving.map((t) => (dock && t.dock !== dock ? { ...t, dock } : t));
  const tracks = [...rest.slice(0, at), ...placed, ...rest.slice(at)];
  return tracks.every((t, i) => t === song.mixer.tracks[i]) ? song : withTracks(song, tracks);
}

/** Fold a bus (its tracks hidden under it), or unfold it. Never the master (everything would go). */
export const setTrackFolded = (song: MusicProject, ids: readonly string[], folded: boolean) =>
  updateTracks(song, ids, (t) => (t.id === MASTER_TRACK_ID || !!t.folded === folded ? t : folded ? { ...t, folded: true as const } : withoutFolded(t)));

const withoutFolded = ({ folded: _, ...track }: MixerTrack): MixerTrack => track;

/**
 * The tracks folded away under folded buses: every track that sends sound somewhere and only into folded
 * buses or tracks folded away themselves (so a bus inside a folded bus goes too, with its own tracks).
 */
export function foldedAway(song: Pick<MusicProject, "mixer">): Set<string> {
  const folded = new Set(song.mixer.tracks.filter((t) => t.folded).map((t) => t.id));
  const away = new Set<string>();
  if (!folded.size) return away;
  // Until nothing more goes (each pass reaches at least one level further down).
  for (let changed = true; changed; ) {
    changed = false;
    for (const track of song.mixer.tracks) {
      if (away.has(track.id) || track.id === MASTER_TRACK_ID) continue;
      const out = track.sends.filter((s) => s.level > 0);
      if (out.length && out.every((s) => folded.has(s.to) || away.has(s.to))) {
        away.add(track.id);
        changed = true;
      }
    }
  }
  return away;
}

/** How many tracks feed a track directly (sends with sound): what a fold would hide first. */
export const feedersOf = (song: Pick<MusicProject, "mixer">, id: string) => song.mixer.tracks.filter((t) => t.sends.some((s) => s.to === id && s.level > 0)).length;

export type MixerTrackPatch = Partial<
  Pick<MixerTrack, "name" | "color" | "dock" | "separator" | "volume" | "pan" | "muted" | "solo" | "soloSafe" | "invert" | "swap" | "stereo" | "latencyOffset" | "input" | "monitor" | "inputOffset">
>;

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
    // The master is what's heard: it's never soloed.
    solo: track.id === MASTER_TRACK_ID ? false : (patch.solo ?? track.solo),
    soloSafe: patch.soloSafe ?? track.soloSafe,
    invert: patch.invert ?? track.invert,
    swap: patch.swap ?? track.swap,
    stereo: patch.stereo === undefined || !Number.isFinite(patch.stereo) ? track.stereo : clamp(patch.stereo, -1, 1),
    latencyOffset:
      patch.latencyOffset === undefined || !Number.isFinite(patch.latencyOffset)
        ? track.latencyOffset
        : Math.round(clamp(patch.latencyOffset, -MAX_LATENCY_OFFSET, MAX_LATENCY_OFFSET) * 100) / 100,
    input: patch.input === undefined || track.id === MASTER_TRACK_ID ? track.input : sameInput(track.input, normalizeInput(patch.input)),
    monitor: patch.monitor !== undefined && INPUT_MONITORS.includes(patch.monitor) ? patch.monitor : track.monitor,
    inputOffset:
      patch.inputOffset === undefined || !Number.isFinite(patch.inputOffset)
        ? track.inputOffset
        : Math.round(clamp(patch.inputOffset, -MAX_INPUT_OFFSET, MAX_INPUT_OFFSET) * 100) / 100,
  };
  return (Object.keys(next) as (keyof MixerTrack)[]).every((key) => next[key] === track[key]) ? track : next;
}

/** `next`, or `was` itself when they're the same input (so an edit that changes nothing is no edit). */
const sameInput = (was: MixerTrack["input"], next: MixerTrack["input"]) =>
  was && next && was.channel === next.channel && was.stereo === next.stereo ? was : next;

export const updateMixerTrack = (song: MusicProject, id: string, patch: MixerTrackPatch) => updateTracks(song, [id], (t) => patchedTrack(t, patch));

/** The same change to several tracks at once (a colour or a name given to every selected track). */
export const updateMixerTracks = (song: MusicProject, ids: readonly string[], patch: MixerTrackPatch) => updateTracks(song, ids, (t) => patchedTrack(t, patch));

/** Set a control of several tracks at once, each to its own value (the selected tracks' pans moved together). */
export const setMixerControls = (song: MusicProject, control: "volume" | "pan" | "stereo", values: ReadonlyMap<string, number>) =>
  updateTracks(song, [...values.keys()], (t) => {
    const value = values.get(t.id)!;
    return Number.isFinite(value) ? patchedTrack(t, { [control]: value }) : t;
  });

/** Set several tracks' faders at once, each to its own level (FL moves every selected track's fader together). */
export const setMixerVolumes = (song: MusicProject, volumes: ReadonlyMap<string, number>) => setMixerControls(song, "volume", volumes);

export const setMixerMuted = (song: MusicProject, ids: readonly string[], muted: boolean) => updateTracks(song, ids, (t) => patchedTrack(t, { muted }));

/** Solo tracks, or unsolo them (`shared/music/solo.ts`: a state of its own, the mutes left as they are). Never the master. */
export const setMixerSolo = (song: MusicProject, ids: readonly string[], solo: boolean) => updateTracks(song, ids, (t) => patchedTrack(t, { solo }));

/** A click on S: the tracks join the solo, or leave it if they're all soloed already (Pro Tools' and Logic's additive solo). */
export function toggleMixerSolo(song: MusicProject, ids: readonly string[]): MusicProject {
  const tracks = song.mixer.tracks.filter((t) => ids.includes(t.id) && t.id !== MASTER_TRACK_ID);
  return setMixerSolo(song, ids, !tracks.every((t) => t.solo));
}

/**
 * Solo these tracks alone (Alt+click, FL's solo): every other solo goes. Soloing again the tracks that are
 * the only ones soloed clears the solo.
 */
export function soloMixerTrack(song: MusicProject, ids: string | readonly string[]): MusicProject {
  const wanted = new Set((typeof ids === "string" ? [ids] : ids).filter((id) => id !== MASTER_TRACK_ID && getMixerTrack(song, id)));
  if (!wanted.size) return song;
  const alone = song.mixer.tracks.every((t) => t.solo === wanted.has(t.id));
  return updateTracks(song, song.mixer.tracks.map((t) => t.id), (t) => patchedTrack(t, { solo: !alone && wanted.has(t.id) }));
}

/** Clear every solo (the mutes stay as they were). */
export const clearMixerSolo = (song: MusicProject) => setMixerSolo(song, song.mixer.tracks.map((t) => t.id), false);

/** Make tracks solo safe, or not: another track's solo never silences a safe one. */
export const setSoloSafe = (song: MusicProject, ids: readonly string[], soloSafe: boolean) => updateTracks(song, ids, (t) => patchedTrack(t, { soloSafe }));

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
  if (current) return current.level === value ? song : updateTracks(song, [from], (t) => ({ ...t, sends: t.sends.map((s) => (s === current ? { ...s, level: value } : s)) }));
  if (!canSend(song, from, to)) return song;
  return updateTracks(song, [from], (t) => ({ ...t, sends: [...t.sends, { to, level: value }] }));
}

/** "Bus", "Bus 2"...: the first such name no track has. */
export function nextBusName(song: MusicProject): string {
  const names = new Set(song.mixer.tracks.map((t) => t.name));
  if (!names.has("Bus")) return "Bus";
  for (let n = 2; ; n++) if (!names.has(`Bus ${n}`)) return `Bus ${n}`;
}

/**
 * Route tracks to a new bus (Ableton's and Bitwig's ⌘G, Logic's summing stack): an insert added right after
 * the last of them, `name`d, that their sound now goes to instead of where it went (their sidechains stay).
 * The bus goes where they all went, when that was one same track, else to the master. Never the master
 * itself; the same song when there's nothing to route or no room for a track.
 */
export function routeToNewBus(song: MusicProject, ids: readonly string[], busId = createId("insert"), name = nextBusName(song)): MusicProject {
  const members = song.mixer.tracks.filter((t) => ids.includes(t.id) && t.id !== MASTER_TRACK_ID);
  if (!members.length) return song;
  const added = addMixerTracks(song, members[members.length - 1].id, 1, [busId]);
  if (added === song) return song;
  // Where they all went, if it's one place.
  const outs = members.map((t) => t.sends.filter((s) => s.level > 0).map((s) => s.to));
  const shared = outs.every((o) => o.length === 1 && o[0] === outs[0][0]) ? outs[0][0] : MASTER_TRACK_ID;
  const routed = updateTracks(added, members.map((t) => t.id), (t) => ({ ...t, sends: [...t.sends.filter((s) => s.level === 0 && s.to !== busId), { to: busId, level: 1 }] }));
  const named = updateMixerTrack(routed, busId, { name });
  return shared !== MASTER_TRACK_ID && canSend(named, busId, shared) ? sendOnly(named, busId, shared) : named;
}

/**
 * FL's "Route to this track only": `from` sends to `to` alone (keeping that send's level if it had one).
 * Refused, like any send, if it would make a loop.
 */
export function sendOnly(song: MusicProject, from: string, to: string): MusicProject {
  const track = getMixerTrack(song, from);
  if (!track || (!track.sends.some((s) => s.to === to) && !canSend(song, from, to))) return song;
  const kept = track.sends.find((s) => s.to === to) ?? { to, level: 1 };
  if (track.sends.length === 1 && track.sends[0].to === to) return song;
  return updateTracks(song, [from], (t) => ({ ...t, sends: [kept] }));
}

/** A send taken before the track's fader and pan (`preFader`), or after them as usual. */
export function setSendPreFader(song: MusicProject, from: string, to: string, preFader: boolean): MusicProject {
  const send = getMixerTrack(song, from)?.sends.find((s) => s.to === to);
  if (!send || !!send.preFader === preFader) return song;
  return updateTracks(song, [from], (t) => ({ ...t, sends: t.sends.map((s) => (s === send ? (preFader ? { ...s, preFader: true as const } : { to: s.to, level: s.level }) : s)) }));
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
    next[slot] = plugin ? newEffect(plugin, id) : null;
    return next;
  });
}

/** A new effect for a slot: ours with their settings as they come, or a plugin. */
function newEffect(plugin: PluginRef, id: string): MixerEffect {
  if (isGrossBeat(plugin)) return { id, plugin: GROSS_BEAT_PLUGIN, enabled: true, mix: 1, grossBeat: DEFAULT_GROSS_BEAT };
  if (isAutoTune(plugin)) return { id, plugin: AUTO_TUNE_PLUGIN, enabled: true, mix: 1, autoTune: DEFAULT_AUTO_TUNE };
  if (isEchoBoy(plugin)) return { id, plugin: ECHO_BOY_PLUGIN, enabled: true, mix: 1, echoBoy: DEFAULT_ECHO_BOY };
  if (isProQ(plugin)) return { id, plugin: PRO_Q_PLUGIN, enabled: true, mix: 1, proQ: DEFAULT_PRO_Q };
  if (isOtt(plugin)) return { id, plugin: OTT_PLUGIN, enabled: true, mix: 1, ott: DEFAULT_OTT };
  if (isPanMan(plugin)) return { id, plugin: PANMAN_PLUGIN, enabled: true, mix: 1, panMan: DEFAULT_PANMAN };
  if (isPitchWheel(plugin)) return { id, plugin: PITCH_WHEEL_PLUGIN, enabled: true, mix: 1, pitchWheel: DEFAULT_PITCH_WHEEL };
  return { id, plugin, enabled: true, mix: 1 };
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

/** The first empty slot of a track, or null when all ten are taken. */
export function freeSlot(song: MusicProject, trackId: string): number | null {
  const slot = getMixerTrack(song, trackId)?.effects.findIndex((e) => !e) ?? -1;
  return slot >= 0 ? slot : null;
}

/**
 * An effect dragged onto another track (FL Studio's slot dropped on another strip): it moves there, to slot
 * `to` if that's empty, else the first empty one. It keeps its id, so its plugin (loaded as it is), its
 * settings and its automation go with it. With `copy` (the id the copy gets: its plugin's settings file is
 * copied by the server, `CopyStatesRequest`), a copy goes there and the effect stays. The same song back
 * when there's no room or nothing to move.
 */
export function effectToTrack(song: MusicProject, fromTrack: string, slot: number, toTrack: string, options: { to?: number; copy?: string } = {}): MusicProject {
  const effect = isSlot(slot) ? getMixerTrack(song, fromTrack)?.effects[slot] : null;
  if (!effect || !getMixerTrack(song, toTrack) || (fromTrack === toTrack && !options.copy)) return song;
  const wanted = options.to !== undefined && isSlot(options.to) && !getMixerTrack(song, toTrack)!.effects[options.to] ? options.to : null;
  const to = wanted ?? freeSlot(song, toTrack);
  if (to === null) return song;
  const placed = updateSlots(song, toTrack, (effects) => {
    const next = [...effects];
    next[to] = options.copy ? { ...effect, id: options.copy } : effect;
    return next;
  });
  return options.copy ? placed : updateSlots(placed, fromTrack, (effects) => effects.map((e, i) => (i === slot ? null : e)));
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

/** Link a group's controls (a fader moved on one of its tracks moves them all), or unlink them. */
export function setGroupLinked(song: MusicProject, groupId: string, linked: boolean): MusicProject {
  const group = song.mixer.groups.find((g) => g.id === groupId);
  if (!group || !!group.linked === linked) return song;
  return withGroups(song, song.mixer.groups.map((g) => (g === group ? (linked ? { ...g, linked: true as const } : { id: g.id, name: g.name }) : g)));
}

/** `ids` and every track in a linked group with one of them: what a control touched on them moves. */
export function withLinkedTracks(song: MusicProject, ids: readonly string[]): string[] {
  const linked = new Set(song.mixer.groups.filter((g) => g.linked).map((g) => g.id));
  if (!linked.size) return [...ids];
  const wanted = new Set(ids);
  const groups = new Set(song.mixer.tracks.filter((t) => wanted.has(t.id) && t.group && linked.has(t.group)).map((t) => t.group));
  return [...ids, ...song.mixer.tracks.filter((t) => !wanted.has(t.id) && t.group && groups.has(t.group)).map((t) => t.id)];
}

export function renameGroup(song: MusicProject, groupId: string, name: string): MusicProject {
  const trimmed = name.trim().slice(0, MAX_NAME);
  const group = song.mixer.groups.find((g) => g.id === groupId);
  if (!group || !trimmed || trimmed === group.name) return song;
  return withGroups(song, song.mixer.groups.map((g) => (g === group ? { ...g, name: trimmed } : g)));
}
