// Minimal FLP event reader/writer (format as documented by PyFLP).
import fs from "node:fs";
export function readFlp(path) {
  const buf = fs.readFileSync(path);
  if (buf.toString("latin1", 0, 4) !== "FLhd") throw new Error("not an FLP");
  const hdrLen = buf.readUInt32LE(4);
  const dt = 8 + hdrLen;
  if (buf.toString("latin1", dt, dt + 4) !== "FLdt") throw new Error("no FLdt");
  const end = dt + 8 + buf.readUInt32LE(dt + 4);
  const events = [];
  let i = dt + 8;
  while (i < end) {
    const at = i, id = buf[i++];
    let len;
    if (id < 64) len = 1; else if (id < 128) len = 2; else if (id < 192) len = 4;
    else { len = 0; let shift = 0, b; do { b = buf[i++]; len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80); }
    events.push({ id, at, dataAt: i, len });
    i += len;
  }
  return { buf, events };
}
export const u = (buf, e) => e.len === 1 ? buf[e.dataAt] : e.len === 2 ? buf.readUInt16LE(e.dataAt) : buf.readUInt32LE(e.dataAt);
export const text = (buf, e) => buf.toString("utf16le", e.dataAt, e.dataAt + e.len).replace(/\0+$/, "");
