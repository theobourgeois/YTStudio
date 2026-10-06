/** Every kernel filter's WGSL, by type. */
import { COLOUR_KERNELS } from "./colour.ts";
import { LIGHT_KERNELS } from "./light.ts";
import { STYLIZE_KERNELS } from "./stylize.ts";
import { EDGES_KERNELS } from "./edges.ts";
import { GLITCH_KERNELS } from "./glitch.ts";
import { FILM_KERNELS } from "./film.ts";
import { DISTORT_KERNELS } from "./distort.ts";
import type { FilterKernel } from "../kernel.ts";
import { CAMERA_RAW_FILTER } from "../camera-raw.ts";

export const FILTER_KERNELS: Record<string, FilterKernel> = { ...COLOUR_KERNELS, ...LIGHT_KERNELS, ...STYLIZE_KERNELS, ...EDGES_KERNELS, ...GLITCH_KERNELS, ...FILM_KERNELS, ...DISTORT_KERNELS, "camera-raw": CAMERA_RAW_FILTER };
