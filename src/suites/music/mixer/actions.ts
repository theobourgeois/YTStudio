/**
 * What the mixer's menus, clicks and keys do (`docs/fl-studio/mixer.md`): each reads the stores and
 * commits one edit from `shared/music/mixer.ts`. Kept out of the components so a menu item and its
 * shortcut can't drift apart.
 */
import { createId } from "@shared/ids";
import {
  addMixerTracks,
  getMixerTrack,
  moveMixerTracks,
  removeMixerTracks,
  routeChannels,
  routeChannelsFrom,
  routeToFreeTracks,
  sendOnly,
  setSend,
  soloMixerTrack,
  updateMixerTrack,
} from "@shared/music/mixer";
import { MASTER_TRACK_ID } from "@shared/music/project";
import type { MusicProject } from "@shared/music/types";
import { selectedIds as selectedChannelIds } from "../rack-actions";
import { useMusic } from "../store";
import { currentTrackId, useMusicUi } from "../ui";
import { useMixerView } from "./view";

const song = (): MusicProject | null => useMusic.getState().history?.doc ?? null;
const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);

/** The track the inspector shows and sends are made from. */
export function currentTrack(): string {
  const doc = song();
  return doc ? currentTrackId(doc, useMusicUi.getState().selectedTrackIds) : MASTER_TRACK_ID;
}

/** The selected tracks still in the song, in the mixer's order. */
export function selectedTracks(): string[] {
  const doc = song();
  if (!doc) return [];
  const selected = new Set(useMusicUi.getState().selectedTrackIds);
  return doc.mixer.tracks.filter((t) => selected.has(t.id)).map((t) => t.id);
}

export const toggleTrackMute = (id: string) => commit((doc) => updateMixerTrack(doc, id, { muted: !getMixerTrack(doc, id)?.muted }));
export const soloTrack = (id: string, linked = false) => commit((doc) => soloMixerTrack(doc, id, linked));

/** The rack's selected channels to a track (Ctrl+L), or to it and the tracks after it, one each (Ctrl+Shift+L). */
export function routeSelectedChannels(trackId = currentTrack(), starting = false) {
  const channels = selectedChannelIds();
  if (!channels.length) return;
  commit((doc) => (starting ? routeChannelsFrom(doc, channels, trackId) : routeChannels(doc, channels, trackId)));
}

/** A channel to a track (the rack's track selector, TRACK in its window). */
export const routeChannel = (channelId: string, trackId: string) => commit((doc) => routeChannels(doc, [channelId], trackId));

/** A channel to the first free track, named after it (a click on TRACK). */
export function routeToFreeTrack(channelId: string) {
  commit((doc) => routeToFreeTracks(doc, [channelId]));
  const doc = song();
  const track = doc?.channels.find((c) => c.id === channelId)?.mixerTrack;
  if (track && track !== MASTER_TRACK_ID) useMusicUi.getState().setTrackSelection([track]);
}

/** Select, in the rack, the channels routed to a track (Alt+L). */
export function selectChannelsOn(trackId = currentTrack()) {
  const doc = song();
  if (doc) useMusicUi.getState().setSelection(doc.channels.filter((c) => c.mixerTrack === trackId).map((c) => c.id));
}

export const moveSelectedTracks = (direction: -1 | 1) => commit((doc) => moveMixerTracks(doc, selectedTracks(), direction));

/** Select the track before or after the current one (never past the ends). */
export function selectNeighbourTrack(direction: -1 | 1) {
  const doc = song();
  if (!doc) return;
  const index = doc.mixer.tracks.findIndex((t) => t.id === currentTrack());
  const next = doc.mixer.tracks[Math.min(doc.mixer.tracks.length - 1, Math.max(0, index + direction))];
  useMusicUi.getState().setTrackSelection([next.id]);
  useMixerView.getState().reveal(next.id);
}

export function selectAllTracks() {
  const doc = song();
  if (!doc) return;
  const current = currentTrack();
  useMusicUi.getState().setTrackSelection([current, ...doc.mixer.tracks.map((t) => t.id).filter((id) => id !== current)]);
}

/** A new insert track after the current one (the mixer's +), selected. */
export function addTrackAfterCurrent() {
  const id = createId("insert");
  commit((doc) => addMixerTracks(doc, currentTrack(), 1, [id]));
  if (song()?.mixer.tracks.some((t) => t.id === id)) {
    useMusicUi.getState().setTrackSelection([id]);
    useMixerView.getState().reveal(id);
  }
}

/** Delete tracks (never the master); the selection goes to the track before the first. */
export function deleteTracks(ids: string[]) {
  const doc = song();
  if (!doc) return;
  const first = doc.mixer.tracks.findIndex((t) => ids.includes(t.id) && t.id !== MASTER_TRACK_ID);
  commit((d) => removeMixerTracks(d, ids));
  if (first > 0) useMusicUi.getState().setTrackSelection([song()!.mixer.tracks[first - 1].id]);
}

export const renameTrack = (id: string, name: string) => commit((doc) => updateMixerTrack(doc, id, { name }));

/** The current track sends to `to`, or stops (a click on the send switch). */
export function toggleSend(to: string, from = currentTrack()) {
  commit((doc) => {
    const sending = getMixerTrack(doc, from)?.sends.some((s) => s.to === to);
    return setSend(doc, from, to, sending ? null : 1);
  });
}

/** "Route to this track only": the current track's sound goes to `to` and nowhere else. */
export const sendOnlyTo = (to: string, from = currentTrack()) => commit((doc) => sendOnly(doc, from, to));

/** "Sidechain to this track": a send at 0, which plugins on `to` can hear but the track doesn't. */
export const sidechainTo = (to: string, from = currentTrack()) => commit((doc) => setSend(doc, from, to, 0));

/**
 * The track menu's "Selected tracks to this track": each selected track (but `to`) sends to it, alone
 * (`only`, FL's "Route selected to this track only"), at 0 (`sidechain`), or besides its other sends.
 */
export function routeSelectedTracksTo(to: string, how: "send" | "only" | "sidechain") {
  const from = selectedTracks().filter((id) => id !== to);
  if (!from.length) return;
  commit((doc) => from.reduce((next, id) => (how === "only" ? sendOnly(next, id, to) : setSend(next, id, to, how === "sidechain" ? 0 : 1)), doc));
}
