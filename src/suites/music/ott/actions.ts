/** What OTT's window does (`docs/xfer/ott.md`): open and close it, presets, Copy / Paste state. */
import { chooseOttPreset, editOtt, findOtt } from "@shared/music/ott";
import { OTT_PRESETS } from "@shared/music/ott-presets";
import { useMusic } from "../store";
import { ottWindow, useMusicWindows } from "../ui";
import { useOttUi } from "./store";

const commit = (update: Parameters<ReturnType<typeof useMusic.getState>["commit"]>[0]) => useMusic.getState().commit(update);
const song = () => useMusic.getState().history?.doc ?? null;

/** Open an OTT's window (its slot's name, clicked; its menu's Open its window). */
export function openOtt(effectId: string) {
  const { openIds } = useOttUi.getState();
  useMusicWindows.getState().focus(ottWindow(effectId));
  useOttUi.setState({ openIds: openIds.includes(effectId) ? openIds : [...openIds, effectId] });
}

export function closeOtt(effectId: string) {
  useOttUi.setState({ openIds: useOttUi.getState().openIds.filter((id) => id !== effectId) });
}

export const toggleOtt = (effectId: string) => (useOttUi.getState().openIds.includes(effectId) ? closeOtt(effectId) : openOtt(effectId));

/** The preset bar's arrows: the previous or next preset (from the one loaded, else the first). */
export function stepOttPreset(effectId: string, by: 1 | -1) {
  const found = song() && findOtt(song()!, effectId);
  if (!found) return;
  const index = OTT_PRESETS.findIndex((p) => p.name === found.ott.preset);
  const next = OTT_PRESETS[(index < 0 ? (by > 0 ? 0 : OTT_PRESETS.length - 1) : index + by + OTT_PRESETS.length) % OTT_PRESETS.length];
  commit((s) => chooseOttPreset(s, effectId, next.name));
}

export const chooseOtt = (effectId: string, name: string) => commit((s) => chooseOttPreset(s, effectId, name));

/** Copy state: the whole OTT, to paste on another. */
export function copyOttState(effectId: string) {
  const found = song() && findOtt(song()!, effectId);
  if (found) useOttUi.setState({ copiedState: found.ott });
}
export function pasteOttState(effectId: string) {
  const copied = useOttUi.getState().copiedState;
  if (copied) commit((s) => editOtt(s, effectId, () => copied));
}
