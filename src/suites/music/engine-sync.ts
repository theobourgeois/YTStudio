import { errorMessage } from "@shared/errors";
import type { EngineKey } from "@shared/music/engine";
import { musicApi } from "./api";
import { usePiano } from "./piano/store";
import { activeDraft, withDraftPattern } from "./patterns";
import { useMusic } from "./store";
import { NO_CHANNELS, NO_EFFECTS, NO_METERS, useTransport } from "./transport";
import { currentTrackId, useMusicUi } from "./ui";

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
        const { unreadable, channels, effects, loop } = await musicApi.setSong({ projectId, song: withDraftPattern(history.doc, activeDraft(history.doc, patternId, draftPattern)), patternId, loop: usePiano.getState().time });
        useTransport.setState({ unreadable, channels, effects: effects ?? NO_EFFECTS, loop, error: null });
        // A plugin that finished loading while this answer was on its way said so first: ask again, so the
        // answer's "loading" doesn't stand.
        if (channels.loading.length || effects?.loading.length) {
          void musicApi.engine("status", {}).then((status) => !stopped && useTransport.setState({ channels: status.channels, effects: status.effects ?? NO_EFFECTS }), () => {});
        }
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
  // The mixer's selection meter adds up the selected tracks (or the one its inspector shows).
  let metered = "";
  const meterSelection = (force = false) => {
    const doc = useMusic.getState().history?.doc;
    if (!doc) return;
    const ids = useMusicUi.getState().selectedTrackIds.filter((id) => doc.mixer.tracks.some((t) => t.id === id));
    const tracks = ids.length ? ids : [currentTrackId(doc, [])];
    const key = tracks.join();
    if (key === metered && !force) return;
    metered = key;
    void musicApi.engine("meterTracks", { tracks }).catch(() => {});
  };
  const unsubscribeSelection = useMusicUi.subscribe((state, prev) => {
    if (state.selectedTrackIds !== prev.selectedTrackIds) meterSelection();
  });
  meterSelection(true);
  const stopListening = musicApi.onEngineEvent((event) => {
    if (event.event === "transport") {
      useTransport.setState({
        playing: event.playing,
        tick: event.tick,
        at: performance.now(),
        peak: event.peak,
        meters: event.meters ?? NO_METERS,
        cpu: event.cpu,
        filePreview: event.preview ?? null,
      });
    } else if (event.event === "key") {
      // Pressed in a plugin's window, which the plugin didn't use: the editor's shortcut runs.
      const { event: _, ...key } = event;
      onKey(key);
    } else if (event.event === "status") {
      // Its status changed on its own: a plugin finished loading, or its window was closed by hand.
      useTransport.setState({
        latencyMs: event.status.outputLatencyMs,
        sampleRate: event.status.sampleRate,
        metronome: event.status.transport.metronome,
        channels: event.status.channels,
        effects: event.status.effects ?? NO_EFFECTS,
      });
    } else {
      // A restarted engine: the server gives it the song back, but it isn't playing any more.
      useTransport.setState({ playing: false, tick: 0 });
      meterSelection(true);
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
        sampleRate: status.sampleRate,
        error: null,
      }),
    )
    .catch((err) => useTransport.setState({ error: errorMessage(err) }));

  return () => {
    stopped = true;
    unsubscribe();
    unsubscribeLoop();
    unsubscribeSelection();
    stopListening();
    if (useTransport.getState().playing) void musicApi.engine("stop", {}).catch(() => {});
    // What's been turned in the plugins' own windows is kept.
    void musicApi.saveStates().catch(() => {});
    useTransport.setState({ playing: false, tick: 0, peak: 0, meters: NO_METERS, unreadable: [], channels: NO_CHANNELS, effects: NO_EFFECTS });
  };
}
