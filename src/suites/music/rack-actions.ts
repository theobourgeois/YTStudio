/**
 * What the channel rack's menus and keys do, FL Studio's way (`docs/fl-studio/channel-rack.md`): each
 * reads the stores and commits one edit. Kept out of the components so a menu item and its shortcut
 * can't drift apart.
 */
import {
  channelNotes,
  cloneChannel,
  lengthOf,
  moveChannels,
  removeChannels,
  replaceChannel,
  rotateSteps,
  setChannelNotes,
  setMuted,
  soloChannel,
  transposeChannels,
  updateChannel,
} from "@shared/music/edits";
import { routeToFreeTracks } from "@shared/music/mixer";
import { createId } from "@shared/ids";
import type { MusicProject, PluginRef } from "@shared/music/types";
import { usePiano } from "./piano/store";
import { currentPattern, useMusic } from "./store";
import { selectedIn, useMusicUi } from "./ui";

const song = (): MusicProject | null => useMusic.getState().history?.doc ?? null;
const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);
const patternId = () => {
  const doc = song();
  return doc ? currentPattern(doc, useMusic.getState().patternId).id : "";
};

/** The selected channels' ids, in the rack's order. */
export function selectedIds(): string[] {
  const doc = song();
  return doc ? selectedIn(doc, useMusicUi.getState().selectedChannelIds).map((c) => c.id) : [];
}

/** The most steps the rack shows of a long pattern (past them, it's the Piano roll's). */
export const RACK_MAX_STEPS = 64;

/** How many steps the rack shows: as wide as it's been dragged, and the pattern's length at least (up to a limit). */
export function shownSteps(doc: MusicProject, currentPatternId: string | null, rackSteps: number): number {
  return Math.max(rackSteps, Math.min(RACK_MAX_STEPS, lengthOf(doc, currentPattern(doc, currentPatternId))));
}

export const toggleMute = (channelId: string) => commit((doc) => updateChannel(doc, channelId, { muted: !doc.channels.find((c) => c.id === channelId)?.muted }));
export const solo = (channelId: string) => commit((doc) => soloChannel(doc, channelId));
export const muteSelected = (muted: boolean) => commit((doc) => setMuted(doc, selectedIds(), muted));

/** Mute (or solo) the nth channel of the rack: the 1…0 keys. */
export function muteAt(index: number, asSolo: boolean) {
  const channel = song()?.channels[index];
  if (channel) (asSolo ? solo : toggleMute)(channel.id);
}

/** Select the channel above or below the selection (or the first, with none). */
export function selectNeighbour(direction: -1 | 1, extend: boolean) {
  const doc = song();
  if (!doc?.channels.length) return;
  const ui = useMusicUi.getState();
  const selected = selectedIds();
  const indexes = selected.map((id) => doc.channels.findIndex((c) => c.id === id));
  const from = indexes.length ? (direction < 0 ? Math.min(...indexes) : Math.max(...indexes)) : direction < 0 ? doc.channels.length : -1;
  const next = doc.channels[Math.min(doc.channels.length - 1, Math.max(0, from + direction))];
  ui.setSelection(extend ? [...new Set([...selected, next.id])] : [next.id]);
}

/** Select every channel from one to another, in the rack's order (a Shift+click, a drag down the selectors). */
export function selectRange(fromId: string, toId: string) {
  const doc = song();
  if (!doc) return;
  const a = doc.channels.findIndex((c) => c.id === fromId);
  const b = doc.channels.findIndex((c) => c.id === toId);
  if (a < 0 || b < 0) return;
  useMusicUi.getState().setSelection(doc.channels.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.id));
}

export const moveSelected = (direction: -1 | 1) => commit((doc) => moveChannels(doc, selectedIds(), direction));
export const moveChannel = (channelId: string, direction: -1 | 1) => commit((doc) => moveChannels(doc, [channelId], direction));

export const cloneSelected = () => commit((doc) => selectedIds().reduceRight((next, id) => cloneChannel(next, id), doc));

export function deleteChannels(ids: string[]) {
  commit((doc) => removeChannels(doc, ids));
}
export const deleteSelected = () => deleteChannels(selectedIds());

/**
 * FL Studio's Replace: another instrument in the channel's place, with its notes (`replaceChannel`). What
 * showed the old channel shows the new one: the selection, the Piano roll; a sampler's window opens, as
 * a new one's does, since it has nothing to play yet.
 */
export function replaceInstrument(channelId: string, plugin: PluginRef | null) {
  const before = song();
  const id = createId("chan");
  commit((doc) => replaceChannel(doc, channelId, plugin, id));
  if (song() === before) return;
  const ui = useMusicUi.getState();
  ui.setSelection(ui.selectedChannelIds.map((c) => (c === channelId ? id : c)));
  ui.closeChannelWindow(channelId);
  if (usePiano.getState().channelId === channelId) usePiano.getState().setChannel(id);
  if (!plugin) ui.openChannelWindow(id);
}

/** The channel the step commands act on: the first selected. */
const target = () => selectedIds()[0] ?? null;

export function copySteps(channelId = target()) {
  const doc = song();
  if (!doc || !channelId) return;
  useMusicUi.getState().copySteps(channelNotes(currentPattern(doc, useMusic.getState().patternId), channelId));
}

export function cutSteps(channelId = target()) {
  if (!channelId) return;
  copySteps(channelId);
  commit((doc) => setChannelNotes(doc, patternId(), channelId, (notes) => (notes.length ? [] : notes)));
}

export function pasteSteps(channelId = target()) {
  const copied = useMusicUi.getState().copiedSteps;
  if (!channelId || !copied) return;
  commit((doc) => setChannelNotes(doc, patternId(), channelId, () => copied));
}

/** Shift a channel's steps a step left or right, round the pattern. */
export function rotate(direction: -1 | 1, channelId = target()) {
  if (!channelId) return;
  commit((doc) => rotateSteps(doc, patternId(), channelId, direction, lengthOf(doc, currentPattern(doc, useMusic.getState().patternId))));
}

/** Move every note of the selected channels in the pattern shown up or down by semitones. */
export const transposeSelected = (semitones: number) => commit((doc) => transposeChannels(doc, patternId(), selectedIds(), semitones));

/** Give each selected channel a free mixer track of its own, named after it (FL's Ctrl+L in the rack). */
export const assignFreeTracks = () => commit((doc) => routeToFreeTracks(doc, selectedIds()));
