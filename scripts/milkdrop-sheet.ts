/**
 * Every MilkDrop preset of Butterchurn's packs (`MILKDROP_PACKS`), played on songs in headless Chromium on the GPU
 * (never heard: their sound is only fed to Butterchurn), measured and laid out in contact sheets: for picking which
 * become looks, and what each suits (shared/live-milkdrop.ts, docs/now-playing.md step 8).
 *
 *   pnpm tsx scripts/milkdrop-sheet.ts --songs a.mp3,b.mp3 [--from 45] [--seconds 6] [--packs a,b] [--only name,...] [--out dir]
 *
 * Each preset plays `--seconds` of each song from `--from` seconds in, at 30 frames a second, at the size the app
 * draws it (1280 × 720). Measured: what a frame costs (Butterchurn's equations and drawing, the GPU waited for), how
 * bright it is and how much is blown out to white or crushed to black, how colourful, and how fast the picture moves
 * (the change between frames a 30th apart). Writes `<out>/report.json` and `<out>/sheet-NN.png` (a preset a row: its
 * frames on each song, numbered as the report).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { MILKDROP_PACKS, MILKDROP_SIZE } from "../shared/live-milkdrop.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const songs = (arg("songs") ?? "").split(",").filter(Boolean);
if (!songs.length) {
  console.error("Give it songs: --songs a.mp3,b.mp3");
  process.exit(1);
}
const FROM = Number(arg("from") ?? 45);
const SECONDS = Number(arg("seconds") ?? 6);
const packs = (arg("packs")?.split(",") ?? [...MILKDROP_PACKS]) as string[];
const only = arg("only")?.split("|");
const OUT = path.resolve(arg("out") ?? "milkdrop-sheet");
const RATE = 48_000;
/** Frames a second played (the cost of a frame doesn't depend on it). */
const FPS = 30;
/** Frames kept of each song's part, as thumbnails. */
const THUMBS = 3;
const ROWS = 16;

fs.mkdirSync(OUT, { recursive: true });

// Each song's part, as 32-bit floats, stereo.
const sounds = songs.map((file) => {
  const pcm = spawnSync("ffmpeg", ["-v", "error", "-ss", String(FROM), "-t", String(SECONDS + 1), "-i", file, "-f", "f32le", "-ac", "2", "-ar", String(RATE), "-"], {
    maxBuffer: 1 << 30,
  }).stdout;
  if (!pcm?.length) throw new Error(`couldn't read ${file}`);
  return pcm.toString("base64");
});

const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", ...(process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : [])] });
const page = await browser.newPage();
await page.setContent("<!doctype html><body style='margin:0;background:#000'></body>");
// (tsx names the functions handed to the page with a helper of its own, which the page needs too.)
await page.evaluate("window.__name = (f) => f");
await page.addScriptTag({ path: path.join(ROOT, "node_modules/butterchurn/lib/butterchurn.min.js") });
for (const pack of packs) await page.addScriptTag({ path: path.join(ROOT, `node_modules/butterchurn-presets/lib/${pack}.min.js`) });
const problems: string[] = [];
page.on("pageerror", (e) => problems.push(e.message));

// The page: Butterchurn on a canvas the app's size, the songs' sound, and a preset measured at a time.
const names: { name: string; pack: string }[] = await page.evaluate(
  ({ packs, sounds, size, rate }) => {
    const w = window as unknown as Record<string, unknown> & { md: unknown };
    const unwrap = (m: unknown, has: string) => {
      let x = m as Record<string, unknown>;
      for (let i = 0; i < 3 && x && !(has in x); i++) x = x.default as Record<string, unknown>;
      return x;
    };
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    document.body.append(canvas);
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true })!;
    const all: Record<string, { pack: string; preset: unknown }> = {};
    for (const pack of packs) {
      const presets = (unwrap(w[pack], "getPresets") as { getPresets(): Record<string, unknown> }).getPresets();
      for (const [name, preset] of Object.entries(presets)) all[name] ??= { pack, preset };
    }
    const decoded = sounds.map((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new Float32Array(bytes.buffer);
    });
    const create = unwrap(w.butterchurn, "createVisualizer") as { createVisualizer(a: null, c: HTMLCanvasElement, o: object): unknown };
    // A visualizer a song, kept: each preset is loaded into it at once (a second's played before it's judged).
    const visualizers = decoded.map(() => create.createVisualizer(null, canvas, { width: size.width, height: size.height, pixelRatio: 1, textureRatio: 1 }));
    w.md = { canvas, gl, all, decoded, rate, visualizers };
    return Object.entries(all).map(([name, { pack }]) => ({ name, pack }));
  },
  { packs, sounds, size: MILKDROP_SIZE, rate: RATE },
);
const chosen = only ? names.filter((n) => only.includes(n.name)) : names;
console.log(`${chosen.length} presets from ${packs.join(", ")}, on ${songs.length} songs`);

interface Measured {
  index: number;
  name: string;
  pack: string;
  failed?: string;
  /** Ms a frame, on average and at worst (the 95th percentile). */
  ms: number;
  msWorst: number;
  /** On each song: brightness (0..1), shares of white and of black, colourfulness, and movement (0..1 a frame). */
  songs: { light: number; white: number; black: number; colour: number; motion: number }[];
  thumbs: string[];
}

const report: Measured[] = [];
const started = Date.now();
for (const [i, { name, pack }] of chosen.entries()) {
  const measured = await page.evaluate(
    async ({ name, seconds, fps, thumbs }) => {
      const md = (window as unknown as { md: Record<string, unknown> }).md as {
        canvas: HTMLCanvasElement;
        gl: WebGL2RenderingContext;
        all: Record<string, { preset: unknown }>;
        decoded: Float32Array[];
        rate: number;
        visualizers: { loadPreset(p: unknown, b: number): void; render(o: object): void }[];
      };
      const small = document.createElement("canvas");
      small.width = 64;
      small.height = 36;
      const ctx = small.getContext("2d", { willReadFrequently: true })!;
      const thumb = document.createElement("canvas");
      thumb.width = 192;
      thumb.height = 108;
      const tctx = thumb.getContext("2d")!;
      const pixel = new Uint8Array(4);
      const costs: number[] = [];
      const songs: { light: number; white: number; black: number; colour: number; motion: number }[] = [];
      const shots: string[] = [];
      try {
        for (const [song, sound] of md.decoded.entries()) {
          const viz = md.visualizers[song];
          viz.loadPreset(md.all[name].preset, 0);
          const L = new Uint8Array(1024);
          const R = new Uint8Array(1024);
          const M = new Uint8Array(1024);
          const frames = Math.round(seconds * fps);
          let previous: Uint8ClampedArray | null = null;
          let light = 0;
          let white = 0;
          let black = 0;
          let colour = 0;
          let motion = 0;
          let measuredFrames = 0;
          for (let f = 0; f < frames; f++) {
            const centre = Math.round((f / fps) * md.rate);
            for (let k = 0; k < 1024; k++) {
              const at = (centre - 512 + k) * 2;
              const l = sound[at] ?? 0;
              const r = sound[at + 1] ?? 0;
              const b = (v: number) => Math.max(0, Math.min(255, Math.round(128 + v * 128)));
              L[k] = b(l);
              R[k] = b(r);
              M[k] = b((l + r) / 2);
            }
            const t0 = performance.now();
            viz.render({ audioLevels: { timeByteArray: M, timeByteArrayL: L, timeByteArrayR: R }, elapsedTime: 1 / fps });
            // Waited for: the GPU's done what was asked.
            md.gl.readPixels(0, 0, 1, 1, md.gl.RGBA, md.gl.UNSIGNED_BYTE, pixel);
            costs.push(performance.now() - t0);
            // After the first second, every few frames: how it looks and moves.
            if (f >= fps && f % 3 === 0) {
              ctx.drawImage(md.canvas, 0, 0, 64, 36);
              const data = ctx.getImageData(0, 0, 64, 36).data;
              let l = 0;
              let w = 0;
              let k = 0;
              let c = 0;
              let m = 0;
              for (let p = 0; p < data.length; p += 4) {
                const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
                const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
                l += y;
                if (y > 0.92) w++;
                if (y < 0.04) k++;
                c += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
                if (previous) m += (Math.abs(r - previous[p]) + Math.abs(g - previous[p + 1]) + Math.abs(b - previous[p + 2])) / 765;
              }
              const n = data.length / 4;
              light += l / n;
              white += w / n;
              black += k / n;
              colour += c / n;
              if (previous) motion += m / n;
              previous = new Uint8ClampedArray(data);
              measuredFrames++;
            }
            const shotEvery = Math.floor(frames / thumbs);
            if (f > 0 && f % shotEvery === shotEvery - 1 && shots.length < thumbs * (songs.length + 1)) {
              tctx.drawImage(md.canvas, 0, 0, thumb.width, thumb.height);
              shots.push(thumb.toDataURL("image/jpeg", 0.75));
            }
          }
          const n = Math.max(1, measuredFrames);
          songs.push({ light: light / n, white: white / n, black: black / n, colour: colour / n, motion: motion / Math.max(1, n - 1) });
        }
      } catch (err) {
        return { failed: String(err), ms: 0, msWorst: 0, songs, thumbs: shots };
      }
      const sorted = [...costs].sort((a, b) => a - b);
      const ms = costs.reduce((a, b) => a + b, 0) / costs.length;
      return { ms, msWorst: sorted[Math.floor(sorted.length * 0.95)], songs, thumbs: shots };
    },
    { name, seconds: SECONDS, fps: FPS, thumbs: THUMBS },
  );
  report.push({ index: i, name, pack, ...measured });
  if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${chosen.length}  ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

// The sheets: a preset a row, its frames on each song, its number and name over them.
for (let s = 0; s * ROWS < report.length; s++) {
  const rows = report.slice(s * ROWS, (s + 1) * ROWS).map((r) => ({
    label: `${r.index}  ${r.name}  [${r.pack.replace("butterchurnPresets", "") || "base"}]  ${r.failed ? `FAILED ${r.failed.slice(0, 60)}` : `${r.ms.toFixed(1)} ms (${r.msWorst.toFixed(1)})  motion ${r.songs.map((x) => x.motion.toFixed(3)).join("/")}`}`,
    thumbs: r.thumbs,
  }));
  const png = await page.evaluate(async (rows) => {
    const W = 192;
    const H = 108;
    const across = Math.max(...rows.map((r) => r.thumbs.length), 1);
    const canvas = document.createElement("canvas");
    canvas.width = across * (W + 4) + 4;
    canvas.height = rows.length * (H + 26) + 4;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [i, row] of rows.entries()) {
      const y = 4 + i * (H + 26);
      ctx.fillStyle = "#ddd";
      ctx.font = "13px sans-serif";
      ctx.fillText(row.label.slice(0, 150), 6, y + 15);
      for (const [j, src] of row.thumbs.entries()) {
        const img = new Image();
        img.src = src;
        await img.decode();
        ctx.drawImage(img, 4 + j * (W + 4), y + 22, W, H);
      }
    }
    return canvas.toDataURL("image/png");
  }, rows);
  fs.writeFileSync(path.join(OUT, `sheet-${String(s + 1).padStart(2, "0")}.png`), Buffer.from(png.split(",")[1], "base64"));
}

fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report.map(({ thumbs, ...r }) => r), null, 1));
await browser.close();
if (problems.length) console.log(`page errors: ${[...new Set(problems)].slice(0, 5).join(" | ")}`);
console.log(`${report.length} presets in ${((Date.now() - started) / 1000).toFixed(0)} s: ${path.relative(process.cwd(), OUT)}/`);
