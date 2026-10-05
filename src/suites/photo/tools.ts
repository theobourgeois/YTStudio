/**
 * The photo suite's tools (`shared/photo/tools.ts`), run in the tab. `PhotoToolName` makes TypeScript insist every
 * tool has a handler. Edits are the pure functions of `tool-edits.ts`, applied to the open photo as one undo step,
 * or to a photo that isn't open by loading and saving it. Pictures and exports render with the same compositor as
 * the canvas.
 */
import type { PhotoToolName } from "@shared/photo/tools";
import type { PhotoProject } from "@shared/photo/types";
import { type ToolResult, textResult } from "@shared/tool-spec";
import type { MediaAsset } from "@shared/types";
import { api } from "@/lib/api";
import type { ToolRunContext } from "../types";
import { withRenderer } from "./live";
import { usePhoto } from "./store";
import {
  type PhotoEdit,
  addImageLayerTool,
  describeMedia,
  describePhoto,
  removeLayerTool,
  setCanvasTool,
  transformLayerTool,
  updateLayerTool,
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
  if (projectId === open.projectId && open.history) return { projectId, doc: open.history.doc, assets: open.assets, open: true };
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
    return textResult(describePhoto(target.doc, target.assets, target.open ? usePhotoUi.getState().selectedLayerId : null));
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
  update_layer: edit(updateLayerTool),
  remove_layer: edit(removeLayerTool),
  set_canvas: edit(setCanvasTool),
  async export_photo(input, ctx) {
    const target = await targetOf(ctx);
    const format = input.format === "jpeg" ? "jpeg" : "png";
    const quality = typeof input.quality === "number" ? Math.max(1, Math.min(100, Math.round(input.quality))) : 92;
    const name = `${target.doc.name.replace(/[^\w .,()'&+-]+/g, " ").trim() || "Photo"}.${format === "jpeg" ? "jpg" : "png"}`;
    ctx.progress(0, "Exporting");
    const result = await withRenderer(target.projectId, target.doc, target.assets, (r) => r.export(target.projectId, target.doc, { name, format, quality }, (f) => ctx.progress(f, "Exporting")));
    return textResult(`Exported ${name} (${target.doc.canvas.width}×${target.doc.canvas.height}, ${Math.round(result.bytes / 1024)} KB) to ${result.path}.`);
  },
};

export async function runPhotoTool(name: string, input: Input, ctx: ToolRunContext): Promise<ToolResult> {
  const handler = (TOOLS as Record<string, ((input: Input, ctx: ToolRunContext) => Promise<ToolResult>) | undefined>)[name];
  if (!handler) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  return handler(input, ctx);
}
