import { errorMessage } from "@shared/errors";
import type { EngineKey } from "@shared/music/engine";
import { musicApi } from "./api";
import { usePiano } from "./piano/store";
import { activeDraft, withDraftPattern } from "./patterns";
import { useMusic } from "./store";
import { NO_CHANNELS, NO_METERS, useTransport } from "./transport";

/**
 * Keeps the audio engine playing the open song: every change of the document (even mid-drag, so a
 * knob is heard as it turns) or of the pattern shown is sent, one request at a time, the latest
 * winning. And the engine's own events feed the transport store, and keys pressed in plugin windows go
 * to `onKey`. Returns how to stop (which also stops the song).
 */
export function startEngineSync({ onKey }: { onKey: (key: EngineKey) => void }): () => void {
  let stopped = false;
  let sending = false;
  let dirty = false;

  async function send() {
    if (sending) {
      dirty = true;
      return;
    }
    sending = true;
    do {
      dirty = false;
      const { projectId, history, patternId, draftPattern } = useMusic.getState();
      if (stopped || !projectId || !history) break;
      try {
        // The Piano roll's time selection is what loops, while there is one. A draft pattern shown plays (empty).
        const { unreadable, channels, loop } = await musicApi.setSong({ projectId, song: withDraftPattern(history.doc, activeDraft(history.doc, patternId, draftPattern)), patternId, loop: usePiano.getState().time });
        useTransport.setState({ unreadable, channels, loop, error: null });
      } catch (err) {
        useTransport.setState({ error: errorMessage(err) });
        break;
      }
    } while (dirty);
    sending = false;
  }

  const unsubscribe = useMusic.subscribe((state, prev) => {
    if (state.history?.doc !== prev.history?.doc || state.patternId !== prev.patternId || state.projectId !== prev.projectId) void send();
  });
  const unsubscribeLoop = usePiano.subscribe((state, prev) => {
    if (state.time !== prev.time) void send();
  });
  const stopListening = musicApi.onEngineEvent((event) => {
    if (event.event === "transport") {
      useTransport.setState({ playing: event.playing, tick: event.tick, at: performance.now(), peak: event.peak, meters: event.meters ?? NO_METERS, cpu: event.cpu });
    } else if (event.event === "key") {
      // Pressed in a plugin's window, which the plugin didn't use: the editor's shortcut runs.
      const { event: _, ...key } = event;
      onKey(key);
    } else if (event.event === "status") {
      // Its status changed on its own: a plugin finished loading, or its window was closed by hand.
      useTransport.setState({ latencyMs: event.status.outputLatencyMs, metronome: event.status.transport.metronome, channels: event.status.channels });
    } else {
      // A restarted engine: the server gives it the song back, but it isn't playing any more.
      useTransport.setState({ playing: false, tick: 0 });
    }
  });
  void send();
  // What the engine is doing already (another tab may have it playing), and its latency.
  void musicApi
    .engine("status", {})
    .then((status) =>
      useTransport.setState({
        playing: status.transport.playing,
        tick: status.transport.tick,
        at: performance.now(),
        metronome: status.transport.metronome,
        latencyMs: status.outputLatencyMs,
        error: null,
      }),
    )
    .catch((err) => useTransport.setState({ error: errorMessage(err) }));

  return () => {
    stopped = true;
    unsubscribe();
    unsubscribeLoop();
    stopListening();
    if (useTransport.getState().playing) void musicApi.engine("stop", {}).catch(() => {});
    // What's been turned in the plugins' own windows is kept.
    void musicApi.saveStates().catch(() => {});
    useTransport.setState({ playing: false, tick: 0, peak: 0, meters: NO_METERS, unreadable: [], channels: NO_CHANNELS });
  };
}
