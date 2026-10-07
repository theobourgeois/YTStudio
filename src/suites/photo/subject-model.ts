/**
 * Select Subject in the tab (docs/photo/selections.md): the model (IS-Net) run as every photo model is (`models.ts`:
 * downloaded once per computer when the user says yes, run by ONNX Runtime Web on the GPU). The tests' server answers
 * with a stand-in instead (`standIn`): nothing is downloaded or run.
 */
import { create } from "zustand";
import { sampleScale } from "@shared/photo/pixel-sample";
import { SUBJECT_MODEL, SUBJECT_SIDE, cropSample, standInProbabilities, subjectInput, subjectSelection } from "@shared/photo/subject";
import type { PhotoSelection, SelectionMode } from "@shared/photo/types";
import { readyModel, runModel } from "./models";
import { applySelection, photoSample, sampledLayer, useSelectOptions } from "./selecting";
import { currentDoc, currentSelection } from "./store";

/** Select Subject is running. */
export const useSubjectModel = create<{ running: boolean }>(() => ({ running: false }));

/** Runs the model on its input: a probability a pixel, 1024 × 1024. */
const probabilities = (input: Float32Array) => runModel("subject", { [SUBJECT_MODEL.input]: { data: input, dims: [1, 3, SUBJECT_SIDE, SUBJECT_SIDE] } }, SUBJECT_MODEL.output);

/**
 * Select › Subject: the model finds the photo's subject, which meets the selection there by `mode`. Throws
 * `ModelMissing` while the model isn't here. `layer` looks at that layer alone (the Online panel's Remove
 * background), else what Sample All Layers says; `box` (document pixels) at that part of the photo alone.
 */
export async function selectSubject(mode: SelectionMode, layer?: string, box?: { x: number; y: number; width: number; height: number }): Promise<PhotoSelection | null> {
  const doc = currentDoc();
  if (!doc) return null;
  const status = await readyModel("subject");
  useSubjectModel.setState({ running: true });
  try {
    const layerId = layer ?? sampledLayer(doc, useSelectOptions.getState().sampleAll);
    // The model reads 1024 pixels a side: a sample at most twice that is plenty.
    const side = Math.max(doc.canvas.width, doc.canvas.height) * sampleScale(doc.canvas);
    const sample = await photoSample(doc, layerId, Math.max(0, Math.ceil(Math.log2(side / 2048))));
    const part = box ? cropSample(sample, box) : null;
    if (box && !part) return currentSelection();
    const seen = part?.crop ?? sample;
    const probs = status.standIn ? standInProbabilities(seen) : await probabilities(subjectInput(seen));
    const shape = subjectSelection(probs, SUBJECT_SIDE, sample, doc.canvas, part?.at);
    if (currentDoc() !== doc) return currentSelection();
    applySelection(shape, mode);
    return currentSelection();
  } finally {
    useSubjectModel.setState({ running: false });
  }
}
