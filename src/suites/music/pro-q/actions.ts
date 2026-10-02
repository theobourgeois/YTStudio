/**
 * What Pro-Q's window does (`docs/fabfilter/pro-q.md`): open and close it, which bands are selected, its
 * edits on the selection (as its band menu and keys have them), A/B and presets, and the live things
 * that go to the engine and not the song: which Pro-Qs it measures for the analyzer, and solo.
 */
import { ANALYZER_SIZES, PRO_Q_PRESETS } from "@shared/music/pro-q-presets";
import {
  addBand,
  applyPreset,
  bandsInOrder,
  clearDynamics,
  copyAB,
  editProQ,
  findProQ,
  invertGain,
  makeDynamic,
  removeBands,
  splitBands,
  switchAB,
  updateBands,
  type BandPatch,
} from "@shared/music/pro-q";
import type { EqBand, MusicProject, ProQ } from "@shared/music/types";
import { musicApi } from "../api";
import { useMusic } from "../store";
import { proQWindow, useMusicWindows } from "../ui";
import { eqView, useEqUi } from "./store";

const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);
const song = () => useMusic.getState().history?.doc ?? null;
export const proQOf = (effectId: string): ProQ | null => {
  const s = song();
  return s ? (findProQ(s, effectId)?.proQ ?? null) : null;
};

/** Open a Pro-Q's window (its slot's name, clicked; its menu's Open its window). */
export function openProQ(effectId: string) {
  const { openIds } = useEqUi.getState();
  useMusicWindows.getState().focus(proQWindow(effectId));
  useEqUi.setState({ openIds: openIds.includes(effectId) ? openIds : [...openIds, effectId] });
}

export function closeProQ(effectId: string) {
  useEqUi.setState({ openIds: useEqUi.getState().openIds.filter((id) => id !== effectId) });
  // A solo held as it closes lets go.
  if (useEqUi.getState().solo?.effectId === effectId) solo(effectId, null);
}

export const toggleProQ = (effectId: string) => (useEqUi.getState().openIds.includes(effectId) ? closeProQ(effectId) : openProQ(effectId));

// ---------------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------------

export const selectBands = (effectId: string, ids: number[]) => useEqUi.getState().setView(effectId, { selected: ids });
export const selected = (effectId: string) => eqView(effectId).selected;

/** Click a band: it alone; Cmd/Ctrl: in or out of the selection; Shift: the bands from the last one to it, as shown (by frequency). */
export function clickBand(effectId: string, id: number, mode: "only" | "toggle" | "range") {
  const pq = proQOf(effectId);
  if (!pq) return;
  const now = selected(effectId);
  if (mode === "toggle") return selectBands(effectId, now.includes(id) ? now.filter((b) => b !== id) : [...now, id]);
  if (mode === "range" && now.length) {
    const order = bandsInOrder(pq.bands).map((b) => b.id);
    const a = order.indexOf(now[now.length - 1]);
    const b = order.indexOf(id);
    const [from, to] = a < b ? [a, b] : [b, a];
    return selectBands(effectId, [...new Set([...now, ...order.slice(from, to + 1)])]);
  }
  if (!now.includes(id) || now.length > 1) selectBands(effectId, [id]);
}

/** Step the selection to the band before or after it, as they're shown (the band controls' arrows). */
export function stepBand(effectId: string, by: 1 | -1) {
  const pq = proQOf(effectId);
  if (!pq?.bands.length) return;
  const order = bandsInOrder(pq.bands).map((b) => b.id);
  const now = selected(effectId);
  const at = now.length ? order.indexOf(now[0]) : by > 0 ? -1 : order.length;
  selectBands(effectId, [order[(at + by + order.length) % order.length]]);
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export const editEq = (effectId: string, change: (pq: ProQ) => ProQ) => commit((s) => editProQ(s, effectId, change));
export const updateSelected = (effectId: string, ids: number[], patch: BandPatch) => editEq(effectId, (pq) => updateBands(pq, ids, patch));

/** Make a band and select it; null when all 24 are in use. */
export function createBand(effectId: string, spec: Partial<Omit<EqBand, "id">>): number | null {
  let made: number | null = null;
  editEq(effectId, (pq) => {
    const added = addBand(pq, spec);
    if (!added) return pq;
    made = added.id;
    return added.proQ;
  });
  if (made !== null) selectBands(effectId, [made]);
  return made;
}

export function deleteBands(effectId: string, ids: number[]) {
  if (!ids.length) return;
  editEq(effectId, (pq) => removeBands(pq, ids));
  selectBands(
    effectId,
    selected(effectId).filter((id) => !ids.includes(id)),
  );
}

export const invertBands = (effectId: string, ids: number[]) => editEq(effectId, (pq) => invertGain(pq, ids));
export const makeBandsDynamic = (effectId: string, ids: number[]) => editEq(effectId, (pq) => makeDynamic(pq, ids));
export const clearBandsDynamics = (effectId: string, ids: number[]) => editEq(effectId, (pq) => clearDynamics(pq, ids));
export function splitSelected(effectId: string, ids: number[]) {
  let made: number[] = [];
  editEq(effectId, (pq) => {
    const split = splitBands(pq, ids);
    if (!split) return pq;
    made = split.ids;
    return split.proQ;
  });
  if (made.length) selectBands(effectId, made);
}

export const toggleAB = (effectId: string) => editEq(effectId, switchAB);
export const copyToOther = (effectId: string) => editEq(effectId, copyAB);
export function loadPreset(effectId: string, name: string) {
  const preset = PRO_Q_PRESETS.find((p) => p.name === name);
  if (!preset) return;
  editEq(effectId, (pq) => applyPreset(pq, preset));
  selectBands(effectId, []);
}

// ---------------------------------------------------------------------------
// Live: the engine's, not the song's
// ---------------------------------------------------------------------------

/** Solo a band while its solo button is held (null lets go), at the solo's level in dB. */
export function solo(effectId: string, band: number | null, gain = 0) {
  useEqUi.setState({ solo: band === null ? null : { effectId, band } });
  void musicApi.engine("eqSolo", { effect: effectId, band, gain }).catch(() => {});
}

/** The Pro-Qs to measure: those whose windows are open, and the spectra they show of others. */
function watchList(): { effect: string; size: number }[] {
  const s = song();
  if (!s) return [];
  const sizes = new Map<string, number>();
  for (const id of useEqUi.getState().openIds) {
    const pq = findProQ(s, id)?.proQ;
    if (!pq) continue;
    const size = ANALYZER_SIZES[pq.analyzer.resolution];
    sizes.set(id, Math.max(sizes.get(id) ?? 0, size));
    if (pq.analyzer.external) sizes.set(pq.analyzer.external, Math.max(sizes.get(pq.analyzer.external) ?? 0, size));
  }
  return [...sizes].map(([effect, size]) => ({ effect, size }));
}

let lastWatch = "";
/** Tell the engine which Pro-Qs to measure whenever that changes (windows open and close, analyzer settings). */
export function syncWatch() {
  const list = watchList();
  const key = JSON.stringify(list);
  if (key === lastWatch) return;
  lastWatch = key;
  void musicApi.engine("eqWatch", { effects: list }).catch(() => {
    lastWatch = "";
  });
}
useEqUi.subscribe((state, prev) => {
  if (state.openIds !== prev.openIds) syncWatch();
});
useMusic.subscribe((state, prev) => {
  if (state.history?.doc !== prev.history?.doc && useEqUi.getState().openIds.length) syncWatch();
  if (state.projectId !== prev.projectId) lastWatch = "";
});
