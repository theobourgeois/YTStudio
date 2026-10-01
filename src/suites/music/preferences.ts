import { create } from "zustand";
import { DEFAULT_TEMPO, MAX_TEMPO, MIN_TEMPO, type NewSongOptions } from "@shared/music/project";

const DEFAULT_TEMPO_KEY = "music-default-tempo";

/** A stored tempo, if it's one a song can have. */
function validTempo(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return value !== null && value !== "" && Number.isFinite(n) && n >= MIN_TEMPO && n <= MAX_TEMPO ? Math.round(n * 100) / 100 : null;
}

/**
 * The music editor's preferences that aren't a song's, kept in this browser: the tempo new songs start
 * at (the tempo display's menu sets it; until then, the starting point's or `DEFAULT_TEMPO`).
 */
interface MusicPreferencesState {
  /** Null: never set. */
  defaultTempo: number | null;
  setDefaultTempo: (tempo: number | null) => void;
}

export const useMusicPreferences = create<MusicPreferencesState>((set) => ({
  defaultTempo: validTempo(localStorage.getItem(DEFAULT_TEMPO_KEY)),
  setDefaultTempo(tempo) {
    const defaultTempo = tempo === null ? null : validTempo(tempo);
    if (defaultTempo === null) localStorage.removeItem(DEFAULT_TEMPO_KEY);
    else localStorage.setItem(DEFAULT_TEMPO_KEY, String(defaultTempo));
    set({ defaultTempo });
  },
}));

/** The tempo a new song starts at, as far as this tab knows (a starting point's own is the server's). */
export const newSongTempo = () => useMusicPreferences.getState().defaultTempo ?? DEFAULT_TEMPO;

/** What's sent with a new song (`ClientSuite.newProjectOptions`). */
export function newSongOptions(): NewSongOptions | undefined {
  const tempo = useMusicPreferences.getState().defaultTempo;
  return tempo === null ? undefined : { tempo };
}
