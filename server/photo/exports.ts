/**
 * Banded exports (docs/photo/architecture.md, "Exporting"): the tab renders the image a band of rows at a time
 * and sends each as it's made, so neither side holds the whole image; `finish` has the helper encode them. The
 * file is written beside its destination and renamed into place only once it's complete, so a failed export never
 * replaces a good file.
 */
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { ExportRequest, ExportResult } from "../../shared/photo/lab.ts";
import { HttpError } from "../storage.ts";
import { type PhotoHelper, removeLeftovers } from "./helper.ts";

const EXPORT_NAME = /^[\w .,()'&+-]{1,120}\.(png|jpe?g)$/i;
const MAX_PIXELS = 400_000_000;

export interface ExportJob {
  request: ExportRequest;
  /** The raw samples as they arrive. */
  samples: string;
  /** Where the file goes. */
  out: string;
  rows: Set<number>;
  owner: string | null;
  /** When it was begun or last sent rows (ms): one quiet for `ABANDONED_MS` was left by a tab that's gone. */
  touched: number;
}

/** An export sent nothing for this long is let go (its tab closed or crashed mid-render). */
export const ABANDONED_MS = 10 * 60_000;

export class PhotoExports {
  private readonly jobs = new Map<string, ExportJob>();
  private readonly done = new Map<string, { file: string; name: string; owner: string | null }>();
  /** The files exports are writing now (from begin to the end of finish or cancel): one at a time each. */
  private readonly writing = new Set<string>();

  constructor(
    readonly helper: PhotoHelper,
    /** Where files with no destination are kept to be downloaded, and samples are gathered. */
    readonly folder: string,
  ) {}

  /** Starts an export into `destination` (an absolute path, from the save dialog) or the export folder. */
  async begin(request: ExportRequest, options: { destination?: string | null; owner?: string | null; now?: number } = {}): Promise<string> {
    const now = options.now ?? Date.now();
    for (const [id, job] of this.jobs) if (now - job.touched > ABANDONED_MS) await this.cancel(id);
    if (!EXPORT_NAME.test(request.name)) throw new HttpError(400, "Name the export like name.png or name.jpg.");
    if (!Number.isInteger(request.width) || !Number.isInteger(request.height) || request.width < 1 || request.height < 1) {
      throw new HttpError(400, "width and height must be positive integers.");
    }
    if (request.width * request.height > MAX_PIXELS) throw new HttpError(400, "An export is at most 400 megapixels.");
    let out: string;
    if (options.destination) {
      if (!path.isAbsolute(options.destination)) throw new HttpError(400, "destination must be an absolute path.");
      out = options.destination;
    } else out = path.join(this.folder, `${randomBytes(6).toString("hex")}-${request.name}`);
    if (this.writing.has(path.resolve(out))) throw new HttpError(409, `Another export is writing ${path.basename(out)} now: wait for it to finish, or choose another name.`);
    await fs.mkdir(this.folder, { recursive: true });
    const id = randomBytes(8).toString("hex");
    const samples = path.join(this.folder, `samples-${id}.raw`);
    await fs.writeFile(samples, "");
    this.jobs.set(id, { request, samples, out, rows: new Set(), owner: options.owner ?? null, touched: now });
    this.writing.add(path.resolve(out));
    return id;
  }

  job(id: string): ExportJob {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, "No such export: begin one first.");
    return job;
  }

  /** Writes rows `from`.. (sRGB-encoded RGBA at the export's depth, top to bottom) where they belong. */
  async rows(id: string, from: number, samples: Buffer) {
    const job = this.job(id);
    const rowBytes = job.request.width * 4 * (job.request.bits / 8);
    const count = samples.length / rowBytes;
    if (!Number.isInteger(from) || !Number.isInteger(count) || from < 0 || count < 1 || from + count > job.request.height) {
      throw new HttpError(400, `Send whole rows (${rowBytes} bytes each) within 0..${job.request.height}.`);
    }
    const handle = await fs.open(job.samples, "r+");
    try {
      await handle.write(samples, 0, samples.length, from * rowBytes);
    } finally {
      await handle.close();
    }
    for (let y = from; y < from + count; y++) job.rows.add(y);
    job.touched = Date.now();
  }

  /** Encodes a finished export. */
  async finish(id: string): Promise<ExportResult & { path: string }> {
    const job = this.job(id);
    this.jobs.delete(id);
    const { request } = job;
    try {
      if (job.rows.size !== request.height) throw new HttpError(400, `Only ${job.rows.size} of ${request.height} rows were sent.`);
      const result = await this.helper.request<Omit<ExportResult, "name">>("encode", {
        raw: job.samples,
        out: job.out,
        width: request.width,
        height: request.height,
        channels: 4,
        bits: request.bits,
        format: request.format,
        quality: request.quality,
      });
      this.done.set(id, { file: job.out, name: request.name, owner: job.owner });
      return { name: request.name, ...result, path: job.out };
    } catch (error) {
      throw error instanceof HttpError ? error : new HttpError(400, (error as Error).message);
    } finally {
      await fs.rm(job.samples, { force: true });
      // A helper killed mid-encode (and retried) leaves its half-written file beside the destination.
      await removeLeftovers(job.out).catch(() => {});
      this.writing.delete(path.resolve(job.out));
    }
  }

  async cancel(id: string) {
    const job = this.jobs.get(id);
    this.jobs.delete(id);
    if (!job) return;
    this.writing.delete(path.resolve(job.out));
    await fs.rm(job.samples, { force: true });
  }

  /** A finished export's file, to download or compare. */
  file(id: string): { file: string; name: string; owner: string | null } {
    const done = this.done.get(id);
    if (!done) throw new HttpError(404, "No such finished export.");
    return done;
  }

  /** Lets go of a finished export whose file has gone elsewhere (adopted as media). */
  forget(id: string) {
    this.done.delete(id);
  }

  stream(id: string) {
    return createReadStream(this.file(id).file);
  }
}
