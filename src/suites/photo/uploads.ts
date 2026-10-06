/**
 * A project's surfaces on their way to the server (docs/photo/architecture.md, "The publication gate"): tiles are
 * hashed in a Worker the moment a stroke ends (so the edit is committed at once) and uploaded in the background,
 * then their manifest. The autosaver awaits `ready(doc)` before saving, so a saved document only ever names pixels
 * the server has; a failed upload is retried then (the Worker keeps the tiles' bytes until the server has them).
 * Manifests made here, or fetched once, are kept: undo shows one without asking the server.
 *
 * It belongs to the project, not to the GPU: a lost device loses no stroke that was committed.
 */
import { errorMessage } from "@shared/errors";
import { type SurfaceManifest, canonicalJson, documentSurfaces, validateManifest } from "@shared/photo/surfaces";
import type { PhotoProject, SurfaceId } from "@shared/photo/types";
import type { WorkerReply, WorkerRequest } from "./render/tile-worker";

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

/** A Worker with request/reply by id. */
export class TileWorker {
  private readonly worker = new Worker(new URL("./render/tile-worker.ts", import.meta.url), { type: "module" });
  private next = 1;
  private readonly waiting = new Map<number, (reply: WorkerReply) => void>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      this.waiting.get(event.data.id)?.(event.data);
      this.waiting.delete(event.data.id);
    };
  }

  ask<T extends WorkerReply>(request: WithoutId<WorkerRequest>, transfer: Transferable[] = []): Promise<T> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve as (reply: WorkerReply) => void);
      this.worker.postMessage({ ...request, id }, transfer);
    });
  }

  terminate() {
    this.worker.terminate();
  }
}

/** A surface the tab made: its manifest's JSON and the tile hashes the Worker holds bytes for. */
interface Made {
  json: string;
  refs: string[];
  /** The upload under way, or done; a failed one is tried again by `ready`. */
  upload: Promise<void>;
  failed: string | null;
}

export class SurfaceUploads {
  readonly worker = new TileWorker();
  private readonly manifests = new Map<SurfaceId, SurfaceManifest>();
  private readonly fetching = new Map<SurfaceId, Promise<SurfaceManifest>>();
  private readonly made = new Map<SurfaceId, Made>();

  constructor(readonly projectId: string) {}

  get base() {
    return `/api/photo/projects/${this.projectId}`;
  }

  /**
   * Hashes tiles' raw samples (`channels` per texel, half floats): a hash each, or a constant tile's `c:` value
   * (stored as nothing). The Worker keeps the bytes of each hashed tile until it's uploaded.
   */
  async hash(tiles: ArrayBuffer[], channels: number): Promise<{ refs: string[]; ms: number }> {
    const reply = await this.worker.ask<Extract<WorkerReply, { type: "hash" }>>({ type: "hash", tiles, channels }, tiles);
    return { refs: reply.refs, ms: reply.ms };
  }

  /** A manifest's id (the SHA-256 of its canonical JSON), and the manifest kept for showing it again. */
  async add(manifest: SurfaceManifest, refs: readonly string[]): Promise<SurfaceId> {
    const json = canonicalJson(manifest);
    const { hash } = await this.worker.ask<Extract<WorkerReply, { type: "manifest" }>>({ type: "manifest", json });
    this.manifests.set(hash, manifest);
    if (!this.made.has(hash)) {
      const made: Made = { json, refs: [...refs], upload: Promise.resolve(), failed: null };
      made.upload = this.send(hash, made);
      this.made.set(hash, made);
    }
    return hash;
  }

  private async send(id: SurfaceId, made: Made): Promise<void> {
    const reply = await this.worker.ask<Extract<WorkerReply, { type: "upload" }>>({ type: "upload", base: this.base, refs: made.refs, manifest: { hash: id, json: made.json } });
    made.failed = reply.ok ? null : reply.error;
    if (!reply.ok) throw new Error(reply.error);
  }

  /**
   * Resolves once the server has every surface `doc` names (retrying any that failed): the publication gate. Throws
   * with the reason when one still can't be uploaded (the autosaver retries, and says the photo isn't saved).
   */
  async ready(doc: PhotoProject): Promise<void> {
    for (const id of documentSurfaces(doc)) {
      const made = this.made.get(id);
      if (!made) continue;
      try {
        await made.upload;
      } catch {
        made.upload = this.send(id, made);
        try {
          await made.upload;
        } catch (error) {
          throw new Error(`Its painted pixels couldn't be uploaded: ${errorMessage(error)}`);
        }
      }
    }
  }

  /** Resolves when every surface made so far is uploaded (or has failed). */
  async idle(): Promise<void> {
    await Promise.all([...this.made.values()].map((m) => m.upload.catch(() => {})));
  }

  /** A manifest, from what's known or from the server. */
  manifest(id: SurfaceId): Promise<SurfaceManifest> {
    const known = this.manifests.get(id);
    if (known) return Promise.resolve(known);
    let pending = this.fetching.get(id);
    if (!pending) {
      pending = (async () => {
        const res = await fetch(`${this.base}/manifests/${id}`);
        if (!res.ok) throw new Error(`Couldn't fetch surface ${id} (${res.status})`);
        const manifest = validateManifest(await res.json());
        if (typeof manifest === "string") throw new Error(`Surface ${id} is malformed: ${manifest}`);
        this.manifests.set(id, manifest);
        return manifest;
      })();
      pending.finally(() => this.fetching.delete(id)).catch(() => {});
      this.fetching.set(id, pending);
    }
    return pending;
  }

  /** A manifest if it's known here already (undo, redo: no waiting). */
  knownManifest(id: SurfaceId): SurfaceManifest | null {
    return this.manifests.get(id) ?? null;
  }

  /**
   * A tile's raw samples by hash: the Worker's copy while it waits to be uploaded, else the server's (after a
   * device loss, or an eviction).
   */
  async tile(hash: string): Promise<ArrayBuffer> {
    const reply = await this.worker.ask<Extract<WorkerReply, { type: "bytes" }>>({ type: "bytes", hash });
    if (reply.bytes) return reply.bytes;
    const res = await fetch(`${this.base}/blobs/${hash}`);
    if (!res.ok) throw new Error(`Couldn't fetch tile ${hash} (${res.status})`);
    return res.arrayBuffer();
  }

  /**
   * A surface of another project, made this one's too (a layer copied in one photo and pasted in another): its
   * tiles and manifest uploaded here, then known here.
   */
  async importFrom(source: SurfaceUploads, id: SurfaceId): Promise<void> {
    if (source === this || this.manifests.has(id)) return;
    const manifest = await source.manifest(id);
    const tiles = [...new Set(manifest.tiles.map((e) => e[2]).filter((ref) => !ref.startsWith("c:")))];
    for (const hash of tiles) {
      const res = await fetch(`${this.base}/blobs/${hash}`, { method: "PUT", body: await source.tile(hash), headers: { "Content-Type": "application/octet-stream" } });
      if (!res.ok) throw new Error(`Couldn't copy a tile (${res.status}): ${await res.text()}`);
    }
    const res = await fetch(`${this.base}/manifests/${id}`, { method: "PUT", body: canonicalJson(manifest), headers: { "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`Couldn't copy the pixels (${res.status}): ${await res.text()}`);
    this.manifests.set(id, manifest);
  }

  destroy() {
    this.worker.terminate();
  }
}

const byProject = new Map<string, SurfaceUploads>();

/** The project's uploads (one per project for the page's life: its pending uploads outlive the photo being closed). */
export function uploadsFor(projectId: string): SurfaceUploads {
  let uploads = byProject.get(projectId);
  if (!uploads) {
    uploads = new SurfaceUploads(projectId);
    byProject.set(projectId, uploads);
  }
  return uploads;
}
