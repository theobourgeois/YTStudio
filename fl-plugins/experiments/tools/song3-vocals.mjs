// song3's vocal playlist tracks (11–16) are muted in the project: renders its vocal stems, premaster and mixdown with them unmuted.
import fs from "node:fs";
import path from "node:path";
import { stems, writeVariant } from "./plan.mjs";
const s = stems("song3/song3.flp");
const unmute = file => {
  const buf = fs.readFileSync(file);
  for (const e of s.flp.events) if (e.id === 238) { const iid = buf.readUInt32LE(e.dataAt); if (iid >= 11 && iid <= 16) buf[e.dataAt + 12] = 1; }
  fs.writeFileSync(file, buf);
};
const dir = "out/song3-vocals"; fs.mkdirSync(`${dir}/stems`, { recursive: true }); const jobs = [];
const all = new Set(s.playable.map(c => c.idx));
const write = (keep, out, opts) => { writeVariant(s.flp, s.ins, s.playable, keep, out, opts); unmute(out); jobs.push(path.resolve(out)); };
write(all, `${dir}/mixdown.flp`, { masterFx: true, masterVol: 12800 });
write(all, `${dir}/premaster.flp`, { masterFx: false, masterVol: 6400 });
for (const st of s.list.filter(x => x.insert >= 16 && x.insert <= 21)) write(new Set(st.chans.map(c => c.idx)), `${dir}/stems/${st.name}.flp`, { masterFx: false, masterVol: 6400 });
fs.writeFileSync("out/jobs.txt", jobs.join("\n") + "\n");
console.log(jobs.length, "renders");
