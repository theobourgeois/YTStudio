import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addChannels, addPluginChannel, setSteps } from "../../shared/music/edits.ts";
import { setEffect, updateMixerTrack } from "../../shared/music/mixer.ts";
import type { EngineEvent } from "../../shared/music/engine.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import { createAutomation, editPoints, updateAutomation } from "../../shared/music/automation.ts";
import { addClips, editClips } from "../../shared/music/playlist.ts";
import type { MediaAsset } from "../../shared/types.ts";
import { DataPaths } from "../storage.ts";
import { readWav, writeWav } from "./wav.ts";
import { AudioEngine, engineOutdated } from "./engine.ts";

const PROJECT = "proj_0123456789ab";
const FAKE = [process.execPath, path.join(import.meta.dirname, "fake-engine.mjs")];

describe("AudioEngine", () => {
  let dir: string;
  let engine: AudioEngine;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-test-"));
    engine = new AudioEngine(new DataPaths(dir), { command: FAKE, pluginPaths: [] });
  });
  afterEach(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("exports through the engine: a song played once, its progress heard, the files it wrote; and rejects when the engine dies mid-way", async () => {
    const song = setSteps(addChannels(createMusicProject("Export", 120), [{ id: "chan_kick", name: "Kick", sampleId: null }]), FIRST_PATTERN_ID, "chan_kick", [0], true);
    const request = { id: "exp_1", projectId: "proj_0123456789ab", song, patternId: FIRST_PATTERN_ID, mode: "pattern" as const, loop: null, resampling: "sinc" as const, folder: path.join(dir, "out"), mix: true, stems: false, tail: "cut" as const };
    const progress: number[] = [];
    const result = await engine.renderExport(request, (done) => progress.push(done));
    // A bar at 120 BPM: two seconds.
    expect(result).toMatchObject({ state: "done", frames: 96_000, files: [{ id: "mix" }] });
    expect(progress.length).toBeGreaterThan(5);
    expect((await fs.stat(path.join(dir, "out", "mix.wav"))).size).toBe(44 + 96_000 * 8);

    // Meanwhile nothing plays.
    const second = engine.renderExport({ ...request, id: "exp_2" });
    await expect(engine.command("play", {})).rejects.toThrow(/exported/);
    await engine.abortExport("exp_2");
    expect(await second).toMatchObject({ state: "aborted" });

    // A plugin taking the engine down mid-export: it says so, rather than waiting for ever.
    const third = engine.renderExport({ ...request, id: "exp_3" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const raw = (engine as unknown as { request(cmd: string, params: object): Promise<unknown> }).request.bind(engine);
    await raw("crash", {}).catch(() => {});
    await expect(third).rejects.toMatchObject({ status: 503 });
  });

  it("serializes exports and cancels a queued render without starting it", async () => {
    const request = { id: "exp_serial1", projectId: PROJECT, song: createMusicProject(), patternId: null, mode: "song" as const, loop: { start: 0, end: 192 }, resampling: "sinc" as const, folder: path.join(dir, "first"), mix: true, stems: false, tail: "cut" as const };
    const first = engine.renderExport(request);
    const queued = engine.renderExport({ ...request, id: "exp_serial2", folder: path.join(dir, "second") });
    await engine.abortExport("exp_serial2");
    expect((await first).state).toBe("done");
    expect((await queued).state).toBe("aborted");
    await expect(fs.stat(path.join(dir, "second", "mix.wav"))).rejects.toThrow();
    const next = await engine.renderExport({ ...request, id: "exp_serial3" });
    expect(next.state).toBe("done");
  });

  it("releases an in-flight render on intentional engine shutdown", async () => {
    const request = { id: "exp_shutdown", projectId: PROJECT, song: createMusicProject(), patternId: null, mode: "song" as const, loop: { start: 0, end: 192 }, resampling: "sinc" as const, folder: path.join(dir, "shutdown"), mix: true, stems: false, tail: "cut" as const };
    let started!: () => void;
    const progress = new Promise<void>(resolve => { started = resolve; });
    const render = engine.renderExport(request, () => started());
    const failed = expect(render).rejects.toMatchObject({ status: 503 });
    await progress;
    engine.shutdown();
    await failed;
  });

  it("starts the engine on the first command and answers with its status", async () => {
    const status = await engine.command("tone", { on: true });
    expect(status).toMatchObject({ device: "Fake Output", tone: true, instrument: null });
    expect(await engine.plugins()).toHaveLength(3);
  });

  it("reads preset metadata for the loaded project and rejects other tabs or a mid-read switch", async () => {
    const song = createMusicProject("Preset metadata");
    const metadata = { programs: [], program: -1, presets: [], preset: "", currentName: "BA - Growler", category: "Bass" };
    const presets = vi.spyOn(engine, "presets").mockResolvedValue(metadata);
    await engine.setSong({ projectId: PROJECT, song, patternId: null });
    expect(await engine.presetsForProject(PROJECT, "chan_serum")).toEqual(metadata);
    await expect(engine.presetsForProject("proj_abcdef012345", "chan_serum")).rejects.toThrow(/not loaded/);
    expect(presets).toHaveBeenCalledTimes(1);
    presets.mockImplementationOnce(async () => {
      await engine.setSong({ projectId: "proj_abcdef012345", song, patternId: null });
      return metadata;
    });
    await expect(engine.presetsForProject(PROJECT, "chan_serum")).rejects.toThrow(/changed songs/);
  });

  it("loads a plugin and remembers which plugin a saved state is for", async () => {
    const [synth] = await engine.plugins();
    let status = await engine.command("load", { slot: "instrument", pluginId: synth.id });
    expect(status.instrument).toMatchObject({ name: "Fake Synth", hasSavedState: false });
    await expect(engine.command("restoreState", { slot: "instrument" })).rejects.toMatchObject({ status: 409 });
    status = await engine.command("saveState", { slot: "instrument" });
    expect(status.instrument?.hasSavedState).toBe(true);
    await engine.command("restoreState", { slot: "instrument" });
  });

  it("refuses commands that are malformed, and passes on the engine's own errors", async () => {
    await expect(engine.command("load", { slot: "master", pluginId: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(engine.command("note", { pitch: "C" })).rejects.toMatchObject({ status: 400 });
    await expect(engine.command("reboot", {})).rejects.toMatchObject({ status: 404 });
    await expect(engine.command("editor", { slot: "effect", open: true })).rejects.toMatchObject({
      status: 409,
      message: "No plugin is loaded there.",
    });
  });

  it("plays a song, compiled from its document, and says where it is", async () => {
    const song = setSteps(addChannels(createMusicProject("Beat"), [{ id: "chan_kick", name: "Kick", sampleId: "media_000000000001" }]), FIRST_PATTERN_ID, "chan_kick", [0], true);
    const events: EngineEvent[] = [];
    const stop = engine.onEvent((event) => events.push(event));
    expect(await engine.setSong({ projectId: "proj_0123456789ab", song, patternId: null })).toMatchObject({ unreadable: [] });
    expect((await engine.command("play", {})).transport.playing).toBe(true);
    await engine.command("trigger", { channel: "chan_kick" });
    await expect(engine.command("trigger", { channel: "chan_none" })).rejects.toMatchObject({ status: 409 });
    await expect.poll(() => events.filter((e) => e.event === "transport").length).toBeGreaterThan(1);
    expect((await engine.command("stop", {})).transport).toMatchObject({ playing: false, tick: 0 });
    stop();
    await expect(engine.setSong({ song })).rejects.toMatchObject({ status: 400 });
  });

  it("plays plugin channels: their plugins are loaded, their windows opened, their states kept in the project", async () => {
    const [synth] = await engine.plugins();
    let song = addPluginChannel(createMusicProject("Synth"), synth, "chan_synth");
    song = addPluginChannel(song, { id: "VST3-Not installed-9", name: "Missing", format: "VST3" }, "chan_missing");
    const answer = await engine.setSong({ projectId: "proj_0123456789ab", song, patternId: null });
    expect(answer.channels.loaded).toEqual([{ channel: "chan_synth", name: "Fake Synth", editorOpen: false, latency: 0 }]);
    expect(answer.channels.failed).toMatchObject([{ channel: "chan_missing" }]);
    expect((await engine.command("channelEditor", { channel: "chan_synth", open: true })).channels.loaded[0].editorOpen).toBe(true);
    await expect(engine.command("channelEditor", { channel: "chan_missing", open: true })).rejects.toMatchObject({ status: 409 });
    await expect(engine.command("channelEditor", { open: true })).rejects.toMatchObject({ status: 400 });
    await engine.saveStates();
  });

  it("copies plugins' settings files beside a project, for a track's effects pasted onto another", async () => {
    const states = path.join(dir, "projects", "proj_0123456789ab", "plugins");
    await fs.mkdir(states, { recursive: true });
    await fs.writeFile(path.join(states, "fx_eq.bin"), "settings");
    const answer = await engine.copyStates({ projectId: "proj_0123456789ab", copies: [{ from: "fx_eq", to: "fx_eq_2" }, { from: "fx_never_saved", to: "fx_new" }] });
    expect(answer).toEqual({ copied: 1 });
    expect(await fs.readFile(path.join(states, "fx_eq_2.bin"), "utf8")).toBe("settings");
    await expect(engine.copyStates({ projectId: "proj_0123456789ab", copies: [{ from: "../x", to: "y" }] })).rejects.toMatchObject({ status: 400 });
    await expect(engine.copyStates({ copies: [] })).rejects.toMatchObject({ status: 400 });
  });

  it("runs the mixer's effects: loaded by their ids, their windows opened", async () => {
    const delay = (await engine.plugins()).find((p) => !p.isInstrument)!;
    const song = setEffect(createMusicProject("Effects"), "insert_1", 0, delay, "fx_delay");
    const answer = await engine.setSong({ projectId: "proj_0123456789ab", song, patternId: null });
    expect(answer.effects.loaded).toEqual([{ effect: "fx_delay", name: "Fake Delay", editorOpen: false, latency: 480, sidechain: true }]);
    expect((await engine.command("effectEditor", { effect: "fx_delay", open: true })).effects.loaded[0].editorOpen).toBe(true);
    await expect(engine.command("effectEditor", { effect: "fx_none", open: true })).rejects.toMatchObject({ status: 409 });
    await expect(engine.command("effectEditor", { open: true })).rejects.toMatchObject({ status: 400 });
  });

  it("closes every plugin window that's open, instrument and effect, and doesn't start the engine to do it", async () => {
    await engine.closeEditors();
    expect((engine as unknown as { child: unknown }).child).toBeNull();
    const [synth, delay] = [(await engine.plugins())[0], (await engine.plugins()).find((p) => !p.isInstrument)!];
    let song = addPluginChannel(createMusicProject("Windows"), synth, "chan_synth");
    song = setEffect(song, "insert_1", 0, delay, "fx_delay");
    await engine.setSong({ projectId: "proj_0123456789ab", song, patternId: null });
    await engine.command("channelEditor", { channel: "chan_synth", open: true });
    await engine.command("effectEditor", { effect: "fx_delay", open: true });
    await engine.closeEditors();
    const status = await engine.command("status", {});
    expect(status.channels.loaded[0].editorOpen).toBe(false);
    expect(status.effects.loaded[0].editorOpen).toBe(false);
  });

  it("passes on the keys pressed in plugin windows, and tells the engine (a restarted one too) where the app's window is", async () => {
    const request = (engine as unknown as { request(cmd: string, params: object): Promise<unknown> }).request.bind(engine);
    const host = { floating: true, visible: true, bounds: { x: 10, y: 20, width: 1400, height: 900 } };
    // Not a reason to start the engine; it's told once it's started.
    engine.setHost(host);
    const events: EngineEvent[] = [];
    engine.onEvent((event) => events.push(event));
    expect(await request("whatHost", {})).toEqual(host);

    await request("pressKey", { key: " ", code: "Space" });
    await expect.poll(() => events.find((e) => e.event === "key")).toEqual({ event: "key", key: " ", code: "Space", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });

    await expect(request("crash", {})).rejects.toMatchObject({ status: 503 });
    await engine.command("status", {});
    await expect.poll(() => request("whatHost", {})).toEqual(host);
    await expect(engine.command("host", host)).rejects.toMatchObject({ status: 404 });
  });

  it("raises a plugin's window on request, which only one that's open can be", async () => {
    const song = addPluginChannel(createMusicProject("Raised"), { id: "VST3-Fake Synth-1", name: "Fake Synth", format: "VST3" }, "chan_synth");
    await engine.setSong({ projectId: "proj_0123456789ab", song, patternId: null });
    await expect(engine.command("raiseEditor", { owner: "channel", target: "chan_synth" })).rejects.toMatchObject({ status: 409 });
    await engine.command("channelEditor", { channel: "chan_synth", open: true });
    await expect(engine.command("raiseEditor", { owner: "channel", target: "chan_synth" })).resolves.toBeDefined();
    await expect(engine.command("raiseEditor", { owner: "bench", target: "chan_synth" })).rejects.toMatchObject({ status: 400 });
    await expect(engine.command("raiseEditor", { owner: "channel" })).rejects.toMatchObject({ status: 400 });
  });

  it("lists a plugin's parameters, passes on those touched in its window, and leaves out automation the hand holds", async () => {
    let song = addPluginChannel(createMusicProject("Automated"), { id: "VST3-Fake Synth-1", name: "Fake Synth", format: "VST3" }, "chan_synth");
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: FIRST_PATTERN_ID, track: 0, start: 0, length: 384 }]).clips);
    song = createAutomation(song, { kind: "channel", channel: "chan_synth", control: "volume" }, { start: 0, length: 384 }).song;
    await engine.setSong({ projectId: "proj_0123456789ab", song, patternId: null, mode: "song" });
    expect((await engine.parameters("channel", "chan_synth")).map((p) => p.name)).toEqual(["Cutoff", "Resonance", "Attack", "Release"]);
    await expect(engine.parameters("channel", "chan_none")).rejects.toMatchObject({ status: 409 });
    await expect(engine.parameters("bench", "chan_synth")).rejects.toMatchObject({ status: 400 });

    const request = (engine as unknown as { request(cmd: string, params: object): Promise<unknown> }).request.bind(engine);
    const events: EngineEvent[] = [];
    engine.onEvent((event) => events.push(event));
    await request("touchParameter", { owner: "channel", ownerId: "chan_synth", index: 0, value: 0.25 });
    await request("pressAutomate", { owner: "channel", ownerId: "chan_synth", index: 1 });
    await expect.poll(() => events.filter((e) => e.event === "touch" || e.event === "automate")).toEqual([
      { event: "touch", owner: "channel", id: "chan_synth", index: 0, param: "cutoff", name: "Cutoff", value: 0.25, text: "" },
      { event: "automate", owner: "channel", id: "chan_synth", index: 1, param: "resonance", name: "Resonance", value: 0.5, text: "" },
    ]);

    // The song as the engine has it: a lane for the channel, unless the hand holds its volume.
    expect(((await request("whatSong", {})) as { lanes: unknown[] }).lanes).toHaveLength(1);
    await engine.setSong({ projectId: "proj_0123456789ab", song, patternId: null, mode: "song", held: ["channel:chan_synth:volume"] });
    expect(((await request("whatSong", {})) as { lanes: unknown[] }).lanes).toEqual([]);
  });

  it("chooses a plugin's programs and keeps the user's presets for it, says when they change, and passes on its wrapper button", async () => {
    const song = addPluginChannel(createMusicProject("Presets"), { id: "VST3-Fake Synth-1", name: "Fake Synth", format: "VST3" }, "chan_synth");
    await engine.setSong({ projectId: "proj_0123456789ab", song, patternId: null });
    const events: EngineEvent[] = [];
    engine.onEvent((event) => events.push(event));
    expect(await engine.presets("channel", "chan_synth")).toEqual({ programs: ["Init", "Bass", "Lead", "Pad"], program: 0, presets: [], preset: "" });
    expect(await engine.preset({ owner: "channel", id: "chan_synth", action: "setProgram", index: 2 })).toMatchObject({ program: 2 });
    expect(await engine.preset({ owner: "channel", id: "chan_synth", action: "savePreset", name: "  Wide lead " })).toMatchObject({ presets: ["Wide lead"], preset: "Wide lead" });
    await expect.poll(() => events.filter((e) => e.event === "preset")).toHaveLength(2);
    await expect(engine.preset({ owner: "channel", id: "chan_synth", action: "setProgram", index: -1 })).rejects.toMatchObject({ status: 400 });
    await expect(engine.preset({ owner: "channel", id: "chan_synth", action: "savePreset", name: " " })).rejects.toMatchObject({ status: 400 });
    await expect(engine.preset({ owner: "channel", id: "chan_synth", action: "rename", name: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(engine.presets("mixer", "chan_synth")).rejects.toMatchObject({ status: 400 });

    const request = (engine as unknown as { request(cmd: string, params: object): Promise<unknown> }).request.bind(engine);
    await request("pressWrapper", { owner: "channel", ownerId: "chan_synth" });
    await expect.poll(() => events.find((e) => e.event === "wrapper")).toEqual({ event: "wrapper", owner: "channel", id: "chan_synth" });
  });

  it("lists the audio devices and changes them", async () => {
    expect(await engine.devices()).toMatchObject({ output: "Fake Output", bufferSizes: [64, 128, 256, 512] });
    expect((await engine.setDevice({ bufferSize: 128, output: "Fake Headphones" })).status).toMatchObject({ bufferSize: 128, device: "Fake Headphones" });
    await expect(engine.setDevice({ bufferSize: "small" })).rejects.toMatchObject({ status: 400 });
  });

  it("speaks the song's ticks to the tab when tempo clips warp the engine's: the loop, where play starts, where it is", async () => {
    const BAR = 384;
    let song = setSteps(addChannels(createMusicProject("Tempo", 120), [{ id: "chan_kick", name: "Kick", sampleId: null }]), FIRST_PATTERN_ID, "chan_kick", [0], true);
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: FIRST_PATTERN_ID, track: 0, start: 0, length: BAR * 4 }]).clips);
    // Twice as fast from bar 2: the engine's four bars are two and a half of its own.
    const made = createAutomation(song, { kind: "tempo" }, { start: BAR, length: BAR * 3 });
    // Its range the whole of the tempo's (20 to 999), so 240 is in it.
    song = updateAutomation(made.song, made.automationId, { min: 0, max: 1 });
    song = editPoints(song, made.automationId, () => [{ tick: 0, value: (240 - 20) / (999 - 20), tension: 0, curve: "single" }]);
    const answer = await engine.setSong({ projectId: PROJECT, song, patternId: null, mode: "song" });
    expect(answer.loop).toEqual({ start: 0, ticks: BAR * 4 });
    const status = await engine.command("play", { from: BAR * 3 });
    // Where it is, back in the song's ticks: bar 4 (not the engine's bar 2.25), a moment on.
    expect(status.transport.tick).toBeGreaterThanOrEqual(BAR * 3 - 1);
    expect(status.transport.tick).toBeLessThan(BAR * 3 + 48);
    // And it moves at 240 BPM there: 0.384 of the song's ticks a millisecond (the engine's go half as fast).
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const later = await engine.command("status", {});
    const rate = (later.transport.tick - status.transport.tick) / (Date.now() - started);
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.45);
    await engine.command("stop", {});
  });

  it("gives a restarted engine its song back", async () => {
    const song = addChannels(createMusicProject("Beat"), [{ id: "chan_kick", name: "Kick", sampleId: null }]);
    await engine.setSong({ projectId: "proj_0123456789ab", song, patternId: null });
    const request = (engine as unknown as { request(cmd: string, params: object): Promise<unknown> }).request.bind(engine);
    await expect(request("crash", {})).rejects.toMatchObject({ status: 503 });
    // The fake only knows the channel if it was given the song again.
    await engine.command("trigger", { channel: "chan_kick" });
  });

  it("starts again after the engine dies", async () => {
    await engine.command("status", {});
    // Reach past the validation to take the engine down mid-command, as a crashing plugin would.
    const request = (engine as unknown as { request(cmd: string, params: object): Promise<unknown> }).request.bind(engine);
    await expect(request("crash", {})).rejects.toMatchObject({ status: 503 });
    expect(await engine.command("status", {})).toMatchObject({ device: "Fake Output" });
  });

  it("saves what a recording had written when the engine dies mid-way: each take's file mended and handed in", async () => {
    const takes: EngineEvent[] = [];
    const recorder = new AudioEngine(new DataPaths(dir), {
      command: FAKE,
      pluginPaths: [],
      adoptTake: async (_project, file, name, origin) => ({ id: origin, name, src: file }) as MediaAsset,
    });
    recorder.onEvent((event) => event.event === "take" && takes.push(event));
    try {
      const song = updateMixerTrack(createMusicProject("Vox"), "insert_1", { input: { channel: 0, stereo: false } });
      await recorder.setSong({ projectId: PROJECT, song, patternId: null, armed: ["insert_1"] });
      const { recordingId } = await recorder.record({ projectId: PROJECT, from: 192, names: { insert_1: "Vox" } });
      // What the engine had written of two passes, their headers still saying nothing was.
      const folder = path.join(new DataPaths(dir).projectDir(PROJECT), "recordings");
      for (const [pass, frames] of [[1, 4800], [2, 2400]]) {
        await writeWav(path.join(folder, `${recordingId}-insert_1-${pass}.wav`), new Float32Array(frames).fill(0.25), 48_000);
        const file = await fs.open(path.join(folder, `${recordingId}-insert_1-${pass}.wav`), "r+");
        await file.write(Buffer.alloc(4), 0, 4, 40);
        await file.close();
      }
      const request = (recorder as unknown as { request(cmd: string, params: object): Promise<unknown> }).request.bind(recorder);
      await expect(request("crash", {})).rejects.toMatchObject({ status: 503 });
      for (let waited = 0; takes.length < 2 && waited < 3000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(takes).toMatchObject([
        { recordingId, track: "insert_1", startTick: 192, frames: 4800, pass: 0, final: false, error: expect.stringMatching(/stopped mid-recording/) },
        { recordingId, track: "insert_1", startTick: 0, frames: 2400, pass: 1, final: true },
      ]);
      expect((await readWav(path.join(folder, `${recordingId}-insert_1-2.wav`))).channels[0].length).toBe(2400);
    } finally {
      recorder.shutdown();
    }
  });

  it("says how to build the engine when it's missing", async () => {
    const missing = new AudioEngine(new DataPaths(dir), { command: [path.join(dir, "nope")], pluginPaths: [] });
    await expect(missing.command("status", {})).rejects.toMatchObject({ status: 503, message: expect.stringContaining("engine:build") });
  });
});

describe("engineOutdated", () => {
  it("says a checkout's engine built before its source last changed is out of date, and nothing of others", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "engine-src-"));
    const binary = path.join(root, "build", "YTStudio Engine");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.mkdir(path.dirname(binary), { recursive: true });
    const at = (file: string, seconds: number) => fs.utimes(file, seconds, seconds);
    await fs.writeFile(path.join(root, "src", "Engine.cpp"), "");
    await fs.writeFile(path.join(root, "CMakeLists.txt"), "");
    await fs.writeFile(binary, "");
    await at(path.join(root, "src", "Engine.cpp"), 1000);
    await at(path.join(root, "CMakeLists.txt"), 1000);
    await at(binary, 2000);
    expect(await engineOutdated(binary, root)).toBe(false);
    await at(path.join(root, "src", "Engine.cpp"), 3000);
    expect(await engineOutdated(binary, root)).toBe(true);
    // A packaged app's engine, or a stand-in, isn't the checkout's build: never out of date.
    expect(await engineOutdated("/Applications/YTStudio.app/Contents/Resources/YTStudio Engine", root)).toBe(false);
    expect(await engineOutdated("fake-engine.mjs", root)).toBe(false);
    await fs.rm(root, { recursive: true, force: true });
  });
});
