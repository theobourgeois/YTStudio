/**
 * What the Reverb's window does (`docs/reverb/reverb.md` 4.1, 4.8): open and close it, presets (and
 * Revert), A/B, Copy / Paste of the whole sound or the Decay EQ's curve, bypass, Freeze; and the live
 * things that go to the engine and not the song: Freeze and Kill held, a click auditioned, the analyzer
 * watched while its window is open.
 */
import { updateEffect } from "@shared/music/mixer";
import { type ReverbPatch, chooseReverbPreset, copyReverbAB, findReverb, pasteReverb, switchReverbAB, updateReverb } from "@shared/music/reverb";
import { REVERB_PRESETS } from "@shared/music/reverb-presets";
import type { MusicProject, Reverb } from "@shared/music/types";
import { musicApi } from "../api";
import { useMusic } from "../store";
import { reverbWindow, useMusicWindows } from "../ui";
import { useVerbUi } from "./store";

const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);
const song = () => useMusic.getState().history?.doc ?? null;
export const reverbOf = (effectId: string): Reverb | null => {
  const s = song();
  return s ? (findReverb(s, effectId)?.reverb ?? null) : null;
};

/** Open a Reverb's window (its slot's name, clicked; its menu's Open its window). */
export function openReverb(effectId: string) {
  const { openIds } = useVerbUi.getState();
  useMusicWindows.getState().focus(reverbWindow(effectId));
  useVerbUi.setState({ openIds: openIds.includes(effectId) ? openIds : [...openIds, effectId] });
}

export function closeReverb(effectId: string) {
  useVerbUi.setState({ openIds: useVerbUi.getState().openIds.filter((id) => id !== effectId) });
  // Freeze or Kill held as it closes: let go.
  if (useVerbUi.getState().freezeHeld === effectId) holdFreeze(effectId, false);
  if (useVerbUi.getState().killHeld === effectId) holdKill(effectId, false);
}

export const toggleReverb = (effectId: string) => (useVerbUi.getState().openIds.includes(effectId) ? closeReverb(effectId) : openReverb(effectId));

/** Change its settings (one undo step). */
export const setReverb = (effectId: string, patch: ReverbPatch) => commit((s) => updateReverb(s, effectId, patch));

// ---------------------------------------------------------------------------
// Presets, A/B, Copy / Paste
// ---------------------------------------------------------------------------

export function chooseReverb(effectId: string, name: string) {
  commit((s) => chooseReverbPreset(s, effectId, name));
  useVerbUi.setState({ lastPreset: { ...useVerbUi.getState().lastPreset, [effectId]: name } });
}

/** The name the preset button shows: the preset loaded, or (in italics) the last one before it was changed. */
export const presetName = (effectId: string, reverb: Reverb): string | null => reverb.preset ?? useVerbUi.getState().lastPreset[effectId] ?? null;

/** The preset bar's arrows (and ← →): the previous or next preset, from the one shown. */
export function stepReverbPreset(effectId: string, by: 1 | -1) {
  const reverb = reverbOf(effectId);
  if (!reverb) return;
  const index = REVERB_PRESETS.findIndex((p) => p.name === presetName(effectId, reverb));
  const next = REVERB_PRESETS[(index < 0 ? (by > 0 ? 0 : REVERB_PRESETS.length - 1) : index + by + REVERB_PRESETS.length) % REVERB_PRESETS.length];
  chooseReverb(effectId, next.name);
}

/** Revert: back to the preset as loaded (lit once edited). */
export function revertReverb(effectId: string) {
  const reverb = reverbOf(effectId);
  const name = reverb && presetName(effectId, reverb);
  if (name) chooseReverb(effectId, name);
}

export const toggleReverbAB = (effectId: string) => commit((s) => switchReverbAB(s, effectId));
export const copyReverbToOther = (effectId: string) => commit((s) => copyReverbAB(s, effectId));

/** Copy settings: the whole sound, to paste on another Reverb (any track). */
export function copyReverbSettings(effectId: string) {
  const reverb = reverbOf(effectId);
  if (reverb) useVerbUi.setState({ copiedState: reverb });
}
export function pasteReverbSettings(effectId: string) {
  const copied = useVerbUi.getState().copiedState;
  if (copied) commit((s) => pasteReverb(s, effectId, copied));
}

/** Copy curve / Paste curve: the Decay EQ alone (the nearest to saving it on its own). */
export function copyReverbCurve(effectId: string) {
  const reverb = reverbOf(effectId);
  if (reverb) useVerbUi.setState({ copiedCurve: { bands: reverb.bands, bandsBypass: reverb.bandsBypass } });
}
export function pasteReverbCurve(effectId: string) {
  const copied = useVerbUi.getState().copiedCurve;
  if (copied) setReverb(effectId, copied);
}

/** Bypass (the slot's own switch: the sound goes past it untouched, its tail stops). */
export function toggleReverbBypass(effectId: string) {
  commit((s) => {
    const found = findReverb(s, effectId);
    return found ? updateEffect(s, found.track.id, found.slot, { enabled: !found.effect.enabled }) : s;
  });
}

/** Freeze, the song's (automatable): a click on ❄, a tap of F. */
export function toggleFreeze(effectId: string) {
  const reverb = reverbOf(effectId);
  if (reverb) setReverb(effectId, { freeze: !reverb.freeze });
}

// ---------------------------------------------------------------------------
// Live: the engine's, not the song's
// ---------------------------------------------------------------------------

/** Freeze held (F held, Alt-click on ❄): momentary, let go when released. Never saved, never exported. */
export function holdFreeze(effectId: string, on: boolean) {
  useVerbUi.setState({ freezeHeld: on ? effectId : null });
  void musicApi.engine("verb", { effect: effectId, freeze: on }).catch(() => {});
}

/** Kill held (⏻): the input muted while the tail is heard, for hearing a tail against the Decay display. */
export function holdKill(effectId: string, on: boolean) {
  useVerbUi.setState({ killHeld: on ? effectId : null });
  void musicApi.engine("verb", { effect: effectId, kill: on }).catch(() => {});
}

/** A click played through it (the Shape display's double-click): its shape heard. */
export function auditionReverb(effectId: string) {
  void musicApi.engine("verb", { effect: effectId, audition: true }).catch(() => {});
}

/** The analyzer's FFT length (as Pro-Q's Medium). */
export const ANALYZER_SIZE = 4096;

let lastWatch = "";
/** Tell the engine which Reverbs to measure (their windows open, the analyzer on) whenever that changes. */
export function syncReverbWatch() {
  const s = song();
  const list = s ? useVerbUi.getState().openIds.filter((id) => findReverb(s, id)?.reverb.view.analyzer).map((effect) => ({ effect, size: ANALYZER_SIZE })) : [];
  const key = JSON.stringify(list);
  if (key === lastWatch) return;
  lastWatch = key;
  void musicApi.engine("verbWatch", { effects: list }).catch(() => {
    lastWatch = "";
  });
}
useVerbUi.subscribe((state, prev) => {
  if (state.openIds !== prev.openIds) syncReverbWatch();
});
useMusic.subscribe((state, prev) => {
  if (state.history?.doc !== prev.history?.doc && useVerbUi.getState().openIds.length) syncReverbWatch();
  if (state.projectId !== prev.projectId) lastWatch = "";
});
