import { readFlp, u, text } from "./flp.mjs";
const { buf, events } = readFlp(process.argv[2]);
// Insert section: from first 236's preceding events; an insert ends at 147 (output). Plugin names (203 / 201) appear inside, before the slot's 98 index.
const first = events.findIndex(e => e.id === 236);
let k = first; while (k > 0 && ![147, 225].includes(events[k - 1].id) && events[k-1].id !== 64) k--; // back up to group start
let ins = 0, cur = { fx: [], name: null }; const out = [];
let lastPlug = null;
for (let i = first - 3; i < events.length; i++) {
  const e = events[i];
  if (e.id === 204) cur.name = text(buf, e);
  if (e.id === 201) lastPlug = text(buf, e);
  if (e.id === 203) lastPlug = text(buf, e) || lastPlug;
  if (e.id === 98 && lastPlug) { cur.fx.push(`${u(buf, e)}:${lastPlug}`); lastPlug = null; }
  if (e.id === 235) cur.routing = [...buf.subarray(e.dataAt, e.dataAt + e.len)].map((v, j) => v ? j : null).filter(v => v !== null);
  if (e.id === 236) cur.flags = buf.readUInt32LE(e.dataAt + 4);
  if (e.id === 147) { out.push({ ins, ...cur }); ins++; cur = { fx: [], name: null }; }
}
for (const o of out) if (o.fx.length || o.name || (o.routing && o.routing.length)) console.log(`#${o.ins} ${o.name ?? ""} flags=0x${(o.flags??0).toString(16)} -> [${o.routing}] fx: ${o.fx.join(", ")}`);
