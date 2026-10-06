/**
 * Every 3D scene, apart from the stepping machinery (`index.ts`), which imports the effects: the effects'
 * definitions (`effect-library/scenes.ts`) are made from this list.
 */
import type { SceneSpec } from "./index.ts";
import { RIDGELINE } from "./ridgeline.ts";
import { INFINITE_DIVE } from "./infinite-dive.ts";
import { AURORA } from "./aurora.ts";
import { STORM_SEA } from "./storm-sea.ts";
import { FERROFLUID } from "./ferrofluid.ts";

export const SCENES: SceneSpec[] = [RIDGELINE, INFINITE_DIVE, AURORA, STORM_SEA, FERROFLUID] as SceneSpec[];
