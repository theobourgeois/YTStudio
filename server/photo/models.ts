/** The photo suite's models (shared/photo/models.ts), each a `DownloadedModel` the tab runs once it's here. */
import { PHOTO_MODELS, type PhotoModelName } from "../../shared/photo/models.ts";
import { DownloadedModel } from "../models.ts";

export { DownloadedModel as PhotoModel };

/** Every photo model, by name (`/api/photo/models/<name>`). `standIn`: the tests', which download nothing. */
export const photoModels = (modelsDir: string, standIn: boolean): Record<PhotoModelName, DownloadedModel> => ({
  subject: new DownloadedModel(modelsDir, standIn, PHOTO_MODELS.subject),
  object: new DownloadedModel(modelsDir, standIn, PHOTO_MODELS.object),
  fill: new DownloadedModel(modelsDir, standIn, PHOTO_MODELS.fill),
  depth: new DownloadedModel(modelsDir, standIn, PHOTO_MODELS.depth),
});
