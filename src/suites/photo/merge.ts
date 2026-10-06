/**
 * Merging layers in the tab (`shared/photo/merge.ts` plans it): the merged layers are rendered alone, as an export
 * is, into a PNG the server makes one of the project's images; then one edit puts it in their place. 16 bits when
 * a merged image has 16, so nothing is lost that was there.
 */
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { createId } from "@shared/ids";
import { type MergeKind, type MergePlan, mergedLayer, planMerge, replaceWithMerged } from "@shared/photo/merge";
import type { PhotoProject, PlacedLayer } from "@shared/photo/types";
import type { MediaAsset } from "@shared/types";
import { photoApi } from "./api";
import { withRenderer } from "./live";
import { usePhoto } from "./store";
import { sizeOf } from "./tool-edits";
import { usePhotoUi } from "./ui";

/** Plans a merge against a project's images. */
export function planWith(doc: PhotoProject, kind: MergeKind, selected: readonly string[], assets: readonly MediaAsset[]) {
  return planMerge(doc, kind, selected, (l: PlacedLayer) => sizeOf(l, assets));
}

/** Renders a merge's layers into a new image of the project (`doc` is the document they're in). */
export async function renderMerge(projectId: string, doc: PhotoProject, plan: MergePlan, assets: readonly MediaAsset[]): Promise<MediaAsset> {
  const deep = plan.doc.layers.some((l) => l.kind === "image" && assets.find((a) => a.id === l.mediaId)?.image?.bits === 16);
  const name = `${plan.name.replace(/[^\w .,()'&+-]+/g, " ").trim().slice(0, 100) || "Merged"}.png`;
  const result = await withRenderer(projectId, doc, [...assets], (r) => r.export(projectId, plan.doc, { name, format: "png", bits: deep ? 16 : 8, origin: plan.box }));
  return photoApi.adoptExport(result.id, projectId);
}

/**
 * ⌘E and the Layers menu's merges, on the open photo: the selected layers (Merge Down with one), or every visible
 * one. Editing goes on while it renders; if the merged layers change meanwhile, nothing is merged (and it says so).
 */
export async function mergeLayers(kind: MergeKind | "auto") {
  const { projectId, history, assets } = usePhoto.getState();
  if (!projectId || !history) return;
  const doc = history.doc.doc;
  const selected = usePhotoUi.getState().selectedLayerIds;
  const how = kind === "auto" ? (selected.length === 1 ? "down" : "selected") : kind;
  const plan = planWith(doc, how, selected, assets);
  if ("error" in plan) {
    toast.error("Couldn't merge", { description: plan.error });
    return;
  }
  // A big merge takes a moment: say so if it does.
  const notice = setTimeout(() => toast.loading("Merging…", { id: "photo-merge" }), 400);
  try {
    const asset = await renderMerge(projectId, doc, plan, assets);
    if (usePhoto.getState().projectId !== projectId) return;
    usePhoto.setState((s) => ({ assets: [...s.assets, asset] }));
    const layer = mergedLayer(plan, createId("layer"), asset.id);
    let merged = false;
    usePhoto.getState().commit((d) => {
      const next = replaceWithMerged(d, doc, plan.ids, layer);
      merged = next !== null;
      return next ?? d;
    });
    if (merged) usePhotoUi.getState().select(layer.id);
    else toast.error("Couldn't merge", { description: "The layers changed while they were being merged. Try again." });
  } catch (error) {
    toast.error("Couldn't merge", { description: errorMessage(error) });
  } finally {
    clearTimeout(notice);
    toast.dismiss("photo-merge");
  }
}
