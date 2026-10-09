/**
 * The Serum player's server side (`docs/serum/player.md`): Serum's preset library and its ratings, a preset loaded
 * onto a song's Serum channel (dropped on Serum's invisible window, as Serum's own browser loads it: names and all,
 * Serum 1 presets converted by Serum), and what a channel's Serum has on now. `/api/music/serum`.
 */
import fs from "node:fs/promises";
import { Router, json } from "express";
import { type SerumLibraryResponse, type SerumSound, SERUM_MACRO_PARAMS } from "../../../shared/music/serum-presets.ts";
import { HttpError, isObject, isValidId } from "../../storage.ts";
import type { AudioEngine } from "../engine.ts";
import { decodeCbor, isPlainMap } from "./cbor.ts";
import { readXfer } from "./container.ts";
import type { SerumLibrary } from "./library.ts";
import { readPluginState } from "./plugin-state.ts";

export interface SerumPlayerOptions {
  library: SerumLibrary;
  engine: AudioEngine;
  hasProject: (id: string) => boolean;
}

const isChannelId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);

export class SerumPlayer {
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

  /** `{ projectId, channel, path }`: the preset loaded onto the channel's Serum. Answers with what it has on then. */
  async load(body: unknown): Promise<SerumSound> {
    const input = isObject(body) ? body : {};
    const { projectId, channel } = this.target(input.projectId, input.channel);
    const file = await this.options.library.resolve(input.path);
    if (!this.options.engine.isPlaying(projectId)) throw new HttpError(409, "This song is not loaded in the audio engine.");
    await this.options.engine.dropFiles(channel, [file]);
    return this.sound(projectId, channel);
  }

  /** What the channel's Serum has on now: its preset as Serum says (from its state), and its macros. */
  async sound(projectIdInput: unknown, channelInput: unknown): Promise<SerumSound> {
    const { projectId, channel } = this.target(projectIdInput, channelInput);
    const { engine } = this.options;
    const stateFile = await engine.channelStateFile(projectId, channel);
    const parameters = await engine.parameters("channel", channel);
    const macros = SERUM_MACRO_PARAMS.flatMap((param, index) => {
      const control = parameters.find((p) => p.id === param);
      return control ? [{ index, param, name: control.name, value: control.value, text: control.text }] : [];
    });
    return { preset: await presetOf(stateFile), macros };
  }

  private target(projectId: unknown, channel: unknown): { projectId: string; channel: string } {
    if (!isValidId(projectId) || !this.options.hasProject(projectId)) throw new HttpError(404, "There's no such project.");
    if (!isChannelId(channel)) throw new HttpError(400, '"channel" must be a channel\'s id.');
    return { projectId, channel };
  }
}

/** The preset a Serum state says it has on (its controller's name and the file it came from), or null if there's no state yet. */
async function presetOf(stateFile: string): Promise<SerumSound["preset"]> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await fs.readFile(stateFile));
  } catch {
    return null;
  }
  try {
    const { controller } = readPluginState(bytes);
    if (!controller) return null;
    const container = readXfer(controller);
    const settings = decodeCbor(container.settings);
    const name = typeof container.meta.presetName === "string" ? container.meta.presetName.trim() : "";
    const path = isPlainMap(settings) && typeof settings.selectedPresetPath === "string" && settings.selectedPresetPath ? settings.selectedPresetPath : null;
    return { name, path };
  } catch {
    // Not a Serum 2 state (the stand-in engine's, or another plugin's).
    return null;
  }
}

/** `/api/music/serum`: the Serum player's library, ratings, loading and sound. */
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
  return router;
}
