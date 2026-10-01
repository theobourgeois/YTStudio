#!/usr/bin/env node
// A stand-in for the audio engine (tests): the same JSON lines, no sound. It keeps time like the real
// one (a playing song's position moves), and `crash` exits mid-command.
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
    loaded: hosted.filter(known).map((e) => ({ effect: e.id, name: PLUGINS.find((p) => p.id === e.plugin.id).name, editorOpen: editors.has(e.id), latency: 0 })),
    loading: [],
    failed: hosted.filter((e) => !known(e)).map((e) => ({ effect: e.id, error: "This plugin isn't installed on this computer (or hasn't been scanned)." })),
  };
};

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
  tone,
  peak: 0,
  transport: { playing: playingSince !== null, tick: tick(), metronome },
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
// While it plays, the master's meter moves (as if every channel were on it).
const sendTransport = () =>
  send({ event: "transport", playing: playingSince !== null, tick: tick(), peak: playingSince === null ? 0 : 0.3, meters: playingSince === null ? {} : { master: [0.3, 0.3] }, cpu: 0.02 });

send({ event: "ready", status: status() });
setInterval(() => playingSince !== null && sendTransport(), 40);

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, cmd, ...params } = JSON.parse(line);
  const fail = (error) => send({ id, ok: false, error });
  if (cmd === "crash") process.exit(3);
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
