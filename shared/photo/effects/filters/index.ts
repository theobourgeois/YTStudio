/** Every kernel filter (`../kernel.ts`), by category: their definitions. */
import { COLOUR_FILTERS } from "./colour.ts";
import { LIGHT_FILTERS } from "./light.ts";
import { STYLIZE_FILTERS } from "./stylize.ts";
import { EDGES_FILTERS } from "./edges.ts";
import { GLITCH_FILTERS } from "./glitch.ts";
import { FILM_FILTERS } from "./film.ts";
import { DISTORT_FILTERS } from "./distort.ts";
import type { EffectDefinition } from "../index.ts";

export const KERNEL_FILTERS: EffectDefinition[] = [...COLOUR_FILTERS, ...LIGHT_FILTERS, ...STYLIZE_FILTERS, ...EDGES_FILTERS, ...GLITCH_FILTERS, ...FILM_FILTERS, ...DISTORT_FILTERS];
