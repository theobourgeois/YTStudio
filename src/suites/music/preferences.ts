import { create } from "zustand";
import { type Resampling, isResampling } from "@shared/music/engine";
import { DEFAULT_TEMPO, MAX_TEMPO, MIN_TEMPO, type NewSongOptions } from "@shared/music/project";

const DEFAULT_TEMPO_KEY = "music-default-tempo";
const RESAMPLING_KEY = "music-resampling";
const EXPORT_RESAMPLING_KEY = "music-export-resampling";

const storedResampling = (key: string, fallback: Resampling): Resampling => {
  const value = localStorage.getItem(key);
  return isResampling(value) ? value : fallback;
};

/** A stored tempo, if it's one a song can have. */
function validTempo(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return value !== null && value !== "" && Number.isFinite(n) && n >= MIN_TEMPO && n <= MAX_TEMPO ? Math.round(n * 100) / 100 : null;
}

/**
 * The music editor's preferences that aren't a song's, kept in this browser: the tempo new songs start
 * at (the tempo display's menu sets it; until then, the starting point's or `DEFAULT_TEMPO`), and how
 * samples are read when pitched, playing and exporting (FL's two Resampling settings).
 */
interface MusicPreferencesState {
  /** Null: never set. */
  defaultTempo: number | null;
  setDefaultTempo: (tempo: number | null) => void;
  /** While playing: cheap enough for many voices at once. */
  resampling: Resampling;
  /** In exports, where time matters less than in playback. */
  exportResampling: Resampling;
  setResampling: (patch: Partial<Pick<MusicPreferencesState, "resampling" | "exportResampling">>) => void;
}

export const useMusicPreferences = create<MusicPreferencesState>((set) => ({
  defaultTempo: validTempo(localStorage.getItem(DEFAULT_TEMPO_KEY)),
  setDefaultTempo(tempo) {
    const defaultTempo = tempo === null ? null : validTempo(tempo);
    if (defaultTempo === null) localStorage.removeItem(DEFAULT_TEMPO_KEY);
    else localStorage.setItem(DEFAULT_TEMPO_KEY, String(defaultTempo));
    set({ defaultTempo });
  },
  resampling: storedResampling(RESAMPLING_KEY, "hermite"),
  exportResampling: storedResampling(EXPORT_RESAMPLING_KEY, "sinc"),
  setResampling({ resampling, exportResampling }) {
    if (isResampling(resampling)) {
      localStorage.setItem(RESAMPLING_KEY, resampling);
      set({ resampling });
    }
    if (isResampling(exportResampling)) {
      localStorage.setItem(EXPORT_RESAMPLING_KEY, exportResampling);
      set({ exportResampling });
    }
  },
}));

/** The tempo a new song starts at, as far as this tab knows (a starting point's own is the server's). */
export const newSongTempo = () => useMusicPreferences.getState().defaultTempo ?? DEFAULT_TEMPO;

/** What's sent with a new song (`ClientSuite.newProjectOptions`). */
export function newSongOptions(): NewSongOptions | undefined {
  const tempo = useMusicPreferences.getState().defaultTempo;
  return tempo === null ? undefined : { tempo };
}
