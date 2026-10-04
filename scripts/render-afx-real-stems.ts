/** Render real multitracks through the app's AudioEngine API and built-in plugins. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { AudioEngine } from "../server/music/engine.ts";
import { DataPaths } from "../server/storage.ts";
import { ENGINE } from "../server/config.ts";
import { readWav } from "../server/music/wav.ts";
import { createMusicProject, MASTER_TRACK_ID } from "../shared/music/project.ts";
import { addAudioClips } from "../shared/music/playlist.ts";
import { setEffect } from "../shared/music/mixer.ts";
import { PRO_Q_PLUGIN, DEFAULT_BAND } from "../shared/music/pro-q-presets.ts";
import { editProQ } from "../shared/music/pro-q.ts";
import { PRO_C_PLUGIN } from "../shared/music/pro-c-presets.ts";
import { updateProC } from "../shared/music/pro-c.ts";
import { REVERB_PLUGIN } from "../shared/music/reverb-presets.ts";
import { updateReverb } from "../shared/music/reverb.ts";
import { ECHO_BOY_PLUGIN } from "../shared/music/echo-boy-presets.ts";
import { updateEchoBoy } from "../shared/music/echo-boy.ts";
import type { MusicProject } from "../shared/music/types.ts";

const root = path.resolve("data/afx-rep-real-stems");
const manifest = JSON.parse(await fs.readFile(path.join(root, "prepared-manifest.json"), "utf8")) as {
  sources: { id: string; file: string; song: string; role: string }[];
};
const treatments = ["dry", "eq-dark", "eq-bright", "compress", "reverb", "delay", "chain"];
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const engine = new AudioEngine(new DataPaths(path.join(root, "engine-workspace")), {
  offline: true, onlyPluginPaths: true, pluginPaths: [], samplePath: (_project, id) => samples.get(id) ?? null,
});
const samples = new Map<string, string>();
const report = {
  renderer: "AudioEngine.renderExport — the app's native offline export API",
  binary: ENGINE, binarySha256: sha(await fs.readFile(ENGINE)),
  leadInSeconds: 4, passageSeconds: 12, tailSeconds: 4, treatments,
  sources: manifest.sources, renders: [] as {
    source: string; treatment: string; file: string; sha256: string; song: MusicProject;
    renderSeconds: number; latency: number; sampleRate: number; missing: string[];
  }[],
};

function effects(song: MusicProject, treatment: string): MusicProject {
  let slot = 0;
  if (treatment.startsWith("eq-") || treatment === "chain") {
    song = setEffect(song, MASTER_TRACK_ID, slot++, PRO_Q_PLUGIN, "fx_eq");
    song = editProQ(song, "fx_eq", pq => ({ ...pq, autoGain: false, bands: [
      { ...DEFAULT_BAND, id: 1, shape: "highShelf", frequency: 5000, gain: treatment === "eq-bright" ? 4 : treatment === "chain" ? -2 : -6, q: .71 },
    ] }));
  }
  if (treatment === "compress" || treatment === "chain") {
    song = setEffect(song, MASTER_TRACK_ID, slot++, PRO_C_PLUGIN, "fx_comp");
    song = updateProC(song, "fx_comp", { style: "clean", threshold: -26, slope: .75, knee: 6,
      attack: .01, release: .15, range: 18, autoGain: false, autoRelease: false, mix: 1,
      sidechain: { bands: [] }, options: { link: true } });
  }
  if (treatment === "reverb" || treatment === "chain") {
    song = setEffect(song, MASTER_TRACK_ID, slot++, REVERB_PLUGIN, "fx_reverb");
    song = updateReverb(song, "fx_reverb", { mode: "plate", predelay: .025, decay: 1.4,
      mix: treatment === "chain" ? .15 : .3, width: 1 });
  }
  if (treatment === "delay") {
    song = setEffect(song, MASTER_TRACK_ID, slot++, ECHO_BOY_PLUGIN, "fx_delay");
    song = updateEchoBoy(song, "fx_delay", { mode: "single", echo1: { sync: "time", ms: 250 },
      mix: .25, feedback: .25, saturation: 0, followTempo: false });
  }
  return song;
}

async function saveFloat(file: string, channels: Float32Array[], rate: number) {
  const frames = channels[0].length, count = channels.length;
  const data = Buffer.alloc(frames * count * 4);
  for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) data.writeFloatLE(channels[c][i], (i*count+c)*4);
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36+data.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(count, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate*count*4, 28);
  header.writeUInt16LE(count*4, 32); header.writeUInt16LE(32, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  await fs.writeFile(file, Buffer.concat([header, data]));
}

try {
  for (const [i, source] of manifest.sources.entries()) {
    const mediaId = `media_${String(i).padStart(12, "0")}`;
    samples.set(mediaId, source.file);
    const dry = addAudioClips(createMusicProject(source.id, 120), [{ sampleId: mediaId, name: source.id, seconds: 20 }], { start: 0, track: 0 }).song;
    for (const treatment of treatments) {
      const folder = path.join(root, "renders", source.id, treatment);
      await fs.mkdir(folder, { recursive: true });
      const song = effects(dry, treatment);
      const done = await engine.renderExport({ id: `native_${i}_${treatment}`, projectId: "proj_abcdef012345",
        song, patternId: null, mode: "song", loop: null, resampling: "sinc", folder,
        mix: true, stems: false, tail: "cut", maxTail: 0, threads: 1 });
      if (done.state !== "done" || done.missing.length) throw new Error(`Native render incomplete: ${JSON.stringify(done)}`);
      const audio = await readWav(path.join(folder, "mix.wav"));
      const start = 4*audio.sampleRate, end = 20*audio.sampleRate;
      if (audio.channels[0].length < end) throw new Error("Native export shorter than requested passage plus tail");
      const file = path.join(folder, "passage.wav");
      await saveFloat(file, audio.channels.map(c => c.slice(start, end)), audio.sampleRate);
      const row = { source: source.id, treatment, file, sha256: sha(await fs.readFile(file)), song,
        renderSeconds: done.seconds, latency: done.latency, sampleRate: done.sampleRate, missing: done.missing };
      report.renders.push(row);
      await fs.writeFile(path.join(root, "render-manifest.json"), JSON.stringify(report, null, 2));
      console.log(`${source.id}/${treatment}: ${done.seconds.toFixed(3)}s, ${done.sampleRate}Hz, no missing sources`);
    }
  }
} finally {
  engine.shutdown();
}
