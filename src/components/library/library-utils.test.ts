import { describe, expect, it } from "vitest";
import type { LibraryFolder, LibraryItem, MediaAsset } from "@shared/types";
import { folderItemCounts, libraryContents } from "./library-utils";

const folder = (id: string, name: string, parentId: string | null = null): LibraryFolder => ({ id, name, parentId, createdAt: 0 });
const item = (id: string, name: string, extra: Partial<LibraryItem> = {}): LibraryItem =>
  ({ id, name, folderId: null, createdAt: 0, usedAt: null, favorite: false, kind: "media", mediaId: "m-video", ...extra }) as LibraryItem;
const asset = (id: string, kind: MediaAsset["kind"]) => ({ id, kind }) as MediaAsset;

const library = {
  folders: [folder("sfx", "Sound effects"), folder("wh", "Whooshes", "sfx"), folder("logos", "Logos")],
  items: [
    item("a", "whoosh 10", { folderId: "wh", mediaId: "m-audio", usedAt: 3 }),
    item("b", "whoosh 2", { folderId: "wh", mediaId: "m-audio", favorite: true }),
    item("c", "Logo", { folderId: "logos", mediaId: "m-image", usedAt: 8 }),
    item("d", "Intro", { kind: "clips", template: { tracks: [], clips: [] } } as Partial<LibraryItem>),
  ],
  assets: [asset("m-audio", "audio"), asset("m-image", "image"), asset("m-video", "video")],
};
const top = { kind: "folder", folderId: null } as const;

describe("libraryContents", () => {
  it("lists a folder's subfolders and items, A to Z with numbers in order", () => {
    expect(libraryContents(library, { view: top, query: "", filter: "all" })).toMatchObject({
      folders: [{ id: "logos" }, { id: "sfx" }],
      items: [{ id: "d" }],
    });
    const whooshes = libraryContents(library, { view: { kind: "folder", folderId: "wh" }, query: "", filter: "all" });
    expect(whooshes.items.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("searches every folder, and filters by kind", () => {
    const found = libraryContents(library, { view: top, query: "who", filter: "all" });
    expect(found.items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(found.folders.map((f) => f.id)).toEqual(["wh"]);
    expect(libraryContents(library, { view: top, query: "o", filter: "image" }).items.map((i) => i.id)).toEqual(["c"]);
    expect(libraryContents(library, { view: top, query: "", filter: "clips" }).items.map((i) => i.id)).toEqual(["d"]);
  });

  it("shows favourites and recently used items", () => {
    expect(libraryContents(library, { view: { kind: "favorites" }, query: "", filter: "all" }).items.map((i) => i.id)).toEqual(["b"]);
    expect(libraryContents(library, { view: { kind: "recent" }, query: "", filter: "all" }).items.map((i) => i.id)).toEqual(["c", "a"]);
  });
});

it("counts the items in each folder, subfolders included", () => {
  const counts = folderItemCounts(library.folders, library.items);
  expect(Object.fromEntries(counts)).toEqual({ wh: 2, sfx: 2, logos: 1 });
});
