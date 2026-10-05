/** JSON-line bridge from ST-ITO's optimizer to the app's actual native plugins. */
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { AudioEngine, engineOutdated } from "../server/music/engine.ts";
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

const root = path.resolve(process.argv[2] ?? "data/st-ito-runtime");
await fs.mkdir(root, { recursive: true });
if (await engineOutdated(ENGINE)) throw new Error("Build the current native engine before testing ST-ITO");
const samples = new Map<string, string>();
const engine = new AudioEngine(new DataPaths(path.join(root, "engine-workspace")), {
  offline: true, onlyPluginPaths: true, pluginPaths: [], samplePath: (_project, id) => samples.get(id) ?? null,
});
const specs = {
  chain: ["eqGainDb", "eqHz", "thresholdDb", "ratio", "reverbMix", "decaySeconds", "predelaySeconds"],
  delay: ["delayMix", "delayMs", "feedback"],
  eq: ["eqGainDb", "eqHz"],
};
type Kind = keyof typeof specs;
const linear = (v: number, lo: number, hi: number) => lo + v * (hi - lo);
const log = (v: number, lo: number, hi: number) => lo * (hi / lo) ** v;
function parameters(kind: Kind, w: number[]): Record<string, number> {
  if (kind === "delay") return { delayMix: linear(w[0], 0, .4), delayMs: log(w[1], 80, 500), feedback: linear(w[2], 0, .4) };
  const p = { eqGainDb: linear(w[0], -8, 6), eqHz: log(w[1], 1000, 10000) };
  return kind === "eq" ? p : { ...p, thresholdDb: linear(w[2], -36, -6), ratio: linear(w[3], 1, 6),
    reverbMix: linear(w[4], 0, .4), decaySeconds: log(w[5], .3, 2.5), predelaySeconds: linear(w[6], 0, .06) };
}
async function saveFloat(file: string, channels: Float32Array[], rate: number) {
  const frames = channels[0].length, count = channels.length;
  const data = Buffer.alloc(frames * count * 4);
  for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) data.writeFloatLE(channels[c][i], (i * count + c) * 4);
  const h = Buffer.alloc(44);
  h.write("RIFF"); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(count, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * count * 4, 28);
  h.writeUInt16LE(count * 4, 32); h.writeUInt16LE(32, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  await fs.writeFile(file, Buffer.concat([h, data]));
}
console.log(JSON.stringify({ ready: true, binary: ENGINE,
  binarySha256: createHash("sha256").update(await fs.readFile(ENGINE)).digest("hex"), specs }));
let serial = 0;
try {
  for await (const line of readline.createInterface({ input: process.stdin })) {
    try {
      const req = JSON.parse(line) as { source: string; kind: Kind; w: number[]; output?: string };
      if (!Object.hasOwn(specs, req.kind) || req.w.length !== specs[req.kind].length ||
          !req.w.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error("Invalid normalized search parameters");
      samples.set("media_000000000000", path.resolve(req.source));
      let song = addAudioClips(createMusicProject("ST-ITO native candidate", 120),
        [{ sampleId: "media_000000000000", name: "Real stem", seconds: 20 }], { start: 0, track: 0 }).song;
      const p = parameters(req.kind, req.w);
      if (req.kind !== "delay") {
        song = setEffect(song, MASTER_TRACK_ID, 0, PRO_Q_PLUGIN, "fx_eq");
        song = editProQ(song, "fx_eq", pq => ({ ...pq, autoGain: false, bands: [
          { ...DEFAULT_BAND, id: 1, shape: "highShelf", frequency: p.eqHz, gain: p.eqGainDb, q: .71 },
        ] }));
      }
      if (req.kind === "chain") {
        song = setEffect(song, MASTER_TRACK_ID, 1, PRO_C_PLUGIN, "fx_comp");
        song = updateProC(song, "fx_comp", { style: "clean", threshold: p.thresholdDb, slope: 1 - 1 / p.ratio,
          knee: 6, attack: .01, release: .15, range: 18, autoGain: false, autoRelease: false,
          mix: 1, sidechain: { bands: [] }, options: { link: true } });
        song = setEffect(song, MASTER_TRACK_ID, 2, REVERB_PLUGIN, "fx_reverb");
        song = updateReverb(song, "fx_reverb", { mode: "plate", predelay: p.predelaySeconds,
          decay: p.decaySeconds, mix: p.reverbMix, width: 1 });
      }
      if (req.kind === "delay") {
        song = setEffect(song, MASTER_TRACK_ID, 0, ECHO_BOY_PLUGIN, "fx_delay");
        song = updateEchoBoy(song, "fx_delay", { mode: "single", echo1: { sync: "time", ms: p.delayMs },
          mix: p.delayMix, feedback: p.feedback, saturation: 0, followTempo: false });
      }
      const folder = path.join(root, "scratch");
      await fs.mkdir(folder, { recursive: true });
      const done = await engine.renderExport({ id: `stito_${serial++}`, projectId: "proj_abcdef012345", song,
        patternId: null, mode: "song", loop: null, resampling: "sinc", folder, mix: true,
        stems: false, tail: "cut", maxTail: 0, threads: 1 });
      if (done.state !== "done" || done.missing.length) throw new Error(`Native render incomplete: ${JSON.stringify(done)}`);
      const audio = await readWav(path.join(folder, "mix.wav"));
      if (audio.sampleRate !== 48000 || audio.channels[0].length !== 20 * 48000) throw new Error("Unexpected native render format");
      const output = path.resolve(req.output ?? path.join(root, "scratch", "passage.wav"));
      await fs.mkdir(path.dirname(output), { recursive: true });
      await saveFloat(output, audio.channels.map(c => c.slice(4 * 48000)), audio.sampleRate);
      console.log(JSON.stringify({ file: output, parameters: p, song, renderSeconds: done.seconds,
        sha256: createHash("sha256").update(await fs.readFile(output)).digest("hex") }));
    } catch (error) {
      console.log(JSON.stringify({ error: String(error) }));
    }
  }
} finally { engine.shutdown(); }
