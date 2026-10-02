import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import type { EngineTakeEvent, MidiPlayed } from "@shared/music/engine";
import { trackName, updateMixerTrack } from "@shared/music/mixer";
import { stepsPerBar } from "@shared/music/project";
import { type PlayedEvent, type Take, addRecordedNotes, addTakes, recordedNotes } from "@shared/music/recording";
import { type MixerInput, type MusicProject, PPQ, STEP_TICKS } from "@shared/music/types";
import { commit, undo } from "@/lib/document-history";
import { musicApi } from "./api";
import { midiTarget } from "./midi";
import { snapTicks } from "./piano/geometry";
import { usePiano } from "./piano/store";
import { countInBars, useMusicPreferences } from "./preferences";
import { useMusic } from "./store";
import { setRecorder, switchMode, useTransport } from "./transport";

/** A recording in progress, as the tab knows it. */
export interface ActiveRecording {
  id: string;
  /** Where it started, in the song's ticks. */
  startTick: number;
  /** The mixer tracks recording. */
  tracks: string[];
  /** Without Loop record it plays on past the loop's end; with it, every pass is a take. */
  loop: boolean;
  /** When the transport moves, after the count-in (`performance.now()`). */
  movesAt: number;
  /** The engine has said it's playing it (so its next "stopped" is this recording's end, not an older word). */
  confirmed: boolean;
  /** The loop's start, in the song's ticks: the engine's ticks count from it, and a loop's passes start there. */
  loopStart: number;
  /** The loop's length, in ticks. */
  loopTicks: number;
  /** The pattern shown when it started: notes played go into it (or a new one, `addRecordedNotes`). */
  patternId: string | null;
}

/**
 * A take as it's recorded, for the Playlist to draw as it grows: where it starts (the song's ticks), and
 * each track's input level as the engine says it, at the tick it said it (`ticks[i]`: the loudest since
 * `ticks[i - 1]`). A loop's next pass starts a new one, from the loop's start.
 */
export interface LivePass {
  from: number;
  ticks: number[];
  levels: number[];
}

/**
 * Recording, FL Studio's way (`docs/fl-studio/recording.md`): mixer tracks are armed (the tab's state,
 * not the song's: it isn't saved or undone), and while Record is on, Play records them (after the
 * count-in). The engine writes each armed track's input; each take that comes back (`take`) becomes an
 * audio clip where it was recorded (`addTakes`), all a recording's takes one undo step.
 */
interface RecordingState {
  /** The mixer tracks armed (only tracks with an input can be). */
  armed: string[];
  /** The transport's Record (R): Play records while it's on. */
  on: boolean;
  active: ActiveRecording | null;
  setOn: (on: boolean) => void;
  /** Arm or disarm a track (`armed` undefined: the other way round). A track with no input can't be armed. */
  arm: (trackId: string, armed?: boolean) => void;
  /** Play and record (what Play does while Record is on). */
  record: () => Promise<void>;
  /** Play stopped: the recording is over (its takes may still be on their way). */
  stopped: () => void;
  /** What the engine's transport events say: playing or not. */
  transportSaid: (playing: boolean) => void;
  /** A take has come back from the engine. */
  take: (event: EngineTakeEvent) => void;
  /** Counts the levels taken (`levels`), so what draws the takes as they grow knows to draw again. */
  liveVersion: number;
  /** The engine's word on each recording track's input level, at `tick` (the engine's, into its loop). */
  levels: (levels: Record<string, number[] | number>, tick: number) => void;
  /** Notes played on a MIDI keyboard (the engine's `midi` event): kept while recording, made notes when it stops. */
  notesPlayed: (notes: readonly MidiPlayed[]) => void;
}

/** Each recording's loop start (the engine's ticks count from it), for takes that come after it stopped. */
const recordings = new Map<string, { loopStart: number; projectId: string }>();
/** The last takes committed, to make the next of the same recording the same undo step. */
let lastTakes: { recordingId: string; takes: Take[]; doc: MusicProject } | null = null;
/** Each recording's final takes come in one per track: who's waiting for them (`takesOf`). */
const waiting = new Map<string, { tracks: number; finals: number; done: (takes: Take[]) => void }>();
/** Every take placed, by recording (for `takesOf`). */
const placed = new Map<string, Take[]>();

/** The takes being recorded, by mixer track: what the Playlist draws until each one's file is in. */
const live = new Map<string, LivePass>();
/** Notes played in the recording in progress, and where the engine last said it was (its tick, and passes round the loop). */
let played: PlayedEvent[] = [];
let position = { tick: 0, pass: 0 };
/** Takes still drawn after play stopped are let go of this long after, if their files never come. */
const LIVE_LINGER_MS = 15_000;
let lingering: ReturnType<typeof setTimeout> | undefined;

/** The takes being recorded (or stopped, their files not in yet), by mixer track. */
export const liveTakes = (): ReadonlyMap<string, LivePass> => live;

/** A bar of the song, in ticks. */
const barTicks = (song: MusicProject) => stepsPerBar(song.settings.timeSignature) * STEP_TICKS;

export const useRecording = create<RecordingState>((set, get) => ({
  armed: [],
  on: false,
  active: null,
  liveVersion: 0,

  levels(levels, tick) {
    const { active } = get();
    if (!active) return;
    // Gone round the loop: another pass (where notes still held when it stops end).
    position = { tick, pass: position.pass + (tick < position.tick && active.loop ? 1 : 0) };
    const at = active.loopStart + tick;
    // Every recording track grows with the playhead, whether or not the engine said its level (an
    // engine built before it did says none: the take is drawn flat).
    for (const track of active.tracks) {
      let pass = live.get(track);
      // Gone round the loop: the next pass, from its start (the last one's file comes as a take).
      const last = pass?.ticks.at(-1);
      if (!pass || (last !== undefined && at < last)) live.set(track, (pass = { from: pass ? active.loopStart : active.startTick, ticks: [], levels: [] }));
      // Its peaks since the last word, spread evenly up to here (none said: it grows, flat).
      const said = levels[track];
      const peaks = Array.isArray(said) ? (said.length ? said : [0]) : [said ?? 0];
      const before = pass.ticks.at(-1) ?? pass.from;
      peaks.forEach((peak, i) => {
        pass.ticks.push(before + ((at - before) * (i + 1)) / peaks.length);
        pass.levels.push(Math.min(1, peak));
      });
    }
    set({ liveVersion: get().liveVersion + 1 });
  },

  notesPlayed(notes) {
    if (!get().active) return;
    for (const note of notes) if (note.channel && note.tick !== null) played.push({ channel: note.channel, key: note.key, velocity: note.velocity, on: note.on, tick: note.tick, counting: note.counting, pass: note.pass });
  },

  setOn: (on) => set({ on }),

  arm(trackId, armed) {
    const song = useMusic.getState().history?.doc;
    const track = song?.mixer.tracks.find((t) => t.id === trackId);
    if (!song || !track) return;
    const now = get().armed.includes(trackId);
    const want = armed ?? !now;
    if (want === now) return;
    if (want && !track.input) {
      toast.info("Choose its input first", { description: "A track records the input it takes: pick one under Input in the Mixer's inspector (F9)." });
      return;
    }
    set({ armed: want ? [...get().armed, trackId] : get().armed.filter((id) => id !== trackId) });
  },

  async record() {
    const transport = useTransport.getState();
    if (transport.exporting) return void toast.info("Exporting", { description: "Recording comes back as soon as the export is done.", id: "exporting" });
    const { projectId, history } = useMusic.getState();
    if (!projectId || !history) return;
    const song = history.doc;
    const tracks = get().armed.filter((id) => song.mixer.tracks.some((t) => t.id === id && t.input));
    // Notes are recorded on the selected channel; with no track armed, they're all that is.
    if (!tracks.length && !midiTarget(song)) {
      toast.info("Nothing to record", {
        description: "Select a channel in the rack to record notes on it, or choose a mixer track's input in the Mixer (F9): that arms it, and Play then records it.",
      });
      return;
    }
    // Recording is the song's: in pattern mode it switches, and records once the engine has the song.
    if (transport.mode !== "song") return switchMode("song", true);
    const { loop, pausedAt } = transport;
    const at = (pausedAt ?? transport.startOf()) - loop.start;
    const from = at > 0 && at < loop.ticks ? at : 0;
    const options = useMusicPreferences.getState().recording;
    const countIn = countInBars(options) * barTicks(song);
    const names = Object.fromEntries(tracks.map((id) => [id, trackName(song, id)]));
    useTransport.setState({ pausedAt: null });
    try {
      const { recordingId, status } = await musicApi.record({ projectId, from, countIn, loop: options.loop, names, notes: true });
      recordings.set(recordingId, { loopStart: loop.start, projectId });
      const msPerTick = 60_000 / (song.settings.tempo * PPQ);
      live.clear();
      clearTimeout(lingering);
      played = [];
      position = { tick: from, pass: 0 };
      set({
        active: {
          id: recordingId,
          startTick: loop.start + from,
          tracks,
          loop: options.loop,
          movesAt: performance.now() + countIn * msPerTick,
          confirmed: false,
          loopStart: loop.start,
          loopTicks: loop.ticks,
          patternId: useMusic.getState().patternId,
        },
      });
      // The engine may not have taken the play yet: it's playing from here, after the whole count-in.
      useTransport.setState({ playing: true, tick: status.transport.playing ? status.transport.tick : from, countIn: status.transport.countIn || (countIn * msPerTick) / 1000, at: performance.now(), through: !options.loop, error: null });
    } catch (err) {
      toast.error("Couldn't record", { description: errorMessage(err) });
    }
  },

  stopped() {
    const { active } = get();
    if (!active) return;
    keepNotes(active);
    // What's drawn of the takes stays until their files are in (a take that never comes is let go of).
    clearTimeout(lingering);
    lingering = setTimeout(() => {
      live.clear();
      set({ liveVersion: get().liveVersion + 1 });
    }, LIVE_LINGER_MS);
    set({ active: null, ...(useMusicPreferences.getState().recording.disarmOnStop && { on: false }) });
    useTransport.setState({ through: false });
  },

  transportSaid(playing) {
    const { active } = get();
    if (!active) return;
    if (playing && !active.confirmed) set({ active: { ...active, confirmed: true } });
    else if (!playing && active.confirmed) get().stopped();
  },

  take(event) {
    const { projectId, history } = useMusic.getState();
    const meta = recordings.get(event.recordingId);
    if (event.final) {
      recordings.delete(event.recordingId);
      // Its file is in: the clip takes the place of what was drawn as it grew.
      if (live.delete(event.track)) set({ liveVersion: get().liveVersion + 1 });
    }
    // Another song's (switched away from while it recorded): its media is kept there, but nothing places it.
    if (!history || event.projectId !== projectId) return;
    if (!event.media) return void toast.error("Couldn't keep a take", { description: event.error });
    if (event.error) toast.warning("A take may be incomplete", { description: event.error });
    const media = event.media;
    useMusic.setState({ assets: [...useMusic.getState().assets.filter((a) => a.id !== media.id), media] });
    const take: Take = {
      track: event.track,
      sampleId: media.id,
      seconds: event.frames / event.sampleRate,
      startTick: (meta?.loopStart ?? 0) + event.startTick,
      skip: event.skip,
      sampleRate: event.sampleRate,
      pass: event.pass,
      final: event.final,
    };
    const { blend } = useMusicPreferences.getState().recording;
    // The recording's earlier takes, taken back and made again with this one: one undo step for it all.
    const same = lastTakes?.recordingId === event.recordingId && lastTakes.doc === history.doc && history.gestureBase === null;
    const takes = same ? [...lastTakes!.takes, take] : [take];
    const next = commit(same ? undo(history) : history, (song) => addTakes(song, takes, { blend }).song);
    if (next === history) return;
    useMusic.setState({ history: next });
    lastTakes = { recordingId: event.recordingId, takes, doc: next.doc };
    placed.set(event.recordingId, [...(placed.get(event.recordingId) ?? []), take]);
    const wait = waiting.get(event.recordingId);
    if (wait && event.final && ++wait.finals >= wait.tracks) wait.done(placed.get(event.recordingId) ?? []);
  },
}));

// While Record is on, the transport's Play records; Stop ends a recording.
setRecorder({
  recordsOnPlay: () => useRecording.getState().on,
  record: () => void useRecording.getState().record(),
  stopped: () => useRecording.getState().stopped(),
  recording: () => useRecording.getState().active !== null,
});

// Another song: nothing of the last one is armed.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) {
    live.clear();
    useRecording.setState({ armed: [], active: null });
    lastTakes = null;
  }
});

/**
 * The notes played in a recording, into the song (one undo step): quantized as Record's menu says on the
 * Piano roll's snap (Line, Cell and none leave them as played, as FL's global snap does), then into a
 * pattern placed where recording started (`addRecordedNotes`), which is then the one shown.
 */
function keepNotes(active: ActiveRecording) {
  const events = played;
  played = [];
  keptNotes.delete(active.id);
  const { history, patternId } = useMusic.getState();
  if (!events.length || !history) return;
  const song = history.doc;
  const { tempo } = song.settings;
  const { latencyMs } = useTransport.getState();
  const piano = usePiano.getState();
  const bar = barTicks(song);
  const grid = piano.snap === "line" || piano.snap === "cell" || piano.snap === "none" ? 0 : snapTicks(piano.snap, piano.view.pxPerTick, bar);
  const notes = recordedNotes(events, {
    loopStart: active.loopStart,
    loopTicks: active.loopTicks,
    through: !active.loop,
    startTick: active.startTick,
    latencyTicks: (latencyMs / 60_000) * tempo * PPQ,
    stop: position,
    quantize: useMusicPreferences.getState().recording.quantize,
    grid,
  });
  const at = { patternId: active.patternId ?? patternId ?? song.patterns[0].id, startTick: active.startTick };
  let into: string | null = null;
  useMusic.getState().commit((doc) => {
    const result = addRecordedNotes(doc, notes, at);
    into = result.patternId;
    return result.song;
  });
  if (into) {
    useMusic.setState({ patternId: into });
    keptNotes.set(active.id, { patternId: into, count: notes.length });
  }
}

/** The notes each recording put into the song (the assistant's record_audio says so on stop). */
const keptNotes = new Map<string, { patternId: string; count: number }>();
export const notesKept = (recordingId: string) => keptNotes.get(recordingId) ?? null;

/** The tracks armed in the song now (a track removed, or whose input was taken away, isn't). */
export function armedIn(song: MusicProject, armed: readonly string[]): string[] {
  return armed.filter((id) => song.mixer.tracks.some((t) => t.id === id && t.input));
}

/**
 * Give a mixer track an input (or none): as in FL Studio, choosing one arms the track, and none
 * disarms it.
 */
export function setTrackInput(trackId: string, input: MixerInput | null) {
  useMusic.getState().commit((song) => updateMixerTrack(song, trackId, { input }));
  useRecording.getState().arm(trackId, input !== null);
}

/**
 * The takes of a recording once its last ones are in (one final take per track it recorded), or what's
 * come by `timeoutMs` (the assistant's record_audio, answering on stop).
 */
export function takesOf(recordingId: string, tracks: number, timeoutMs = 5000): Promise<Take[]> {
  return new Promise((resolve) => {
    const done = (takes: Take[]) => {
      clearTimeout(timer);
      waiting.delete(recordingId);
      resolve(takes);
    };
    const finals = (placed.get(recordingId) ?? []).filter((t) => t.final).length;
    if (finals >= tracks) return resolve(placed.get(recordingId) ?? []);
    const timer = setTimeout(() => done(placed.get(recordingId) ?? []), timeoutMs);
    waiting.set(recordingId, { tracks, finals, done });
  });
}
