/**
 * Runs and supervises the photo helper (`helper-process.mjs`): JSON lines over its stdin/stdout, as the music
 * engine is run. It starts on the first request and again after it dies. The requests it died during are retried
 * one at a time, so a file that crashes it again can only be the one in flight: that one fails with the helper's
 * last words, and the others go through.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { lineLogger, log } from "../log.ts";
import { spawnStreaming } from "../process.ts";

/**
 * Deletes what a helper killed while writing `file` left beside it (`<file>.<pid>.<time>.tmp`, its atomic writes'
 * temporary files): a decoded 48 MP source's is hundreds of megabytes, an export's is in the user's folder. Called
 * once the request writing `file` has settled, so no helper is writing it.
 */
export async function removeLeftovers(file: string): Promise<void> {
  const prefix = `${path.basename(file)}.`;
  const names = await fs.readdir(path.dirname(file)).catch(() => [] as string[]);
  for (const name of names) {
    if (name.startsWith(prefix) && /^\d+\.\d+\.tmp$/.test(name.slice(prefix.length))) await fs.rm(path.join(path.dirname(file), name), { force: true });
  }
}

type Running = ReturnType<typeof spawnStreaming>;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cmd: string;
  args: Record<string, unknown>;
  retried: boolean;
  timer: NodeJS.Timeout;
}

export interface PhotoHelperOptions {
  /** How long one request may take (a 100 MP decode takes about a second). */
  timeoutMs?: number;
}

export class PhotoHelper {
  private running: Running | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** Requests waiting to be retried, alone, after a crash; and the one being retried now. */
  private readonly retries: number[] = [];
  private retrying: number | null = null;
  private readonly timeoutMs: number;
  private decoderName: string | null = null;
  /** Times it was started again after dying. */
  restarts = 0;
  private closed = false;

  constructor(private readonly command: string, options: PhotoHelperOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  get isRunning() {
    return this.running !== null;
  }

  /** The decoder's name and version (part of every decoded source's cache identity). */
  async decoder(): Promise<string> {
    this.decoderName ??= ((await this.request("version")) as { decoder: string }).decoder;
    return this.decoderName;
  }

  request<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error("The photo helper has been stopped."));
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => this.fail(id, new Error(`The photo helper took longer than ${this.timeoutMs / 1000} s to ${cmd}.`)), this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, cmd, args, retried: false, timer });
      this.send(id);
    });
  }

  close() {
    this.closed = true;
    this.running?.child.stdin?.end();
    this.running = null;
    for (const id of [...this.pending.keys()]) this.fail(id, new Error("The photo helper has been stopped."));
  }

  private send(id: number) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.start().stdin!.write(`${JSON.stringify({ id, cmd: pending.cmd, ...pending.args })}\n`);
  }

  private fail(id: number, error: Error) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(error);
    this.settled(id);
  }

  /** A request finished: if it was the retry in flight, the next retry goes. */
  private settled(id: number) {
    if (this.retrying !== id) return;
    this.retrying = null;
    this.retryNext();
  }

  private retryNext() {
    while (this.retrying === null && this.retries.length) {
      const id = this.retries.shift()!;
      if (!this.pending.has(id)) continue;
      this.retrying = id;
      this.send(id);
    }
  }

  private start() {
    if (this.running) return this.running.child;
    const running = spawnStreaming([this.command], "pipe", "pipe", { onStderr: lineLogger(log("photo-helper", { quiet: true })) });
    this.running = running;
    this.buffer = "";
    running.child.stdout!.setEncoding("utf8");
    running.child.stdout!.on("data", (chunk: string) => this.receive(chunk));
    running.done.then(
      () => this.exited(running, null),
      (error: Error) => this.exited(running, error),
    );
    return running.child;
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      let reply: { id: number; ok: boolean; result?: unknown; error?: string };
      try {
        reply = JSON.parse(line);
      } catch {
        continue; // not ours (a library printing to stdout)
      }
      const pending = this.pending.get(reply.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(reply.id);
      if (reply.ok) pending.resolve(reply.result);
      else pending.reject(new Error(reply.error ?? "The photo helper failed."));
      this.settled(reply.id);
    }
  }

  /**
   * It died (or quit). A request that was already being retried alone caused it: that one fails. The others
   * it had are queued to be retried, one at a time, on a new helper.
   */
  private exited(running: Running, error: Error | null) {
    if (this.running !== running) return;
    this.running = null;
    if (this.closed) return;
    this.restarts++;
    const reason = error?.message || "The photo helper stopped unexpectedly.";
    log("photo-helper").error(`stopped unexpectedly (restart ${this.restarts}): ${reason}`);
    if (this.retrying !== null) {
      const culprit = this.retrying;
      this.retrying = null;
      this.fail(culprit, new Error(`The photo helper crashed: ${reason}`));
    }
    for (const [id, pending] of [...this.pending]) {
      if (pending.retried) {
        if (!this.retries.includes(id)) this.fail(id, new Error(`The photo helper crashed: ${reason}`));
        continue;
      }
      pending.retried = true;
      this.retries.push(id);
    }
    this.retryNext();
  }
}
