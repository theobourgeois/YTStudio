/**
 * The photo suite's models (docs/photo/selections.md, docs/photo/content-aware-fill.md,
 * docs/photo/effects/scene-maps.md): ONNX files the server
 * downloads once per computer into `MODELS_DIR` when the user says yes, checks, and serves to the tab, which runs
 * them. Every one is asked for, downloaded and shown the same way (`/api/photo/models/<name>`).
 */
import { type ModelFile, type ModelSpec, type ModelStatus, modelSize } from "../models.ts";
import { FILL_MODEL } from "./inpaint.ts";
import { SAM_FILES } from "./sam.ts";
import { DEPTH_MODEL } from "./scene.ts";
import { SUBJECT_MODEL } from "./subject.ts";

/** A photo model's file, what it's for, and whether it's here: the platform's (shared/models.ts). */
export type PhotoModelFile = ModelFile;
export type PhotoModelSpec = ModelSpec;
export type PhotoModelStatus = ModelStatus;
export { modelSize };

export const PHOTO_MODELS = {
  subject: { files: [SUBJECT_MODEL], command: "Select Subject", does: "finds the main subject with a segmentation model (IS-Net)" },
  object: { files: SAM_FILES, command: "Object Selection", does: "selects the thing you paint over with a prompted segmentation model (SAM 2.1)" },
  fill: { files: [FILL_MODEL], command: "Content-Aware Fill", does: "fills the selection from what's around it with an inpainting model (LaMa)" },
  depth: { files: [DEPTH_MODEL], command: "Depth Map", does: "sees how far away each part of the photo is, for the depth filters (Lens Blur, Fog, Tilt-Shift…), with a depth model (Depth Anything V2)" },
} satisfies Record<string, PhotoModelSpec>;

export type PhotoModelName = keyof typeof PHOTO_MODELS;

export const isPhotoModelName = (name: string): name is PhotoModelName => Object.hasOwn(PHOTO_MODELS, name);
