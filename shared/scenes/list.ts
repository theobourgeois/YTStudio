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
import { EVENT_HORIZON } from "./event-horizon.ts";
import { NEON_CITY } from "./neon-city.ts";
import { NEBULA } from "./nebula.ts";
import { ABYSS } from "./abyss.ts";
import { MONOLITHS } from "./monoliths.ts";
import { CYBERSPACE } from "./cyberspace.ts";
import { WORMHOLE } from "./wormhole.ts";
import { GALAXY } from "./galaxy.ts";
import { COSMIC_WEB } from "./cosmic-web.ts";
import { COLLIDER } from "./collider.ts";

export const SCENES: SceneSpec[] = [
  RIDGELINE,
  INFINITE_DIVE,
  AURORA,
  STORM_SEA,
  FERROFLUID,
  EVENT_HORIZON,
  NEON_CITY,
  NEBULA,
  ABYSS,
  MONOLITHS,
  CYBERSPACE,
  WORMHOLE,
  GALAXY,
  COSMIC_WEB,
  COLLIDER,
] as SceneSpec[];
