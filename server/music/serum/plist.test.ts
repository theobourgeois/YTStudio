import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type PlistDict, PlistReal, readPlist, writePlist } from "./plist.ts";

/** An Audio Unit's ClassInfo as Serum 2 gives it: Xfer containers as data, its own keys around them. */
const classInfo = (): PlistDict =>
  new Map<string, never>([
    ["Controller State", new Uint8Array([0x58, 0x66, 1, 2, 3]) as never],
    ["data", new Uint8Array(300).fill(7) as never],
    ["element-name", new Map([["2", new Map([["0", "Audio Output"]])]]) as never],
    ["manufacturer", 1481000274 as never],
    ["name", "ld - hendrix" as never],
    ["Processor State", new Uint8Array([0x58, 0x66, 9]) as never],
    ["subtype", 1483092568 as never],
    ["type", 1635085685 as never],
    ["version", 0 as never],
  ]);

describe("binary property lists", () => {
  it("read back what they wrote: the dictionary's order (numeric keys too), integers, reals, data, text", () => {
    const value = classInfo();
    value.set("gain", new PlistReal(0.5));
    value.set("list", [true, false, null, -3, 2 ** 40, "é ü"] as never);
    const back = readPlist(writePlist(value)) as PlistDict;
    expect([...back.keys()]).toEqual([...value.keys()]);
    expect(back.get("element-name")).toEqual(new Map([["2", new Map([["0", "Audio Output"]])]]));
    expect(back.get("gain")).toEqual(new PlistReal(0.5));
    expect(back.get("version")).toBe(0);
    expect(back.get("data")).toEqual(new Uint8Array(300).fill(7));
    expect(back.get("list")).toEqual([true, false, null, -3, 2 ** 40, "é ü"]);
  });

  it("refuses what isn't one, and a damaged one", () => {
    expect(() => readPlist(new Uint8Array(64))).toThrow(/bplist00/);
    const bytes = writePlist(classInfo());
    bytes[bytes.length - 26] = 9;
    expect(() => readPlist(bytes)).toThrow();
  });

  it.skipIf(process.platform !== "darwin")("are Apple's own: plutil reads ours, and we read plutil's", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plist-"));
    try {
      const ours = path.join(dir, "ours.plist");
      await fs.writeFile(ours, writePlist(classInfo()));
      execFileSync("plutil", ["-lint", ours]);
      expect(execFileSync("plutil", ["-extract", "name", "raw", "-o", "-", ours]).toString().trim()).toBe("ld - hendrix");
      expect(execFileSync("plutil", ["-extract", "element-name.2.0", "raw", "-o", "-", ours]).toString().trim()).toBe("Audio Output");
      // Apple's: from XML, made binary by plutil.
      const theirs = path.join(dir, "theirs.plist");
      await fs.writeFile(
        theirs,
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>name</key><string>Ünïcode</string><key>data</key><data>AQID</data><key>n</key><integer>70000</integer><key>r</key><real>1.25</real></dict></plist>`,
      );
      execFileSync("plutil", ["-convert", "binary1", theirs]);
      const read = readPlist(new Uint8Array(await fs.readFile(theirs))) as PlistDict;
      expect(read.get("name")).toBe("Ünïcode");
      expect(read.get("data")).toEqual(new Uint8Array([1, 2, 3]));
      expect(read.get("n")).toBe(70000);
      expect(read.get("r")).toEqual(new PlistReal(1.25));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
