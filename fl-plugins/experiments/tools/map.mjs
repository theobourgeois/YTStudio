import { readFlp, u, text } from "./flp.mjs";
const { buf, events } = readFlp(process.argv[2]);
let ch = null; const chans = [];
for (const e of events) {
  if (e.id === 236) break;
  if (e.id === 64) { ch = { idx: u(buf, e) }; chans.push(ch); }
  else if (ch && e.id === 203) ch.name = text(buf, e);
  else if (ch && e.id === 104) ch.insert = u(buf, e) | 0;
}
const by = {}; for (const c of chans) (by[c.insert] ??= []).push(c.name);
for (const k of Object.keys(by).sort((a,b)=>a-b)) console.log(`insert ${k}: ${by[k].join(" | ")}`);
const r = events.filter(e => e.id === 235).map(e => e.len); console.log("routing lens", [...new Set(r)]);
