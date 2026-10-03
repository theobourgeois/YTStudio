/**
 * What Pro-C's window does (`docs/fabfilter/pro-c.md` 8.6): open and close it, presets, A/B, Copy / Paste
 * state, bypass, and the live things that go to the engine and not the song: Audition and Match (whose
 * result, once measured, is one edit of the song).
 */
import { toast } from "sonner";
import { clamp } from "@shared/math";
import { errorMessage } from "@shared/errors";
import { updateEffect } from "@shared/music/mixer";
import { chooseProCPreset, copyProCAB, editProC, findProC, switchProCAB, updateProC, type ProCPatch } from "@shared/music/pro-c";
import { PRO_C_GAIN_RANGE, PRO_C_PRESETS } from "@shared/music/pro-c-presets";
import type { MusicProject, ProC } from "@shared/music/types";
import { musicApi } from "../api";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { proCWindow, useMusicWindows } from "../ui";
import { type CompAudition, useCompUi } from "./store";

const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);
const song = () => useMusic.getState().history?.doc ?? null;
export const proCOf = (effectId: string): ProC | null => {
  const s = song();
  return s ? (findProC(s, effectId)?.proC ?? null) : null;
};

/** Open a Pro-C's window (its slot's name, clicked; its menu's Open its window). */
export function openProC(effectId: string) {
  const { openIds } = useCompUi.getState();
  useMusicWindows.getState().focus(proCWindow(effectId));
  useCompUi.setState({ openIds: openIds.includes(effectId) ? openIds : [...openIds, effectId] });
}

export function closeProC(effectId: string) {
  useCompUi.setState({ openIds: useCompUi.getState().openIds.filter((id) => id !== effectId) });
  // Listening to it as it closes: let go.
  if (useCompUi.getState().audition?.effectId === effectId) audition(effectId, null);
}

export const toggleProC = (effectId: string) => (useCompUi.getState().openIds.includes(effectId) ? closeProC(effectId) : openProC(effectId));

/** Change its settings (one undo step). */
export const setProC = (effectId: string, patch: ProCPatch) => commit((s) => updateProC(s, effectId, patch));

// ---------------------------------------------------------------------------
// Presets, A/B, Copy / Paste
// ---------------------------------------------------------------------------

export function chooseProC(effectId: string, name: string) {
  commit((s) => chooseProCPreset(s, effectId, name));
  useCompUi.setState({ lastPreset: { ...useCompUi.getState().lastPreset, [effectId]: name } });
}

/** The name the preset button shows: the preset loaded, or (dimmed) the last one before it was changed. */
export const presetName = (effectId: string, proC: ProC): string | null => proC.preset ?? useCompUi.getState().lastPreset[effectId] ?? null;

/** The preset bar's arrows: the previous or next preset (from the one shown, else the first). */
export function stepProCPreset(effectId: string, by: 1 | -1) {
  const proC = proCOf(effectId);
  if (!proC) return;
  const index = PRO_C_PRESETS.findIndex((p) => p.name === presetName(effectId, proC));
  const next = PRO_C_PRESETS[(index < 0 ? (by > 0 ? 0 : PRO_C_PRESETS.length - 1) : index + by + PRO_C_PRESETS.length) % PRO_C_PRESETS.length];
  chooseProC(effectId, next.name);
}

export const toggleProCAB = (effectId: string) => commit((s) => switchProCAB(s, effectId));
export const copyToOtherSlot = (effectId: string) => commit((s) => copyProCAB(s, effectId));

/** Copy state: the whole Pro-C, to paste on another. */
export function copyProCState(effectId: string) {
  const proC = proCOf(effectId);
  if (proC) useCompUi.setState({ copiedState: proC });
}
export function pasteProCState(effectId: string) {
  const copied = useCompUi.getState().copiedState;
  if (copied) commit((s) => editProC(s, effectId, () => copied));
}

/** Bypass (the slot's own switch: the sound goes past it untouched). */
export function toggleBypass(effectId: string) {
  commit((s) => {
    const found = findProC(s, effectId);
    return found ? updateEffect(s, found.track.id, found.slot, { enabled: !found.effect.enabled }) : s;
  });
}

// ---------------------------------------------------------------------------
// Live: the engine's, not the song's
// ---------------------------------------------------------------------------

/** Listen to its key or to what its compression takes away (null lets go). Never saved, never exported. */
export function audition(effectId: string, mode: CompAudition["mode"] | null) {
  useCompUi.setState({ audition: mode === null ? null : { effectId, mode } });
  void musicApi.engine("compAudition", { effect: effectId, mode: mode ?? "off" }).catch(() => {});
}

/** How long Match listens (s). */
export const MATCH_SECONDS = 8;
/** Matches seen measuring (by effect id): a `done` counts only after one. */
const measuring = new Set<string>();

/**
 * Match (`docs/fabfilter/pro-c.md` 7): the engine measures the loudness in and out while the song plays,
 * then Wet Gain makes them equal, one undo step.
 */
export function startMatch(effectId: string) {
  if (!useTransport.getState().playing) {
    toast("Play the song first", { description: "Match listens to the sound coming in and going out while it plays, then sets Wet Gain so they're as loud." });
    return;
  }
  measuring.delete(effectId);
  useCompUi.setState({ matching: { ...useCompUi.getState().matching, [effectId]: { since: performance.now(), seconds: MATCH_SECONDS } } });
  musicApi.engine("compMatch", { effect: effectId, seconds: MATCH_SECONDS }).catch((err) => {
    stopMatch(effectId);
    toast.error("Match couldn't start", { description: errorMessage(err) });
  });
}

export function stopMatch(effectId: string) {
  measuring.delete(effectId);
  const { [effectId]: _, ...rest } = useCompUi.getState().matching;
  useCompUi.setState({ matching: rest });
}

/** Wet Gain for a measured loudness in and out (dB): the difference made up, to a tenth of a dB. */
export const matchedWet = (wet: number, input: number, output: number) => Math.round(clamp(wet + input - output, PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1]) * 10) / 10;

// What the engine says of each Match measuring: once done, its result is the song's.
useTransport.subscribe((state, prev) => {
  if (state.proCs === prev.proCs) return;
  const now = performance.now();
  for (const [effectId, m] of Object.entries(useCompUi.getState().matching)) {
    const match = state.proCs[effectId]?.match;
    if (match && !match.done) measuring.add(effectId);
    if (match?.done && measuring.has(effectId)) {
      stopMatch(effectId);
      if (!Number.isFinite(match.input) || !Number.isFinite(match.output) || match.input < -100) {
        toast("Nothing came through", { description: "Match heard silence: play a part where the track sounds." });
        continue;
      }
      commit((s) => {
        const proC = findProC(s, effectId)?.proC;
        return proC ? updateProC(s, effectId, { wet: matchedWet(proC.wet, match.input, match.output) }) : s;
      });
    } else if (now - m.since > (m.seconds + 4) * 1000) stopMatch(effectId);
  }
});
// Stopped while measuring: it's over (what was heard isn't the song's whole loudness).
useTransport.subscribe((state, prev) => {
  if (prev.playing && !state.playing) for (const effectId of Object.keys(useCompUi.getState().matching)) stopMatch(effectId);
});
