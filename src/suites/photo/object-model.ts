/**
 * The Object Selection tool's model in the tab (docs/photo/selections.md, `shared/photo/sam.ts`): SAM 2.1, run as
 * every photo model is (`models.ts`). Its encoder reads the photo once and what it makes is kept while the photo
 * doesn't change (a press of the brush starts it, so it's often done when the stroke ends); each stroke then costs
 * the decoder's milliseconds. The tests' server answers with a stand-in instead (`standIn`): what's unlike the border
 * of the part around the strokes, the things they touched kept (`object-select.ts`).
 */
import { create } from "zustand";
import { objectBox, objectProbabilities, paintedGrid } from "@shared/photo/object-select";
import { type PixelSample, sampleScale } from "@shared/photo/pixel-sample";
import { SAM_DECODER, SAM_ENCODER, SAM_MASK_SIDE, SAM_SIDE, chooseMask, samInput, samPoints, samSelection } from "@shared/photo/sam";
import { SUBJECT_SIDE, cropSample, standInProbabilities, subjectSelection } from "@shared/photo/subject";
import type { MaskSelection, PhotoProject, SelectionMode } from "@shared/photo/types";
import { type ModelOutput, modelApi, readyModel, runGraph } from "./models";
import { applySelection, photoSample, sampledLayer, useSelectOptions } from "./selecting";
import { currentDoc, usePhoto } from "./store";

type Point = { x: number; y: number };

/** Object Selection is looking for a thing. */
export const useObjectModel = create<{ running: boolean }>(() => ({ running: false }));

/** The photo as the encoder reads it: at most twice its 1024 a side, which is plenty. */
function encoderSample(doc: PhotoProject, layerId: string | null): Promise<PixelSample> {
  const side = Math.max(doc.canvas.width, doc.canvas.height) * sampleScale(doc.canvas);
  return photoSample(doc, layerId, Math.max(0, Math.ceil(Math.log2(side / (2 * SAM_SIDE)))));
}

/** The encoder's answer for the last sample it read (samples are kept per photo and layer, so this is per photo). */
let encoded: { sample: PixelSample; embeddings: Promise<Record<string, ModelOutput>> } | null = null;

function embeddingsOf(sample: PixelSample): Promise<Record<string, ModelOutput>> {
  if (encoded?.sample !== sample) {
    const embeddings = runGraph("object", { [SAM_ENCODER.input]: { data: samInput(sample), dims: [1, 3, SAM_SIDE, SAM_SIDE] } }, SAM_ENCODER.outputs, SAM_ENCODER);
    const mine = { sample, embeddings };
    encoded = mine;
    embeddings.catch(() => {
      if (encoded === mine) encoded = null;
    });
  }
  return encoded!.embeddings;
}

// Another photo opened: what the encoder made of the last one (about 17 MB) goes.
usePhoto.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) encoded = null;
});

/** A press of the brush: the encoder starts on the photo now, if the model is here (it asks nothing). */
export function warmObjectModel(sampleAll = useSelectOptions.getState().sampleAll) {
  const doc = currentDoc();
  if (!doc) return;
  void (async () => {
    const status = await modelApi.status("object");
    if (status.status !== "ready" || status.standIn) return;
    await embeddingsOf(await encoderSample(doc, sampledLayer(doc, sampleAll)));
  })().catch(() => {});
}

/** SAM's answer: the thing the strokes prompt for, as a selection, or null when it sees nothing there. */
async function samObject(doc: PhotoProject, layerId: string | null, strokes: Point[][], size: number): Promise<MaskSelection | null> {
  const points = samPoints(strokes, size, doc.canvas);
  if (!points.length) return null;
  const sample = await encoderSample(doc, layerId);
  const embeddings = await embeddingsOf(sample);
  const inputs = Object.fromEntries(SAM_ENCODER.outputs.map((name) => [name, { data: embeddings[name].data, dims: [...embeddings[name].dims] }]));
  const out = await runGraph(
    "object",
    {
      ...inputs,
      [SAM_DECODER.points]: { data: Float32Array.from(points.flatMap((p) => [p.x, p.y])), dims: [1, 1, points.length, 2] },
      [SAM_DECODER.labels]: { data: BigInt64Array.from(points, () => 1n), dims: [1, 1, points.length] },
      [SAM_DECODER.boxes]: { data: new Float32Array(0), dims: [1, 0, 4] },
    },
    [SAM_DECODER.masks, SAM_DECODER.scores, SAM_DECODER.object],
    SAM_DECODER,
  );
  if (out[SAM_DECODER.object].data[0] < 0) return null;
  const painted = paintedGrid(strokes, size, sample.scale, { x: 0, y: 0, width: sample.width, height: sample.height }, SAM_MASK_SIDE);
  const masks = out[SAM_DECODER.masks].data;
  const chosen = chooseMask(masks, out[SAM_DECODER.scores].data, painted);
  if (chosen < 0) return null;
  const n = SAM_MASK_SIDE * SAM_MASK_SIDE;
  return samSelection(masks.subarray(chosen * n, (chosen + 1) * n), sample, doc.canvas);
}

/** The tests' stand-in: what's unlike the border of the part around the strokes, the things they touched kept. */
async function standInObject(doc: PhotoProject, layerId: string | null, strokes: Point[][], size: number): Promise<MaskSelection | null> {
  const box = objectBox(strokes, size, doc.canvas);
  if (!box) return null;
  const side = Math.max(box.width, box.height) * sampleScale(doc.canvas);
  const sample = await photoSample(doc, layerId, Math.max(0, Math.ceil(Math.log2(side / 2048))));
  const part = cropSample(sample, box);
  if (!part) return null;
  const kept = objectProbabilities(standInProbabilities(part.crop), SUBJECT_SIDE, paintedGrid(strokes, size, sample.scale, part.at, SUBJECT_SIDE));
  return kept && subjectSelection(kept, SUBJECT_SIDE, sample, doc.canvas, part.at);
}

/**
 * The Object Selection tool: `strokes` (document points) painted `size` pixels across over a thing, which the model
 * selects; the thing meets the selection by `mode`. What was found, or null when nothing was (the selection is left
 * alone then, and when the photo changed meanwhile). Throws `ModelMissing` while the model isn't here.
 */
export async function selectObject(strokes: Point[][], size: number, mode: SelectionMode, sampleAll = useSelectOptions.getState().sampleAll): Promise<MaskSelection | null> {
  const doc = currentDoc();
  if (!doc || !strokes.some((s) => s.length)) return null;
  const status = await readyModel("object");
  useObjectModel.setState({ running: true });
  try {
    const layerId = sampledLayer(doc, sampleAll);
    const shape = status.standIn ? await standInObject(doc, layerId, strokes, size) : await samObject(doc, layerId, strokes, size);
    if (currentDoc() !== doc) return null;
    if (shape) applySelection(shape, mode);
    return shape;
  } finally {
    useObjectModel.setState({ running: false });
  }
}
