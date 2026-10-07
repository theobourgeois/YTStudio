/**
 * Select Subject in the tab (docs/photo/selections.md): the model (IS-Net, served by the server once it's downloaded)
 * run by ONNX Runtime Web on the GPU (`scene-models.ts`), loaded on first use and kept. The
 * download is the user's to start (88 MB, once per computer): `useSubjectModel` says where it is, and the workspace
 * asks before it starts. The tests' server answers with a stand-in instead (`standIn`): nothing is downloaded or run.
 */
import { create } from "zustand";
import { sampleScale } from "@shared/photo/pixel-sample";
import { SUBJECT_SIDE, type SubjectModelStatus, cropSample, standInProbabilities, subjectInput, subjectSelection } from "@shared/photo/subject";
import type { PhotoSelection, SelectionMode } from "@shared/photo/types";
import { modelApi, subjectProbabilities } from "./scene-models";
import { applySelection, photoSample, sampledLayer, useSelectOptions } from "./selecting";
import { currentDoc, currentSelection } from "./store";

interface SubjectModelState {
  status: SubjectModelStatus | null;
  /** The question before the download is open (with what to do once it's here). */
  asking: boolean;
  /** A selection waiting for the model, made once it's here. */
  pending: SelectionMode | null;
  /** Select Subject is running. */
  running: boolean;
}

export const useSubjectModel = create<SubjectModelState>(() => ({ status: null, asking: false, pending: null, running: false }));

export const subjectApi = {
  status: () => modelApi.status("subject"),
  setUp: () => modelApi.setUp("subject"),
};

export class SubjectModelMissing extends Error {
  constructor(readonly status: SubjectModelStatus) {
    super(
      status.status === "downloading"
        ? `Select Subject's model is downloading (${Math.round((status.progress ?? 0) * 100)}%): try again when it's done.`
        : `Select Subject needs its model (${Math.round(status.size / 1e6)} MB, downloaded once). The user downloads it by choosing Select › Subject in the editor.`,
    );
  }
}

/**
 * Select › Subject: the model finds the photo's subject, which meets the selection there by `mode`. Throws
 * `SubjectModelMissing` while the model isn't here. `layer` looks at that layer alone (the Online panel's Remove
 * background), else what Sample All Layers says; `box` (document pixels) at that part of the photo alone.
 */
export async function selectSubject(mode: SelectionMode, layer?: string, box?: { x: number; y: number; width: number; height: number }): Promise<PhotoSelection | null> {
  const doc = currentDoc();
  if (!doc) return null;
  const status = await subjectApi.status();
  useSubjectModel.setState({ status });
  if (status.status !== "ready") throw new SubjectModelMissing(status);
  useSubjectModel.setState({ running: true });
  try {
    const layerId = layer ?? sampledLayer(doc, useSelectOptions.getState().sampleAll);
    // The model reads 1024 pixels a side: a sample at most twice that is plenty.
    const side = Math.max(doc.canvas.width, doc.canvas.height) * sampleScale(doc.canvas);
    const sample = await photoSample(doc, layerId, Math.max(0, Math.ceil(Math.log2(side / 2048))));
    const part = box ? cropSample(sample, box) : null;
    if (box && !part) return currentSelection();
    const seen = part?.crop ?? sample;
    const probs = status.standIn ? standInProbabilities(seen) : await subjectProbabilities(subjectInput(seen));
    const shape = subjectSelection(probs, SUBJECT_SIDE, sample, doc.canvas, part?.at);
    if (currentDoc() !== doc) return currentSelection();
    applySelection(shape, mode);
    return currentSelection();
  } finally {
    useSubjectModel.setState({ running: false });
  }
}

/** Starts the model's download (the user said yes) and follows it; what was pending runs once it's here. */
export async function downloadSubjectModel() {
  useSubjectModel.setState({ asking: false, status: await subjectApi.setUp() });
  for (;;) {
    const status = await subjectApi.status();
    useSubjectModel.setState({ status });
    if (status.status !== "downloading") return status;
    await new Promise((r) => setTimeout(r, 500));
  }
}
