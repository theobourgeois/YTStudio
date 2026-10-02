import { create } from "zustand";
import type { PlayMode } from "@shared/music/compile";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import type { EngineChannels, EngineCommands, EngineEchoLevels, EngineEffects, EngineEqState, EngineGrossState, EngineMeters, EngineOttState, EnginePanState, EnginePreview, MetronomeSound } from "@shared/music/engine";
import { musicApi } from "./api";
import { useMusicPreferences } from "./preferences";

/**
 * What the audio engine is doing, as it tells us (`engine-sync.ts` feeds this from its event
 * stream): whether the song plays and where it is, the output's level, the engine's load. It changes
 * many times a second, so it's kept apart from the song's store, and components read narrow parts.
 */
interface TransportState {
  playing: boolean;
  /**
   * A song is being exported: the engine plays nothing else meanwhile (its plugins are the export's), so
   * play does nothing. Edits go on; the engine plays the latest once it's done.
   */
  exporting: boolean;
  /** Where the loop was (ticks) at `at` (`performance.now()`): the position now is worked out from these. */
  tick: number;
  at: number;
  /** Seconds of a recording's count-in left at `at`: the position holds at `tick` until it's over. */
  countIn: number;
  /** The output's level (0..1+) and the audio thread's load (0..1). */
  peak: number;
  cpu: number;
  /** Each mixer track's loudest level since the engine last said (at `at`); silent tracks are absent. */
  meters: EngineMeters;
  metronome: boolean;
  /** How long after the engine computes a sound it's heard: the playhead is shown that much late. */
  latencyMs: number;
  /** The engine's sample rate (plugins' delays are in samples). */
  sampleRate: number;
  /** What the engine loops, in the pattern's ticks: the whole pattern, or the Piano roll's time selection. */
  loop: { start: number; ticks: number };
  /** Playing on past the loop's end (a recording without Loop record): the position doesn't go round. */
  through: boolean;
  /** Where in the pattern play starts (a click on the Piano roll's ruler), in ticks. */
  startTick: number;
  /** Where in the song play starts in song mode (a click on the Playlist's ruler), in ticks. */
  songStartTick: number;
  /**
   * Where play was paused (the Play button pressed while playing), in the mode's ticks: the next play
   * goes on from there; Stop, a jump or the other mode forget it. Null when it isn't paused.
   */
  pausedAt: number | null;
  /**
   * What play plays (the toolbar's PAT / SONG): the pattern shown, looped, or the playlist. Not saved: a
   * song with clips on its playlist opens in song mode (Théo).
   */
  mode: PlayMode;
  /** Channels whose sample the engine couldn't read. */
  unreadable: string[];
  /** The song's plugin channels as the engine has them: loaded (and whose window is open), loading, failed. */
  channels: EngineChannels;
  /** The mixer's effects as the engine has them: loaded (and whose window is open), loading, failed. */
  effects: EngineEffects;
  /** The Browser's preview as the engine last said (at `at`), or null. */
  filePreview: EnginePreview | null;
  /** Each Gross Beat's slots playing and where its envelopes are, as the engine last said (by effect id). */
  grossBeats: Record<string, EngineGrossState>;
  /** Each EchoBoy's levels in and out (its LEDs), as the engine last said (by effect id). */
  echoBoys: Record<string, EngineEchoLevels>;
  /** Each OTT's bands' levels and gains, as the engine last said (by effect id). */
  otts: Record<string, EngineOttState>;
  /** Each watched Pro-Q's spectra and dynamic bands, as the engine last said (by effect id). */
  eq: Record<string, EngineEqState>;
  /** Each PanMan's position and levels, as the engine last said (by effect id). */
  panMen: Record<string, EnginePanState>;
  /** Why the engine can't be reached (it isn't built, it won't start), or null. */
  error: string | null;

  play: () => void;
  stop: () => void;
  toggle: () => void;
  /** Stop where it is (`tick`, where it's playing now in the mode's ticks), to go on from there. */
  pause: (tick: number) => void;
  /** The metronome on or off, in `sound` (the toolbar's preference). */
  setMetronome: (on: boolean, sound: MetronomeSound) => void;
  /** The metronome's sound: heard once at once, and on the beats while it's on. */
  setMetronomeSound: (sound: MetronomeSound) => void;
  /** Hear a channel's sample once. */
  audition: (channelId: string, pitch?: number) => void;
  /** Show or close the window of a plugin channel's plugin. */
  showPlugin: (channelId: string, open: boolean) => void;
  /** Show or close the window of an effect in the mixer. */
  showEffect: (effectId: string, open: boolean) => void;
  /** Hold a key on a channel, or let it go (the Piano roll's keyboard, a note being drawn). `key` is a MIDI note. */
  preview: (channelId: string, key: number, on: boolean, velocity?: number) => void;
  setStartTick: (tick: number) => void;
  /** Set where play starts in the pattern, and if it's playing, go there now. In song mode, it switches to pattern mode. */
  jumpTo: (tick: number) => void;
  setSongStartTick: (tick: number) => void;
  /** Set where play starts in the song, and if it's playing, go there now. In pattern mode, it switches to song mode. */
  jumpSongTo: (tick: number) => void;
  /** Where play starts in the mode playing. */
  startOf: () => number;
  setMode: (mode: PlayMode) => void;
}

/**
 * Recording's part in the transport (`recording.ts` gives it, so the transport needn't import the song's
 * store): whether Play records, starting a recording, being told play stopped, and whether one is going.
 */
export interface Recorder {
  recordsOnPlay: () => boolean;
  record: () => void;
  stopped: () => void;
  recording: () => boolean;
}
let recorder: Recorder | null = null;
export const setRecorder = (hook: Recorder) => {
  recorder = hook;
};

export const NO_CHANNELS: EngineChannels = { loaded: [], loading: [], failed: [] };
export const NO_METERS: EngineMeters = {};
export const NO_EFFECTS: EngineEffects = { loaded: [], loading: [], failed: [] };
export const NO_GROSS_BEATS: Record<string, EngineGrossState> = {};
export const NO_ECHO_BOYS: Record<string, EngineEchoLevels> = {};
export const NO_OTTS: Record<string, EngineOttState> = {};
export const NO_EQ: Record<string, EngineEqState> = {};
export const NO_PANMEN: Record<string, EnginePanState> = {};

export const useTransport = create<TransportState>((set, get) => {
  /** Run a transport command, and take what the engine says of itself from its answer. */
  async function run(command: "play" | "stop" | "metronome", body: EngineCommands["metronome"] | EngineCommands["stop"] | { from?: number }) {
    try {
      const status = await musicApi.engine(command, body as never);
      set({
        playing: status.transport.playing,
        tick: status.transport.tick,
        countIn: status.transport.countIn ?? 0,
        at: performance.now(),
        metronome: status.transport.metronome,
        latencyMs: status.outputLatencyMs,
        sampleRate: status.sampleRate,
        grossBeats: status.transport.grossBeats ?? NO_GROSS_BEATS,
        echoBoys: status.transport.echoBoys ?? NO_ECHO_BOYS,
        otts: status.transport.otts ?? NO_OTTS,
        panMen: status.transport.panMen ?? NO_PANMEN,
        error: null,
      });
    } catch (err) {
      set({ playing: false, error: errorMessage(err) });
      toast.error("The audio engine didn't answer", { description: errorMessage(err) });
    }
  }

  return {
    playing: false,
    exporting: false,
    tick: 0,
    at: 0,
    countIn: 0,
    peak: 0,
    cpu: 0,
    meters: NO_METERS,
    metronome: false,
    latencyMs: 0,
    sampleRate: 48000,
    loop: { start: 0, ticks: 0 },
    through: false,
    startTick: 0,
    songStartTick: 0,
    pausedAt: null,
    mode: "pattern" as PlayMode,
    unreadable: [],
    channels: NO_CHANNELS,
    effects: NO_EFFECTS,
    grossBeats: NO_GROSS_BEATS,
    echoBoys: NO_ECHO_BOYS,
    otts: NO_OTTS,
    eq: NO_EQ,
    panMen: NO_PANMEN,
    filePreview: null,
    error: null,

    // From where the ruler was clicked, if that's inside what loops; the engine counts from the loop's start.
    // While Record is on, Play records.
    play() {
      if (recorder?.recordsOnPlay()) return recorder.record();
      if (get().exporting) return void toast.info("Exporting", { description: "Playback comes back as soon as the export is done.", id: "exporting" });
      const { loop, pausedAt } = get();
      const from = (pausedAt ?? get().startOf()) - loop.start;
      set({ pausedAt: null });
      void run("play", { from: from > 0 && from < loop.ticks ? from : 0 });
    },
    // Pressed while stopped (FL's second press of Stop), or always with Settings' "Reset plugins on stop":
    // the effects' tails stop too.
    stop() {
      const reset = !get().playing || useMusicPreferences.getState().resetOnStop;
      set({ pausedAt: null });
      recorder?.stopped();
      void run("stop", reset ? { reset: true } : {});
    },
    pause(tick) {
      set({ pausedAt: Math.max(0, Math.round(tick)) });
      recorder?.stopped();
      void run("stop", {});
    },
    toggle: () => (get().playing ? get().stop() : get().play()),
    setMetronome(on, sound) {
      set({ metronome: on });
      void run("metronome", { on, sound });
    },
    setMetronomeSound: (sound) => void run("metronome", { on: get().metronome, sound, audition: true }),
    audition(channelId, pitch = 0) {
      void musicApi.engine("trigger", { channel: channelId, pitch }).catch(() => {});
    },
    preview(channelId, key, on, velocity) {
      void musicApi.engine("preview", { channel: channelId, key, on, velocity }).catch(() => {});
    },
    setStartTick: (tick) => set({ startTick: Math.max(0, Math.round(tick)), pausedAt: null }),
    jumpTo(tick) {
      get().setStartTick(tick);
      // (Not while recording: play goes on, the next one starts there.)
      if (recorder?.recording()) return;
      if (get().mode !== "pattern") return switchMode("pattern");
      if (get().playing) get().play();
    },
    setSongStartTick: (tick) => set({ songStartTick: Math.max(0, Math.round(tick)), pausedAt: null }),
    jumpSongTo(tick) {
      get().setSongStartTick(tick);
      if (recorder?.recording()) return;
      if (get().mode !== "song") return switchMode("song");
      if (get().playing) get().play();
    },
    startOf: () => (get().mode === "song" ? get().songStartTick : get().startTick),
    setMode: (mode) => get().mode !== mode && set({ mode, pausedAt: null }),
    showPlugin(channelId, open) {
      musicApi.engine("channelEditor", { channel: channelId, open }).then(
        (status) => set({ channels: status.channels }),
        (err) => toast.error("Couldn't open the plugin", { description: errorMessage(err) }),
      );
    },
    showEffect(effectId, open) {
      musicApi.engine("effectEditor", { effect: effectId, open }).then(
        (status) => set({ effects: status.effects }),
        (err) => toast.error("Couldn't open the effect", { description: errorMessage(err) }),
      );
    },
  };
});

/** How long a new plugin channel's window waits for its plugin to load before giving up (ms). */
const SHOW_WHEN_LOADED_MS = 120_000;

/**
 * Show a plugin channel's window once the engine has loaded its plugin (a new channel's loads in the
 * background, and its window can't show before), as FL Studio opens a synth it's just added. Gives up
 * if it fails to load, or takes too long.
 */
export function showPluginWhenLoaded(channelId: string) {
  const ready = (channels: EngineChannels) => {
    if (channels.loaded.some((c) => c.channel === channelId)) {
      useTransport.getState().showPlugin(channelId, true);
      return true;
    }
    return channels.failed.some((c) => c.channel === channelId);
  };
  if (ready(useTransport.getState().channels)) return;
  const stop = () => {
    unsubscribe();
    clearTimeout(timeout);
  };
  const unsubscribe = useTransport.subscribe((state, before) => state.channels !== before.channels && ready(state.channels) && stop());
  const timeout = setTimeout(stop, SHOW_WHEN_LOADED_MS);
}

/**
 * Switch between pattern and song mode (the toolbar's PAT / SONG, L). Playing, it goes on in the other mode
 * from where play starts there, once the engine has the song for it (`engine-sync.ts` sends it, then plays).
 */
export function switchMode(mode: PlayMode, thenPlay = false) {
  const transport = useTransport.getState();
  if (transport.mode === mode) {
    if (thenPlay) transport.play();
    return;
  }
  pendingRestart = transport.playing || thenPlay;
  transport.setMode(mode);
}

/** Set when the mode changes while playing: play starts again once the engine has the new song. */
let pendingRestart = false;
/** Set when a clip's preview starts: it plays from its start once the engine has it. */
let pendingPreview = false;

/** Play what's sent next from the start of its loop, once the engine has it (a clip's preview). */
export function playWhenSent() {
  pendingPreview = true;
}

/** Called by `engine-sync.ts` once the engine has the song for the mode: a switch made while playing carries on. */
export function afterSongSent() {
  // Nothing plays while a song is exported (the engine refuses).
  if (useTransport.getState().exporting) {
    pendingPreview = pendingRestart = false;
    return;
  }
  if (pendingPreview) {
    pendingPreview = false;
    void musicApi.engine("play", { from: 0 }).then(
      (status) => useTransport.setState({ playing: status.transport.playing, tick: status.transport.tick, countIn: status.transport.countIn ?? 0, at: performance.now() }),
      () => {},
    );
    return;
  }
  if (!pendingRestart) return;
  pendingRestart = false;
  useTransport.getState().play();
}

/** A clip's preview let go before it began: it doesn't start after all. */
export const cancelPlayWhenSent = () => (pendingPreview = false);

/**
 * Where a playing loop is now, in ticks: the engine's last word, moved on by the time since and held
 * back by the output's latency. Null when it isn't playing (or nothing of it has been heard yet).
 */
export function tickNow(
  state: Pick<TransportState, "playing" | "tick" | "at" | "latencyMs"> & { through?: boolean; countIn?: number },
  now: number,
  tempo: number,
  ppq: number,
  loopTicks: number,
): number | null {
  if (!state.playing || loopTicks <= 0) return null;
  // A count-in holds the position where play starts until it's over (then it moves on from there).
  const moving = now - state.at - state.latencyMs - (state.countIn ?? 0) * 1000;
  const tick = state.tick + (Math.max(0, moving) / 60_000) * tempo * ppq;
  if (tick < 0) return null;
  // Recording past the loop's end, it doesn't go round.
  return state.through ? tick : tick % loopTicks;
}

/** Where it's playing now in the pattern's own ticks, or the song's in song mode (the loop may be only a part of it), or null. */
export function patternTickNow(state: Pick<TransportState, "playing" | "tick" | "at" | "latencyMs" | "loop"> & { through?: boolean; countIn?: number }, now: number, tempo: number, ppq: number): number | null {
  const tick = tickNow(state, now, tempo, ppq, state.loop.ticks);
  return tick === null ? null : state.loop.start + tick;
}
