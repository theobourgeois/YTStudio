#!/usr/bin/env node
// A stand-in for the audio engine (tests): the same JSON lines, no sound. `crash` exits mid-command.
import readline from "node:readline";

const PLUGINS = [
  { id: "VST3-Fake Synth-1", name: "Fake Synth", format: "VST3", manufacturer: "Fake", category: "Instrument", isInstrument: true },
  { id: "VST3-Fake Delay-2", name: "Fake Delay", format: "VST3", manufacturer: "Fake", category: "Fx", isInstrument: false },
];
const slots = { instrument: null, effect: null };
let tone = false;
const status = () => ({
  device: "Fake Output",
  sampleRate: 48000,
  bufferSize: 512,
  outputLatencyMs: 12,
  tone,
  peak: 0,
  scanning: null,
  pluginCount: PLUGINS.length,
  ...slots,
});
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

send({ event: "ready", status: status() });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, cmd, ...params } = JSON.parse(line);
  const fail = (error) => send({ id, ok: false, error });
  if (cmd === "crash") process.exit(3);
  if (cmd === "plugins") return send({ id, ok: true, result: PLUGINS });
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
