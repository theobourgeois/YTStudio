/**
 * The tab's 3D scene renderer, loaded (three.js and the scenes) the first time a scene is drawn: until
 * then a scene is transparent, and whoever asked is told when it's ready, to draw again.
 */
import type { SceneRenderer } from "@shared/compositor";

let renderer: SceneRenderer | null = null;
let loading: Promise<void> | null = null;
const waiting = new Set<() => void>();

function load() {
  loading ??= import("./runtime")
    .then(({ createSceneRenderer }) => {
      renderer = createSceneRenderer();
      for (const done of waiting) done();
      waiting.clear();
    })
    .catch((err) => {
      console.error("The 3D scenes couldn't load", err);
      loading = null;
    });
}

/** A renderer for a compositor: draws once loaded, and calls `ready` (once) when it has loaded. */
export function lazySceneRenderer(ready: () => void): SceneRenderer {
  return (scene, width, height) => {
    if (renderer) return renderer(scene, width, height);
    waiting.add(ready);
    load();
    return null;
  };
}
