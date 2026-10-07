/**
 * The photo suite's models in the tab: Select Subject's (IS-Net) and the depth model (Depth Anything V2), each served
 * by the server once it's downloaded (the user's to start, once per computer) and run by ONNX Runtime Web on the GPU
 * (WebGPU; WebAssembly where there's none), loaded on first use and kept. The tests' server answers with stand-ins
 * instead (`standIn`): nothing is downloaded or run.
 *
 * This module imports no store, so the renderer can use it (its scene maps, `render/scene-maps.ts`).
 */
import { create } from "zustand";
import { request } from "@/lib/api";
import { DEPTH_MODEL } from "@shared/photo/scene";
import { SUBJECT_MODEL, SUBJECT_SIDE, type SubjectModelStatus } from "@shared/photo/subject";

type InferenceSession = import("onnxruntime-web").InferenceSession;

export type PhotoModel = "subject" | "depth";

/** Each model as the server says it is, and whether the user is being asked to download one. */
interface ModelsState {
  status: Partial<Record<PhotoModel, SubjectModelStatus>>;
  /** The model whose download is being asked about (for a filter that needs it: Lens Blur, Aura…). */
  asking: PhotoModel | null;
}

export const usePhotoModels = create<ModelsState>(() => ({ status: {}, asking: null }));

export const modelApi = {
  status: (model: PhotoModel) => request<SubjectModelStatus>(`/api/photo/models/${model}`),
  setUp: (model: PhotoModel) => request<SubjectModelStatus>(`/api/photo/models/${model}/setup`, { method: "POST" }),
};

/** Asks the server where a model is (and keeps the answer). */
export async function modelStatus(model: PhotoModel): Promise<SubjectModelStatus> {
  const status = await modelApi.status(model);
  usePhotoModels.setState((s) => ({ status: { ...s.status, [model]: status } }));
  return status;
}

/** The model files' names in their specs (for messages). */
export const MODEL_SIZES: Record<PhotoModel, number> = { subject: SUBJECT_MODEL.size, depth: DEPTH_MODEL.size };

const sessions: Partial<Record<PhotoModel, Promise<InferenceSession>>> = {};

/** A model, ready to run (made once). */
function modelSession(model: PhotoModel): Promise<InferenceSession> {
  let session = sessions[model];
  if (!session) {
    session = (async () => {
      const [ort, wasm] = await Promise.all([import("onnxruntime-web/webgpu"), import("onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url")]);
      ort.env.wasm.wasmPaths = { wasm: wasm.default };
      // Threads need a cross-origin isolated page; one is enough for the WebAssembly fallback.
      ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      const response = await fetch(`/api/photo/models/${model}/file`);
      if (!response.ok) throw new Error(`The ${model} model isn't downloaded yet.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const providers = "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
      return ort.InferenceSession.create(bytes, { executionProviders: providers });
    })();
    sessions[model] = session;
    session.catch(() => delete sessions[model]);
  }
  return session;
}

/** Runs one input through a model: its only output's floats. */
async function run(model: PhotoModel, input: string, output: string, data: Float32Array, dims: number[]): Promise<Float32Array> {
  const ort = await import("onnxruntime-web/webgpu");
  const session = await modelSession(model);
  const out = await session.run({ [input]: new ort.Tensor("float32", data, dims) });
  const result = out[output];
  const values = (await result.getData()) as Float32Array;
  result.dispose();
  return values;
}

/** Select Subject's model on its input (`subjectInput`): a probability a pixel, 1024 × 1024. */
export const subjectProbabilities = (input: Float32Array) => run("subject", SUBJECT_MODEL.input, SUBJECT_MODEL.output, input, [1, 3, SUBJECT_SIDE, SUBJECT_SIDE]);

/** The depth model on its input (`depthInput`): an inverse depth a pixel, at its size. */
export const depthValues = (input: { data: Float32Array; width: number; height: number }) =>
  run("depth", DEPTH_MODEL.input, DEPTH_MODEL.output, input.data, [1, 3, input.height, input.width]);

/** Starts a model's download (the user said yes) and follows it to its end. */
export async function downloadModel(model: PhotoModel): Promise<SubjectModelStatus> {
  usePhotoModels.setState((s) => ({ status: { ...s.status, [model]: undefined } }));
  await modelApi.setUp(model);
  for (;;) {
    const status = await modelStatus(model);
    if (status.status !== "downloading") return status;
    await new Promise((r) => setTimeout(r, 500));
  }
}
