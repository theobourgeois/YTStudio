/**
 * The photo models in the tab (shared/photo/models.ts: Select Subject's, Content-Aware Fill's), all the same way:
 * the server keeps the file once the user said yes, ONNX Runtime Web runs it on the GPU (WebGPU; WebAssembly where
 * there's none), loaded on first use and kept. A command that needs a model that isn't here throws `ModelMissing`;
 * `askForModel` puts the question (`ModelDialog`) and runs the command again once the model is here.
 */
import { create } from "zustand";
import { toast } from "sonner";
import { request } from "@/lib/api";
import { PHOTO_MODELS, type PhotoModelName, type PhotoModelStatus } from "@shared/photo/models";

type InferenceSession = import("onnxruntime-web").InferenceSession;

interface ModelsState {
  /** What the server last said of each. */
  status: Partial<Record<PhotoModelName, PhotoModelStatus>>;
  /** The question before a download is open: which model, and what to do once it's here. */
  asking: { model: PhotoModelName; then: (() => void) | null } | null;
}

export const useModels = create<ModelsState>(() => ({ status: {}, asking: null }));

export const modelApi = {
  status: (name: PhotoModelName) => request<PhotoModelStatus>(`/api/photo/models/${name}`),
  setUp: (name: PhotoModelName) => request<PhotoModelStatus>(`/api/photo/models/${name}/setup`, { method: "POST" }),
};

const megabytes = (bytes: number) => Math.round(bytes / 1e6);

/** A command's model isn't here (or is still downloading): its message says so, to the user and to the assistant. */
export class ModelMissing extends Error {
  constructor(
    readonly model: PhotoModelName,
    readonly status: PhotoModelStatus,
  ) {
    const { command } = PHOTO_MODELS[model];
    super(
      status.status === "downloading"
        ? `${command}'s model is downloading (${Math.round((status.progress ?? 0) * 100)}%): try again when it's done.`
        : `${command} needs its model (${megabytes(status.size)} MB, downloaded once). The user downloads it by choosing ${command} in the editor.`,
    );
  }
}

/** The model's status, kept; throws `ModelMissing` unless it's ready. */
export async function readyModel(name: PhotoModelName): Promise<PhotoModelStatus> {
  const status = await modelApi.status(name);
  useModels.setState((s) => ({ status: { ...s.status, [name]: status } }));
  if (status.status !== "ready") throw new ModelMissing(name, status);
  return status;
}

const sessions: Partial<Record<PhotoModelName, Promise<InferenceSession>>> = {};

/** The model, ready to run (made once). */
export function modelSession(name: PhotoModelName): Promise<InferenceSession> {
  const made = (sessions[name] ??= (async () => {
    const [ort, wasm] = await Promise.all([import("onnxruntime-web/webgpu"), import("onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url")]);
    ort.env.wasm.wasmPaths = { wasm: wasm.default };
    // Threads need a cross-origin isolated page; one is enough for the WebAssembly fallback.
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const response = await fetch(`/api/photo/models/${name}/file`);
    if (!response.ok) throw new Error(`${PHOTO_MODELS[name].command}'s model isn't downloaded yet.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const providers = "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
    return ort.InferenceSession.create(bytes, { executionProviders: providers });
  })());
  made.catch(() => delete sessions[name]);
  return made;
}

/** Runs a model on float32 inputs (name → data and shape): its output `output`, read back. */
export async function runModel(name: PhotoModelName, inputs: Record<string, { data: Float32Array; dims: number[] }>, output: string): Promise<Float32Array> {
  const ort = await import("onnxruntime-web/webgpu");
  const session = await modelSession(name);
  const feeds = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, new ort.Tensor("float32", v.data, v.dims)]));
  const out = await session.run(feeds);
  const result = out[output];
  const data = (await result.getData()) as Float32Array;
  result.dispose();
  return data;
}

/**
 * What a command does when its model is missing: while it downloads, says so; otherwise asks before downloading
 * (`ModelDialog`), and runs `then` once it's here.
 */
export function askForModel(error: ModelMissing, then: (() => void) | null = null) {
  if (error.status.status === "downloading") return void toast(error.message);
  useModels.setState({ asking: { model: error.model, then } });
}

/** Starts a model's download (the user said yes) and follows it to the end; its last status. */
export async function downloadModel(name: PhotoModelName, progress?: (fraction: number) => void): Promise<PhotoModelStatus> {
  let status = await modelApi.setUp(name);
  for (;;) {
    useModels.setState((s) => ({ status: { ...s.status, [name]: status } }));
    if (status.status !== "downloading") return status;
    progress?.(status.progress ?? 0);
    await new Promise((r) => setTimeout(r, 500));
    status = await modelApi.status(name);
  }
}
