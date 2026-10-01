import { create } from "zustand";
import type { TrackState } from "@shared/music/mixer";
import type { MusicProject, Note } from "@shared/music/types";
import { useMusic } from "./store";
import type { WindowSnap } from "./window-geometry";

/**
 * A window of the music editor: the channel rack, the Piano roll, the mixer, a channel's settings, or one of the
 * small ones a command opens (Transpose selected, a note's properties).
 */
export type WindowId = "rack" | "piano" | "mixer" | "transpose" | "note" | "chopper" | `channel:${string}`;
export const channelWindow = (channelId: string): WindowId => `channel:${channelId}`;

export interface WindowPlace {
  x: number;
  y: number;
  /** A resizable window's size (the others fit what's in them). */
  width?: number;
  height?: number;
  /** Filling the desktop or half of it; `x`… `height` are then where it goes back to. */
  snap?: WindowSnap | null;
}

/** The fewest steps the rack shows: a bar of 4/4, FL Studio's default. */
export const MIN_RACK_STEPS = 16;

/**
 * How the music editor is laid out and what's selected in it: none of it part of the song (nothing
 * here is undone or saved). Like FL Studio, the editor is windows on a desktop: they're dragged,
 * closed and brought back, and the one last touched is on top.
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
  mixerOpen: boolean;
  /** The mixer's selected tracks; the first is the one its inspector shows and sends are made from. */
  selectedTrackIds: string[];
  /** The rack shows each channel's mixer track (Alt+M). */
  trackSelectorsShown: boolean;
  /** A mixer track's state, copied to paste onto another (its effects, with the project their settings are in). */
  copiedTrack: { projectId: string; state: TrackState } | null;
  /** The rack's Transpose selected window. */
  transposeOpen: boolean;
  /** The channels whose settings windows are open. */
  openChannelIds: string[];
  /** Where each window has been put. */
  places: Partial<Record<WindowId, WindowPlace>>;
  /** Windows from back to front. */
  order: WindowId[];
  /** Where a window sent to the corner came from, to go back there. */
  cornerFrom: Partial<Record<WindowId, WindowPlace>>;
  /** Where the window being dragged would snap to if it were let go now (drawn on the desktop). */
  snapPreview: WindowSnap | null;

  /** Select one channel (or, already the only one selected, none); `add` toggles it among the others. */
  selectChannel: (id: string, mode?: "only" | "add") => void;
  setSelection: (ids: string[]) => void;
  copySteps: (notes: Note[]) => void;
  setRackSteps: (steps: number) => void;
  setGraphOpen: (open: boolean) => void;
  setRackOpen: (open: boolean) => void;
  setPianoOpen: (open: boolean) => void;
  setMixerOpen: (open: boolean) => void;
  /** Select a mixer track (`add`: Ctrl+Shift, toggling it among the others, the first staying the current one). */
  selectTrack: (id: string, mode?: "only" | "add") => void;
  setTrackSelection: (ids: string[]) => void;
  /** Add tracks to the selection (those already in it stay where they are). */
  includeTracks: (ids: string[]) => void;
  setTrackSelectorsShown: (shown: boolean) => void;
  copyTrack: (copied: { projectId: string; state: TrackState }) => void;
  setTransposeOpen: (open: boolean) => void;
  /**
   * Open a channel's settings window (or close it, if it's open). Only one is open at a time, as in
   * FL Studio, unless `keepOthers` (Alt+click).
   */
  toggleChannelWindow: (id: string, keepOthers: boolean) => void;
  openChannelWindow: (id: string) => void;
  closeChannelWindow: (id: string) => void;
  focusWindow: (id: WindowId) => void;
  placeWindow: (id: WindowId, place: WindowPlace) => void;
  /** Fill the desktop with a window, or put it back as it was (a double-click on its title). */
  toggleMaximised: (id: WindowId, initial: WindowPlace) => void;
  /**
   * Send a window to the desktop's top-left corner, or back from it to where it was (a double-click on
   * the title of a window that doesn't resize, like the channel rack).
   */
  toggleCorner: (id: WindowId, initial: WindowPlace) => void;
  setSnapPreview: (snap: WindowSnap | null) => void;
}

const INITIAL = {
  selectedChannelIds: [] as string[],
  anchorChannelId: null as string | null,
  copiedSteps: null as Note[] | null,
  rackSteps: MIN_RACK_STEPS,
  graphOpen: false,
  rackOpen: true,
  pianoOpen: false,
  mixerOpen: false,
  selectedTrackIds: [] as string[],
  trackSelectorsShown: true,
  copiedTrack: null as { projectId: string; state: TrackState } | null,
  transposeOpen: false,
  openChannelIds: [] as string[],
  places: {},
  order: ["rack"] as WindowId[],
  cornerFrom: {} as Partial<Record<WindowId, WindowPlace>>,
  snapPreview: null as WindowSnap | null,
};

const toFront = (order: WindowId[], id: WindowId) => [...order.filter((w) => w !== id), id];

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
  setRackOpen: (rackOpen) => set({ rackOpen, order: rackOpen ? toFront(get().order, "rack") : get().order }),

  setPianoOpen: (pianoOpen) => set({ pianoOpen, order: pianoOpen ? toFront(get().order, "piano") : get().order.filter((w) => w !== "piano") }),

  setMixerOpen: (mixerOpen) => set({ mixerOpen, order: mixerOpen ? toFront(get().order, "mixer") : get().order }),
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

  setTransposeOpen: (transposeOpen) => set({ transposeOpen, order: transposeOpen ? toFront(get().order, "transpose") : get().order }),

  toggleChannelWindow(id, keepOthers) {
    const open = get().openChannelIds;
    if (open.includes(id)) return get().closeChannelWindow(id);
    set({ openChannelIds: keepOthers ? [...open, id] : [id], order: toFront(get().order, channelWindow(id)) });
  },
  openChannelWindow(id) {
    const open = get().openChannelIds;
    set({ openChannelIds: open.includes(id) ? open : [id], order: toFront(get().order, channelWindow(id)) });
  },
  closeChannelWindow: (id) => set({ openChannelIds: get().openChannelIds.filter((c) => c !== id) }),
  focusWindow(id) {
    const { order } = get();
    if (order[order.length - 1] !== id) set({ order: toFront(order, id) });
  },
  placeWindow: (id, place) => set({ places: { ...get().places, [id]: place } }),
  toggleMaximised(id, initial) {
    const place = get().places[id] ?? initial;
    get().placeWindow(id, { ...place, snap: place.snap === "full" ? null : "full" });
  },
  toggleCorner(id, initial) {
    const place = get().places[id] ?? initial;
    const from = get().cornerFrom[id];
    const inCorner = place.x === 0 && place.y === 0;
    if (inCorner && from) {
      set({ cornerFrom: { ...get().cornerFrom, [id]: undefined } });
      get().placeWindow(id, from);
    } else if (!inCorner) {
      set({ cornerFrom: { ...get().cornerFrom, [id]: place } });
      get().placeWindow(id, { ...place, x: 0, y: 0 });
    }
  },
  setSnapPreview: (snapPreview) => get().snapPreview !== snapPreview && set({ snapPreview }),
}));

// Another song: its own selection and windows.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useMusicUi.setState(INITIAL);
});

/**
 * The mixer track its inspector shows and sends are made from: the first selected that's still in the
 * song, or the master.
 */
export function currentTrackId(song: MusicProject, selected: readonly string[]): string {
  return selected.find((id) => song.mixer.tracks.some((t) => t.id === id)) ?? song.mixer.tracks[0].id;
}

/** The selected channels that are still in the song, in the rack's order. */
export const selectedIn = (song: MusicProject, ids: readonly string[]) => song.channels.filter((c) => ids.includes(c.id));
