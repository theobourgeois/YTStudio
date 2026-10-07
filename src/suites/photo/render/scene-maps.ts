/**
 * Scene maps (docs/photo/effects/scene-maps.md), the renderer's: for each filter that reads its picture's depth or
 * subject, a coarse render of that picture (its layer's content and the filters before it, as Camera Raw's analysis
 * is made), read back and given to the models (`../models.ts`), kept by what it was made of.
 *
 * Maps are kept by the layer's content, not where it is: a layer moved, scaled or turned reads the maps it had through
 * the move (`SceneMaps.place`) at once, and they're made again where it is once it has stayed there; a request only
 * builds once it has stood still (a drag, a stroke: one set at its end), and the models run one input at a time. A plan compiled before a filter's first maps are there leaves that filter
 * out (its node's keys change when they come): the screen asks for them and draws again when they're built; exports,
 * pictures and refinements wait for the exact ones (`settledPlan`). Without a model (not downloaded, or declined) the maps can't be made: the filter stays out,
 * and `onMissing` says which model, once, so the user can be asked.
 */
import { hashKey, type SceneNeed, type SceneResolver } from "@shared/photo/render-plan.ts";
import type { PhotoModelName } from "@shared/photo/models.ts";
import { type Affine, DEPTH_MODEL, type SceneMaps, type SceneReads, composeAffine, depthInput, depthInputSize, depthMap, pictureSample, invertAffine, resampleToGrid, sceneGrid, standInDepth } from "@shared/photo/scene.ts";
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

/** Whether `maps` has every map `reads` asks for. */
const covers = (maps: SceneMaps, reads: SceneReads) => (!reads.depth || !!maps.depth) && (!reads.subject || !!maps.subject);

/** Maps as made: the layer's placement then (its pixels to the document's). */
interface Made {
  maps: SceneMaps;
  placement: Affine;
}

const sameAffine = (a: Affine, b: Affine) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

/** `made` read for a layer placed at `placement` now: through where its pixels were then. */
function placed(made: Made, placement: Affine): SceneMaps {
  if (sameAffine(made.placement, placement)) return made.maps;
  const place = composeAffine(made.placement, invertAffine(placement));
  return { ...made.maps, id: `${made.maps.id}|${place.map((v) => Math.round(v * 1e6) / 1e6).join(",")}`, data: made.maps.data ?? made.maps.id, place };
}

export class SceneMapStore {
  /** By picture (its input key on its canvas, which says nothing of where its layer is). */
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

  constructor(private readonly host: AnalysisHost) {}

  /** The picture `need` reads, on this canvas. */
  private pictureOf(need: SceneNeed, doc: PhotoProject) {
    return `${need.inputKey}@${doc.canvas.width}x${doc.canvas.height}`;
  }

  /**
   * A resolver for compiling `doc`. The screen's (`build`) is given the best maps there are at once: its picture's,
   * read through any move of its layer since, or else the filter's last ones while new ones are made (after the
   * request has stood still a moment, so a drag or a stroke makes one set at its end). What isn't exact is listed in
   * `missing`, so what's drawn for keeps (exports, pictures, refinements) waits for the exact maps.
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
        if (sameAffine(found.placement, need.placement)) return found.maps;
        // Moved since: read through the move now; made again where it is once it stays there.
        options.missing?.push(need);
        if (options.build) this.request(need, doc);
        return placed(found, need.placement);
      }
      options.missing?.push(need);
      const last = options.build ? this.latest.get(this.slotOf(need)) : undefined;
      if (options.build) {
        if (last && covers(last.maps, need.reads)) this.request(need, doc);
        else void this.build(need, doc);
      }
      return last && covers(last.maps, need.reads) ? placed(last, need.placement) : null;
    };
  }

  /** A filter's slot: its layer and its id. */
  private slotOf(need: SceneNeed) {
    return `${need.layerId}|${need.filterId}`;
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
   * Builds (once) the maps `need` reads where its layer is now. Not queued here: making one filter's maps can need an
   * earlier filter's (its input), so the models queue their runs themselves (`runModel`).
   */
  build(need: SceneNeed, doc: PhotoProject): Promise<SceneMaps | null> {
    const picture = this.pictureOf(need, doc);
    const kept = this.kept.get(picture);
    if (kept && covers(kept.maps, need.reads) && sameAffine(kept.placement, need.placement)) return Promise.resolve(kept.maps);
    if (this.failed.has(picture)) return Promise.resolve(null);
    if ((need.reads.depth && this.unavailable.has("depth")) || (need.reads.subject && this.unavailable.has("subject"))) return Promise.resolve(null);
    const key = `${picture}|${need.placement.join(",")}|${need.reads.depth ? "d" : ""}${need.reads.subject ? "s" : ""}`;
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

  private async make(picture: string, need: SceneNeed, doc: PhotoProject): Promise<SceneMaps | null> {
    // What's kept of the picture where its layer is now (maps made elsewhere are made again).
    const before = this.kept.get(picture);
    const reuse = before && sameAffine(before.placement, need.placement) ? before.maps : null;
    if (reuse && covers(reuse, need.reads)) return reuse;
    const wantsDepth = need.reads.depth || !!before?.maps.depth;
    const wantsSubject = need.reads.subject || !!before?.maps.subject;
    const depthModel = wantsDepth && !reuse?.depth ? await this.ready("depth") : null;
    const subjectModel = wantsSubject && !reuse?.subject ? await this.ready("subject") : null;
    if ((need.reads.depth && !reuse?.depth && !depthModel) || (need.reads.subject && !reuse?.subject && !subjectModel)) return null;
    const input = analysisInput(doc, { inputKey: need.inputKey, layerId: need.layerId, filterId: need.filterId });
    if (!input) return null;
    await this.host.settled(input);
    const grid = sceneGrid(doc.canvas);
    const data = await this.host.renderFloats(input, { zoom: 1 / grid.spacing, x: 0, y: 0, width: grid.width, height: grid.height });
    const sample = pictureSample({ width: grid.width, height: grid.height, data }, 1 / grid.spacing);
    let subject = reuse?.subject ?? null;
    let depth = reuse?.depth ?? null;
    if (subjectModel) {
      const probs = subjectModel.standIn
        ? standInProbabilities(sample)
        : await runModel("subject", { [SUBJECT_MODEL.input]: { data: subjectInput(sample), dims: [1, 3, SUBJECT_SIDE, SUBJECT_SIDE] } }, SUBJECT_MODEL.output);
      subject = resampleToGrid(probs, SUBJECT_SIDE, SUBJECT_SIDE, grid);
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
      }
    }
    const maps: SceneMaps = { id: hashKey(`${picture}|${need.placement.join(",")}|${depth ? "d" : ""}${subject ? "s" : ""}`), ...grid, depth, subject };
    const made = { maps, placement: need.placement };
    this.kept.set(picture, made);
    this.latest.set(this.slotOf(need), made);
    while (this.kept.size > KEPT) this.kept.delete(this.kept.keys().next().value!);
    while (this.latest.size > KEPT) this.latest.delete(this.latest.keys().next().value!);
    this.generation++;
    this.host.built();
    return maps;
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
