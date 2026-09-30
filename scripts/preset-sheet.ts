/**
 * Render presets as a contact sheet (one row per preset, one column per moment across
 * its length: a transition over the cut from one sample scene to the other, an effect
 * preset on the plain sample picture) with the same renderer the app and the export
 * use, and check that each transition starts on the outgoing picture and ends on the
 * incoming one.
 *
 *   pnpm tsx scripts/preset-sheet.ts [--out sheet.png] [type or tag ...]
 *
 * With no names it renders every preset. Needs Chromium (see server/gl-browser.ts).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { GlSession } from "../server/gl-browser.ts";
import { presetRows } from "../server/preset-rows.ts";
import { PRESETS, type PresetTag } from "../shared/presets.ts";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = path.resolve(outIndex >= 0 ? args[outIndex + 1] : "preset-sheet.png");
const names = outIndex >= 0 ? args.filter((_, i) => i !== outIndex && i !== outIndex + 1) : args;

const defs = names.length
  ? PRESETS.filter((d) => names.includes(d.type) || names.includes(d.kind) || d.tags.some((t) => names.includes(t as PresetTag)))
  : PRESETS;
if (defs.length === 0) {
  console.error(`No presets match ${names.join(", ")}. Known: ${PRESETS.map((d) => d.type).join(", ")}`);
  process.exit(1);
}

const cell = { width: 120, height: 180 };
const session = await GlSession.open();
try {
  const { sheet, results } = await session.layers({ rows: presetRows(defs, cell), cell });
  await fs.writeFile(out, sheet);
  console.log(`Wrote ${out}`);
  let failed = false;
  for (const [i, r] of results.entries()) {
    // A transition must start on the outgoing picture and end on the incoming one (JPEG-free, so near exact).
    const ok = !r.error && (defs[i].kind !== "transition" || (r.start <= 8 && r.end <= 8));
    failed ||= !ok;
    console.log(`${ok ? "ok  " : "FAIL"} ${r.label.padEnd(22)} start Δ${r.start} end Δ${r.end}${r.error ? `  ${r.error}` : ""}`);
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  await session.close();
}
