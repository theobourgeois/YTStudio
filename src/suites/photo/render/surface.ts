/**
 * A surface on the GPU (docs/photo/architecture.md, "Resources" and "Edits, gestures and strokes"): a pixel layer's
 * painted pixels or a mask's coverage, shown from a manifest whose tiles are found by hash. Tiles live in the
 * atlas under their hash (`t:` keys, shared by every surface that has the same tile, so undo and duplicates cost
 * nothing) or are constant (`c:`, a filled slot) or the fill (no slot at all). Its levels (the pyramid the view
 * reads when zoomed out) are built from level 0 with `reduce`, kept per surface, rebuilt where level 0 changed.
 *
 * A stroke paints *drafts*: copies of the shown tiles, made on first touch, which the view draws through. At its end
 * the drafts are read back, hashed in the Worker (`uploads.ts`), and the new manifest's id is what's committed (one
 * undo step); uploading follows. A cancelled stroke drops its drafts: nothing changed. A mask is `r16f`: the GPU
 * keeps its value in every channel of an RGBA tile, and reads back and uploads the first channel alone.
 */
import { type BrushSettings, type Dab, DabSpacer, tilesUnder } from "@shared/photo/brush.ts";
import type { Size } from "@shared/photo/geometry.ts";
import { fromHalf, toHalf } from "@shared/photo/half.ts";
import type { Affine } from "@shared/photo/layers.ts";
import { selectionBox } from "@shared/photo/selection.ts";
import { type SurfaceManifest, type TileEntry, constantRef, constantValues, emptySurface, withTiles } from "@shared/photo/surfaces.ts";
import type { PhotoSelection, SurfaceId } from "@shared/photo/types.ts";
import type { SurfaceUploads } from "../uploads.ts";
import { BATCH, type RenderContext } from "./context.ts";
import { FILL, PENDING, VirtualImage } from "./image.ts";

export type SurfaceKind = "pixels" | "mask";

/** What a surface's stored tiles are, and what an empty one is filled with. */
const KINDS: Record<SurfaceKind, { format: "rgba16f" | "r16f"; channels: number; fill: number[] }> = {
  pixels: { format: "rgba16f", channels: 4, fill: [0, 0, 0, 0] },
  mask: { format: "r16f", channels: 1, fill: [1] },
};

/** Where a surface is: its pixels → document pixels, for the selection limiting a stroke or making a mask. */
export interface SurfacePlace {
  matrix: Affine;
}

interface Draft {
  tx: number;
  ty: number;
  /** What the view shows. */
  slot: number;
  /**
   * With a selection: the stroke painted without limit, and the tile as it was before the stroke; what's shown is
   * the two mixed by the selection's coverage (`limit`).
   */
  paint: number | null;
  base: number | null;
}

const rightAngled = (m: Affine) => (m[1] === 0 && m[2] === 0) || (m[0] === 0 && m[3] === 0);

/** The 80 bytes of the stamp and mask-fill kernels' `Params`. */
function packParams(tile: number, colour: readonly number[], place: SurfacePlace, selection: PhotoSelection | null): ArrayBuffer {
  const data = new ArrayBuffer(80);
  const f = new Float32Array(data);
  const u = new Uint32Array(data);
  f.set(colour, 0);
  u[4] = tile;
  u[5] = selection ? 1 : 0;
  const m = place.matrix;
  f.set([m[0], m[1], m[2], m[3], m[4], m[5], rightAngled(m) ? 1 : 0, 0], 8);
  if (selection) f.set([selection.x, selection.y, selection.width, selection.height], 16);
  return data;
}

export class SurfaceImage {
  readonly image: VirtualImage;
  readonly id: number;
  readonly preview = null;
  /** What it shows: a surface id, or null (empty: all fill). */
  shown: SurfaceId | null = null;
  manifest: SurfaceManifest;
  /** Bumped whenever what it shows changes (a stroke's dabs, tiles arriving): the screen's kept composites go. */
  onChange: (() => void) | null = null;
  private drafts = new Map<string, Draft>();
  private stroke: { spacer: DabSpacer; place: SurfacePlace; limited: boolean } | null = null;
  /** Level-0 tiles listed by the manifest that aren't resident, being fetched. */
  private readonly fetching = new Set<string>();
  /** Parent tiles to build again (`level:tx:ty`): level 0 under them changed. */
  private readonly dirty = new Set<string>();
  private readonly jobs: GPUBuffer;
  private dabs: GPUBuffer;
  private readonly params: GPUBuffer;
  private stampGroup: GPUBindGroup;
  private limitGroup: GPUBindGroup;
  /** The limit pass's jobs (its own: a stamp's and a limit's jobs go in one submission). */
  private readonly limitJobs: GPUBuffer;
  private readonly fillGroup: GPUBindGroup;
  private readonly reduceJobs: GPUBuffer;
  private readonly reduceGroup: GPUBindGroup;
  private readonly stopListening: () => void;
  private destroyed = false;
  /** The latest `show`: an older one finishing late (its manifest fetched) changes nothing. */
  private showing = 0;
  /** The fill the GPU's image has (a manifest's own: a mask from a selection is 0 outside it). */
  private gpuFill: string;

  constructor(
    readonly ctx: RenderContext,
    readonly size: Size,
    readonly kind: SurfaceKind,
    readonly uploads: SurfaceUploads,
  ) {
    const { device } = ctx;
    this.id = ctx.id();
    const fill = KINDS[kind].fill;
    this.manifest = emptySurface(KINDS[kind].format, ctx.tile, fill);
    this.gpuFill = fill.join();
    this.image = new VirtualImage(device, size, ctx.tile, this.gpuValue(fill), true, FILL, `${kind} ${this.id}`);
    this.jobs = device.createBuffer({ size: BATCH * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.dabs = device.createBuffer({ size: 1024 * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.params = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.limitJobs = device.createBuffer({ size: BATCH * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.stampGroup = this.makeStampGroup(this.jobs);
    this.limitGroup = this.makeStampGroup(this.limitJobs);
    this.fillGroup = device.createBindGroup({
      layout: ctx.kernels.maskFill.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.jobs } },
        { binding: 1, resource: ctx.scratchView },
        { binding: 2, resource: { buffer: this.params } },
      ],
    });
    this.reduceJobs = device.createBuffer({ size: BATCH * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.reduceGroup = device.createBindGroup({
      layout: ctx.kernels.reduce.getBindGroupLayout(2),
      entries: [
        { binding: 0, resource: { buffer: this.reduceJobs } },
        { binding: 1, resource: ctx.scratchView },
      ],
    });
    // A tile whose slot is taken for something else: level 0 is fetched again by hash, levels above rebuilt.
    this.stopListening = ctx.atlas.onEvict((key, slot) => {
      if (key.startsWith(`q${this.id}:`)) {
        const [, level, tx, ty] = key.split(":").map(Number);
        this.image.set(level, tx, ty, PENDING);
        this.dirty.add(`${level}:${tx}:${ty}`);
      } else if (key.startsWith(this.keyPrefix)) {
        for (const e of this.manifest.tiles) {
          if (this.image.slotOf(0, e[0], e[1]) === slot) {
            this.image.set(0, e[0], e[1], PENDING);
            this.markParents(e[0], e[1]);
          }
        }
      }
    });
  }

  /** The surface's pixel size (a `Drawable`'s). */
  get width() {
    return this.size.width;
  }

  get height() {
    return this.size.height;
  }

  /** Atlas keys of stored and constant tiles: per kind (a mask's tile and a pixel tile are different bytes). */
  private get keyPrefix() {
    return `${this.kind}:`;
  }

  private tileKey(ref: string) {
    return `${this.keyPrefix}${ref}`;
  }

  /** A stored value (a mask's one channel) as the GPU's RGBA. */
  private gpuValue(values: readonly number[]): [number, number, number, number] {
    return this.kind === "mask" ? [values[0], values[0], values[0], values[0]] : [values[0], values[1], values[2], values[3]];
  }

  private makeStampGroup(jobs: GPUBuffer) {
    return this.ctx.device.createBindGroup({
      layout: this.ctx.kernels.stamp.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: jobs } },
        { binding: 1, resource: { buffer: this.dabs } },
        { binding: 2, resource: this.ctx.scratchView },
        { binding: 3, resource: { buffer: this.params } },
      ],
    });
  }

  get painting() {
    return this.stroke !== null;
  }

  // --- showing a manifest ---

  /**
   * Shows surface `id` (null: empty). A manifest made or seen here shows at once (undo, redo); another is fetched
   * first. Tiles the atlas has are reused by hash; the others are fetched (`ensureResident`). A stroke in progress
   * is dropped.
   */
  async show(id: SurfaceId | null): Promise<void> {
    if (this.stroke) this.cancel();
    const token = ++this.showing;
    if (id === this.shown) return;
    const manifest = id ? (this.uploads.knownManifest(id) ?? (await this.uploads.manifest(id))) : emptySurface(KINDS[this.kind].format, this.ctx.tile, KINDS[this.kind].fill);
    if (token !== this.showing || this.destroyed) return;
    this.shown = id;
    this.showManifest(manifest);
    void this.ensureResident().catch((error: unknown) => console.error("[photo] couldn't fetch a surface's tiles", error));
  }

  private showManifest(manifest: SurfaceManifest) {
    this.manifest = manifest;
    if (manifest.fill.join() !== this.gpuFill) {
      this.gpuFill = manifest.fill.join();
      this.image.setFill(this.gpuValue(manifest.fill));
    }
    const { tilesX, tilesY } = this.image.levels[0];
    const listed = new Map(manifest.tiles.map((e) => [`${e[0]},${e[1]}`, e]));
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const entry = listed.get(`${tx},${ty}`);
        const old = this.image.entry(0, tx, ty);
        const next = entry ? this.slotFor(entry) : FILL;
        if (next !== old) {
          this.image.set(0, tx, ty, next);
          this.markParents(tx, ty);
        }
      }
    }
    this.image.flush();
    this.buildLevels();
    this.onChange?.();
  }

  /** A listed tile's page entry: its slot when the atlas has it (a constant is filled now), else PENDING. */
  private slotFor([, , ref]: TileEntry): number {
    const key = this.tileKey(ref);
    const slot = this.ctx.atlas.get(key);
    if (slot !== null) return slot + 1;
    const constant = constantValues(ref);
    if (constant) {
      const filled = this.ctx.atlas.acquire(key);
      this.ctx.fillSlot(filled, this.gpuValue(constant));
      return filled + 1;
    }
    return PENDING;
  }

  /** Whether every tile it shows is on the GPU (only then is a render of it final). */
  get settled(): boolean {
    return this.manifest.tiles.every(([tx, ty]) => this.image.entry(0, tx, ty) !== PENDING) && this.dirty.size === 0;
  }

  /** Fetches the shown tiles that aren't resident (after an undo to a state not seen here, or an eviction). */
  async ensureResident(): Promise<number> {
    const missing = this.manifest.tiles.filter(([tx, ty, ref]) => this.image.entry(0, tx, ty) === PENDING && !this.fetching.has(ref));
    if (!missing.length) {
      this.buildLevels();
      return 0;
    }
    const manifest = this.manifest;
    for (const e of missing) this.fetching.add(e[2]);
    try {
      await Promise.all(
        missing.map(async ([tx, ty, ref]) => {
          const bytes = await this.uploads.tile(ref);
          if (this.destroyed) return;
          const key = this.tileKey(ref);
          const slot = this.ctx.atlas.acquire(key);
          this.write(slot, bytes);
          // Still what's shown there?
          if (this.manifest === manifest || this.manifest.tiles.some((e) => e[0] === tx && e[1] === ty && e[2] === ref)) {
            this.image.setSlot(0, tx, ty, slot);
            this.markParents(tx, ty);
          }
        }),
      );
    } finally {
      for (const e of missing) this.fetching.delete(e[2]);
    }
    if (this.destroyed) return 0;
    this.image.flush();
    this.buildLevels();
    this.onChange?.();
    return missing.length;
  }

  /** A stored tile's raw samples into a slot (a mask's one channel spread across RGBA). */
  private write(slot: number, bytes: ArrayBuffer) {
    const { texture, layer } = this.ctx.atlas.location(slot);
    const tile = this.ctx.tile;
    const f32 = this.ctx.format === "rgba32float";
    const halves = new Uint16Array(bytes);
    let data: ArrayBufferView<ArrayBuffer>;
    if (this.kind === "mask") {
      if (f32) {
        const out = new Float32Array(tile * tile * 4);
        for (let i = 0; i < tile * tile; i++) out.fill(fromHalf(halves[i]), i * 4, i * 4 + 4);
        data = out;
      } else {
        const out = new Uint16Array(tile * tile * 4);
        for (let i = 0; i < tile * tile; i++) out.fill(halves[i], i * 4, i * 4 + 4);
        data = out;
      }
    } else if (f32) {
      data = Float32Array.from(halves, fromHalf);
    } else data = halves;
    this.ctx.device.queue.writeTexture({ texture, origin: [0, 0, layer] }, data, { bytesPerRow: this.ctx.rowBytes }, [tile, tile, 1]);
  }

  // --- levels ---

  private markParents(tx: number, ty: number) {
    for (let level = 1; level < this.image.levels.length; level++) {
      tx >>= 1;
      ty >>= 1;
      this.dirty.add(`${level}:${tx}:${ty}`);
    }
  }

  /**
   * Builds the dirty parents whose children are all there, level by level: a parent of four fills is the fill, the
   * others the 2 × 2 box of their children (the sources' pyramid, `reduce`).
   */
  buildLevels() {
    if (!this.dirty.size) return;
    const { atlas, device } = this.ctx;
    for (let level = 1; level < this.image.levels.length; level++) {
      const below = this.image.levels[level - 1];
      const ready: { tx: number; ty: number }[] = [];
      for (const key of this.dirty) {
        const [l, tx, ty] = key.split(":").map(Number);
        if (l !== level) continue;
        let complete = true;
        let allFill = true;
        for (let cy = 2 * ty; cy < Math.min(2 * ty + 2, below.tilesY); cy++) {
          for (let cx = 2 * tx; cx < Math.min(2 * tx + 2, below.tilesX); cx++) {
            const e = this.image.entry(level - 1, cx, cy);
            if (e === PENDING) complete = false;
            if (e !== FILL) allFill = false;
          }
        }
        if (!complete) continue;
        this.dirty.delete(key);
        if (allFill) {
          const slot = atlas.get(`q${this.id}:${level}:${tx}:${ty}`);
          if (slot !== null) atlas.release(slot);
          this.image.set(level, tx, ty, FILL);
        } else ready.push({ tx, ty });
      }
      for (let i = 0; i < ready.length; i += BATCH) {
        const batch = ready.slice(i, i + BATCH);
        device.queue.writeBuffer(this.reduceJobs, 0, new Uint32Array(batch.flatMap((t) => [t.tx, t.ty, level, 0])));
        const slots = batch.map((t) => atlas.acquire(`q${this.id}:${level}:${t.tx}:${t.ty}`));
        // Children evicted by those acquisitions are pending again: their parent waits for them.
        if (batch.some((t) => !this.childrenResident(level, t.tx, t.ty))) {
          for (const t of batch) this.dirty.add(`${level}:${t.tx}:${t.ty}`);
          continue;
        }
        this.image.flush();
        const encoder = device.createCommandEncoder({ label: "surface levels" });
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.ctx.kernels.reduce);
        pass.setBindGroup(0, this.ctx.atlasBindGroup());
        pass.setBindGroup(1, this.ctx.imageBindGroup(this.image));
        pass.setBindGroup(2, this.reduceGroup);
        pass.dispatchWorkgroups(this.ctx.tile / 16, this.ctx.tile / 16, batch.length);
        pass.end();
        this.ctx.copyScratchToSlots(encoder, slots);
        device.queue.submit([encoder.finish()]);
        batch.forEach((t, j) => this.image.setSlot(level, t.tx, t.ty, slots[j]));
      }
      this.image.flush();
    }
  }

  private childrenResident(level: number, tx: number, ty: number) {
    const below = this.image.levels[level - 1];
    for (let cy = 2 * ty; cy < Math.min(2 * ty + 2, below.tilesY); cy++) {
      for (let cx = 2 * tx; cx < Math.min(2 * tx + 2, below.tilesX); cx++) if (this.image.entry(level - 1, cx, cy) === PENDING) return false;
    }
    return true;
  }

  // --- strokes ---

  /**
   * Starts a stroke with `colour` (premultiplied linear RGBA; a mask's is its value in every channel), `place`
   * mapping this surface's pixels to the document, and the selection limiting it (or null: everywhere).
   */
  begin(brush: BrushSettings, colour: readonly number[], place: SurfacePlace, selection: PhotoSelection | null) {
    if (this.stroke) this.cancel();
    this.stroke = { spacer: new DabSpacer(brush), place, limited: selection !== null };
    this.ctx.device.queue.writeBuffer(this.params, 0, packParams(this.ctx.tile, colour, place, selection));
  }

  /** Paints the dabs these samples (in this surface's pixels) add. */
  add(points: readonly { x: number; y: number }[]) {
    if (!this.stroke) return;
    const dabs = points.flatMap((p) => this.stroke!.spacer.add(p.x, p.y));
    if (dabs.length) this.stampDabs(dabs);
  }

  private draftFor(tx: number, ty: number, encoder: GPUCommandEncoder): Draft {
    const key = `${tx},${ty}`;
    let draft = this.drafts.get(key);
    if (draft) return draft;
    const copy = () => {
      const slot = this.ctx.atlas.acquire(`d${this.id}:${tx}:${ty}:${this.ctx.id()}`, true);
      const shown = this.image.slotOf(0, tx, ty);
      if (shown !== null) this.ctx.copySlot(encoder, shown, slot);
      else this.ctx.fillSlot(slot, this.gpuValue(this.shownValue(tx, ty)));
      return slot;
    };
    const limited = this.stroke?.limited ?? false;
    draft = { tx, ty, slot: copy(), paint: limited ? copy() : null, base: limited ? copy() : null };
    this.drafts.set(key, draft);
    return draft;
  }

  /** The value of a tile the manifest lists as constant, or its fill (a tile with no slot yet). */
  private shownValue(tx: number, ty: number): number[] {
    const entry = this.manifest.tiles.find((e) => e[0] === tx && e[1] === ty);
    return (entry && constantValues(entry[2])) ?? this.manifest.fill;
  }

  private inGrid(t: { tx: number; ty: number }) {
    const l = this.image.levels[0];
    return t.tx >= 0 && t.ty >= 0 && t.tx < l.tilesX && t.ty < l.tilesY;
  }

  private stampDabs(dabs: Dab[]) {
    const { device } = this.ctx;
    const touched = [...tilesUnder(dabs, this.ctx.tile).values()].filter((t) => this.inGrid(t));
    if (!touched.length) return;
    if (dabs.length * 32 > this.dabs.size) {
      this.dabs.destroy();
      this.dabs = device.createBuffer({ size: dabs.length * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.stampGroup = this.makeStampGroup(this.jobs);
      this.limitGroup = this.makeStampGroup(this.limitJobs);
    }
    const dabData = new Float32Array(dabs.length * 8);
    dabs.forEach((d, i) => dabData.set([d.x, d.y, d.radius, d.hardness, d.strength], i * 8));
    device.queue.writeBuffer(this.dabs, 0, dabData);
    for (let i = 0; i < touched.length; i += BATCH) {
      const batch = touched.slice(i, i + BATCH);
      const encoder = device.createCommandEncoder({ label: "stamp" });
      const drafts = batch.map((t) => this.draftFor(t.tx, t.ty, encoder));
      // With a selection the dabs go on the unlimited paint, and what's shown is mixed from it (`limit`).
      const limited = drafts[0].paint !== null;
      const jobs = new ArrayBuffer(batch.length * 32);
      drafts.forEach((d, j) => {
        new Uint32Array(jobs, j * 32, 1)[0] = d.paint ?? d.slot;
        new Int32Array(jobs, j * 32 + 4, 2).set([d.tx, d.ty]);
        new Uint32Array(jobs, j * 32 + 12, 2).set([0, dabs.length]);
      });
      device.queue.writeBuffer(this.jobs, 0, jobs);
      const stamp = encoder.beginComputePass();
      stamp.setPipeline(this.ctx.kernels.stamp);
      stamp.setBindGroup(0, this.ctx.atlasBindGroup());
      stamp.setBindGroup(1, this.stampGroup);
      stamp.dispatchWorkgroups(this.ctx.tile / 16, this.ctx.tile / 16, batch.length);
      stamp.end();
      this.ctx.copyScratchToSlots(
        encoder,
        drafts.map((d) => d.paint ?? d.slot),
      );
      if (limited) {
        const limits = new ArrayBuffer(batch.length * 32);
        drafts.forEach((d, j) => {
          new Uint32Array(limits, j * 32, 1)[0] = d.paint!;
          new Int32Array(limits, j * 32 + 4, 2).set([d.tx, d.ty]);
          new Uint32Array(limits, j * 32 + 12, 1)[0] = d.base!;
        });
        device.queue.writeBuffer(this.limitJobs, 0, limits);
        const limit = encoder.beginComputePass();
        limit.setPipeline(this.ctx.kernels.limit);
        limit.setBindGroup(0, this.ctx.atlasBindGroup());
        limit.setBindGroup(1, this.limitGroup);
        limit.dispatchWorkgroups(this.ctx.tile / 16, this.ctx.tile / 16, batch.length);
        limit.end();
        this.ctx.copyScratchToSlots(
          encoder,
          drafts.map((d) => d.slot),
        );
      }
      device.queue.submit([encoder.finish()]);
      for (const d of drafts) {
        this.image.setSlot(0, d.tx, d.ty, d.slot);
        this.markParents(d.tx, d.ty);
      }
    }
    this.image.flush();
    this.buildLevels();
    this.onChange?.();
  }

  /** A draft's working copies, let go (the stroke ended or was dropped). */
  private releaseWork(draft: Draft) {
    if (draft.paint !== null) this.ctx.atlas.release(draft.paint);
    if (draft.base !== null) this.ctx.atlas.release(draft.base);
  }

  /** Drops the stroke: the shown tiles show again, and nothing changed. */
  cancel() {
    for (const draft of this.drafts.values()) {
      this.ctx.atlas.release(draft.slot);
      this.releaseWork(draft);
    }
    const touched = [...this.drafts.values()];
    this.drafts.clear();
    this.stroke = null;
    for (const d of touched) {
      const entry = this.manifest.tiles.find((e) => e[0] === d.tx && e[1] === d.ty);
      this.image.set(0, d.tx, d.ty, entry ? this.slotFor(entry) : FILL);
      this.markParents(d.tx, d.ty);
    }
    this.image.flush();
    this.buildLevels();
    void this.ensureResident().catch(() => {});
    this.onChange?.();
  }

  /**
   * Ends the stroke: the drafts read back and hashed, a new manifest made and kept (`uploads`), its upload started.
   * Resolves with the new surface's id, which the caller commits (null: nothing was painted).
   */
  async end(): Promise<{ id: SurfaceId; tiles: number; readbackMs: number; hashMs: number } | null> {
    const drafts = [...this.drafts.values()];
    this.stroke = null;
    this.drafts = new Map();
    for (const d of drafts) this.releaseWork(d);
    if (!drafts.length) return null;
    return this.commitDrafts(drafts);
  }

  private async commitDrafts(drafts: Draft[]) {
    const started = performance.now();
    const tiles = await this.readBack(drafts);
    const readbackMs = performance.now() - started;
    const hashed = await this.uploads.hash(tiles, KINDS[this.kind].channels);
    const entries = drafts.map((d, i) => [d.tx, d.ty, hashed.refs[i]] as TileEntry);
    const manifest = withTiles(this.manifest, entries);
    const id = await this.uploads.add(manifest, hashed.refs);
    // The drafts become the tiles they hold, named by hash (a tile the atlas has already is that one).
    drafts.forEach((d, i) => {
      const key = this.tileKey(hashed.refs[i]);
      const existing = this.ctx.atlas.get(key);
      if (existing !== null && existing !== d.slot) {
        this.ctx.atlas.release(d.slot);
        this.image.setSlot(0, d.tx, d.ty, existing);
      } else {
        this.ctx.atlas.rename(d.slot, key);
        // The Worker keeps its bytes until it's uploaded: the GPU's copy may be evicted now.
        this.ctx.atlas.unpin(d.slot);
      }
    });
    this.image.flush();
    this.shown = id;
    this.manifest = manifest;
    this.showing++;
    return { id, tiles: drafts.length, readbackMs, hashMs: hashed.ms };
  }

  /** The drafts' samples as the surface stores them (RGBA halves, or a mask's first channel). */
  private async readBack(drafts: readonly Draft[]): Promise<ArrayBuffer[]> {
    const { device } = this.ctx;
    const tileBytes = this.ctx.atlas.tileBytes;
    const readback = device.createBuffer({ size: drafts.length * tileBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder({ label: "surface readback" });
    drafts.forEach((d, i) => {
      const { texture, layer } = this.ctx.atlas.location(d.slot);
      encoder.copyTextureToBuffer({ texture, origin: [0, 0, layer] }, { buffer: readback, offset: i * tileBytes, bytesPerRow: this.ctx.rowBytes }, [this.ctx.tile, this.ctx.tile, 1]);
    });
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const mapped = readback.getMappedRange();
    const texels = this.ctx.tile * this.ctx.tile;
    const f32 = this.ctx.format === "rgba32float";
    const tiles = drafts.map((_, i) => {
      const at = i * tileBytes;
      if (this.kind === "mask") {
        const out = new Uint16Array(texels);
        if (f32) {
          const src = new Float32Array(mapped, at, texels * 4);
          for (let t = 0; t < texels; t++) out[t] = toHalf(src[t * 4]);
        } else {
          const src = new Uint16Array(mapped, at, texels * 4);
          for (let t = 0; t < texels; t++) out[t] = src[t * 4];
        }
        return out.buffer;
      }
      if (f32) return Uint16Array.from(new Float32Array(mapped, at, texels * 4), toHalf).buffer;
      return mapped.slice(at, at + tileBytes);
    });
    readback.unmap();
    readback.destroy();
    return tiles;
  }

  /**
   * Makes the surface a selection's coverage of each of its pixels (a mask from a selection), as one new surface:
   * tiles wholly inside are constant 1 and those outside 0 (the fill: nothing stored), only the edges' are computed
   * and stored. Resolves with its id.
   */
  async fillFromSelection(selection: PhotoSelection, place: SurfacePlace): Promise<SurfaceId> {
    if (this.stroke) this.cancel();
    const tile = this.ctx.tile;
    const box = selectionBox(selection);
    const { tilesX, tilesY } = this.image.levels[0];
    const m = place.matrix;
    const entries: TileEntry[] = [];
    const edges: { tx: number; ty: number }[] = [];
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        // The tile's corners in the document: its box there decides, unless it straddles the selection's edge.
        const xs: number[] = [];
        const ys: number[] = [];
        for (const [u, v] of [[tx * tile, ty * tile], [(tx + 1) * tile, ty * tile], [tx * tile, (ty + 1) * tile], [(tx + 1) * tile, (ty + 1) * tile]]) {
          xs.push(m[0] * u + m[2] * v + m[4]);
          ys.push(m[1] * u + m[3] * v + m[5]);
        }
        const t = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
        if (t.x1 <= box.x0 || t.x0 >= box.x1 || t.y1 <= box.y0 || t.y0 >= box.y1) continue;
        if (rightAngled(m) && t.x0 >= box.x0 && t.x1 <= box.x1 && t.y0 >= box.y0 && t.y1 <= box.y1) entries.push([tx, ty, constantRef([1])]);
        else edges.push({ tx, ty });
      }
    }
    const { device } = this.ctx;
    device.queue.writeBuffer(this.params, 0, packParams(tile, [0, 0, 0, 0], place, selection));
    const drafts: Draft[] = [];
    for (let i = 0; i < edges.length; i += BATCH) {
      const batch = edges.slice(i, i + BATCH);
      const slots = batch.map((t) => this.ctx.atlas.acquire(`d${this.id}:${t.tx}:${t.ty}:${this.ctx.id()}`, true));
      const jobs = new ArrayBuffer(batch.length * 32);
      batch.forEach((t, j) => new Int32Array(jobs, j * 32 + 4, 2).set([t.tx, t.ty]));
      device.queue.writeBuffer(this.jobs, 0, jobs);
      const encoder = device.createCommandEncoder({ label: "mask fill" });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.ctx.kernels.maskFill);
      pass.setBindGroup(0, this.fillGroup);
      pass.dispatchWorkgroups(tile / 16, tile / 16, batch.length);
      pass.end();
      this.ctx.copyScratchToSlots(encoder, slots);
      device.queue.submit([encoder.finish()]);
      batch.forEach((t, j) => drafts.push({ ...t, slot: slots[j], paint: null, base: null }));
    }
    // A mask of 0 everywhere but where the selection is: the edges' tiles are hashed onto that.
    this.manifest = withTiles(emptySurface("r16f", tile, [0]), entries);
    const id = drafts.length ? (await this.commitDrafts(drafts)).id : await this.uploads.add(this.manifest, []);
    // Shown afresh from its manifest (its fill, its constant tiles, the edges by hash).
    this.shown = null;
    this.showing++;
    await this.show(id);
    return id;
  }

  destroy() {
    this.destroyed = true;
    this.stopListening();
    for (const draft of this.drafts.values()) {
      this.ctx.atlas.release(draft.slot);
      this.releaseWork(draft);
    }
    for (let level = 1; level < this.image.levels.length; level++) {
      const l = this.image.levels[level];
      for (let ty = 0; ty < l.tilesY; ty++) {
        for (let tx = 0; tx < l.tilesX; tx++) {
          const slot = this.ctx.atlas.get(`q${this.id}:${level}:${tx}:${ty}`);
          if (slot !== null) this.ctx.atlas.release(slot);
        }
      }
    }
    this.image.destroy();
    this.jobs.destroy();
    this.limitJobs.destroy();
    this.dabs.destroy();
    this.params.destroy();
    this.reduceJobs.destroy();
  }
}
