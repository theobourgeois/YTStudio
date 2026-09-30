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
const sendTransport = () => send({ event: "transport", playing: playingSince !== null, tick: tick(), peak: playingSince === null ? 0 : 0.3, cpu: 0.02 });

send({ event: "ready", status: status() });
setInterval(() => playingSince !== null && sendTransport(), 40);

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, cmd, ...params } = JSON.parse(line);
  const fail = (error) => send({ id, ok: false, error });
  if (cmd === "crash") process.exit(3);
  if (cmd === "plugins") return send({ id, ok: true, result: PLUGINS });
  if (cmd === "song") {
    song = params.song;
    return send({ id, ok: true, result: { unreadable: [] } });
  }
  if (cmd === "devices") return send({ id, ok: true, result: devices() });
  if (cmd === "setDevice") {
    Object.assign(device, params);
    return send({ id, ok: true, result: devices() });
  }
  if (cmd === "play" && playingSince === null) playingSince = Date.now();
  if (cmd === "stop") {
    playingSince = null;
    sendTransport();
  }
  if (cmd === "metronome") metronome = params.on;
  if (cmd === "trigger" && !song?.channels.some((c) => c.id === params.channel)) return fail("The song playing has no such channel.");
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
