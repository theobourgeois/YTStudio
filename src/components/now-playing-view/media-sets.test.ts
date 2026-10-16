import { describe, expect, it } from "vitest";
import type { Library, LibraryFolder, LibraryItem, MediaAsset } from "@shared/types";
import { currentSet, newSetName, nextSet, readSets } from "./media-sets";

const folder = (id: string, parentId: string | null, createdAt = 0): LibraryFolder => ({ id, name: id, parentId, createdAt });
const item = (id: string, folderId: string | null, mediaId = `m-${id}`): LibraryItem => ({ kind: "media", id, name: id, folderId, mediaId, createdAt: 0 }) as LibraryItem;
const asset = (id: string, over: Partial<MediaAsset> = {}): MediaAsset => ({ id, name: id, kind: "image", src: `/${id}`, status: "ready", ...over }) as MediaAsset;

describe("the visualizer's sets of clips", () => {
  const library: Library = {
    folders: [folder("root", null), folder("nature", "root", 2), folder("friends", "root", 1), folder("trip", "friends"), folder("elsewhere", null)],
    items: [item("a", "root"), item("b", "friends"), item("c", "trip"), item("d", "nature"), item("e", "elsewhere"), item("f", "nature", "m-sound"), item("g", "nature", "m-gone")],
    media: [asset("m-a"), asset("m-b"), asset("m-c", { kind: "video", hasVideo: true }), asset("m-d"), asset("m-e"), asset("m-sound", { kind: "audio" }), asset("m-gone", { status: "error" })],
  };

  it("reads the Visualizer folder's own folders as sets, the oldest first, with what's in their folders too", () => {
    const { sets, loose } = readSets(library, "root");
    expect(sets.map((s) => [s.name, s.media.map((m) => m.itemId)])).toEqual([
      ["friends", ["b", "c"]],
      ["nature", ["d"]],
    ]);
    // In the Visualizer folder itself: in no set yet.
    expect(loose.map((m) => m.itemId)).toEqual(["a"]);
  });

  it("leaves out what it can't show (sound, broken files) and has none without the folder", () => {
    expect(readSets(library, "root").sets[1].media.map((m) => m.asset.id)).toEqual(["m-d"]);
    expect(readSets(library, null)).toEqual({ sets: [], loose: [] });
  });

  it("uses the set kept while it's there, else the first", () => {
    const { sets } = readSets(library, "root");
    expect(currentSet(sets, "nature")?.id).toBe("nature");
    expect(currentSet(sets, "deleted")?.id).toBe("friends");
    expect(currentSet([], "nature")).toBeNull();
  });

  it("goes round the sets", () => {
    const { sets } = readSets(library, "root");
    expect(nextSet(sets, "friends")?.id).toBe("nature");
    expect(nextSet(sets, "nature")?.id).toBe("friends");
    expect(nextSet(sets, null)?.id).toBe("friends");
    expect(nextSet([], null)).toBeNull();
  });

  it("names a new set after how many there are, never as another", () => {
    expect(newSetName([])).toBe("Set 1");
    expect(newSetName([{ name: "My clips" }])).toBe("Set 2");
    expect(newSetName([{ name: "My clips" }, { name: "set 3" }])).toBe("Set 4");
  });
});
