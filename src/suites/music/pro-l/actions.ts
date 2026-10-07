/**
 * What YT-L's window does (`docs/fabfilter/pro-l.md` §8.6): open and close it, presets, A/B, Copy / Paste state,
 * bypass, and the meter's live controls that go to the engine and not the song (reset, pause; Auto-Reset as play
 * starts).
 */
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { updateEffect } from "@shared/music/mixer";
import { type ProLPatch, chooseProLPreset, copyProLAB, editProL, findProL, proLs, switchProLAB, updateProL } from "@shared/music/pro-l";
import { PRO_L_PRESETS } from "@shared/music/pro-l-presets";
import type { MusicProject, ProL } from "@shared/music/types";
import { musicApi } from "../api";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { proLWindow, useMusicWindows } from "../ui";
import { clearLimHistory } from "./history";
import { useLimUi } from "./store";

const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);
const song = () => useMusic.getState().history?.doc ?? null;
export const proLOf = (effectId: string): ProL | null => {
  const s = song();
  return s ? (findProL(s, effectId)?.proL ?? null) : null;
};

/** Open a YT-L's window (its slot's name, clicked; its menu's Open its window). */
export function openProL(effectId: string) {
  const { openIds } = useLimUi.getState();
  useMusicWindows.getState().focus(proLWindow(effectId));
  useLimUi.setState({ openIds: openIds.includes(effectId) ? openIds : [...openIds, effectId] });
}

export function closeProL(effectId: string) {
  useLimUi.setState({ openIds: useLimUi.getState().openIds.filter((id) => id !== effectId) });
}

export const toggleProL = (effectId: string) => (useLimUi.getState().openIds.includes(effectId) ? closeProL(effectId) : openProL(effectId));

/** Change its settings (one undo step). */
export const setProL = (effectId: string, patch: ProLPatch) => commit((s) => updateProL(s, effectId, patch));

// ---------------------------------------------------------------------------
// Presets, A/B, Copy / Paste
// ---------------------------------------------------------------------------

export function chooseProL(effectId: string, name: string) {
  commit((s) => chooseProLPreset(s, effectId, name));
  useLimUi.setState({ lastPreset: { ...useLimUi.getState().lastPreset, [effectId]: name } });
}

/** The name the preset button shows: the preset loaded, or (dimmed) the last one before it was changed. */
export const presetName = (effectId: string, proL: ProL): string | null => proL.preset ?? useLimUi.getState().lastPreset[effectId] ?? null;

/** The preset bar's arrows: the previous or next preset (from the one shown, else the first). */
export function stepProLPreset(effectId: string, by: 1 | -1) {
  const proL = proLOf(effectId);
  if (!proL) return;
  const index = PRO_L_PRESETS.findIndex((p) => p.name === presetName(effectId, proL));
  const next = PRO_L_PRESETS[(index < 0 ? (by > 0 ? 0 : PRO_L_PRESETS.length - 1) : index + by + PRO_L_PRESETS.length) % PRO_L_PRESETS.length];
  chooseProL(effectId, next.name);
}

export const toggleProLAB = (effectId: string) => commit((s) => switchProLAB(s, effectId));
export const copyToOtherSlot = (effectId: string) => commit((s) => copyProLAB(s, effectId));

/** Copy state: the whole YT-L, to paste on another. */
export function copyProLState(effectId: string) {
  const proL = proLOf(effectId);
  if (proL) useLimUi.setState({ copiedState: proL });
}
export function pasteProLState(effectId: string) {
  const copied = useLimUi.getState().copiedState;
  if (copied) commit((s) => editProL(s, effectId, () => copied));
}

/** Bypass (the slot's own switch: the sound goes past it untouched, its latency still compensated). */
export function toggleBypass(effectId: string) {
  commit((s) => {
    const found = findProL(s, effectId);
    return found ? updateEffect(s, found.track.id, found.slot, { enabled: !found.effect.enabled }) : s;
  });
}

// ---------------------------------------------------------------------------
// The meter (live, not the song's)
// ---------------------------------------------------------------------------

/** Start its loudness measurement again (and the maxima): the engine's, and the display's. */
export function resetMeter(effectId: string) {
  clearLimHistory(effectId);
  musicApi.engine("proL", { effect: effectId, reset: true }).catch((err) => toast.error("The meter couldn't be reset", { description: errorMessage(err) }));
}

/** Pause or carry on with its loudness measurement. */
export function pauseMeter(effectId: string, pause: boolean) {
  musicApi.engine("proL", { effect: effectId, pause }).catch((err) => toast.error("The meter couldn't be paused", { description: errorMessage(err) }));
}

// Auto-Reset: each YT-L whose meter says so starts measuring again as play starts.
useTransport.subscribe((state, prev) => {
  if (!state.playing || prev.playing) return;
  const s = song();
  if (!s) return;
  for (const { effect, proL } of proLs(s)) if (proL.meter.autoReset) resetMeter(effect.id);
});
