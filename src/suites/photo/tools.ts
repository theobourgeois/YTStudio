/**
 * The photo suite's tools (`shared/photo/tools.ts`), run in the tab. `PhotoToolName` makes TypeScript insist every
 * tool has a handler. Edits are the pure functions of `tool-edits.ts`, applied to the open photo as one undo step,
 * or to a photo that isn't open by loading and saving it. Pictures and exports render with the same compositor as
 * the canvas.
 */
import { createId } from "@shared/ids";
import { setMask } from "@shared/photo/edits";
import { mergedLayer, replaceWithMerged } from "@shared/photo/merge";
import { allSelection, rectSelection } from "@shared/photo/selection";
import type { PhotoToolName } from "@shared/photo/tools";
import type { PhotoProject } from "@shared/photo/types";
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
import { currentSelection } from "./store";
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
} from "./tool-edits";
import { usePhotoUi } from "./ui";

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
    const blob = await withRenderer(target.projectId, target.doc, target.assets, (r) => r.picture(target.doc, width));
    return {
      content: [
        { type: "text", text: `"${target.doc.name}", ${target.doc.canvas.width}×${target.doc.canvas.height} px, shown ${width} px wide (transparency over a checkerboard).` },
        { type: "image", data: await base64(blob), mimeType: "image/jpeg" },
      ],
    };
  },
  add_image_layer: edit(addImageLayerTool),
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
    const open = usePhoto.getState();
    const doc = open.history?.doc.doc;
    if (!doc) throw new Error("No photo is open in the editor: a selection belongs to the open one.");
    let selection = null;
    if (input.all === true) selection = allSelection(doc.canvas);
    else if (input.none !== true) {
      const n = (v: unknown, name: string) => {
        if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Give ${name} in canvas pixels (or all: true, or none: true).`);
        return v;
      };
      const x = n(input.x, "x");
      const y = n(input.y, "y");
      selection = rectSelection({ x, y }, { x: x + n(input.width, "width"), y: y + n(input.height, "height") }, doc.canvas);
      if (!selection) throw new Error(`That rectangle is off the canvas (${doc.canvas.width}×${doc.canvas.height} px): nothing would be selected.`);
    }
    open.select(selection);
    return textResult(selection ? `Selected x ${selection.x}..${selection.x + selection.width}, y ${selection.y}..${selection.y + selection.height} (${selection.width}×${selection.height} px).` : "Deselected.");
  },
  async add_mask(input, ctx) {
    if (input.remove === true || input.from !== "selection") return edit(maskTool)(input, ctx);
    const target = await targetOf(ctx);
    const selection = target.open ? currentSelection() : null;
    if (!selection) throw new Error("There's no selection: select_rect first (a selection belongs to the photo open in the editor), or use from: empty.");
    const layer = findLayerRef(target.doc, input.layer);
    const surface = await withRenderer(target.projectId, target.doc, target.assets, (r) => r.maskFromSelection(target.doc, layer.id, selection));
    usePhoto.getState().commit((d) => setMask(d, layer.id, surface));
    usePhotoUi.getState().select(layer.id);
    usePhotoUi.getState().setTarget("mask");
    return textResult(`Gave "${layer.name}" a mask from the selection: it shows only inside x ${selection.x}..${selection.x + selection.width}, y ${selection.y}..${selection.y + selection.height}.`, { added: [], changed: [layer.id], removed: 0 });
  },
  async layer_via_copy(input, ctx) {
    const target = await targetOf(ctx);
    if (!target.open) throw new Error("Open the photo in the editor first: copying pixels needs it on the GPU, and the selection is the open photo's.");
    if (!currentSelection()) throw new Error("There's no selection: select_rect first.");
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
};

export async function runPhotoTool(name: string, input: Input, ctx: ToolRunContext): Promise<ToolResult> {
  const handler = (TOOLS as Record<string, ((input: Input, ctx: ToolRunContext) => Promise<ToolResult>) | undefined>)[name];
  if (!handler) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  return handler(input, ctx);
}
