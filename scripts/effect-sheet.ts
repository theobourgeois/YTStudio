/**
 * Render video effects as a contact sheet (one row per effect: the plain
 * picture, the effect at its defaults, then its card's values at a few
 * moments) with the same renderer the app and the export use, and check that
 * each compiles and visibly changes the picture.
 *
 *   pnpm tsx scripts/effect-sheet.ts [--out sheet.png] [type or tag ...]
 *
 * With no names it renders every effect. Needs Chromium (see server/gl-browser.ts).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { GlSession } from "../server/gl-browser.ts";
import { effectRows } from "../server/effect-rows.ts";
import { type EffectTag, VIDEO_EFFECTS } from "../shared/effects.ts";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = path.resolve(outIndex >= 0 ? args[outIndex + 1] : "effect-sheet.png");
const names = outIndex >= 0 ? args.filter((_, i) => i !== outIndex && i !== outIndex + 1) : args;

const defs = names.length
  ? VIDEO_EFFECTS.filter((d) => names.includes(d.type) || d.shader?.tags.some((t) => names.includes(t as EffectTag)))
  : VIDEO_EFFECTS;
if (defs.length === 0) {
  console.error(`No effects match ${names.join(", ")}. Known: ${VIDEO_EFFECTS.map((d) => d.type).join(", ")}`);
  process.exit(1);
}

const session = await GlSession.open();
try {
  const { sheet, results } = await session.effects({ rows: effectRows(defs), cell: { width: 180, height: 120 } });
  await fs.writeFile(out, sheet);
  console.log(`Wrote ${out}`);
  let failed = false;
  for (const r of results) {
    const ok = !r.error && r.max >= 16;
    failed ||= !ok;
    console.log(`${ok ? "ok  " : "FAIL"} ${r.label.padEnd(22)} max Δ${r.max} mean Δ${r.mean.toFixed(1)}${r.error ? `  ${r.error}` : ""}`);
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  await session.close();
}
