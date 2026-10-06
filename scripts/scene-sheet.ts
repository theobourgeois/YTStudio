/**
 * Render 3D scenes (docs/visualizer/scenes.md) at a few moments through the export's own compositor, to look at
 * them: one row per scene, one column per moment, on made-up sound (120 BPM).
 *
 *   pnpm tsx scripts/scene-sheet.ts [scene ...] [--at 1,4,9] [--size 360x640] [--set key=value ...] [--out f.png]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { GlSession } from "../server/gl-browser.ts";
import { effectPass } from "../shared/effect-gl.ts";
import { VIDEO_EFFECTS } from "../shared/effects.ts";
import { defaultParams } from "../shared/params.ts";
import type { EffectPass } from "../shared/compositor.ts";
import type { ParamValues } from "../shared/types.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const sets = args.flatMap((a, i) => (args[i - 1] === "--set" ? [a] : []));
const flags = new Set(["--at", "--size", "--out", "--set"]);
const names = args.filter((a, i) => !a.startsWith("--") && !flags.has(args[i - 1] ?? ""));
const at = (option("--at") ?? "0.5,3,7,12").split(",").map(Number);
const [width, height] = (option("--size") ?? "270x480").split("x").map(Number);
const out = path.resolve(option("--out") ?? "scene-sheet.png");
const overrides: ParamValues = Object.fromEntries(
  sets.map((s) => {
    const [k, v] = s.split("=");
    return [k, Number.isFinite(Number(v)) ? Number(v) : v === "true" ? true : v === "false" ? false : v];
  }),
);

const defs = VIDEO_EFFECTS.filter((d) => d.shader?.scene && (names.length === 0 || names.includes(d.type)));
const session = await GlSession.open();
try {
  const rows = defs.map((def) => {
    const values = { ...defaultParams(def.params), ...def.shader?.demo, ...overrides };
    const started = performance.now();
    const passes = at.map((t) => effectPass(def, values, t, 30, `sheet/${def.type}`)).filter((p): p is EffectPass => !!p);
    console.log(`${def.label}: state for ${at.join(", ")} s in ${(performance.now() - started).toFixed(0)} ms`);
    return { label: def.label, passes };
  });
  const started = performance.now();
  const { sheet, results } = await session.effects({ rows, cell: { width, height } });
  console.log(`drawn in ${(performance.now() - started).toFixed(0)} ms`);
  for (const r of results) if (r.error) console.log(`FAIL ${r.label}: ${r.error}`);
  await fs.writeFile(out, sheet);
  console.log(`Wrote ${out}`);
} finally {
  await session.close();
}
