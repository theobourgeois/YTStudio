// Writes every song's stem FLPs (limiter off, master fader 50%: −12.67 dB) plus its premaster and mixdown into out/<song>/.
import fs from "node:fs";
import path from "node:path";
import { stems, writeVariant } from "./plan.mjs";
const songs = ["song1", "song2", "song3", "song4"]; const jobs = [];
for (const song of songs) {
  const s = stems(`${song}/${song}.flp`); const dir = `out/${song}`;
  fs.mkdirSync(`${dir}/stems`, { recursive: true });
  const all = new Set(s.playable.map(c => c.idx));
  writeVariant(s.flp, s.ins, s.playable, all, `${dir}/mixdown.flp`, { masterFx: true, masterVol: 12800 }); jobs.push(`${dir}/mixdown.flp`);
  writeVariant(s.flp, s.ins, s.playable, all, `${dir}/premaster.flp`, { masterFx: false, masterVol: 6400 }); jobs.push(`${dir}/premaster.flp`);
  for (const st of s.list) {
    const f = `${dir}/stems/${st.name}.flp`;
    writeVariant(s.flp, s.ins, s.playable, new Set(st.chans.map(c => c.idx)), f, { masterFx: false, masterVol: 6400 }); jobs.push(f);
  }
  console.log(song, s.list.length, "stems");
}
fs.writeFileSync("out/jobs.txt", jobs.map(j => path.resolve(j)).join("\n") + "\n");
console.log(jobs.length, "renders");
