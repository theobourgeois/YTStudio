/**
 * Scene maps (docs/photo/effects/scene-maps.md), the renderer's: for each filter that reads its picture's depth or
 * subject, a coarse render of that picture (its layer's content and the filters before it, as Camera Raw's analysis
 * is made), read back and given to the models (`../scene-models.ts`), kept by what it was made of.
 *
 * A plan compiled before a filter's maps are there leaves that filter out and says so (its node's keys change when
 * they come): the screen asks for them and draws again when they're built; exports, pictures and refinements wait
 * for them (`settle`). Without a model (not downloaded, or declined) the maps can't be made: the filter stays out,
 * and `onMissing` says which model, once, so the user can be asked.
 */
import { hashKey, type SceneNeed, type SceneResolver } from "@shared/photo/render-plan.ts";
import { type SceneMaps, type SceneReads, depthInput, depthInputSize, depthMap, pictureSample, resampleToGrid, sceneGrid, standInDepth } from "@shared/photo/scene.ts";
import { SUBJECT_SIDE, standInProbabilities, subjectInput } from "@shared/photo/subject.ts";
import type { PhotoProject } from "@shared/photo/types.ts";
import { type PhotoModel, depthValues, modelStatus, subjectProbabilities } from "../scene-models";
import { type AnalysisHost, analysisInput } from "./camera-raw-analysis.ts";

/** Maps kept (each a few MB at most). */
const KEPT = 16;

/** Whether `maps` has every map `reads` asks for. */
const covers = (maps: SceneMaps, reads: SceneReads) => (!reads.depth || !!maps.depth) && (!reads.subject || !!maps.subject);

export class SceneMapStore {
  /** By picture (its input key on its canvas). */
  private readonly kept = new Map<string, SceneMaps>();
  private readonly building = new Map<string, Promise<SceneMaps | null>>();
  /** Models found missing: nothing needing them is built until `retry`. */
  private readonly unavailable = new Set<PhotoModel>();
  /** Pictures whose maps failed to build (a model's error): not tried again until `retry`. */
  private readonly failed = new Set<string>();
  /** Bumped whenever maps arrive: a plan compiled before them is compiled again. */
  generation = 0;
  /** A filter needs a model that isn't here (once per model until `retry`). */
  onMissing: ((model: PhotoModel) => void) | null = null;

  constructor(private readonly host: AnalysisHost) {}

  /** The picture `need` reads, on this canvas. */
  private pictureOf(need: SceneNeed, doc: PhotoProject) {
    return `${need.inputKey}@${doc.canvas.width}x${doc.canvas.height}`;
  }

  /** A resolver for compiling `doc`: the maps there are; missing ones are listed (`missing`) and, for the screen, built. */
  resolver(doc: PhotoProject, options: { missing?: SceneNeed[]; build?: boolean } = {}): SceneResolver {
    return (need) => {
      const picture = this.pictureOf(need, doc);
      const found = this.kept.get(picture);
      if (found && covers(found, need.reads)) {
        // Most recently used last.
        this.kept.delete(picture);
        this.kept.set(picture, found);
        return found;
      }
      options.missing?.push(need);
      if (options.build) void this.build(need, doc);
      return null;
    };
  }

  /** Builds (once) the maps `need` reads, adding to what's kept of its picture. */
  build(need: SceneNeed, doc: PhotoProject): Promise<SceneMaps | null> {
    const picture = this.pictureOf(need, doc);
    const kept = this.kept.get(picture);
    if (kept && covers(kept, need.reads)) return Promise.resolve(kept);
    if (this.failed.has(picture)) return Promise.resolve(null);
    if ((need.reads.depth && this.unavailable.has("depth")) || (need.reads.subject && this.unavailable.has("subject"))) return Promise.resolve(null);
    const key = `${picture}|${need.reads.depth ? "d" : ""}${need.reads.subject ? "s" : ""}`;
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
  private async ready(model: PhotoModel): Promise<{ standIn: boolean } | null> {
    const status = await modelStatus(model);
    if (status.status === "ready") return { standIn: status.standIn };
    if (!this.unavailable.has(model)) {
      this.unavailable.add(model);
      this.onMissing?.(model);
    }
    return null;
  }

  private async make(picture: string, need: SceneNeed, doc: PhotoProject): Promise<SceneMaps | null> {
    const wantsDepth = need.reads.depth && !this.kept.get(picture)?.depth;
    const wantsSubject = need.reads.subject && !this.kept.get(picture)?.subject;
    const depthModel = wantsDepth ? await this.ready("depth") : null;
    const subjectModel = wantsSubject ? await this.ready("subject") : null;
    if ((wantsDepth && !depthModel) || (wantsSubject && !subjectModel)) return null;
    const input = analysisInput(doc, { inputKey: need.inputKey, layerId: need.layerId, filterId: need.filterId });
    if (!input) return null;
    await this.host.settled(input);
    const grid = sceneGrid(doc.canvas);
    const data = await this.host.renderFloats(input, { zoom: 1 / grid.spacing, x: 0, y: 0, width: grid.width, height: grid.height });
    const sample = pictureSample({ width: grid.width, height: grid.height, data }, 1 / grid.spacing);
    const before = this.kept.get(picture);
    let subject = before?.subject ?? null;
    let depth = before?.depth ?? null;
    if (subjectModel) {
      const probs = subjectModel.standIn ? standInProbabilities(sample) : await subjectProbabilities(subjectInput(sample));
      subject = resampleToGrid(probs, SUBJECT_SIDE, SUBJECT_SIDE, grid);
    }
    if (depthModel) {
      if (depthModel.standIn) {
        const stand = standInDepth(grid, resampleToGrid(standInProbabilities(sample), SUBJECT_SIDE, SUBJECT_SIDE, grid));
        depth = depthMap(stand.values, stand.width, stand.height, sample, grid);
      } else {
        const size = depthInputSize(sample.width, sample.height);
        depth = depthMap(await depthValues(depthInput(sample)), size.width, size.height, sample, grid);
      }
    }
    const maps: SceneMaps = { id: hashKey(`${picture}|${depth ? "d" : ""}${subject ? "s" : ""}`), ...grid, depth, subject };
    this.kept.set(picture, maps);
    while (this.kept.size > KEPT) this.kept.delete(this.kept.keys().next().value!);
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
    this.kept.clear();
    this.generation++;
  }
}
