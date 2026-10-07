/**
 * Models the app runs on this computer (the photo suite's Select Subject or Content-Aware Fill, the music suite's
 * Extract stems or Convert to notes): files the server downloads once per computer into `MODELS_DIR`, only when
 * the user says yes, and checks before any is used (`server/models.ts`). Each suite lists its own and says what
 * each is for; this is what they have in common.
 */

/** A model file the server keeps. */
export interface ModelFile {
  /** What it is, for people. */
  name: string;
  file: string;
  url: string;
  size: number;
  sha256: string;
  /** The name a graph knows this file by, when it's that graph's weights (ONNX's external data). */
  location?: string;
}

/** A model and what it's for: the question before its download says this. */
export interface ModelSpec {
  /** The command that needs it ("Select Subject"). */
  command: string;
  /** What the command does with it, finishing "…with <this>". */
  does: string;
  /** Its files, downloaded together: a graph, or several graphs and their weights (SAM's encoder and decoder). */
  files: readonly ModelFile[];
}

/** A model's bytes to download, all its files together. */
export const modelSize = (spec: ModelSpec) => spec.files.reduce((sum, f) => sum + f.size, 0);

/** Whether a model is here. */
export interface ModelStatus {
  status: "ready" | "missing" | "downloading" | "error";
  /** 0..1 while downloading. */
  progress: number | null;
  /** Bytes to download. */
  size: number;
  error: string | null;
  /** The tests' stand-in (a suite's `EDITOR_<SUITE>_MODELS=stand-in`): no model; its work is faked. */
  standIn: boolean;
}
