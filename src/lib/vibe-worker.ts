/**
 * The vibe's ears, off the page's thread (`vibe.ts`): CLAP's audio side (ONNX Runtime Web on the CPU, WebAssembly:
 * the GPU is the visualizer's, and a few hundred ms every few seconds costs it nothing here) hears ten seconds and
 * says their vibe (`hearVibe`, against `vibe.json`, which only this worker loads). The model's loaded on the first
 * request, from the server (`/api/now-playing/vibe/file`), and kept.
 */
import type { InferenceSession } from "onnxruntime-web";
import { errorMessage } from "@shared/errors";
import { CLAP_FRAMES, CLAP_MELS, clapFeatures } from "@shared/signals/clap";
import { type Vibe, hearVibe } from "@shared/signals/vibe";
import { VIBE_DATA } from "@shared/signals/vibe-data";

/** Ten seconds to hear (or what there is: it's repeated to fill them), and where the model is. */
export interface VibeRequest {
  id: number;
  sound: Float32Array;
  url: string;
}

export type VibeAnswer = { id: number; vibe: Vibe; ms: number } | { id: number; error: string };

type Ort = typeof import("onnxruntime-web");

let loading: Promise<{ ort: Ort; session: InferenceSession }> | null = null;

async function load(url: string) {
  const [ort, wasm] = await Promise.all([import("onnxruntime-web/webgpu"), import("onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url")]);
  ort.env.wasm.wasmPaths = { wasm: wasm.default };
  // One thread is plenty for a reading every few seconds (more would need a cross-origin isolated page).
  ort.env.wasm.numThreads = 1;
  const response = await fetch(url);
  if (!response.ok) throw new Error("The vibe's model isn't downloaded.");
  const session = await ort.InferenceSession.create(new Uint8Array(await response.arrayBuffer()), { executionProviders: ["wasm"] });
  return { ort: ort as unknown as Ort, session };
}

self.onmessage = async ({ data: { id, sound, url } }: MessageEvent<VibeRequest>) => {
  try {
    loading ??= load(url);
    const { ort, session } = await loading;
    const started = performance.now();
    const features = new ort.Tensor("float32", clapFeatures(sound), [1, 1, CLAP_FRAMES, CLAP_MELS]);
    const out = await session.run({ input_features: features });
    const vibe = hearVibe(out.audio_embeds.data as Float32Array, VIBE_DATA);
    self.postMessage({ id, vibe, ms: Math.round(performance.now() - started) } satisfies VibeAnswer);
  } catch (err) {
    // Loaded afresh next time (the model may have come since).
    loading = null;
    self.postMessage({ id, error: errorMessage(err) } satisfies VibeAnswer);
  }
};
