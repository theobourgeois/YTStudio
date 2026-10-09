/**
 * The Serum player's server side (`docs/serum/player.md`): Serum's preset library and its ratings, a preset loaded
 * onto a song's Serum channel (dropped on Serum's invisible window, as Serum's own browser loads it: names and all,
 * Serum 1 presets converted by Serum), what a channel's Serum has on now (its macros, mod matrix, envelopes, LFOs,
 * oscillators and effects), the edits that need Serum to load a new state, and the player's history of each channel's
 * sound. Every state it loads links the effects' card knobs to the racks' host slots, so they turn live.
 * `/api/music/serum`.
 *
 * Serum's state is the truth (`plugins/<channel>.bin`, the engine's); beside it the player keeps what Serum's
 * own re-save drops (`<channel>.serum.json`: the preset's macro names, §2.4) and whether it was edited. A sound is
 * saved as a `.SerumPreset` in Serum 2's `User` folder (§3.8), and Serum told it has that preset on.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Router, json } from "express";
import {
  type SerumLibraryFolders,
  type SerumLibraryResponse,
  type SerumSaveResult,
  type SerumSound,
  SERUM_MACRO_PARAMS,
  serumPresetNameProblem,
} from "../../../shared/music/serum-presets.ts";
import { SERUM_EFFECTS, type SerumChainEntry } from "../../../shared/music/serum-effects.ts";
import type { SerumHistory, SerumSoundEdit } from "../../../shared/music/serum-sound.ts";
import { HttpError, isObject, isValidId, readJson, writeFileDurably, writeJson } from "../../storage.ts";
import type { AudioEngine } from "../engine.ts";
import { SpecError } from "./body.ts";
import { type CborMap, decodeCbor, encodeCbor, isPlainMap } from "./cbor.ts";
import { readXfer } from "./container.ts";
import type { SerumLibrary } from "./library.ts";
import { fxLinksOf, presetAsState, readPluginState, stateSettings } from "./plugin-state.ts";
import { presetFile, readSerumSettings } from "./preset.ts";
import { destinationNames, editSerumBody, fxLinksFor, liveControls, macroNamesOf, readSoundParts, sameLinks, type SerumChain, withMacroNames } from "./sound.ts";

export interface SerumPlayerOptions {
  library: SerumLibrary;
  engine: AudioEngine;
  hasProject: (id: string) => boolean;
}

/** What the player keeps beside a channel's Serum state. */
export interface SerumChannelMeta {
  /** The preset's own macro names ("" where it names none), handed back to Serum with every state the player loads. */
  macroNames: string[];
  /** Changed in the player since the preset was loaded. */
  edited: boolean;
}

const NO_META: SerumChannelMeta = { macroNames: [], edited: false };

/** A step of a channel's history: a whole state (a load, a reload's edit) or a live control moved (a drag). */
type Step = { label: string } & ({ kind: "state"; state: Uint8Array; meta: SerumChannelMeta } | { kind: "controls"; changes: ControlChange[] });

/** A live control moved: its parameter, and where it was and went (0 to 1). */
interface ControlChange {
  param: string;
  before: number;
  after: number;
}

/** How many steps a channel's history keeps (a state can be a few hundred kB). */
const HISTORY_STEPS = 40;

const isChannelId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);
/** A name Serum makes up for a control nobody named ("Macro 3", or none). */
const isSerumsOwnName = (name: string) => !name.trim() || /^Macro \d$/.test(name.trim());

/** Serum's settings in a state, or null if it isn't a Serum 2 state (the stand-in engine's, before a preset). */
function settingsOf(state: Uint8Array | null): CborMap | null {
  if (!state) return null;
  try {
    const body = decodeCbor(stateSettings(state));
    return isPlainMap(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * `state` with `settings` in it, the preset's macro names written in (Serum names its controls from them) and its
 * effect knobs linked to the racks' slots as the player links them (`fxLinksFor`: the knobs its cards show, live).
 */
export function restate(state: Uint8Array, settings: CborMap, names: readonly string[], presetPath?: string): Uint8Array {
  return presetAsState(state, encodeCbor(withMacroNames(settings, names)), fxLinksFor(settings), presetPath);
}

export class SerumPlayer {
  private readonly histories = new Map<string, { undo: Step[]; redo: Step[] }>();
  /** Each channel's changes, one at a time (a load, an edit, an undo: each reads the state the last one left). */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly options: SerumPlayerOptions) {}

  async presets(): Promise<SerumLibraryResponse> {
    const { library } = this.options;
    if (!(await library.available())) return { available: false, presets: [] };
    return { available: true, presets: await library.list() };
  }

  /** `{ hash, rating }`: Serum's stars for a preset (0 takes them away). */
  async rate(body: unknown): Promise<void> {
    const input = isObject(body) ? body : {};
    await this.options.library.setRating(input.hash as string, input.rating as number);
  }

  /** `{ projectId, channel, path }`: the preset loaded onto the channel's Serum (one undo step). Answers with what it has on then. */
  async load(body: unknown): Promise<SerumSound> {
    const input = isObject(body) ? body : {};
    const { projectId, channel } = this.target(input.projectId, input.channel);
    const file = await this.options.library.resolve(input.path);
    this.requirePlaying(projectId);
    return this.serial(projectId, channel, async () => {
      const { engine } = this.options;
      const stateFile = await engine.channelStateFile(projectId, channel);
      const before = await readState(stateFile);
      if (before) this.push(projectId, channel, { kind: "state", label: `Load ${path.basename(file).replace(/\.(SerumPreset|fxp)$/i, "")}`, state: before, meta: await readMeta(stateFile) });
      await engine.dropFiles(channel, [file]);
      // The names it gives its macros: a Serum 2 preset's from the file, a Serum 1 preset's as Serum names the controls after converting it.
      let macroNames: string[] = [];
      if (/\.SerumPreset$/i.test(file)) {
        try {
          macroNames = macroNamesOf(readSerumSettings(new Uint8Array(await fs.readFile(file))).body);
        } catch {
          // Unreadable: Serum's own names will do.
        }
      } else {
        const parameters = await engine.parameters("channel", channel);
        macroNames = SERUM_MACRO_PARAMS.map((param) => {
          const name = parameters.find((p) => p.id === param)?.name ?? "";
          return isSerumsOwnName(name) ? "" : name;
        });
      }
      await writeMeta(stateFile, { macroNames, edited: false });
      // Its effects' card knobs linked to the racks' slots, so they turn live: a reload of what Serum has just loaded.
      const loaded = await readState(await engine.channelStateFile(projectId, channel));
      const settings = settingsOf(loaded);
      if (loaded && settings && !sameLinks(fxLinksOf(loaded), fxLinksFor(settings))) await engine.swapState(channel, restate(loaded, settings, macroNames));
      return this.soundNow(projectId, channel);
    });
  }

  /** What the channel's Serum has on now: its preset as Serum says, its macros, routes, envelopes and LFOs, and its history. */
  async sound(projectIdInput: unknown, channelInput: unknown): Promise<SerumSound> {
    const { projectId, channel } = this.target(projectIdInput, channelInput);
    return this.serial(projectId, channel, () => this.soundNow(projectId, channel));
  }

  /**
   * `{ projectId, channel, edits: SerumSoundEdit[], label? }`: changes that need Serum to load a new state (routes, an
   * envelope or LFO set outright, an LFO's shape or mode), applied as one: the engine fades the channel out, loads it,
   * plays the notes held again and fades back in. One undo step. Answers with the sound then.
   */
  async edit(body: unknown): Promise<SerumSound> {
    const input = isObject(body) ? body : {};
    const { projectId, channel } = this.target(input.projectId, input.channel);
    this.requirePlaying(projectId);
    return this.serial(projectId, channel, async () => {
      const stateFile = await this.options.engine.channelStateFile(projectId, channel);
      const state = await readState(stateFile);
      const settings = settingsOf(state);
      if (!state || !settings) throw new HttpError(409, "Serum hasn't saved its sound yet: load a preset first, or wait a moment.");
      let edited: CborMap;
      try {
        edited = editSerumBody(settings, input.edits, await this.chainsOf(input.edits));
      } catch (err) {
        if (err instanceof SpecError) throw new HttpError(400, err.message);
        throw err;
      }
      const meta = await readMeta(stateFile);
      const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 80) : labelOf(input.edits as SerumSoundEdit[]);
      this.push(projectId, channel, { kind: "state", label, state, meta });
      await this.options.engine.swapState(channel, restate(state, edited, meta.macroNames));
      await writeMeta(stateFile, { ...meta, edited: true });
      return this.soundNow(projectId, channel);
    });
  }

  /**
   * `{ projectId, channel, changes: [{ param, before, after }], label }`: live controls moved in the player (a drag
   * that ended: a macro, a mod amount, an envelope's point moving two at once): one undo step, undone by setting them back.
   */
  async step(body: unknown): Promise<SerumHistory> {
    const input = isObject(body) ? body : {};
    const { projectId, channel } = this.target(input.projectId, input.channel);
    const changes = Array.isArray(input.changes) ? input.changes : [];
    const valid = (c: unknown): c is ControlChange =>
      isObject(c) && typeof c.param === "string" && /^\d{1,9}$/.test(c.param) && [c.before, c.after].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1);
    if (!changes.length || changes.length > 16 || !changes.every(valid))
      throw new HttpError(400, '"changes" must list the controls moved: [{ "param": a Serum parameter id, "before": 0 to 1, "after": 0 to 1 }].');
    const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 80) : "Turn a control";
    return this.serial(projectId, channel, async () => {
      const moved = changes.filter((c) => c.before !== c.after);
      if (moved.length) {
        this.push(projectId, channel, { kind: "controls", changes: moved, label });
        // A macro is played as much as it's set; anything else makes the sound the preset's no more.
        if (moved.some((c) => !SERUM_MACRO_PARAMS.includes(c.param))) {
          const stateFile = await this.options.engine.channelStateFile(projectId, channel);
          await writeMeta(stateFile, { ...(await readMeta(stateFile)), edited: true });
        }
      }
      return this.historyOf(projectId, channel);
    });
  }

  /** `{ projectId, channel }`: the channel's last step undone (or redone): the state before it loaded, or the control set back. */
  async undo(body: unknown, redo = false): Promise<SerumSound> {
    const input = isObject(body) ? body : {};
    const { projectId, channel } = this.target(input.projectId, input.channel);
    this.requirePlaying(projectId);
    return this.serial(projectId, channel, async () => {
      const history = this.history(projectId, channel);
      const [from, to] = redo ? [history.redo, history.undo] : [history.undo, history.redo];
      const step = from.pop();
      if (!step) throw new HttpError(409, `There's nothing to ${redo ? "redo" : "undo"} in this Serum's player.`);
      const { engine } = this.options;
      const stateFile = await engine.channelStateFile(projectId, channel);
      try {
        if (step.kind === "controls") {
          for (const change of step.changes) await engine.command("setParameter", { owner: "channel", ownerId: channel, param: change.param, value: redo ? change.after : change.before });
          to.push(step);
        } else {
          const now = await readState(stateFile);
          const meta = await readMeta(stateFile);
          const settings = settingsOf(step.state);
          await engine.swapState(channel, settings ? restate(step.state, settings, step.meta.macroNames) : step.state);
          await writeMeta(stateFile, step.meta);
          if (now) to.push({ kind: "state", label: step.label, state: now, meta });
        }
      } catch (err) {
        from.push(step);
        throw err;
      }
      return this.soundNow(projectId, channel);
    });
  }

  /**
   * `{ projectId, channel, name?, overwrite? }`: the channel's sound saved as a `.SerumPreset` in Serum 2's `User`
   * folder, so Serum lists it too, with its macro names, and Serum told it has that preset on now (a reload, as an
   * edit's). With a `name`, a new preset (`overwrite`: replacing one of that name in `User`); without one, saved over
   * the preset it has on, which must be one of `User`'s: a factory, pack or Serum 1 preset is never written over.
   * Not an undo step: the sound doesn't change.
   */
  async save(body: unknown): Promise<SerumSaveResult> {
    const input = isObject(body) ? body : {};
    const { projectId, channel } = this.target(input.projectId, input.channel);
    if (input.name !== undefined && typeof input.name !== "string") throw new HttpError(400, '"name" must be the preset\'s name.');
    const problem = typeof input.name === "string" ? serumPresetNameProblem(input.name) : null;
    if (problem) throw new HttpError(400, problem);
    this.requirePlaying(projectId);
    const userFolder = await this.options.library.userFolder();
    if (!userFolder) throw new HttpError(404, "Serum 2's preset folder isn't on this computer: there's nowhere to save a preset.");
    return this.serial(projectId, channel, async () => {
      const { engine } = this.options;
      const stateFile = await engine.channelStateFile(projectId, channel);
      const state = await readState(stateFile);
      const settings = settingsOf(state);
      if (!state || !settings) throw new HttpError(409, "Serum hasn't saved its sound yet: load a preset first, or wait a moment.");
      const current = presetOf(state);
      let file: string;
      if (typeof input.name === "string") {
        file = path.join(userFolder, `${input.name.trim()}.SerumPreset`);
      } else {
        const on = current?.path ? path.resolve(current.path) : null;
        if (!on || !on.startsWith(path.resolve(userFolder) + path.sep) || !/\.SerumPreset$/i.test(on))
          throw new HttpError(409, `${current?.name ? `"${current.name}"` : "The preset it has on"} isn't one of yours in Serum's User folder, so it isn't saved over: save it as a new preset, with a name.`);
        file = on;
      }
      const replaced = await fs.stat(file).then((s) => s.isFile(), () => false);
      if (replaced && typeof input.name === "string" && input.overwrite !== true)
        throw new HttpError(409, `There's a preset "${path.basename(file, ".SerumPreset")}" in Serum's User folder already: replace it (overwrite), or pick another name.`);
      const name = path.basename(file).replace(/\.SerumPreset$/i, "");
      const meta = await readMeta(stateFile);
      // The sound as a preset: Serum's settings with the names its re-save dropped, under its new name.
      const preset = withMacroNames(readSerumSettings(state).body, meta.macroNames);
      preset.presetName = name;
      await writeFileDurably(file, presetFile(preset));
      await engine.swapState(channel, restate(state, { ...settings, presetName: name }, meta.macroNames, file));
      await writeMeta(stateFile, { ...meta, edited: false });
      return { sound: await this.soundNow(projectId, channel), path: file, replaced };
    });
  }

  /** The library's folders: Serum's own and the ones added, and folders of Serum presets found that aren't listed. */
  async folders(): Promise<SerumLibraryFolders> {
    return this.options.library.folders();
  }

  async addFolder(body: unknown): Promise<SerumLibraryFolders> {
    return this.options.library.addFolder(isObject(body) ? body.path : undefined);
  }

  async removeFolder(folder: unknown): Promise<SerumLibraryFolders> {
    return this.options.library.removeFolder(folder);
  }

  /** Serum's saved effects and racks (`Effect Chains`), for + Add. */
  async chains(): Promise<SerumChainEntry[]> {
    return this.options.library.chains();
  }

  /** The saved effects and racks `edits` put in, read (an unreadable one is left out: the edit then says so). */
  private async chainsOf(edits: unknown): Promise<Map<string, SerumChain>> {
    const chains = new Map<string, SerumChain>();
    if (!Array.isArray(edits)) return chains;
    for (const edit of edits)
      if (isObject(edit) && edit.kind === "effectChain" && typeof edit.path === "string" && !chains.has(edit.path)) {
        const chain = await this.options.library.readChain(edit.path).catch(() => null);
        if (chain) chains.set(edit.path, chain);
      }
    return chains;
  }

  /** The destinations a route of this channel's sound can have, by name (its oscillators and effects decide some). */
  async destinations(projectIdInput: unknown, channelInput: unknown): Promise<string[]> {
    const { projectId, channel } = this.target(projectIdInput, channelInput);
    this.requirePlaying(projectId);
    const settings = settingsOf(await readState(await this.options.engine.channelStateFile(projectId, channel)));
    if (!settings) throw new HttpError(409, "Serum hasn't saved its sound yet: load a preset first, or wait a moment.");
    return destinationNames(settings);
  }

  private async soundNow(projectId: string, channel: string): Promise<SerumSound> {
    const { engine } = this.options;
    const stateFile = await engine.channelStateFile(projectId, channel);
    const state = await readState(stateFile);
    const meta = await readMeta(stateFile);
    const parameters = await engine.parameters("channel", channel);
    const macros = SERUM_MACRO_PARAMS.flatMap((param, index) => {
      const control = parameters.find((p) => p.id === param);
      if (!control) return [];
      const name = !isSerumsOwnName(control.name) ? control.name : meta.macroNames[index] || control.name || `Macro ${index + 1}`;
      return [{ index, param, name, value: control.value, text: control.text }];
    });
    const settings = settingsOf(state);
    const parts = settings && state ? readSoundParts(settings, liveControls(parameters), fxLinksOf(state)) : { modulation: null, envelopes: [], lfos: [], oscillators: [], effects: [] };
    return { preset: presetOf(state), macros, ...parts, edited: meta.edited, history: this.historyOf(projectId, channel) };
  }

  private history(projectId: string, channel: string) {
    const key = `${projectId}/${channel}`;
    let history = this.histories.get(key);
    if (!history) this.histories.set(key, (history = { undo: [], redo: [] }));
    return history;
  }

  private historyOf(projectId: string, channel: string): SerumHistory {
    const { undo, redo } = this.history(projectId, channel);
    return { undo: undo.at(-1)?.label ?? null, redo: redo.at(-1)?.label ?? null };
  }

  private push(projectId: string, channel: string, step: Step) {
    const history = this.history(projectId, channel);
    history.undo.push(step);
    if (history.undo.length > HISTORY_STEPS) history.undo.shift();
    history.redo = [];
  }

  private serial<T>(projectId: string, channel: string, run: () => Promise<T>): Promise<T> {
    const key = `${projectId}/${channel}`;
    const next = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    this.queues.set(key, next);
    return next;
  }

  private requirePlaying(projectId: string) {
    if (!this.options.engine.isPlaying(projectId)) throw new HttpError(409, "This song is not loaded in the audio engine.");
  }

  private target(projectId: unknown, channel: unknown): { projectId: string; channel: string } {
    if (!isValidId(projectId) || !this.options.hasProject(projectId)) throw new HttpError(404, "There's no such project.");
    if (!isChannelId(channel)) throw new HttpError(400, '"channel" must be a channel\'s id.');
    return { projectId, channel };
  }
}

/** A step's name, for Undo's: what the edits did. */
function labelOf(edits: SerumSoundEdit[]): string {
  if (edits.length !== 1) return "Change the sound";
  const [edit] = edits;
  switch (edit.kind) {
    case "route":
      return edit.slot === undefined ? "Add a route" : "Change a route";
    case "removeRoute":
      return "Remove a route";
    case "envelope":
      return `Change Env ${edit.envelope}`;
    case "lfo":
      return `Change LFO ${edit.lfo}`;
    case "effect":
      return edit.enabled !== undefined && !edit.settings ? `${edit.enabled ? "Turn on" : "Bypass"} an effect` : "Change an effect";
    case "addEffect":
      return `Add ${SERUM_EFFECTS[edit.effect]?.name ?? "an effect"}`;
    case "removeEffect":
      return "Remove an effect";
    case "moveEffect":
      return "Move an effect";
    case "effectChain":
      return `Load ${path.basename(String(edit.path)).replace(/\.SerumFX(Rack)?$/i, "")}`;
    default:
      return "Change the sound";
  }
}

async function readState(file: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await fs.readFile(file));
  } catch {
    return null;
  }
}

/** Where the player keeps what it knows of a channel's Serum: beside its state, `<channel>.serum.json`. */
const metaFile = (stateFile: string) => stateFile.replace(/\.bin$/, ".serum.json");

async function readMeta(stateFile: string): Promise<SerumChannelMeta> {
  const meta = await readJson<Partial<SerumChannelMeta>>(metaFile(stateFile)).catch(() => null);
  if (!meta) return NO_META;
  return {
    macroNames: Array.isArray(meta.macroNames) ? meta.macroNames.slice(0, 8).map((n) => (typeof n === "string" ? n.slice(0, 64) : "")) : [],
    edited: meta.edited === true,
  };
}

async function writeMeta(stateFile: string, meta: SerumChannelMeta): Promise<void> {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await writeJson(metaFile(stateFile), meta);
}

/** The preset a Serum state says it has on (its controller's name and the file it came from), or null if there's no state yet. */
function presetOf(state: Uint8Array | null): SerumSound["preset"] {
  if (!state) return null;
  try {
    const { controller } = readPluginState(state);
    if (!controller) return null;
    const container = readXfer(controller);
    const settings = decodeCbor(container.settings);
    const name = typeof container.meta.presetName === "string" ? container.meta.presetName.trim() : "";
    const path = isPlainMap(settings) && typeof settings.selectedPresetPath === "string" && settings.selectedPresetPath ? settings.selectedPresetPath : null;
    return { name, path };
  } catch {
    // Not a Serum 2 state (another plugin's).
    return null;
  }
}

/** `/api/music/serum`: the Serum player's library and its folders, ratings, loading, sound, edits, history and saving. */
export function serumPlayerRoutes(player: SerumPlayer): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/presets", async (_req, res) => {
    res.json(await player.presets());
  });
  router.post("/rating", json(), async (req, res) => {
    await player.rate(req.body);
    res.status(204).end();
  });
  router.post("/load", json(), async (req, res) => {
    res.json(await player.load(req.body));
  });
  router.get("/sound", async (req, res) => {
    res.json(await player.sound(req.query.projectId, req.query.channel));
  });
  router.post("/edit", json(), async (req, res) => {
    res.json(await player.edit(req.body));
  });
  router.post("/step", json(), async (req, res) => {
    res.json(await player.step(req.body));
  });
  router.post("/undo", json(), async (req, res) => {
    res.json(await player.undo(req.body));
  });
  router.post("/redo", json(), async (req, res) => {
    res.json(await player.undo(req.body, true));
  });
  router.post("/save", json(), async (req, res) => {
    res.json(await player.save(req.body));
  });
  router.get("/folders", async (_req, res) => {
    res.json(await player.folders());
  });
  router.post("/folders", json(), async (req, res) => {
    res.json(await player.addFolder(req.body));
  });
  router.delete("/folders", async (req, res) => {
    res.json(await player.removeFolder(req.query.path));
  });
  router.get("/chains", async (_req, res) => {
    res.json(await player.chains());
  });
  router.get("/destinations", async (req, res) => {
    res.json(await player.destinations(req.query.projectId, req.query.channel));
  });
  return router;
}
