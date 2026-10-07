/**
 * The photo suite's models (docs/photo/selections.md, docs/photo/content-aware-fill.md,
 * docs/photo/effects/scene-maps.md): ONNX files the server
 * downloads once per computer into `MODELS_DIR` when the user says yes, checks, and serves to the tab, which runs
 * them. Every one is asked for, downloaded and shown the same way (`/api/photo/models/<name>`).
 */
import { FILL_MODEL } from "./inpaint.ts";
import { SAM_FILES } from "./sam.ts";
import { DEPTH_MODEL } from "./scene.ts";
import { SUBJECT_MODEL } from "./subject.ts";

/** A model file the server keeps. */
export interface PhotoModelFile {
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
export interface PhotoModelSpec {
  /** The command that needs it ("Select Subject"). */
  command: string;
  /** What the command does with it, finishing "…with <this>". */
  does: string;
  /** Its files, downloaded together: a graph, or several graphs and their weights (SAM's encoder and decoder). */
  files: readonly PhotoModelFile[];
}

export const PHOTO_MODELS = {
  subject: { files: [SUBJECT_MODEL], command: "Select Subject", does: "finds the main subject with a segmentation model (IS-Net)" },
  object: { files: SAM_FILES, command: "Object Selection", does: "selects the thing you paint over with a prompted segmentation model (SAM 2.1)" },
  fill: { files: [FILL_MODEL], command: "Content-Aware Fill", does: "fills the selection from what's around it with an inpainting model (LaMa)" },
  depth: { files: [DEPTH_MODEL], command: "Depth Map", does: "sees how far away each part of the photo is, for the depth filters (Lens Blur, Fog, Tilt-Shift…), with a depth model (Depth Anything V2)" },
} satisfies Record<string, PhotoModelSpec>;

/** A model's bytes to download, all its files together. */
export const modelSize = (spec: PhotoModelSpec) => spec.files.reduce((sum, f) => sum + f.size, 0);

export type PhotoModelName = keyof typeof PHOTO_MODELS;

export const isPhotoModelName = (name: string): name is PhotoModelName => Object.hasOwn(PHOTO_MODELS, name);

/** Whether a model is here (`/api/photo/models/<name>`). */
export interface PhotoModelStatus {
  status: "ready" | "missing" | "downloading" | "error";
  /** 0..1 while downloading. */
  progress: number | null;
  /** Bytes to download. */
  size: number;
  error: string | null;
  /** The tests' stand-in (EDITOR_PHOTO_MODELS=stand-in): no model; the tab answers without one. */
  standIn: boolean;
}
