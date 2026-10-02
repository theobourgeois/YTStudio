/**
 * What EchoBoy's window does (`docs/soundtoys/echoboy-manual.md`): open and close it, its drawer (Tweak,
 * Style Edit), Tap Tempo, presets, Copy / Paste state and style.
 */
import { ECHO_PRESETS, loadPreset } from "@shared/music/echo-boy-library";
import { editEchoBoy, editStyle, findEchoBoy, styleOf, tappedTempo, updateEchoBoy } from "@shared/music/echo-boy";
import { useMusic } from "../store";
import { echoBoyWindow, useMusicWindows } from "../ui";
import { type EchoDrawer, useEchoUi } from "./store";

const commit = (update: Parameters<ReturnType<typeof useMusic.getState>["commit"]>[0]) => useMusic.getState().commit(update);
const song = () => useMusic.getState().history?.doc ?? null;

/** Open an EchoBoy's window (its slot's name, clicked; its menu's Open its window). */
export function openEchoBoy(effectId: string) {
  const { openIds } = useEchoUi.getState();
  useMusicWindows.getState().focus(echoBoyWindow(effectId));
  useEchoUi.setState({ openIds: openIds.includes(effectId) ? openIds : [...openIds, effectId] });
}

export function closeEchoBoy(effectId: string) {
  useEchoUi.setState({ openIds: useEchoUi.getState().openIds.filter((id) => id !== effectId) });
}

export const toggleEchoBoy = (effectId: string) => (useEchoUi.getState().openIds.includes(effectId) ? closeEchoBoy(effectId) : openEchoBoy(effectId));

/** Tweak and Style Edit: each opens its drawer, or closes it if it's the one open. */
export function toggleDrawer(effectId: string, drawer: Exclude<EchoDrawer, "none">) {
  const ui = useEchoUi.getState();
  ui.setDrawer(effectId, (ui.drawers[effectId] ?? "none") === drawer ? "none" : drawer);
}

/** Tap Tempo: a tap; from the second, EchoBoy keeps to the tempo tapped (MIDI off). */
export function tapTempo(effectId: string, now = performance.now()) {
  const taps = [...(useEchoUi.getState().taps[effectId] ?? []), now].slice(-8);
  useEchoUi.setState({ taps: { ...useEchoUi.getState().taps, [effectId]: taps } });
  const bpm = tappedTempo(taps);
  if (bpm !== null) commit((s) => updateEchoBoy(s, effectId, { bpm, followTempo: false }));
}

/** The preset bar's arrows: the previous or next factory preset (from the one loaded, else the first). */
export function stepPreset(effectId: string, by: 1 | -1) {
  const found = song() && findEchoBoy(song()!, effectId);
  if (!found) return;
  const index = ECHO_PRESETS.findIndex((p) => p.name === found.echoBoy.preset);
  const next = ECHO_PRESETS[(index < 0 ? (by > 0 ? 0 : ECHO_PRESETS.length - 1) : index + by + ECHO_PRESETS.length) % ECHO_PRESETS.length];
  commit((s) => loadPreset(s, effectId, next.name));
}

export const choosePreset = (effectId: string, name: string) => commit((s) => loadPreset(s, effectId, name));

/** Copy state: the whole EchoBoy, to paste on another. */
export function copyState(effectId: string) {
  const found = song() && findEchoBoy(song()!, effectId);
  if (found) useEchoUi.setState({ copiedState: found.echoBoy });
}
export function pasteState(effectId: string) {
  const copied = useEchoUi.getState().copiedState;
  if (copied) commit((s) => editEchoBoy(s, effectId, () => copied));
}

/** The Style Editor's Copy / Paste: a style to take to another EchoBoy. */
export function copyStyle(effectId: string) {
  const found = song() && findEchoBoy(song()!, effectId);
  if (found) useEchoUi.setState({ copiedStyle: styleOf(found.echoBoy) });
}
export function pasteStyle(effectId: string) {
  const copied = useEchoUi.getState().copiedStyle;
  if (copied) commit((s) => editStyle(s, effectId, () => copied));
}
