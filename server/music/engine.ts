/**
 * The audio engine's process (`engine/`): started on the first command, asked one JSON line at a time
 * (`shared/music/engine.ts`), and started again if it dies (a plugin can take it down; the app stays up).
 * It quits when its stdin closes, so it never outlives the server.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { clamp, isFiniteNumber } from "../../shared/math.ts";
import { type PlayMode, compileSong, levelGain } from "../../shared/music/compile.ts";
import { GROSS_DEPTH } from "../../shared/music/gross-beat-presets.ts";
import {
  ENGINE_SLOTS,
  type EngineCommand,
  type EngineDevices,
  type EngineExportDone,
  type EngineEvent,
  type EngineParameter,
  type EnginePlugin,
  type EngineRender,
  type EngineSlot,
  type EngineStatus,
  type EngineTakeEvent,
  type HostWindow,
  type LoadedPlugin,
  METRONOME_SOUNDS,
  type PluginPresets,
  type Resampling,
  type SetSongResponse,
  isMetronomeSound,
  isResampling,
} from "../../shared/music/engine.ts";
import { DEFAULT_VELOCITY, normalizeMusicProject } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import type { MediaAsset } from "../../shared/types.ts";
import { createId } from "../../shared/ids.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS, ENGINE_SOURCE } from "../config.ts";
import { spawnStreaming } from "../process.ts";
import { type DataPaths, HttpError, isObject, isValidId, readJson, writeJson } from "../storage.ts";

/** What `renderExport` renders: a song as `SetSongRequest` has it, and where the files go and what they are. */
export interface RenderExportRequest {
  id: string;
  projectId: string;
  song: MusicProject;
  patternId: string | null;
  mode: PlayMode;
  loop: { start: number; end: number } | null;
  resampling: Resampling;
  /** An absolute folder: `mix.wav` and `<track id>.wav` go there. */
  folder: string;
  mix: boolean;
  stems: boolean;
  /** Stop on the song's last sample, or ring out until it's quiet (at most `maxTail` seconds). */
  tail: "cut" | "ring";
  maxTail?: number;
  /** How many threads run the plugins (default: every core). */
  threads?: number;
}

/** Where a project's sample is on disk, or null if it has no such audio file. */
export type SamplePath = (projectId: string, mediaId: string) => string | null;

/**
 * Make a recorded file a project's media, moving it (the app wires it to the projects' media library:
 * this suite doesn't import the video editor's). `origin` says where it came from.
 */
export type AdoptTake = (projectId: string, file: string, name: string, origin: string) => Promise<MediaAsset>;

export interface EngineOptions {
  /** The engine's argv before its options (default: the built engine). Tests pass a fake. */
  command?: string[];
  pluginPaths?: string[];
  /** No audio device: nothing is heard, and `render` computes sound on request (tests, the export). */
  offline?: boolean;
  /** Scan only `pluginPaths`, not this computer's plugins (tests: fast, and the same everywhere). */
  onlyPluginPaths?: boolean;
  /** Finds a song's samples (default: no song has any). */
  samplePath?: SamplePath;
  /** More environment for the engine's process (tests: the test plugins' settings). */
  env?: Record<string, string>;
  /** Makes a recorded take the project's media (default: it can't, and takes are reported without it). */
  adoptTake?: AdoptTake;
}

/** A recording in progress: whose it is and what its takes are called. */
interface Recording {
  projectId: string;
  names: Record<string, string>;
  /** When it started, for its files' names. */
  started: Date;
}

/** The engine's own word that a take's file is finished (`Recorder::Take`). */
interface RawTake {
  recordingId: string;
  track: string;
  file: string;
  startTick: number;
  skip: number;
  frames: number;
  sampleRate: number;
  pass: number;
  final: boolean;
  dropped: boolean;
}

/** How often the song's plugins' states are written, if they've changed (what's turned in a plugin's window isn't an edit of the song). */
const SAVE_STATES_MS = 5000;

/** How long the engine has to start, and to answer (loading a big plugin takes a while). */
const START_TIMEOUT_MS = 20_000;
const REPLY_TIMEOUT_MS = 60_000;

type Running = ReturnType<typeof spawnStreaming>["child"];
interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}
/** The engine's own status: `hasSavedState` is ours to add. */
type RawStatus = Omit<EngineStatus, EngineSlot> & Record<EngineSlot, Omit<LoadedPlugin, "hasSavedState"> | null>;
/** Which plugin each slot's saved state belongs to. */
type RawDevices = Omit<EngineDevices, "status"> & { status: RawStatus };
type SavedStates = Partial<Record<EngineSlot, string>>;

const isSlot = (v: unknown): v is EngineSlot => ENGINE_SLOTS.includes(v as EngineSlot);

/**
 * Whether `binary` is a checkout's engine (inside its `engine/build`) built before the engine's source
 * (`engine/src`, `engine/CMakeLists.txt`) last changed: then it lacks what the app now asks of it.
 */
export async function engineOutdated(binary: string, source = ENGINE_SOURCE): Promise<boolean> {
  if (!path.isAbsolute(binary) || !binary.startsWith(path.join(source, "build") + path.sep)) return false;
  try {
    const built = (await fs.stat(binary)).mtimeMs;
    const sources = (await fs.readdir(path.join(source, "src"))).map((name) => path.join(source, "src", name));
    const times = await Promise.all([...sources, path.join(source, "CMakeLists.txt")].map((file) => fs.stat(file).then((s) => s.mtimeMs, () => 0)));
    return times.some((time) => time > built);
  } catch {
    return false;
  }
}

/** When a recording started, for its takes' names: "2026-10-01 14-03-22", as FL Studio names them. */
function takeTime(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}`;
}

function slotOf(body: Record<string, unknown>): EngineSlot {
  if (!isSlot(body.slot)) throw new HttpError(400, `"slot" must be one of: ${ENGINE_SLOTS.join(", ")}.`);
  return body.slot;
}

export class AudioEngine {
  private child: Running | null = null;
  private starting: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private saved: SavedStates | null = null;
  /** Shut down on purpose: the engine's exit isn't news. */
  private stopping = false;
  private readonly argv: string[];
  private readonly pluginPaths: string[];
  private readonly flags: string[];
  private readonly samplePath: SamplePath;
  private readonly env: Record<string, string> | undefined;
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  /** The song the engine was last given, to give it again if it restarts. */
  private song: Record<string, unknown> | null = null;
  private stateTimer: NodeJS.Timeout | null = null;
  /** The desktop app's window, to tell a restarted engine too. */
  private host: HostWindow | null = null;
  private readonly adoptTake: AdoptTake | null;
  /** The engine running was built before its source last changed (a checkout's, after a pull without `pnpm engine:build`). */
  private outdated = false;
  /** Recordings by id, while their takes may still come. */
  private readonly recordings = new Map<string, Recording>();
  /** Takes are made media one after another, so they reach the tab in the order they were recorded. */
  private takes: Promise<void> = Promise.resolve();

  constructor(
    private readonly paths: DataPaths,
    options: EngineOptions = {},
  ) {
    this.argv = options.command ?? [ENGINE];
    this.pluginPaths = options.pluginPaths ?? ENGINE_PLUGIN_PATHS;
    this.samplePath = options.samplePath ?? (() => null);
    this.env = options.env;
    this.adoptTake = options.adoptTake ?? null;
    this.flags = [...(options.offline ? ["--offline"] : []), ...(options.onlyPluginPaths ? ["--only-plugin-paths"] : [])];
  }

  /** Run a command from the tab (`POST /api/engine/:command`): validates it, and answers with the status. */
  async command(name: string, body: unknown): Promise<EngineStatus> {
    const input = isObject(body) ? body : {};
    const params = await this.params(name as EngineCommand, input);
    const status = (await this.request(name, params)) as RawStatus;
    if (name === "saveState") await this.remember(slotOf(input), status[slotOf(input)]?.id);
    return this.withSaved(status);
  }

  /**
   * Play this song (`SetSongRequest`): the document is checked like a saved one, compiled
   * (`shared/music/compile.ts`) and handed to the engine, which keeps playing through the change.
   */
  async setSong(body: unknown): Promise<SetSongResponse> {
    const { song, compiled } = this.engineSong(body);
    this.song = song;
    this.keepStates(song.channels.some((c) => c.plugin) || song.tracks.some((t) => t.effects.length > 0));
    const answer = (await this.request("song", { song })) as Omit<SetSongResponse, "loop">;
    return { ...answer, loop: { start: compiled.offsetTicks, ticks: compiled.loopTicks } };
  }

  /**
   * Render a song to 32-bit float WAVs in `folder` (`RenderExportRequest`): the mix, and with `stems`
   * each mixer track's sound. The song is compiled as for playing it, but plays once. Playback stops
   * while it renders; songs sent meanwhile are played once it's over. Resolves when it's written (or
   * aborted: `abortExport`); `onProgress` hears how far it is about ten times a second.
   */
  renderExport(request: RenderExportRequest, onProgress?: (done: number, frames: number) => void): Promise<EngineExportDone | { state: "aborted"; missing: string[] }> {
    const { song } = this.engineSong(request);
    return new Promise((resolve, reject) => {
      const stop = this.onEvent((event) => {
        if (event.event === "stopped") {
          stop();
          reject(new HttpError(503, "The audio engine stopped while exporting (a plugin may have crashed it). Try again."));
        }
        if (event.event !== "export" || event.id !== request.id) return;
        if (event.state === "rendering") return onProgress?.(event.done, event.frames);
        stop();
        if (event.state === "failed") reject(new HttpError(409, event.error));
        else resolve(event);
      });
      const params = { exportId: request.id, song: { ...song, loops: false }, folder: request.folder, mix: request.mix, stems: request.stems, tail: request.tail, maxTail: request.maxTail, threads: request.threads };
      this.request("export", params).catch((err: Error) => {
        stop();
        reject(err);
      });
    });
  }

  /** Stop an export rendering (what it wrote is deleted). */
  async abortExport(id: string): Promise<void> {
    if (this.child) await this.request("abortExport", { exportId: id });
  }

  /** A song request's song, as the engine takes it (`SetSongRequest`; checked, compiled, its files' paths). */
  private engineSong(body: unknown) {
    if (!isObject(body) || !isValidId(body.projectId)) throw new HttpError(400, '"projectId" must be the song\'s project id.');
    const projectId = body.projectId;
    const doc = normalizeMusicProject(body.song, (id) => this.samplePath(projectId, id) !== null);
    const loop = isObject(body.loop) && isFiniteNumber(body.loop.start) && isFiniteNumber(body.loop.end) ? { start: body.loop.start, end: body.loop.end } : null;
    const held = new Set(Array.isArray(body.held) ? body.held.filter((k): k is string => typeof k === "string").slice(0, 64) : []);
    const armed = new Set(Array.isArray(body.armed) ? body.armed.filter((id): id is string => typeof id === "string") : []);
    const compiled = compileSong(doc, typeof body.patternId === "string" ? body.patternId : null, loop, body.mode === "song" ? "song" : "pattern", held, armed);
    // A plugin's state is a file of its own beside the project's document: `plugins/<channel id>.bin`, or the effect's id.
    const states = path.join(this.paths.projectDir(projectId), "plugins");
    const song = {
      ...compiled,
      resampling: isResampling(body.resampling) ? body.resampling : "hermite",
      channels: compiled.channels.map((c) => ({
        ...c,
        sample: c.sample && this.samplePath(projectId, c.sample),
        plugin: c.plugin && { ...c.plugin, state: path.join(states, `${c.id}.bin`) },
      })),
      // An effect's the same, by the effect's id.
      tracks: compiled.tracks.map((t) => ({
        ...t,
        effects: t.effects.map((e) => ({ ...e, plugin: { ...e.plugin, state: path.join(states, `${e.id}.bin`) } })),
      })),
    };
    return { song, compiled };
  }

  /**
   * The desktop app's window changed (focus, minimised, moved): plugin windows follow it. Only sent to a
   * running engine (it's no reason to start one); a new one is told when it starts.
   */
  setHost(host: HostWindow) {
    this.host = host;
    if (this.child) void this.request("host", { ...host }).catch(() => {});
  }

  /**
   * Preview an audio file (the Browser's), outside the song, cutting off the last one. Not one of the
   * tab's commands: the Browser's route checks the file is in its folders first.
   */
  async previewFile(file: string, start: number, id: string): Promise<EngineStatus> {
    return this.withSaved((await this.request("previewFile", { file, start, previewId: id })) as RawStatus);
  }

  /** Preview a song's own media file (`PreviewSampleRequest`), as the Browser's are: an audio clip's channel. */
  async previewSample(body: unknown): Promise<EngineStatus> {
    if (!isObject(body) || !isValidId(body.projectId)) throw new HttpError(400, '"projectId" must be the song\'s project id.');
    const file = typeof body.sampleId === "string" ? this.samplePath(body.projectId, body.sampleId) : null;
    if (!file) throw new HttpError(404, '"sampleId" must be one of the song\'s media files.');
    const start = isFiniteNumber(body.start) && body.start > 0 ? body.start : 0;
    const id = typeof body.id === "string" ? body.id.slice(0, 200) : "";
    const gain = (value: unknown) => (isFiniteNumber(value) ? clamp(value, 0, 4) : 1);
    const speed = isFiniteNumber(body.speed) ? clamp(body.speed, 1 / 16, 16) : 1;
    return this.withSaved((await this.request("previewFile", { file, start, previewId: id, gainLeft: gain(body.gainLeft), gainRight: gain(body.gainRight), speed })) as RawStatus);
  }

  /** Write the song's plugins' states now (the tab asks before it goes). */
  async saveStates(): Promise<void> {
    if (this.child) await this.request("saveStates", {});
  }

  /**
   * Copy plugins' settings files (`CopyStatesRequest`), after having the engine write what's changed. A
   * plugin that has never saved any has no file: there's nothing to copy, and its copy starts afresh.
   */
  async copyStates(body: unknown): Promise<{ copied: number }> {
    if (!isObject(body) || !isValidId(body.projectId)) throw new HttpError(400, '"projectId" must be the song\'s project id.');
    const isOwner = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);
    const copies = Array.isArray(body.copies) ? body.copies : [];
    if (!copies.every((c) => isObject(c) && isOwner(c.from) && isOwner(c.to))) throw new HttpError(400, '"copies" must be a list of { from, to } plugin owners\' ids.');
    await this.saveStates();
    const states = path.join(this.paths.projectDir(body.projectId), "plugins");
    let copied = 0;
    for (const { from, to } of copies as { from: string; to: string }[]) {
      const source = path.join(states, `${from}.bin`);
      if (!existsSync(source)) continue;
      await fs.copyFile(source, path.join(states, `${to}.bin`));
      copied++;
    }
    return { copied };
  }

  /** While the song has plugins, have their states written every few seconds. */
  private keepStates(hasPlugins: boolean) {
    if (hasPlugins === (this.stateTimer !== null)) return;
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.stateTimer = hasPlugins ? setInterval(() => void this.saveStates().catch(() => {}), SAVE_STATES_MS) : null;
    this.stateTimer?.unref();
  }

  async devices(): Promise<EngineDevices> {
    return this.withSavedIn((await this.request("devices", {})) as RawDevices);
  }

  /** Change the output device, its buffer size or sample rate (`SetDeviceRequest`); the engine remembers it. */
  async setDevice(body: unknown): Promise<EngineDevices> {
    const input = isObject(body) ? body : {};
    const params: Record<string, unknown> = {};
    if (typeof input.output === "string" && input.output) params.output = input.output;
    // "" closes the input device.
    if (typeof input.input === "string") params.input = input.input;
    if (isFiniteNumber(input.bufferSize) && input.bufferSize > 0) params.bufferSize = Math.round(input.bufferSize);
    if (isFiniteNumber(input.sampleRate) && input.sampleRate > 0) params.sampleRate = input.sampleRate;
    if (isObject(input.midiInput) && typeof input.midiInput.name === "string" && input.midiInput.name)
      params.midiInput = { name: input.midiInput.name.slice(0, 200), enabled: input.midiInput.enabled !== false };
    if (!Object.keys(params).length) throw new HttpError(400, 'Give an "output", an "input", a "bufferSize", a "sampleRate" or a "midiInput".');
    return this.withSavedIn((await this.request("setDevice", params)) as RawDevices);
  }

  /** Be told what the engine says on its own (`EngineEvent`). Returns how to stop listening. */
  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The plugins found by the last scan. */
  /** A song's plugin's parameters that can be automated (`owner`: a plugin channel's or a mixer effect's, by its id). */
  async parameters(owner: unknown, id: unknown): Promise<EngineParameter[]> {
    if (owner !== "channel" && owner !== "effect") throw new HttpError(400, '"owner" must be "channel" or "effect".');
    if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, '"id" must be a channel\'s or an effect\'s id.');
    const { parameters } = (await this.request("parameters", { owner, ownerId: id })) as { parameters: EngineParameter[] };
    return parameters;
  }

  /** A song's plugin's presets (`PluginPresets`): `owner` "channel" or "effect", by its id. */
  async presets(owner: unknown, id: unknown): Promise<PluginPresets> {
    const { kind, ownerId } = presetOwner(owner, id);
    return (await this.request("presets", { owner: kind, ownerId })) as PluginPresets;
  }

  /** Choose a program, or save, load or delete a preset of the user's (`PresetRequest`): answers with the presets after. */
  async preset(body: unknown): Promise<PluginPresets> {
    const input = isObject(body) ? body : {};
    const { kind, ownerId } = presetOwner(input.owner, input.id);
    if (input.action === "setProgram") {
      if (!Number.isInteger(input.index) || (input.index as number) < 0) throw new HttpError(400, '"index" must be a program\'s number (0 is the first).');
      return (await this.request("setProgram", { owner: kind, ownerId, index: input.index })) as PluginPresets;
    }
    if (input.action !== "savePreset" && input.action !== "loadPreset" && input.action !== "deletePreset")
      throw new HttpError(400, '"action" must be "setProgram", "savePreset", "loadPreset" or "deletePreset".');
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : "";
    if (!name) throw new HttpError(400, '"name" must be the preset\'s name.');
    return (await this.request(input.action, { owner: kind, ownerId, name })) as PluginPresets;
  }

  async plugins(): Promise<EnginePlugin[]> {
    return (await this.request("plugins", {})) as EnginePlugin[];
  }

  /**
   * Offline engines only: compute the next `frames` samples of what's loaded and playing, and measure
   * them; with `file`, they're written there as a WAV too.
   */
  async render(frames: number, file?: string, input?: string): Promise<EngineRender> {
    return (await this.request("render", { frames, file, input })) as EngineRender;
  }

  /**
   * Record (`RecordRequest`): the engine plays and records the armed tracks of the song it was last
   * sent into the project's `recordings` folder; each take, once finished, becomes the project's media
   * and is told as an `EngineTakeEvent`. Stopped by `stop`, like play.
   */
  async record(body: unknown): Promise<{ recordingId: string; status: EngineStatus }> {
    if (!isObject(body) || !isValidId(body.projectId)) throw new HttpError(400, '"projectId" must be the song\'s project id.');
    const names: Record<string, string> = {};
    if (isObject(body.names))
      for (const [track, name] of Object.entries(body.names)) if (typeof name === "string" && /^[\w-]{1,64}$/.test(track)) names[track] = name.trim().slice(0, 80);
    const recordingId = createId("rec");
    const folder = path.join(this.paths.projectDir(body.projectId), "recordings");
    await fs.mkdir(folder, { recursive: true });
    this.recordings.set(recordingId, { projectId: body.projectId, names, started: new Date() });
    try {
      const status = (await this.request("record", {
        recordingId,
        folder,
        from: isFiniteNumber(body.from) ? Math.max(0, body.from) : 0,
        countIn: isFiniteNumber(body.countIn) ? clamp(body.countIn, 0, 96 * 4 * 16) : 0,
        loop: body.loop === true,
        notes: body.notes === true,
      })) as RawStatus;
      return { recordingId, status: await this.withSaved(status) };
    } catch (err) {
      this.recordings.delete(recordingId);
      throw err;
    }
  }

  /** A take's file is done: made the project's media (in turn), then told to the tab. */
  private take(raw: RawTake) {
    this.takes = this.takes.then(async () => {
      const recording = this.recordings.get(raw.recordingId);
      if (!recording) return;
      if (raw.final) this.recordings.delete(raw.recordingId);
      const name = `${recording.names[raw.track] || "Recording"} ${takeTime(recording.started)}${raw.pass > 0 ? ` take ${raw.pass + 1}` : ""}`;
      let media: MediaAsset | null = null;
      let error: string | undefined;
      try {
        if (!this.adoptTake) throw new Error("Recordings can't be kept here.");
        media = await this.adoptTake(recording.projectId, raw.file, name, `recording:${raw.recordingId}:${raw.track}:${raw.pass}`);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      if (raw.dropped && !error) error = "The disk didn't keep up: some of this take is missing.";
      const event: EngineTakeEvent = {
        event: "take",
        recordingId: raw.recordingId,
        projectId: recording.projectId,
        track: raw.track,
        media,
        ...(error ? { error } : {}),
        startTick: raw.startTick,
        skip: raw.skip,
        frames: raw.frames,
        sampleRate: raw.sampleRate,
        pass: raw.pass,
        final: raw.final,
      };
      this.emit(event);
    });
  }

  shutdown() {
    this.stopping = true;
    this.keepStates(false);
    this.child?.stdin?.end();
    this.child?.kill();
    this.child = null;
  }

  /** A command's parameters for the engine, checked. Throws `HttpError(400)`. */
  private async params(name: EngineCommand, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (name) {
      case "status":
      case "stop":
        return {};
      case "play":
        return { from: isFiniteNumber(body.from) ? Math.max(0, body.from) : 0 };
      case "preview": {
        if (typeof body.channel !== "string" || !body.channel) throw new HttpError(400, '"channel" must be a channel\'s id.');
        if (!isFiniteNumber(body.key)) throw new HttpError(400, '"key" must be a MIDI note number (0 to 127).');
        return {
          channel: body.channel,
          key: Math.round(clamp(body.key, 0, 127)),
          on: body.on === true,
          velocity: isFiniteNumber(body.velocity) ? clamp(body.velocity, 0, 1) : DEFAULT_VELOCITY,
        };
      }
      case "midiTarget":
        if (body.channel !== null && (typeof body.channel !== "string" || !/^[\w-]{1,64}$/.test(body.channel)))
          throw new HttpError(400, '"channel" must be a channel\'s id, or null for none.');
        return { channel: body.channel ?? null };
      case "midiIn": {
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const valid = messages
          .filter((m): m is number[] => Array.isArray(m) && m.length >= 1 && m.length <= 3 && m.every((b) => Number.isInteger(b) && b >= 0 && b <= 255))
          // A status byte first, then data bytes.
          .filter((m) => m[0] >= 0x80 && m.slice(1).every((b) => b < 0x80));
        if (!valid.length) throw new HttpError(400, '"messages" must be MIDI messages: arrays of a status byte (128 to 255) and up to two data bytes (0 to 127).');
        return { messages: valid.slice(0, 256) };
      }
      case "metronome":
        if (body.sound !== undefined && !isMetronomeSound(body.sound))
          throw new HttpError(400, `"sound" must be one of ${METRONOME_SOUNDS.map((s) => s.id).join(", ")}.`);
        return { on: body.on === true, ...(body.sound !== undefined && { sound: body.sound }), ...(body.audition === true && { audition: true }) };
      case "stopPreview":
        return {};
      case "previewVolume":
        return { volume: isFiniteNumber(body.volume) ? clamp(body.volume, 0, 1) : 1 };
      case "channelEditor": {
        if (typeof body.channel !== "string" || !body.channel) throw new HttpError(400, '"channel" must be a channel\'s id.');
        return { channel: body.channel, open: body.open === true };
      }
      case "meterTracks": {
        const tracks = Array.isArray(body.tracks) ? body.tracks.filter((t): t is string => typeof t === "string" && /^[\w-]{1,64}$/.test(t)) : [];
        return { tracks: tracks.slice(0, 1024) };
      }
      case "effectEditor": {
        if (typeof body.effect !== "string" || !body.effect) throw new HttpError(400, '"effect" must be an effect\'s id.');
        return { effect: body.effect, open: body.open === true };
      }
      case "grossBeat": {
        if (typeof body.effect !== "string" || !body.effect) throw new HttpError(400, '"effect" must be a Gross Beat\'s effect id.');
        return {
          effect: body.effect,
          ...(typeof body.hold === "boolean" && { hold: body.hold }),
          ...(isFiniteNumber(body.scratch) && { scratch: clamp(body.scratch, -GROSS_DEPTH, 0) }),
        };
      }
      case "trigger": {
        if (typeof body.channel !== "string" || !body.channel) throw new HttpError(400, '"channel" must be a channel\'s id.');
        const velocity = isFiniteNumber(body.velocity) ? clamp(body.velocity, 0, 1) : DEFAULT_VELOCITY;
        return { channel: body.channel, pitch: isFiniteNumber(body.pitch) ? clamp(body.pitch, -96, 96) : 0, gain: levelGain(velocity, DEFAULT_VELOCITY) };
      }
      case "tone":
        return { on: body.on === true };
      case "scan":
        return { rescan: body.rescan === true };
      case "load": {
        if (typeof body.pluginId !== "string" || !body.pluginId) throw new HttpError(400, '"pluginId" must be a plugin\'s id.');
        return { slot: slotOf(body), pluginId: body.pluginId };
      }
      case "unload":
        return { slot: slotOf(body) };
      case "editor":
        return { slot: slotOf(body), open: body.open === true };
      case "note": {
        if (!isFiniteNumber(body.pitch)) throw new HttpError(400, '"pitch" must be a MIDI note number (0 to 127).');
        const velocity = isFiniteNumber(body.velocity) ? clamp(body.velocity, 0, 1) : 0.8;
        return { pitch: Math.round(clamp(body.pitch, 0, 127)), on: body.on === true, velocity };
      }
      case "saveState":
        return { slot: slotOf(body), file: this.stateFile(slotOf(body)) };
      case "restoreState": {
        const slot = slotOf(body);
        if (!(await this.savedStates())[slot]) throw new HttpError(409, "No state has been saved for this plugin yet.");
        return { slot, file: this.stateFile(slot) };
      }
      default:
        throw new HttpError(404, `Unknown engine command "${String(name satisfies never)}".`);
    }
  }

  private stateFile(slot: EngineSlot) {
    return path.join(this.paths.engine, `state-${slot}.bin`);
  }

  private async savedStates(): Promise<SavedStates> {
    this.saved ??= (await readJson<SavedStates>(path.join(this.paths.engine, "states.json"))) ?? {};
    return this.saved;
  }

  private async remember(slot: EngineSlot, pluginId: string | undefined) {
    const saved = { ...(await this.savedStates()), [slot]: pluginId };
    this.saved = saved;
    await writeJson(path.join(this.paths.engine, "states.json"), saved);
  }

  private async withSaved(status: RawStatus): Promise<EngineStatus> {
    const saved = await this.savedStates();
    const slot = (name: EngineSlot) => status[name] && { ...status[name], hasSavedState: saved[name] === status[name].id };
    return { ...status, instrument: slot("instrument"), effect: slot("effect"), ...(this.outdated && { outdated: true }) };
  }

  private async withSavedIn(devices: RawDevices): Promise<EngineDevices> {
    return { ...devices, status: await this.withSaved(devices.status) };
  }

  private async request(cmd: string, params: Record<string, unknown>): Promise<unknown> {
    await this.start();
    const child = this.child;
    if (!child?.stdin) throw new HttpError(503, "The audio engine stopped. Try again.");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HttpError(504, "The audio engine didn't answer."));
      }, REPLY_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin!.write(`${JSON.stringify({ ...params, id, cmd })}\n`);
    });
  }

  private emit(event: EngineEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private start(): Promise<void> {
    if (this.child) return Promise.resolve();
    this.starting ??= this.spawn().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async spawn(): Promise<void> {
    if (path.isAbsolute(this.argv[0]) && !existsSync(this.argv[0])) {
      throw new HttpError(503, "The audio engine isn't built yet: run `pnpm engine:build`.");
    }
    await fs.mkdir(this.paths.engine, { recursive: true });
    this.outdated = await engineOutdated(this.argv[0]);
    const args = ["--data", this.paths.engine, ...this.pluginPaths.filter((dir) => existsSync(dir)).flatMap((dir) => ["--plugin-path", dir])];
    args.push(...this.flags);
    const { child, done } = spawnStreaming([...this.argv, ...args], "pipe", "pipe", { env: this.env });
    // A write to an engine that just died must not take the server down with it.
    child.stdin!.on("error", () => {});

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new HttpError(503, "The audio engine didn't start."));
      }, START_TIMEOUT_MS);
      readline.createInterface({ input: child.stdout! }).on("line", (line) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.event === "ready") {
          clearTimeout(timer);
          this.child = child;
          // A restarted engine has forgotten the song: give it back before anything else is asked.
          if (this.song) void this.request("song", { song: this.song }).catch(() => {});
          if (this.host) void this.request("host", { ...this.host }).catch(() => {});
          resolve();
          this.emit({ event: "ready" });
        } else if (message.event === "take") {
          this.take(message as unknown as RawTake);
        } else if (
          message.event === "transport" ||
          message.event === "key" ||
          message.event === "export" ||
          message.event === "touch" ||
          message.event === "automate" ||
          message.event === "preset" ||
          message.event === "wrapper" ||
          message.event === "midi"
        ) {
          this.emit(message as unknown as EngineEvent);
        } else if (message.event === "status" && isObject(message.status)) {
          void this.withSaved(message.status as unknown as RawStatus).then((status) => this.emit({ event: "status", status }));
        }
        const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
        if (!pending) return;
        this.pending.delete(message.id as number);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new HttpError(409, typeof message.error === "string" ? message.error : "The audio engine refused."));
      });
      done
        .catch((err: Error) => this.stopping || console.error(`[engine] ${err.message}`))
        .finally(() => {
          clearTimeout(timer);
          if (this.child === child) this.child = null;
          if (!this.stopping) this.emit({ event: "stopped" });
          for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new HttpError(503, "The audio engine stopped (a plugin may have crashed it). Try again."));
          }
          this.pending.clear();
          reject(new HttpError(503, "The audio engine couldn't start."));
        });
    });
  }
}

/** Whose presets: a plugin channel's or a mixer effect's, by its id. Throws `HttpError(400)`. */
function presetOwner(owner: unknown, id: unknown): { kind: "channel" | "effect"; ownerId: string } {
  if (owner !== "channel" && owner !== "effect") throw new HttpError(400, '"owner" must be "channel" or "effect".');
  if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, '"id" must be a channel\'s or an effect\'s id.');
  return { kind: owner, ownerId: id };
}
