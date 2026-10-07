/**
 * Select Subject and the Object Selection tool in the tab (docs/photo/selections.md): the model (IS-Net) run as every
 * photo model is (`models.ts`: downloaded once per computer when the user says yes, run by ONNX Runtime Web on the
 * GPU). The tests' server answers with a stand-in instead (`standIn`): nothing is downloaded or run.
 */
import { create } from "zustand";
import { sampleScale } from "@shared/photo/pixel-sample";
import { objectBox, objectProbabilities, paintedGrid } from "@shared/photo/object-select";
import { SUBJECT_MODEL, SUBJECT_SIDE, type SampleBox, cropSample, standInProbabilities, subjectInput, subjectSelection } from "@shared/photo/subject";
import type { MaskSelection, PhotoProject, PhotoSelection, SelectionMode } from "@shared/photo/types";
import { readyModel, runModel } from "./models";
import { applySelection, photoSample, sampledLayer, useSelectOptions } from "./selecting";
import { currentDoc, currentSelection } from "./store";

/** Select Subject is running. */
export const useSubjectModel = create<{ running: boolean }>(() => ({ running: false }));

/** Runs the model on its input: a probability a pixel, 1024 × 1024. */
const probabilities = (input: Float32Array) => runModel("subject", { [SUBJECT_MODEL.input]: { data: input, dims: [1, 3, SUBJECT_SIDE, SUBJECT_SIDE] } }, SUBJECT_MODEL.output);

/** Select Subject's model's answer for the photo, or for the part of it in `box` (document pixels) alone: its probabilities, the sample it read and where the part is in it. Null when `box` is off the photo. */
async function subjectAnswer(doc: PhotoProject, layerId: string | null, standIn: boolean, box?: SampleBox) {
  // The model reads 1024 pixels a side: a sample of what it's shown at most twice that is plenty.
  const side = (box ? Math.max(box.width, box.height) : Math.max(doc.canvas.width, doc.canvas.height)) * sampleScale(doc.canvas);
  const sample = await photoSample(doc, layerId, Math.max(0, Math.ceil(Math.log2(side / 2048))));
  const part = box ? cropSample(sample, box) : null;
  if (box && !part) return null;
  const seen = part?.crop ?? sample;
  const probs = standIn ? standInProbabilities(seen) : await probabilities(subjectInput(seen));
  return { probs, sample, at: part?.at };
}

/** Runs `work` with the model ready (throws `ModelMissing` while it isn't here), showing it's running. */
async function withModel<T>(work: (standIn: boolean) => Promise<T>): Promise<T> {
  const status = await readyModel("subject");
  useSubjectModel.setState({ running: true });
  try {
    return await work(status.standIn);
  } finally {
    useSubjectModel.setState({ running: false });
  }
}

/**
 * Select › Subject: the model finds the photo's subject, which meets the selection there by `mode`. Throws
 * `ModelMissing` while the model isn't here. `layer` looks at that layer alone (the Online panel's Remove
 * background), else what Sample All Layers says; `box` (document pixels) at that part of the photo alone.
 */
export async function selectSubject(mode: SelectionMode, layer?: string, box?: SampleBox): Promise<PhotoSelection | null> {
  const doc = currentDoc();
  if (!doc) return null;
  return withModel(async (standIn) => {
    const answer = await subjectAnswer(doc, layer ?? sampledLayer(doc, useSelectOptions.getState().sampleAll), standIn, box);
    if (!answer || currentDoc() !== doc) return currentSelection();
    applySelection(subjectSelection(answer.probs, SUBJECT_SIDE, answer.sample, doc.canvas, answer.at), mode);
    return currentSelection();
  });
}

/**
 * The Object Selection tool (`object-select.ts`): `strokes` (document points) painted `size` pixels across over a
 * thing, which the model finds around them; the thing meets the selection by `mode`. What was found, or null when
 * the strokes touched nothing it found (the selection is left alone then, and when the photo changed meanwhile).
 * Throws `ModelMissing` while the model isn't here.
 */
export async function selectObject(strokes: { x: number; y: number }[][], size: number, mode: SelectionMode, sampleAll = useSelectOptions.getState().sampleAll): Promise<MaskSelection | null> {
  const doc = currentDoc();
  const box = doc && objectBox(strokes, size, doc.canvas);
  if (!doc || !box) return null;
  return withModel(async (standIn) => {
    const answer = await subjectAnswer(doc, sampledLayer(doc, sampleAll), standIn, box);
    if (!answer?.at || currentDoc() !== doc) return null;
    const kept = objectProbabilities(answer.probs, SUBJECT_SIDE, paintedGrid(strokes, size, answer.sample.scale, answer.at, SUBJECT_SIDE));
    const shape = kept && subjectSelection(kept, SUBJECT_SIDE, answer.sample, doc.canvas, answer.at);
    if (shape) applySelection(shape, mode);
    return shape;
  });
}
