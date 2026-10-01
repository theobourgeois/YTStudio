import { create } from "zustand";
import { DEFAULT_METRONOME_SOUND, type MetronomeSound, type Resampling, isMetronomeSound, isResampling } from "@shared/music/engine";
import { DEFAULT_TEMPO, MAX_TEMPO, MIN_TEMPO, type NewSongOptions } from "@shared/music/project";

const DEFAULT_TEMPO_KEY = "music-default-tempo";
const METRONOME_SOUND_KEY = "music-metronome-sound";
const TIME_FORMAT_KEY = "music-time-format";
const RESAMPLING_KEY = "music-resampling";
const EXPORT_RESAMPLING_KEY = "music-export-resampling";
const RECORDING_KEY = "music-recording";

/** The count-ins Record's menu offers, in bars (0: none). */
export const COUNT_IN_BARS = [0, 1, 2, 4] as const;

/** Record's options (its right-click menu), FL Studio's: kept in this browser, the same for every song. */
export interface RecordingOptions {
  /** Bars of the metronome's clicks before recording starts (FL's Count-in, Ctrl+P). */
  countIn: number;
  /** Go round the time selection (or the song), a take each pass, until stopped (FL's Loop record). */
  loop: boolean;
  /** Hear earlier passes of a loop recording while recording the next (FL's Blend); off, they're muted. */
  blend: boolean;
  /** Record turns itself off when play stops (FL's Disarm on stop). */
  disarmOnStop: boolean;
}

const DEFAULT_RECORDING: RecordingOptions = { countIn: 1, loop: false, blend: false, disarmOnStop: false };

function storedRecording(): RecordingOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(RECORDING_KEY) ?? "{}") as Partial<RecordingOptions>;
    return {
      countIn: COUNT_IN_BARS.includes(raw.countIn as (typeof COUNT_IN_BARS)[number]) ? (raw.countIn as number) : DEFAULT_RECORDING.countIn,
      loop: raw.loop === true,
      blend: raw.blend === true,
      disarmOnStop: raw.disarmOnStop === true,
    };
  } catch {
    return DEFAULT_RECORDING;
  }
}

/** How the toolbar's position reads: bars:steps:ticks, or minutes:seconds:centiseconds (a click switches, as in FL Studio). */
export type TimeFormat = "bst" | "mscs";

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
 * at (the tempo display's menu sets it; until then, the starting point's or `DEFAULT_TEMPO`), the
 * metronome's sound, how the position reads, and how samples are read when pitched, playing and
 * exporting (FL's two Resampling settings).
 */
interface MusicPreferencesState {
  /** Null: never set. */
  defaultTempo: number | null;
  setDefaultTempo: (tempo: number | null) => void;
  metronomeSound: MetronomeSound;
  setMetronomeSound: (sound: MetronomeSound) => void;
  timeFormat: TimeFormat;
  setTimeFormat: (format: TimeFormat) => void;
  /** While playing: cheap enough for many voices at once. */
  resampling: Resampling;
  /** In exports, where time matters less than in playback. */
  exportResampling: Resampling;
  setResampling: (patch: Partial<Pick<MusicPreferencesState, "resampling" | "exportResampling">>) => void;
  recording: RecordingOptions;
  setRecording: (patch: Partial<RecordingOptions>) => void;
}

const storedSound = localStorage.getItem(METRONOME_SOUND_KEY);

export const useMusicPreferences = create<MusicPreferencesState>((set, get) => ({
  recording: storedRecording(),
  setRecording(patch) {
    const recording = { ...get().recording, ...patch };
    localStorage.setItem(RECORDING_KEY, JSON.stringify(recording));
    set({ recording });
  },
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
