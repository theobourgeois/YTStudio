/** Every kernel filter (`../kernel.ts`), by category: their definitions. */
import { COLOUR_FILTERS } from "./colour.ts";
import { LIGHT_FILTERS } from "./light.ts";
import { STYLIZE_FILTERS } from "./stylize.ts";
import { EDGES_FILTERS } from "./edges.ts";
import { GLITCH_FILTERS } from "./glitch.ts";
import { FILM_FILTERS } from "./film.ts";
import { DISTORT_FILTERS } from "./distort.ts";
import { DEPTH_FILTERS } from "./depth.ts";
import { FOCUS_FILTERS } from "./focus.ts";
import { ATMOSPHERE_FILTERS } from "./atmosphere.ts";
import { SUBJECT_FILTERS } from "./subject.ts";
import { WIND_FILTERS } from "./wind.ts";
import { WARP_FILTERS } from "./warp.ts";
import { GLASS_FILTERS } from "./glass.ts";
import { SURFACE_FILTERS } from "./surface.ts";
import { CELLS_FILTERS } from "./cells.ts";
import { PAINT_FILTERS } from "./paint.ts";
import { PRINT_FILTERS } from "./print.ts";
import { CRT_FILTERS } from "./crt.ts";
import { EXTRUDE_FILTERS } from "./extrude.ts";
import type { EffectDefinition } from "../index.ts";

export const KERNEL_FILTERS: EffectDefinition[] = [...COLOUR_FILTERS, ...LIGHT_FILTERS, ...STYLIZE_FILTERS, ...EDGES_FILTERS, ...GLITCH_FILTERS, ...FILM_FILTERS, ...DISTORT_FILTERS, ...DEPTH_FILTERS, ...FOCUS_FILTERS, ...ATMOSPHERE_FILTERS, ...SUBJECT_FILTERS, ...WIND_FILTERS, ...WARP_FILTERS, ...GLASS_FILTERS, ...SURFACE_FILTERS, ...CELLS_FILTERS, ...PAINT_FILTERS, ...PRINT_FILTERS, ...CRT_FILTERS, ...EXTRUDE_FILTERS];
