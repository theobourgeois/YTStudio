/**
 * The photo suite's tools (`shared/photo/tools.ts`), run in the tab. `PhotoToolName` makes TypeScript insist every
 * tool has a handler. Edits are the pure functions of `tool-edits.ts`, applied to the open photo as one undo step,
 * or to a photo that isn't open by loading and saving it. Pictures and exports render with the same compositor as
 * the canvas.
 */
import { createId } from "@shared/ids";
import { addImageLayer, placement, setMask } from "@shared/photo/edits";
import { ONLINE_SOURCES, type OnlinePlaceRequest, WEB_FILTERS, iconSizeFor, isLink, onlineLayerName } from "@shared/photo/online";
import { mergedLayer, replaceWithMerged } from "@shared/photo/merge";
import { dabsAlong } from "@shared/photo/quick-select";
import { allSelection, boxCoverage, rectSelection } from "@shared/photo/selection";
import { ellipseSelection, featherSelection, polygonSelection } from "@shared/photo/selection-shapes";
import type { PhotoToolName } from "@shared/photo/tools";
import type { PhotoProject, PhotoSelection, SelectionMode } from "@shared/photo/types";
import { type ToolResult, textResult } from "@shared/tool-spec";
import type { MediaAsset } from "@shared/types";
import { api } from "@/lib/api";
import type { ToolRunContext } from "../types";
import { withRenderer } from "./live";
import { planWith, renderMerge } from "./merge";
import { useColours } from "./colours";
import { definePattern, editActions } from "./edit-actions";
import { allStyles, findStyle, materialise, newStyle, styleEdit, useStyles } from "./layer-style/styles";
import { addPattern, describeStyle, stylePatterns } from "@shared/photo/style/style";
import { currentDoc, currentSelection } from "./store";
import { applySelection, quickSelectionResult, selectActions, startQuickSelection, wandAt } from "./selecting";
import { selectSubject } from "./subject-model";
import { usePhoto } from "./store";
import {
  type PhotoEdit,
  addAdjustmentTool,
  addFilterTool,
  addGeneratorTool,
  addImageLayerTool,
  addPixelLayerTool,
  findLayerRef,
  maskTool,
  describeLayer,
  describeMedia,
  describePhoto,
  describeSelection,
  mergeRequest,
  moveHandleTool,
  removeFilterTool,
  removeLayerTool,
  setCanvasTool,
  setEffectParamsTool,
  setLayerBlendingTool,
  setLayerStyleTool,
  setGlobalLightTool,
  setPatternTool,
  scaleLayerEffectsTool,
  copyLayerStyleTool,
  setFilterTool,
  setLayerTool,
  transformLayerTool,
  canvasCropOf,
  cropLayerTool,
} from "./tool-edits";
import { cropCanvas, documentMasks } from "@shared/photo/crop";
import { uploadsFor } from "./uploads";
import { shiftSurfaces } from "./toolbox/crop-masks";
import { usePhotoUi } from "./ui";
import { imageLayerOf } from "./media";
import { photoApi } from "./api";
import { placeAsset, removeBackground } from "./online/online";

/** How many of a search's results the model is told of at once. */
const ONLINE_LISTED = 40;

/** One of `options`, else `fallback` when it's missing (null: required), else a message saying what's allowed. */
function oneOfOr<T extends string, F extends T | null>(value: unknown, options: readonly T[], fallback: F, key: string): T | Exclude<F, null> {
  if (value === undefined || value === null || value === "") {
    if (fallback === null) throw new Error(`${key} is required: ${options.join(", ")}.`);
    return fallback as Exclude<F, null>;
  }
  if (typeof value === "string" && (options as readonly string[]).includes(value)) return value as T;
  throw new Error(`${key} must be one of ${options.join(", ")}.`);
}

type Input = Record<string, unknown>;

/** The photo a call acts on: the open one (through its store), or one loaded for the call. */
interface Target {
  projectId: string;
  doc: PhotoProject;
  assets: MediaAsset[];
  open: boolean;
}

async function targetOf(ctx: ToolRunContext): Promise<Target> {
  const open = usePhoto.getState();
  const projectId = ctx.chat ?? open.projectId;
  if (!projectId) throw new Error("No photo is open in the editor. Ask the user to open one.");
  if (projectId === open.projectId && open.history) return { projectId, doc: open.history.doc.doc, assets: open.assets, open: true };
  const [doc, assets] = await Promise.all([api.getDocument("photo", projectId), api.listMedia(projectId)]);
  return { projectId, doc, assets, open: false };
}

const edit =
  (run: PhotoEdit) =>
  async (input: Input, ctx: ToolRunContext): Promise<ToolResult> => {
    const target = await targetOf(ctx);
    // An edit that can't be made throws here, before anything changes.
    const result = run(target.doc, input, { assets: target.assets });
    if (target.open && usePhoto.getState().projectId === target.projectId) {
      usePhoto.getState().commit(() => result.doc);
      if (result.layerId) usePhotoUi.getState().select(result.layerId);
    } else if (result.doc !== target.doc) await api.saveDocument("photo", target.projectId, result.doc);
    return textResult(result.text, result.layerId ? { added: [], changed: [result.layerId], removed: 0 } : undefined);
  };

const base64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const TOOLS: Record<PhotoToolName, (input: Input, ctx: ToolRunContext) => Promise<ToolResult>> = {
  async get_photo(_input, ctx) {
    const target = await targetOf(ctx);
    const mine = useStyles.getState().mine;
    return textResult(describePhoto(target.doc, target.assets, target.open ? usePhotoUi.getState().selectedLayerIds : [], target.open ? currentSelection() : null) + (mine.length ? `\nThe user's styles (apply_style): ${mine.map((s) => `"${s.name}"`).join(", ")}.` : ""));
  },
  async list_photo_media(_input, ctx) {
    return textResult(describeMedia((await targetOf(ctx)).assets));
  },
  async view_photo(input, ctx) {
    const target = await targetOf(ctx);
    const width = Math.max(64, Math.min(1600, Math.round(typeof input.width === "number" ? input.width : 768)));
    let blob = await withRenderer(target.projectId, target.doc, target.assets, (r) => r.picture(target.doc, width));
    const selection = input.show_selection === true && target.open ? currentSelection() : null;
    if (selection) blob = await quickMask(blob, selection, target.doc.canvas);
    return {
      content: [
        { type: "text", text: `"${target.doc.name}", ${target.doc.canvas.width}×${target.doc.canvas.height} px, shown ${width} px wide (transparency over a checkerboard)${selection ? "; red tints what isn't selected" : input.show_selection === true ? "; nothing is selected" : ""}.` },
        { type: "image", data: await base64(blob), mimeType: "image/jpeg" },
      ],
    };
  },
  add_image_layer: edit(addImageLayerTool),
  async search_online_images(input) {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) throw new Error('query is required: what to find ("bell"), or a link.');
    const source = isLink(query) ? "link" : oneOfOr(input.source, ["icons", "web", "photos"] as const, "icons", "source");
    const filter = oneOfOr(input.filter, WEB_FILTERS, "any", "filter");
    const page = typeof input.page === "number" && input.page > 0 ? Math.floor(input.page) : 0;
    const found = await photoApi.searchOnline(source, query, page, filter);
    if (!found.results.length) return textResult(`Nothing found for "${query}"${source === "icons" ? " among the icons: try a shorter or more common name, or source web" : ""}.`);
    const shown = found.results.slice(0, ONLINE_LISTED);
    const lines = shown.map((r, i) => {
      const facts = [r.set && `${r.set}${r.palette ? ", in its own colours" : ""}`, r.width && r.height && `${r.width}×${r.height}`, r.license, r.credit && `by ${r.credit}`].filter(Boolean).join(", ");
      return `${i + 1}. "${r.title}"${facts ? ` (${facts})` : ""}: source ${r.source}, id "${r.id}"${r.fallback ? `, fallback "${r.fallback}"` : ""}`;
    });
    const more = found.next !== null ? `\nMore: page ${found.next}.` : "";
    return textResult(`${found.results.length > shown.length ? `The first ${shown.length} of ${found.results.length}` : `${shown.length}`} result${shown.length === 1 ? "" : "s"} for "${query}" (${source}). Place one with place_online_image (its source and id${source === "icons" ? "" : ", and its fallback"}).\n${lines.join("\n")}${more}`);
  },
  async place_online_image(input, ctx) {
    const target = await targetOf(ctx);
    const source = oneOfOr(input.source, ONLINE_SOURCES, null, "source");
    const id = typeof input.id === "string" ? input.id.trim() : "";
    if (!id) throw new Error("id is required: a result's id from search_online_images.");
    const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "";
    const request: OnlinePlaceRequest = { source, id, ...(title ? { title } : {}), ...(typeof input.fallback === "string" && input.fallback ? { fallback: input.fallback } : {}) };
    if (source === "icons") {
      request.size = typeof input.size === "number" ? Math.round(input.size) : iconSizeFor(target.doc.canvas);
      request.colour = typeof input.colour === "string" && input.colour ? input.colour : useColours.getState().foreground;
    }
    const asset = await photoApi.placeOnline(target.projectId, request);
    const name = onlineLayerName({ source, id, title });
    const at = typeof input.x === "number" && typeof input.y === "number" ? { x: input.x, y: input.y } : undefined;
    let layerId: string;
    let doc: PhotoProject;
    if (target.open && usePhoto.getState().projectId === target.projectId) {
      const placed = placeAsset(asset, name, at);
      if (!placed) throw new Error("The image couldn't be placed: is the photo still open?");
      layerId = placed;
      if (input.remove_background === true && !(await removeBackground(layerId))) {
        throw new Error(`Placed "${name}" as layer ${layerId}, but its background couldn't be removed (Select Subject's model may need downloading: Select › Subject in the editor).`);
      }
      doc = currentDoc()!;
    } else {
      if (input.remove_background === true) throw new Error("remove_background needs the photo open in the editor: open it, or place without it.");
      const layer = imageLayerOf(asset, name);
      doc = addImageLayer(target.doc, layer, at ? { transform: { ...placement(target.doc.canvas, layer.size), x: Math.round(at.x), y: Math.round(at.y) } } : {});
      await api.saveDocument("photo", target.projectId, doc);
      layerId = layer.id;
    }
    const index = doc.layers.findIndex((l) => l.id === layerId);
    return textResult(
      `Placed "${name}" (${asset.width}×${asset.height} px) as layer ${layerId} on top${input.remove_background === true ? ", masked to its subject" : ""}.\n${describeLayer(doc.layers[index], [...target.assets, asset], index)}`,
      { added: [], changed: [layerId], removed: 0 },
    );
  },
  transform_layer: edit(transformLayerTool),
  set_layer: edit(setLayerTool),
  set_layer_blending: edit(setLayerBlendingTool),
  set_layer_style: edit(setLayerStyleTool),
  set_global_light: edit(setGlobalLightTool),
  copy_layer_style: edit(copyLayerStyleTool),
  set_pattern: edit(setPatternTool),
  scale_layer_effects: edit(scaleLayerEffectsTool),
  async define_pattern(input, ctx) {
    const target = await targetOf(ctx);
    if (!target.open) throw new Error("Open the photo in the editor first: its pixels need to be on the GPU, and the selection is the open photo's.");
    const layer = findLayerRef(target.doc, input.layer);
    const made = await definePattern(target.doc, layer.id, currentSelection(), typeof input.name === "string" ? input.name : undefined);
    if ("error" in made) throw new Error(made.error);
    usePhoto.getState().commit((d) => addPattern(d, made.pattern).doc);
    const { pattern } = made;
    return textResult(`Defined the pattern ${pattern.id} "${pattern.name}", ${pattern.size.width}×${pattern.size.height} px, from "${layer.name}"${currentSelection() ? " inside the selection" : ""}. Use it with set_layer_style (pattern: "${pattern.id}").`);
  },
  async apply_style(input, ctx) {
    const preset = findStyle(String(input.style ?? ""));
    if (!preset) throw new Error(`No style "${String(input.style)}". The styles: ${allStyles().map((s) => `"${s.name}"`).join(", ")}.`);
    const add = input.add === true;
    const target = await targetOf(ctx);
    const layers = (Array.isArray(input.layers) ? input.layers : [input.layers]).map((r) => findLayerRef(target.doc, r));
    const ids = layers.filter((l) => l.kind !== "adjustment").map((l) => l.id);
    if (!ids.length) throw new Error("Give image or pixel layers: adjustment layers have no effects.");
    if (preset.patterns?.length && !target.open) throw new Error(`"${preset.name}" brings patterns of its own: open the photo in the editor first.`);
    const patterns = target.open ? await materialise(preset) : [];
    const result = { doc: styleEdit(preset, ids, add, patterns)(target.doc) };
    if (target.open && usePhoto.getState().projectId === target.projectId) usePhoto.getState().commit(styleEdit(preset, ids, add, patterns));
    else await api.saveDocument("photo", target.projectId, result.doc);
    const lines = ids.map((id) => {
      const l = result.doc.layers.find((x) => x.id === id)!;
      return `"${l.name}": ${describeStyle(l) ?? "no effects"}`;
    });
    return textResult(`${add ? "Added" : "Applied"} the style "${preset.name}". ${lines.join("; ")}.`, { added: [], changed: ids, removed: 0 });
  },
  async save_style(input, ctx) {
    const target = await targetOf(ctx);
    const layer = findLayerRef(target.doc, input.layer);
    if (typeof input.name !== "string" || !input.name.trim()) throw new Error("Give the style a name.");
    if (stylePatterns([layer]).some((id) => !id.startsWith("builtin:")) && !target.open) throw new Error("Its effects use the photo's own patterns: open the photo in the editor first, so they can be kept with the style.");
    const kept = await newStyle(target.doc, layer, input.name, input.blending === true, input.effects !== false);
    return textResult(`Kept "${layer.name}"'s ${input.effects !== false ? "effects" : ""}${input.blending === true ? `${input.effects !== false ? " and " : ""}Blending Options` : ""} as the style "${kept.name}" (${kept.effects.length} effects${kept.patterns?.length ? `, ${kept.patterns.length} pattern${kept.patterns.length > 1 ? "s" : ""}` : ""}): apply_style can use it on any layer and photo.`);
  },
  add_adjustment: edit(addAdjustmentTool),
  set_effect_params: edit(setEffectParamsTool),
  add_filter: edit(addFilterTool),
  set_filter: edit(setFilterTool),
  remove_filter: edit(removeFilterTool),
  add_generator: edit(addGeneratorTool),
  move_handle: edit(moveHandleTool),
  async merge_layers(input, ctx) {
    const target = await targetOf(ctx);
    const { kind, ids } = mergeRequest(target.doc, input);
    const plan = planWith(target.doc, kind, ids, target.assets);
    if ("error" in plan) throw new Error(plan.error);
    ctx.progress(0, "Merging");
    const asset = await renderMerge(target.projectId, target.doc, plan, target.assets);
    const layer = mergedLayer(plan, createId("layer"), asset.id);
    let doc: PhotoProject | null;
    if (target.open && usePhoto.getState().projectId === target.projectId) {
      usePhoto.setState((s) => ({ assets: [...s.assets, asset] }));
      doc = replaceWithMerged(usePhoto.getState().history!.doc.doc, target.doc, plan.ids, layer);
      if (doc) {
        const merged = doc;
        usePhoto.getState().commit(() => merged);
        usePhotoUi.getState().select(layer.id);
      }
    } else {
      doc = replaceWithMerged(target.doc, target.doc, plan.ids, layer);
      if (doc) await api.saveDocument("photo", target.projectId, doc);
    }
    if (!doc) throw new Error("The layers changed while they were being merged (the user edited them): nothing was merged. Read the photo again and retry.");
    const names = target.doc.layers.filter((l) => plan.ids.includes(l.id)).map((l) => `"${l.name}"`);
    const assets = [...target.assets, asset];
    return textResult(`Merged ${names.join(", ")} into one image layer, ${plan.box.width}×${plan.box.height} px:\n${describeLayer(layer, assets, doc.layers.indexOf(layer))}`, {
      added: [layer.id],
      changed: [],
      removed: plan.ids.length,
    });
  },
  add_pixel_layer: edit(addPixelLayerTool),
  async select_rect(input) {
    const doc = openDoc();
    if (input.none === true) {
      usePhoto.getState().select(null);
      return textResult("Deselected.");
    }
    const mode = selectionMode(input.mode);
    let shape: PhotoSelection | null;
    if (input.all === true) shape = allSelection(doc.canvas);
    else {
      const x = n(input.x, "x");
      const y = n(input.y, "y");
      const b = { x: x + n(input.width, "width"), y: y + n(input.height, "height") };
      shape = input.shape === "ellipse" ? ellipseSelection({ x, y }, b, doc.canvas) : rectSelection({ x, y }, b, doc.canvas);
      if (!shape) throw new Error(`That ${input.shape === "ellipse" ? "ellipse" : "rectangle"} is off the canvas (${doc.canvas.width}×${doc.canvas.height} px): nothing would be selected.`);
    }
    applySelection(feathered(shape, input.feather, doc), mode);
    return selectionResult(mode);
  },
  async select_polygon(input) {
    const doc = openDoc();
    const points = Array.isArray(input.points) ? input.points : [];
    const outline = points.map((p, i) => {
      if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === "number" && Number.isFinite(v))) throw new Error(`points[${i}] must be [x, y] in canvas pixels.`);
      return { x: p[0] as number, y: p[1] as number };
    });
    if (outline.length < 3) throw new Error("Give at least three points: the outline's corners, [[x, y], …].");
    const shape = polygonSelection(outline, doc.canvas, input.anti_alias !== false);
    if (!shape) throw new Error(`That outline covers nothing of the canvas (${doc.canvas.width}×${doc.canvas.height} px).`);
    const mode = selectionMode(input.mode);
    applySelection(feathered(shape, input.feather, doc), mode);
    return selectionResult(mode);
  },
  async select_magic_wand(input) {
    const doc = openDoc();
    const at = { x: n(input.x, "x"), y: n(input.y, "y") };
    if (at.x < 0 || at.y < 0 || at.x >= doc.canvas.width || at.y >= doc.canvas.height) throw new Error(`(${at.x}, ${at.y}) is off the canvas (${doc.canvas.width}×${doc.canvas.height} px).`);
    const sizes = [1, 3, 5, 11, 31, 51, 101];
    if (input.sample_size !== undefined && !sizes.includes(input.sample_size as number)) throw new Error(`sample_size must be one of ${sizes.join(", ")}.`);
    const tolerance = input.tolerance === undefined ? 32 : n(input.tolerance, "tolerance");
    if (tolerance < 0 || tolerance > 255) throw new Error("tolerance must be 0..255.");
    const mode = selectionMode(input.mode);
    await wandAt(at, mode, {
      tolerance,
      contiguous: input.contiguous !== false,
      antiAlias: input.anti_alias !== false,
      sampleSize: (input.sample_size as number | undefined) ?? 1,
      sampleAll: input.sample_all_layers !== false,
    });
    return selectionResult(mode);
  },
  async select_quick(input) {
    const doc = openDoc();
    const strokes = (Array.isArray(input.strokes) ? input.strokes : []).map((stroke, i) => {
      if (!Array.isArray(stroke) || stroke.length === 0) throw new Error(`strokes[${i}] must be a list of [x, y] points.`);
      return stroke.map((p, j) => {
        if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === "number" && Number.isFinite(v))) throw new Error(`strokes[${i}][${j}] must be [x, y] in canvas pixels.`);
        return { x: p[0] as number, y: p[1] as number };
      });
    });
    if (!strokes.length) throw new Error("Give at least one stroke: [[[x, y], …]].");
    const size = input.size === undefined ? 30 : n(input.size, "size");
    if (size < 1 || size > 2500) throw new Error("size must be 1..2500 pixels.");
    const mode: SelectionMode = input.mode === "new" || input.mode === "subtract" ? input.mode : currentSelection() ? "add" : "new";
    const session = await startQuickSelection(doc, mode, size / 2, input.sample_all_layers !== false);
    for (const stroke of strokes) session.q.paint(dabsAlong(stroke.map((p) => ({ x: p.x * session.scale, y: p.y * session.scale })), Math.max(0.75, (size / 2) * session.scale)));
    if (currentDoc() !== doc) throw new Error("The photo changed while it was being read (the user edited it): nothing was selected. Try again.");
    const result = quickSelectionResult(session, false);
    if (result === undefined) return textResult(`Nothing changed: the strokes were all ${mode === "subtract" ? "outside" : "inside"} the selection already. Selection: ${selectionText()}.`);
    usePhoto.getState().select(result);
    return selectionResult(mode);
  },
  async select_subject(input) {
    openDoc();
    const mode = selectionMode(input.mode);
    await selectSubject(mode);
    return selectionResult(mode);
  },
  async modify_selection(input) {
    const doc = openDoc();
    if (!currentSelection()) throw new Error("There's no selection to change: make one first (select_rect, select_subject…).");
    if (input.action === "invert") selectActions.inverse();
    else if (input.action === "feather") {
      const radius = n(input.radius, "radius");
      if (radius <= 0 || radius > 250) throw new Error("radius must be more than 0 and at most 250 pixels.");
      usePhoto.getState().select(featherSelection(currentSelection()!, radius, doc.canvas));
    } else throw new Error('action must be "invert" or "feather".');
    return textResult(`Selection: ${selectionText()}.`);
  },
  async add_mask(input, ctx) {
    if (input.remove === true || input.from !== "selection") return edit(maskTool)(input, ctx);
    const target = await targetOf(ctx);
    const selection = target.open ? currentSelection() : null;
    if (!selection) throw new Error("There's no selection: make one first (select_rect, select_polygon, select_magic_wand, select_quick or select_subject; a selection belongs to the photo open in the editor), or use from: empty.");
    const layer = findLayerRef(target.doc, input.layer);
    const surface = await withRenderer(target.projectId, target.doc, target.assets, (r) => r.maskFromSelection(target.doc, layer.id, selection));
    usePhoto.getState().commit((d) => setMask(d, layer.id, surface));
    usePhotoUi.getState().select(layer.id);
    usePhotoUi.getState().setTarget("mask");
    return textResult(`Gave "${layer.name}" a mask from the selection (${describeSelection(selection, target.doc.canvas)}): it shows only there.`, { added: [], changed: [layer.id], removed: 0 });
  },
  async layer_via_copy(input, ctx) {
    const target = await targetOf(ctx);
    if (!target.open) throw new Error("Open the photo in the editor first: copying pixels needs it on the GPU, and the selection is the open photo's.");
    if (!currentSelection()) throw new Error("There's no selection: make one first (select_rect, select_subject…).");
    const layer = findLayerRef(target.doc, input.layer);
    const id = await editActions.layerVia(input.cut === true, layer.id);
    if (!id) throw new Error(`Nothing was copied from "${layer.name}": ${layer.kind === "adjustment" ? "an adjustment layer has no pixels" : input.cut === true && layer.kind === "image" ? "a placed image can't be cut (copy it, or ask the user to convert it to pixels)" : "the selection is empty there"}.`);
    return textResult(`${input.cut === true ? "Cut" : "Copied"} the selection of "${layer.name}" to a new layer ${id} above it.`, { added: [id], changed: input.cut === true ? [layer.id] : [], removed: 0 });
  },
  async fill_selection(input, ctx) {
    const target = await targetOf(ctx);
    if (!target.open) throw new Error("Open the photo in the editor first: filling needs it on the GPU.");
    const layer = findLayerRef(target.doc, input.layer);
    const spec = String(input.with ?? "").trim().toLowerCase();
    const colours = useColours.getState();
    const colour = spec === "foreground" ? colours.foreground : spec === "background" ? colours.background : spec === "clear" ? null : /^#[0-9a-f]{6}$/.test(spec) ? spec : undefined;
    if (colour === undefined) throw new Error('with must be "foreground", "background", "clear" or a colour like "#ff8800".');
    if (layer.kind === "image" && input.target !== "mask") throw new Error(`"${layer.name}" is a placed image, kept whole: fill a pixel layer above it (add_pixel_layer) or its mask (target: mask).`);
    if (input.target === "mask" && !layer.mask) throw new Error(`"${layer.name}" has no mask: add one with add_mask.`);
    const before = usePhoto.getState().history?.doc.doc;
    usePhotoUi.getState().select(layer.id);
    usePhotoUi.getState().setTarget(input.target === "mask" ? "mask" : "content");
    await editActions.fill(colour, layer.id);
    if (usePhoto.getState().history?.doc.doc === before) throw new Error("Nothing changed: the selection misses that layer.");
    return textResult(`Filled the ${currentSelection() ? "selection" : "whole layer"} on "${layer.name}"${input.target === "mask" ? "'s mask" : ""} with ${colour ?? "nothing (cleared)"}.`, { added: [], changed: [layer.id], removed: 0 });
  },
  remove_layer: edit(removeLayerTool),
  set_canvas: edit(setCanvasTool),
  async export_photo(input, ctx) {
    const target = await targetOf(ctx);
    const format = input.format === "jpeg" ? "jpeg" : "png";
    const quality = typeof input.quality === "number" ? Math.max(1, Math.min(100, Math.round(input.quality))) : 92;
    const bits = format === "png" && String(input.bits) === "16" ? 16 : 8;
    const name = `${target.doc.name.replace(/[^\w .,()'&+-]+/g, " ").trim() || "Photo"}.${format === "jpeg" ? "jpg" : "png"}`;
    ctx.progress(0, "Exporting");
    const result = await withRenderer(target.projectId, target.doc, target.assets, (r) => r.export(target.projectId, target.doc, { name, format, bits, quality }, (f) => ctx.progress(f, "Exporting"), ctx.signal));
    return textResult(`Exported ${name} (${target.doc.canvas.width}×${target.doc.canvas.height}, ${bits}-bit, ${Math.round(result.bytes / 1024)} KB) to ${result.path}.`);
  },
  async crop_canvas(input, ctx) {
    const target = await targetOf(ctx);
    const { box, text } = canvasCropOf(target.doc, input, target.open ? currentSelection() : null);
    // Masks in document pixels move with the canvas (whole pixels, exactly), uploaded as a stroke's tiles are.
    const masks = box.x || box.y ? documentMasks(target.doc) : [];
    const uploads = uploadsFor(target.projectId);
    const moved = masks.length ? await shiftSurfaces(uploads, masks, -box.x, -box.y, { width: box.width, height: box.height }) : new Map<string, string>();
    if (target.open && usePhoto.getState().projectId === target.projectId) {
      if (currentDoc() !== target.doc) throw new Error("The photo changed while it was being cropped (the user edited it): nothing was cropped. Read it again and retry.");
      usePhoto.getState().commitState((state) => cropCanvas(state, box, moved));
    } else {
      const next = cropCanvas({ doc: target.doc, selection: null }, box, moved).doc;
      await uploads.ready(next);
      await api.saveDocument("photo", target.projectId, next);
    }
    return textResult(text);
  },
  crop_layer: edit(cropLayerTool),
};

export async function runPhotoTool(name: string, input: Input, ctx: ToolRunContext): Promise<ToolResult> {
  const handler = (TOOLS as Record<string, ((input: Input, ctx: ToolRunContext) => Promise<ToolResult>) | undefined>)[name];
  if (!handler) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  return handler(input, ctx);
}

/** The open photo's document (a selection is the open photo's). */
function openDoc(): PhotoProject {
  const doc = currentDoc();
  if (!doc) throw new Error("No photo is open in the editor: a selection belongs to the open one.");
  return doc;
}

/** A number the model gave, or a message saying what's wanted. */
function n(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Give ${name} as a number (canvas pixels).`);
  return v;
}

function selectionMode(v: unknown): SelectionMode {
  if (v === undefined) return "new";
  if (v === "new" || v === "add" || v === "subtract" || v === "intersect") return v;
  throw new Error('mode must be "new", "add", "subtract" or "intersect".');
}

function feathered(shape: PhotoSelection | null, radius: unknown, doc: PhotoProject): PhotoSelection | null {
  if (radius === undefined || radius === 0) return shape;
  const r = n(radius, "feather");
  if (r < 0 || r > 250) throw new Error("feather must be 0..250 pixels.");
  return shape && r > 0 ? featherSelection(shape, r, doc.canvas) : shape;
}

const selectionText = () => {
  const s = currentSelection();
  const doc = currentDoc();
  return s && doc ? describeSelection(s, doc.canvas) : "none (nothing is selected)";
};

/** What a selection tool tells the model: the selection now (look with view_photo to see it). */
const selectionResult = (mode: SelectionMode) => textResult(`${mode === "new" ? "Selected" : `Selection (${mode})`}: ${selectionText()}. view_photo with show_selection: true shows it.`);

/** A picture with what the selection leaves out tinted red at half strength (Photoshop's Quick Mask). */
async function quickMask(picture: Blob, selection: PhotoSelection, canvas: { width: number; height: number }): Promise<Blob> {
  const image = await createImageBitmap(picture);
  const { width, height } = image;
  const out = new OffscreenCanvas(width, height);
  const g = out.getContext("2d")!;
  g.drawImage(image, 0, 0);
  const tint = g.createImageData(width, height);
  const sx = canvas.width / width;
  const sy = canvas.height / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // The selection's coverage over the document pixels under this picture pixel.
      const c = boxCoverage(selection, { x0: x * sx, y0: y * sy, x1: (x + 1) * sx, y1: (y + 1) * sy });
      const i = (y * width + x) * 4;
      tint.data[i] = 255;
      tint.data[i + 3] = Math.round((1 - c) * 128);
    }
  }
  const layer = new OffscreenCanvas(width, height);
  layer.getContext("2d")!.putImageData(tint, 0, 0);
  g.drawImage(layer, 0, 0);
  return out.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}
