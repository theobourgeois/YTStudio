/**
 * Now Playing in the tab (docs/now-playing.md): what the music player is playing (asked of the server about once a
 * second, `api.nowPlaying`), the cover's colours (`AlbumPalette`), listening to the computer's sound for the
 * visualizer (`src/lib/live-audio.ts`), and whether the visualizer is open. The pill at the top of the window and
 * the visualizer (the video suite's, `ClientSuite.NowPlaying`) both read it.
 */
import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import type { NowPlayingCommand, NowPlayingStatus } from "@shared/now-playing";
import { type AlbumPalette, DEFAULT_PALETTE, paletteFromPixels } from "@shared/palette";
import { api } from "@/lib/api";
import { type LiveAudio, startListening } from "@/lib/live-audio";
import { log } from "@/lib/log";

const logger = log("now-playing");

const ENABLED_KEY = "editor-now-playing";
const OFFSET_KEY = "editor-now-playing-offset";

/** How often the player is asked: playing, paused, and while it isn't open (or answering). */
const POLL_MS = { playing: 1000, paused: 2000, away: 5000 };

export type Listening = "off" | "starting" | "on" | "failed";

interface NowPlayingState {
  /** The player's last answer (null before the first). */
  status: NowPlayingStatus | null;
  /** Settings › General: show what's playing (and ask the player). */
  enabled: boolean;
  /** The cover's colours, and the song they're of. */
  palette: AlbumPalette;
  paletteOf: string | null;
  listening: Listening;
  listenError: string | null;
  live: LiveAudio | null;
  /** The visualizer is open (full window). */
  visualizer: boolean;
  /**
   * Milliseconds the pictures wait for the sound (Settings › General): the sound is heard as the computer sends it,
   * which headphones play later than speakers do.
   */
  offset: number;

  start(): () => void;
  setEnabled(enabled: boolean): void;
  setOffset(ms: number): void;
  refresh(): Promise<void>;
  command(command: NowPlayingCommand): Promise<void>;
  listen(): Promise<void>;
  stopListening(): void;
  openVisualizer(): void;
  closeVisualizer(): void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Each `start` is a run of its own: a stopped run's answer arriving late doesn't start polling twice. */
let run = 0;

const storedOffset = () => {
  const v = Number(localStorage.getItem(OFFSET_KEY));
  return Number.isFinite(v) ? Math.min(500, Math.max(-200, v)) : 0;
};

export const useNowPlaying = create<NowPlayingState>((set, get) => ({
  status: null,
  enabled: localStorage.getItem(ENABLED_KEY) !== "false",
  palette: DEFAULT_PALETTE,
  paletteOf: null,
  listening: "off",
  listenError: null,
  live: null,
  visualizer: false,
  offset: storedOffset(),

  start() {
    const mine = ++run;
    if (timer) clearTimeout(timer);
    const tick = async () => {
      timer = null;
      if (run !== mine) return;
      if (get().enabled) await get().refresh();
      if (run !== mine) return;
      const s = get().status;
      const wait = !get().enabled || !s || s.unavailable ? POLL_MS.away : s.state === "playing" ? POLL_MS.playing : POLL_MS.paused;
      timer = setTimeout(() => void tick(), wait);
    };
    void tick();
    return () => {
      if (run !== mine) return;
      run++;
      if (timer) clearTimeout(timer);
      timer = null;
    };
  },

  setEnabled(enabled) {
    localStorage.setItem(ENABLED_KEY, String(enabled));
    set({ enabled, ...(!enabled && { status: null, visualizer: false }) });
    if (!enabled) get().stopListening();
    else void get().refresh();
  },

  setOffset(ms) {
    const offset = Math.round(Math.min(500, Math.max(-200, ms)));
    localStorage.setItem(OFFSET_KEY, String(offset));
    set({ offset });
  },

  async refresh() {
    try {
      const status = await api.nowPlaying();
      set({ status });
      const track = status.track;
      if (track && track.id !== get().paletteOf) {
        set({ paletteOf: track.id });
        // A palette of its own for each song (a look notices the song by its colours changing).
        const palette = track.artwork ? await coverPalette(track.artwork).catch(() => ({ ...DEFAULT_PALETTE })) : { ...DEFAULT_PALETTE };
        // Still the same song.
        if (get().paletteOf === track.id) set({ palette });
      }
    } catch {
      // The server is restarting: ask again next time.
    }
  },

  async command(command) {
    try {
      set({ status: await api.nowPlayingCommand(command) });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  },

  async listen() {
    if (get().listening === "on" || get().listening === "starting") return;
    set({ listening: "starting", listenError: null });
    try {
      const live = await startListening(!!get().status?.demo, () => {
        // Sharing stopped from outside (the browser's Stop sharing).
        set({ live: null, listening: "off" });
      });
      set({ live, listening: "on" });
      logger.info(`listening to ${live.source === "demo" ? "a made-up song" : "the computer's sound"}`);
    } catch (err) {
      const message = errorMessage(err);
      // Cancelling the picker isn't a failure worth a message.
      const cancelled = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");
      set({ listening: cancelled ? "off" : "failed", listenError: cancelled ? null : message });
      if (!cancelled) logger.warn(`couldn't listen: ${message}`);
    }
  },

  stopListening() {
    get().live?.stop();
    set({ live: null, listening: "off" });
  },

  openVisualizer() {
    set({ visualizer: true });
    void get().listen();
  },

  closeVisualizer() {
    // Listening stops with it: the computer shows that its sound is being captured, and nothing else needs it.
    get().stopListening();
    set({ visualizer: false });
  },
}));

/** The palette of a cover: read small (48 × 48 is plenty) off a canvas. */
async function coverPalette(url: string): Promise<AlbumPalette> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return DEFAULT_PALETTE;
  ctx.drawImage(img, 0, 0, 48, 48);
  return paletteFromPixels(ctx.getImageData(0, 0, 48, 48).data);
}
