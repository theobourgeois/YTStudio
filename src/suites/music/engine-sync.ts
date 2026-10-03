import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import type { EngineKey, EngineStatus } from "@shared/music/engine";
import { musicApi } from "./api";
import { withChopPreview, withQuantizePreview } from "./piano/actions";
import { usePiano } from "./piano/store";
import { activeDraft, withDraftPattern } from "./patterns";
import { useMusicPreferences } from "./preferences";
import { clipPreview } from "./playlist/preview";
import { usePlaylist } from "./playlist/store";
import { armedIn, useRecording } from "./recording";
import { useInputs } from "./inputs";
import { startMidiSync, useMidi } from "./midi";
import { presetsChanged } from "./plugin-presets";
import { useMusic } from "./store";
import { takeAutoTunes } from "./auto-tune/pitch-history";
import { NO_CHANNELS, NO_ECHO_BOYS, NO_EFFECTS, NO_EQ, NO_GROSS_BEATS, NO_METERS, NO_OTTS, NO_PANMEN, NO_PRO_CS, afterSongSent, useTransport } from "./transport";
import { takePitchWheels } from "./pitch-wheel/live";
import { takeProCs } from "./pro-c/history";
import { currentTrackId, useMusicUi } from "./ui";
import { automateParameter } from "./automation/actions";
import { useMixerView } from "./mixer/view";
import { useAutomationUi } from "./automation/store";
import { takeReverbs } from "./reverb/live";

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
      const playMode = useTransport.getState().mode;
      if (stopped || !projectId || !history) break;
      try {
        // The time selection is what loops, while there is one: the Piano roll's in pattern mode, the
        // Playlist's in song mode. A draft pattern shown plays (empty), and the Chopper's chop is heard while it's open.
        const song = withQuantizePreview(withChopPreview(withDraftPattern(history.doc, activeDraft(history.doc, patternId, draftPattern))));
        const loop = playMode === "song" ? usePlaylist.getState().time : usePiano.getState().time;
        // A clip previewed from its menu: the song is only that clip, its time the loop.
        const preview = clipPreview(song);
        const { resampling } = useMusicPreferences.getState();
        // Controls the hand holds: their automation is left out until they're let go (song mode's alone has any).
        const held = playMode === "song" ? [...useAutomationUi.getState().held] : [];
        // The tracks armed to record: their inputs are heard (monitored while armed) and recorded.
        const armed = armedIn(song, useRecording.getState().armed);
        const { unreadable, channels, effects, loop: playing } = await musicApi.setSong(
          preview
            ? { projectId, patternId, resampling, ...preview }
            : { projectId, song, patternId, loop, mode: playMode, resampling, held, armed, listening: useMixerView.getState().listening },
        );
        useTransport.setState({ unreadable, channels, effects: effects ?? NO_EFFECTS, loop: playing, error: null });
        if (!dirty) afterSongSent();
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
  const unsubscribeMode = useTransport.subscribe((state, prev) => {
    if (state.mode !== prev.mode) void send();
  });
  const unsubscribeQuality = useMusicPreferences.subscribe((state, prev) => {
    if (state.resampling !== prev.resampling) void send();
  });
  const unsubscribeArmed = useRecording.subscribe((state, prev) => {
    if (state.armed !== prev.armed) void send();
  });
  const unsubscribeListening = useMixerView.subscribe((state, prev) => {
    if (state.listening !== prev.listening) void send();
  });
  const unsubscribeHeld = useAutomationUi.subscribe((state, prev) => {
    if (state.held !== prev.held && useTransport.getState().mode === "song") void send();
  });
  const unsubscribePlaylist = usePlaylist.subscribe((state, prev) => {
    if ((state.time !== prev.time && useTransport.getState().mode === "song") || state.previewing !== prev.previewing) void send();
  });
  const unsubscribeLoop = usePiano.subscribe((state, prev) => {
    if ((state.time !== prev.time && useTransport.getState().mode === "pattern") || state.chopping !== prev.chopping || state.quantizing !== prev.quantizing) void send();
    // What the Chopper and the Quantizer make changes with their settings, the selection and the snap (Line's grid follows the zoom).
    else if (
      (state.chopping || state.quantizing) &&
      (state.chopper !== prev.chopper || state.quantizer !== prev.quantizer || state.selected !== prev.selected || state.snap !== prev.snap || state.view.pxPerTick !== prev.view.pxPerTick || state.channelId !== prev.channelId)
    )
      void send();
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
  // The input device's channels, for the Input menus and audio tracks' headers.
  void useInputs.getState().load();
  // The channel MIDI keyboards play.
  const midi = startMidiSync();
  const stopListening = musicApi.onEngineEvent((event) => {
    if (event.event === "transport") {
      // Play stopped (by the engine, or another tab): a recording is over.
      useRecording.getState().transportSaid(event.playing);
      // Recording (past its count-in): each track's level, for the take drawn as it grows.
      if (event.playing && !(event.countIn ?? 0)) useRecording.getState().levels(event.recording?.levels ?? {}, event.tick);
      useTransport.setState({
        playing: event.playing,
        tick: event.tick,
        countIn: event.countIn ?? 0,
        at: performance.now(),
        peak: event.peak,
        meters: event.meters ?? NO_METERS,
        cpu: event.cpu,
        filePreview: event.preview ?? null,
        grossBeats: event.grossBeats ?? NO_GROSS_BEATS,
        echoBoys: event.echoBoys ?? NO_ECHO_BOYS,
        otts: event.otts ?? NO_OTTS,
        proCs: event.proCs ?? NO_PRO_CS,
        eq: event.eq ?? NO_EQ,
        panMen: event.panMen ?? NO_PANMEN,
      });
      // What each Auto-Tune heard: kept outside React, for its window's pitch graph.
      takeAutoTunes(event.autoTunes);
      // Where each Pitch Wheel's wheels are as they're heard: its window's rings.
      takePitchWheels(event.pitchWheels);
      // What each Pro-C did: its level display's points, kept outside React.
      takeProCs(event.proCs);
      // What each Reverb is doing: its meters and its tail's spectrum, likewise.
      takeReverbs(event.reverbs);
    } else if (event.event === "midi") {
      // Played on a MIDI keyboard (or the typing keyboard): lit, and kept while recording.
      useMidi.getState().played(event.notes);
      useRecording.getState().notesPlayed(event.notes);
    } else if (event.event === "preset") {
      // A plugin's preset changed (its window's arrows): what shows its presets asks again.
      presetsChanged(event.id);
    } else if (event.event === "wrapper") {
      // Its window's wrapper button: a channel's settings, or the mixer on the effect's track.
      const ui = useMusicUi.getState();
      if (event.owner === "channel") ui.openChannelWindow(event.id);
      else {
        const track = useMusic.getState().history?.doc.mixer.tracks.find((t) => t.effects.some((e) => e?.id === event.id));
        if (track) {
          ui.setMixerOpen(true);
          ui.selectTrack(track.id);
        }
      }
    } else if (event.event === "take") {
      useRecording.getState().take(event);
    } else if (event.event === "touch") {
      // A parameter touched in a plugin's window: what Automate offers first.
      const { event: _, ...parameter } = event;
      useAutomationUi.setState({ touched: parameter });
    } else if (event.event === "automate") {
      // The Automate button in a plugin window's title bar: an automation clip of what was touched there.
      const { event: _, ...parameter } = event;
      automateParameter(parameter);
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
    } else if (event.event === "ready" || event.event === "stopped") {
      // A restarted engine: the server gives it the song back, but it isn't playing any more.
      useRecording.getState().stopped();
      useTransport.setState({ playing: false, tick: 0 });
      meterSelection(true);
      midi.resend();
    }
  });
  void send();
  // What the engine is doing already (another tab may have it playing), and its latency.
  void musicApi
    .engine("status", {})
    .then((status) => {
      warnIfOutdated(status);
      useTransport.setState({
        playing: status.transport.playing,
        tick: status.transport.tick,
        countIn: status.transport.countIn ?? 0,
        at: performance.now(),
        metronome: status.transport.metronome,
        latencyMs: status.outputLatencyMs,
        sampleRate: status.sampleRate,
        error: null,
      });
    })
    .catch((err) => useTransport.setState({ error: errorMessage(err) }));

  return () => {
    stopped = true;
    unsubscribe();
    unsubscribeLoop();
    unsubscribePlaylist();
    unsubscribeMode();
    unsubscribeQuality();
    unsubscribeArmed();
    unsubscribeListening();
    unsubscribeHeld();
    unsubscribeSelection();
    midi.stop();
    stopListening();
    if (useTransport.getState().playing) void musicApi.engine("stop", {}).catch(() => {});
    // What's been turned in the plugins' own windows is kept.
    void musicApi.saveStates().catch(() => {});
    useTransport.setState({ playing: false, tick: 0, peak: 0, meters: NO_METERS, unreadable: [], channels: NO_CHANNELS, effects: NO_EFFECTS });
  };
}

/**
 * Say once when the engine was built before its source last changed (`EngineStatus.outdated`: a pull
 * without `pnpm engine:build`): what's new in the app that the engine does would quietly not happen.
 */
let warnedOutdated = false;
function warnIfOutdated(status: EngineStatus) {
  if (!status.outdated || warnedOutdated) return;
  warnedOutdated = true;
  toast.warning("The audio engine is out of date", {
    description: "It was built before its code last changed, so what's new may not work. Run `pnpm engine:build`, then restart `pnpm dev`.",
    duration: Infinity,
    id: "engine-outdated",
  });
}
