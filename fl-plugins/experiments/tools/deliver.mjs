// Copies each song's non-silent stems, premaster and mixdown into iCloud Drive's "Mixing test" folder, with a note on levels.
import fs from "node:fs";
import path from "node:path";
const dest = "C:/Users/goali/iCloudDrive/Mixing test";
const silent = file => { const b = fs.readFileSync(file); let o = 12; while (b.toString("latin1", o, o + 4) !== "data") o += 8 + b.readUInt32LE(o + 4);
  const end = o + 8 + b.readUInt32LE(o + 4); for (let i = o + 8; i < end; i += 2) if (Math.abs(b.readInt16LE(i)) > 3) return false; return true; };
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const report = [];
for (const song of ["song1", "song2", "song3", "song4"]) {
  const srcs = song === "song3" ? ["out/song3", "out/song3-vocals"] : [`out/${song}`]; const main = srcs.at(-1);
  const stems = new Map();
  for (const src of srcs) for (const f of fs.readdirSync(`${src}/stems`).filter(f => f.endsWith(".wav"))) stems.set(f, `${src}/stems/${f}`);
  let kept = 0, dropped = [];
  for (const [f, file] of [...stems].sort()) { if (silent(file)) { dropped.push(f); continue; } copy(file, `${dest}/${song}/stems/${f}`); kept++; }
  copy(`${main}/premaster.wav`, `${dest}/${song}/${song} - premaster.wav`);
  copy(`${main}/mixdown.wav`, `${dest}/${song}/${song} - mixdown.wav`);
  if (song === "song3") copy("out/song3/mixdown.wav", `${dest}/${song}/${song} - mixdown (vocals muted, as saved).wav`);
  report.push(`${song}: ${kept} stems${dropped.length ? `, dropped silent ${dropped.join(", ")}` : ""}`);
}
fs.writeFileSync(`${dest}/README.txt`, `Rendered from the FLPs in Music\\Flps with FL Studio's command line (16-bit, 44.1 kHz WAV).

<song>/stems/          one WAV per mixer insert (song2: per channel, everything goes straight to its master), insert effects on,
                       master effects off, master fader at 50% (-12.67 dB) so nothing clips. Together they add up to the premaster.
<song> - premaster.wav  every channel, master effects off, same -12.67 dB: the mix before the master chain.
<song> - mixdown.wav    as the project plays: master chain on, fader at 100% (song2 has no master chain, so it clips at 0 dBFS).

song3: the vocal playlist tracks are muted in the saved project; the stems, premaster and mixdown here have them unmuted,
and "song3 - mixdown (vocals muted, as saved).wav" is the project as saved.
song4: muted playlist tracks 20-21 (alternate vocal takes) stay muted.

${report.join("\n")}
`);
console.log(report.join("\n"));
