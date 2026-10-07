/**
 * Camera Raw's analyses (docs/photo/camera-raw.md, "CR2"), the renderer's: for each Camera Raw that reads one, a
 * coarse render of the picture it develops (its layer as it is before it, or everything below an adjustment layer),
 * read back and analysed on the CPU (`shared/photo/effects/camera-raw/analysis.ts`), kept by what it was made from.
 *
 * A plan compiled before an analysis is there draws without its local sliders and says so in its keys ("pending"),
 * so nothing drawn then is ever reused once it has come: the screen asks for it and draws again when it's built;
 * exports, pictures and refinements wait for it (`settle`).
 */
import { analyse, analysisSpacing, type CameraRawAnalysis } from "@shared/photo/effects/camera-raw/analysis.ts";
import { findLayer } from "@shared/photo/edits.ts";
import type { CameraRawNeed, CameraRawResolver } from "@shared/photo/render-plan.ts";
import { type PhotoProject, hasContent } from "@shared/photo/types.ts";

/** What builds an analysis: a view of a document rendered (at its own level) and read back as floats. */
export interface AnalysisHost {
  /**
   * Resolves when everything a document shows is in (its images loaded, its surfaces showing their pixels): an
   * analysis is kept for good, so one made from a picture still loading would develop the wrong picture until the
   * photo is closed.
   */
  settled: (doc: PhotoProject) => Promise<void>;
  renderFloats: (doc: PhotoProject, view: { zoom: number; x: number; y: number; width: number; height: number }) => Promise<Float32Array>;
  /** An analysis arrived: the screen draws again. */
  built: () => void;
}

/** Analyses kept (each a few MB at most). */
const KEPT = 24;

/** The document a Camera Raw develops: its layer alone before it (a filter), or the layers below it (an adjustment). */
export function analysisInput(doc: PhotoProject, need: CameraRawNeed): PhotoProject | null {
  const layer = findLayer(doc, need.layerId);
  if (!layer) return null;
  if (need.filterId === null) return { ...doc, layers: doc.layers.slice(0, doc.layers.indexOf(layer)) };
  if (!hasContent(layer)) return null;
  const filters = layer.filters ?? [];
  const index = filters.findIndex((f) => f.id === need.filterId);
  // Its pixels as they are, before its mask, plainly composited (a Smart Filter sees the layer's own content).
  const plain = { ...layer, opacity: 1, visible: true, mask: undefined, filters: index < 0 ? filters : filters.slice(0, index) };
  delete plain.blend;
  delete plain.fill;
  delete plain.blending;
  delete plain.style;
  return { ...doc, canvas: { ...doc.canvas, background: null }, layers: [plain] };
}

export class CameraRawAnalyses {
  private readonly kept = new Map<string, CameraRawAnalysis>();
  private readonly building = new Map<string, Promise<CameraRawAnalysis | null>>();
  /** Bumped whenever one arrives: a plan compiled before it is compiled again. */
  generation = 0;

  constructor(private readonly host: AnalysisHost) {}

  /** The id an analysis of `need` on this canvas has. */
  private idOf(need: CameraRawNeed, doc: PhotoProject) {
    return `${need.inputKey}@${doc.canvas.width}x${doc.canvas.height}`;
  }

  /**
   * A resolver for compiling `doc`: the analyses there are, and the ones that aren't put in `missing` (when given)
   * and, for the screen (`build`), started.
   */
  resolver(doc: PhotoProject, options: { missing?: CameraRawNeed[]; build?: boolean } = {}): CameraRawResolver {
    return (need) => {
      const id = this.idOf(need, doc);
      const found = this.kept.get(id);
      if (found) {
        // Most recently used last.
        this.kept.delete(id);
        this.kept.set(id, found);
        return found;
      }
      options.missing?.push(need);
      if (options.build) void this.build(need, doc);
      return null;
    };
  }

  /** Builds (once) the analysis of `need` in `doc`. */
  build(need: CameraRawNeed, doc: PhotoProject): Promise<CameraRawAnalysis | null> {
    const id = this.idOf(need, doc);
    const kept = this.kept.get(id);
    if (kept) return Promise.resolve(kept);
    let promise = this.building.get(id);
    if (!promise) {
      promise = this.make(id, need, doc).finally(() => this.building.delete(id));
      this.building.set(id, promise);
    }
    return promise;
  }

  private async make(id: string, need: CameraRawNeed, doc: PhotoProject): Promise<CameraRawAnalysis | null> {
    const input = analysisInput(doc, need);
    if (!input) return null;
    await this.host.settled(input);
    const spacing = analysisSpacing(doc.canvas);
    const width = Math.ceil(doc.canvas.width / spacing);
    const height = Math.ceil(doc.canvas.height / spacing);
    const data = await this.host.renderFloats(input, { zoom: 1 / spacing, x: 0, y: 0, width, height });
    const analysis = analyse({ width, height, data }, doc.canvas, spacing, id);
    this.kept.set(id, analysis);
    while (this.kept.size > KEPT) this.kept.delete(this.kept.keys().next().value!);
    this.generation++;
    this.host.built();
    return analysis;
  }

  /**
   * Compiles with `compile` until every analysis it needs is there (building them, each after what's below it):
   * the plan exports, pictures and refinements draw.
   */
  async settle<T>(doc: PhotoProject, compile: (resolver: CameraRawResolver) => T): Promise<T> {
    for (let round = 0; ; round++) {
      const missing: CameraRawNeed[] = [];
      const plan = compile(this.resolver(doc, { missing }));
      if (!missing.length || round >= 8) return plan;
      await Promise.all(missing.map((need) => this.build(need, doc)));
    }
  }

  /** Drops every analysis (the device went, or the photo closed). */
  clear() {
    this.kept.clear();
    this.generation++;
  }
}
