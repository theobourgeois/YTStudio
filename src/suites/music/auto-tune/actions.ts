/**
 * What Auto-Tune's window does (`docs/antares/auto-tune.md`): open and close it, its settings and
 * scale's notes, presets, Detect key (from the song's notes), Copy / Paste state.
 */
import { toast } from "sonner";
import { type AutoTunePatch, applyAutoTunePreset, detectKey, editAutoTune, findAutoTune, keyText, setAllNotes, setAutoTuneNote, updateAutoTune } from "@shared/music/auto-tune";
import type { AutoTuneNote } from "@shared/music/types";
import { useMusic } from "../store";
import { autoTuneWindow, useMusicWindows } from "../ui";
import { useTuneUi } from "./store";

const commit = (update: Parameters<ReturnType<typeof useMusic.getState>["commit"]>[0]) => useMusic.getState().commit(update);
const song = () => useMusic.getState().history?.doc ?? null;

/** Open an Auto-Tune's window (its slot's name, clicked; its menu's Open its window). */
export function openAutoTune(effectId: string) {
  const { openIds } = useTuneUi.getState();
  useMusicWindows.getState().focus(autoTuneWindow(effectId));
  useTuneUi.setState({ openIds: openIds.includes(effectId) ? openIds : [...openIds, effectId] });
}

export function closeAutoTune(effectId: string) {
  useTuneUi.setState({ openIds: useTuneUi.getState().openIds.filter((id) => id !== effectId) });
}

export const toggleAutoTune = (effectId: string) => (useTuneUi.getState().openIds.includes(effectId) ? closeAutoTune(effectId) : openAutoTune(effectId));

export const setTune = (effectId: string, patch: AutoTunePatch) => commit((s) => updateAutoTune(s, effectId, patch));
export const setNote = (effectId: string, pitchClass: number, note: AutoTuneNote) => commit((s) => setAutoTuneNote(s, effectId, pitchClass, note));
export const setAll = (effectId: string, note: AutoTuneNote) => commit((s) => setAllNotes(s, effectId, note));
export const applyPreset = (effectId: string, name: string) => commit((s) => applyAutoTunePreset(s, effectId, name));

/** Detect key: the song's key from its notes, set as the Auto-Tune's key and scale (major or minor). */
export function detectSongKey(effectId: string) {
  const doc = song();
  const found = doc && detectKey(doc);
  if (!found) {
    toast("No key to hear", { description: "The song needs pitched notes (a melody, chords) to tell its key. Choose the key yourself." });
    return;
  }
  setTune(effectId, { key: found.key, scale: found.scale });
  toast(`Key: ${keyText(found.key, found.scale)}`, { description: found.fit > 0.75 ? "Heard clearly in the song's notes." : "The likeliest key from the song's notes: check it by ear." });
}

/** Copy state: the whole Auto-Tune's settings, to paste on another. */
export function copyTuneState(effectId: string) {
  const found = song() && findAutoTune(song()!, effectId);
  if (found) useTuneUi.setState({ copiedState: found.autoTune });
}
export function pasteTuneState(effectId: string) {
  const copied = useTuneUi.getState().copiedState;
  if (copied) commit((s) => editAutoTune(s, effectId, () => copied));
}
