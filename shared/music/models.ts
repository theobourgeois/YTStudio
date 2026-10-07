/**
 * The music suite's models (docs/fl-studio/stems-and-notes.md): ONNX files the server downloads once per computer
 * into `MODELS_DIR` when the user says yes (the platform's `DownloadedModel`), and runs itself, in a process of its
 * own (`server/music/ml-worker.mjs`). Each is pinned to a revision, so what's checked is what was measured.
 */
import type { ModelSpec } from "../models.ts";

/** HTDemucs v4, six sources (Meta's, MIT), as StemSplitio's ONNX export: the STFT as convolutions, fp16 weights. */
const HTDEMUCS = {
  name: "HTDemucs 6-stem",
  file: "htdemucs-6s-fp16weights.onnx",
  url: "https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/49df9b6989cf2150840ea65b0bef77a2e471b678/htdemucs_6s_fp16weights.onnx",
  size: 136_428_532,
  sha256: "7ce55792e2231c93fbf92de95f5fd5b3a5e6c89f7db690dfd693e8f1dce56869",
};

/** Spotify's Basic Pitch (Apache 2.0), the ONNX file its repository ships. */
const BASIC_PITCH = {
  name: "Basic Pitch",
  file: "basic-pitch-icassp-2022.onnx",
  url: "https://raw.githubusercontent.com/spotify/basic-pitch/fa5997af0a8210982619003269994a1be25eddf3/basic_pitch/saved_models/icassp_2022/nmp.onnx",
  size: 230_444,
  sha256: "2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec",
};

export const MUSIC_MODELS = {
  stems: { files: [HTDEMUCS], command: "Extract stems", does: "splits a song into vocals, drums, bass, guitar, piano and the rest with a separation model (HTDemucs)" },
  notes: { files: [BASIC_PITCH], command: "Convert to notes", does: "hears the notes played in audio with a transcription model (Spotify's Basic Pitch)" },
} satisfies Record<string, ModelSpec>;

export type MusicModelName = keyof typeof MUSIC_MODELS;

export const isMusicModelName = (name: string): name is MusicModelName => Object.hasOwn(MUSIC_MODELS, name);
