import { describe, expect, it } from "vitest";
import type { BrowserItem } from "@shared/music/browser";
import { type FolderContents, type Row, arrowAction, foldersToReveal, isItem, nameOf, parentRow, resultRows, rowRange, step, treeRows } from "./tree";

const folder = (path: string): BrowserItem => ({ path, name: path.slice(path.lastIndexOf("/") + 1), kind: "folder" });
const file = (path: string): BrowserItem => ({ path, name: path.slice(path.lastIndexOf("/") + 1), kind: "file" });

const roots = [
  { path: "/s/Drums", name: "Drums", missing: false },
  { path: "/s/Gone", name: "Gone", missing: true },
];
const contents = new Map<string, FolderContents>([
  ["/s/Drums", { status: "loaded", items: [folder("/s/Drums/808"), file("/s/Drums/Clap.wav")] }],
  ["/s/Drums/808", { status: "loaded", items: [file("/s/Drums/808/Kick.wav")] }],
]);
const keys = (rows: Row[]) => rows.map((r) => (isItem(r) ? `${"  ".repeat(r.depth)}${r.item.name}${r.expanded ? "/" : ""}` : `# ${r.kind === "heading" ? r.label : r.text}`));

describe("treeRows", () => {
  it("shows the favourites, then the folders with what's open of them", () => {
    const rows = treeRows({ roots, favourites: ["/s/Drums/808/Kick.wav", "/s/Drums/808"], expanded: new Set(["/s/Drums", "/s/Drums/808", "/s/Gone"]), contents });
    expect(keys(rows)).toEqual(["# Favourites", "Kick.wav", "808", "# Folders", "Drums/", "  808/", "    Kick.wav", "  Clap.wav", "Gone"]);
    const kick = rows.filter(isItem).filter((r) => r.item.name === "Kick.wav");
    expect(kick.map((r) => [r.key, r.favourite])).toEqual([
      ["f:/s/Drums/808/Kick.wav", true],
      ["t:/s/Drums/808/Kick.wav", true],
    ]);
    expect(rows.filter(isItem).find((r) => r.item.name === "Gone")).toMatchObject({ root: true, missing: true });
  });

  it("opens favourite folders in place, apart from the tree, each keyed by its favourite", () => {
    const rows = treeRows({
      roots,
      favourites: ["/s/Drums", "/s/Drums/808"],
      expanded: new Set(),
      favouritesInPlace: true,
      favouritesExpanded: new Set(["/s/Drums", "/s/Drums/808"]),
      contents,
    });
    expect(keys(rows)).toEqual(["# Favourites", "Drums/", "  808/", "    Kick.wav", "  Clap.wav", "808/", "  Kick.wav", "# Folders", "Drums", "Gone"]);
    expect(rows.filter(isItem).map((r) => r.key)).toEqual([
      "f:/s/Drums",
      "f:/s/Drums>/s/Drums/808",
      "f:/s/Drums>/s/Drums/808/Kick.wav",
      "f:/s/Drums>/s/Drums/Clap.wav",
      "f:/s/Drums/808",
      "f:/s/Drums/808>/s/Drums/808/Kick.wav",
      "t:/s/Drums",
      "t:/s/Gone",
    ]);
    expect(arrowAction(rows, "f:/s/Drums>/s/Drums/808", -1)).toEqual({ type: "collapse", path: "/s/Drums/808", place: "favourites" });
    expect(arrowAction(rows, "f:/s/Drums>/s/Drums/Clap.wav", -1)).toEqual({ type: "go", row: expect.objectContaining({ key: "f:/s/Drums" }) });
    expect(parentRow(rows, "f:/s/Drums/808")).toBeNull();
    // Off, they're shortcuts: they never open, whatever was left open.
    const shortcuts = treeRows({ roots, favourites: ["/s/Drums"], expanded: new Set(), favouritesExpanded: new Set(["/s/Drums"]), contents });
    expect(keys(shortcuts)).toEqual(["# Favourites", "Drums", "# Folders", "Drums", "Gone"]);
    expect(shortcuts.filter(isItem)[0]).toMatchObject({ opens: false, expanded: false });
  });

  it("says when a folder is being read, empty or unreadable", () => {
    const more = new Map(contents);
    more.set("/s/Drums/808", { status: "loaded", items: [] });
    expect(keys(treeRows({ roots: roots.slice(0, 1), favourites: [], expanded: new Set(["/s/Drums", "/s/Drums/808"]), contents: more }))).toEqual([
      "# Folders",
      "Drums/",
      "  808/",
      "# No audio files",
      "  Clap.wav",
    ]);
    more.set("/s/Drums", { status: "loading" });
    expect(keys(treeRows({ roots: roots.slice(0, 1), favourites: [], expanded: new Set(["/s/Drums"]), contents: more }))).toEqual(["# Folders", "Drums/", "# Reading…"]);
  });
});

describe("moving through the rows", () => {
  const rows = treeRows({ roots, favourites: ["/s/Drums/808"], expanded: new Set(["/s/Drums", "/s/Drums/808"]), contents });

  it("steps over headings and stops at the ends", () => {
    expect(step(rows, null, 1)?.key).toBe("f:/s/Drums/808");
    expect(step(rows, "f:/s/Drums/808", 1)?.key).toBe("t:/s/Drums");
    expect(step(rows, "f:/s/Drums/808", -1)?.key).toBe("f:/s/Drums/808");
    expect(step(rows, "t:/s/Gone", 1)?.key).toBe("t:/s/Gone");
    expect(step(rows, null, -1)?.key).toBe("t:/s/Gone");
  });

  it("opens with →, goes in, closes with ←, goes out", () => {
    expect(arrowAction(rows, "t:/s/Drums", 1)).toEqual({ type: "go", row: expect.objectContaining({ key: "t:/s/Drums/808" }) });
    expect(arrowAction(rows, "t:/s/Drums/808", -1)).toEqual({ type: "collapse", path: "/s/Drums/808", place: "tree" });
    expect(arrowAction(rows, "t:/s/Drums/808/Kick.wav", -1)).toEqual({ type: "go", row: expect.objectContaining({ key: "t:/s/Drums/808" }) });
    expect(arrowAction(rows, "t:/s/Drums/Clap.wav", 1)).toBeNull();
    expect(arrowAction(rows, "t:/s/Gone", 1)).toBeNull();
    const closed = treeRows({ roots, favourites: [], expanded: new Set(), contents });
    expect(arrowAction(closed, "t:/s/Drums", 1)).toEqual({ type: "expand", path: "/s/Drums", place: "tree" });
    // A favourite folder that's a shortcut doesn't open.
    expect(arrowAction(rows, "f:/s/Drums/808", 1)).toBeNull();
    expect(parentRow(rows, "t:/s/Drums")).toBeNull();
  });

  it("selects a range between two rows, either way", () => {
    expect(rowRange(rows, "t:/s/Drums/Clap.wav", "t:/s/Drums/808")).toEqual(["t:/s/Drums/808", "t:/s/Drums/808/Kick.wav", "t:/s/Drums/Clap.wav"]);
    expect(rowRange(rows, "gone", "t:/s/Drums")).toEqual(["t:/s/Drums"]);
  });
});

describe("resultRows", () => {
  it("lists hits flat with their folder", () => {
    const rows = resultRows([{ path: "/s/Drums/Clap.wav", name: "Clap.wav", kind: "file", folder: "Drums" }], ["/s/Drums/Clap.wav"]);
    expect(rows[0]).toMatchObject({ key: "r:/s/Drums/Clap.wav", section: "results", favourite: true, folder: "Drums" });
  });
});

describe("foldersToReveal", () => {
  it("opens every folder down to a file, or to a folder itself", () => {
    expect(foldersToReveal(roots, "/s/Drums/808/Kick.wav", false)).toEqual(["/s/Drums", "/s/Drums/808"]);
    expect(foldersToReveal(roots, "/s/Drums/808", true)).toEqual(["/s/Drums", "/s/Drums/808"]);
    expect(foldersToReveal(roots, "/s/Drumsticks/a.wav", false)).toBeNull();
  });
});

describe("Windows paths", () => {
  it("names a path by its last part, with either separator", () => {
    expect(nameOf("/s/Drums/Kick.wav")).toBe("Kick.wav");
    expect(nameOf(String.raw`C:\s\Drums\Kick.wav`)).toBe("Kick.wav");
  });

  it("reveals folders with backslashes", () => {
    const win = [{ path: String.raw`C:\s\Drums`, name: "Drums", missing: false }];
    expect(foldersToReveal(win, String.raw`C:\s\Drums\808\Kick.wav`, false)).toEqual([String.raw`C:\s\Drums`, String.raw`C:\s\Drums\808`]);
  });
});
