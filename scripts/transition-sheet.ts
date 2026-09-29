/**
 * Render transitions as contact sheets (one row per transition, frames across
 * its progress) with the same renderer the app and the export use, and check
 * that each starts exactly on the outgoing picture and ends on the incoming one.
 *
 *   pnpm tsx scripts/transition-sheet.ts [--out sheet.png] [type or tag ...]
 *
 * With no names it renders every transition. Needs Chromium (see server/gl-browser.ts).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { GlSession } from "../server/gl-browser.ts";
import { fragmentSource, transitionUniforms } from "../shared/transition-gl.ts";
import { TRANSITIONS, type TransitionTag, defaultTransitionParams } from "../shared/transitions.ts";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = path.resolve(outIndex >= 0 ? args[outIndex + 1] : "transition-sheet.png");
const names = outIndex >= 0 ? args.filter((_, i) => i !== outIndex && i !== outIndex + 1) : args;

const defs = names.length
  ? TRANSITIONS.filter((d) => names.includes(d.type) || d.tags.some((t) => names.includes(t as TransitionTag)))
  : TRANSITIONS;
if (defs.length === 0) {
  console.error(`No transitions match ${names.join(", ")}. Known: ${TRANSITIONS.map((d) => d.type).join(", ")}`);
  process.exit(1);
}

const rows = defs.map((d) => ({
  label: d.label,
  shader: { key: d.type, source: fragmentSource(d) },
  uniforms: transitionUniforms(d, defaultTransitionParams(d)),
}));
const cell = { width: 160, height: 284 };
const passthrough = (side: "From" | "To") => ({
  key: `__${side}`,
  source: fragmentSource({ params: [], glsl: `vec4 transition(vec2 uv) { return get${side}Color(uv); }` }),
});

const session = await GlSession.open();
try {
  const png = await session.sheet({ rows, cell, progresses: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] });
  await fs.writeFile(out, png);
  console.log(`Wrote ${out}`);
  const results = await session.check({ rows, cell, from: passthrough("From"), to: passthrough("To") });
  let failed = false;
  for (const r of results) {
    const ok = !r.error && r.start <= 2 && r.end <= 2;
    failed ||= !ok;
    console.log(`${ok ? "ok  " : "FAIL"} ${r.label.padEnd(22)} start Δ${r.start} end Δ${r.end}${r.error ? `  ${r.error}` : ""}`);
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  await session.close();
}
