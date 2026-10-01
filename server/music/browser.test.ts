import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataPaths, HttpError } from "../storage.ts";
import { SampleBrowser } from "./browser.ts";

let dir: string;
let samples: string;
let paths: DataPaths;
const open: SampleBrowser[] = [];

function make(watch = false): SampleBrowser {
  const browser = new SampleBrowser(paths, { watch });
  open.push(browser);
  return browser;
}

function touch(...parts: string[]): string {
  const file = path.join(samples, ...parts);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "");
  return file;
}

async function status(promise: Promise<unknown> | (() => unknown)): Promise<number | null> {
  try {
    await (typeof promise === "function" ? promise() : promise);
    return null;
  } catch (err) {
    return err instanceof HttpError ? err.status : -1;
  }
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "browser-test-"));
  samples = path.join(dir, "Samples");
  paths = new DataPaths(path.join(dir, "data"));
  await paths.init();
  touch("Drums", "808 Kit", "Kick 10.wav");
  touch("Drums", "808 Kit", "Kick 2.wav");
  touch("Drums", "808 Kit", "notes.txt");
  touch("Drums", ".hidden", "Kick.wav");
  touch("Drums", "Snare.aif");
  touch("Loops", "Break 120.mp3");
});

afterEach(() => {
  for (const b of open.splice(0)) b.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("SampleBrowser", () => {
  it("adds a folder, lists it and keeps it for the next start", async () => {
    const browser = make();
    const state = await browser.addRoot(samples);
    expect(state.roots).toEqual([{ path: samples, name: "Samples", missing: false }]);

    expect((await browser.list(samples)).map((i) => [i.name, i.kind])).toEqual([
      ["Drums", "folder"],
      ["Loops", "folder"],
    ]);
    // Folders first, then audio files only, "2" before "10", hidden ones left out.
    expect((await browser.list(path.join(samples, "Drums", "808 Kit"))).map((i) => i.name)).toEqual(["Kick 2.wav", "Kick 10.wav"]);
    expect((await browser.list(path.join(samples, "Drums"))).map((i) => i.name)).toEqual(["808 Kit", "Snare.aif"]);

    const again = make();
    await again.load();
    expect(again.state().roots.map((r) => r.path)).toEqual([samples]);
  });

  it("indexes every folder and audio file for the search", async () => {
    const browser = make();
    await browser.addRoot(samples);
    await browser.ready();
    expect(browser.state()).toMatchObject({ indexed: 7, indexing: false });
    const { hits, total } = browser.search("kick");
    expect(total).toBe(2);
    expect(hits.map((h) => [h.name, h.folder])).toEqual([
      ["Kick 2.wav", "Samples/Drums/808 Kit"],
      ["Kick 10.wav", "Samples/Drums/808 Kit"],
    ]);
    expect(browser.search("808 kit").hits[0]).toMatchObject({ name: "808 Kit", kind: "folder" });
    expect(browser.search("brek").hits.map((h) => h.name)).toEqual(["Break 120.mp3"]);
  });

  it("reads only inside its folders", async () => {
    const browser = make();
    await browser.addRoot(path.join(samples, "Drums"));
    expect(await status(browser.list(path.join(samples, "Loops")))).toBe(403);
    expect(await status(browser.list(path.join(samples, "Drums", "..", "Loops")))).toBe(403);
    expect(await status(browser.list("Drums"))).toBe(400);
    expect(await status(browser.audioFile(path.join(samples, "Loops", "Break 120.mp3")))).toBe(403);
    expect(await status(browser.audioFile(path.join(samples, "Drums", "808 Kit", "notes.txt")))).toBe(400);
    expect(await browser.audioFile(path.join(samples, "Drums", "Snare.aif"))).toBe(path.join(samples, "Drums", "Snare.aif"));
  });

  it("refuses a file, a drive and a folder already in, and takes in the folders a new one holds", async () => {
    const browser = make();
    expect(await status(browser.addRoot(path.join(samples, "Loops", "Break 120.mp3")))).toBe(400);
    expect(await status(browser.addRoot("/"))).toBe(400);
    await browser.addRoot(path.join(samples, "Drums"));
    await browser.addRoot(path.join(samples, "Loops"));
    expect(await status(browser.addRoot(path.join(samples, "Drums", "808 Kit")))).toBe(409);
    const state = await browser.addRoot(samples);
    expect(state.roots.map((r) => r.name)).toEqual(["Samples"]);
  });

  it("stars files and folders, and forgets them with their folder", async () => {
    const browser = make();
    await browser.addRoot(samples);
    const kick = path.join(samples, "Drums", "808 Kit", "Kick 2.wav");
    const kit = path.join(samples, "Drums", "808 Kit");
    await browser.setFavourite(kick, true);
    expect((await browser.setFavourite(kit, true)).favourites).toEqual([kick, kit]);
    expect((await browser.setFavourite(kick, true)).favourites).toEqual([kick, kit]);
    expect((await browser.setFavourite(kick, false)).favourites).toEqual([kit]);
    expect(await status(browser.setFavourite("/etc/passwd", true))).toBe(403);
    expect((await browser.removeRoot(samples)).favourites).toEqual([]);
  });

  it("shows a folder that's gone as missing, and finds it again when it's back", async () => {
    const browser = make();
    await browser.addRoot(samples);
    await fs.rename(samples, `${samples}-away`);
    await browser.rescan();
    expect(browser.state()).toMatchObject({ roots: [{ missing: true }], indexed: 0 });
    await fs.rename(`${samples}-away`, samples);
    await browser.rescan();
    expect(browser.state()).toMatchObject({ roots: [{ missing: false }], indexed: 7 });
  });

  it("lists linked folders but doesn't index through them", async () => {
    const elsewhere = path.join(dir, "Elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(path.join(elsewhere, "Clap.wav"), "");
    symlinkSync(elsewhere, path.join(samples, "Linked"));
    const browser = make();
    await browser.addRoot(samples);
    expect((await browser.list(samples)).map((i) => i.name)).toEqual(["Drums", "Linked", "Loops"]);
    expect((await browser.list(path.join(samples, "Linked"))).map((i) => i.name)).toEqual(["Clap.wav"]);
  });

  it("notices new files by itself", async () => {
    const browser = make(true);
    await browser.addRoot(samples);
    await browser.ready();
    touch("Drums", "Clap 1.wav");
    const started = Date.now();
    while (browser.search("clap").total === 0 && Date.now() - started < 5000) await new Promise((r) => setTimeout(r, 50));
    expect(browser.search("clap").hits.map((h) => h.name)).toEqual(["Clap 1.wav"]);
  });
});
