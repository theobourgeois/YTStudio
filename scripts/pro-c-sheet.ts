/**
 * Pro-C's sound, measured: every style through the real audio engine (offline), drawn as a sheet of
 * three charts: its static curve (a steady sine's level in → out), its gain over a phrase (how it grabs
 * and lets go), and the harmonics it adds at about 10 dB of reduction (its colour).
 *
 *   pnpm tsx scripts/pro-c-sheet.ts [--out pro-c-sheet.png] [style ...]
 *
 * Needs the engine built (`pnpm engine:build`) and Chromium (Playwright's).
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { addChannels, setSteps } from "../shared/music/edits.ts";
import { setEffect } from "../shared/music/mixer.ts";
import { type ProCPatch, updateProC } from "../shared/music/pro-c.ts";
import { PRO_C_PLUGIN, PRO_C_STYLE_INFO, isVintage } from "../shared/music/pro-c-presets.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../shared/music/project.ts";
import { type MusicProject, PRO_C_STYLES, type ProCStyle } from "../shared/music/types.ts";
import { ENGINE } from "../server/config.ts";
import { AudioEngine } from "../server/music/engine.ts";
import { readWav, writeWavChannels } from "../server/music/wav.ts";
import { DataPaths } from "../server/storage.ts";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = path.resolve(outIndex >= 0 ? args[outIndex + 1] : "pro-c-sheet.png");
const names = outIndex >= 0 ? args.filter((_, i) => i !== outIndex && i !== outIndex + 1) : args;
const styles = (names.length ? PRO_C_STYLES.filter((s) => names.includes(s)) : [...PRO_C_STYLES]) as ProCStyle[];
if (!existsSync(ENGINE)) {
  console.error("The audio engine isn't built: run `pnpm engine:build`.");
  process.exit(1);
}

const RATE = 48_000;
const P = FIRST_PATTERN_ID;
const C = "fx_proc";
const LEVELS = [-50, -45, -40, -35, -30, -25, -20, -15, -10, -5, 0];
const amp = (db: number) => 10 ** (db / 20);
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));
const rms = (x: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};
const sine = (hz: number, parts: [number, number][]) => {
  const total = parts.reduce((n, [, s]) => n + Math.round(s * RATE), 0);
  const x = new Float32Array(total);
  let i = 0;
  for (const [level, seconds] of parts) for (let k = 0; k < Math.round(seconds * RATE); k++, i++) x[i] = amp(level) * Math.sin((2 * Math.PI * hz * i) / RATE);
  return x;
};

/** Each style at the same knobs (as near as its unit allows): -30 dB, 4:1, 10 ms, 100 ms, nothing added. */
const settings = (style: ProCStyle, patch: ProCPatch = {}): ProCPatch => ({
  style,
  threshold: style === "vox" ? -20 : style === "opto2a" ? -30 : -30,
  slope: 0.75,
  knee: 6,
  range: 40,
  attack: 0.01,
  release: 0.1,
  autoGain: false,
  autoRelease: false,
  sidechain: { bands: [] },
  options: { link: true },
  ...patch,
});

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pro-c-sheet-"));
const both = (x: Float32Array) => [x, x];
for (const level of LEVELS) await writeWavChannels(path.join(dir, `l${-level}.wav`), both(sine(1000, [[level, 1]])), RATE);
await writeWavChannels(path.join(dir, "phrase.wav"), both(sine(1000, [[-40, 0.5], [-10, 1], [-40, 1.5]])), RATE);
await writeWavChannels(path.join(dir, "low.wav"), both(sine(100, [[-6, 1.6]])), RATE);
const engine = new AudioEngine(new DataPaths(dir), { offline: true, onlyPluginPaths: true, pluginPaths: [], samplePath: (_p, id) => path.join(dir, `${id}.wav`) });
let n = 0;
async function play(sample: string, patch: ProCPatch, seconds: number) {
  let s: MusicProject = addChannels(createMusicProject("Sheet", 120), [{ id: "chan_sig", name: "Signal", sampleId: sample }]);
  s = setSteps(s, P, "chan_sig", [0], true);
  s = { ...s, patterns: s.patterns.map((p) => (p.id === P ? { ...p, length: 16 * 384 } : p)) };
  s = setEffect(s, MASTER_TRACK_ID, 0, PRO_C_PLUGIN, C);
  s = updateProC(s, C, patch);
  await engine.command("stop", {});
  await engine.setSong({ projectId: "proj_0123456789ab", song: createMusicProject("Silence", 120), patternId: P, mode: "pattern" });
  await engine.render(RATE / 10, path.join(dir, `x${n++}.wav`));
  await engine.setSong({ projectId: "proj_0123456789ab", song: s, patternId: P, mode: "pattern" });
  await engine.command("play", {});
  const file = path.join(dir, `r${n++}.wav`);
  await engine.render(Math.round(seconds * RATE), file);
  return (await readWav(file)).channels[0];
}

interface Row {
  style: ProCStyle;
  curve: [number, number][];
  gain: [number, number][];
  thd: number;
}
const rows: Row[] = [];
try {
  for (const style of styles) {
    const curve: [number, number][] = [];
    for (const level of LEVELS) {
      const y = await play(`l${-level}`, settings(style), 1);
      curve.push([level, db(rms(y, RATE / 2, RATE * 0.9) * Math.SQRT2)]);
    }
    const phrase = await play("phrase", settings(style), 3);
    const gain: [number, number][] = [];
    const window = RATE / 200;
    for (let i = 0; i + window <= phrase.length; i += window) {
      const t = i / RATE;
      const level = t >= 0.5 && t < 1.5 ? -10 : -40;
      gain.push([t, db(rms(phrase, i, i + window) * Math.SQRT2) - level]);
    }
    // Its colour: a 100 Hz sine at -6 dB about 10 dB into compression; the harmonics' share of the fundamental.
    const low = await play("low", settings(style, { threshold: style === "vox" ? -16 : -20, attack: 0.01, release: 0.2 }), 1.6);
    const from = Math.round(0.5 * RATE), to = from + RATE;
    const at = (hz: number) => {
      let re = 0, im = 0;
      for (let i = from; i < to; i++) {
        const w = (2 * Math.PI * hz * i) / RATE;
        re += low[i] * Math.cos(w);
        im += low[i] * Math.sin(w);
      }
      return Math.hypot(re, im);
    };
    const fundamental = at(100);
    let harmonics = 0;
    for (let k = 2; k <= 12; k++) harmonics += at(100 * k) ** 2;
    rows.push({ style, curve, gain, thd: (100 * Math.sqrt(harmonics)) / fundamental });
    console.log(`${PRO_C_STYLE_INFO[style].name}: ${rows.at(-1)!.thd.toFixed(3)}% THD`);
  }
} finally {
  engine.shutdown();
}

// The sheet: small multiples (one series each: its title names it), then the colour as one bar chart.
const W = 210, H = 150, PAD = { l: 34, r: 8, t: 22, b: 24 };
const x = (v: number, lo: number, hi: number) => PAD.l + ((v - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
const y = (v: number, lo: number, hi: number) => H - PAD.b - ((v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
const path2 = (points: [number, number][], xs: [number, number], ys: [number, number]) =>
  points.map(([a, b], i) => `${i ? "L" : "M"}${x(a, ...xs).toFixed(1)},${y(Math.max(ys[0], Math.min(ys[1], b)), ...ys).toFixed(1)}`).join("");
const name = (s: ProCStyle) => `${PRO_C_STYLE_INFO[s].name}${isVintage(s) ? " ·V" : ""}`;
function small(title: string, body: string, xs: [number, number], ys: [number, number], xTicks: number[], yTicks: number[], xLabel: (v: number) => string) {
  const grid = yTicks.map((t) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(t, ...ys)}" y2="${y(t, ...ys)}" class="grid"/><text x="${PAD.l - 4}" y="${y(t, ...ys) + 3}" class="tick" text-anchor="end">${t}</text>`).join("");
  const xt = xTicks.map((t) => `<text x="${x(t, ...xs)}" y="${H - PAD.b + 13}" class="tick" text-anchor="middle">${xLabel(t)}</text>`).join("");
  return `<svg width="${W}" height="${H}"><text x="${PAD.l}" y="14" class="title">${title}</text>${grid}${xt}${body}</svg>`;
}
const curves = rows
  .map((r) =>
    small(
      name(r.style),
      `<path d="${path2([[-50, -50], [0, 0]], [-50, 0], [-50, 6])}" class="ref"/><path d="${path2(r.curve, [-50, 0], [-50, 6])}" class="line"/>`,
      [-50, 0],
      [-50, 6],
      [-50, -30, -10],
      [-40, -20, 0],
      (v) => `${v}`,
    ),
  )
  .join("");
const gains = rows
  .map((r) =>
    small(
      name(r.style),
      `<rect x="${x(0.5, 0, 3)}" y="${PAD.t}" width="${x(1.5, 0, 3) - x(0.5, 0, 3)}" height="${H - PAD.t - PAD.b}" class="phrase"/><path d="${path2(r.gain, [0, 3], [-24, 6])}" class="line"/>`,
      [0, 3],
      [-24, 6],
      [0, 1, 2, 3],
      [-20, -10, 0],
      (v) => `${v}s`,
    ),
  )
  .join("");
const sorted = [...rows].sort((a, b) => b.thd - a.thd);
const most = Math.max(...sorted.map((r) => r.thd), 0.01);
const barW = 560, rowH = 18;
const bars = sorted
  .map((r, i) => {
    const w = Math.max(2, (r.thd / most) * (barW - 160));
    return `<text x="120" y="${i * rowH + 13}" class="label" text-anchor="end">${name(r.style)}</text><rect x="128" y="${i * rowH + 3}" width="${w}" height="${rowH - 6}" rx="3" class="bar"/><text x="${132 + w}" y="${i * rowH + 13}" class="value">${r.thd < 0.1 ? r.thd.toFixed(3) : r.thd.toFixed(2)}%</text>`;
  })
  .join("");
const html = `<!doctype html><html><head><style>
  body { margin: 0; padding: 20px; background: #fcfcfb; font: 12px "DM Sans", -apple-system, sans-serif; color: #0b0b0b; width: 1520px; }
  h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 22px 0 2px; } p { margin: 0 0 8px; color: #52514e; }
  .grid-wrap { display: grid; grid-template-columns: repeat(7, ${W}px); gap: 6px; }
  .title { font-weight: 600; font-size: 11px; fill: #0b0b0b; } .tick { font-size: 9px; fill: #8a8984; }
  .grid { stroke: #e7e6e1; stroke-width: 1; } .ref { stroke: #c3c2b7; stroke-width: 1; stroke-dasharray: 3 3; fill: none; }
  .line { stroke: #2a78d6; stroke-width: 2; fill: none; stroke-linejoin: round; } .phrase { fill: #2a78d6; opacity: 0.07; }
  .bar { fill: #2a78d6; } .label { font-size: 11px; fill: #0b0b0b; } .value { font-size: 11px; fill: #52514e; }
</style></head><body>
<h1>Pro-C: how each style sounds, measured on the engine</h1>
<p>Every style at the same knobs (threshold −30 dB, 4:1, attack 10 ms, release 100 ms, no make-up; a Vintage style ·V at its unit's nearest settings, Input 30). A 1 kHz sine unless said.</p>
<h2>Static curve: level in → level out (dB). Dashed: untouched.</h2><p>How hard it holds a steady level: the knee's shape, the ratio, and where each unit's threshold sits.</p>
<div class="grid-wrap">${curves}</div>
<h2>Gain over a phrase (dB): −40 dB, then −10 dB for a second (shaded), then −40 dB</h2><p>How it grabs and lets go: the opto styles' slow tail and memory, Nuke's two slopes, dbx's straight line, Pumping's swell.</p>
<div class="grid-wrap">${gains}</div>
<h2>Its colour: harmonics added to a 100 Hz sine at −6 dB, about 10 dB into compression (THD, %)</h2><p>Clean styles add almost nothing; the Vintage units, Vari-Mu and Op-El add their circuits' colour (a fast gain on a low note adds some too).</p>
<svg width="${barW + 80}" height="${sorted.length * rowH + 6}">${bars}</svg>
</body></html>`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.screenshot({ path: out, fullPage: true });
  console.log(`Wrote ${out}`);
} finally {
  await browser.close();
  await fs.rm(dir, { recursive: true, force: true });
}
