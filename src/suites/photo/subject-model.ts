/**
 * Select Subject in the tab (docs/photo/selections.md): the model (IS-Net, served by the server once it's downloaded)
 * run by ONNX Runtime Web on the GPU (WebGPU; WebAssembly where there's none), loaded on first use and kept. The
 * download is the user's to start (88 MB, once per computer): `useSubjectModel` says where it is, and the workspace
 * asks before it starts. The tests' server answers with a stand-in instead (`standIn`): nothing is downloaded or run.
 */
import { create } from "zustand";
import { request } from "@/lib/api";
import { sampleScale } from "@shared/photo/pixel-sample";
import { SUBJECT_MODEL, SUBJECT_SIDE, type SubjectModelStatus, standInProbabilities, subjectInput, subjectSelection } from "@shared/photo/subject";
import type { PhotoSelection, SelectionMode } from "@shared/photo/types";
import { applySelection, photoSample, sampledLayer, useSelectOptions } from "./selecting";
import { currentDoc, currentSelection } from "./store";

type InferenceSession = import("onnxruntime-web").InferenceSession;

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
  status: () => request<SubjectModelStatus>("/api/photo/models/subject"),
  setUp: () => request<SubjectModelStatus>("/api/photo/models/subject/setup", { method: "POST" }),
};

let session: Promise<InferenceSession> | null = null;

/** The model, ready to run (made once). */
function modelSession(): Promise<InferenceSession> {
  session ??= (async () => {
    const [ort, wasm] = await Promise.all([import("onnxruntime-web/webgpu"), import("onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url")]);
    ort.env.wasm.wasmPaths = { wasm: wasm.default };
    // Threads need a cross-origin isolated page; one is enough for the WebAssembly fallback.
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const response = await fetch("/api/photo/models/subject/file");
    if (!response.ok) throw new Error("The subject model isn't downloaded yet.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const providers = "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
    return ort.InferenceSession.create(bytes, { executionProviders: providers });
  })();
  session.catch(() => (session = null));
  return session;
}

/** Runs the model on its input: a probability a pixel, 1024 × 1024. */
async function probabilities(input: Float32Array): Promise<Float32Array> {
  const ort = await import("onnxruntime-web/webgpu");
  const model = await modelSession();
  const out = await model.run({ [SUBJECT_MODEL.input]: new ort.Tensor("float32", input, [1, 3, SUBJECT_SIDE, SUBJECT_SIDE]) });
  const result = out[SUBJECT_MODEL.output];
  const data = (await result.getData()) as Float32Array;
  result.dispose();
  return data;
}

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
 * `SubjectModelMissing` while the model isn't here.
 */
export async function selectSubject(mode: SelectionMode): Promise<PhotoSelection | null> {
  const doc = currentDoc();
  if (!doc) return null;
  const status = await subjectApi.status();
  useSubjectModel.setState({ status });
  if (status.status !== "ready") throw new SubjectModelMissing(status);
  useSubjectModel.setState({ running: true });
  try {
    const layerId = sampledLayer(doc, useSelectOptions.getState().sampleAll);
    // The model reads 1024 pixels a side: a sample at most twice that is plenty.
    const side = Math.max(doc.canvas.width, doc.canvas.height) * sampleScale(doc.canvas);
    const sample = await photoSample(doc, layerId, Math.max(0, Math.ceil(Math.log2(side / 2048))));
    const probs = status.standIn ? standInProbabilities(sample) : await probabilities(subjectInput(sample));
    const shape = subjectSelection(probs, SUBJECT_SIDE, sample, doc.canvas);
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
