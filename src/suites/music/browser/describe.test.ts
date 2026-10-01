import { describe, expect, it } from "vitest";
import { addPluginChannel } from "@shared/music/edits";
import { createMusicProject } from "@shared/music/project";
import type { MediaAsset } from "@shared/types";
import { describeBrowser, describeFolder, describeSearch, loadSampleEdit } from "./describe";

const asset = (id: string, name: string) => ({ id, name, hasAudio: true }) as MediaAsset;

describe("what the assistant reads of the Browser", () => {
  it("lists the folders and favourites, or says how to add one", () => {
    expect(describeBrowser({ roots: [], favourites: [], indexed: 0, indexing: false })).toMatch(/no folders yet/);
    const text = describeBrowser({ roots: [{ path: "/s", name: "s", missing: false }, { path: "/gone", name: "gone", missing: true }], favourites: ["/s/Kick.wav"], indexed: 12, indexing: false });
    expect(text).toContain("- /s\n- /gone (not there now");
    expect(text).toContain("Favourites:\n- /s/Kick.wav");
  });

  it("lists a folder and search results with full paths", () => {
    expect(describeFolder("/s", [{ path: "/s/Kits", name: "Kits", kind: "folder" }, { path: "/s/a.wav", name: "a.wav", kind: "file" }])).toBe("/s:\nFolders (1):\n- /s/Kits/\nAudio files (1):\n- /s/a.wav");
    expect(describeSearch("kick", { hits: [{ path: "/s/Kick.wav", name: "Kick.wav", kind: "file", folder: "s" }], total: 3 }, null)).toBe('3 matches for "kick", the best 1:\n- /s/Kick.wav');
    expect(describeSearch("zz", { hits: [], total: 0 }, null)).toMatch(/Nothing/);
  });
});

describe("loadSampleEdit", () => {
  const song = createMusicProject("Song");

  it("makes a channel of each file, named after it", () => {
    const { song: next, text } = loadSampleEdit(song, [asset("media_000000000001", "Kick_Hard.wav"), asset("media_000000000002", "Snare.wav")], {});
    expect(next.channels.map((c) => [c.name, c.kind === "sampler" ? c.sampleId : null])).toEqual([
      ["Kick Hard", "media_000000000001"],
      ["Snare", "media_000000000002"],
    ]);
    expect(text).toBe('Added 2 channels: "Kick Hard", "Snare". Read get_song for their ids.');
    expect(loadSampleEdit(song, [asset("media_000000000001", "a.wav")], { name: "Boom" }).song.channels[0].name).toBe("Boom");
  });

  it("gives a sampler channel the first file, and refuses a plugin channel", () => {
    const withKick = loadSampleEdit(song, [asset("media_000000000001", "Kick.wav")], {}).song;
    const { song: next } = loadSampleEdit(withKick, [asset("media_000000000002", "808.wav")], { channel: "kick" });
    expect(next.channels).toHaveLength(1);
    expect(next.channels[0]).toMatchObject({ name: "808", sampleId: "media_000000000002" });
    const synth = addPluginChannel(withKick, { id: "p", name: "Synth", format: "VST3" });
    expect(() => loadSampleEdit(synth, [asset("media_000000000002", "808.wav")], { channel: "Synth" })).toThrow(/plays a plugin/);
    expect(() => loadSampleEdit(synth, [], {})).toThrow(/None of the files/);
  });
});
