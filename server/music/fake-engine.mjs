#!/usr/bin/env node
// A stand-in for the audio engine (tests): the same JSON lines, no sound. It keeps time like the real
// one (a playing song's position moves), and `crash` exits mid-command.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const PLUGINS = [
  { id: "VST3-Fake Synth-1", name: "Fake Synth", format: "VST3", manufacturer: "Fake", category: "Instrument", isInstrument: true },
  { id: "VST3-Fake Delay-2", name: "Fake Delay", format: "VST3", manufacturer: "Fake", category: "Fx", isInstrument: false },
];
const slots = { instrument: null, effect: null };
const device = { output: "Fake Output", bufferSize: 256, sampleRate: 48000 };
let tone = false;
let metronome = false;
let song = null;
/** When the song started playing (ms), or null. */
let playingSince = null;
/** What the desktop app last said of its window (`host`). */
let host = null;
/** The Browser's preview: what, from where, since when (ms). It plays for 2 s: the fake reads no files. */
let preview = null;
const PREVIEW_SECONDS = 2;
const previewNow = () => {
  if (!preview) return null;
  const seconds = preview.start + (Date.now() - preview.since) / 1000;
  if (seconds >= PREVIEW_SECONDS) return (preview = null);
  return { id: preview.id, seconds, duration: PREVIEW_SECONDS };
};
/** The plugin channels and effects whose window is open. */
const editors = new Set();

/** The song's plugin channels: all loaded at once, but for a plugin that isn't one of ours. */
const channels = () => {
  const hosted = (song?.channels ?? []).filter((c) => c.plugin);
  const known = (c) => PLUGINS.some((p) => p.id === c.plugin.id);
  return {
    loaded: hosted.filter(known).map((c) => ({ channel: c.id, name: PLUGINS.find((p) => p.id === c.plugin.id).name, editorOpen: editors.has(c.id), latency: 0 })),
    loading: [],
    failed: hosted.filter((c) => !known(c)).map((c) => ({ channel: c.id, error: "This plugin isn't installed on this computer (or hasn't been scanned)." })),
  };
};

/** The mixer's effects: all loaded at once, but for a plugin that isn't one of ours. */
const effects = () => {
  const hosted = (song?.tracks ?? []).flatMap((t) => t.effects ?? []);
  const known = (e) => PLUGINS.some((p) => p.id === e.plugin.id);
  return {
    // The fake delay delays its sound by 10 ms, as a look-ahead plugin would.
    loaded: hosted.filter(known).map((e) => ({ effect: e.id, name: PLUGINS.find((p) => p.id === e.plugin.id).name, editorOpen: editors.has(e.id), latency: e.plugin.id === "VST3-Fake Delay-2" ? 480 : 0 })),
    loading: [],
    failed: hosted.filter((e) => !known(e)).map((e) => ({ effect: e.id, error: "This plugin isn't installed on this computer (or hasn't been scanned)." })),
  };
};

/**
 * The export being "rendered": it takes about a second and a half whatever the song (so a test can watch
 * it), saying how far it is, then writes a quiet tone as long as the song for the mix and each stem.
 */
let exporting = null;
/** A 32-bit float stereo WAV of a quiet 440 Hz tone, `frames` long. */
function writeTone(file, frames, rate) {
  const data = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames; i++) {
    const v = 0.1 * Math.sin((2 * Math.PI * 440 * i) / rate);
    data.writeFloatLE(v, i * 8);
    data.writeFloatLE(v, i * 8 + 4);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 8, 28);
  header.writeUInt16LE(8, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}
function startExport(params) {
  const exported = params.song;
  const rate = device.sampleRate;
  const frames = Math.ceil((exported.loopTicks * 60 * rate) / (exported.tempo * exported.ppq));
  const job = { id: params.exportId, frames, done: 0, aborted: false };
  exporting = job;
  playingSince = null;
  const steps = 15;
  let step = 0;
  const timer = setInterval(() => {
    if (job.aborted) {
      clearInterval(timer);
      exporting = null;
      return send({ event: "export", id: job.id, state: "aborted", missing: [] });
    }
    step++;
    job.done = Math.min(frames, Math.round((frames * step) / steps));
    if (step < steps) return send({ event: "export", id: job.id, state: "rendering", done: job.done, frames });
    clearInterval(timer);
    fs.mkdirSync(params.folder, { recursive: true });
    const files = [];
    if (params.mix !== false) files.push({ id: "mix", file: path.join(params.folder, "mix.wav"), peak: 0.1 });
    // A stem for each track a channel plays into, but the master (the last).
    if (params.stems) {
      const used = new Set(exported.channels.map((c) => c.track));
      exported.tracks.forEach((t, i) => i < exported.tracks.length - 1 && used.has(i) && files.push({ id: t.id, file: path.join(params.folder, `${t.id}.wav`), peak: 0.1 }));
    }
    for (const file of files) writeTone(file.file, frames, rate);
    exporting = null;
    send({ event: "export", id: job.id, state: "done", frames, sampleRate: rate, latency: 0, seconds: 1.5, files, missing: [] });
  }, 100);
}

const tick = () => {
  if (playingSince === null || !song) return 0;
  return (((Date.now() - playingSince) / 60000) * song.tempo * song.ppq) % song.loopTicks;
};
const status = () => ({
  device: device.output,
  offline: false,
  cpu: 0.02,
  dropouts: 0,
  sampleRate: device.sampleRate,
  bufferSize: device.bufferSize,
  outputLatencyMs: 12,
  songLatency: 0,
  tone,
  peak: 0,
  transport: { playing: playingSince !== null, tick: tick(), metronome, preview: previewNow() },
  exporting: exporting && { id: exporting.id, done: exporting.done, frames: exporting.frames },
  channels: channels(),
  effects: effects(),
  scanning: null,
  pluginCount: PLUGINS.length,
  ...slots,
});
const devices = () => ({
  outputs: ["Fake Output", "Fake Headphones"],
  output: device.output,
  bufferSizes: [64, 128, 256, 512],
  sampleRates: [44100, 48000],
  status: status(),
});
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
/** The tracks the selection meter adds up (`meterTracks`). */
let metered = [];
// While it plays, the master's meter moves (as if every channel were on it), and the selection's if it has tracks.
const sendTransport = () =>
  send({
    event: "transport",
    playing: playingSince !== null,
    tick: tick(),
    preview: previewNow(),
    peak: playingSince === null ? 0 : 0.3,
    meters: playingSince === null ? {} : { master: [0.3, 0.3], ...(metered.length ? { "@selection": [0.3, 0.3] } : {}) },
    cpu: 0.02,
  });

send({ event: "ready", status: status() });
// While it plays or previews, and once more when a preview ends.
let previewed = false;
setInterval(() => {
  const previewing = previewNow() !== null;
  if (playingSince !== null || previewing || previewed) sendTransport();
  previewed = previewing;
}, 40);

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, cmd, ...params } = JSON.parse(line);
  const fail = (error) => send({ id, ok: false, error });
  if (cmd === "crash") process.exit(3);
  if (exporting && ["play", "preview", "trigger", "previewFile", "render", "setDevice", "tone", "note", "load", "unload", "editor"].includes(cmd)) return fail("The song is being exported: wait for it to finish.");
  if (cmd === "export") {
    if (exporting) return fail("A song is being exported already.");
    startExport(params);
    return send({ id, ok: true, result: status() });
  }
  if (cmd === "abortExport") {
    if (exporting && exporting.id === params.exportId) exporting.aborted = true;
    return send({ id, ok: true, result: status() });
  }
  if (cmd === "plugins") return send({ id, ok: true, result: PLUGINS });
  if (cmd === "song") {
    song = params.song;
    return send({ id, ok: true, result: { unreadable: [], channels: channels(), effects: effects() } });
  }
  if (cmd === "host") host = params;
  if (cmd === "whatHost") return send({ id, ok: true, result: host });
  if (cmd === "devices") return send({ id, ok: true, result: devices() });
  if (cmd === "setDevice") {
    Object.assign(device, params);
    return send({ id, ok: true, result: devices() });
  }
  // Started `from` ticks in: as if it had begun that much earlier.
  if (cmd === "play") playingSince = Date.now() - ((params.from ?? 0) / (song ? song.tempo * song.ppq : 1)) * 60000;
  if (cmd === "stop") {
    playingSince = null;
    sendTransport();
  }
  if (cmd === "metronome") metronome = params.on;
  if (cmd === "previewFile") preview = { id: params.previewId, start: params.start, since: Date.now() };
  if (cmd === "stopPreview") preview = null;
  if (cmd === "meterTracks") metered = params.tracks;
  // A plugin window's key, as if pressed there (tests): the engine sends it on.
  if (cmd === "pressKey") send({ event: "key", key: params.key, code: params.code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...params.modifiers });
  if (cmd === "channelEditor") {
    if (!channels().loaded.some((c) => c.channel === params.channel)) return fail("That channel's plugin isn't loaded.");
    if (params.open) editors.add(params.channel);
    else editors.delete(params.channel);
  }
  if (cmd === "effectEditor") {
    if (!effects().loaded.some((e) => e.effect === params.effect)) return fail("That effect's plugin isn't loaded.");
    if (params.open) editors.add(params.effect);
    else editors.delete(params.effect);
  }
  if ((cmd === "trigger" || cmd === "preview") && !song?.channels.some((c) => c.id === params.channel)) return fail("The song playing has no such channel.");
  if (cmd === "tone") tone = params.on;
  if (cmd === "load") {
    const plugin = PLUGINS.find((p) => p.id === params.pluginId);
    if (!plugin) return fail("That plugin isn't in the list: scan for plugins first.");
    slots[params.slot] = { ...plugin, editorOpen: false, latencySamples: 0 };
  }
  if (cmd === "unload") slots[params.slot] = null;
  if (["editor", "saveState", "restoreState"].includes(cmd)) {
    if (!slots[params.slot]) return fail("No plugin is loaded there.");
    if (cmd === "editor") slots[params.slot].editorOpen = params.open;
  }
  send({ id, ok: true, result: status() });
});
