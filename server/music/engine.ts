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
import { ENGINE_SLOTS, type EngineCommand, type EnginePlugin, type EngineSlot, type EngineStatus, type LoadedPlugin } from "../../shared/music/engine.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { spawnStreaming } from "../process.ts";
import { type DataPaths, HttpError, isObject, readJson, writeJson } from "../storage.ts";

export interface EngineOptions {
  /** The engine's argv before its options (default: the built engine). Tests pass a fake. */
  command?: string[];
  pluginPaths?: string[];
}

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
type SavedStates = Partial<Record<EngineSlot, string>>;

const isSlot = (v: unknown): v is EngineSlot => ENGINE_SLOTS.includes(v as EngineSlot);

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
  private readonly argv: string[];
  private readonly pluginPaths: string[];

  constructor(
    private readonly paths: DataPaths,
    options: EngineOptions = {},
  ) {
    this.argv = options.command ?? [ENGINE];
    this.pluginPaths = options.pluginPaths ?? ENGINE_PLUGIN_PATHS;
  }

  /** Run a command from the tab (`POST /api/engine/:command`): validates it, and answers with the status. */
  async command(name: string, body: unknown): Promise<EngineStatus> {
    const input = isObject(body) ? body : {};
    const params = await this.params(name as EngineCommand, input);
    const status = (await this.request(name, params)) as RawStatus;
    if (name === "saveState") await this.remember(slotOf(input), status[slotOf(input)]?.id);
    return this.withSaved(status);
  }

  /** The plugins found by the last scan. */
  async plugins(): Promise<EnginePlugin[]> {
    return (await this.request("plugins", {})) as EnginePlugin[];
  }

  shutdown() {
    this.child?.stdin?.end();
    this.child?.kill();
    this.child = null;
  }

  /** A command's parameters for the engine, checked. Throws `HttpError(400)`. */
  private async params(name: EngineCommand, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (name) {
      case "status":
        return {};
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
    return { ...status, instrument: slot("instrument"), effect: slot("effect") };
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
    const args = ["--data", this.paths.engine, ...this.pluginPaths.filter((dir) => existsSync(dir)).flatMap((dir) => ["--plugin-path", dir])];
    const { child, done } = spawnStreaming([...this.argv, ...args], "pipe", "pipe");
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
          resolve();
        }
        const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
        if (!pending) return;
        this.pending.delete(message.id as number);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new HttpError(409, typeof message.error === "string" ? message.error : "The audio engine refused."));
      });
      done
        .catch((err: Error) => console.error(`[engine] ${err.message}`))
        .finally(() => {
          clearTimeout(timer);
          if (this.child === child) this.child = null;
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
