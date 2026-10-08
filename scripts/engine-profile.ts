/**
 * What a song costs to play: renders a song's package in the real engine, offline (silent), in song mode
 * as the app plays it, and says its load (the time taken against the audio's length: what the toolbar's
 * CPU graph shows) and the CPU time used on every thread. The package is copied first: nothing is written
 * to it. To see what each part costs: `--without <plugin name>` takes every effect of that name out
 * (several allowed), `--mute-plugins` the plugin channels' notes, `--only-plugin <n>` keeps the nth plugin
 * channel alone; VAUDIO_PLAYBACK_THREADS=1 plays on the audio thread alone. `--sample` profiles it (macOS).
 * `--plugins` is a scanned plugin list to start from (default: this checkout's data/engine/plugins.xml),
 * else every plugin on this computer is scanned first.
 *
 *   pnpm tsx scripts/engine-profile.ts ~/Documents/YTStudio/bemine.yt [--seconds 30] [--from <seconds>] [--without YT-EQ] [--sample]
 */
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { normalizeMusicProject } from "../shared/music/project.ts";
import { type MusicProject, PPQ } from "../shared/music/types.ts";
import { DataPaths } from "../server/storage.ts";
import { AudioEngine } from "../server/music/engine.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seconds: { type: "string", default: "30" },
    from: { type: "string", default: "0" },
    without: { type: "string", multiple: true, default: [] },
    "mute-plugins": { type: "boolean", default: false },
    "only-plugin": { type: "string" },
    sample: { type: "boolean", default: false },
    plugins: { type: "string", default: path.join(import.meta.dirname, "../data/engine/plugins.xml") },
  },
});
const source = positionals[0];
if (!source) throw new Error("Which package? pnpm tsx scripts/engine-profile.ts <Name.yt>");

const RATE = 48_000;
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "engine-profile-"));
const pkg = path.join(tmp, "song.yt");
await fs.cp(source, pkg, { recursive: true });
// This computer's plugin list, so the engine doesn't scan them all again.
await fs.mkdir(path.join(tmp, "engine"), { recursive: true });
await fs.cp(values.plugins, path.join(tmp, "engine/plugins.xml")).catch(() => {});

const meta = JSON.parse(await fs.readFile(path.join(pkg, "meta.json"), "utf8")) as { id: string };
let song: MusicProject = normalizeMusicProject(JSON.parse(await fs.readFile(path.join(pkg, "project.json"), "utf8")));
const without = new Set(values.without);
if (without.size > 0) {
  song = { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => ({ ...t, effects: t.effects.map((e) => (e && without.has(e.plugin.name) ? null : e)) })) } };
}
// One plugin channel kept (by its place among them, from 0), the others taken out of the song.
if (values["only-plugin"] !== undefined) {
  const kept = song.channels.filter((c) => c.kind === "plugin")[Number(values["only-plugin"])];
  song = { ...song, channels: song.channels.filter((c) => c.kind !== "plugin" || c === kept) };
}
if (values["mute-plugins"]) song = { ...song, channels: song.channels.map((c) => (c.kind === "plugin" ? { ...c, muted: true } : c)) };

const engine = new AudioEngine(new DataPaths(tmp), {
  offline: true,
  samplePath: (_project, id) => path.join(pkg, "media", id, "source.wav"),
  projectDir: () => pkg,
});
try {
  await engine.command("scan", {});
  while ((await engine.command("status", {})).scanning) await new Promise((resolve) => setTimeout(resolve, 100));
  await engine.setSong({ projectId: meta.id, song, patternId: null, mode: "song" });
  for (;;) {
    const status = await engine.command("status", {});
    if (status.channels.loading.length === 0) {
      for (const failed of status.channels.failed) console.log(`failed: ${failed.channel}: ${failed.error}`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const fromTick = Math.round((Number(values.from) * song.settings.tempo * PPQ) / 60);
  await engine.command("play", { from: fromTick });

  const marker = `--data ${path.join(tmp, "engine")}`;
  const row = execFileSync("ps", ["-ax", "-o", "pid=,command="]).toString().split("\n").find((line) => line.includes(marker) && line.includes("YTStudio Engine"));
  const pid = Number(row?.trim().split(/\s+/)[0]);
  const cpu = () => {
    const [user, system] = execFileSync("ps", ["-o", "utime=,stime=", "-p", String(pid)]).toString().trim().split(/\s+/);
    return psTime(user) + psTime(system);
  };
  // A second first, so plugins have warmed up.
  await engine.render(RATE);
  const seconds = Number(values.seconds);
  const sampler = values.sample ? sample(pid, Math.max(1, Math.round(seconds / 4))) : null;
  const before = cpu();
  const started = performance.now();
  for (let done = 0; done < seconds; done++) await engine.render(RATE);
  const wall = (performance.now() - started) / 1000;
  const used = cpu() - before;
  // The load is what the toolbar's CPU graph shows: how much of the audio's time computing it took (the workers' share included).
  console.log(`${seconds} s of audio in ${wall.toFixed(2)} s (load ${((wall / seconds) * 100).toFixed(1)}%), ${used.toFixed(2)} s of CPU in all`);
  if (sampler) console.log(await sampler);
} finally {
  engine.shutdown();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await fs.rm(tmp, { recursive: true, force: true });
}

function psTime(time: string): number {
  // ps: [[dd-]hh:]mm:ss.cc
  return time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** macOS's `sample` of the engine for a while: where its time goes. */
function sample(pid: number, duration: number): Promise<string> {
  const file = path.join(os.tmpdir(), `engine-profile-${pid}.txt`);
  return new Promise((resolve) => execFile("sample", [String(pid), String(duration), "-file", file], () => resolve(`sample written to ${file}`)));
}
