/**
 * Now Playing in the tab (docs/now-playing.md): what the music player is playing (asked of the server about once a
 * second, `api.nowPlaying`), the cover's colours (`AlbumPalette`), listening to the computer's sound for the
 * visualizer (`src/lib/live-audio.ts`) and hearing its vibe (`src/lib/vibe.ts`, CLAP, once its model's downloaded), and
 * whether the visualizer is open. The visualizer (the video suite's, `ClientSuite.NowPlaying`) reads it: the player is
 * only asked while it's open, or when the assistant asks.
 */
import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import type { NowPlayingCommand, NowPlayingStatus } from "@shared/now-playing";
import { type AlbumPalette, DEFAULT_PALETTE, paletteFromPixels } from "@shared/palette";
import { api } from "@/lib/api";
import type { ModelStatus } from "@shared/models";
import { type LiveAudio, startListening } from "@/lib/live-audio";
import { VibeHearing } from "@/lib/vibe";
import { log } from "@/lib/log";

const logger = log("now-playing");

const OFFSET_KEY = "editor-now-playing-offset";

/** How often the player is asked: playing, paused, and while it isn't open (or answering). */
const POLL_MS = { playing: 1000, paused: 2000, away: 5000 };

export type Listening = "off" | "starting" | "on" | "failed";

interface NowPlayingState {
  /** The player's last answer (null before the first). */
  status: NowPlayingStatus | null;
  /** The cover's colours, and the song they're of. */
  palette: AlbumPalette;
  paletteOf: string | null;
  listening: Listening;
  listenError: string | null;
  live: LiveAudio | null;
  /** The visualizer is open (full window). */
  visualizer: boolean;
  /** The vibe's model (CLAP's audio side): whether it's here, as of the last ask (null before the first). */
  vibeModel: ModelStatus | null;
  /**
   * How late the ears hear the sound after the computer sends it (ms; Settings › General, measured by tapping
   * along): about 0 on speakers, 150-250 on Bluetooth headphones. The visualizer waits for it.
   */
  offset: number;

  start(): () => void;
  setOffset(ms: number): void;
  refresh(): Promise<void>;
  command(command: NowPlayingCommand): Promise<void>;
  listen(): Promise<void>;
  stopListening(): void;
  /** Ask whether the vibe's model is here (following a download), and hear the vibe while listening once it is. */
  checkVibe(): Promise<void>;
  /** Download the vibe's model (the user said yes). */
  downloadVibe(): Promise<void>;
  openVisualizer(): void;
  closeVisualizer(): void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Hearing the vibe, while listening and the model's here. */
let hearing: VibeHearing | null = null;
let vibeCheck: ReturnType<typeof setTimeout> | null = null;
/** How often a download's followed (ms). */
const VIBE_CHECK_MS = 1000;
/** Each `start` is a run of its own: a stopped run's answer arriving late doesn't start polling twice. */
let run = 0;

const storedOffset = () => {
  const v = Number(localStorage.getItem(OFFSET_KEY));
  return Number.isFinite(v) ? Math.min(400, Math.max(0, v)) : 0;
};

export const useNowPlaying = create<NowPlayingState>((set, get) => ({
  status: null,
  palette: DEFAULT_PALETTE,
  paletteOf: null,
  listening: "off",
  listenError: null,
  live: null,
  visualizer: false,
  vibeModel: null,
  offset: storedOffset(),

  start() {
    const mine = ++run;
    if (timer) clearTimeout(timer);
    const tick = async () => {
      timer = null;
      if (run !== mine) return;
      const open = get().visualizer;
      if (open) await get().refresh();
      if (run !== mine) return;
      const s = get().status;
      const wait = !open || !s || s.unavailable ? POLL_MS.away : s.state === "playing" ? POLL_MS.playing : POLL_MS.paused;
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

  setOffset(ms) {
    const offset = Math.round(Math.min(400, Math.max(0, ms)));
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
        // What kind of song it is is found afresh (`LiveMood`).
        get().live?.signals.newSong();
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
      void get().checkVibe();
    } catch (err) {
      const message = errorMessage(err);
      // Cancelling the picker isn't a failure worth a message.
      const cancelled = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");
      set({ listening: cancelled ? "off" : "failed", listenError: cancelled ? null : message });
      if (!cancelled) logger.warn(`couldn't listen: ${message}`);
    }
  },

  stopListening() {
    hearing?.stop();
    hearing = null;
    get().live?.stop();
    set({ live: null, listening: "off" });
  },

  async checkVibe() {
    if (vibeCheck) clearTimeout(vibeCheck);
    vibeCheck = null;
    let model: ModelStatus;
    try {
      model = await api.vibeModel();
    } catch {
      return;
    }
    set({ vibeModel: model });
    if (model.status === "downloading") vibeCheck = setTimeout(() => void get().checkVibe(), VIBE_CHECK_MS);
    if (model.status === "ready" && get().listening === "on" && !hearing) {
      hearing = new VibeHearing(() => get().live?.signals ?? null, model.standIn);
      hearing.start();
    }
  },

  async downloadVibe() {
    try {
      set({ vibeModel: await api.setUpVibeModel() });
      logger.info("downloading the vibe's model");
    } catch (err) {
      toast.error(errorMessage(err));
    }
    await get().checkVibe();
  },

  openVisualizer() {
    set({ visualizer: true });
    // The player's asked at once (not at the next, slower while it was closed, tick), and first: what it says decides
    // what's listened to (the stand-in's made-up song).
    void get()
      .refresh()
      .then(() => {
        if (get().visualizer) void get().listen();
      });
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
