/**
 * Writes the 3D scenes' runtime for the export's page into the built web app (`dist/scene-runtime.js`),
 * for the packaged app, which can't build it (see `server/scene-runtime.ts`). Part of `pnpm build`.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { SCENE_RUNTIME_FILE, buildSceneRuntime } from "../server/scene-runtime.ts";

const out = path.resolve(import.meta.dirname, "..", "dist", SCENE_RUNTIME_FILE);
writeFileSync(out, await buildSceneRuntime());
console.log(`[scene-runtime] wrote ${path.relative(process.cwd(), out)}`);
