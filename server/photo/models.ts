/**
 * Select Subject's model (docs/photo/selections.md): an ONNX file downloaded once per computer into `MODELS_DIR`
 * (as the speech model is), its size and checksum checked before it's used, and served to the tab, which runs it.
 * Nothing is downloaded until the user asks (`setUp`).
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SUBJECT_MODEL, type SubjectModelStatus } from "../../shared/photo/subject.ts";
import { errorMessage } from "../../shared/errors.ts";

export class SubjectModel {
  private downloading: { progress: number } | null = null;
  private error: string | null = null;

  constructor(
    private readonly modelsDir: string,
    /** The tests' stand-in: the tab answers without a model, and nothing is downloaded. */
    private readonly standIn = false,
    private readonly model = SUBJECT_MODEL,
  ) {}

  get path() {
    return path.join(this.modelsDir, this.model.file);
  }

  private async present(): Promise<boolean> {
    const stat = await fs.stat(this.path).catch(() => null);
    return stat?.size === this.model.size;
  }

  async status(): Promise<SubjectModelStatus> {
    const base = { size: this.model.size, standIn: this.standIn, error: this.error };
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
        console.error("[photo] the subject model's download failed:", error);
        this.downloading = null;
        this.error = `The download failed: ${errorMessage(error)}`;
      },
    );
  }

  /** The file, once it's here (null until then). */
  async file(): Promise<string | null> {
    return !this.standIn && (await this.present()) ? this.path : null;
  }

  private async download(): Promise<void> {
    await fs.mkdir(this.modelsDir, { recursive: true });
    const part = `${this.path}.${process.pid}.part`;
    try {
      const res = await fetch(this.model.url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const hash = createHash("sha256");
      let received = 0;
      const count = new Transform({
        transform: (chunk: Buffer, _enc, done) => {
          received += chunk.length;
          hash.update(chunk);
          if (this.downloading) this.downloading.progress = Math.min(1, received / this.model.size);
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), count, createWriteStream(part));
      if (received !== this.model.size || hash.digest("hex") !== this.model.sha256) throw new Error("the file that arrived isn't the model (its size or checksum differs). Try again.");
      await fs.rename(part, this.path);
    } finally {
      await fs.rm(part, { force: true });
    }
  }
}
