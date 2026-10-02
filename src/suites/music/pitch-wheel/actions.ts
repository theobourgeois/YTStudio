/**
 * What Pitch Wheel's window does (`docs/quikquak/pitchwheel.md`): open and close it, its settings and
 * presets, Copy / Paste state, and the hand's live controls: a wheel held where it's dragged (the engine
 * hears it at once, ahead of the song that follows), a typed jump, the keyboard's notes.
 */
import { type PitchWheelPatch, applyPitchWheelPreset, editPitchWheel, findPitchWheel, snapped, updatePitchWheel } from "@shared/music/pitch-wheel";
import type { Wheel } from "@shared/music/types";
import { musicApi } from "../api";
import { useMusic } from "../store";
import { pitchWheelWindow, useMusicWindows } from "../ui";
import { useWheelUi } from "./store";

const commit = (update: Parameters<ReturnType<typeof useMusic.getState>["commit"]>[0]) => useMusic.getState().commit(update);
const song = () => useMusic.getState().history?.doc ?? null;

/** Open a Pitch Wheel's window (its slot's name, clicked; its menu's Open its window). */
export function openPitchWheel(effectId: string) {
  const { openIds } = useWheelUi.getState();
  useMusicWindows.getState().focus(pitchWheelWindow(effectId));
  useWheelUi.setState({ openIds: openIds.includes(effectId) ? openIds : [...openIds, effectId] });
}

export function closePitchWheel(effectId: string) {
  useWheelUi.setState({ openIds: useWheelUi.getState().openIds.filter((id) => id !== effectId) });
  releaseKeys(effectId);
}

export const togglePitchWheel = (effectId: string) => (useWheelUi.getState().openIds.includes(effectId) ? closePitchWheel(effectId) : openPitchWheel(effectId));

export const setPitchWheel = (effectId: string, patch: PitchWheelPatch) => commit((s) => updatePitchWheel(s, effectId, patch));
export const applyPreset = (effectId: string, name: string) => commit((s) => applyPitchWheelPreset(s, effectId, name));

/** Copy state: the whole Pitch Wheel's settings, to paste on another. */
export function copyWheelState(effectId: string) {
  const found = song() && findPitchWheel(song()!, effectId);
  if (found) useWheelUi.setState({ copiedState: found.pitchWheel });
}
export function pasteWheelState(effectId: string) {
  const copied = useWheelUi.getState().copiedState;
  if (copied) commit((s) => editPitchWheel(s, effectId, (pw) => ({ ...copied, notesFrom: pw.notesFrom })));
}

// ---------------------------------------------------------------------------
// The hand, live
// ---------------------------------------------------------------------------

const quietly = (promise: Promise<unknown>) => void promise.catch(() => {});

/**
 * A wheel held by the hand: the engine hears where it is at once (a `pitchWheel` command a frame, and
 * again every 100 ms while it's held still, since it lets go a quarter-second after the last), while
 * the song catches up. Returns how to move it and how to let go.
 */
export function holdWheel(effectId: string, wheel: "pitch" | "timbre", snap: Wheel["snap"]) {
  let value: number | null = null;
  let frame = 0;
  const send = () => {
    frame = 0;
    if (value !== null) quietly(musicApi.engine("pitchWheel", { effect: effectId, [wheel]: snapped(value, snap) }));
  };
  const renew = window.setInterval(send, 100);
  return {
    move(next: number) {
      value = next;
      if (!frame) frame = requestAnimationFrame(send);
    },
    release() {
      window.clearInterval(renew);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}

/** A typed value: the wheel's pointer there, and what's heard jumps straight to it (no swing). */
export function jumpWheel(effectId: string, wheel: "pitch" | "timbre", value: number) {
  const s = song();
  const found = s && findPitchWheel(s, effectId);
  if (!found) return;
  commit((doc) => updatePitchWheel(doc, effectId, { [wheel]: { value } }));
  const landed = findPitchWheel(song()!, effectId)?.pitchWheel[wheel];
  if (landed) quietly(musicApi.engine("pitchWheel", { effect: effectId, [wheel]: snapped(landed.value, landed.snap), jump: true }));
}

/** The keyboard's keys held, by Pitch Wheel: let go when the window closes. */
const heldKeys = new Map<string, Set<number>>();

/** A key of the keyboard pressed or let go: a note for the Pitch Wheel, as a channel's would be. */
export function playKey(effectId: string, key: number, on: boolean) {
  const keys = heldKeys.get(effectId) ?? new Set<number>();
  heldKeys.set(effectId, keys);
  if (on === keys.has(key)) return;
  if (on) keys.add(key);
  else keys.delete(key);
  quietly(musicApi.engine("pitchWheel", { effect: effectId, key, on }));
}

export const keysHeld = (effectId: string): ReadonlySet<number> => heldKeys.get(effectId) ?? new Set();

export function releaseKeys(effectId: string) {
  for (const key of [...(heldKeys.get(effectId) ?? [])]) playKey(effectId, key, false);
}
