// Checks a song's renders: each stem's peak and RMS (silent ones flagged), and how the stems' sum compares with the premaster.
import fs from "node:fs";
import path from "node:path";

function pcm(file) {
  const b = fs.readFileSync(file); let o = 12;
  while (b.toString("latin1", o, o + 4) !== "data") o += 8 + b.readUInt32LE(o + 4);
  const n = b.readUInt32LE(o + 4) / 2; const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(o + 8 + i * 2) / 32768;
  return out;
}
const db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity).toFixed(1);
const stats = a => { let p = 0, s = 0; for (const v of a) { const m = Math.abs(v); if (m > p) p = m; s += v * v; } return { peak: p, rms: Math.sqrt(s / a.length) }; };

for (const song of process.argv.slice(2)) {
  const dir = `out/${song}`; const pre = pcm(`${dir}/premaster.wav`); const sum = new Float32Array(pre.length);
  console.log(`== ${song}  premaster peak ${db(stats(pre).peak)} rms ${db(stats(pre).rms)}`);
  for (const f of fs.readdirSync(`${dir}/stems`).filter(f => f.endsWith(".wav")).sort()) {
    const a = pcm(path.join(dir, "stems", f)); const st = stats(a);
    for (let i = 0; i < Math.min(a.length, sum.length); i++) sum[i] += a[i];
    console.log(`  ${f.padEnd(34)} peak ${db(st.peak).padStart(6)}  rms ${db(st.rms).padStart(6)}${a.length !== pre.length ? `  LENGTH ${a.length} vs ${pre.length}` : ""}${st.peak < 1e-4 ? "  SILENT" : ""}`);
  }
  let e = 0, s = 0, ss = 0; for (let i = 0; i < pre.length; i++) { const d = pre[i] - sum[i]; e += d * d; s += pre[i] * pre[i]; ss += sum[i] * sum[i]; }
  console.log(`  sum rms ${db(Math.sqrt(ss / pre.length))} vs premaster ${db(Math.sqrt(s / pre.length))}; residual ${db(Math.sqrt(e / s))} dB`);
}
