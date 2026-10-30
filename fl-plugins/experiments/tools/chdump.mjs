import { readFlp, u, text } from "./flp.mjs";
const { buf, events } = readFlp(process.argv[2]);
const want = Number(process.argv[3]);
let on = false;
for (const e of events) {
  if (e.id === 236) break;
  if (e.id === 64) on = u(buf, e) === want;
  if (on && e.len <= 4) process.stdout.write(`${e.id}=${u(buf, e) | 0} `);
  else if (on) process.stdout.write(`${e.id}(${e.len}) `);
}
console.log();
