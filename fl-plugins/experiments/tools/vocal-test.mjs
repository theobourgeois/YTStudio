// song3's vocal stems render silent: writes vocal-only variants with the vocal inserts' plugins switched off, all or one slot at a time.
import fs from "node:fs";
import { stems, writeVariant } from "./plan.mjs";
const s = stems("song3/song3.flp");
const vocal = s.list.filter(x => x.insert >= 16 && x.insert <= 21);
const keep = new Set(vocal.flatMap(x => x.chans.map(c => c.idx)));
fs.mkdirSync("test/jv", { recursive: true });
function variant(out, off) {
  writeVariant(s.flp, s.ins, s.playable, keep, out, { masterFx: false, masterVol: 6400 });
  const buf = fs.readFileSync(out); const e = s.flp.events.find(e => e.id === 225);
  for (let o = e.dataAt; o < e.dataAt + e.len; o += 12) {
    const cd = buf.readUInt16LE(o + 6); const insert = (cd - 0x7000) >> 6, slot = cd & 0x3f;
    if (buf[o + 4] === 0 && insert >= 16 && insert <= 21 && off(slot)) buf.writeInt32LE(0, o + 8);
  }
  fs.writeFileSync(out, buf);
}
variant("test/jv/none.flp", () => false);
variant("test/jv/allOff.flp", () => true);
for (let k = 0; k <= 8; k++) variant(`test/jv/off${k}.flp`, slot => slot === k);
console.log("written");
