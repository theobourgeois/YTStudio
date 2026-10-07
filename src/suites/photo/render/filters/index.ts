/** Every kernel filter's WGSL, by type. */
import { COLOUR_KERNELS } from "./colour.ts";
import { LIGHT_KERNELS } from "./light.ts";
import { STYLIZE_KERNELS } from "./stylize.ts";
import { EDGES_KERNELS } from "./edges.ts";
import { GLITCH_KERNELS } from "./glitch.ts";
import { FILM_KERNELS } from "./film.ts";
import { DISTORT_KERNELS } from "./distort.ts";
import { DEPTH_KERNELS } from "./depth.ts";
import { FOCUS_KERNELS } from "./focus.ts";
import { ATMOSPHERE_KERNELS } from "./atmosphere.ts";
import { SUBJECT_KERNELS } from "./subject.ts";
import { WIND_KERNELS } from "./wind.ts";
import { WARP_KERNELS } from "./warp.ts";
import { GLASS_KERNELS } from "./glass.ts";
import { SURFACE_KERNELS } from "./surface.ts";
import { CELLS_KERNELS } from "./cells.ts";
import { PAINT_KERNELS } from "./paint.ts";
import { PRINT_KERNELS } from "./print.ts";
import { CRT_KERNELS } from "./crt.ts";
import { EXTRUDE_KERNELS } from "./extrude.ts";
import type { FilterKernel } from "../kernel.ts";
import { CAMERA_RAW_FILTER } from "../camera-raw.ts";

export const FILTER_KERNELS: Record<string, FilterKernel> = { ...COLOUR_KERNELS, ...LIGHT_KERNELS, ...STYLIZE_KERNELS, ...EDGES_KERNELS, ...GLITCH_KERNELS, ...FILM_KERNELS, ...DISTORT_KERNELS, ...DEPTH_KERNELS, ...FOCUS_KERNELS, ...ATMOSPHERE_KERNELS, ...SUBJECT_KERNELS, ...WIND_KERNELS, ...WARP_KERNELS, ...GLASS_KERNELS, ...SURFACE_KERNELS, ...CELLS_KERNELS, ...PAINT_KERNELS, ...PRINT_KERNELS, ...CRT_KERNELS, ...EXTRUDE_KERNELS, "camera-raw": CAMERA_RAW_FILTER };
