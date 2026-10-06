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
const device = { output: "Fake Output", input: null, bufferSize: 256, sampleRate: 48000 };
/** The input devices and their channels' names (recording). */
const INPUTS = { "Fake Interface": ["In 1", "In 2"], "Fake Microphone": ["Mic"] };
/**
 * A recording: its id, folder, the armed tracks it records ({ id, channels }), whether it loops, and
 * when play (after the count-in) starts. On stop, each armed track gets a take per pass: a tone as
 * long as was "recorded", with 10 ms of latency at the head of the first.
 */
let recording = null;
const LATENCY = 480;
let tone = false;
let metronome = false;
let song = null;
/** When the song started playing (ms), or null. */
let playingSince = null;
/** What the desktop app last said of its window (`host`). */
let host = null;
/**
 * The Browser's preview: what, from where, since when (ms). It plays for 4 s from where it starts (the fake reads
 * no files): long enough that a test pausing it finds it still playing on a busy computer.
 */
let preview = null;
const PREVIEW_SECONDS = 4;
const previewNow = () => {
  if (!preview) return null;
  const seconds = preview.start + (Date.now() - preview.since) / 1000;
  if (Date.now() - preview.since >= PREVIEW_SECONDS * 1000) return (preview = null);
  return { id: preview.id, seconds, duration: PREVIEW_SECONDS };
};
/** Each fake plugin's parameters (`parameters`), by plugin id. */
const PARAMETERS = {
  "VST3-Fake Synth-1": ["Cutoff", "Resonance", "Attack", "Release"],
  "VST3-Fake Delay-2": ["Mix", "Feedback", "Time"],
};
/** The plugin of a song's channel or effect, by its id. */
const pluginOf = (owner, id) =>
  owner === "channel" ? song?.channels.find((c) => c.id === id && c.plugin)?.plugin : (song?.tracks ?? []).flatMap((t) => t.effects ?? []).find((e) => e.id === id)?.plugin;
const parameterList = (plugin) => (PARAMETERS[plugin.id] ?? []).map((name, index) => ({ index, id: name.toLowerCase(), name, value: 0.5, text: "50%" }));

/** Each fake plugin's own programs (the synth has some; the delay, one: none to choose). */
const PROGRAMS = { "VST3-Fake Synth-1": ["Init", "Bass", "Lead", "Pad"] };
/** Each song plugin's program and preset now (by owner id), and the user's presets (by plugin id: the same in every song). */
const chosen = new Map();
const userPresets = new Map();
const presetsOf = (owner, id) => {
  const plugin = pluginOf(owner, id);
  if (!plugin) return null;
  const programs = PROGRAMS[plugin.id] ?? [];
  const now = chosen.get(id) ?? { program: programs.length ? 0 : -1, preset: "" };
  return { programs, program: now.program, presets: [...(userPresets.get(plugin.id) ?? [])].sort(), preset: now.preset };
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
/** Gross Beat is ours, not a plugin: the engine runs it itself. */
const GROSS_BEAT = "vaudio:gross-beat";
/** The Gross Beats whose HOLD is held. */
const holding = new Set();
/** Pro-Q is ours as well. The ones whose windows are open (`eqWatch`), and a band soloed in each. */
const PRO_Q = "vaudio:pro-q";
let eqWatched = [];
const eqSolos = new Map();
/** A watched Pro-Q's spectra while it plays: a falling slope with a bump at 100 Hz, as music has (480 points from 10 Hz). */
const spectrum = (shift) => Array.from({ length: 480 }, (_, i) => Math.round((-20 - i * 0.08 + 12 * Math.exp(-(((i - 160) / 25) ** 2)) + shift) * 10) / 10);
const eqs = () =>
  Object.fromEntries(
    (song?.tracks ?? [])
      .flatMap((t) => t.effects ?? [])
      .filter((e) => e.eq && eqWatched.includes(e.id))
      .map((e) => {
        const sounding = playingSince !== null;
        const bands = Object.fromEntries(e.eq.bands.filter((b) => b.range !== 0).map((b) => [String(b.id), { gain: sounding ? b.range / 2 : 0, level: sounding ? -24 : -120 }]));
        return [e.id, { pre: sounding ? spectrum(0) : null, post: sounding ? spectrum(-2) : null, peak: sounding ? [0.3, 0.3] : [0, 0], bands }];
      }),
  );
/** Each Gross Beat in the song, playing its picked slots in time with the song (as the real engine says). */
const grossBeats = () =>
  Object.fromEntries(
    (song?.tracks ?? [])
      .flatMap((t) => t.effects ?? [])
      .filter((e) => e.grossBeat)
      .map((e) => {
        const at = playingSince !== null ? tick() % e.grossBeat.ticks : 0;
        return [e.id, { time: e.grossBeat.timeSlot, volume: e.grossBeat.volumeSlot, queuedTime: null, queuedVolume: null, timeTick: at, volumeTick: at, holding: holding.has(e.id) }];
      }),
  );

/** Auto-Tune is ours too. */
const AUTO_TUNE = "vaudio:auto-tune";
/** A reading every 5 ms, numbered from when the engine started. */
const AUTO_TUNE_STEP = 0.00533;
const started = Date.now();
/**
 * Each Auto-Tune in the song, as the real engine says what it hears: while playing, a voice wandering
 * around A3 (its target), tuned onto it; stopped, no pitch.
 */
const autoTunes = () =>
  Object.fromEntries(
    (song?.tracks ?? [])
      .flatMap((t) => t.effects ?? [])
      .filter((e) => e.autoTune)
      .map((e) => {
        const now = Math.floor((Date.now() - started) / 1000 / AUTO_TUNE_STEP);
        const points = Array.from({ length: 16 }, (_, i) => {
          const n = now - 15 + i;
          if (playingSince === null) return [n, -1, -1, -1];
          const sung = 57 + 0.3 * Math.sin(n * AUTO_TUNE_STEP * 2 * Math.PI * 5);
          return [n, sung, 57 + e.autoTune.transpose, 57];
        });
        return [e.id, { latency: 2395, step: AUTO_TUNE_STEP, points }];
      }),
  );

/** EchoBoy is ours too. */
const ECHO_BOY = "vaudio:echo-boy";
/** Each EchoBoy in the song: its LEDs' levels (some echo while the song plays). */
const echoBoys = () =>
  Object.fromEntries(
    (song?.tracks ?? [])
      .flatMap((t) => t.effects ?? [])
      .filter((e) => e.echoBoy)
      .map((e) => {
        const level = playingSince === null ? 0 : 0.3;
        return [e.id, { input: [level, level], output: [level * e.echoBoy.output, level * e.echoBoy.output] }];
      }),
  );

/** OTT is ours as well. Each in the song: its bands at a level while the song plays (squashed towards its knees, as the real one). */
const OTT = "vaudio:ott";
const otts = () =>
  Object.fromEntries(
    (song?.tracks ?? [])
      .flatMap((t) => t.effects ?? [])
      .filter((e) => e.ott)
      .map((e) => {
        const sounding = playingSince !== null;
        const bands = e.ott.bands.map((b) => (sounding ? { level: -30, gain: b.makeup - 4 } : { level: -120, gain: 0 }));
        const level = sounding ? 0.3 : 0;
        return [e.id, { bands, input: [level, level], output: [level, level] }];
      }),
  );

/** The Reverb is ours too. The ones whose windows are open (`verbWatch`), and Freeze or Kill held (`verb`). */
const REVERB = "vaudio:reverb";
let verbWatched = [];
const verbHeld = new Map();
/** Each Reverb in the song: its meters while the song plays (a ducked tail), frozen while held, its tail's spectrum while watched. */
const reverbs = () =>
  Object.fromEntries(
    (song?.tracks ?? [])
      .flatMap((t) => t.effects ?? [])
      .filter((e) => e.reverb)
      .map((e) => {
        const sounding = playingSince !== null;
        const held = verbHeld.get(e.id) ?? {};
        const level = sounding && !held.kill ? 0.3 : 0;
        const duck = sounding ? e.reverb.duck.depth * 0.5 : 0;
        return [
          e.id,
          {
            input: [level, level],
            output: [level * e.reverb.mix.wet, level * e.reverb.mix.wet],
            duck,
            key: sounding ? -18 : -120,
            threshold: e.reverb.duck.threshold ?? -30,
            deEss: sounding ? Math.min(3, e.reverb.deEss.amount) : 0,
            decay: sounding ? 1 - 0.5 * e.reverb.duck.autoDecay : 1,
            clip: false,
            frozen: e.reverb.freeze || !!held.freeze || e.reverb.t60[5] >= 999,
            ...(verbWatched.includes(e.id) && { spectrum: sounding ? spectrum(-6) : null }),
          },
        ];
      }),
  );

/** Pro-C is ours too. */
const PRO_C = "vaudio:pro-c";
/** A point of its level display every 5 ms, numbered from when the engine started. */
const PRO_C_STEP = 0.005;
/** Each Pro-C's gain reduction as it moves, the last point it was told, and Match measuring (`compMatch`): since when, for how long, what it heard. */
const compStates = new Map();
const compMatches = new Map();
/** A voice's level (dB) at `t` seconds: phrases and syllables between −34 and −6 dB, gaps between phrases. */
const voiceAt = (t) => {
  const phrase = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.37 * t);
  const syllable = Math.abs(Math.sin(2 * Math.PI * 2.3 * t + 0.6 * Math.sin(2 * Math.PI * 0.9 * t))) ** 0.6;
  const level = -36 + 30 * phrase * syllable + 2 * Math.sin(2 * Math.PI * 11 * t);
  return Math.max(-60, Math.min(-3, level));
};
/** The reduction a level gets from a compiled curve (Giannoulis' soft knee, its range), or a boost for Upward. */
const curveReduction = (curve, level) => {
  const o = level - curve.threshold;
  const w = curve.knee;
  const over = (x) => (w <= 0 ? Math.max(0, x) : x <= -w / 2 ? 0 : x >= w / 2 ? x : (x + w / 2) ** 2 / (2 * w));
  if (curve.kind === "upward") return -Math.min(curve.range, curve.slope * over(-o));
  const slope = curve.kind === "vocal" ? 0.85 : curve.slope;
  return Math.min(curve.range, slope * over(o));
};
/**
 * Each Pro-C in the song, as the real engine says what it does: while playing, a vocal-like input through
 * its curve, the reduction gliding at its attack and release, so its display moves; stopped, nothing new.
 */
const proCs = () =>
  Object.fromEntries(
    (song?.tracks ?? [])
      .flatMap((t) => t.effects ?? [])
      .filter((e) => e.proC)
      .map((e) => {
        const p = e.proC;
        const state = compStates.get(e.id) ?? { n: -1, gr: 0 };
        const now = Math.floor((Date.now() - started) / 1000 / PRO_C_STEP);
        const keyGain = 20 * Math.log10(Math.max(1e-6, p.sidechain.level));
        const points = [];
        let input = -120;
        let key = -120;
        if (playingSince !== null) {
          const from = state.n < 0 || now - state.n > 64 ? now - 8 : state.n + 1;
          for (let n = from; n <= now; n++) {
            input = voiceAt(n * PRO_C_STEP);
            key = input + keyGain;
            const target = curveReduction(p.curve, key);
            const tau = target > state.gr ? Math.max(0.0005, p.ballistics.attack) : Math.max(0.01, p.ballistics.release);
            state.gr += (target - state.gr) * (1 - Math.exp(-PRO_C_STEP / tau));
            points.push([input, input - state.gr + p.makeup, state.gr]);
          }
        }
        state.n = now;
        compStates.set(e.id, state);
        const output = input - state.gr + p.makeup;
        const peak = (db) => (db <= -119 ? 0 : 10 ** ((db + 3) / 20));
        const result = {
          step: PRO_C_STEP,
          points,
          reduction: playingSince === null ? 0 : state.gr,
          key,
          level: key,
          threshold: p.curve.threshold,
          input: [peak(input), peak(input)],
          output: [peak(output), peak(output)],
          latency: Math.round(p.maxLookahead * 48000),
        };
        // Match: what came in and went out, averaged; done after (at most) two seconds here.
        const match = compMatches.get(e.id);
        if (match && points.length) {
          for (const [i, o] of points) (match.input += i), (match.output += o), match.count++;
          const done = Date.now() - match.since >= Math.min(match.seconds, 2) * 1000;
          result.match = { input: match.input / match.count, output: match.output / match.count, done };
          if (done) compMatches.delete(e.id);
        }
        lastProCs.set(e.id, { ...result, points: [] });
        return [e.id, result];
      }),
  );
/** What each said last, without new points (a status mustn't take the next event's). */
const lastProCs = new Map();
const proCsNow = () => Object.fromEntries((song?.tracks ?? []).flatMap((t) => t.effects ?? []).flatMap((e) => (e.proC && lastProCs.has(e.id) ? [[e.id, lastProCs.get(e.id)]] : [])));

/** PanMan is ours too. */
const PANMAN = "vaudio:panman";
/** Each PanMan's divider count (its Manual Trigger counts). */
const panCounts = new Map();
/** Each PanMan where its settings put it (the offset), its levels silent: there's no sound here. */
const panMen = () =>
  Object.fromEntries(
    (song?.tracks ?? [])
      .flatMap((t) => t.effects ?? [])
      .filter((e) => e.panMan)
      .map((e) => [e.id, { position: e.panMan.offset, least: e.panMan.offset, most: e.panMan.offset, input: 0, output: 0, level: -120, count: panCounts.get(e.id) ?? 0 }]),
  );

/** Pitch Wheel is ours too. */
const PITCH_WHEEL = "vaudio:pitch-wheel";
/** What the hand does to each Pitch Wheel (`pitchWheel` commands): where it holds the wheels, the keys it holds. */
const wheelHands = new Map();
const wheelHand = (id) => {
  if (!wheelHands.has(id)) wheelHands.set(id, { pitch: null, timbre: null, at: 0, keys: new Set() });
  return wheelHands.get(id);
};
/**
 * Each Pitch Wheel in the song, as the real engine says it: its wheels where the hand holds them (for a
 * quarter of a second) or where the song has them, the keys held and, in Multi, a voice for each.
 */
const pitchWheels = () =>
  Object.fromEntries(
    (song?.tracks ?? [])
      .flatMap((t) => t.effects ?? [])
      .filter((e) => e.pitchWheel)
      .map((e) => {
        const hand = wheelHand(e.id);
        const held = Date.now() - hand.at < 250;
        const pw = e.pitchWheel;
        const keys = [...hand.keys].sort((a, b) => a - b);
        const pitch = (held && hand.pitch !== null ? hand.pitch : pw.pitch.target) + (!pw.multi && keys.length ? keys.at(-1) - pw.origin : 0);
        return [
          e.id,
          {
            latency: pw.window,
            pitch,
            timbre: held && hand.timbre !== null ? hand.timbre : pw.timbre.target,
            voices: pw.multi ? keys.map((key) => ({ key, pitch: pitch + key - pw.origin })) : [],
            input: playingSince === null ? 0 : 0.3,
            notes: keys,
          },
        ];
      }),
  );

const effects = () => {
  const hosted = (song?.tracks ?? []).flatMap((t) => t.effects ?? []).filter((e) => e.plugin.id !== GROSS_BEAT && e.plugin.id !== AUTO_TUNE && e.plugin.id !== ECHO_BOY && e.plugin.id !== PRO_Q && e.plugin.id !== PANMAN && e.plugin.id !== PITCH_WHEEL && e.plugin.id !== OTT && e.plugin.id !== PRO_C && e.plugin.id !== REVERB);
  const known = (e) => PLUGINS.some((p) => p.id === e.plugin.id);
  return {
    // The fake delay delays its sound by 10 ms, as a look-ahead plugin would.
    loaded: hosted.filter(known).map((e) => ({ effect: e.id, name: PLUGINS.find((p) => p.id === e.plugin.id).name, editorOpen: editors.has(e.id), latency: e.plugin.id === "VST3-Fake Delay-2" ? 480 : 0, sidechain: true })),
    loading: [],
    failed: hosted.filter((e) => !known(e)).map((e) => ({ effect: e.id, error: "This plugin isn't installed on this computer (or hasn't been scanned)." })),
  };
};

/**
 * The export being "rendered": it takes about a second and a half whatever the song (so a test can watch
 * it), saying how far it is, then writes a tone as long as the song for the mix and each stem: half full
 * scale through the master's gain (a stem through its own track's too), so a song turned up goes over full
 * scale as a real one would.
 */
let exporting = null;
/** A 32-bit float WAV (stereo, or `count` channels) of a 440 Hz tone, `frames` long, peaking at `level`. */
function writeTone(file, frames, rate, level, count = 2) {
  const data = Buffer.alloc(frames * 4 * count);
  for (let i = 0; i < frames; i++) {
    const v = level * Math.sin((2 * Math.PI * 440 * i) / rate);
    for (let ch = 0; ch < count; ch++) data.writeFloatLE(v, (i * count + ch) * 4);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(count, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4 * count, 28);
  header.writeUInt16LE(4 * count, 32);
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
    // The master is the last track: its left-to-left gain (fader and main volume).
    const level = 0.5 * (exported.tracks.at(-1)?.gains?.[0] ?? 1);
    if (params.mix !== false) files.push({ id: "mix", file: path.join(params.folder, "mix.wav"), peak: level });
    // A stem for each track a channel plays into, but the master (the last).
    if (params.stems) {
      const used = new Set(exported.channels.map((c) => c.track));
      // Each through the master's gain and its own track's fader (its left-to-left gain), as a stem after its fader is.
      exported.tracks.forEach((t, i) => i < exported.tracks.length - 1 && used.has(i) && files.push({ id: t.id, file: path.join(params.folder, `${t.id}.wav`), peak: level * (t.gains?.[0] ?? 1) }));
    }
    for (const file of files) writeTone(file.file, frames, rate, file.peak);
    exporting = null;
    send({ event: "export", id: job.id, state: "done", frames, sampleRate: rate, latency: 0, seconds: 1.5, files, missing: [] });
  }, 100);
}

/** Ticks played since `playingSince` (0 during a count-in). */
const elapsed = () => (playingSince === null || !song ? 0 : Math.max(0, ((Date.now() - playingSince) / 60000) * song.tempo * song.ppq));
const tick = () => {
  if (playingSince === null || !song) return 0;
  // Held where it starts while a recording counts in.
  if (recording && countInLeft() > 0) return recording.from;
  // Recording without Loop record goes on past the loop's end.
  return recording && !recording.loop ? elapsed() : elapsed() % song.loopTicks;
};

/** Play stopped: each armed track's takes, as files, told as the real engine tells them. */
function finishRecording() {
  const done = recording;
  recording = null;
  if (!done || !song) return;
  const rate = device.sampleRate;
  const ticks = elapsed();
  if (ticks <= 0) return;
  const samplesPerTick = (60 * rate) / (song.tempo * song.ppq);
  // Each pass round the loop (from where play started), or all of it as one.
  const passes = [];
  if (done.loop) {
    let at = done.from;
    let left = ticks;
    while (left > 0) {
      const length = Math.min(left, song.loopTicks - (at % song.loopTicks));
      passes.push({ start: passes.length ? 0 : at, length });
      left -= length;
      at += length;
    }
  } else passes.push({ start: done.from, length: ticks });
  fs.mkdirSync(done.folder, { recursive: true });
  passes.forEach((pass, i) => {
    for (const track of done.tracks) {
      const skip = i === 0 ? LATENCY : 0;
      const frames = Math.max(1, Math.round(pass.length * samplesPerTick)) + skip;
      const file = path.join(done.folder, `${done.id}-${track.id}-${i + 1}.wav`);
      writeTone(file, frames, rate, 0.25, track.channels.length);
      send({ event: "take", recordingId: done.id, track: track.id, file, startTick: pass.start, skip, frames, sampleRate: rate, pass: i, final: i === passes.length - 1, dropped: false });
    }
  });
}
const status = () => ({
  device: device.output,
  offline: false,
  cpu: 0.02,
  dropouts: 0,
  sampleRate: device.sampleRate,
  bufferSize: device.bufferSize,
  outputLatencyMs: 12,
  input: device.input,
  inputChannels: device.input ? INPUTS[device.input].length : 0,
  inputLatencyMs: device.input ? 5 : 0,
  recording: recording && { id: recording.id },
  songLatency: 0,
  tone,
  peak: 0,
  transport: { playing: playingSince !== null, tick: tick(), countIn: countInLeft(), metronome, preview: previewNow(), grossBeats: grossBeats(), autoTunes: autoTunes(), pitchWheels: pitchWheels(), echoBoys: echoBoys(), panMen: panMen(), otts: otts(), proCs: proCsNow(), reverbs: reverbs() },
  exporting: exporting && { id: exporting.id, done: exporting.done, frames: exporting.frames },
  channels: channels(),
  effects: effects(),
  scanning: null,
  pluginCount: PLUGINS.length,
  ...slots,
});
const devices = () => ({
  types: ["Fake Audio", "Fake ASIO"],
  type: device.type ?? "Fake Audio",
  separateInputs: (device.type ?? "Fake Audio") !== "Fake ASIO",
  controlPanel: device.type === "Fake ASIO",
  recordOffsetMs: device.recordOffsetMs ?? 0,
  outputs: ["Fake Output", "Fake Headphones"],
  output: device.output,
  inputs: Object.keys(INPUTS),
  input: device.input,
  inputChannels: device.input ? INPUTS[device.input] : [],
  bufferSizes: [64, 128, 256, 512],
  sampleRates: [44100, 48000],
  midiInputs: MIDI_INPUTS.map((name) => ({ id: name, name, enabled: !midiOff.has(name), open: !midiOff.has(name) })),
  status: status(),
});
/** MIDI keyboards: one, as if plugged in. Turned off by name (`setDevice { midiInput }`). */
const MIDI_INPUTS = ["Fake Keys"];
const midiOff = new Set();
/** The channel MIDI plays (`midiTarget`). */
let midiTarget = null;
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
/** The tracks the selection meter adds up (`meterTracks`). */
let metered = [];
// While it plays, the master's meter moves (as if every channel were on it), and the selection's if it has tracks.
/** Seconds of a recording's count-in left: play begins when `playingSince` (moved back by `from`) comes. */
const countInLeft = () => (recording && song ? Math.max(0, (playingSince + (recording.from * 60000) / (song.tempo * song.ppq) - Date.now()) / 1000) : 0);
/** Each recording track's input since the last event, a peak every 5 ms: a voice coming and going. */
const levels = () =>
  recording && !countInLeft()
    ? Object.fromEntries(recording.tracks.map((t, i) => [t.id, Array.from({ length: 8 }, (_, k) => Math.abs(0.3 * Math.sin((Date.now() + k * 5) / 90 + i) + 0.15 * Math.sin((Date.now() + k * 5) / 13)))]))
    : {};
const sendTransport = () =>
  send({
    event: "transport",
    playing: playingSince !== null,
    tick: tick(),
    countIn: countInLeft(),
    recording: recording && { id: recording.id, levels: levels() },
    preview: previewNow(),
    grossBeats: grossBeats(),
    autoTunes: autoTunes(),
    pitchWheels: pitchWheels(),
    echoBoys: echoBoys(),
    otts: otts(),
    proCs: proCs(),
    reverbs: reverbs(),
    eq: eqs(),
    panMen: panMen(),
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
  if (exporting && ["play", "preview", "midiIn", "trigger", "previewFile", "render", "setDevice", "tone", "note", "load", "unload", "editor"].includes(cmd)) return fail("The song is being exported: wait for it to finish.");
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
  // The song as it was last given (tests: its automation lanes).
  if (cmd === "whatSong") return send({ id, ok: true, result: song });
  if (cmd === "parameters") {
    const plugin = pluginOf(params.owner, params.ownerId);
    if (!plugin || !PARAMETERS[plugin.id]) return fail("That plugin isn't loaded (yet): its parameters can't be listed.");
    return send({ id, ok: true, result: { parameters: parameterList(plugin) } });
  }
  // A parameter touched in a plugin's window, or its Automate button pressed, as if by hand (tests).
  if (cmd === "touchParameter" || cmd === "pressAutomate") {
    const plugin = pluginOf(params.owner, params.ownerId);
    const parameter = plugin && parameterList(plugin)[params.index];
    if (!parameter) return fail("No such parameter.");
    send({ event: cmd === "touchParameter" ? "touch" : "automate", owner: params.owner, id: params.ownerId, index: parameter.index, param: parameter.id, name: parameter.name, value: params.value ?? 0.5, text: "" });
  }
  if (["presets", "setProgram", "savePreset", "loadPreset", "deletePreset"].includes(cmd)) {
    const now = presetsOf(params.owner, params.ownerId);
    if (!now) return fail("That plugin isn't loaded (yet): its presets can't be listed.");
    const plugin = pluginOf(params.owner, params.ownerId);
    const saved = userPresets.get(plugin.id) ?? new Set();
    if (cmd === "setProgram") {
      if (params.index >= now.programs.length) return fail(`It has no program ${params.index}: it has ${now.programs.length}.`);
      chosen.set(params.ownerId, { program: params.index, preset: "" });
    }
    if (cmd === "savePreset") {
      userPresets.set(plugin.id, saved.add(params.name));
      chosen.set(params.ownerId, { program: now.program, preset: params.name });
    }
    if (cmd === "loadPreset" || cmd === "deletePreset") {
      if (!saved.has(params.name)) return fail(`There's no preset "${params.name}" for ${plugin.name}.`);
      if (cmd === "loadPreset") chosen.set(params.ownerId, { program: now.program, preset: params.name });
      else {
        saved.delete(params.name);
        if (now.preset === params.name) chosen.set(params.ownerId, { program: now.program, preset: "" });
      }
    }
    if (cmd !== "presets") send({ event: "preset", owner: params.owner, id: params.ownerId });
    return send({ id, ok: true, result: presetsOf(params.owner, params.ownerId) });
  }
  // A plugin window's wrapper button, as if pressed (tests).
  if (cmd === "pressWrapper") send({ event: "wrapper", owner: params.owner, id: params.ownerId });
  if (cmd === "devices") return send({ id, ok: true, result: devices() });
  if (cmd === "deviceControlPanel") return device.type === "Fake ASIO" ? send({ id, ok: true, result: status() }) : fail("This audio device has no settings panel of its own.");
  if (cmd === "setDevice") {
    if (params.midiInput) {
      if (params.midiInput.enabled) midiOff.delete(params.midiInput.name);
      else midiOff.add(params.midiInput.name);
      delete params.midiInput;
    }
    if (typeof params.input === "string") params.input = INPUTS[params.input] ? params.input : null;
    Object.assign(device, params);
    return send({ id, ok: true, result: devices() });
  }
  if (cmd === "record") {
    if (recording) return fail("It's recording already: stop it first.");
    const tracks = (song?.tracks ?? []).filter((t) => t.input?.armed).map((t) => ({ id: t.id, channels: t.input.channels }));
    if (!tracks.length && !params.notes) return fail("No mixer track is armed with an input: choose a track's input in the Mixer, which arms it.");
    const continues = params.continuePlayback === true && playingSince !== null;
    const from = continues ? tick() : params.from ?? 0;
    recording = { id: params.recordingId, folder: params.folder, from, loop: params.loop === true, tracks };
    // After the count-in, as if it had begun `from` ticks earlier.
    const msPerTick = song ? 60000 / (song.tempo * song.ppq) : 0;
    if (!continues) playingSince = Date.now() + (params.countIn ?? 0) * msPerTick - from * msPerTick;
    return send({ id, ok: true, result: status() });
  }
  // Started `from` ticks in: as if it had begun that much earlier. A recording ends there.
  if (cmd === "play") {
    finishRecording();
    playingSince = Date.now() - ((params.from ?? 0) / (song ? song.tempo * song.ppq : 1)) * 60000;
  }
  if (cmd === "stop") {
    finishRecording();
    playingSince = null;
    sendTransport();
  }
  if (cmd === "metronome") metronome = params.on;
  if (cmd === "midiTarget") midiTarget = params.channel;
  // Notes as a keyboard sends them: told back as the real engine tells them, on the target channel.
  if (cmd === "midiIn") {
    const channel = song?.channels.some((c) => c.id === midiTarget) ? midiTarget : null;
    const playing = playingSince !== null;
    const notes = params.messages
      .filter((m) => (m[0] & 0xe0) === 0x80 && channel)
      .map((m) => {
        const on = (m[0] & 0xf0) === 0x90 && (m[2] ?? 0) > 0;
        return { channel, key: m[1], velocity: on ? m[2] / 127 : 0, on, tick: playing ? tick() : null, counting: playing && countInLeft() > 0, pass: playing && song ? Math.floor(Math.max(0, elapsed()) / song.loopTicks) : 0 };
      });
    if (notes.length) send({ event: "midi", notes });
  }
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
  if (cmd === "raiseEditor" && !editors.has(params.target)) return fail("That plugin has no window open.");
  if (cmd === "effectEditor") {
    if (!effects().loaded.some((e) => e.effect === params.effect)) return fail("That effect's plugin isn't loaded.");
    if (params.open) editors.add(params.effect);
    else editors.delete(params.effect);
  }
  if (cmd === "eqWatch") eqWatched = (params.effects ?? []).map((e) => e.effect);
  if (cmd === "eqSolo") {
    if (!(song?.tracks ?? []).some((t) => (t.effects ?? []).some((e) => e.id === params.effect && e.eq))) return fail("The song playing has no such Pro-Q.");
    if (params.band) eqSolos.set(params.effect, params.band);
    else eqSolos.delete(params.effect);
  }
  if (cmd === "compAudition" || cmd === "compMatch") {
    if (!(song?.tracks ?? []).some((t) => (t.effects ?? []).some((e) => e.id === params.effect && e.proC))) return fail("The song playing has no such Pro-C.");
    if (cmd === "compMatch") compMatches.set(params.effect, { since: Date.now(), seconds: params.seconds, input: 0, output: 0, count: 0 });
  }
  if (cmd === "verbWatch") verbWatched = (params.effects ?? []).map((e) => e.effect);
  if (cmd === "verb") {
    if (!(song?.tracks ?? []).some((t) => (t.effects ?? []).some((e) => e.id === params.effect && e.reverb))) return fail("The song playing has no such Reverb.");
    const held = verbHeld.get(params.effect) ?? {};
    if (typeof params.freeze === "boolean") held.freeze = params.freeze;
    if (typeof params.kill === "boolean") held.kill = params.kill;
    verbHeld.set(params.effect, held);
  }
  if (cmd === "grossBeat") {
    if (!(song?.tracks ?? []).some((t) => (t.effects ?? []).some((e) => e.id === params.effect && e.grossBeat))) return fail("The song playing has no such Gross Beat.");
    if (params.hold === true) holding.add(params.effect);
    if (params.hold === false) holding.delete(params.effect);
  }
  if (cmd === "panMan") {
    const effect = (song?.tracks ?? []).flatMap((t) => t.effects ?? []).find((e) => e.id === params.effect && e.panMan);
    if (!effect) return fail("The song playing has no such PanMan.");
    if (params.trigger) panCounts.set(effect.id, ((panCounts.get(effect.id) ?? 0) + 1) % effect.panMan.divider);
  }
  if (cmd === "pitchWheel") {
    if (!(song?.tracks ?? []).some((t) => (t.effects ?? []).some((e) => e.id === params.effect && e.pitchWheel))) return fail("The song playing has no such Pitch Wheel.");
    const hand = wheelHand(params.effect);
    if (typeof params.pitch === "number") (hand.pitch = params.pitch), (hand.at = Date.now());
    if (typeof params.timbre === "number") (hand.timbre = params.timbre), (hand.at = Date.now());
    if (typeof params.key === "number") params.on ? hand.keys.add(params.key) : hand.keys.delete(params.key);
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
