import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SerumLibrary, serum1Hash } from "./library.ts";
import { standInSerum1Preset as fxp } from "./stand-in.ts";
import { writeSerumPreset } from "./preset.ts";

/** Serum 2's index, with its own schema. */
function makeIndex(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE Locations ( location_id INTEGER PRIMARY KEY NOT NULL, location TEXT NOT NULL);
    CREATE TABLE Presets ( preset_id INTEGER PRIMARY KEY NOT NULL, comment TEXT, date_added INTEGER NOT NULL, date_modified INTEGER NOT NULL, author TEXT NOT NULL, category TEXT, description TEXT, file_ext TEXT, hash TEXT, location_id INTEGER NOT NULL REFERENCES Locations, name TEXT NOT NULL);
    CREATE TABLE Presets_Tags( preset_id INTEGER NOT NULL REFERENCES Presets ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES Tags, PRIMARY KEY (preset_id, tag_id));
    CREATE TABLE Tags( tag_id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE);
    CREATE TABLE UserData ( hash TEXT NOT NULL UNIQUE, rating INTEGER);
    INSERT INTO Locations VALUES (1, 'Starred');
    INSERT INTO Presets VALUES (1, '', 0, 0, '@shinju_09', 'Lead', 'A plain lead', 'fxp', 'x', 1, 'MO_SHINJU_LD_Wex');
    INSERT INTO Tags VALUES (1, 'Mono'), (2, 'S1');
    INSERT INTO Presets_Tags VALUES (1, 1), (1, 2);`);
  return db;
}

describe("Serum's preset library", () => {
  let dir: string;
  let library: SerumLibrary;
  let keys: Buffer;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "serum-library-"));
    await fs.mkdir(path.join(dir, "Presets", "Factory", "Keyboard"), { recursive: true });
    await fs.mkdir(path.join(dir, "Presets", "Starred"), { recursive: true });
    await fs.mkdir(path.join(dir, "System"), { recursive: true });
    keys = Buffer.from(writeSerumPreset({ name: "KY - Dream Keys", author: "Level 8", tags: ["Poly", "Sample"] } as never));
    await fs.writeFile(path.join(dir, "Presets", "Factory", "Keyboard", "KY - Dream Keys.SerumPreset"), keys);
    await fs.writeFile(path.join(dir, "Presets", "Starred", "MO_SHINJU_LD_Wex.fxp"), fxp("MO_SHINJU_LD_Wex"));
    await fs.writeFile(path.join(dir, "Presets", "Starred", "notes.txt"), "not a preset");
    await fs.writeFile(path.join(dir, "Presets", "Starred", "broken.SerumPreset"), "not one either");
    makeIndex(path.join(dir, "System", "presets.db")).close();
    library = new SerumLibrary({ serum2: dir, serum1: null });
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("keys a Serum 1 preset's rating as Serum does: the MD5 of the file up to its compressed settings' length", () => {
    const file = fxp("Anything", 300);
    const streamLength = deflateSync(Buffer.from("settings of Anything".repeat(20))).length;
    expect(serum1Hash(file)).toBe(createHash("md5").update(file.subarray(0, streamLength)).digest("hex"));
    expect(() => serum1Hash(Buffer.from("not a preset at all, not even close to one".repeat(3)))).toThrow(/not a Serum 1 preset/);
  });

  it("lists both kinds, with what Serum's index says of them, skipping what isn't a preset", async () => {
    const list = await library.list();
    expect(list.map((p) => p.name).sort()).toEqual(["KY - Dream Keys", "MO_SHINJU_LD_Wex"]);
    expect(list.find((p) => p.kind === "serum2")).toMatchObject({
      name: "KY - Dream Keys",
      author: "Level 8",
      tags: ["Poly", "Sample"],
      category: "Keys",
      folder: "Factory/Keyboard",
      rating: 0,
    });
    expect(list.find((p) => p.kind === "serum1")).toMatchObject({
      name: "MO_SHINJU_LD_Wex",
      author: "@shinju_09",
      description: "A plain lead",
      tags: ["Mono"],
      category: "Lead",
      folder: "Starred",
    });
  });

  it("reads and writes Serum's own ratings", async () => {
    const [wex] = (await library.list()).filter((p) => p.kind === "serum1");
    await library.setRating(wex.hash, 4);
    expect((await library.list()).find((p) => p.hash === wex.hash)?.rating).toBe(4);
    const db = new DatabaseSync(path.join(dir, "System", "presets.db"), { readOnly: true });
    expect(db.prepare("SELECT rating FROM UserData WHERE hash = ?").get(wex.hash)).toEqual({ rating: 4 });
    db.close();
    await library.setRating(wex.hash, 0);
    expect((await library.list()).find((p) => p.hash === wex.hash)?.rating).toBe(0);
    await expect(library.setRating(wex.hash, 6)).rejects.toThrow(/0 to 5/);
    await expect(library.setRating("../../etc", 3)).rejects.toThrow(/hash/);
  });

  it("reads a changed file again, and forgets a removed one", async () => {
    await library.list();
    const file = path.join(dir, "Presets", "Factory", "Keyboard", "KY - Dream Keys.SerumPreset");
    await fs.writeFile(file, Buffer.from(writeSerumPreset({ name: "KY - Dream Keys 2" } as never)));
    await fs.utimes(file, new Date(), new Date(Date.now() + 5000));
    expect((await library.list()).find((p) => p.kind === "serum2")?.hash).not.toBe(JSON.parse(keys.subarray(17, 17 + Number(keys.readBigUInt64LE(9))).toString()).hash);
    await fs.rm(file);
    expect((await library.list()).map((p) => p.name)).toEqual(["MO_SHINJU_LD_Wex"]);
  });

  it("only hands out its own preset files", async () => {
    const inside = path.join(dir, "Presets", "Starred", "MO_SHINJU_LD_Wex.fxp");
    expect(await library.resolve(inside)).toBe(inside);
    await expect(library.resolve(path.join(dir, "Presets", "Starred", "notes.txt"))).rejects.toThrow(/isn't a preset/);
    await expect(library.resolve(path.join(dir, "Presets", "..", "System", "presets.db"))).rejects.toThrow(/isn't a preset/);
    await expect(library.resolve("/etc/passwd")).rejects.toThrow(/isn't a preset/);
    await expect(library.resolve("relative.fxp")).rejects.toThrow(/path/);
    await expect(library.resolve(path.join(dir, "Presets", "Starred", "gone.fxp"))).rejects.toThrow(/isn't there/);
  });
});
