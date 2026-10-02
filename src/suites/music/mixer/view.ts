import { create } from "zustand";

/** The mixer's sizes, FL Studio's layouts: its strips as they are, wider, or wider still with their effects listed. */
export const MIXER_VIEWS = ["compact", "wide", "extra"] as const;
export type MixerViewKind = (typeof MIXER_VIEWS)[number];
export const VIEW_NAMES: Record<MixerViewKind, string> = { compact: "Compact", wide: "Wide", extra: "Extra large" };
/** A strip's width (px) in each view. */
export const STRIP_WIDTHS: Record<MixerViewKind, number> = { compact: 46, wide: 64, extra: 96 };
const VIEW_KEY = "vaudio.music.mixerView";

/**
 * The Mixer window's own state, at the speed of the pointer: which track's name is being typed, a track
 * to scroll into view, a track's state being dragged. None of it is the song's.
 */
interface MixerViewState {
  /** The track whose name is being edited (F2, a double-click, the menu's Rename), or null. */
  renaming: string | null;
  /** The group whose name is being edited (just made, or its band double-clicked), or null. */
  renamingGroup: string | null;
  renameGroup: (id: string | null) => void;
  /** A track to scroll into view, once (just added, or selected by a key). */
  revealing: string | null;
  /**
   * A track's state being dragged (from its menu's Copy track state) to drop on another, or one of its
   * effects (`effect`: from the inspector's slots, moved, or copied with ⌘): where, and the track under it.
   */
  carrying: { from: string; x: number; y: number; over: string | null; effect?: { name: string; copy: boolean } } | null;
  /**
   * A selected track's cable being plugged (its down-arrow dragged): where the pointer is, the track under
   * it, and whether the drop adds a send (⌘ / Alt) rather than routing there alone.
   */
  plugging: { from: string; x: number; y: number; over: string | null; add: boolean } | null;
  plug: (plugging: MixerViewState["plugging"]) => void;
  /** Tracks dragged by their numbers to another place: where the line showing it is (the page's px). */
  reordering: { x: number; top: number; height: number } | null;
  reorder: (reordering: MixerViewState["reordering"]) => void;
  /** The master's Mono and Dim, for listening (sent with the song, never in it: an export doesn't have them). */
  listening: { mono: boolean; dim: boolean };
  setListening: (patch: Partial<MixerViewState["listening"]>) => void;
  /** The mixer's view (this computer's: it's kept). */
  view: MixerViewKind;
  setView: (view: MixerViewKind) => void;
  rename: (id: string | null) => void;
  reveal: (id: string | null) => void;
  carry: (carrying: MixerViewState["carrying"]) => void;
}

export const useMixerView = create<MixerViewState>((set) => ({
  renaming: null,
  renamingGroup: null,
  renameGroup: (renamingGroup) => set({ renamingGroup }),
  view: (() => {
    const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(VIEW_KEY);
    return MIXER_VIEWS.includes(saved as MixerViewKind) ? (saved as MixerViewKind) : "compact";
  })(),
  setView(view) {
    localStorage.setItem(VIEW_KEY, view);
    set({ view });
  },
  revealing: null,
  rename: (renaming) => set({ renaming }),
  reveal: (revealing) => set({ revealing }),
  carrying: null,
  carry: (carrying) => set({ carrying }),
  plugging: null,
  plug: (plugging) => set({ plugging }),
  listening: { mono: false, dim: false },
  setListening: (patch) => set((s) => ({ listening: { ...s.listening, ...patch } })),
  reordering: null,
  reorder: (reordering) => set({ reordering }),
}));

/** The mixer track whose strip is at a point of the page, or null. */
export function trackAt(x: number, y: number): string | null {
  const strip = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-track]");
  return strip?.closest('[data-testid="mixer"]') ? (strip.dataset.track ?? null) : null;
}
