/**
 * What PanMan's window does (`docs/soundtoys/panman.md`): open and close it, the preset bar (previous,
 * next, a preset, Revert), Copy / Paste state, Tap Tempo, and the Manual Trigger, which goes to the engine
 * and not the song.
 */
import { adjacentPreset, findPanMan, loadPanPreset, updatePanMan } from "@shared/music/panman";
import { MAX_PAN_TEMPO, MIN_PAN_TEMPO } from "@shared/music/panman-presets";
import { clamp } from "@shared/math";
import { musicApi } from "../api";
import { useMusic } from "../store";
import { addTap, tappedTempo } from "../tap-tempo";
import { panManWindow, useMusicWindows } from "../ui";
import { usePanUi } from "./store";

const commit = (update: Parameters<ReturnType<typeof useMusic.getState>["commit"]>[0]) => useMusic.getState().commit(update);
const song = () => useMusic.getState().history?.doc ?? null;

/** Open a PanMan's window (its slot's name, clicked; its menu's Open its window). */
export function openPanMan(effectId: string) {
  const { openIds } = usePanUi.getState();
  useMusicWindows.getState().focus(panManWindow(effectId));
  usePanUi.setState({ openIds: openIds.includes(effectId) ? openIds : [...openIds, effectId] });
}

export function closePanMan(effectId: string) {
  usePanUi.setState({ openIds: usePanUi.getState().openIds.filter((id) => id !== effectId) });
  taps.delete(effectId);
}

export const togglePanMan = (effectId: string) => (usePanUi.getState().openIds.includes(effectId) ? closePanMan(effectId) : openPanMan(effectId));

/** A factory preset, by name (the preset menu); the one before or after (‹ ›); the preset's own settings again (Revert). */
export const loadPreset = (effectId: string, name: string) => commit((s) => loadPanPreset(s, effectId, name));
export function stepPreset(effectId: string, step: 1 | -1) {
  const found = song() && findPanMan(song()!, effectId);
  if (found) loadPreset(effectId, adjacentPreset(found.panMan, step));
}
export function revert(effectId: string) {
  const found = song() && findPanMan(song()!, effectId);
  if (found) loadPreset(effectId, found.panMan.preset);
}

/** Copy state: the whole PanMan, to paste on another. */
export function copyState(effectId: string) {
  const found = song() && findPanMan(song()!, effectId);
  if (found) usePanUi.setState({ copied: found.panMan });
}
export function pasteState(effectId: string) {
  const copied = usePanUi.getState().copied;
  if (copied) commit((s) => updatePanMan(s, effectId, copied));
}

/** Each window's taps (ms). */
const taps = new Map<string, number[]>();

/** Tap Tempo: once there are three taps, their tempo, out of time with the song (the MIDI switch off). */
export function tap(effectId: string, now = performance.now()) {
  const list = addTap(taps.get(effectId) ?? [], now);
  taps.set(effectId, list);
  const tempo = tappedTempo(list);
  if (tempo !== null) commit((s) => updatePanMan(s, effectId, { tempo: clamp(tempo, MIN_PAN_TEMPO, MAX_PAN_TEMPO), sync: false }));
}

/** The Manual Trigger: straight to the engine (not the song, not undone). */
export async function manualTrigger(effectId: string) {
  await musicApi.engine("panMan", { effect: effectId, trigger: true }).catch(() => {});
}
