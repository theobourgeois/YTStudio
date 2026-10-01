import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { WindowSnap } from "./geometry";

export interface WindowPlace {
  x: number;
  y: number;
  /** A resizable window's size (the others fit what's in them). */
  width?: number;
  height?: number;
  /** Filling the desktop or half of it; `x`… `height` are then where it goes back to. */
  snap?: WindowSnap | null;
}

/**
 * Where the windows on one desktop are and which is in front: a store per desktop (`createWindows`), so
 * the music editor's and the app's (Settings) each keep their own. Which windows are *open* is up to
 * whoever owns them; this only places and stacks them. None of it is undone or saved.
 */
export interface WindowsState<Id extends string = string> {
  /** Where each window has been put. */
  places: Partial<Record<Id, WindowPlace>>;
  /** Windows from back to front. */
  order: Id[];
  /** Where a window sent to the corner came from, to go back there. */
  cornerFrom: Partial<Record<Id, WindowPlace>>;
  /** Where the window being dragged would snap to if it were let go now (drawn on the desktop). */
  snapPreview: WindowSnap | null;

  /** Bring a window to the front (one that's only being opened, too). */
  focus: (id: Id) => void;
  /** Take a window out of the stack (closed, and not to be remembered as having been in front). */
  remove: (id: Id) => void;
  place: (id: Id, place: WindowPlace) => void;
  /** Fill the desktop with a window, or put it back as it was (a double-click on its title). */
  toggleMaximised: (id: Id, initial: WindowPlace) => void;
  /**
   * Send a window to the desktop's top-left corner, or back from it to where it was (a double-click on
   * the title of a window that doesn't resize, like the channel rack).
   */
  toggleCorner: (id: Id, initial: WindowPlace) => void;
  setSnapPreview: (snap: WindowSnap | null) => void;
  /** Forget every place, with these windows stacked (another song: its own windows). */
  reset: () => void;
}

export type WindowsStore<Id extends string = string> = UseBoundStore<StoreApi<WindowsState<Id>>>;

const toFront = <Id extends string>(order: Id[], id: Id) => [...order.filter((w) => w !== id), id];

/** A desktop's windows, `order` being how they're stacked at first (and after `reset`). */
export function createWindows<Id extends string>(order: Id[] = []): WindowsStore<Id> {
  const initial = () => ({ places: {}, order: [...order], cornerFrom: {}, snapPreview: null });
  return create<WindowsState<Id>>((set, get) => ({
    ...initial(),
    focus(id) {
      const current = get().order;
      if (current[current.length - 1] !== id) set({ order: toFront(current, id) });
    },
    remove(id) {
      if (get().order.includes(id)) set({ order: get().order.filter((w) => w !== id) });
    },
    place: (id, place) => set({ places: { ...get().places, [id]: place } }),
    toggleMaximised(id, initialPlace) {
      const place = get().places[id] ?? initialPlace;
      get().place(id, { ...place, snap: place.snap === "full" ? null : "full" });
    },
    toggleCorner(id, initialPlace) {
      const place = get().places[id] ?? initialPlace;
      const from = get().cornerFrom[id];
      const inCorner = place.x === 0 && place.y === 0;
      if (inCorner && from) {
        set({ cornerFrom: { ...get().cornerFrom, [id]: undefined } });
        get().place(id, from);
      } else if (!inCorner) {
        set({ cornerFrom: { ...get().cornerFrom, [id]: place } });
        get().place(id, { ...place, x: 0, y: 0 });
      }
    },
    setSnapPreview: (snapPreview) => get().snapPreview !== snapPreview && set({ snapPreview }),
    reset: () => set(initial()),
  }));
}
