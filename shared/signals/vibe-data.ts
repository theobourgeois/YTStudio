/** The vibe's vocabulary as `scripts/clap-vibe.ts` made it (`vibe.json`): what the app reads sounds against. */
import type { VibeData } from "./vibe.ts";
import data from "./vibe.json" with { type: "json" };

export const VIBE_DATA = data as VibeData;
