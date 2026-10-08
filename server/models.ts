/**
 * A model the app runs on this computer (shared/models.ts: the photo suite's, which the tab runs; the music suite's,
 * which the server runs): its ONNX files (one, or several graphs and their weights) downloaded once per computer
 * into `MODELS_DIR` (as the speech model is), each one's size and checksum checked before it's used. Nothing is
 * downloaded until the user asks (`setUp`).
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { errorMessage } from "../shared/errors.ts";
import { type ModelFile, type ModelSpec, type ModelStatus, modelSize } from "../shared/models.ts";
import { log } from "./log.ts";

const logger = log("models");

export class DownloadedModel {
  private downloading: { progress: number } | null = null;
  private error: string | null = null;

  constructor(
    private readonly modelsDir: string,
    /** The tests' stand-in: its work is faked without a model, and nothing is downloaded. */
    private readonly standIn = false,
    private readonly model: ModelSpec,
  ) {}

  private pathOf(file: ModelFile) {
    return path.join(this.modelsDir, file.file);
  }

  private async here(file: ModelFile): Promise<boolean> {
    const stat = await fs.stat(this.pathOf(file)).catch(() => null);
    return stat?.size === file.size;
  }

  private async present(): Promise<boolean> {
    return (await Promise.all(this.model.files.map((f) => this.here(f)))).every(Boolean);
  }

  async status(): Promise<ModelStatus> {
    const base = { size: modelSize(this.model), standIn: this.standIn, error: this.error };
    if (this.standIn) return { ...base, status: "ready", progress: null };
    if (this.downloading) return { ...base, status: "downloading", progress: this.downloading.progress };
    if (await this.present()) return { ...base, status: "ready", progress: null, error: null };
    return { ...base, status: this.error ? "error" : "missing", progress: null };
  }

  /** Starts the download (once: a second call while it runs changes nothing). */
  async setUp(): Promise<void> {
    if (this.standIn || this.downloading || (await this.present())) return;
    this.downloading = { progress: 0 };
    this.error = null;
    void this.download().then(
      () => (this.downloading = null),
      (error: unknown) => {
        logger.error(`${this.model.command}'s model's download failed`, error);
        this.downloading = null;
        this.error = `The download failed: ${errorMessage(error)}`;
      },
    );
  }

  /** One of its files (by its `file` name; the first when none is named), once they're all here (null until then). */
  async file(name?: string): Promise<string | null> {
    const file = name === undefined ? this.model.files[0] : this.model.files.find((f) => f.file === name);
    return file && !this.standIn && (await this.present()) ? this.pathOf(file) : null;
  }

  /** Downloads the files that aren't here yet, one after another; progress counts every file's bytes. */
  private async download(): Promise<void> {
    await fs.mkdir(this.modelsDir, { recursive: true });
    const total = modelSize(this.model);
    let done = 0;
    for (const file of this.model.files) {
      if (!(await this.here(file))) await this.downloadFile(file, (received) => this.downloading && (this.downloading.progress = Math.min(1, (done + received) / total)));
      done += file.size;
    }
  }

  private async downloadFile(file: ModelFile, progress: (received: number) => void): Promise<void> {
    const target = this.pathOf(file);
    const part = `${target}.${process.pid}.part`;
    try {
      const res = await fetch(file.url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const hash = createHash("sha256");
      let received = 0;
      const count = new Transform({
        transform: (chunk: Buffer, _enc, next) => {
          received += chunk.length;
          hash.update(chunk);
          progress(received);
          next(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), count, createWriteStream(part));
      if (received !== file.size || hash.digest("hex") !== file.sha256) throw new Error(`the file that arrived isn't ${file.name} (its size or checksum differs). Try again.`);
      await fs.rename(part, target);
    } finally {
      await fs.rm(part, { force: true });
    }
  }
}
