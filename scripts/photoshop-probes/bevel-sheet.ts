/**
 * Photoshop's bevel and satin renders (data/photoshop-probes/fx3, from fx_bevel.py) beside the reference's, and their
 * difference × 8: a sheet to look at after changing `reference/style.ts`'s bevel or satin.
 *
 *   pnpm tsx scripts/photoshop-probes/bevel-sheet.ts [--shape disc|square] [--out sheet.png]
 */
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { linearToSrgb, srgbToLinear } from "../../shared/photo/colour.ts";
import { type LayerImage, renderStyled } from "../../shared/photo/reference/style.ts";
import { newStyleEffect } from "../../shared/photo/style/style.ts";
import type { EffectInstance, PixelLayer } from "../../shared/photo/types.ts";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const kind = arg("--shape", "disc");
const out = arg("--out", "bevel-sheet.png");
const W = 320;
const CROP = { x: 50, y: 50, size: 220 };
const DIR = path.resolve(import.meta.dirname, "../../data/photoshop-probes/fx3");

const grey = srgbToLinear(128 / 255);
const content: LayerImage = { width: W, height: W, pixels: new Float32Array(W * W * 4) };
for (let y = 0; y < W; y++)
  for (let x = 0; x < W; x++) {
    const cover = kind === "disc" ? Math.min(1, Math.max(0, 80 - Math.hypot(x + 0.5 - 160, y + 0.5 - 160) + 0.5)) : x >= 90 && x < 230 && y >= 90 && y < 230 ? 1 : 0;
    const a = Math.round(cover * 255) / 255;
    content.pixels.set([grey * a, grey * a, grey * a, a], (y * W + x) * 4);
  }
const black: LayerImage = { width: W, height: W, pixels: new Float32Array(W * W * 4).map((_, i) => (i % 4 === 3 ? 1 : 0)) };

const bevel = (style: string, technique: string) =>
  newStyleEffect("bevel-emboss", "b", { style, technique, size: 20, globalLight: false, angle: 120, altitude: 30, highlightMode: "normal", highlightOpacity: 100, shadowMode: "normal", shadowOpacity: 100 })!;
const cases: [string, EffectInstance][] = [];
for (const [style, ps] of [
  ["outer-bevel", "outerBevel"],
  ["inner-bevel", "innerBevel"],
  ["emboss", "emboss"],
  ["pillow-emboss", "pillowEmboss"],
])
  for (const [technique, psT] of [
    ["smooth", "softMatte"],
    ["chisel-hard", "preciseMatte"],
    ["chisel-soft", "slopeLimitMatte"],
  ])
    cases.push([`bevel-${ps}-${psT}-${kind}`, bevel(style, technique)]);
cases.push([`satin-${kind}${kind === "disc" ? "-invert" : ""}`, newStyleEffect("satin", "s", { mode: "normal", colour: "#ff0000", opacity: 100, angle: 19, distance: 11, size: 14, invert: kind === "disc" })!]);

const tiles: OverlayOptions[] = [];
const S = CROP.size;
for (const [n, [file, effect]] of cases.entries()) {
  const layer: PixelLayer = { id: "l", kind: "pixel", name: "l", visible: true, opacity: 1, surface: null, size: { width: W, height: W }, transform: { x: W / 2, y: W / 2, scaleX: 1, scaleY: 1, rotation: 0 }, style: { enabled: true, effects: [effect] } };
  const ours = renderStyled(layer, { compositing: "photoshop" }, black, content, (e) => e.params.angle as number, { x0: 0, y0: 0, x1: W, y1: W }, (e) => e.params.altitude as number);
  const theirs = await sharp(path.join(DIR, `${file}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const tw = theirs.info.width;
  const ps = Buffer.alloc(S * S * 3);
  const mine = Buffer.alloc(S * S * 3);
  const diff = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const sx = x + CROP.x;
      const sy = y + CROP.y;
      for (let c = 0; c < 3; c++) {
        const p = theirs.data[(sy * tw + sx) * 3 + c];
        const m = Math.round(linearToSrgb(Math.min(1, Math.max(0, ours[(sy * W + sx) * 4 + c]))) * 255);
        ps[(y * S + x) * 3 + c] = p;
        mine[(y * S + x) * 3 + c] = m;
        diff[(y * S + x) * 3 + c] = Math.min(255, Math.abs(p - m) * 8);
      }
    }
  const raw = { raw: { width: S, height: S, channels: 3 as const } };
  const top = n * (S + 8);
  tiles.push({ input: ps, ...raw, left: 0, top }, { input: mine, ...raw, left: S + 8, top }, { input: diff, ...raw, left: 2 * (S + 8), top });
}
await sharp({ create: { width: 3 * S + 16, height: cases.length * (S + 8) - 8, channels: 3, background: "#202020" } })
  .composite(tiles)
  .png()
  .toFile(out);
console.log(`${out}: rows ${cases.map(([f]) => f).join(", ")}; columns Photoshop, ours, difference × 8`);
