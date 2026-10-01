import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import type { EngineChannels, EngineMeters } from "@shared/music/engine";
import { musicApi } from "./api";

/**
 * What the audio engine is doing, as it tells us (`engine-sync.ts` feeds this from its event
 * stream): whether the song plays and where it is, the output's level, the engine's load. It changes
 * many times a second, so it's kept apart from the song's store, and components read narrow parts.
 */
interface TransportState {
  playing: boolean;
  /** Where the loop was (ticks) at `at` (`performance.now()`): the position now is worked out from these. */
  tick: number;
  at: number;
  /** The output's level (0..1+) and the audio thread's load (0..1). */
  peak: number;
  cpu: number;
  /** Each mixer track's loudest level since the engine last said (at `at`); silent tracks are absent. */
  meters: EngineMeters;
  metronome: boolean;
  /** How long after the engine computes a sound it's heard: the playhead is shown that much late. */
  latencyMs: number;
  /** What the engine loops, in the pattern's ticks: the whole pattern, or the Piano roll's time selection. */
  loop: { start: number; ticks: number };
  /** Where in the pattern play starts (a click on the Piano roll's ruler), in ticks. */
  startTick: number;
  /** Channels whose sample the engine couldn't read. */
  unreadable: string[];
  /** The song's plugin channels as the engine has them: loaded (and whose window is open), loading, failed. */
  channels: EngineChannels;
  /** Why the engine can't be reached (it isn't built, it won't start), or null. */
  error: string | null;

  play: () => void;
  stop: () => void;
  toggle: () => void;
  setMetronome: (on: boolean) => void;
  /** Hear a channel's sample once. */
  audition: (channelId: string, pitch?: number) => void;
  /** Show or close the window of a plugin channel's plugin. */
  showPlugin: (channelId: string, open: boolean) => void;
  /** Hold a key on a channel, or let it go (the Piano roll's keyboard, a note being drawn). `key` is a MIDI note. */
  preview: (channelId: string, key: number, on: boolean, velocity?: number) => void;
  setStartTick: (tick: number) => void;
  /** Set where play starts, and if it's playing, go there now. */
  jumpTo: (tick: number) => void;
}

export const NO_CHANNELS: EngineChannels = { loaded: [], loading: [], failed: [] };
export const NO_METERS: EngineMeters = {};

export const useTransport = create<TransportState>((set, get) => {
  /** Run a transport command, and take what the engine says of itself from its answer. */
  async function run(command: "play" | "stop" | "metronome", body: { on: boolean } | { from?: number }) {
    try {
      const status = await musicApi.engine(command, body as never);
      set({
        playing: status.transport.playing,
        tick: status.transport.tick,
        at: performance.now(),
        metronome: status.transport.metronome,
        latencyMs: status.outputLatencyMs,
        error: null,
      });
    } catch (err) {
      set({ playing: false, error: errorMessage(err) });
      toast.error("The audio engine didn't answer", { description: errorMessage(err) });
    }
  }

  return {
    playing: false,
    tick: 0,
    at: 0,
    peak: 0,
    cpu: 0,
    meters: NO_METERS,
    metronome: false,
    latencyMs: 0,
    loop: { start: 0, ticks: 0 },
    startTick: 0,
    unreadable: [],
    channels: NO_CHANNELS,
    error: null,

    // From where the ruler was clicked, if that's inside what loops; the engine counts from the loop's start.
    play() {
      const { startTick, loop } = get();
      const from = startTick - loop.start;
      void run("play", { from: from > 0 && from < loop.ticks ? from : 0 });
    },
    stop: () => void run("stop", {}),
    toggle: () => (get().playing ? get().stop() : get().play()),
    setMetronome(on) {
      set({ metronome: on });
      void run("metronome", { on });
    },
    audition(channelId, pitch = 0) {
      void musicApi.engine("trigger", { channel: channelId, pitch }).catch(() => {});
    },
    preview(channelId, key, on, velocity) {
      void musicApi.engine("preview", { channel: channelId, key, on, velocity }).catch(() => {});
    },
    setStartTick: (tick) => set({ startTick: Math.max(0, Math.round(tick)) }),
    jumpTo(tick) {
      get().setStartTick(tick);
      if (get().playing) get().play();
    },
    showPlugin(channelId, open) {
      musicApi.engine("channelEditor", { channel: channelId, open }).then(
        (status) => set({ channels: status.channels }),
        (err) => toast.error("Couldn't open the plugin", { description: errorMessage(err) }),
      );
    },
  };
});

/**
 * Where a playing loop is now, in ticks: the engine's last word, moved on by the time since and held
 * back by the output's latency. Null when it isn't playing (or nothing of it has been heard yet).
 */
export function tickNow(state: Pick<TransportState, "playing" | "tick" | "at" | "latencyMs">, now: number, tempo: number, ppq: number, loopTicks: number): number | null {
  if (!state.playing || loopTicks <= 0) return null;
  const tick = state.tick + ((now - state.at - state.latencyMs) / 60_000) * tempo * ppq;
  if (tick < 0) return null;
  return tick % loopTicks;
}

/** Where the song is playing now in the pattern's own ticks (the loop may be only a part of it), or null. */
export function patternTickNow(state: Pick<TransportState, "playing" | "tick" | "at" | "latencyMs" | "loop">, now: number, tempo: number, ppq: number): number | null {
  const tick = tickNow(state, now, tempo, ppq, state.loop.ticks);
  return tick === null ? null : state.loop.start + tick;
}
