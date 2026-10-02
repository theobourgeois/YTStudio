import { create } from "zustand";
import { DEFAULT_METRONOME_SOUND, type MetronomeSound, type Resampling, isMetronomeSound, isResampling } from "@shared/music/engine";
import { DEFAULT_TEMPO, MAX_TEMPO, MIN_TEMPO, type NewSongOptions } from "@shared/music/project";
import { type NoteQuantize, isNoteQuantize } from "@shared/music/recording";
import { isStretchMode } from "@shared/music/stretch";
import type { StretchMode } from "@shared/music/types";

/** This browser's storage, or none (Node, in tests that load the transport): nothing is kept then. */
const storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> =
  typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const DEFAULT_TEMPO_KEY = "music-default-tempo";
const METRONOME_SOUND_KEY = "music-metronome-sound";
const TIME_FORMAT_KEY = "music-time-format";
const RESAMPLING_KEY = "music-resampling";
const EXPORT_RESAMPLING_KEY = "music-export-resampling";
const RECORDING_KEY = "music-recording";
const STRETCH_MODE_KEY = "music-stretch-mode";
const RESET_ON_STOP_KEY = "music-reset-on-stop";

/** How long a count-in can be, in bars (the count-in switch's menu). */
export const COUNT_IN_BARS = [1, 2, 4] as const;

/** Record's options (its right-click menu), FL Studio's: kept in this browser, the same for every song. */
export interface RecordingOptions {
  /** The metronome counts in before recording starts (FL's Count-in: the toolbar's switch, on by default). */
  countIn: boolean;
  /** How many bars it counts in. */
  countInBars: number;
  /** Go round the time selection (or the song), a take each pass, until stopped (FL's Loop record). */
  loop: boolean;
  /** Hear earlier passes of a loop recording while recording the next (FL's Blend); off, they're muted. */
  blend: boolean;
  /** Record turns itself off when play stops (FL's Disarm on stop). */
  disarmOnStop: boolean;
  /** What of recorded notes is quantized, on the Piano roll's snap (FL's: Line, Cell or none quantize nothing). */
  quantize: NoteQuantize;
}

const DEFAULT_RECORDING: RecordingOptions = { countIn: true, countInBars: 1, loop: false, blend: false, disarmOnStop: false, quantize: "start" };

/** Bars of count-in a recording starts with: none while the switch is off. */
export const countInBars = (options: RecordingOptions) => (options.countIn ? options.countInBars : 0);

function storedRecording(): RecordingOptions {
  try {
    const raw = JSON.parse(storage.getItem(RECORDING_KEY) ?? "{}") as Partial<Record<keyof RecordingOptions, unknown>>;
    // (Kept as a number of bars before there was a switch: 0 was off.)
    const bars = typeof raw.countIn === "number" ? raw.countIn : raw.countInBars;
    return {
      countIn: typeof raw.countIn === "number" ? raw.countIn > 0 : raw.countIn !== false,
      countInBars: COUNT_IN_BARS.includes(bars as (typeof COUNT_IN_BARS)[number]) ? (bars as number) : DEFAULT_RECORDING.countInBars,
      loop: raw.loop === true,
      blend: raw.blend === true,
      disarmOnStop: raw.disarmOnStop === true,
      quantize: isNoteQuantize(raw.quantize) ? raw.quantize : DEFAULT_RECORDING.quantize,
    };
  } catch {
    return DEFAULT_RECORDING;
  }
}

/** How the toolbar's position reads: bars:steps:ticks, or minutes:seconds:centiseconds (a click switches, as in FL Studio). */
export type TimeFormat = "bst" | "mscs";

const storedResampling = (key: string, fallback: Resampling): Resampling => {
  const value = storage.getItem(key);
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
 * exporting (FL's two Resampling settings), and the mode a clip that had no stretch is stretched in.
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
  /**
   * The mode an audio clip with no stretch of its own (nor its channel's) is stretched in, in the Playlist:
   * Stretch, its pitch kept (FL always uses Resample, which its users ask to choose).
   */
  stretchMode: StretchMode;
  setStretchMode: (mode: StretchMode) => void;
  /**
   * Every stop resets the plugins, so delays and reverbs stop ringing at once (FL's "Reset plugins on
   * transport"). Off, a stop lets them ring out and a second press of Stop silences them.
   */
  resetOnStop: boolean;
  setResetOnStop: (on: boolean) => void;
}

const storedSound = storage.getItem(METRONOME_SOUND_KEY);
const storedStretchMode = storage.getItem(STRETCH_MODE_KEY);

export const useMusicPreferences = create<MusicPreferencesState>((set, get) => ({
  resetOnStop: storage.getItem(RESET_ON_STOP_KEY) === "true",
  setResetOnStop(resetOnStop) {
    storage.setItem(RESET_ON_STOP_KEY, String(resetOnStop));
    set({ resetOnStop });
  },
  stretchMode: isStretchMode(storedStretchMode) ? storedStretchMode : "stretch",
  setStretchMode(stretchMode) {
    storage.setItem(STRETCH_MODE_KEY, stretchMode);
    set({ stretchMode });
  },
  recording: storedRecording(),
  setRecording(patch) {
    const recording = { ...get().recording, ...patch };
    storage.setItem(RECORDING_KEY, JSON.stringify(recording));
    set({ recording });
  },
  defaultTempo: validTempo(storage.getItem(DEFAULT_TEMPO_KEY)),
  setDefaultTempo(tempo) {
    const defaultTempo = tempo === null ? null : validTempo(tempo);
    if (defaultTempo === null) storage.removeItem(DEFAULT_TEMPO_KEY);
    else storage.setItem(DEFAULT_TEMPO_KEY, String(defaultTempo));
    set({ defaultTempo });
  },
  metronomeSound: isMetronomeSound(storedSound) ? storedSound : DEFAULT_METRONOME_SOUND,
  setMetronomeSound(metronomeSound) {
    storage.setItem(METRONOME_SOUND_KEY, metronomeSound);
    set({ metronomeSound });
  },
  timeFormat: storage.getItem(TIME_FORMAT_KEY) === "mscs" ? "mscs" : "bst",
  setTimeFormat(timeFormat) {
    storage.setItem(TIME_FORMAT_KEY, timeFormat);
    set({ timeFormat });
  },
  resampling: storedResampling(RESAMPLING_KEY, "hermite"),
  exportResampling: storedResampling(EXPORT_RESAMPLING_KEY, "sinc"),
  setResampling({ resampling, exportResampling }) {
    if (isResampling(resampling)) {
      storage.setItem(RESAMPLING_KEY, resampling);
      set({ resampling });
    }
    if (isResampling(exportResampling)) {
      storage.setItem(EXPORT_RESAMPLING_KEY, exportResampling);
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
