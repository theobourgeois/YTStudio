/**
 * The 3D scenes' runtime for the export's page (`src/scenes/page.ts`: three.js and the scenes, as one
 * script that sets `vaudioScenes`). From a checkout it's built here, with esbuild, the first time it's
 * asked for (so it's never stale); the packaged app has it built already, beside the web app
 * (`dist/scene-runtime.js`, made by `pnpm build`).
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "src", "scenes", "page.ts");
/** Its name beside the built web app. */
export const SCENE_RUNTIME_FILE = "scene-runtime.js";

const builtIn: string[] = [path.join(ROOT, "dist")];
let cached: Promise<string> | null = null;

/** Also look for the built runtime in `dir` (the web app's folder: the packaged app's). */
export function sceneRuntimeIn(dir: string): void {
  if (!builtIn.includes(dir)) builtIn.unshift(dir);
}

/** The runtime bundled from its source (esbuild: a development dependency, never in the packaged app). */
export async function buildSceneRuntime(): Promise<string> {
  // A name esbuild (which bundles the desktop app's server) leaves alone.
  const name = "esbuild";
  const { build } = (await import(name)) as typeof import("esbuild");
  const result = await build({
    entryPoints: [SOURCE],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    minify: true,
    write: false,
    tsconfig: path.join(ROOT, "tsconfig.app.json"),
    logLevel: "warning",
  });
  return result.outputFiles[0].text;
}

/** The runtime's code. */
export function sceneRuntime(): Promise<string> {
  cached ??= (async () => {
    if (existsSync(SOURCE)) return buildSceneRuntime();
    for (const dir of builtIn) {
      const file = path.join(dir, SCENE_RUNTIME_FILE);
      if (existsSync(file)) return fs.readFile(file, "utf8");
    }
    throw new Error("The 3D scenes' runtime isn't built: run `pnpm build`.");
  })();
  cached.catch(() => (cached = null));
  return cached;
}
