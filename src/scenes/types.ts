/**
 * What a 3D scene's renderer is built with and draws from (vaudio's authoring surface, its clock and audio
 * taken out: a scene's state is stepped in `shared/scenes/`, and its renderer only shows a state).
 */
import type * as THREE from "three";
import type { EnvironmentOptions } from "./environment";

/** The layer's two colours, mixed into the scene's own by Colorize (vaudio's palette). */
export interface ScenePalette {
  mix: number;
  a: THREE.Color;
  b: THREE.Color;
  /** `native` blended toward the palette's ramp at `t` (0: A, 1: B). */
  shade(native: THREE.ColorRepresentation, t: number, target?: THREE.Color): THREE.Color;
}

/** What a scene's `build` gets. */
export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  environment: THREE.Texture;
  /** Detail at build time, 0..1: instance counts follow it. */
  detail: number;
  palette: ScenePalette;
  /** Live post knobs: set them in `update` to pulse the whole picture. */
  post: { bloom: number; exposure: number };
  /** Geometries, materials and textures registered here are disposed with the scene. */
  track<T extends { dispose(): void }>(resource: T): T;
  /** A seeded generator, so a scene is built the same everywhere. */
  random(): number;
}

/** The sound every view carries (see `heard` in `shared/scenes/kit.ts`). */
export interface SceneSound {
  level: number;
  bass: number;
  mid: number;
  high: number;
  punch: number;
  beat: number;
  bands: number[];
}

export interface SceneInstance<V> {
  /** Show the state: everything placed for it (the camera too). */
  update(view: V & SceneSound): void;
  dispose?(): void;
}

export interface SceneDefinition<V = Record<string, unknown>> {
  type: string;
  environment?: EnvironmentOptions;
  look?: { exposure?: number; bloom?: { strength?: number; radius?: number; threshold?: number } };
  build(ctx: SceneContext): SceneInstance<V>;
}
