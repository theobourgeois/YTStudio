/**
 * What Gross Beat's window does (`docs/fl-studio/gross-beat.md`): open and close it, pick a slot, its
 * slots' menus (copy, paste, clear, reset, rename), the mapping panel's tools, Copy / Paste state, and
 * the live controls (HOLD, the scratching clock), which go to the engine and not the song.
 */
import { decimatePoints, flipPoints, normalizePointLevels, scalePoints, smoothPoints } from "@shared/music/automation";
import { type GrossKind, editGrossBeat, editGrossSlot, emptyGrossSlot, findGrossBeat, grossSlot, renameGrossSlot, setGrossSlot, smoothAllPoints, updateGrossBeat } from "@shared/music/gross-beat";
import type { AutomationPoint, GrossBeat } from "@shared/music/types";
import { musicApi } from "../api";
import { useMusic } from "../store";
import { grossBeatWindow, useMusicWindows } from "../ui";
import { useGrossUi } from "./store";

const commit = (update: Parameters<ReturnType<typeof useMusic.getState>["commit"]>[0]) => useMusic.getState().commit(update);
const song = () => useMusic.getState().history?.doc ?? null;

/** Open a Gross Beat's window (its slot's name, clicked; its menu's Open its window). */
export function openGrossBeat(effectId: string) {
  const { openIds } = useGrossUi.getState();
  useMusicWindows.getState().focus(grossBeatWindow(effectId));
  useGrossUi.setState({ openIds: openIds.includes(effectId) ? openIds : [...openIds, effectId] });
}

export function closeGrossBeat(effectId: string) {
  useGrossUi.setState({ openIds: useGrossUi.getState().openIds.filter((id) => id !== effectId) });
  // Its live controls let go: a window closed mid-scratch mustn't leave the sound behind.
  void live(effectId, { hold: false, scratch: 0 });
}

export const toggleGrossBeat = (effectId: string) => (useGrossUi.getState().openIds.includes(effectId) ? closeGrossBeat(effectId) : openGrossBeat(effectId));

/** Pick a slot (a click on it): it plays (from its sync point, while playing), and the panel shows it. */
export function pickSlot(effectId: string, kind: GrossKind, slot: number) {
  commit((s) => updateGrossBeat(s, effectId, kind === "time" ? { timeSlot: slot } : { volumeSlot: slot }));
  useGrossUi.getState().setView(effectId, { kind });
}

/** The tools of the mapping options menu, on the slot the panel shows. */
export const GROSS_TOOLS = {
  flip: { label: "Flip vertically", run: flipPoints },
  scaleUp: { label: "Scale levels up", run: (p: AutomationPoint[]) => scalePoints(p, 1.25) },
  scaleDown: { label: "Scale levels down", run: (p: AutomationPoint[]) => scalePoints(p, 0.8) },
  normalize: { label: "Normalize levels", run: normalizePointLevels },
  decimate: { label: "Decimate points", run: decimatePoints },
  smoothUp: { label: "Smooth up abrupt changes", run: smoothPoints },
  allSmooth: { label: "Turn all points smooth", run: smoothAllPoints },
} as const;
export type GrossTool = keyof typeof GROSS_TOOLS;

export function runGrossTool(effectId: string, kind: GrossKind, slot: number, tool: GrossTool) {
  commit((s) => editGrossSlot(s, effectId, kind, slot, GROSS_TOOLS[tool].run));
}

/** A slot's menu: copy it, paste the copy over it, clear it (empty), put back its preset, rename it. */
export function copySlot(effectId: string, kind: GrossKind, slot: number) {
  const found = song() && findGrossBeat(song()!, effectId);
  if (found) useGrossUi.setState({ copiedSlot: grossSlot(found.grossBeat, kind, slot) });
}
export function pasteSlot(effectId: string, kind: GrossKind, slot: number) {
  const copied = useGrossUi.getState().copiedSlot;
  if (copied) commit((s) => setGrossSlot(s, effectId, kind, slot, copied));
}
export const clearSlot = (effectId: string, kind: GrossKind, slot: number) => commit((s) => setGrossSlot(s, effectId, kind, slot, emptyGrossSlot()));
export const resetSlot = (effectId: string, kind: GrossKind, slot: number) => commit((s) => setGrossSlot(s, effectId, kind, slot, null));
export const renameSlot = (effectId: string, kind: GrossKind, slot: number, name: string) => commit((s) => renameGrossSlot(s, effectId, kind, slot, name));

/** Copy state: the whole Gross Beat (its slots and settings), to paste on another. */
export function copyState(effectId: string) {
  const found = song() && findGrossBeat(song()!, effectId);
  if (found) useGrossUi.setState({ copiedState: found.grossBeat });
}
export function pasteState(effectId: string) {
  const copied: GrossBeat | null = useGrossUi.getState().copiedState;
  if (copied) commit((s) => editGrossBeat(s, effectId, () => copied));
}

/** HOLD and the scratching clock, held by the hand: straight to the engine (not the song, not undone). */
export async function live(effectId: string, controls: { hold?: boolean; scratch?: number }) {
  await musicApi.engine("grossBeat", { effect: effectId, ...controls }).catch(() => {});
}
