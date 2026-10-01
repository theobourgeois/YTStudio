/**
 * How fast the audio engine renders a song offline: the measure the export is built against.
 *
 *   pnpm tsx scripts/render-bench.ts [--synth "Serum 2"] [--channels 6] [--fx AUReverb2] [--seconds 180]
 *
 * Starts an offline engine (no device, nothing heard) with the plugins this computer's engine already
 * knows (`data/engine/plugins.xml`), plays a pattern of chords on `--channels` instances of `--synth`,
 * each on its own mixer track through `--fx` (none with `--fx none`), with two sampler drums, and
 * renders `--seconds` of it as playback would (10-second requests, one thread), then exports it (the
 * pattern arranged on the playlist) on one thread and on every core. Prints how many times faster than
 * real time each went. `--synth "Vaudio Test Synth"` measures the engine with plugins that cost almost nothing.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addChannels, addPluginChannel, setChannelNotes, setPatternLength, setSteps } from "../shared/music/edits.ts";
import { addClips, editClips } from "../shared/music/playlist.ts";
import { addMixerTracks, routeChannels, setEffect } from "../shared/music/mixer.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../shared/music/project.ts";
import type { MusicProject, Note } from "../shared/music/types.ts";
import { AudioEngine } from "../server/music/engine.ts";
import { writeWav } from "../server/music/wav.ts";
import { DataPaths } from "../server/storage.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const synthName = option("synth", "Serum 2");
const channels = Number(option("channels", "6"));
const fxName = option("fx", "AUReverb2");
const seconds = Number(option("seconds", "180"));

const RATE = 48_000;
const CHUNK_SECONDS = 10;
const PROJECT = "proj_0123456789ab";
const P = FIRST_PATTERN_ID;
const BAR = 384;

const known = path.resolve("data/engine/plugins.xml");
if (!existsSync(known)) {
  console.error("No data/engine/plugins.xml: open the music suite once in `pnpm dev` so the engine scans this computer's plugins.");
  process.exit(1);
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "render-bench-"));
const paths = new DataPaths(dir);
await fs.mkdir(paths.engine, { recursive: true });
await fs.copyFile(known, path.join(paths.engine, "plugins.xml"));
// Two drum hits: a decaying thump and a short noise burst.
await writeWav(path.join(dir, "kick.wav"), Float32Array.from({ length: RATE / 4 }, (_, i) => Math.sin((i / RATE) * 2 * Math.PI * 55) * Math.exp(-i / 4000) * 0.8), RATE);
await writeWav(path.join(dir, "hat.wav"), Float32Array.from({ length: RATE / 20 }, (_, i) => (Math.random() * 2 - 1) * Math.exp(-i / 400) * 0.4), RATE);

const engine = new AudioEngine(paths, {
  offline: true,
  samplePath: (_project, id) => (id === "kick" || id === "hat" ? path.join(dir, `${id}.wav`) : null),
});

try {
  const plugins = await engine.plugins();
  const synth = plugins.find((p) => p.name === synthName && p.isInstrument);
  if (!synth) throw new Error(`No instrument called "${synthName}". Known: ${plugins.filter((p) => p.isInstrument).map((p) => p.name).join(", ")}`);
  const fx = fxName === "none" ? null : plugins.find((p) => p.name === fxName && !p.isInstrument);
  if (fxName !== "none" && !fx) throw new Error(`No effect called "${fxName}".`);

  // Four bars of chords, a different one per bar, on every synth (an octave apart), and drums.
  const chords = [
    [57, 60, 64, 67],
    [53, 57, 60, 64],
    [48, 52, 55, 59],
    [55, 59, 62, 65],
  ];
  let song: MusicProject = addChannels(createMusicProject("Bench", 120), [
    { id: "chan_kick", name: "Kick", sampleId: "kick" },
    { id: "chan_hat", name: "Hat", sampleId: "hat" },
  ]);
  song = setPatternLength(song, P, 64);
  // A mixer track for each synth.
  const inserts = song.mixer.tracks.length - 1;
  if (inserts < channels) {
    const ids = Array.from({ length: channels - inserts }, (_, i) => `insert_${inserts + i + 1}`);
    song = addMixerTracks(song, song.mixer.tracks.at(-1)!.id, ids.length, ids);
  }
  song = setSteps(song, P, "chan_kick", [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60], true);
  song = setSteps(song, P, "chan_hat", Array.from({ length: 32 }, (_, i) => i * 2 + 1), true);
  for (let c = 0; c < channels; c++) {
    const id = `chan_synth_${c}`;
    song = addPluginChannel(song, { id: synth.id, name: synth.name, format: synth.format }, id);
    const octave = 12 * ((c % 3) - 1);
    const notes: Note[] = chords.flatMap((chord, bar) =>
      [0, 1, 2, 3].flatMap((beat) => chord.map((pitch) => ({ start: bar * BAR + beat * 96, length: 90, pitch: pitch + octave, velocity: 0.8, pan: 0, muted: false }))),
    ).map((note, i) => ({ ...note, id: i + 1 }));
    song = setChannelNotes(song, P, id, () => notes);
    const track = `insert_${c + 1}`;
    song = routeChannels(song, [id], track);
    if (fx) song = setEffect(song, track, 0, { id: fx.id, name: fx.name, format: fx.format }, `fx_${c}`);
  }

  // Wait for every plugin to load.
  const wanted = { channels, effects: fx ? channels : 0 };
  const loadStart = performance.now();
  for (;;) {
    if (performance.now() - loadStart > 60_000) throw new Error("The plugins took over a minute to load.");
    const answer = await engine.setSong({ projectId: PROJECT, song, patternId: P });
    if (answer.channels.failed.length || answer.effects.failed.length) throw new Error(JSON.stringify([...answer.channels.failed, ...answer.effects.failed]));
    if (answer.channels.loaded.length === wanted.channels && answer.effects.loaded.length === wanted.effects) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const loadMs = performance.now() - loadStart;

  // Played as playback would (the `render` command: one thread, the device's blocks of 512), in 10-second pieces.
  await engine.command("play", {});
  const times: number[] = [];
  for (let done = 0; done < seconds; done += CHUNK_SECONDS) {
    const start = performance.now();
    await engine.render(Math.round(Math.min(CHUNK_SECONDS, seconds - done) * RATE));
    times.push(performance.now() - start);
  }
  await engine.command("stop", {});
  const live = times.reduce((a, b) => a + b, 0) / 1000;

  // Exported: the pattern placed on the playlist again and again for `seconds`, rendered once, on one thread and on every core.
  const bars = Math.ceil(seconds / 2);
  const arranged = editClips(song, (clips) => addClips(clips, Array.from({ length: Math.ceil(bars / 4) }, (_, i) => ({ kind: "pattern" as const, ref: P, start: i * 4 * BAR, track: 0 }))).clips);
  const exportOnce = async (threads?: number) => {
    const start = performance.now();
    const result = await engine.renderExport({
      id: `exp_${threads ?? "all"}`,
      projectId: PROJECT,
      song: arranged,
      patternId: P,
      mode: "song",
      loop: { start: 0, end: bars * BAR },
      resampling: "sinc",
      folder: path.join(dir, `export-${threads ?? "all"}`),
      mix: true,
      stems: false,
      tail: "cut",
      threads,
    });
    if (result.state !== "done") throw new Error("The export didn't finish.");
    return { wall: (performance.now() - start) / 1000, frames: result.frames };
  };
  const one = await exportOnce(1);
  const all = await exportOnce();

  const cores = os.cpus().length;
  const pace = (secs: number) => `${secs.toFixed(2)} s, ${(seconds / secs).toFixed(1)}× real time`;
  console.log(`${channels} × ${synthName}${fx ? ` through ${fxName}` : ""}, 2 sampler drums, ${seconds} s of song at ${RATE} Hz (${os.cpus()[0].model}, ${cores} cores)`);
  console.log(`  plugins loaded in ${(loadMs / 1000).toFixed(2)} s`);
  console.log(`  played (one thread, blocks of 512):   ${pace(live)}`);
  console.log(`  exported on one thread (blocks of 2048): ${pace(one.wall)}`);
  console.log(`  exported on every core:               ${pace(all.wall)}`);
} finally {
  engine.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
}
