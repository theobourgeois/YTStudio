import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffSnapshots, contentMatches, validateSnapshot } from "../../../shared/music/audio-intelligence/snapshot.ts";
import type { RenderSettings } from "../../../shared/music/audio-intelligence/types.ts";
import { setEffect } from "../../../shared/music/mixer.ts";
import { PRO_C_PLUGIN } from "../../../shared/music/pro-c-presets.ts";
import { createChannel, createMusicProject, createPluginChannel } from "../../../shared/music/project.ts";
import type { MusicProject } from "../../../shared/music/types.ts";
import { FileHasher, hashStream } from "./files.ts";
import { captureSnapshot } from "./snapshot.ts";

const RENDER: RenderSettings = { sampleRate: 48000, channelLayout: "stereo", resampling: "hermite", mode: "song", engineVersion: null };
const SYNTH = { id: "vst3:synth", name: "Synth", format: "VST3" };
const COMP = { id: "vst3:comp", name: "Comp", format: "VST3" };
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

let dir: string;
let hasher: FileHasher;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "snapshot-"));
  await fs.mkdir(path.join(dir, "plugins"));
  await fs.mkdir(path.join(dir, "media"));
  hasher = new FileHasher();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function song(): MusicProject {
  let s = createMusicProject("Song");
  s = { ...s, channels: [createChannel("Vocal", "media_vocal", "chan_vocal"), createChannel("Beat", "media_beat", "chan_beat"), createPluginChannel(SYNTH, "chan_synth")] };
  s = setEffect(s, "insert_1", 0, COMP, "fx_comp");
  return setEffect(s, "insert_1", 1, PRO_C_PLUGIN, "fx_proc");
}

const media = (name: string) => path.join(dir, "media", name);
const samplePath = (id: string) => ({ media_vocal: media("vocal.wav"), media_beat: media("beat.wav") })[id as "media_vocal"] ?? null;

async function writeAll() {
  await fs.writeFile(media("vocal.wav"), "vocal audio");
  await fs.writeFile(media("beat.wav"), "beat audio");
  await fs.writeFile(path.join(dir, "plugins", "chan_synth.bin"), "synth state");
  await fs.writeFile(path.join(dir, "plugins", "fx_comp.bin"), "comp state");
}

const capture = (over: Partial<Parameters<typeof captureSnapshot>[0]> = {}) =>
  captureSnapshot({
    projectId: "proj_0123456789ab",
    document: song(),
    projectDir: dir,
    samplePath,
    render: RENDER,
    capture: { origin: "live-document", unsavedEdits: false },
    pluginVersions: { chan_synth: "1.0", fx_comp: "2.0" },
    hasher,
    now: 1234,
    ...over,
  });

describe("hashStream", () => {
  it("hashes a file as node's sha256 does, with its size, whatever its length", async () => {
    for (const size of [0, 1, 65535, 65536, 65537, 300_000]) {
      const body = Buffer.alloc(size, size % 251);
      await fs.writeFile(media("x.bin"), body);
      expect(await hashStream(media("x.bin"))).toEqual({ sha256: sha(body), bytes: size });
    }
  });

  it("rejects a file that isn't there", async () => {
    await expect(hashStream(media("nope.bin"))).rejects.toThrow();
  });
});

describe("FileHasher", () => {
  it("says hashed with the hash and size, missing for no file and for a null path, unreadable for a folder", async () => {
    await fs.writeFile(media("a.wav"), "abc");
    expect(await hasher.facts(media("a.wav"))).toEqual({ status: "hashed", sha256: sha("abc"), bytes: 3 });
    expect(await hasher.facts(media("gone.wav"))).toEqual({ status: "missing", sha256: null, bytes: null });
    expect(await hasher.facts(null)).toEqual({ status: "missing", sha256: null, bytes: null });
    expect(await hasher.facts(path.join(dir, "media"))).toEqual({ status: "unreadable", sha256: null, bytes: null });
  });

  it("reads a file once while it stays as it was, and again when it changes", async () => {
    await fs.writeFile(media("a.wav"), "abc");
    await hasher.facts(media("a.wav"));
    await hasher.facts(media("a.wav"));
    expect(hasher.reads).toBe(1);
    await fs.writeFile(media("a.wav"), "abcd");
    expect(await hasher.facts(media("a.wav"))).toMatchObject({ sha256: sha("abcd"), bytes: 4 });
    expect(hasher.reads).toBe(2);
  });

  it("sees a rewrite of the same size, by its modification time", async () => {
    await fs.writeFile(media("a.wav"), "abc");
    const first = await hasher.facts(media("a.wav"));
    await fs.writeFile(media("a.wav"), "xyz");
    const later = new Date(Date.now() + 5000);
    await fs.utimes(media("a.wav"), later, later);
    const second = await hasher.facts(media("a.wav"));
    expect(second).toMatchObject({ status: "hashed", sha256: sha("xyz") });
    expect(second).not.toEqual(first);
  });
});

describe("captureSnapshot", () => {
  it("hashes the media and the plugins' state, and finds the song complete", async () => {
    await writeAll();
    const { snapshot, content } = await capture();
    expect(snapshot.media).toEqual([
      { id: "media_beat", channels: ["chan_beat"], status: "hashed", sha256: sha("beat audio"), bytes: 10 },
      { id: "media_vocal", channels: ["chan_vocal"], status: "hashed", sha256: sha("vocal audio"), bytes: 11 },
    ]);
    expect(snapshot.plugins.map((p) => [p.owner.id, p.state, p.sha256])).toEqual([
      ["chan_synth", "hashed", sha("synth state")],
      ["fx_comp", "hashed", sha("comp state")],
      ["fx_proc", "inDocument", null],
    ]);
    expect(snapshot.completeness).toBe("complete");
    expect(snapshot.createdAt).toBe(1234);
    expect(contentMatches(snapshot, content)).toBe(true);
    expect(validateSnapshot(JSON.parse(JSON.stringify(snapshot))).ok).toBe(true);
  });

  it("says what it couldn't see: a missing media file, a plugin with no state yet", async () => {
    await fs.writeFile(media("vocal.wav"), "vocal audio");
    await fs.writeFile(path.join(dir, "plugins", "chan_synth.bin"), "synth state");
    const { snapshot } = await capture();
    expect(snapshot.media.find((m) => m.id === "media_beat")).toMatchObject({ status: "missing", sha256: null });
    expect(snapshot.plugins.find((p) => p.owner.id === "fx_comp")).toMatchObject({ state: "absent", sha256: null });
    expect(snapshot.coverage.media.status).toBe("partial");
    expect(snapshot.coverage.pluginState.status).toBe("partial");
    expect(snapshot.completeness).toBe("partial");
  });

  it("treats a media id with no file as missing", async () => {
    await writeAll();
    const { snapshot } = await capture({ samplePath: (id) => (id === "media_vocal" ? media("vocal.wav") : null) });
    expect(snapshot.media.find((m) => m.id === "media_beat")?.status).toBe("missing");
  });

  it("is the same snapshot when captured again, and a different one when a file changes", async () => {
    await writeAll();
    const a = await capture();
    const b = await capture({ now: 9999 });
    expect(b.snapshot.id).toBe(a.snapshot.id);
    await fs.writeFile(path.join(dir, "plugins", "chan_synth.bin"), "synth state, tweaked");
    const c = await capture();
    expect(c.snapshot.id).not.toBe(a.snapshot.id);
    expect(diffSnapshots(a.snapshot, c.snapshot)).toMatchObject({ plugins: ["chan_synth"], parts: [], media: [] });
  });

  it("hashes only what changed on a second capture", async () => {
    await writeAll();
    await capture();
    const reads = hasher.reads;
    expect(reads).toBe(4);
    await capture();
    expect(hasher.reads).toBe(reads);
  });

  it("never reads a state file outside the plugins folder, whatever the id", async () => {
    await writeAll();
    await fs.writeFile(path.join(dir, "secret.bin"), "secret");
    const evil = createMusicProject("Evil");
    const doc: MusicProject = { ...evil, channels: [{ ...createPluginChannel(SYNTH, "../secret"), id: "../secret" }] };
    const { snapshot } = await capture({ document: doc });
    expect(snapshot.plugins[0]).toMatchObject({ owner: { id: "../secret" }, state: "unreadable", sha256: null });
  });

  it("doesn't look for a state file for our own effects", async () => {
    await fs.writeFile(path.join(dir, "plugins", "fx_proc.bin"), "should be ignored");
    const { snapshot } = await capture();
    expect(snapshot.plugins.find((p) => p.owner.id === "fx_proc")).toMatchObject({ state: "inDocument", sha256: null });
  });

  it("captures an empty song with nothing to read", async () => {
    const { snapshot } = await capture({ document: createMusicProject("Empty") });
    expect(snapshot.media).toEqual([]);
    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.completeness).toBe("complete");
  });

  it("carries the provenance it's told, and the version of each plugin", async () => {
    await writeAll();
    const { snapshot } = await capture({ capture: { origin: "saved-document", unsavedEdits: true, editCount: 7 } });
    expect(snapshot.capture).toEqual({ origin: "saved-document", unsavedEdits: true, editCount: 7 });
    expect(snapshot.coverage.document.status).toBe("partial");
    expect(snapshot.plugins.find((p) => p.owner.id === "chan_synth")?.plugin.version).toBe("1.0");
  });
});
