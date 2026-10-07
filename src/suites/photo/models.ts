/**
 * The photo models in the tab (shared/photo/models.ts: Select Subject's, Object Selection's, Content-Aware Fill's…),
 * all the same way: the server keeps the files once the user said yes, ONNX Runtime Web runs them on the GPU (WebGPU;
 * WebAssembly where there's none), each graph loaded on first use and kept. A command that needs a model that isn't here throws `ModelMissing`;
 * `askForModel` puts the question (`ModelDialog`) and runs the command again once the model is here.
 */
import { create } from "zustand";
import { toast } from "sonner";
import { request } from "@/lib/api";
import { PHOTO_MODELS, type PhotoModelFile, type PhotoModelName, type PhotoModelStatus } from "@shared/photo/models";

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

/** One graph of a model: its file, and its weights' file when they're apart (ONNX's external data). */
export interface ModelGraph {
  graph: PhotoModelFile;
  weights?: PhotoModelFile;
}

const graphOf = (name: PhotoModelName, graph?: ModelGraph): ModelGraph => graph ?? { graph: PHOTO_MODELS[name].files[0] };

const sessions = new Map<string, Promise<InferenceSession>>();

async function fileBytes(name: PhotoModelName, file: PhotoModelFile): Promise<Uint8Array> {
  const response = await fetch(`/api/photo/models/${name}/files/${encodeURIComponent(file.file)}`);
  if (!response.ok) throw new Error(`${PHOTO_MODELS[name].command}'s model isn't downloaded yet.`);
  return new Uint8Array(await response.arrayBuffer());
}

/** A model's graph (its first, unless `graph` says which), ready to run (made once). */
export function modelSession(name: PhotoModelName, graph?: ModelGraph): Promise<InferenceSession> {
  const { graph: file, weights } = graphOf(name, graph);
  const key = `${name}/${file.file}`;
  let made = sessions.get(key);
  if (made) return made;
  made = (async () => {
    const [ort, wasm] = await Promise.all([import("onnxruntime-web/webgpu"), import("onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url")]);
    ort.env.wasm.wasmPaths = { wasm: wasm.default };
    // Threads need a cross-origin isolated page; one is enough for the WebAssembly fallback.
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const [bytes, data] = await Promise.all([fileBytes(name, file), weights ? fileBytes(name, weights) : null]);
    const providers = "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
    return ort.InferenceSession.create(bytes, {
      executionProviders: providers,
      ...(weights && data ? { externalData: [{ path: weights.location ?? weights.file, data }] } : {}),
    });
  })();
  sessions.set(key, made);
  made.catch(() => sessions.delete(key));
  return made;
}

/** An input: float32, or int64 (SAM's labels). */
export type ModelInput = { data: Float32Array | BigInt64Array; dims: number[] };
/** An output read back: its values and shape. */
export type ModelOutput = { data: Float32Array; dims: readonly number[] };

/** The last run of each graph: the next waits for it (a session runs one input at a time). */
const running = new Map<string, Promise<unknown>>();

/**
 * Runs a model on float32 inputs (name → data and shape): its output `output`, read back. Runs of a model go one after
 * another: ONNX Runtime Web's session can't run two at once (two at once spun the page's thread for good).
 */
export async function runModel(name: PhotoModelName, inputs: Record<string, { data: Float32Array; dims: number[] }>, output: string): Promise<Float32Array> {
  return (await runGraph(name, inputs, [output]))[output].data;
}

/** Runs one graph of a model (its first, unless `graph` says which) on `inputs`: the `outputs` named, read back. One run at a time, as `runModel`'s. */
export function runGraph(name: PhotoModelName, inputs: Record<string, ModelInput>, outputs: readonly string[], graph?: ModelGraph): Promise<Record<string, ModelOutput>> {
  const key = `${name}/${graphOf(name, graph).graph.file}`;
  const run = () => runNow(name, inputs, outputs, graph);
  const next = (running.get(key) ?? Promise.resolve()).then(run, run);
  running.set(key, next.catch(() => {}));
  return next;
}

async function runNow(name: PhotoModelName, inputs: Record<string, ModelInput>, outputs: readonly string[], graph?: ModelGraph): Promise<Record<string, ModelOutput>> {
  const ort = await import("onnxruntime-web/webgpu");
  const session = await modelSession(name, graph);
  const feeds = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [k, v.data instanceof BigInt64Array ? new ort.Tensor("int64", v.data, v.dims) : new ort.Tensor("float32", v.data, v.dims)]),
  );
  const out = await session.run(feeds);
  const read: Record<string, ModelOutput> = {};
  for (const name of outputs) {
    const result = out[name];
    read[name] = { data: (await result.getData()) as Float32Array, dims: result.dims };
  }
  for (const result of Object.values(out)) result.dispose();
  return read;
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
