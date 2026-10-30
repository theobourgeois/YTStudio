// Works out a song's stems and writes one FLP per stem: every other channel switched off, master effects off.
import fs from "node:fs";
import path from "node:path";
import { readFlp, u, text } from "./flp.mjs";
const PLAYABLE = new Set([0, 2, 4]); // sampler, generator, audio clip (never automation or layers)
export function channels(flp) {
  const { buf, events } = flp; const out = []; let ch = null;
  for (const e of events) {
    if (e.id === 236) break;
    if (e.id === 64) { ch = { idx: u(buf, e) }; out.push(ch); }
    else if (!ch) continue;
    else if (e.id === 21) ch.type = u(buf, e);
    else if (e.id === 203) ch.name = text(buf, e);
    else if (e.id === 104) ch.insert = u(buf, e);
    else if (e.id === 0 && ch.enabledEv === undefined) ch.enabledEv = e;
  }
  return out;
}
export function insertInfo(flp) {
  const { buf, events } = flp; const out = []; let cur = {};
  for (const e of events) {
    if (e.id === 204 && out.length + 0 >= 0 && events.indexOf) cur.name = text(buf, e);
    if (e.id === 236) cur.flagsEv = e;
    if (e.id === 147 && cur.flagsEv) { out.push(cur); cur = {}; }
  }
  return out;
}
const safe = s => s.replace(/\[.*?\]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "stem";
export function stems(file) {
  const flp = readFlp(file); const chans = channels(flp); const ins = insertInfo(flp);
  const playable = chans.filter(c => PLAYABLE.has(c.type) && c.enabledEv && c.enabledEv.dataAt && flp.buf[c.enabledEv.dataAt] === 1);
  const groups = new Map();
  for (const c of playable) {
    const key = (c.insert ?? 0) === 0 ? `ch${c.idx}` : `ins${c.insert}`;
    if (!groups.has(key)) groups.set(key, { key, insert: c.insert ?? 0, chans: [] });
    groups.get(key).chans.push(c);
  }
  const list = [...groups.values()].map(g => {
    const label = g.insert === 0 ? g.chans[0].name : (ins[g.insert]?.name || g.chans[0].name);
    return { ...g, name: `${String(g.insert).padStart(2, "0")}_${safe(label)}${g.insert === 0 ? "_c" + g.chans[0].idx : ""}` };
  });
  return { flp, chans, playable, ins, list };
}
// Mixer params (event 225): 12-byte records [4 zero][id][?][u16 channel data][i32 value]; insert = (cd - 0x7000) >> 6,
// slot = cd & 0x3f. id 0 = slot enabled, 192 = insert volume (12800 = 0 dB).
function mixerParams(flp, fn) {
  const e = flp.events.find(e => e.id === 225); const buf = flp.buf;
  for (let o = e.dataAt; o < e.dataAt + e.len; o += 12) {
    const cd = buf.readUInt16LE(o + 6);
    fn({ at: o, id: buf[o + 4], insert: (cd - 0x7000) >> 6, slot: cd & 0x3f, value: buf.readInt32LE(o + 8) });
  }
}
export function writeVariant(flp, ins, playable, keep, out, { masterFx, masterVol = 12800 }) {
  const buf = Buffer.from(flp.buf);
  mixerParams(flp, p => {
    if (p.insert !== 0) return;
    if (p.id === 0) buf.writeInt32LE(masterFx ? 1 : 0, p.at + 8);
    if (p.id === 192) buf.writeInt32LE(masterVol, p.at + 8);
  });
  for (const c of playable) buf[c.enabledEv.dataAt] = keep.has(c.idx) ? 1 : 0;
  const m = ins[0].flagsEv.dataAt + 4; let f = buf.readUInt32LE(m);
  f = masterFx ? (f | 4) : (f & ~4); buf.writeUInt32LE(f >>> 0, m);
  fs.writeFileSync(out, buf);
}
if (process.argv[1]?.endsWith("plan.mjs") && process.argv[2]) {
  const { list, playable, chans } = stems(process.argv[2]);
  console.log(`${chans.length} channels, ${playable.length} playable, ${list.length} stems`);
  for (const s of list) console.log(`  ${s.name}  <- ${s.chans.map(c => c.name).slice(0, 4).join(" | ")}${s.chans.length > 4 ? ` (+${s.chans.length - 4})` : ""}`);
}
