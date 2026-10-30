import { readFlp, u, text } from "./flp.mjs";
const { buf, events } = readFlp(process.argv[2]);
const counts = {}; for (const e of events) counts[e.id] = (counts[e.id] || 0) + 1;
console.log("events", events.length, "flags(236)", counts[236], "routing(235)", counts[235], "output(147)", counts[147], "names(204)", counts[204], "params(225)", counts[225]);
// Show the event id sequence around the first few 236 events
const idx = events.findIndex(e => e.id === 236);
console.log("seq from first 236:", events.slice(idx - 3, idx + 40).map(e => e.id + (e.len > 4 ? `(${e.len})` : "")).join(" "));
