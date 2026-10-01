import { create } from "zustand";
import { DEFAULT_METRONOME_SOUND, type MetronomeSound, isMetronomeSound } from "@shared/music/engine";
import { DEFAULT_TEMPO, MAX_TEMPO, MIN_TEMPO, type NewSongOptions } from "@shared/music/project";

const DEFAULT_TEMPO_KEY = "music-default-tempo";
const METRONOME_SOUND_KEY = "music-metronome-sound";
const TIME_FORMAT_KEY = "music-time-format";

/** How the toolbar's position reads: bars:steps:ticks, or minutes:seconds:centiseconds (a click switches, as in FL Studio). */
export type TimeFormat = "bst" | "mscs";

/** A stored tempo, if it's one a song can have. */
function validTempo(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return value !== null && value !== "" && Number.isFinite(n) && n >= MIN_TEMPO && n <= MAX_TEMPO ? Math.round(n * 100) / 100 : null;
}

/**
 * The music editor's preferences that aren't a song's, kept in this browser: the tempo new songs start
 * at (the tempo display's menu sets it; until then, the starting point's or `DEFAULT_TEMPO`), the
 * metronome's sound and how the position reads.
 */
interface MusicPreferencesState {
  /** Null: never set. */
  defaultTempo: number | null;
  setDefaultTempo: (tempo: number | null) => void;
  metronomeSound: MetronomeSound;
  setMetronomeSound: (sound: MetronomeSound) => void;
  timeFormat: TimeFormat;
  setTimeFormat: (format: TimeFormat) => void;
}

const storedSound = localStorage.getItem(METRONOME_SOUND_KEY);

export const useMusicPreferences = create<MusicPreferencesState>((set) => ({
  defaultTempo: validTempo(localStorage.getItem(DEFAULT_TEMPO_KEY)),
  setDefaultTempo(tempo) {
    const defaultTempo = tempo === null ? null : validTempo(tempo);
    if (defaultTempo === null) localStorage.removeItem(DEFAULT_TEMPO_KEY);
    else localStorage.setItem(DEFAULT_TEMPO_KEY, String(defaultTempo));
    set({ defaultTempo });
  },
  metronomeSound: isMetronomeSound(storedSound) ? storedSound : DEFAULT_METRONOME_SOUND,
  setMetronomeSound(metronomeSound) {
    localStorage.setItem(METRONOME_SOUND_KEY, metronomeSound);
    set({ metronomeSound });
  },
  timeFormat: localStorage.getItem(TIME_FORMAT_KEY) === "mscs" ? "mscs" : "bst",
  setTimeFormat(timeFormat) {
    localStorage.setItem(TIME_FORMAT_KEY, timeFormat);
    set({ timeFormat });
  },
}));

/** The tempo a new song starts at, as far as this tab knows (a starting point's own is the server's). */
export const newSongTempo = () => useMusicPreferences.getState().defaultTempo ?? DEFAULT_TEMPO;

/** What's sent with a new song (`ClientSuite.newProjectOptions`). */
export function newSongOptions(): NewSongOptions | undefined {
  const tempo = useMusicPreferences.getState().defaultTempo;
  return tempo === null ? undefined : { tempo };
}
