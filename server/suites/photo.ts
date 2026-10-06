import { existsSync } from "node:fs";
import path from "node:path";
import { createPhotoProject, normalizePhotoProject, withPhotoOptions } from "../../shared/photo/project.ts";
import { documentSurfaces } from "../../shared/photo/surfaces.ts";
import { BlobStore } from "../photo/blobs.ts";
import { checkOnOpen, keepCheckpoint, recoverySurfaces } from "../photo/recovery.ts";
import { resourcesOf } from "../photo/service.ts";
import { HttpError } from "../storage.ts";
import type { SuiteBackend } from "./suite.ts";

/**
 * The photo suite (docs/photo/): `PhotoProject` documents, whose image layers show the project's media. Its Home
 * thumbnail is a cover the tab renders (the composite needs the GPU), not a media poster.
 */
export const photoSuite: SuiteBackend<"photo"> = {
  suite: "photo",
  create: (name) => createPhotoProject(name),
  withOptions: (doc, options) => withPhotoOptions(doc, options),
  // A layer whose media is gone stays (it shows as missing): the user's arrangement isn't thrown away.
  normalize: (doc) => normalizePhotoProject(doc),
  stats: (doc) => ({ name: doc.name, duration: 0, width: doc.canvas.width, height: doc.canvas.height, layerCount: doc.layers.length, coverAssetId: null }),
  remapMedia: (doc, ids) => ({ ...doc, layers: doc.layers.map((l) => (l.kind === "image" && ids.has(l.mediaId) ? { ...l, mediaId: ids.get(l.mediaId)! } : l)) }),
  // The publication gate: a saved document only names pixels the package has (the tab uploads them first).
  async checkSave(doc, dir) {
    const blobs = new BlobStore(resourcesOf(dir));
    const missing = [];
    for (const id of documentSurfaces(doc)) if (!(await blobs.hasManifest(id))) missing.push(id);
    if (missing.length) throw new HttpError(409, `The photo names pixels the project hasn't got yet: upload these surfaces first: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.`);
  },
  // The document a save replaces is the recovery checkpoint; opening falls back to it when pixels are missing.
  keepPrevious: (dir) => keepCheckpoint(dir),
  check: (doc, dir) => checkOnOpen(doc, dir),
  // Pixels only a closed tab's history named go when the project is next opened (the recovery documents' stay).
  async opened(doc, dir) {
    if (!existsSync(path.join(dir, "project.json"))) return;
    const result = await new BlobStore(resourcesOf(dir)).collect([...documentSurfaces(doc), ...(await recoverySurfaces(dir))]);
    if (result.missing.length) console.warn(`[photo] ${dir} names surfaces it hasn't got: ${result.missing.join(", ")}`);
  },
  assistant: {
    context: "the photo's canvas and which layer is selected when they sent it",
    background: "no layer is selected",
    instructions: `\
Tools for a local photo editor that works like Photoshop. They act on the photo open in the editor tab (unless \
you're told otherwise), live: the user sees every change as it happens, and can undo it.

A photo is a canvas (a size in pixels and a background colour, or transparent) and layers, bottom to top. An \
image layer is a picture placed whole: moving, scaling and rotating it resamples the original file, so making it \
smaller and bigger again never loses quality. Coordinates are canvas pixels from the top-left corner; a layer's \
position is its centre, its scale a factor of its own size (1 = 100%), its rotation degrees clockwise. An \
adjustment layer (Exposure, Curves) changes everything below it without changing any image: hide it, fade it with \
its opacity, or change its settings at any time. A pixel layer holds what the user paints. A generator layer \
makes its own content (a Lens Flare). Any layer can have a mask: black hides the layer, white reveals it (on an \
adjustment, where it applies). The selection (marching ants) \
limits the user's brush and can become a mask.

Start with get_photo, and look with view_photo before and after you change how it looks: you can't see the \
canvas otherwise. list_photo_media lists the project's images; add_image_layer places one; transform_layer \
moves, scales (fit: contain or cover) and rotates; set_layer renames, hides, fades and reorders; \
set_layer_blending sets blend modes (multiply, screen, overlay, soft-light, color, luminosity…), Fill and Blend If, \
as Photoshop's Blending Options; set_layer_style adds and changes effects (drop and inner shadows, outer and inner \
glows, colour and gradient overlays, strokes) and set_global_light moves the light shadows follow; remove_layer \
deletes; set_canvas resizes the canvas or changes its background (thumbnails are often 1280×720, stories \
1080×1920). add_adjustment adds an Exposure or Curves layer (above a given layer, so it only changes what's under \
it) and set_effect_params changes one: Exposure is in stops of light; Curves' points are [input, output] on 0..255 \
as in Photoshop (a gentle S, [[0, 0], [64, 52], [192, 205], [255, 255]], adds contrast). select_rect selects a \
rectangle (or all, or none); add_mask gives a layer a mask, from the selection (it shows only there) or empty, or \
removes one; add_pixel_layer adds an empty layer for the user to paint on (you can't paint strokes); \
layer_via_copy copies (or cuts) what the selection covers of a layer into a new layer; fill_selection fills it with \
a colour or clears it. merge_layers merges layers into one image. export_photo writes a PNG (8 or 16 bits) or JPEG.

Light: add_filter puts a glow (a filter, Photoshop's Smart Filter, on a layer's own pixels) on an image, pixel or \
generator layer: its bright parts bloom, spreading up to its radius (in canvas pixels) past the layer's edges; \
set_filter changes, bypasses or reorders a layer's filters, remove_filter removes one. add_generator adds a Lens \
Flare layer (a source glow, a halo, ghosts, a streak: elements on the line from its source through the optical \
centre) that adds its light to what's below; move_handle moves its source (where the light is) or optical centre, \
and set_effect_params changes its intensity, colour or elements. Light can be brighter than white: set_canvas's \
highlights decide how it leaves the photo (film rolls it towards white, the default; clip clips it).`,
  },
};
