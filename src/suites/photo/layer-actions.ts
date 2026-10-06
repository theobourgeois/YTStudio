/**
 * What the Layers commands do, once: the keys (`keys.ts`), the Layers panel's footer and its menu all run these.
 * They act on every selected layer, as Photoshop's do.
 */
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { createId } from "@shared/ids";
import { stepBlendMode } from "@shared/photo/blending";
import { addFilter, addGeneratorLayer, addPixelLayer, arrangeLayers, duplicateLayers, findLayer, removeFilter, removeLayers, removeMask, replaceLayer, setLayerBlending, setMask, shiftLayers } from "@shared/photo/edits";
import { entryParams, filterEntry } from "@shared/photo/effects/catalog";
import { effectDefinition } from "@shared/photo/effects/index";
import { type BlendMode, type BlendingOptions, type EffectParamValue, type LayerStyle, type PhotoPattern, hasContent } from "@shared/photo/types";
import { remapStylePatterns, setLayerStyle, setStyleEnabled, stylePatterns, withPatterns } from "@shared/photo/style/style";
import { liveRenderer } from "./live";
import { mergeLayers } from "./merge";
import { type LayerSelection, allLayers, edgeLayer, inStackOrder, stepLayer } from "./selection";
import { currentDoc, currentSelection, usePhoto } from "./store";
import { usePhotoUi } from "./ui";
import { type SurfaceUploads, uploadsFor } from "./uploads";

const order = () => usePhoto.getState().history?.doc.doc.layers.map((l) => l.id) ?? [];

/** What Copy Layer Style kept (this tab's, as Photoshop's is the application's). */
let copiedStyle: { style: LayerStyle | null; blend?: BlendMode; fill?: number; blending?: BlendingOptions; patterns: PhotoPattern[]; uploads: SurfaceUploads } | null = null;

/** The selected layers, bottom first. */
export const selectedInOrder = () => inStackOrder(usePhotoUi.getState().selectedLayerIds, order());

const current = (): LayerSelection => ({ ids: usePhotoUi.getState().selectedLayerIds, active: usePhotoUi.getState().selectedLayerId });
const apply = (sel: LayerSelection) => usePhotoUi.getState().setSelection(sel.ids, sel.active);

export const layerActions = {
  /** Delete: the filter shown in Properties, when one is; else the selected layers. */
  delete() {
    const { selectedFilterId, selectedLayerId } = usePhotoUi.getState();
    if (selectedFilterId && selectedLayerId) {
      usePhoto.getState().commit((d) => removeFilter(d, selectedLayerId, selectedFilterId));
      usePhotoUi.getState().selectFilter(selectedLayerId, null);
      return;
    }
    const ids = selectedInOrder();
    if (ids.length) usePhoto.getState().commit((d) => removeLayers(d, ids));
  },

  /**
   * A filter (Photoshop's Smart Filter: the glow) on the active layer, applied after its others, shown in Properties.
   * An adjustment has no pixels of its own: it says so.
   */
  addFilter(type: string, layerId: string | null = usePhotoUi.getState().selectedLayerId, params?: Record<string, unknown>) {
    const doc = currentDoc();
    const layer = doc && layerId ? findLayer(doc, layerId) : undefined;
    const def = effectDefinition(type);
    if (!doc || !layer || !def) return void toast.error(`Select a layer to add ${def?.label ?? "a filter"} to.`);
    if (!hasContent(layer)) return void toast.error(`"${layer.name}" is an adjustment layer: ${def.label} works on a layer's own pixels.`);
    const id = createId("fx");
    usePhoto.getState().commit((d) => addFilter(d, layer.id, { id, type, params }));
    usePhotoUi.getState().selectFilter(layer.id, id);
    const made = findLayer(currentDoc()!, layer.id);
    const added = made && hasContent(made) ? made.filters?.find((f) => f.id === id) : undefined;
    if (added) usePhotoUi.getState().setLastFilter({ type, layerId: layer.id, filterId: id, params: added.params });
    return id;
  },

  /**
   * A look from the Filter menu or the Filter Gallery (`FilterEntry.key`): a filter on the active layer, shown in
   * Properties; or a generator, a new layer above it, selected. With `params` (the gallery's settings), else its
   * preset's for this canvas.
   */
  applyFilter(key: string, params?: Record<string, EffectParamValue>) {
    const entry = filterEntry(key);
    const doc = currentDoc();
    if (!entry || !doc) return null;
    const settings = params ?? entryParams(entry, doc.canvas);
    if (entry.def.kind === "filter") return layerActions.addFilter(entry.def.type, undefined, settings) ?? null;
    const id = createId("layer");
    usePhoto.getState().commit((d) => addGeneratorLayer(d, { id, type: entry.def.type, params: settings }, usePhotoUi.getState().selectedLayerId));
    usePhotoUi.getState().select(id);
    usePhotoUi.getState().setTool("move");
    return id;
  },

  /** Filter › Last Filter (⌃⌘F): the filter added last, again, on the active layer, with that filter's settings now. */
  repeatLastFilter() {
    const last = usePhotoUi.getState().lastFilter;
    const doc = currentDoc();
    if (!last || !doc) return void toast.message("No filter has been added yet: pick one from the Filter menu.");
    const made = findLayer(doc, last.layerId);
    const now = made && hasContent(made) ? made.filters?.find((f) => f.id === last.filterId) : undefined;
    return layerActions.addFilter(last.type, undefined, now?.params ?? last.params);
  },

  /** A new Lens Flare above the active layer (or on top), selected, its handles on the canvas. */
  addFlare(preset = "classic") {
    const id = createId("layer");
    usePhoto.getState().commit((d) => addGeneratorLayer(d, { id, type: "lens-flare", preset }, usePhotoUi.getState().selectedLayerId));
    usePhotoUi.getState().select(id);
    usePhotoUi.getState().setTool("move");
    return id;
  },
  /** ⌘J: a copy of each above it, the copies selected. */
  duplicate() {
    const ids = selectedInOrder();
    if (!ids.length) return;
    const copies = new Map(ids.map((id) => [id, createId("layer")]));
    usePhoto.getState().commit((d) => duplicateLayers(d, ids, (id) => copies.get(id)!));
    const active = usePhotoUi.getState().selectedLayerId;
    usePhotoUi.getState().setSelection([...copies.values()], active ? copies.get(active) : null);
  },
  shift(direction: 1 | -1) {
    const ids = selectedInOrder();
    if (ids.length) usePhoto.getState().commit((d) => shiftLayers(d, ids, direction));
  },
  arrange(to: "top" | "bottom") {
    const ids = selectedInOrder();
    if (ids.length) usePhoto.getState().commit((d) => arrangeLayers(d, ids, to));
  },
  merge: () => mergeLayers("auto"),
  mergeVisible: () => mergeLayers("visible"),
  selectAll: () => apply(allLayers(current(), order())),
  deselect: () => usePhotoUi.getState().select(null),
  /** The selected layers' blend mode (one undo step). */
  setBlendMode: (blend: BlendMode) => {
    const ids = usePhotoUi.getState().selectedLayerIds;
    if (ids.length) usePhoto.getState().commit((d) => setLayerBlending(d, ids, { blend }));
  },
  /** The active layer's next or previous mode, on every selected layer (Photoshop's ⇧+ / ⇧−). */
  stepBlendMode: (direction: 1 | -1) => {
    const { selectedLayerId } = usePhotoUi.getState();
    const layer = selectedLayerId ? findLayer(usePhoto.getState().history!.doc.doc, selectedLayerId) : undefined;
    if (layer) layerActions.setBlendMode(stepBlendMode(layer.blend ?? "normal", direction));
  },
  /**
   * The Layer Style window for `layerId` (default: the active layer), which it selects, on a page: Blending Options,
   * an effect's (its id), or an effect type's (its first instance, added at the user's defaults when it has none).
   */
  blendingOptions: (layerId?: string, page = "blending") => {
    const ui = usePhotoUi.getState();
    const id = layerId ?? ui.selectedLayerId;
    if (!id) return;
    if (ui.selectedLayerId !== id) ui.select(id);
    ui.setLayerStyle({ layerId: id, page });
  },
  /** Copy Layer Style: the active layer's style (and Blending Options), kept for Paste. */
  copyStyle: () => {
    const { selectedLayerId } = usePhotoUi.getState();
    const { projectId, history } = usePhoto.getState();
    const doc = history!.doc.doc;
    const layer = selectedLayerId ? findLayer(doc, selectedLayerId) : undefined;
    if (!layer || !projectId) return;
    // The photo's patterns it reads go with it (a paste in another photo brings them).
    const used = stylePatterns([layer]);
    const patterns = (doc.patterns ?? []).filter((p) => used.includes(p.id));
    copiedStyle = { style: layer.style ? structuredClone(layer.style) : null, blend: layer.blend, fill: layer.fill, blending: layer.blending ? structuredClone(layer.blending) : undefined, patterns, uploads: uploadsFor(projectId) };
    toast.success(`Copied "${layer.name}"'s layer style`);
  },
  /** Paste Layer Style onto every selected layer (one undo step), with the patterns it reads. */
  pasteStyle: async () => {
    const ids = usePhotoUi.getState().selectedLayerIds;
    const copied = copiedStyle;
    const projectId = usePhoto.getState().projectId;
    if (!copied || !ids.length || !projectId) return;
    try {
      for (const p of copied.patterns) await uploadsFor(projectId).importFrom(copied.uploads, p.surface);
    } catch (error) {
      return void toast.error("Couldn't paste the style's patterns", { description: error instanceof Error ? error.message : String(error) });
    }
    usePhoto.getState().commit((d) => {
      const brought = withPatterns(d, copied.patterns, () => createId("pat"));
      let next = setLayerStyle(brought.doc, ids.filter((id) => findLayer(d, id)?.kind !== "adjustment"), copied.style && remapStylePatterns(copied.style, brought.ids), () => createId("fx"));
      next = setLayerBlending(next, ids, { blend: copied.blend ?? "normal", fill: copied.fill ?? 1, channels: copied.blending?.channels ?? { r: true, g: true, b: true }, blendIf: copied.blending?.blendIf ?? null, interiorAsGroup: copied.blending?.interiorAsGroup ?? false, maskHidesEffects: copied.blending?.maskHidesEffects ?? false });
      return next;
    });
  },
  canPasteStyle: () => copiedStyle !== null,
  /** Clear Layer Style: the selected layers' effects gone, their Blending Options back to Normal. */
  clearStyle: () => {
    const ids = usePhotoUi.getState().selectedLayerIds;
    if (!ids.length) return;
    usePhoto.getState().commit((d) => setLayerBlending(setLayerStyle(d, ids, null, () => createId("fx")), ids, { blend: "normal", fill: 1, channels: { r: true, g: true, b: true }, blendIf: null, interiorAsGroup: false, maskHidesEffects: false }));
  },
  /** Hide All Effects / Show All Effects on the selected layers. */
  showEffects: (shown: boolean) => {
    const ids = usePhotoUi.getState().selectedLayerIds;
    if (ids.length) usePhoto.getState().commit((d) => setStyleEnabled(d, ids, shown));
  },
  step: (direction: 1 | -1, add: boolean) => apply(stepLayer(current(), order(), direction, add)),
  edge: (to: "top" | "bottom", add: boolean) => apply(edgeLayer(current(), order(), to, add)),

  /** ⇧⌘N: an empty pixel layer above the active one (or on top), selected. */
  newLayer(above: string | null = usePhotoUi.getState().selectedLayerId) {
    const id = createId("layer");
    usePhoto.getState().commit((d) => addPixelLayer(d, { id }, above));
    usePhotoUi.getState().select(id);
    return id;
  },

  /**
   * Adds a mask to the active layer (Photoshop's Add Layer Mask button): from the selection when there is one
   * (Reveal Selection), else revealing everything. The mask is then what the brush paints.
   */
  async addMask(layerId: string | null = usePhotoUi.getState().selectedLayerId, { replace = false } = {}) {
    const doc = currentDoc();
    const layer = doc && layerId ? findLayer(doc, layerId) : undefined;
    if (!doc || !layer) return void toast.error("Select a layer to add a mask to.");
    if (layer.mask && !replace) return void toast.message(`"${layer.name}" has a mask already.`);
    const selection = currentSelection();
    let surface = null;
    if (selection) {
      try {
        const renderer = await liveRenderer();
        surface = renderer ? await renderer.maskFromSelection(doc, layer.id, selection) : null;
      } catch (error) {
        return void toast.error("Couldn't make the mask", { description: errorMessage(error) });
      }
    }
    usePhoto.getState().commit((d) => (findLayer(d, layer.id) ? setMask(d, layer.id, surface) : d));
    if (usePhotoUi.getState().selectedLayerId === layer.id) usePhotoUi.getState().setTarget("mask");
  },

  deleteMask(layerId: string | null = usePhotoUi.getState().selectedLayerId) {
    if (!layerId) return;
    usePhoto.getState().commit((d) => removeMask(d, layerId));
    usePhotoUi.getState().setTarget("content");
  },

  /**
   * An image or generator layer as pixels (Photoshop's Rasterize): its transform, filters and mask baked in, in its
   * place (a generator's over the canvas).
   */
  async convertToPixels(layerId: string) {
    const doc = currentDoc();
    const layer = doc ? findLayer(doc, layerId) : undefined;
    if (!doc || (layer?.kind !== "image" && layer?.kind !== "generator")) return;
    try {
      const renderer = await liveRenderer();
      if (!renderer) return;
      const pixels = await renderer.rasterize(doc, layerId);
      usePhoto.getState().commit((d) => {
        const now = findLayer(d, layerId);
        if (!now) return d;
        // Its blending stays the layer's (the pixels are drawn plain).
        const blending = { ...(now.blend ? { blend: now.blend } : {}), ...(now.fill !== undefined ? { fill: now.fill } : {}), ...(now.blending ? { blending: now.blending } : {}) };
        return replaceLayer(d, layerId, { id: layerId, kind: "pixel", name: now.name, visible: now.visible, opacity: now.opacity, ...blending, ...pixels });
      });
      usePhotoUi.getState().setTarget("content");
      toast.success(`"${layer.name}" is pixels now`, { description: "Its place, filters and mask are part of them: scaling it now resamples these pixels." });
    } catch (error) {
      toast.error("Couldn't convert it to pixels", { description: errorMessage(error) });
    }
  },
};
