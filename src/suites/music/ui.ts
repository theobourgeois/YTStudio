import { create } from "zustand";
import type { TrackState } from "@shared/music/mixer";
import type { Channel, MusicProject, Note } from "@shared/music/types";
import { createWindows } from "@/components/windows/store";
import type { ManagerFilter } from "./plugin-groups";
import { useMusic } from "./store";

/**
 * A window of the music editor: the channel rack, the Piano roll, the Playlist, the mixer, a channel's settings,
 * an automation clip's, a Gross Beat's, an Auto-Tune's, an EchoBoy's, a Pro-Q's, a PanMan's, a Pitch Wheel's, an OTT's, a Pro-C's, a Reverb's, or one of the small ones a command opens (Transpose selected, a note's properties,
 * Automate: every control to automate).
 */
export type WindowId =
  | "rack"
  | "piano"
  | "playlist"
  | "mixer"
  | "transpose"
  | "note"
  | "chopper"
  | "quantizer"
  | "export"
  | "automate"
  | "plugins"
  | "modulators"
  | `channel:${string}`
  | `automation:${string}`
  | `gross:${string}`
  | `tune:${string}`
  | `echo:${string}`
  | `panman:${string}`
  | `proq:${string}`
  | `wheel:${string}`
  | `ott:${string}`
  | `proc:${string}`
  | `verb:${string}`;

/**
 * The rack's group filter (FL Studio's): Unsorted is every channel but the audio clips' (the default),
 * Audio is theirs, All is everything (Théo).
 */
export type RackGroup = "unsorted" | "audio" | "all";
export const channelWindow = (channelId: string): WindowId => `channel:${channelId}`;
/** An automation clip's window (`automation/automation-window.tsx`). */
export const automationWindow = (automationId: string): WindowId => `automation:${automationId}`;
/** A Gross Beat's window (`gross-beat/gross-beat-window.tsx`), by its effect's id. */
export const grossBeatWindow = (effectId: string): WindowId => `gross:${effectId}`;
/** An Auto-Tune's window (`auto-tune/auto-tune-window.tsx`), by its effect's id. */
export const autoTuneWindow = (effectId: string): WindowId => `tune:${effectId}`;
/** An EchoBoy's window (`echo-boy/echo-boy-window.tsx`), by its effect's id. */
export const echoBoyWindow = (effectId: string): WindowId => `echo:${effectId}`;
/** A Pro-Q's window (`pro-q/pro-q-window.tsx`), by its effect's id. */
export const proQWindow = (effectId: string): WindowId => `proq:${effectId}`;
/** An OTT's window (`ott/ott-window.tsx`), by its effect's id. */
export const ottWindow = (effectId: string): WindowId => `ott:${effectId}`;
/** A Pro-C's window (`pro-c/pro-c-window.tsx`), by its effect's id. */
export const proCWindow = (effectId: string): WindowId => `proc:${effectId}`;
/** A Reverb's window (`reverb/reverb-window.tsx`), by its effect's id. */
export const reverbWindow = (effectId: string): WindowId => `verb:${effectId}`;
/** A PanMan's window (`panman/panman-window.tsx`), by its effect's id. */
export const panManWindow = (effectId: string): WindowId => `panman:${effectId}`;
/** A Pitch Wheel's window (`pitch-wheel/pitch-wheel-window.tsx`), by its effect's id. */
export const pitchWheelWindow = (effectId: string): WindowId => `wheel:${effectId}`;

/** Where the music editor's windows are on its desktop, and which is in front (the rack over the Playlist, at first). */
export const useMusicWindows = createWindows<WindowId>(["playlist", "rack"]);

/** The fewest steps the rack shows: a bar of 4/4, FL Studio's default. */
export const MIN_RACK_STEPS = 16;

/**
 * Which of the music editor's windows are open and what's selected in it: none of it part of the song
 * (nothing here is undone or saved). Like FL Studio, the editor is windows on a desktop: they're
 * dragged, closed and brought back, and the one last touched is on top (`useMusicWindows`).
 */
interface MusicUiState {
  /** Selected channels (the selector lights), in the order they were picked. */
  selectedChannelIds: string[];
  /** The channel a Shift+click's range starts from: the last one clicked on its own. */
  anchorChannelId: string | null;
  /** A channel's steps, copied (Ctrl+C) to paste into another channel or pattern. */
  copiedSteps: Note[] | null;
  /** How many steps the rack is wide enough to show (it always shows at least the pattern's). */
  rackSteps: number;
  graphOpen: boolean;
  rackOpen: boolean;
  pianoOpen: boolean;
  playlistOpen: boolean;
  mixerOpen: boolean;
  /** Which channels the rack shows. */
  rackGroup: RackGroup;
  /** The mixer's selected tracks; the first is the one its inspector shows and sends are made from. */
  selectedTrackIds: string[];
  /** The rack shows each channel's mixer track (Alt+M). */
  trackSelectorsShown: boolean;
  /** A mixer track's state, copied to paste onto another (its effects, with the project their settings are in). */
  copiedTrack: { projectId: string; state: TrackState } | null;
  /** The rack's Transpose selected window. */
  transposeOpen: boolean;
  /** The export window (⌘R). */
  exportOpen: boolean;
  /** The Plugin manager (a picker's More plugins…): what it lists when it opens, or null while it's closed. */
  pluginManager: ManagerFilter | null;
  /** The channels whose settings windows are open. */
  openChannelIds: string[];

  /** Select one channel (or, already the only one selected, none); `add` toggles it among the others. */
  selectChannel: (id: string, mode?: "only" | "add") => void;
  setSelection: (ids: string[]) => void;
  copySteps: (notes: Note[]) => void;
  setRackSteps: (steps: number) => void;
  setGraphOpen: (open: boolean) => void;
  setRackOpen: (open: boolean) => void;
  setPianoOpen: (open: boolean) => void;
  setPlaylistOpen: (open: boolean) => void;
  setMixerOpen: (open: boolean) => void;
  setRackGroup: (group: RackGroup) => void;
  /** Select a mixer track (`add`: Ctrl+Shift, toggling it among the others, the first staying the current one). */
  selectTrack: (id: string, mode?: "only" | "add") => void;
  setTrackSelection: (ids: string[]) => void;
  /** Add tracks to the selection (those already in it stay where they are). */
  includeTracks: (ids: string[]) => void;
  setTrackSelectorsShown: (shown: boolean) => void;
  copyTrack: (copied: { projectId: string; state: TrackState }) => void;
  setTransposeOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  /** Open the Plugin manager listing `filter`'s plugins (null closes it). */
  setPluginManager: (filter: ManagerFilter | null) => void;
  /**
   * Open a channel's settings window (or close it, if it's open). Only one is open at a time, as in
   * FL Studio, unless `keepOthers` (Alt+click).
   */
  toggleChannelWindow: (id: string, keepOthers: boolean) => void;
  openChannelWindow: (id: string) => void;
  closeChannelWindow: (id: string) => void;
}

const INITIAL = {
  selectedChannelIds: [] as string[],
  anchorChannelId: null as string | null,
  copiedSteps: null as Note[] | null,
  rackSteps: MIN_RACK_STEPS,
  graphOpen: false,
  rackOpen: true,
  pianoOpen: false,
  // A song opens on the Playlist (maximised) with the rack over it, as FL Studio does.
  playlistOpen: true,
  mixerOpen: false,
  rackGroup: "unsorted" as RackGroup,
  selectedTrackIds: [] as string[],
  trackSelectorsShown: true,
  copiedTrack: null as { projectId: string; state: TrackState } | null,
  transposeOpen: false,
  exportOpen: false,
  pluginManager: null as ManagerFilter | null,
  openChannelIds: [] as string[],
};

const windows = () => useMusicWindows.getState();

export const useMusicUi = create<MusicUiState>((set, get) => ({
  ...INITIAL,

  selectChannel(id, mode = "only") {
    const selected = get().selectedChannelIds;
    if (mode === "add") set({ selectedChannelIds: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id] });
    else set({ selectedChannelIds: selected.length === 1 && selected[0] === id ? [] : [id], anchorChannelId: id });
  },
  setSelection: (selectedChannelIds) => set({ selectedChannelIds }),
  copySteps: (copiedSteps) => set({ copiedSteps }),
  setRackSteps: (steps) => set({ rackSteps: Math.max(MIN_RACK_STEPS, Math.round(steps)) }),
  setGraphOpen: (graphOpen) => set({ graphOpen }),
  setRackOpen(rackOpen) {
    if (rackOpen) windows().focus("rack");
    set({ rackOpen });
  },

  setPianoOpen(pianoOpen) {
    if (pianoOpen) windows().focus("piano");
    else windows().remove("piano");
    set({ pianoOpen });
  },

  setPlaylistOpen(playlistOpen) {
    if (playlistOpen) windows().focus("playlist");
    else windows().remove("playlist");
    set({ playlistOpen });
  },

  setMixerOpen(mixerOpen) {
    if (mixerOpen) windows().focus("mixer");
    set({ mixerOpen });
  },
  setRackGroup: (rackGroup) => set({ rackGroup }),
  selectTrack(id, mode = "only") {
    const selected = get().selectedTrackIds;
    if (mode === "only") return set({ selectedTrackIds: [id] });
    if (!selected.includes(id)) return set({ selectedTrackIds: [...selected, id] });
    // The current one stays selected (it's what the inspector shows).
    if (selected.length > 1) set({ selectedTrackIds: selected.filter((t) => t !== id) });
  },
  setTrackSelection: (selectedTrackIds) => set({ selectedTrackIds }),
  includeTracks(ids) {
    const selected = get().selectedTrackIds;
    const added = ids.filter((id) => !selected.includes(id));
    if (added.length) set({ selectedTrackIds: [...selected, ...added] });
  },
  setTrackSelectorsShown: (trackSelectorsShown) => set({ trackSelectorsShown }),
  copyTrack: (copiedTrack) => set({ copiedTrack }),

  setTransposeOpen(transposeOpen) {
    if (transposeOpen) windows().focus("transpose");
    set({ transposeOpen });
  },
  setExportOpen(exportOpen) {
    if (exportOpen) windows().focus("export");
    set({ exportOpen });
  },
  setPluginManager(pluginManager) {
    if (pluginManager) windows().focus("plugins");
    set({ pluginManager });
  },

  toggleChannelWindow(id, keepOthers) {
    const open = get().openChannelIds;
    if (open.includes(id)) return get().closeChannelWindow(id);
    windows().focus(channelWindow(id));
    set({ openChannelIds: keepOthers ? [...open, id] : [id] });
  },
  openChannelWindow(id) {
    const open = get().openChannelIds;
    windows().focus(channelWindow(id));
    set({ openChannelIds: open.includes(id) ? open : [id] });
  },
  closeChannelWindow: (id) => set({ openChannelIds: get().openChannelIds.filter((c) => c !== id) }),
}));

// Another song: its own selection and windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) {
    useMusicUi.setState(INITIAL);
    useMusicWindows.getState().reset();
  }
});

/**
 * The mixer track its inspector shows and sends are made from: the first selected that's still in the
 * song, or the master.
 */
export function currentTrackId(song: MusicProject, selected: readonly string[]): string {
  return selected.find((id) => song.mixer.tracks.some((t) => t.id === id)) ?? song.mixer.tracks[0].id;
}

/** Whether the rack's group filter shows a channel. */
export const inRackGroup = (channel: Pick<Channel, "kind">, group: RackGroup) => group === "all" || (group === "audio") === (channel.kind === "audio");

/**
 * Select a channel in the rack unless it's already selected (with others, it keeps them): what the
 * Piano roll shows and a channel whose window is opened are the rack's selected channel, as in FL Studio.
 */
export function selectInRack(channelId: string) {
  const ui = useMusicUi.getState();
  if (!ui.selectedChannelIds.includes(channelId)) useMusicUi.setState({ selectedChannelIds: [channelId], anchorChannelId: channelId });
}

/** The selected channels that are still in the song, in the rack's order. */
export const selectedIn = (song: MusicProject, ids: readonly string[]) => song.channels.filter((c) => ids.includes(c.id));
