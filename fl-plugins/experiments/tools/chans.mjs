import { readFlp, u, text } from "./flp.mjs";
const { buf, events } = readFlp(process.argv[2]);
// channel boundary: event 64 (WORD, new channel index); names are TEXT 192/203
let ch = null; const out = [];
for (const e of events) {
  if (e.id === 236) break;
  if (e.id === 64) { ch = { idx: u(buf, e) }; out.push(ch); continue; }
  if (!ch) continue;
  if (e.id === 21) ch.type = u(buf, e);
  if (e.id === 22) ch.fx = u(buf, e);
  if (e.id === 203 || e.id === 192 || e.id === 201) ch["t" + e.id] = text(buf, e);
}
for (const c of out) console.log(JSON.stringify(c));
