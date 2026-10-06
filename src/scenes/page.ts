/**
 * The export's page's 3D scenes: bundled (with three.js) by esbuild into one script
 * (`server/scene-runtime.ts`), which the page loads before drawing frames with scenes in them.
 */
import { createSceneRenderer } from "./runtime";

(globalThis as unknown as { vaudioScenes: { createSceneRenderer: typeof createSceneRenderer } }).vaudioScenes = { createSceneRenderer };
