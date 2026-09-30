import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
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
  metronome: boolean;
  /** How long after the engine computes a sound it's heard: the playhead is shown that much late. */
  latencyMs: number;
  /** Channels whose sample the engine couldn't read. */
  unreadable: string[];
  /** Why the engine can't be reached (it isn't built, it won't start), or null. */
  error: string | null;

  play: () => void;
  stop: () => void;
  toggle: () => void;
  setMetronome: (on: boolean) => void;
  /** Hear a channel's sample once. */
  audition: (channelId: string, pitch?: number) => void;
}

export const useTransport = create<TransportState>((set, get) => {
  /** Run a transport command, and take what the engine says of itself from its answer. */
  async function run(command: "play" | "stop" | "metronome", body: { on: boolean } | Record<string, never>) {
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
    metronome: false,
    latencyMs: 0,
    unreadable: [],
    error: null,

    play: () => void run("play", {}),
    stop: () => void run("stop", {}),
    toggle: () => (get().playing ? get().stop() : get().play()),
    setMetronome(on) {
      set({ metronome: on });
      void run("metronome", { on });
    },
    audition(channelId, pitch = 0) {
      void musicApi.engine("trigger", { channel: channelId, pitch }).catch(() => {});
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
