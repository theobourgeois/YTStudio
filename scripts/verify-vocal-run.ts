/**
 * E end to end on real recordings through the real engine (offline: no sound): a song made of a real vocal stem
 * on its own insert and the rest of the band on another, from the hearing benchmark's downloads (run its `fetch`
 * first). Capture → measure → propose → render → measure each candidate → accept one → render the accepted song
 * and check it measures as its candidate did. Everything goes in the gitignored data/vocal-run-check/.
 *
 *   pnpm tsx scripts/verify-vocal-run.ts [notalone|redtoblue ...]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DataPaths } from "../server/storage.ts";
import { AudioEngine } from "../server/music/engine.ts";
import { AudioIntelligence } from "../server/music/audio-intelligence/service.ts";
import { createMusicProject } from "../shared/music/project.ts";
import { addAudioClips } from "../shared/music/playlist.ts";
import { addMixerTracks, updateMixerTrack } from "../shared/music/mixer.ts";
import { acceptVocalCandidate, vocalRevision, type VocalMixRun } from "../shared/music/audio-intelligence/vocal-mix.ts";
import { readWav } from "../server/music/wav.ts";
import type { MusicProject } from "../shared/music/types.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const STEMS = path.join(ROOT, "data/hearing-benchmark/sources/Evaluation/audio");
/** Two songs: where the vocal sings with the band (seconds into the stems), as the benchmark's listening found. */
const SONGS: Record<string, { folder: string; passages: [number, number][] }> = {
  notalone: { folder: "NotAloneStems/McG-A", passages: [[152, 167], [75, 90]] },
  redtoblue: { folder: "RedToBlueStems/McG-A", passages: [[56, 71], [100, 115]] },
};
const out = path.join(ROOT, "data/vocal-run-check");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
const projectId = "proj_0000000c0ffe";
const media = new Map<string, string>();
const engine = new AudioEngine(new DataPaths(out), { offline: true, samplePath: (_p, id) => media.get(id) ?? null, projectDir: () => out });
const audio = new AudioIntelligence({ root: path.join(out, "analysis"), engine, projectDir: () => out, samplePath: (_p, id) => media.get(id) ?? null, isMusicProject: id => id === projectId });
await audio.init();

async function song(name: string): Promise<{ song: MusicProject; passages: [number, number][] }> {
  const spec = SONGS[name], files = ["vocal", "bass", "kick", "snare", "rest"];
  const seconds = new Map<string, number>();
  for (const f of files) {
    const file = path.join(STEMS, spec.folder, `${f}.wav`);
    media.set(`media_${name}_${f}`, file);
    const wav = await readWav(file);
    seconds.set(f, wav.channels[0].length / wav.sampleRate);
  }
  let s = addMixerTracks(createMusicProject(name, 120), null, 2, ["insert_vocal", "insert_band"]);
  s = addAudioClips(s, files.map(f => ({ channelId: `chan_${f}`, name: f, sampleId: `media_${name}_${f}`, seconds: seconds.get(f)! })), { start: 0, track: 0 }).song;
  s = { ...s, channels: s.channels.map(c => ({ ...c, mixerTrack: c.id === "chan_vocal" ? "insert_vocal" : "insert_band" })) };
  s = updateMixerTrack(updateMixerTrack(s, "insert_vocal", { name: "Vocal" }), "insert_band", { name: "Band" });
  return { song: s, passages: spec.passages };
}
const tick = (seconds: number) => Math.round(seconds * 192);
async function settle(id: string) {
  for (let i = 0; i < 3000; i++) {
    const run = await audio.vocalMix.get(projectId, id);
    if (!["preparing", "analysing", "rendering"].includes(run.status)) return run;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("The run timed out.");
}

const results = [];
try {
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SONGS)) {
    const started = Date.now(), { song: base, passages } = await song(name);
    const captured = await audio.capture(projectId, { song: base, live: true });
    const run: VocalMixRun = await settle((await audio.tool(projectId, "create_vocal_mix_run", { snapshotId: captured.snapshot.id, vocalTrackId: "insert_vocal", goal: "Sit the vocal in the band",
      startTick: tick(passages[0][0]), endTick: tick(passages[0][1]), checkStartTick: tick(passages[1][0]), checkEndTick: tick(passages[1][1]) }) as VocalMixRun).id);
    console.log(`\n== ${name}: ${run.status} in ${((Date.now() - started) / 1000).toFixed(0)} s${run.error ? ` (${run.error})` : ""}`);
    if (run.status !== "ready") { results.push({ name, run }); continue; }
    run.findings!.forEach((list, i) => console.log(`passage ${i + 1}: ${list.map(f => f.text).join(" | ") || "nothing past its starting point"}`));
    if (run.conclusion) console.log(run.conclusion);
    for (const c of run.candidates.slice(1)) console.log(`\n[${c.id}] ${c.label}\n  ${c.reasons.join("\n  ")}\n  measured: ${c.effects.join("; ")}\n  true peaks ${c.renders.map(r => r.truePeakDbtp?.toFixed(1)).join(", ")} dBTP; playback gains ${c.renders.map(r => r.auditionGainDb?.toFixed(1)).join(", ")} dB`);
    // Accept the candidate that changes most (as a person choosing it would), then render the accepted song: it should measure as its candidate did.
    const chosen = run.candidates.at(-1)!;
    let check = null;
    if (chosen.change) {
      const accepted = acceptVocalCandidate(base, run, chosen.id);
      if (vocalRevision(accepted) === run.baseRevision) throw new Error("Accepting changed nothing.");
      const after = await audio.capture(projectId, { song: accepted, live: true });
      const again = await settle((await audio.tool(projectId, "create_vocal_mix_run", { snapshotId: after.snapshot.id, vocalTrackId: "insert_vocal", candidates: [],
        startTick: tick(passages[0][0]), endTick: tick(passages[0][1]), checkStartTick: tick(passages[1][0]), checkEndTick: tick(passages[1][1]) }) as VocalMixRun).id);
      // BS.1770 integrated loudness doesn't depend on which moments count as singing: the vocal's and the mix's.
      const was = chosen.analyses.map(a => [a?.vocal.integratedLufs, a?.mix.integratedLufs]), now = again.candidates[0].analyses.map(a => [a?.vocal.integratedLufs, a?.mix.integratedLufs]);
      const match = was.every((pair, i) => pair.every((v, j) => v != null && now[i][j] != null && Math.abs(v - now[i][j]!) < 0.05));
      check = { candidate: chosen.id, candidateLufs: was, acceptedLufs: now, match };
      const fmt = (rows: (number | null | undefined)[][]) => rows.map(r => `vocal ${r[0]?.toFixed(2)} / mix ${r[1]?.toFixed(2)}`).join("; ");
      console.log(`\naccepted "${chosen.id}"; rendered again: ${fmt(now)} LUFS (the candidate measured ${fmt(was)}): ${match ? "the same" : "DIFFERENT"}`);
      // Undo is the editor's: the accepted song differs from the base only on the vocal's insert.
      const vocalOnly = JSON.stringify({ ...accepted, mixer: { ...accepted.mixer, tracks: accepted.mixer.tracks.filter(t => t.id !== "insert_vocal") } }) === JSON.stringify({ ...base, mixer: { ...base.mixer, tracks: base.mixer.tracks.filter(t => t.id !== "insert_vocal") } });
      console.log(`only the vocal's insert changed: ${vocalOnly}`);
    }
    results.push({ name, run, check });
  }
} finally {
  await fs.writeFile(path.join(out, "verification.json"), JSON.stringify(results, null, 2));
  audio.shutdown(); engine.shutdown();
}
console.log(`\n${path.join(out, "verification.json")}`);
