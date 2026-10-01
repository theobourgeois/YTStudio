/**
 * What automation's menus, buttons and keys do (`docs/fl-studio/automation.md`): make an automation clip of
 * a control (a knob's menu, a plugin parameter touched in its window), open an automation clip's window,
 * run its Tools, delete automation clips. Each is one edit of the song.
 */
import { toast } from "sonner";
import {
  type AutomationPlace,
  controlOf,
  createAutomation,
  decimatePoints,
  editPoints,
  flipPoints,
  normalizePointLevels,
  removeAutomations,
  scalePoints,
  smoothPoints,
} from "@shared/music/automation";
import type { PluginParameter } from "@shared/music/engine";
import { clipContext, songTicks } from "@shared/music/playlist";
import type { AutomationPoint, AutomationTarget, MusicProject } from "@shared/music/types";
import { playlistContext } from "../playlist/actions";
import { fadeOutClips } from "../playlist/fades";
import { usePlaylist } from "../playlist/store";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { automationWindow, useMusicUi, useMusicWindows } from "../ui";
import { useAutomationUi } from "./store";

/** The fewest bars a new automation clip covers when the song is shorter (a new song is a bar long). */
const LEAST_BARS = 4;

/**
 * Where a new automation clip goes, as in FL Studio: over the Playlist's time selection, or the whole
 * song (four bars at least).
 */
export function automationPlace(song: MusicProject): AutomationPlace {
  const { time } = usePlaylist.getState();
  if (time && time.end > time.start) return { start: time.start, length: time.end - time.start };
  return { start: 0, length: Math.max(songTicks(song), clipContext(song).barTicks * LEAST_BARS) };
}

/**
 * Create automation clip (a control's menu, FL's): an automation clip of the control, flat at its value
 * now, over the time selection or the song, on a track below the others. It's selected, and the Playlist
 * shows it. `value`: a plugin parameter's (only the engine knows it), 0..1.
 */
export function createAutomationClip(target: AutomationTarget, value?: number, place?: AutomationPlace): string | null {
  const song = useMusic.getState().history?.doc;
  if (!song) return null;
  const info = controlOf(song, target);
  if (!info.exists) {
    toast.error("There's nothing to automate", { description: `${info.owner} isn't in the song any more.` });
    return null;
  }
  const made = createAutomation(song, target, place ?? automationPlace(song), { value });
  if (made.song === song) {
    toast.error("No more automation clips fit in this song");
    return null;
  }
  useMusic.getState().commit(() => made.song);
  const clip = made.song.playlist.clips.find((c) => c.id === made.clipId);
  usePlaylist.setState({ selected: new Set([made.clipId]), source: { kind: "automation", ref: made.automationId }, pickerTab: "automation" });
  useMusicUi.getState().setPlaylistOpen(true);
  if (clip) showTrack(clip.track);
  const name = made.song.automations.find((a) => a.id === made.automationId)?.name ?? "Automation";
  toast.success(`Automation clip: ${name}`, {
    description: useTransport.getState().mode === "song" ? "Right-click its line to add points, drag them to shape it." : "It plays in song mode (L). Right-click its line to add points.",
  });
  return made.automationId;
}

/** Scroll the Playlist so a track is in view (a new automation clip's). */
function showTrack(track: number) {
  const p = playlistContext();
  const { view, gridHeight, setView } = usePlaylist.getState();
  if (!p) return;
  const top = p.layout[Math.min(track, p.layout.length - 1)] ?? 0;
  const bottom = p.layout[Math.min(track + 1, p.layout.length - 1)] ?? top;
  if (top >= view.scrollY && bottom <= view.scrollY + gridHeight) return;
  setView({ ...view, scrollY: Math.max(0, top - gridHeight / 2) });
}

/** A plugin's parameter as an automation target. */
export const parameterTarget = (p: PluginParameter): AutomationTarget => ({ kind: "plugin", owner: p.owner, id: p.id, param: p.param, index: p.index, name: p.name });

/** Automate a plugin's parameter (its window's Automate button, the Automate window's list): a clip at its value now. */
export const automateParameter = (p: PluginParameter) => createAutomationClip(parameterTarget(p), p.value);

/** Open an automation clip's window (a double-click on one of its clips, its menu's Automation settings). */
export function openAutomationWindow(id: string) {
  const { openIds } = useAutomationUi.getState();
  useMusicWindows.getState().focus(automationWindow(id));
  useAutomationUi.setState({ openIds: openIds.includes(id) ? openIds : [...openIds, id] });
}

export const closeAutomationWindow = (id: string) => useAutomationUi.setState({ openIds: useAutomationUi.getState().openIds.filter((o) => o !== id) });

/** The Automate window: every control of the song, to make an automation clip of one. */
export function openChooser() {
  useMusicWindows.getState().focus("automate");
  useAutomationUi.setState({ chooserOpen: true });
}

/** Delete automation clips and every clip of them (one undo step); their windows close. */
export function deleteAutomations(ids: readonly string[]) {
  const gone = new Set(ids);
  const p = playlistContext();
  if (p) fadeOutClips(p.clips.filter((c) => c.kind === "automation" && gone.has(c.ref)), p.selected);
  useMusic.getState().commit((song) => removeAutomations(song, gone));
  useAutomationUi.setState({ openIds: useAutomationUi.getState().openIds.filter((id) => !gone.has(id)) });
  const { source, automationSelection } = usePlaylist.getState();
  usePlaylist.setState({ source: source?.kind === "automation" && gone.has(source.ref) ? null : source, automationSelection: new Set([...automationSelection].filter((id) => !gone.has(id))) });
}

/** FL's Tools for an automation clip's curve. */
export const AUTOMATION_TOOLS = {
  flip: { name: "Flip vertically", apply: flipPoints },
  normalize: { name: "Normalize levels", apply: normalizePointLevels },
  louder: { name: "Scale levels up (×1.25)", apply: (points: AutomationPoint[]) => scalePoints(points, 1.25) },
  quieter: { name: "Scale levels down (×0.8)", apply: (points: AutomationPoint[]) => scalePoints(points, 0.8) },
  decimate: { name: "Decimate points", apply: decimatePoints },
  smooth: { name: "Smooth", apply: smoothPoints },
} as const;
export type AutomationTool = keyof typeof AUTOMATION_TOOLS;

/** Run one of the Tools on an automation clip's curve (one undo step). */
export function runTool(id: string, tool: AutomationTool) {
  useMusic.getState().commit((song) => editPoints(song, id, AUTOMATION_TOOLS[tool].apply));
}
