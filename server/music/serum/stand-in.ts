/**
 * A small Serum library of made-up presets, laid out as Serum 2's is (`Presets`, and `System/presets.db` with
 * Serum's schema), for the e2e tests (`EDITOR_SERUM_LIBRARY=stand-in`) and the library's own: nothing of Xfer's.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateSync } from "node:zlib";
import type { SerumLibraryPlaces } from "./library.ts";
import { writeSerumPreset } from "./preset.ts";

/** A Serum 1 preset as Serum 1 lays one out: the VST2 program-chunk header, a zlib stream, then more (embedded data). */
export function standInSerum1Preset(name: string, trailing = 40): Buffer {
  const stream = deflateSync(Buffer.from(`settings of ${name}`.repeat(20)));
  const chunk = Buffer.concat([stream, Buffer.alloc(trailing, 7)]);
  const head = Buffer.alloc(60);
  head.write("CcnK", 0, "latin1");
  head.writeUInt32BE(52 + chunk.length, 4);
  head.write("FPCh", 8, "latin1");
  head.writeUInt32BE(1, 12);
  head.write("XfsX", 16, "latin1");
  head.writeUInt32BE(1, 20);
  head.writeUInt32BE(1, 24);
  head.write(name.slice(0, 27), 28, "latin1");
  head.writeUInt32BE(chunk.length, 56);
  return Buffer.concat([head, chunk]);
}

/** Serum 2's index's schema, as Serum makes it. */
export const SERUM_INDEX_SCHEMA = `CREATE TABLE IF NOT EXISTS Locations ( location_id INTEGER PRIMARY KEY NOT NULL, location TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS Presets ( preset_id INTEGER PRIMARY KEY NOT NULL, comment TEXT, date_added INTEGER NOT NULL, date_modified INTEGER NOT NULL, author TEXT NOT NULL, category TEXT, description TEXT, file_ext TEXT, hash TEXT, location_id INTEGER NOT NULL REFERENCES Locations, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS Presets_Tags( preset_id INTEGER NOT NULL REFERENCES Presets ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES Tags, PRIMARY KEY (preset_id, tag_id));
CREATE TABLE IF NOT EXISTS Tags( tag_id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS UserData ( hash TEXT NOT NULL UNIQUE, rating INTEGER);`;

/** The stand-in library in `dir` (made once, kept: its ratings are a test's to change). */
export async function standInSerumLibrary(dir: string): Promise<SerumLibraryPlaces> {
  const presets = path.join(dir, "Presets");
  if (await fs.stat(presets).then(() => true, () => false)) return { serum2: dir, serum1: null };
  const write = async (folder: string, file: string, bytes: Uint8Array) => {
    await fs.mkdir(path.join(presets, folder), { recursive: true });
    await fs.writeFile(path.join(presets, folder, file), bytes);
  };
  await write("Factory/Bass", "BA - Stand-in Reese.SerumPreset", writeSerumPreset({ name: "BA - Stand-in Reese", author: "Stand-in", tags: ["Mono"], macros: { "1": { name: "GRIT", value: 0 } } } as never));
  await write("Factory/Lead", "LD - Stand-in Lead.SerumPreset", writeSerumPreset({ name: "LD - Stand-in Lead", author: "Stand-in", macros: { "1": { name: "SPACE", value: 0 } } } as never));
  await write("Factory/Pad", "PD - Stand-in Pad.SerumPreset", writeSerumPreset({ name: "PD - Stand-in Pad", author: "Somebody Else", tags: ["Granular"] } as never));
  await write("Starred", "pl - stand-in pluck.fxp", standInSerum1Preset("pl - stand-in pluck"));
  await fs.mkdir(path.join(dir, "System"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "System", "presets.db"));
  try {
    db.exec(SERUM_INDEX_SCHEMA);
  } finally {
    db.close();
  }
  return { serum2: dir, serum1: null };
}
