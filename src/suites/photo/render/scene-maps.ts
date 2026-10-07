/**
 * Scene maps (docs/photo/effects/scene-maps.md), the renderer's: for each filter that reads its picture's depth or
 * subject, a coarse render of that picture (its layer's content and the filters before it, as Camera Raw's analysis
 * is made), read back and given to the models (`../models.ts`), kept by what it was made of.
 *
 * An image's or a pixel layer's maps are made of **its own pixels** (the whole layer, wherever it is) and read through
 * where it is now (`SceneMaps.place`), as its mask is: moving, scaling or turning it never makes them again. What
 * draws itself on the document (text, shapes, generators) has maps of the document, read through any move at once
 * and made again once it has stayed put. Maps made are kept in the project's package (`photo/cache/scene/`, by what
 * they were made of and with which model), so the photo opened again reads them rather than running the models.
 *
 * A plan compiled before a filter's first maps are there leaves that filter out (its node's keys change when they
 * come): the screen asks for them and draws again when they're there; exports, pictures and refinements wait for the
 * exact ones (`settledPlan`). Without a model (not downloaded, or declined) the maps can't be made: the filter stays
 * out, and `onMissing` says which model, once, so the user can be asked. The models run one input at a time.
 */
import type { PhotoModelName } from "@shared/photo/models.ts";
import { hashKey, type SceneNeed, type SceneResolver } from "@shared/photo/render-plan.ts";
import {
  type Affine,
  DEPTH_MODEL,
  IDENTITY,
  type SceneMaps,
  type SceneReads,
  composeAffine,
  decodeSceneMap,
  depthInput,
  depthInputSize,
  depthMap,
  encodeSceneMap,
  invertAffine,
  pictureSample,
  resampleToGrid,
  sceneGrid,
  standInDepth,
} from "@shared/photo/scene.ts";
import { SUBJECT_MODEL, SUBJECT_SIDE, standInProbabilities, subjectInput } from "@shared/photo/subject.ts";
import type { PhotoProject } from "@shared/photo/types.ts";
import { modelApi, runModel, useModels } from "../models";
import { type AnalysisHost, analysisInput } from "./camera-raw-analysis.ts";

/** Maps kept (each a few MB at most). */
const KEPT = 16;

/** How long a filter's request for maps must stand before they're made again (a stroke, a slider: only its end). */
const SETTLE_MS = 400;

/** The models scene maps are made with. */
type SceneModel = Extract<PhotoModelName, "depth" | "subject">;

/** What makes scene maps: the analyses' host, and the package's cache of maps made before. */
export interface SceneHost extends AnalysisHost {
  /** A map kept by `key`, or null. */
  loadMap: (key: string) => Promise<ArrayBuffer | null>;
  /** Keeps a map by `key` (best effort). */
  saveMap: (key: string, data: Uint8Array) => Promise<void>;
}

/** Whether `maps` has every map `reads` asks for. */
const covers = (maps: SceneMaps, reads: SceneReads) => (!reads.depth || !!maps.depth) && (!reads.subject || !!maps.subject);

/** Maps as made: where their grid was (its points to the document's then; identity for a layer's own pixels). */
interface Made {
  maps: SceneMaps;
  placement: Affine;
}

const sameAffine = (a: Affine, b: Affine) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

/** Where `need`'s maps are made: the layer's own pixels (`placement` identity), or the document where it is now. */
const madeAt = (need: SceneNeed): Affine => (need.size ? IDENTITY : need.placement);

/** `made` read for a layer placed at `placement` now: a document point to its grid's. */
function placed(made: Made, placement: Affine): SceneMaps {
  if (sameAffine(made.placement, placement)) return made.maps;
  const place = composeAffine(made.placement, invertAffine(placement));
  return { ...made.maps, id: `${made.maps.id}|${place.map((v) => Math.round(v * 1e6) / 1e6).join(",")}`, data: made.maps.data ?? made.maps.id, place };
}

/** Whether `made` is the maps `need` asks for (a layer's own pixels' are, wherever it is now). */
const exact = (made: Made, need: SceneNeed) => sameAffine(made.placement, madeAt(need));

/**
 * The picture `need`'s maps are made of: its layer alone before the filter, in its own pixels (the layer at its
 * natural size on a canvas of it, whole) or on the document as it is.
 */
export function sceneInput(doc: PhotoProject, need: SceneNeed): PhotoProject | null {
  const input = analysisInput(doc, need);
  const size = need.size;
  if (!input || !size) return input;
  // Upright at 100%: no skew either (a layer in perspective has its maps made of the document instead).
  const natural = { x: size.width / 2, y: size.height / 2, scaleX: 1, scaleY: 1, rotation: 0 };
  return {
    ...input,
    canvas: { ...input.canvas, width: size.width, height: size.height, background: null },
    layers: input.layers.map((l) => (l.id === need.layerId && "transform" in l ? { ...l, transform: natural } : l)),
  } as PhotoProject;
}

export class SceneMapStore {
  /** By picture (its input key, which says nothing of where its layer is, and its grid's space). */
  private readonly kept = new Map<string, Made>();
  /** The last maps each filter was given (by layer and filter): shown while its picture's new ones are made. */
  private readonly latest = new Map<string, Made>();
  private readonly building = new Map<string, Promise<SceneMaps | null>>();
  /** Requests waiting to stand still (by layer and filter): only the last is made. */
  private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>();
  /** Models found missing: nothing needing them is built until `retry`. */
  private readonly unavailable = new Set<SceneModel>();
  /** Pictures whose maps failed to build (a model's error): not tried again until `retry`. */
  private readonly failed = new Set<string>();
  /** Bumped whenever maps arrive: a plan compiled before them is compiled again. */
  generation = 0;
  /** A filter needs a model that isn't here (once per model until `retry`). */
  onMissing: ((model: SceneModel) => void) | null = null;

  constructor(private readonly host: SceneHost) {}

  /** The picture `need` reads: its content, and the grid's space (the layer's pixels, or this canvas). */
  private pictureOf(need: SceneNeed, doc: PhotoProject) {
    return need.size ? `${need.inputKey}@layer ${need.size.width}x${need.size.height}` : `${need.inputKey}@${doc.canvas.width}x${doc.canvas.height}`;
  }

  /** A filter's slot: its layer and its id. */
  private slotOf(need: SceneNeed) {
    return `${need.layerId}|${need.filterId}`;
  }

  /**
   * A resolver for compiling `doc`. The screen's (`build`) is given the best maps there are at once: its picture's
   * (read through where the layer is now), or else the filter's last ones while new ones are made (once the request
   * has stood still a moment, so a stroke makes one set at its end). What isn't exact is listed in `missing`, so what's
   * drawn for keeps (exports, pictures, refinements) waits for the exact maps.
   */
  resolver(doc: PhotoProject, options: { missing?: SceneNeed[]; build?: boolean } = {}): SceneResolver {
    return (need) => {
      const picture = this.pictureOf(need, doc);
      const found = this.kept.get(picture);
      if (found && covers(found.maps, need.reads)) {
        // Most recently used last.
        this.kept.delete(picture);
        this.kept.set(picture, found);
        this.latest.set(this.slotOf(need), found);
        if (!exact(found, need)) {
          // Drawn on the document and moved since: read through the move now; made again where it is once it stays.
          options.missing?.push(need);
          if (options.build) this.request(need, doc);
        }
        return placed(found, need.placement);
      }
      options.missing?.push(need);
      const last = options.build ? this.latest.get(this.slotOf(need)) : undefined;
      const shown = last && covers(last.maps, need.reads) ? last : null;
      if (options.build) {
        if (shown) this.request(need, doc);
        else void this.build(need, doc);
      }
      return shown ? placed(shown, need.placement) : null;
    };
  }

  /** Builds `need`'s maps once it has stood still for `SETTLE_MS` (a newer request for the filter replaces it). */
  private request(need: SceneNeed, doc: PhotoProject) {
    const slot = this.slotOf(need);
    clearTimeout(this.waiting.get(slot));
    this.waiting.set(
      slot,
      setTimeout(() => {
        this.waiting.delete(slot);
        void this.build(need, doc);
      }, SETTLE_MS),
    );
  }

  /**
   * Builds (once) the maps `need` reads. Not queued here: making one filter's maps can need an earlier filter's (its
   * input), so the models queue their runs themselves (`runModel`).
   */
  build(need: SceneNeed, doc: PhotoProject): Promise<SceneMaps | null> {
    const picture = this.pictureOf(need, doc);
    const kept = this.kept.get(picture);
    if (kept && covers(kept.maps, need.reads) && exact(kept, need)) return Promise.resolve(placed(kept, need.placement));
    if (this.failed.has(picture)) return Promise.resolve(null);
    if ((need.reads.depth && this.unavailable.has("depth")) || (need.reads.subject && this.unavailable.has("subject"))) return Promise.resolve(null);
    const key = `${picture}|${madeAt(need).join(",")}|${need.reads.depth ? "d" : ""}${need.reads.subject ? "s" : ""}`;
    let promise = this.building.get(key);
    if (!promise) {
      promise = this.make(picture, need, doc)
        .catch((error: unknown) => {
          console.error("[photo] scene maps couldn't be made:", error);
          this.failed.add(picture);
          return null;
        })
        .finally(() => this.building.delete(key));
      this.building.set(key, promise);
    }
    return promise;
  }

  /** Whether a model can run (its stand-in counts); if not, it's marked missing and said so. */
  private async ready(model: SceneModel): Promise<{ standIn: boolean } | null> {
    const status = await modelApi.status(model);
    useModels.setState((s) => ({ status: { ...s.status, [model]: status } }));
    if (status.status === "ready") return { standIn: status.standIn };
    if (!this.unavailable.has(model)) {
      this.unavailable.add(model);
      this.onMissing?.(model);
    }
    return null;
  }

  /** A map's key in the package's cache: what it's of, where its grid is, and the model that made it. */
  private cacheKey(picture: string, at: Affine, model: SceneModel) {
    return hashKey(`${picture}|${at.join(",")}|${model}|${model === "depth" ? DEPTH_MODEL.file : SUBJECT_MODEL.file}|scene-map 1`);
  }

  private async make(picture: string, need: SceneNeed, doc: PhotoProject): Promise<SceneMaps | null> {
    const at = madeAt(need);
    const grid = sceneGrid(need.size ?? doc.canvas);
    // What's kept of the picture made where these are (others are made again).
    const before = this.kept.get(picture);
    const reuse = before && sameAffine(before.placement, at) ? before.maps : null;
    let depth = reuse?.depth ?? null;
    let subject = reuse?.subject ?? null;
    // Read from the package's cache what was made before (another session, the photo opened again).
    const cached = async (model: SceneModel) => {
      const bytes = await this.host.loadMap(this.cacheKey(picture, at, model)).catch(() => null);
      return bytes ? decodeSceneMap(bytes, grid) : null;
    };
    if (need.reads.depth && !depth) depth = await cached("depth");
    if (need.reads.subject && !subject) subject = await cached("subject");
    if ((!need.reads.depth || depth) && (!need.reads.subject || subject)) return this.keep(picture, need, at, grid, depth, subject);
    const depthModel = need.reads.depth && !depth ? await this.ready("depth") : null;
    const subjectModel = need.reads.subject && !subject ? await this.ready("subject") : null;
    if ((need.reads.depth && !depth && !depthModel) || (need.reads.subject && !subject && !subjectModel)) return null;
    const input = sceneInput(doc, need);
    if (!input) return null;
    await this.host.settled(input);
    const data = await this.host.renderFloats(input, { zoom: 1 / grid.spacing, x: 0, y: 0, width: grid.width, height: grid.height });
    const sample = pictureSample({ width: grid.width, height: grid.height, data }, 1 / grid.spacing);
    if (subjectModel) {
      const probs = subjectModel.standIn
        ? standInProbabilities(sample)
        : await runModel("subject", { [SUBJECT_MODEL.input]: { data: subjectInput(sample), dims: [1, 3, SUBJECT_SIDE, SUBJECT_SIDE] } }, SUBJECT_MODEL.output);
      subject = resampleToGrid(probs, SUBJECT_SIDE, SUBJECT_SIDE, grid);
      // The stand-ins' maps aren't the models': never kept for a session that has the models.
      if (!subjectModel.standIn) void this.host.saveMap(this.cacheKey(picture, at, "subject"), encodeSceneMap(grid, subject)).catch(() => {});
    }
    if (depthModel) {
      if (depthModel.standIn) {
        const stand = standInDepth(grid, resampleToGrid(standInProbabilities(sample), SUBJECT_SIDE, SUBJECT_SIDE, grid));
        depth = depthMap(stand.values, stand.width, stand.height, sample, grid);
      } else {
        const size = depthInputSize(sample.width, sample.height);
        const input = depthInput(sample);
        const values = await runModel("depth", { [DEPTH_MODEL.input]: { data: input.data, dims: [1, 3, input.height, input.width] } }, DEPTH_MODEL.output);
        depth = depthMap(values, size.width, size.height, sample, grid);
        void this.host.saveMap(this.cacheKey(picture, at, "depth"), encodeSceneMap(grid, depth)).catch(() => {});
      }
    }
    return this.keep(picture, need, at, grid, depth, subject);
  }

  /** Keeps maps made (or read back) of `picture`, gives them to the filter, and has the screen draw again. */
  private keep(picture: string, need: SceneNeed, at: Affine, grid: { width: number; height: number; spacing: number }, depth: Float32Array | null, subject: Float32Array | null): SceneMaps {
    const maps: SceneMaps = { id: hashKey(`${picture}|${at.join(",")}|${depth ? "d" : ""}${subject ? "s" : ""}`), ...grid, depth, subject };
    const made = { maps, placement: at };
    this.kept.set(picture, made);
    this.latest.set(this.slotOf(need), made);
    while (this.kept.size > KEPT) this.kept.delete(this.kept.keys().next().value!);
    while (this.latest.size > KEPT) this.latest.delete(this.latest.keys().next().value!);
    this.generation++;
    this.host.built();
    return placed(made, need.placement);
  }

  /** A model arrived (or the user wants another go): what couldn't be built is tried again. */
  retry() {
    this.unavailable.clear();
    this.failed.clear();
    this.generation++;
    this.host.built();
  }

  /** Drops every map (the device went, or the photo closed). */
  clear() {
    for (const timer of this.waiting.values()) clearTimeout(timer);
    this.waiting.clear();
    this.kept.clear();
    this.latest.clear();
    this.generation++;
  }
}
