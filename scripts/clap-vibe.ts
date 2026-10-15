/**
 * The vibe's vocabulary for Now Playing (docs/now-playing.md, "The vibe"): CLAP's text side run once, here, so the app
 * only needs its audio side. Each axis's two descriptions and each genre's become embeddings, and each axis is
 * centred on how it reads real music: songs given, ten seconds at a time (`--songs`), so "more intense" means more
 * intense than the music it was set on. Writes `shared/signals/vibe.json`, and prints how it reads each song.
 *
 *   pnpm tsx scripts/clap-vibe.ts --songs a.mp3,b.mp3,... [--at 30,60,90]
 *
 * Downloads CLAP (Xenova/larger_clap_music_and_speech, about 800 MB with the text side) the first time, into
 * `~/.cache/huggingface/transformers.js` (or `CLAP_CACHE`).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AutoTokenizer, ClapAudioModelWithProjection, ClapTextModelWithProjection, Tensor, env } from "@huggingface/transformers";
import { CLAP_FRAMES, CLAP_MELS, CLAP_RATE, CLAP_SAMPLES, clapFeatures } from "../shared/signals/clap.ts";
import { VIBE_AXES, VIBE_GENRES, VIBE_MODEL, type VibeAxis, type VibeData, axisRaw, hearVibe } from "../shared/signals/vibe.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const songs = (arg("songs") ?? "").split(",").filter(Boolean);
if (!songs.length) {
  console.error("Give it songs to centre the axes on: --songs a.mp3,b.mp3");
  process.exit(1);
}
const AT = (arg("at") ?? "30,60,90").split(",").map(Number);
env.cacheDir = process.env.CLAP_CACHE ?? path.join(os.homedir(), ".cache", "huggingface", "transformers.js");

const unit = (v: ArrayLike<number>) => {
  const n = Math.hypot(...Array.from(v));
  return Array.from(v, (x) => Math.round((x / n) * 1e5) / 1e5);
};

const tokenizer = await AutoTokenizer.from_pretrained(VIBE_MODEL.repo, { revision: VIBE_MODEL.revision });
const text = await ClapTextModelWithProjection.from_pretrained(VIBE_MODEL.repo, { revision: VIBE_MODEL.revision, dtype: "fp32" });
const audio = await ClapAudioModelWithProjection.from_pretrained(VIBE_MODEL.repo, { revision: VIBE_MODEL.revision, dtype: "fp32" });

async function embedTexts(prompts: string[]): Promise<number[][]> {
  const { text_embeds } = await text(tokenizer(prompts, { padding: true, truncation: true }));
  const d = text_embeds.dims[1];
  return prompts.map((_, i) => unit((text_embeds.data as Float32Array).subarray(i * d, (i + 1) * d)));
}

async function embedSound(sound: Float32Array): Promise<number[]> {
  const features = new Tensor("float32", clapFeatures(sound), [1, 1, CLAP_FRAMES, CLAP_MELS]);
  const { audio_embeds } = await audio({ input_features: features });
  return unit(audio_embeds.data as Float32Array);
}

const axes = Object.keys(VIBE_AXES) as VibeAxis[];
const axisEmbeddings = await embedTexts(axes.flatMap((a) => [VIBE_AXES[a].low, VIBE_AXES[a].high]));
const genreEmbeddings = await embedTexts(VIBE_GENRES.map((g) => g.prompt));
const data: VibeData = {
  model: `${VIBE_MODEL.repo}@${VIBE_MODEL.revision}`,
  axes: Object.fromEntries(axes.map((a, i) => [a, { low: axisEmbeddings[2 * i], high: axisEmbeddings[2 * i + 1], mean: 0, spread: 1 }])) as VibeData["axes"],
  genres: VIBE_GENRES.map((g, i) => ({ name: g.name, embedding: genreEmbeddings[i] })),
  calibration: [],
};

// Each song's windows: how each axis reads them, raw, then centred on them all.
const heard: { song: string; at: number; embedding: number[] }[] = [];
for (const song of songs) {
  for (const at of AT) {
    const pcm = spawnSync("ffmpeg", ["-v", "error", "-ss", String(at), "-t", "10", "-i", song, "-f", "f32le", "-ac", "1", "-ar", String(CLAP_RATE), "-"], { maxBuffer: 1 << 28 }).stdout;
    if (!pcm || pcm.length < (CLAP_SAMPLES * 4) / 2) continue;
    heard.push({ song: path.basename(song), at, embedding: await embedSound(new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4)) });
  }
}
for (const a of axes) {
  const values = heard.map((h) => axisRaw(h.embedding, data.axes[a]));
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const spread = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  data.axes[a].mean = Math.round(mean * 1e5) / 1e5;
  data.axes[a].spread = Math.round(Math.max(0.01, spread) * 1e5) / 1e5;
}
data.calibration = [...new Set(heard.map((h) => h.song))];
fs.writeFileSync(path.join(ROOT, "shared/signals/vibe.json"), `${JSON.stringify(data)}\n`);

for (const h of heard) {
  const v = hearVibe(h.embedding, data);
  const row = axes.map((a) => `${a} ${v.axes[a] >= 0 ? "+" : ""}${v.axes[a].toFixed(2)}`).join("  ");
  console.log(`${h.song.slice(0, 34).padEnd(34)} ${String(h.at).padStart(3)}s  ${row}  | ${v.genres.map((g) => g.name).join(", ")}`);
}
console.log(`wrote shared/signals/vibe.json: ${heard.length} windows of ${data.calibration.length} songs`);
