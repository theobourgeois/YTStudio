/** Every kernel filter's CPU reference, by type. */
import { COLOUR_REFERENCES } from "./colour.ts";
import { LIGHT_REFERENCES } from "./light.ts";
import { STYLIZE_REFERENCES } from "./stylize.ts";
import { EDGES_REFERENCES } from "./edges.ts";
import { GLITCH_REFERENCES } from "./glitch.ts";
import { FILM_REFERENCES } from "./film.ts";
import { DISTORT_REFERENCES } from "./distort.ts";
import { DEPTH_REFERENCES } from "./depth.ts";
import { FOCUS_REFERENCES } from "./focus.ts";
import { ATMOSPHERE_REFERENCES } from "./atmosphere.ts";
import { SUBJECT_REFERENCES } from "./subject.ts";
import { WIND_REFERENCES } from "./wind.ts";
import { WARP_REFERENCES } from "./warp.ts";
import { GLASS_REFERENCES } from "./glass.ts";
import { SURFACE_REFERENCES } from "./surface.ts";
import { CELLS_REFERENCES } from "./cells.ts";
import { PAINT_REFERENCES } from "./paint.ts";
import { PRINT_REFERENCES } from "./print.ts";
import { CRT_REFERENCES } from "./crt.ts";
import { EXTRUDE_REFERENCES } from "./extrude.ts";
import type { KernelReference } from "../kernel.ts";
import { cameraRawReference } from "../camera-raw.ts";
import { hueSaturationReference } from "../hue-saturation.ts";

export const KERNEL_REFERENCES: Record<string, KernelReference> = { ...COLOUR_REFERENCES, ...LIGHT_REFERENCES, ...STYLIZE_REFERENCES, ...EDGES_REFERENCES, ...GLITCH_REFERENCES, ...FILM_REFERENCES, ...DISTORT_REFERENCES, ...DEPTH_REFERENCES, ...FOCUS_REFERENCES, ...ATMOSPHERE_REFERENCES, ...SUBJECT_REFERENCES, ...WIND_REFERENCES, ...WARP_REFERENCES, ...GLASS_REFERENCES, ...SURFACE_REFERENCES, ...CELLS_REFERENCES, ...PAINT_REFERENCES, ...PRINT_REFERENCES, ...CRT_REFERENCES, ...EXTRUDE_REFERENCES, "camera-raw": cameraRawReference, "hue-saturation": hueSaturationReference };
