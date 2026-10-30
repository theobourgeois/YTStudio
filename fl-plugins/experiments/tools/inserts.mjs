import { readFlp, u, text } from "./flp.mjs";
export function inserts(path) {
  const flp = readFlp(path); const { buf, events } = flp;
  const first236 = events.findIndex(e => e.id === 236);
  const list = []; let cur = null;
  for (let k = first236 - 1; k < events.length; k++) {
    const e = events[k];
    if (e.id === 236) { cur = { flagsEv: e, flags: buf.readUInt32LE(e.dataAt + 4), slots: [], other: [] }; list.push(cur); continue; }
    if (!cur) continue;
    if (e.id === 235) cur.routing = [...buf.subarray(e.dataAt, e.dataAt + e.len)];
    else if (e.id === 204) cur.name = text(buf, e);
    else if (e.id === 154) cur.input = u(buf, e) | 0;
    else if (e.id === 147) cur.output = u(buf, e) | 0;
    else if (e.id === 98) cur.slots.push(u(buf, e));
    else cur.other.push(e.id + (e.len > 4 ? `(${e.len})` : `=${u(buf, e)}`));
  }
  return { flp, list };
}
if (process.argv[2]) {
  const { list } = inserts(process.argv[2]);
  list.forEach((ins, i) => {
    const routes = (ins.routing || []).map((v, j) => v ? j : null).filter(v => v !== null);
    console.log(`#${i} flags=0x${ins.flags.toString(16)} name=${ins.name ?? "-"} routesTo=[${routes}] out=${ins.output} other=${ins.other.join(",").slice(0, 160)}`);
  });
}
