/**
 * Renders 3D scenes (`EffectPass.scene`) for the compositor (`Compositor.setSceneRenderer`): in the tab
 * (loaded when a scene is first drawn, `loader.ts`) and in the export's page (bundled by esbuild from
 * `page.ts`, served by `server/scene-runtime.ts`). One WebGL renderer draws every scene; each clip's scene
 * keeps its objects, built once from its `build` (vaudio's runtime: ACES, bloom, then the output pass).
 * A scene only shows the state it's given, so the same state is the same picture in both.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { SceneDraw, SceneRenderer } from "@shared/compositor";
import { createEnvironment } from "./environment";
import type { SceneContext, SceneDefinition, SceneInstance, ScenePalette } from "./types";
import { tesseract } from "./tesseract";
import { singularity } from "./singularity";
import { cathedral } from "./cathedral";
import { leviathan } from "./leviathan";

const DEFINITIONS: Record<string, SceneDefinition<never>> = Object.fromEntries(
  ([tesseract, singularity, cathedral, leviathan] as SceneDefinition<never>[]).map((d) => [d.type, d]),
);

/** Scenes kept built at once (the least recently drawn let go). */
const KEPT = 6;

/** A small seeded generator, so a scene is built the same everywhere. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createPalette(build: SceneDraw["build"]): ScenePalette {
  const a = new THREE.Color(String(build.colorA || "#36e4ff"));
  const b = new THREE.Color(String(build.colorB || "#ff4d9d"));
  const scratch = new THREE.Color();
  const palette: ScenePalette = {
    mix: Math.min(1, Math.max(0, Number(build.colorize) || 0)),
    a,
    b,
    shade(native, t, target) {
      const out = (target ?? new THREE.Color()).set(native);
      if (palette.mix > 0.001) {
        scratch.copy(a).lerp(b, Math.min(1, Math.max(0, t)));
        out.lerp(scratch, palette.mix);
      }
      return out;
    },
  };
  return palette;
}

/**
 * The vertical field of view for a frame of `aspect` (width / height): a scene's lens is for the shorter
 * side, so a 9:16 frame sees as much across as a square one does, rather than a sliver of a 16:9 world.
 */
export function fittedFov(fov: number, aspect: number): number {
  if (aspect >= 1) return fov;
  const half = (fov * Math.PI) / 360;
  return (Math.atan(Math.tan(half) / aspect) * 360) / Math.PI;
}

interface Built {
  key: string;
  instance: SceneInstance<never>;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  post: { bloom: number; exposure: number };
  look: { exposure: number; bloom: number };
  size: [number, number];
  dispose(): void;
}

/** A renderer of scenes (one WebGL context, on a canvas of its own). */
export function createSceneRenderer(): SceneRenderer {
  let renderer: THREE.WebGLRenderer | null = null;
  const built = new Map<string, Built>();

  const build = (draw: SceneDraw, definition: SceneDefinition<never>, gl: THREE.WebGLRenderer): Built => {
    const look = definition.look ?? {};
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 600);
    const environment = createEnvironment(gl, definition.environment);
    scene.environment = environment.texture;
    const tracked: { dispose(): void }[] = [];
    const post = { bloom: look.bloom?.strength ?? 0.6, exposure: look.exposure ?? 1 };
    const context: SceneContext = {
      scene,
      camera,
      renderer: gl,
      environment: environment.texture,
      detail: Math.min(1, Math.max(0, Number(draw.build.detail ?? 0.7))),
      palette: createPalette(draw.build),
      post,
      track(resource) {
        tracked.push(resource);
        return resource;
      },
      random: mulberry32(0x5eed1337),
    };
    const instance = definition.build(context);
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), post.bloom, look.bloom?.radius ?? 0.6, look.bloom?.threshold ?? 0.72);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    return {
      key: JSON.stringify([draw.type, draw.build]),
      instance,
      scene,
      camera,
      composer,
      bloom,
      post,
      look: { exposure: post.exposure, bloom: post.bloom },
      size: [0, 0],
      dispose() {
        instance.dispose?.();
        for (const resource of tracked) {
          try {
            resource.dispose();
          } catch {
            // already disposed
          }
        }
        for (const pass of composer.passes) (pass as { dispose?: () => void }).dispose?.();
        composer.dispose();
        environment.dispose();
      },
    };
  };

  return (draw, width, height) => {
    const definition = DEFINITIONS[draw.type];
    if (!definition) return null;
    const w = Math.max(16, Math.round(width));
    const h = Math.max(16, Math.round(height));
    if (!renderer) {
      const canvas = document.createElement("canvas");
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
      renderer.setPixelRatio(1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    if (renderer.getContext().isContextLost()) return null;
    const key = JSON.stringify([draw.type, draw.build]);
    let scene = built.get(draw.instance);
    if (scene && scene.key !== key) {
      scene.dispose();
      built.delete(draw.instance);
      scene = undefined;
    }
    if (!scene) {
      scene = build(draw, definition, renderer);
      for (const [id, old] of built) {
        if (built.size < KEPT) break;
        old.dispose();
        built.delete(id);
      }
    } else built.delete(draw.instance);
    built.set(draw.instance, scene);

    const view = draw.state as never as { grade?: { bloom: number; exposure: number } };
    scene.post.bloom = scene.look.bloom;
    scene.post.exposure = scene.look.exposure;
    scene.instance.update(draw.state as never);
    const { camera } = scene;
    camera.aspect = w / h;
    camera.fov = fittedFov(camera.fov, w / h);
    camera.updateProjectionMatrix();

    renderer.setSize(w, h, false);
    if (scene.size[0] !== w || scene.size[1] !== h) {
      scene.composer.setSize(w, h);
      scene.size = [w, h];
    }
    scene.bloom.strength = Math.max(0, scene.post.bloom * (view.grade?.bloom ?? 1));
    renderer.toneMappingExposure = Math.max(0, scene.post.exposure * (view.grade?.exposure ?? 1));
    scene.composer.render();
    return renderer.domElement;
  };
}
