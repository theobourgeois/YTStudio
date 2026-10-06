/**
 * Reads Photoshop's contour presets (`.shc`, "8BFS") into JSON: each contour's name and its points as
 * [input, output, corner] on 0..255. Used for docs/photo/layer-style (dialog.md, "Contours").
 *
 *   pnpm tsx scripts/photoshop-probes/contours.ts [file.shc ...]
 */
import { readFileSync } from "node:fs";

const DEFAULT_FILES = [
  "/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app/Contents/Required/Default Contours.shc",
  "/Applications/Adobe Photoshop 2026/Presets/Contours/Contours.shc",
];

export interface ContourPreset {
  name: string;
  points: [number, number, boolean][];
}

/**
 * Each entry: a u32 string length, a UTF-16 name ending in 0, a u16 (always 2), a u16 count, count × (u16 output,
 * u16 input), then a byte per point: 1 for a smooth point, 0 for a corner (Photoshop's "continuity"; measured with a glow).
 */
export function parseShc(buf: Buffer): ContourPreset[] {
  const out: ContourPreset[] = [];
  const marker = Buffer.from("$$$/", "utf16le").swap16();
  let at = buf.indexOf(marker);
  while (at >= 0) {
    const length = buf.readUInt32BE(at - 4);
    const raw = buf.subarray(at, at + length * 2);
    const name = Buffer.from(raw).swap16().toString("utf16le").replace(/\0+$/, "");
    let p = at + length * 2 + 2;
    const count = buf.readUInt16BE(p);
    p += 2;
    const points: [number, number, boolean][] = [];
    for (let i = 0; i < count; i++) points.push([buf.readUInt16BE(p + i * 4 + 2), buf.readUInt16BE(p + i * 4), false]);
    p += count * 4;
    for (let i = 0; i < count; i++) points[i][2] = buf[p + i] === 0;
    out.push({ name: name.split("=").pop()!, points });
    at = buf.indexOf(marker, p);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_FILES;
  for (const f of files) console.log(JSON.stringify({ file: f, contours: parseShc(readFileSync(f)) }, null, 1));
}
