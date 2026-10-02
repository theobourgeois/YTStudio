/**
 * The plugins starred in the Plugin manager (FL Studio's favourites): the only ones, besides ours, that the
 * pickers offer (the rack's +, a channel's Replace, the mixer's effect slots), so the dozens of plugins
 * macOS and installers bring along stay out of the way. This computer's, the same in every song.
 */
import { create } from "zustand";

export const FAVOURITES_KEY = "vaudio.music.favouritePlugins";
/** The picker's pins (`usePluginPins`): what was pinned before there were stars starts starred. */
const PINS_KEY = "vaudio.music.pinnedPlugins";

function stored(): string[] {
  const read = (key: string) => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : null;
    } catch {
      return null;
    }
  };
  if (typeof localStorage === "undefined") return [];
  return read(FAVOURITES_KEY) ?? read(PINS_KEY) ?? [];
}

interface PluginFavouritesState {
  starred: string[];
  /** Star or unstar plugins (by id). */
  set: (ids: readonly string[], starred: boolean) => void;
  toggle: (id: string) => void;
}

export const usePluginFavourites = create<PluginFavouritesState>((set, get) => ({
  starred: stored(),
  set(ids, on) {
    const now = get().starred;
    const starred = on ? [...now, ...ids.filter((id) => !now.includes(id))] : now.filter((id) => !ids.includes(id));
    if (starred.length === now.length && starred.every((id, i) => id === now[i])) return;
    set({ starred });
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(starred));
  },
  toggle: (id) => get().set([id], !get().starred.includes(id)),
}));
