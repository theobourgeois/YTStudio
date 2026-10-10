import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addPluginChannel } from "../../../shared/music/edits.ts";
import { createMusicProject } from "../../../shared/music/project.ts";
import { serumModAmountParam } from "../../../shared/music/serum-sound.ts";
import { DataPaths } from "../../storage.ts";
import { readSerumSettings } from "./preset.ts";
import { macroNamesOf } from "./sound.ts";
import { AudioEngine } from "../engine.ts";
import { SerumLibrary } from "./library.ts";
import { SerumPlayer } from "./player.ts";
import { standInSerumLibrary } from "./stand-in.ts";

const PROJECT = "proj_0123456789ab";
const CHANNEL = "chan_serum";
const FAKE = [process.execPath, path.join(import.meta.dirname, "..", "fake-engine.mjs")];

/** The player on the stand-in engine (whose Serum keeps a dropped Serum 2 preset as its state) and library. */
describe("the Serum player's edits and history", () => {
  let dir: string;
  let engine: AudioEngine;
  let player: SerumPlayer;
  let presets: Record<string, string>;
  let library: SerumLibrary;
  const target = { projectId: PROJECT, channel: CHANNEL };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "serum-player-"));
    engine = new AudioEngine(new DataPaths(dir), { command: FAKE, pluginPaths: [] });
    library = new SerumLibrary(standInSerumLibrary(path.join(dir, "library")), { suggestions: [] });
    player = new SerumPlayer({ library, engine, hasProject: (id) => id === PROJECT });
    presets = Object.fromEntries((await library.list()).map((p) => [p.name, p.path]));
    const song = addPluginChannel(createMusicProject("Serum", 120), { id: "VST3-Serum 2-3", name: "Serum 2", format: "VST3" }, CHANNEL);
    await engine.setSong({ projectId: PROJECT, song, patternId: null });
  });
  afterEach(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("loads a preset with its macro names, edits it by reloads and live controls, and undoes and redoes each step", async () => {
    const loaded = await player.load({ ...target, path: presets["BA - Stand-in Reese"] });
    expect(loaded.preset?.name).toBe("BA - Stand-in Reese");
    // Serum's controls are "Macro 1"…: the preset's own name comes from the player's keeping.
    expect(loaded.macros[0].name).toBe("GRIT");
    expect(loaded).toMatchObject({ modulation: [], edited: false, history: { undo: null, redo: null } });

    const added = await player.edit({ ...target, edits: [{ kind: "route", source: "Macro 1", to: "A WT Pos", amount: 40 }] });
    expect(added.modulation).toMatchObject([{ slot: 1, source: "Macro 1", to: "A WT Pos" }]);
    expect(added.modulation![0].amount.value).toBeCloseTo(0.7);
    expect(added).toMatchObject({ edited: true, history: { undo: "Add a route", redo: null } });
    // The names went back in with the new state.
    expect(added.macros[0].name).toBe("GRIT");

    // A drag of its amount: live, then one step.
    await engine.command("setParameter", { owner: "channel", ownerId: CHANNEL, param: serumModAmountParam(1), value: 0.9 });
    expect(await player.step({ ...target, changes: [{ param: serumModAmountParam(1), before: 0.7, after: 0.9 }], label: "Mod 1 amount" })).toEqual({ undo: "Mod 1 amount", redo: null });
    expect((await player.sound(PROJECT, CHANNEL)).modulation![0].amount.value).toBe(0.9);

    const undone = await player.undo(target);
    expect(undone.modulation![0].amount.value).toBeCloseTo(0.7);
    expect(undone.history).toEqual({ undo: "Add a route", redo: "Mod 1 amount" });
    const before = await player.undo(target);
    expect(before).toMatchObject({ modulation: [], edited: false, history: { undo: null, redo: "Add a route" } });
    await expect(player.undo(target)).rejects.toMatchObject({ status: 409 });

    const redone = await player.undo(target, true);
    expect(redone.modulation).toMatchObject([{ slot: 1, to: "A WT Pos" }]);
    expect(redone).toMatchObject({ edited: true, history: { undo: "Add a route", redo: "Mod 1 amount" } });
    expect((await player.undo(target, true)).history).toEqual({ undo: "Mod 1 amount", redo: null });

    // Another preset loaded is a step too, which takes the first back with its names; a new step clears what could be redone.
    const lead = await player.load({ ...target, path: presets["LD - Stand-in Lead"] });
    expect(lead.macros[0].name).toBe("SPACE");
    expect(lead.history).toEqual({ undo: "Load LD - Stand-in Lead", redo: null });
    const back = await player.undo(target);
    expect(back.preset?.name).toBe("BA - Stand-in Reese");
    expect(back.macros[0].name).toBe("GRIT");
    expect(back.modulation).toMatchObject([{ slot: 1, to: "A WT Pos" }]);
  });

  it("refuses an edit Serum couldn't take, saying what would do, and keeps no step for it", async () => {
    await expect(player.edit({ ...target, edits: [{ kind: "route", source: "LFO 1", to: "A Level" }] })).rejects.toMatchObject({ status: 409 });
    await player.load({ ...target, path: presets["LD - Stand-in Lead"] });
    await expect(player.edit({ ...target, edits: [{ kind: "route", source: "LFO 1", to: "Nowhere" }] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/isn't a destination/) });
    // (The stand-in had no state before the load: nothing to go back to.)
    expect((await player.sound(PROJECT, CHANNEL)).history).toEqual({ undo: null, redo: null });
    expect(await player.destinations(PROJECT, CHANNEL)).toContain("Filter 1 Freq");
    await expect(player.step({ ...target, changes: [{ param: "7000000", before: 0, after: 2 }] })).rejects.toMatchObject({ status: 400 });
  });

  it("saves the sound as a preset in Serum's User folder, its macro names in it, and never over one of Serum's own", async () => {
    await player.load({ ...target, path: presets["BA - Stand-in Reese"] });
    await player.edit({ ...target, edits: [{ kind: "route", source: "Macro 1", to: "A WT Pos", amount: 40 }] });
    // A factory preset isn't saved over: it takes a name.
    await expect(player.save(target)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/new preset, with a name/) });
    await expect(player.save({ ...target, name: "bad/name" })).rejects.toMatchObject({ status: 400 });

    const saved = await player.save({ ...target, name: "  BA - My Reese " });
    const user = path.join(dir, "library", "Presets", "User");
    expect(saved).toMatchObject({ path: path.join(user, "BA - My Reese.SerumPreset"), replaced: false });
    // Serum says it has the new one on, unedited, with the history as it was.
    expect(saved.sound).toMatchObject({ preset: { name: "BA - My Reese", path: saved.path }, edited: false, history: { undo: "Add a route" } });
    expect(saved.sound.macros[0].name).toBe("GRIT");
    const { body } = readSerumSettings(new Uint8Array(await fs.readFile(saved.path)));
    expect(body.presetName).toBe("BA - My Reese");
    expect(macroNamesOf(body)[0]).toBe("GRIT");
    expect(body.ModSlot0).toBeTruthy();
    // Listed with the rest, in User, as Serum lists it.
    expect((await library.list()).find((p) => p.path === saved.path)).toMatchObject({ name: "BA - My Reese", folder: "User", kind: "serum2", category: "Bass" });

    // Saved over, now that it's one of User's; a new name that's taken asks first.
    await player.edit({ ...target, edits: [{ kind: "removeRoute", slot: 1 }] });
    expect((await player.sound(PROJECT, CHANNEL)).edited).toBe(true);
    const over = await player.save(target);
    expect(over).toMatchObject({ path: saved.path, replaced: true, sound: { edited: false } });
    expect(readSerumSettings(new Uint8Array(await fs.readFile(saved.path))).body.ModSlot0).not.toMatchObject({ destModuleID: expect.anything() });
    await expect(player.save({ ...target, name: "BA - My Reese" })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already/) });
    expect((await player.save({ ...target, name: "BA - My Reese", overwrite: true })).replaced).toBe(true);
  });
});
