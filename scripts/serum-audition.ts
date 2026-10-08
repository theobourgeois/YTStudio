/**
 * An audition page for a round of Serum 2 presets: each preset plays its own phrase over a beat, through Serum in
 * the offline engine (silent: no device is opened, no window shown), rendered as a seamless MP3 loop, all on one
 * HTML page with a score, a verdict and notes per preset that the listener copies back as JSON.
 *
 *   pnpm tsx scripts/serum-audition.ts <session.json>
 *
 * The session (paths in it are relative to the session file):
 *   { title, tempo, master?, out,
 *     drums: { kick?, snare?, hat?, clap?: [16th steps of one bar], volume? },
 *     loops: { <name>: { bars, notes: [[beat, beats, pitch, velocity?], ...] } },
 *     presets: [{ file: "x.SerumPreset", loop, role, name, about?, bed? }],
 *     bed?: { file, loop, volume? } }
 * A preset with `bed: true` plays over a quiet second Serum (the session's `bed`), so a bass is heard under chords.
 * Each loop is rendered twice and the second pass kept, so the tails of its end carry into its start.
 *
 * The engine doesn't tell plugins the song's tempo yet, so Serum assumes 120 BPM: render at 120, or synced LFOs and
 * delays drift against the drums. Needs ffmpeg (FFMPEG_PATH) and Serum 2 in /Library/Audio/Plug-Ins/VST3.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AudioEngine } from "../server/music/engine.ts";
import { readXfer } from "../server/music/serum/container.ts";
import { presetAsState } from "../server/music/serum/plugin-state.ts";
import { DataPaths } from "../server/storage.ts";
import { addChannels, addPluginChannel, setMainVolume, setPatternLength, setSteps, updateChannel } from "../shared/music/edits.ts";
import { editNotes } from "../shared/music/notes.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../shared/music/project.ts";
import { PPQ, type Note } from "../shared/music/types.ts";
import { ENGINE_BINARY, withSerum } from "./serum-readout.ts";

const KIT = path.join(import.meta.dirname, "../public/kit");
const VST3_FOLDER = "/Library/Audio/Plug-Ins/VST3";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const RATE = 48_000;
const DRUMS = ["kick", "snare", "hat", "clap"] as const;

interface Loop {
  bars: number;
  notes: [beat: number, beats: number, pitch: number, velocity?: number][];
}

interface Session {
  title: string;
  tempo: number;
  /** The song's main volume: headroom, since the render is fixed-point and a peak past full scale would clip. */
  master?: number;
  out: string;
  drums: Partial<Record<(typeof DRUMS)[number], number[]>> & { volume?: number };
  loops: Record<string, Loop>;
  presets: { file: string; loop: string; role: string; name: string; about?: string; bed?: boolean }[];
  bed?: { file: string; loop: string; volume?: number };
}

interface Rendered {
  role: string;
  name: string;
  about?: string;
  audio: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const slug = (text: string) => text.replace(/[^\w\- ]+/g, "").trim();

/** A loop's notes as the Piano roll keeps them. */
function notesOf(loop: Loop): Note[] {
  return loop.notes
    .map(([beat, beats, pitch, velocity], i) => ({
      id: i + 1,
      start: Math.round(beat * PPQ),
      length: Math.max(1, Math.round(beats * PPQ)),
      pitch,
      velocity: velocity ?? 0.8,
      pan: 0,
      muted: false,
    }))
    .sort((a, b) => a.start - b.start);
}

async function presetSettings(file: string): Promise<Uint8Array> {
  return readXfer(new Uint8Array(await fs.readFile(file))).settings;
}

async function audition(sessionFile: string) {
  const base = path.dirname(path.resolve(sessionFile));
  const session = JSON.parse(await fs.readFile(sessionFile, "utf8")) as Session;
  const at = (file: string) => path.resolve(base, file);
  const out = at(session.out);
  for (const preset of session.presets) if (!session.loops[preset.loop]) throw new Error(`${preset.name}: there's no loop "${preset.loop}".`);
  if (session.bed && !session.loops[session.bed.loop]) throw new Error(`The bed's loop "${session.bed.loop}" isn't in loops.`);
  await fs.mkdir(path.join(out, "audio"), { recursive: true });

  // Presets load as Serum's own init state with their settings in it.
  const template = await withSerum(async (load) => (await load(null)).resaved);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "serum-audition-"));
  const engine = new AudioEngine(new DataPaths(dir), {
    offline: true,
    onlyPluginPaths: true,
    pluginPaths: [VST3_FOLDER],
    command: [ENGINE_BINARY],
    samplePath: (_project, id) => path.join(KIT, `${id}.wav`),
  });
  const rendered: Rendered[] = [];
  try {
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await sleep(100);
    const serum = (await engine.plugins()).find((p) => p.name === "Serum 2");
    if (!serum) throw new Error(`Serum 2 wasn't found in ${VST3_FOLDER}.`);
    const project = "proj_0123456789ab";
    const plugins = path.join(dir, "projects", project, "plugins");
    await fs.mkdir(plugins, { recursive: true });

    for (const [i, preset] of session.presets.entries()) {
      const loop = session.loops[preset.loop];
      const channel = `chan_s${String(i).padStart(4, "0")}`;
      await fs.writeFile(path.join(plugins, `${channel}.bin`), presetAsState(template, await presetSettings(at(preset.file))));
      const bed = preset.bed && session.bed ? session.bed : null;
      const bedChannel = `${channel}_bed`;
      if (bed) await fs.writeFile(path.join(plugins, `${bedChannel}.bin`), presetAsState(template, await presetSettings(at(bed.file))));

      let song = setMainVolume(createMusicProject("Audition", session.tempo), session.master ?? 0.62);
      song = setPatternLength(song, FIRST_PATTERN_ID, loop.bars * 16);
      const kit = DRUMS.filter((drum) => session.drums[drum]?.length);
      song = addChannels(song, kit.map((drum) => ({ id: `chan_${drum}`, name: drum, sampleId: drum })));
      for (const drum of kit) {
        const steps = Array.from({ length: loop.bars }, (_, bar) => session.drums[drum]!.map((step) => bar * 16 + step)).flat();
        song = setSteps(song, FIRST_PATTERN_ID, `chan_${drum}`, steps, true);
        song = updateChannel(song, `chan_${drum}`, { volume: session.drums.volume ?? 0.55 });
      }
      song = addPluginChannel(song, { id: serum.id, name: "Serum 2", format: "VST3" }, channel);
      song = editNotes(song, FIRST_PATTERN_ID, channel, () => notesOf(loop));
      if (bed) {
        song = addPluginChannel(song, { id: serum.id, name: "Serum 2 (bed)", format: "VST3" }, bedChannel);
        song = editNotes(song, FIRST_PATTERN_ID, bedChannel, () => notesOf(session.loops[bed.loop]));
        song = updateChannel(song, bedChannel, { volume: bed.volume ?? 0.45 });
      }

      await engine.setSong({ projectId: project, song, patternId: FIRST_PATTERN_ID });
      const wanted = bed ? [channel, bedChannel] : [channel];
      for (let t = 0; ; t++) {
        const status = await engine.command("status", {});
        const loaded = new Set(status.channels.loaded.map((c) => c.channel));
        if (wanted.every((c) => loaded.has(c))) break;
        if (status.channels.failed.length) throw new Error(`Serum didn't load: ${JSON.stringify(status.channels.failed)}`);
        if (t > 600) throw new Error("Serum took over a minute to load.");
        await sleep(100);
      }
      await sleep(500); // samples and wavetables finish loading in the background
      const frames = Math.round((loop.bars * 4 * 60 * RATE) / session.tempo);
      await engine.command("play", {});
      await engine.render(frames);
      const wav = path.join(dir, `${channel}.wav`);
      const measured = await engine.render(frames, wav);
      await engine.command("stop", { reset: true });

      const audio = `audio/${String(i + 1).padStart(2, "0")} ${slug(preset.role)} - ${slug(preset.name)}.mp3`;
      const ff = spawnSync(FFMPEG, ["-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "224k", path.join(out, audio)]);
      if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr}`);
      rendered.push({ role: preset.role, name: preset.name, about: preset.about, audio });
      console.log(`${preset.role.padEnd(8)} ${preset.name.padEnd(28)} peak ${measured.peak.toFixed(3)}  rms ${measured.rms.toFixed(3)}`);
    }
  } finally {
    engine.shutdown();
    await sleep(200);
    await fs.rm(dir, { recursive: true, force: true });
  }
  await fs.writeFile(path.join(out, "index.html"), page(session, rendered));
  await fs.writeFile(path.join(out, "session.json"), JSON.stringify(session, null, 2));
  console.log(path.join(out, "index.html"));
}

/** The page: a card per preset (player, 1–10, keep/tweak/scrap, notes), saved in the browser, copied out as JSON. */
function page(session: Session, items: Rendered[]): string {
  const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const cards = items
    .map(
      (item) => `
    <section class="card" data-key="${esc(item.name)}">
      <header><span class="role">${esc(item.role)}</span><h2>${esc(item.name)}</h2></header>
      ${item.about ? `<p class="about">${esc(item.about)}</p>` : ""}
      <audio controls loop preload="none" src="${esc(encodeURI(item.audio))}"></audio>
      <div class="score">${Array.from({ length: 10 }, (_, n) => `<button data-n="${n + 1}">${n + 1}</button>`).join("")}</div>
      <div class="verdict">${["keep", "tweak", "scrap"].map((v) => `<button data-v="${v}">${v}</button>`).join("")}</div>
      <textarea placeholder="Notes (too bright, out of pitch, love the movement…)"></textarea>
    </section>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(session.title)}</title><style>
  body{background:#1b1f27;color:#d7dce5;font:15px/1.45 -apple-system,system-ui,sans-serif;margin:0;padding:28px;max-width:860px}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#8a93a3;margin:0 0 22px}
  .card{background:#252a34;border:1px solid #333a47;border-radius:8px;padding:14px 16px;margin:0 0 14px}
  header{display:flex;gap:10px;align-items:baseline} h2{font-size:17px;margin:0}
  .role{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#1b1f27;background:#7fb3ff;border-radius:4px;padding:2px 6px}
  .about{color:#a9b1bf;margin:6px 0 10px;font-size:13.5px} audio{width:100%;margin:4px 0 8px}
  button{background:#2f3542;color:#cfd5df;border:1px solid #3d4554;border-radius:4px;padding:4px 9px;margin:0 4px 4px 0;cursor:pointer}
  button.on{background:#7fb3ff;color:#111;border-color:#7fb3ff}
  textarea{width:100%;box-sizing:border-box;background:#1d222b;color:#d7dce5;border:1px solid #3d4554;border-radius:4px;padding:6px;min-height:38px;font:inherit}
  #copy{background:#7fb3ff;color:#111;font-weight:600;padding:8px 14px} #done{color:#8fd19e;margin-left:8px}
  </style></head><body>
  <h1>${esc(session.title)}</h1><p class="sub">${session.tempo} BPM · every preset loops its own phrase over the same beat. Score as you go; it saves in this browser.</p>
  ${cards}
  <button id="copy">Copy scores for Claude</button><span id="done"></span><textarea id="out" hidden rows="10"></textarea>
  <script>
  const KEY = ${JSON.stringify("serum-audition:" + session.title)};
  const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  const save = () => localStorage.setItem(KEY, JSON.stringify(saved));
  document.querySelectorAll(".card").forEach((card) => {
    const k = card.dataset.key, st = (saved[k] ||= {});
    const mark = () => { card.querySelectorAll("[data-n]").forEach((b) => b.classList.toggle("on", +b.dataset.n === st.score));
      card.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === st.verdict)); };
    card.querySelectorAll("[data-n]").forEach((b) => b.onclick = () => { st.score = +b.dataset.n; save(); mark(); });
    card.querySelectorAll("[data-v]").forEach((b) => b.onclick = () => { st.verdict = b.dataset.v; save(); mark(); });
    const t = card.querySelector("textarea"); t.value = st.notes || ""; t.oninput = () => { st.notes = t.value; save(); };
    card.querySelector("audio").onplay = (e) => document.querySelectorAll("audio").forEach((a) => a !== e.target && a.pause());
    mark();
  });
  document.getElementById("copy").onclick = async () => {
    const text = JSON.stringify({ round: ${JSON.stringify(session.title)}, scores: saved }, null, 2);
    try { await navigator.clipboard.writeText(text); document.getElementById("done").textContent = "Copied: paste it to Claude"; }
    catch { const box = document.getElementById("out"); box.hidden = false; box.value = text; box.select();
      document.getElementById("done").textContent = "Select all in the box and copy it"; }
  };
  </script></body></html>`;
}

const sessionFile = process.argv[2];
if (!sessionFile) {
  console.error("Usage: pnpm tsx scripts/serum-audition.ts <session.json>");
  process.exit(1);
}
await audition(sessionFile);
