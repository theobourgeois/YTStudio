/**
 * The lab's paint surface (F0; the suite's is `surface.ts`): an `rgba16f` surface the brush paints (docs/photo/architecture.md, "Edits, gestures and
 * strokes"). While a stroke lasts, the tiles it touches are *drafts*, copies of the committed tiles made on first
 * touch, and the view draws through them. At pointer up the drafts are read back, hashed in a Worker, and a new
 * manifest becomes the committed state at once (one undo step); uploading follows in the background. Undo and
 * redo switch manifests: tiles the atlas still has are reused, others fetched by hash.
 */
import { type BrushSettings, type Dab, DabSpacer, tilesUnder } from "@shared/photo/brush.ts";
import type { Size } from "@shared/photo/geometry.ts";
import { type SurfaceManifest, canonicalJson, constantValues, emptySurface, withTiles } from "@shared/photo/surfaces.ts";
import { BATCH, type RenderContext } from "./context.ts";
import { FILL, PENDING, VirtualImage } from "./image.ts";
import type { WorkerReply, WorkerRequest } from "./tile-worker.ts";

export interface StrokeResult {
  /** Pointer up → the new manifest is committed (read back, hashed, history updated). */
  commitMs: number;
  readbackMs: number;
  hashMs: number;
  tiles: number;
  /** Resolves when the server has the tiles and the manifest. */
  uploaded: Promise<{ ms: number; sent: number }>;
}

interface Draft {
  tx: number;
  ty: number;
  slot: number;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

/** A Worker with request/reply by id. */
class TileWorker {
  private readonly worker = new Worker(new URL("./tile-worker.ts", import.meta.url), { type: "module" });
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

export class PaintSurface {
  readonly image: VirtualImage;
  readonly id: number;
  manifest: SurfaceManifest;
  manifestId: string | null = null;
  /** Committed states: manifests by id, and where undo/redo stand. */
  private readonly history: { id: string; manifest: SurfaceManifest }[] = [];
  private position = -1;
  private readonly worker = new TileWorker();
  private drafts = new Map<string, Draft>();
  private spacer: DabSpacer | null = null;
  private readonly jobs: GPUBuffer;
  private dabs: GPUBuffer;
  private readonly params: GPUBuffer;
  private stampGroup: GPUBindGroup;
  private readonly stopListening: () => void;
  /** Uploads not yet acknowledged: a replacement surface (after a device loss) waits for them. */
  private readonly uploading = new Set<Promise<unknown>>();

  constructor(
    readonly ctx: RenderContext,
    readonly size: Size,
    /** `/api/photo/lab`: where tiles and manifests are uploaded and fetched. */
    readonly base: string,
  ) {
    this.id = ctx.id();
    this.image = new VirtualImage(ctx.device, size, ctx.tile, [0, 0, 0, 0], false, FILL, `paint ${this.id}`);
    this.manifest = emptySurface("rgba16f", ctx.tile, [0, 0, 0, 0]);
    this.jobs = ctx.device.createBuffer({ size: BATCH * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.dabs = ctx.device.createBuffer({ size: 4096 * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    // The stamp kernel's parameters (`kernels.ts`, `Params`: 80 bytes): the lab paints at the document's pixels, unselected.
    this.params = ctx.device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.stampGroup = this.makeStampGroup();
    // Committed tiles evicted from the atlas are fetched again by hash when needed (`ensureResident`).
    this.stopListening = ctx.atlas.onEvict((key, slot) => {
      if (!key.startsWith(`p${this.id}:`)) return;
      const [, tx, ty] = key.split(":").map(Number);
      // Only if it's the tile shown now (an older state's copy of the same tile may go quietly).
      if (this.image.slotOf(0, tx, ty) === slot) this.image.set(0, tx, ty, PENDING);
    });
  }

  private makeStampGroup() {
    return this.ctx.device.createBindGroup({
      layout: this.ctx.kernels.stamp.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: this.jobs } },
        { binding: 1, resource: { buffer: this.dabs } },
        { binding: 2, resource: this.ctx.scratchView },
        { binding: 3, resource: { buffer: this.params } },
      ],
    });
  }

  private tileKey(tx: number, ty: number, ref: string) {
    return `p${this.id}:${tx}:${ty}:${ref}`;
  }

  get painting() {
    return this.spacer !== null;
  }

  get canUndo() {
    return this.position >= 0;
  }

  get canRedo() {
    return this.position < this.history.length - 1;
  }

  /** Starts a stroke; `colour` is premultiplied linear RGBA. */
  begin(brush: BrushSettings, colour: readonly [number, number, number, number]) {
    if (this.spacer) this.cancel();
    this.spacer = new DabSpacer(brush);
    const params = new ArrayBuffer(80);
    new Float32Array(params, 0, 4).set(colour);
    new Uint32Array(params, 16, 2).set([this.ctx.tile, 0]);
    new Float32Array(params, 32, 8).set([1, 0, 0, 1, 0, 0, 1, 0]);
    this.ctx.device.queue.writeBuffer(this.params, 0, params);
  }

  /** Paints the dabs these pointer samples (document pixels) add. */
  add(points: readonly { x: number; y: number }[]) {
    if (!this.spacer) return;
    const dabs = points.flatMap((p) => this.spacer!.add(p.x, p.y));
    if (dabs.length) this.stampDabs(dabs);
  }

  private draftFor(tx: number, ty: number, encoder: GPUCommandEncoder): Draft {
    const key = `${tx},${ty}`;
    let draft = this.drafts.get(key);
    if (draft) return draft;
    const slot = this.ctx.atlas.acquire(`p${this.id}:${tx}:${ty}:draft${this.ctx.id()}`, true);
    const committed = this.image.slotOf(0, tx, ty);
    if (committed !== null) this.ctx.copySlot(encoder, committed, slot);
    else this.ctx.fillSlot(slot, this.committedValue(tx, ty));
    draft = { tx, ty, slot };
    this.drafts.set(key, draft);
    return draft;
  }

  /** The value of a tile the committed manifest lists as constant, or its fill. */
  private committedValue(tx: number, ty: number): number[] {
    const entry = this.manifest.tiles.find((e) => e[0] === tx && e[1] === ty);
    return (entry && constantValues(entry[2])) ?? this.manifest.fill;
  }

  private stampDabs(dabs: Dab[]) {
    const { device } = this.ctx;
    const touched = [...tilesUnder(dabs, this.ctx.tile).values()].filter(
      (t) => t.tx >= 0 && t.ty >= 0 && t.tx < this.image.levels[0].tilesX && t.ty < this.image.levels[0].tilesY,
    );
    if (dabs.length * 32 > this.dabs.size) {
      this.dabs.destroy();
      this.dabs = device.createBuffer({ size: dabs.length * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.stampGroup = this.makeStampGroup();
    }
    const dabData = new Float32Array(dabs.length * 8);
    dabs.forEach((d, i) => dabData.set([d.x, d.y, d.radius, d.hardness, d.strength], i * 8));
    device.queue.writeBuffer(this.dabs, 0, dabData);
    for (let i = 0; i < touched.length; i += BATCH) {
      const batch = touched.slice(i, i + BATCH);
      const encoder = device.createCommandEncoder({ label: "stamp" });
      const drafts = batch.map((t) => this.draftFor(t.tx, t.ty, encoder));
      const jobs = new ArrayBuffer(batch.length * 32);
      drafts.forEach((d, j) => {
        new Uint32Array(jobs, j * 32, 1)[0] = d.slot;
        new Int32Array(jobs, j * 32 + 4, 2).set([d.tx, d.ty]);
        new Uint32Array(jobs, j * 32 + 12, 2).set([0, dabs.length]);
      });
      device.queue.writeBuffer(this.jobs, 0, jobs);
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.ctx.kernels.stamp);
      pass.setBindGroup(0, this.ctx.atlasBindGroup());
      pass.setBindGroup(1, this.stampGroup);
      pass.dispatchWorkgroups(this.ctx.tile / 16, this.ctx.tile / 16, batch.length);
      pass.end();
      this.ctx.copyScratchToSlots(
        encoder,
        drafts.map((d) => d.slot),
      );
      device.queue.submit([encoder.finish()]);
      for (const d of drafts) this.image.setSlot(0, d.tx, d.ty, d.slot);
    }
    this.image.flush();
  }

  /** Drops the stroke: the committed tiles show again. */
  cancel() {
    for (const draft of this.drafts.values()) this.ctx.atlas.release(draft.slot);
    this.drafts.clear();
    this.spacer = null;
    this.showManifest(this.manifest);
  }

  /** Ends the stroke: reads the drafts back, hashes them, commits the new manifest, and starts uploading. */
  async end(): Promise<StrokeResult | null> {
    const started = performance.now();
    const drafts = [...this.drafts.values()];
    this.spacer = null;
    this.drafts = new Map();
    if (!drafts.length) return null;
    const { device } = this.ctx;
    const tileBytes = this.ctx.atlas.tileBytes;
    const readback = device.createBuffer({ size: drafts.length * tileBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder({ label: "stroke readback" });
    drafts.forEach((d, i) => {
      const { texture, layer } = this.ctx.atlas.location(d.slot);
      encoder.copyTextureToBuffer({ texture, origin: [0, 0, layer] }, { buffer: readback, offset: i * tileBytes, bytesPerRow: this.ctx.rowBytes }, [this.ctx.tile, this.ctx.tile, 1]);
    });
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const mapped = readback.getMappedRange();
    const tiles = drafts.map((_, i) => mapped.slice(i * tileBytes, (i + 1) * tileBytes));
    readback.unmap();
    readback.destroy();
    const readbackMs = performance.now() - started;
    const hashed = await this.worker.ask<Extract<WorkerReply, { type: "hash" }>>({ type: "hash", tiles, channels: 4 }, tiles);
    const manifest = withTiles(
      this.manifest,
      drafts.map((d, i) => [d.tx, d.ty, hashed.refs[i]] as [number, number, string]),
    );
    const json = canonicalJson(manifest);
    const { hash } = await this.worker.ask<Extract<WorkerReply, { type: "manifest" }>>({ type: "manifest", json });
    // The drafts become the committed tiles, named by what they hold.
    drafts.forEach((d, i) => {
      const key = this.tileKey(d.tx, d.ty, hashed.refs[i]);
      this.ctx.atlas.rename(d.slot, key);
    });
    this.commit(hash, manifest);
    const commitMs = performance.now() - started;
    const uploaded = this.worker
      .ask<Extract<WorkerReply, { type: "upload" }>>({ type: "upload", base: this.base, refs: hashed.refs, manifest: { hash, json } })
      .then((reply) => {
        if (!reply.ok) throw new Error(reply.error);
        // On the server now: the atlas may evict them (they'll be fetched by hash).
        for (const d of drafts) this.ctx.atlas.unpin(d.slot);
        return { ms: reply.ms, sent: reply.sent };
      });
    const settled = uploaded.catch(() => {});
    this.uploading.add(settled);
    void settled.finally(() => this.uploading.delete(settled));
    return { commitMs, readbackMs, hashMs: hashed.ms, tiles: drafts.length, uploaded };
  }

  private commit(id: string, manifest: SurfaceManifest) {
    this.history.splice(this.position + 1);
    this.history.push({ id, manifest });
    this.position = this.history.length - 1;
    this.manifest = manifest;
    this.manifestId = id;
  }

  undo() {
    if (!this.canUndo || this.painting) return;
    this.position--;
    const state = this.history[this.position];
    this.manifest = state?.manifest ?? emptySurface("rgba16f", this.ctx.tile, [0, 0, 0, 0]);
    this.manifestId = state?.id ?? null;
    this.showManifest(this.manifest);
  }

  redo() {
    if (!this.canRedo || this.painting) return;
    this.position++;
    const state = this.history[this.position];
    this.manifest = state.manifest;
    this.manifestId = state.id;
    this.showManifest(this.manifest);
  }

  /** Points every tile at its slot for `manifest`; tiles not in the atlas become pending until fetched. */
  private showManifest(manifest: SurfaceManifest) {
    const { tilesX, tilesY } = this.image.levels[0];
    for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) this.image.set(0, tx, ty, FILL);
    for (const [tx, ty, ref] of manifest.tiles) {
      const slot = this.ctx.atlas.get(this.tileKey(tx, ty, ref));
      if (slot !== null) this.image.setSlot(0, tx, ty, slot);
      else {
        const constant = constantValues(ref);
        if (constant) {
          const filled = this.ctx.atlas.acquire(this.tileKey(tx, ty, ref));
          this.ctx.fillSlot(filled, constant);
          this.image.setSlot(0, tx, ty, filled);
        } else this.image.set(0, tx, ty, PENDING);
      }
    }
    this.image.flush();
  }

  /** Fetches committed tiles that aren't resident (after an undo, or an eviction). */
  async ensureResident(): Promise<number> {
    const missing = this.manifest.tiles.filter(([tx, ty]) => this.image.entry(0, tx, ty) === PENDING);
    await Promise.all(
      missing.map(async ([tx, ty, ref]) => {
        const res = await fetch(`${this.base}/blobs/${ref}`);
        if (!res.ok) throw new Error(`Couldn't fetch tile ${ref} (${res.status})`);
        const data = await res.arrayBuffer();
        const slot = this.ctx.atlas.acquire(this.tileKey(tx, ty, ref));
        const { texture, layer } = this.ctx.atlas.location(slot);
        this.ctx.device.queue.writeTexture({ texture, origin: [0, 0, layer] }, data, { bytesPerRow: this.ctx.rowBytes }, [this.ctx.tile, this.ctx.tile, 1]);
        if (this.manifest.tiles.some((e) => e[0] === tx && e[1] === ty && e[2] === ref)) this.image.setSlot(0, tx, ty, slot);
      }),
    );
    this.image.flush();
    return missing.length;
  }

  /** Resolves when every stroke so far is on the server. */
  async uploadsDone() {
    while (this.uploading.size) await Promise.all([...this.uploading]);
  }

  /**
   * Takes over another surface's committed states (a surface on a new device, after the old one was lost):
   * its tiles are fetched from the server, where the old surface's uploads have put them.
   */
  async adopt(old: PaintSurface) {
    await old.uploadsDone();
    this.history.splice(0, this.history.length, ...old.history);
    this.position = old.position;
    this.manifest = old.manifest;
    this.manifestId = old.manifestId;
    this.showManifest(this.manifest);
    await this.ensureResident();
  }

  destroy() {
    this.stopListening();
    this.worker.terminate();
    this.image.destroy();
    this.jobs.destroy();
    this.dabs.destroy();
    this.params.destroy();
  }
}
