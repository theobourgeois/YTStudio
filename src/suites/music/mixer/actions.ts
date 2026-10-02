/**
 * What the mixer's menus, clicks and keys do (`docs/fl-studio/mixer.md`): each reads the stores and
 * commits one edit from `shared/music/mixer.ts`. Kept out of the components so a menu item and its
 * shortcut can't drift apart.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { createId } from "@shared/ids";
import { startPointerDrag } from "@/lib/pointer-drag";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import {
  addMixerTracks,
  canSend,
  createGroup,
  effectToTrack,
  freeSlot,
  getMixerTrack,
  moveMixerTracks,
  pasteTrackState,
  removeMixerTracks,
  renameGroup,
  setMixerControls,
  setMixerMuted,
  setMixerSolo,
  type MixerTrackPatch,
  routeChannels,
  routeChannelsFrom,
  routeToFreeTracks,
  routeToNewBus,
  sendOnly,
  setSend,
  setSoloSafe,
  clearMixerSolo,
  soloMixerTrack,
  toggleMixerSolo,
  trackState,
  ungroup,
  updateMixerTracks,
} from "@shared/music/mixer";
import { MASTER_TRACK_ID } from "@shared/music/project";
import { assignAudioTracks } from "@shared/music/recording";
import type { MixerDock, MusicProject } from "@shared/music/types";
import { musicApi } from "../api";
import { selectedIds as selectedChannelIds } from "../rack-actions";
import { songGesture, useMusic } from "../store";
import { currentTrackId, useMusicUi } from "../ui";
import { sendToggle } from "./send-states";
import { trackAt, useMixerView } from "./view";

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

/*
 * A strip's switches act on every selected track when it's one of them (Logic's, Reaper's, Bitwig's way),
 * and on it alone when it isn't, so a click on an unselected strip never surprises. Each takes its state
 * from the strip clicked: muting a muted track unmutes all of them.
 */

/** The mute light: the track (and the selected tracks with it) muted, or unmuted if it's muted. */
export const toggleTrackMute = (id: string) => commit((doc) => setMixerMuted(doc, menuTargets(id), !getMixerTrack(doc, id)?.muted));
/** S: the tracks join the solo, or leave it (the other solos kept). */
export const toggleSolo = (id: string) => commit((doc) => toggleMixerSolo(doc, menuTargets(id)));
/** Alt+S, Alt+click, a right-click on the mute light: the tracks soloed alone (again: no solo). */
export const soloAlone = (id: string) => commit((doc) => soloMixerTrack(doc, menuTargets(id)));
/** Shift+click on S: another track's solo never silences them. */
export const toggleSoloSafe = (id: string) => commit((doc) => setSoloSafe(doc, menuTargets(id), !getMixerTrack(doc, id)?.soloSafe));
/**
 * A plain press on a mute light or an S, painted across the strips (Pro Tools', Reaper's, Ableton's):
 * the press switches its tracks (the selected ones with it) as a click would, and every strip the pointer
 * then passes over is switched the same way. One undo step; Escape puts them all back.
 */
export function paintSwitch(e: ReactPointerEvent<Element>, id: string, kind: "mute" | "solo") {
  const doc = song();
  if (!doc || e.button !== 0) return;
  const targets = menuTargets(id);
  const tracks = doc.mixer.tracks.filter((t) => targets.includes(t.id) && (kind === "mute" || t.id !== MASTER_TRACK_ID));
  const on = kind === "mute" ? !getMixerTrack(doc, id)?.muted : !tracks.every((t) => t.solo);
  const set = (song: MusicProject, ids: string[]) => (kind === "mute" ? setMixerMuted(song, ids, on) : setMixerSolo(song, ids, on));
  const painted = new Set(targets);
  const gesture = songGesture();
  gesture.begin();
  gesture.apply((song) => set(song, [...painted]));
  startPointerDrag(e, {
    threshold: 0,
    onMove(ev) {
      const over = trackAt(ev.clientX, ev.clientY);
      if (!over || painted.has(over)) return;
      painted.add(over);
      gesture.apply((song) => set(song, [over]));
    },
    onEnd: () => gesture.end(),
    onClick: () => gesture.end(),
    onCancel: () => gesture.cancel(),
  });
}

/** A strip's switch (invert phase, swap sides) set on it and the selected tracks with it. */
export const setTrackSwitch = (id: string, patch: Pick<MixerTrackPatch, "invert" | "swap">) => commit((doc) => updateMixerTracks(doc, menuTargets(id), patch));

/**
 * A strip's knob (pan, stereo separation) as an edit of the tracks it acts on (`menuTargets`). Dragged,
 * every one moves by as much as this one from where it started, so their offsets are kept; set outright
 * (a reset, a typed value), they all take the value.
 */
export function groupKnob(id: string, control: "pan" | "stereo") {
  return (doc: MusicProject, value: number): MusicProject => {
    const targets = menuTargets(id);
    const base = useMusic.getState().history?.gestureBase ?? null;
    if (!base || targets.length < 2) return updateMixerTracks(doc, targets, { [control]: value });
    const delta = value - (getMixerTrack(base, id)?.[control] ?? value);
    return setMixerControls(doc, control, new Map(targets.map((t) => [t, (getMixerTrack(base, t)?.[control] ?? 0) + delta])));
  };
}
export const clearSolo = () => commit(clearMixerSolo);

/** The rack's selected channels to a track (Ctrl+L), or to it and the tracks after it, one each (Ctrl+Shift+L). */
export function routeSelectedChannels(trackId = currentTrack(), starting = false) {
  const channels = selectedChannelIds();
  if (!channels.length) return;
  commit((doc) => (starting ? routeChannelsFrom(doc, channels, trackId) : routeChannels(doc, channels, trackId)));
}

/** Select a channel's track in the mixer and bring it into view: its insert number was just changed. */
export function showChannelTrack(channelId: string) {
  const track = song()?.channels.find((c) => c.id === channelId)?.mixerTrack;
  if (!track) return;
  useMusicUi.getState().setTrackSelection([track]);
  useMixerView.getState().reveal(track);
}

/** A channel to a track (the rack's track selector, TRACK in its window); the mixer selects that track. */
export function routeChannel(channelId: string, trackId: string) {
  commit((doc) => routeChannels(doc, [channelId], trackId));
  showChannelTrack(channelId);
}

/** A channel to the first free track, named after it (a click on TRACK); the Mixer opens on it, selected and scrolled to. */
export function routeToFreeTrack(channelId: string) {
  commit((doc) => routeToFreeTracks(doc, [channelId]));
  showInMixer(channelId);
}

/** The Mixer, in front, with the channel's track selected and scrolled into view (the track selector's Show in the mixer). */
export function showInMixer(channelId: string) {
  showChannelTrack(channelId);
  useMusicUi.getState().setMixerOpen(true);
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

/** Only the current track stays selected (Escape, a click on the mixer's empty space). */
export function selectOnlyCurrent() {
  const ui = useMusicUi.getState();
  if (ui.selectedTrackIds.length > 1) ui.setTrackSelection([currentTrack()]);
}

/**
 * Shift+click: the tracks from the current one to `id`, in the mixer's order, selected (the current one
 * stays first, so the inspector keeps showing it).
 */
export function selectTrackRange(id: string) {
  const doc = song();
  if (!doc) return;
  const from = currentTrack();
  const a = doc.mixer.tracks.findIndex((t) => t.id === from);
  const b = doc.mixer.tracks.findIndex((t) => t.id === id);
  if (a < 0 || b < 0) return;
  const range = doc.mixer.tracks.slice(Math.min(a, b), Math.max(a, b) + 1).map((t) => t.id);
  useMusicUi.getState().setTrackSelection([from, ...range.filter((t) => t !== from)]);
}

/** A click on a group's band: its tracks selected (with Cmd, added to the selection). */
export function selectGroup(groupId: string, add: boolean) {
  const doc = song();
  if (!doc) return;
  const members = doc.mixer.tracks.filter((t) => t.group === groupId).map((t) => t.id);
  if (!members.length) return;
  const ui = useMusicUi.getState();
  if (add) ui.includeTracks(members);
  else ui.setTrackSelection(members);
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

/** A new insert track after the last one (the + at the end of the strips), selected and scrolled to. */
export function addTrackAtEnd() {
  const id = createId("insert");
  commit((doc) => addMixerTracks(doc, null, 1, [id]));
  if (song()?.mixer.tracks.some((t) => t.id === id)) {
    useMusicUi.getState().setTrackSelection([id]);
    useMixerView.getState().reveal(id);
  }
}

/**
 * ⌘G: the selected tracks (or `id`'s alone, if it isn't one of them) to a new bus right after them, which
 * is selected, scrolled to, and named at once.
 */
export function routeSelectedToNewBus(id = currentTrack()) {
  const busId = createId("insert");
  commit((doc) => routeToNewBus(doc, menuTargets(id), busId));
  if (!song()?.mixer.tracks.some((t) => t.id === busId)) return;
  useMusicUi.getState().setTrackSelection([busId]);
  useMixerView.getState().reveal(busId);
  // Once it's drawn.
  setTimeout(() => useMixerView.getState().rename(busId), 0);
}

/** Delete tracks (never the master); the selection goes to the track before the first. */
export function deleteTracks(ids: string[]) {
  const doc = song();
  if (!doc) return;
  const first = doc.mixer.tracks.findIndex((t) => ids.includes(t.id) && t.id !== MASTER_TRACK_ID);
  commit((d) => removeMixerTracks(d, ids));
  if (first > 0) useMusicUi.getState().setTrackSelection([song()!.mixer.tracks[first - 1].id]);
}

/** The tracks a track's menu acts on: every selected track if it's one of them, else it alone (FL's way). */
export function menuTargets(id: string): string[] {
  const selected = selectedTracks();
  return selected.includes(id) ? selected : [id];
}

/** Rename a track, or every selected track if it's one of them (the same name for all). */
export const renameTrack = (id: string, name: string) => commit((doc) => updateMixerTracks(doc, menuTargets(id), { name }));

/** Dock a track, or every selected track if it's one of them, to the mixer's left, middle or right (never the master). */
export const dockTracks = (id: string, dock: MixerDock) => commit((doc) => updateMixerTracks(doc, menuTargets(id), { dock }));

/** Toggle the divider before a track (or before every selected track, if it's one of them), as its state is. */
export function toggleSeparator(id: string) {
  const on = !song()?.mixer.tracks.find((t) => t.id === id)?.separator;
  commit((doc) => updateMixerTracks(doc, menuTargets(id), { separator: on }));
}

/** Group a track with the other selected ones (FL's Create group), and type its name at once. */
export function groupTracks(id: string) {
  const groupId = createId("group");
  commit((doc) => createGroup(doc, menuTargets(id), undefined, groupId));
  if (song()?.mixer.groups.some((g) => g.id === groupId)) useMixerView.getState().renameGroup(groupId);
}

export const ungroupTracks = (id: string) => commit((doc) => ungroup(doc, menuTargets(id)));
export const renameMixerGroup = (groupId: string, name: string) => commit((doc) => renameGroup(doc, groupId, name));

/** Colour a track, or every selected track if it's one of them. */
export const colourTrack = (id: string, color: string | null) => commit((doc) => updateMixerTracks(doc, menuTargets(id), { color }));

/** The tracks sends are made from: every selected track, the current one first. */
export function sendSources(): string[] {
  const current = currentTrack();
  return [current, ...selectedTracks().filter((id) => id !== current)];
}

/**
 * A click on a track's send switch: the selected tracks stop sending to `to` if they all do, else the ones
 * that don't (and can) start (`sendToggle`).
 */
export function toggleSend(to: string) {
  commit((doc) => {
    const { remove, add } = sendToggle(doc.mixer, sendSources(), to);
    const removed = remove.reduce((next, from) => setSend(next, from, to, null), doc);
    return add.reduce((next, from) => setSend(next, from, to, 1), removed);
  });
}

/** "Route to this track only": the selected tracks' sound goes to `to` and nowhere else. */
export const sendOnlyTo = (to: string) => commit((doc) => sendSources().reduce((next, from) => sendOnly(next, from, to), doc));

/** The output label's choice: `id` (and the selected tracks with it, if it's one of them) go to `to` alone (their sidechains stay). */
export const sendOnlyFrom = (id: string, to: string) =>
  commit((doc) => menuTargets(id).reduce((next, from) => onlyTo(next, from, to), doc));

/** `from`'s sound to `to` alone, its sidechains (sends at 0) kept; nothing if that would loop. */
function onlyTo(doc: MusicProject, from: string, to: string): MusicProject {
  const track = getMixerTrack(doc, from);
  if (!track || from === to || (!track.sends.some((s) => s.to === to) && !canSend(doc, from, to))) return doc;
  // Its level if it went there already (a sidechain there becomes a send as it is).
  const level = track.sends.find((s) => s.to === to)?.level || 1;
  const removed = track.sends.filter((s) => s.level > 0 && s.to !== to).reduce((next, s) => setSend(next, from, s.to, null), doc);
  return setSend(removed, from, to, level);
}

/**
 * A selected track's down-arrow dragged onto another strip (a cable plugged in): the selected tracks go
 * there alone (sidechains kept), or with ⌘ / Alt it's a send besides where they go. Let go anywhere else,
 * nothing changes.
 */
export function plugCable(e: ReactPointerEvent<Element>) {
  const view = useMixerView.getState();
  const from = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-track]")?.dataset.track;
  if (!from) return;
  startPointerDrag(e, {
    threshold: 4,
    cursor: "grabbing",
    onMove(ev) {
      const over = trackAt(ev.clientX, ev.clientY);
      view.plug({ from, x: ev.clientX, y: ev.clientY, over: over && !sendSources().includes(over) ? over : null, add: ev.metaKey || ev.ctrlKey || ev.altKey });
    },
    onEnd() {
      const plugging = useMixerView.getState().plugging;
      view.plug(null);
      if (!plugging?.over) return;
      const to = plugging.over;
      if (plugging.add) commit((doc) => sendSources().reduce((next, from) => (getMixerTrack(next, from)?.sends.some((s) => s.to === to) ? next : setSend(next, from, to, 1)), doc));
      else commit((doc) => sendSources().reduce((next, from) => onlyTo(next, from, to), doc));
    },
    onCancel: () => view.plug(null),
  });
}

/** "Sidechain to this track": sends at 0, which plugins on `to` can hear but the track doesn't. */
export const sidechainTo = (to: string) => commit((doc) => sendSources().reduce((next, from) => setSend(next, from, to, 0), doc));

/**
 * A send knob as an edit of every selected track's send to `to` (`owner`'s is the one it shows). Dragged,
 * each moves by as much as `owner`'s from where it started; set outright, they all take the value.
 */
export function groupSend(to: string, owner: string) {
  return (doc: MusicProject, value: number): MusicProject => {
    const base = useMusic.getState().history?.gestureBase ?? doc;
    const levelIn = (song: MusicProject, from: string) => getMixerTrack(song, from)?.sends.find((s) => s.to === to)?.level;
    const senders = sendSources().filter((from) => levelIn(doc, from) !== undefined);
    const dragged = useMusic.getState().history?.gestureBase != null;
    const delta = value - (levelIn(base, owner) ?? value);
    return senders.reduce((next, from) => setSend(next, from, to, dragged ? (levelIn(base, from) ?? levelIn(doc, from)!) + delta : value), doc);
  };
}

/**
 * The track menu's "Selected tracks to this track": each selected track (but `to`) sends to it, alone
 * (`only`, FL's "Route selected to this track only"), at 0 (`sidechain`), or besides its other sends.
 */
export function routeSelectedTracksTo(to: string, how: "send" | "only" | "sidechain") {
  const from = selectedTracks().filter((id) => id !== to);
  if (!from.length) return;
  commit((doc) => from.reduce((next, id) => (how === "only" ? sendOnly(next, id, to) : setSend(next, id, to, how === "sidechain" ? 0 : 1)), doc));
}

/** Copy a track's state: its effects (as their settings are now) and its controls (FL's "Save mixer track state"). */
export function copyTrackState(id = currentTrack()) {
  const { projectId, history } = useMusic.getState();
  const state = history && trackState(history.doc, id);
  if (projectId && state) useMusicUi.getState().copyTrack({ projectId, state });
}

/**
 * Paste the copied state onto a track: its effects become copies of the copied ones, their plugins'
 * settings files copied first (by the server), so they start as the originals are.
 */
export async function pasteTrackStateOnto(id = currentTrack()) {
  const copied = useMusicUi.getState().copiedTrack;
  const projectId = useMusic.getState().projectId;
  if (!copied || !projectId) return;
  const ids = new Map(copied.state.effects.flatMap((effect) => (effect ? [[effect.id, createId("fx")] as const] : [])));
  // Settings only carry over within a song (another song's plugins folder isn't this one's).
  if (ids.size && copied.projectId === projectId) {
    try {
      await musicApi.copyStates({ projectId, copies: [...ids].map(([from, to]) => ({ from, to })) });
    } catch (err) {
      toast.error("Couldn't copy the effects' settings", { description: errorMessage(err) });
    }
  }
  if (useMusic.getState().projectId === projectId) commit((doc) => pasteTrackState(doc, id, copied.state, ids));
}

/**
 * An effect slot dragged onto a track's strip: the effect moves there (its plugin as it is, its settings
 * and automation with it), or with `copy` (⌘-drag) a copy goes there, its plugin's settings copied first by
 * the server. Into slot `to` if it's empty, else the first empty one; a track with none says so.
 */
export async function effectOnto(fromTrack: string, slot: number, toTrack: string, copy: boolean, to?: number) {
  const doc = song();
  const projectId = useMusic.getState().projectId;
  const effect = doc && getMixerTrack(doc, fromTrack)?.effects[slot];
  if (!doc || !projectId || !effect) return;
  if (freeSlot(doc, toTrack) === null) return void toast.info("No free slot", { description: "Every effect slot of that track is taken: empty one first." });
  if (!copy) {
    commit((now) => effectToTrack(now, fromTrack, slot, toTrack, { to }));
    useMusicUi.getState().selectTrack(toTrack);
    return;
  }
  const id = createId("fx");
  // Ours keep their settings in the song; a plugin's are a file, copied as a track state's are.
  try {
    await musicApi.copyStates({ projectId, copies: [{ from: effect.id, to: id }] });
  } catch (err) {
    toast.error("Couldn't copy the effect's settings", { description: errorMessage(err) });
  }
  if (useMusic.getState().projectId !== projectId) return;
  commit((now) => effectToTrack(now, fromTrack, slot, toTrack, { to, copy: id }));
  useMusicUi.getState().selectTrack(toTrack);
}

/**
 * FL's Assign to new audio track(s): a Playlist track for each of the selected mixer tracks (or `id`'s
 * alone, if it isn't one of them) that hasn't one, below what's in use, named after it.
 */
export function assignAudioTracksTo(id: string) {
  const selected = selectedTracks();
  const ids = selected.includes(id) ? selected : [id];
  useMusic.getState().commit((song) => assignAudioTracks(song, ids));
}
