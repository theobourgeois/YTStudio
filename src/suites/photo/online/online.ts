/**
 * The Online panel's state and its one action (docs/photo/online.md): what's searched and found (kept while the
 * panel's tab is away), and a result placed as a layer: downloaded into the project's media by the server, then
 * placed as a dropped file is. An icon is drawn in the foreground colour at the panel's size; Remove background
 * runs Select Subject on the placed layer alone and makes that its mask.
 */
import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { setMask } from "@shared/photo/edits";
import { bounds } from "@shared/photo/layers";
import { type OnlinePlaceRequest, type OnlineResult, type OnlineSource, type WebFilter, iconSizeFor, isLink, onlineLayerName } from "@shared/photo/online";
import type { MediaAsset } from "@shared/types";
import { photoApi } from "../api";
import { useColours } from "../colours";
import { useSourceStates, withRenderer } from "../live";
import { currentDoc, currentSelection, usePhoto } from "../store";
import { SubjectModelMissing, selectSubject, useSubjectModel } from "../subject-model";
import { usePhotoUi } from "../ui";

type Point = { x: number; y: number };

/** The panel's tabs: the link source isn't one (a link typed into any of them is read). */
export type OnlineTab = Exclude<OnlineSource, "link">;

interface OnlineState {
  tab: OnlineTab;
  query: string;
  filter: WebFilter;
  /** An icon's size in pixels; null: what the canvas suggests (`iconSizeFor`). */
  iconSize: number | null;
  /** What was found for `searched` in `searchedTab`, and the page after it (null: no more). */
  results: OnlineResult[];
  searched: { tab: OnlineTab; query: string; filter: WebFilter } | null;
  next: number | null;
  loading: boolean;
  error: string | null;
  /** Results being placed (by id), for their cards' spinner. */
  placing: string[];
  set: (patch: Partial<Pick<OnlineState, "tab" | "query" | "filter" | "iconSize">>) => void;
  search: () => Promise<void>;
  more: () => Promise<void>;
}

let controller: AbortController | null = null;

export const useOnline = create<OnlineState>((set, get) => ({
  tab: "icons",
  query: "",
  filter: "any",
  iconSize: null,
  results: [],
  searched: null,
  next: null,
  loading: false,
  error: null,
  placing: [],

  set(patch) {
    set(patch);
  },

  async search() {
    const { tab, filter } = get();
    const query = get().query.trim();
    controller?.abort();
    if (!query) return set({ results: [], searched: null, next: null, loading: false, error: null });
    const mine = (controller = new AbortController());
    set({ loading: true, error: null, results: [], next: null, searched: { tab, query, filter } });
    try {
      const found = await photoApi.searchOnline(isLink(query) ? "link" : tab, query, 0, filter, mine.signal);
      if (controller === mine) set({ results: found.results, next: found.next, loading: false });
    } catch (error) {
      if (controller === mine && !mine.signal.aborted) set({ loading: false, error: errorMessage(error) });
    }
  },

  async more() {
    const { searched, next, loading, results } = get();
    if (!searched || next === null || loading) return;
    const mine = (controller = new AbortController());
    set({ loading: true });
    try {
      const found = await photoApi.searchOnline(isLink(searched.query) ? "link" : searched.tab, searched.query, next, searched.filter, mine.signal);
      if (controller !== mine) return;
      const seen = new Set(results.map((r) => r.id));
      set({ results: [...results, ...found.results.filter((r) => !seen.has(r.id))], next: found.next, loading: false });
    } catch (error) {
      if (controller === mine && !mine.signal.aborted) set({ loading: false, error: errorMessage(error) });
    }
  },
}));

/** The size an icon is drawn at for the open photo. */
export function iconSize(): number {
  const doc = currentDoc();
  return useOnline.getState().iconSize ?? (doc ? iconSizeFor(doc.canvas) : 512);
}

/** What the server is asked to place for `result`: an icon at the panel's size, in the foreground colour. */
export function placeRequest(result: OnlineResult, options: { size?: number; colour?: string } = {}): OnlinePlaceRequest {
  const request: OnlinePlaceRequest = { source: result.source, id: result.id, title: result.title, ...(result.fallback ? { fallback: result.fallback } : {}) };
  if (result.source !== "icons") return request;
  return { ...request, size: options.size ?? iconSize(), ...(result.palette ? {} : { colour: options.colour ?? useColours.getState().foreground }) };
}

/** A downloaded asset placed on top of the open photo (centred on `at`), selected. Returns the layer's id. */
export function placeAsset(asset: MediaAsset, name: string, at?: Point): string | null {
  const photo = usePhoto.getState();
  if (!photo.assets.some((a) => a.id === asset.id)) usePhoto.setState({ assets: [...photo.assets, asset] });
  const id = usePhoto.getState().placeMedia(asset, { name, at });
  if (id) usePhotoUi.getState().select(id);
  return id;
}

/**
 * A result placed on the open photo as a new layer on top, centred on `at` (where it was dropped) or the canvas's
 * middle, and selected; `cutOut` then masks it to its subject. Returns the layer's id, or null if it didn't place
 * (the toast says why).
 */
export async function placeOnline(result: OnlineResult, options: { at?: Point; cutOut?: boolean } = {}): Promise<string | null> {
  const { projectId } = usePhoto.getState();
  if (!projectId) return null;
  useOnline.setState((s) => ({ placing: [...s.placing, result.id] }));
  try {
    const asset = await photoApi.placeOnline(projectId, placeRequest(result));
    if (usePhoto.getState().projectId !== projectId) return null;
    const id = placeAsset(asset, onlineLayerName(result), options.at);
    if (id && options.cutOut) await removeBackground(id);
    return id;
  } catch (error) {
    toast.error(`Couldn't place ${onlineLayerName(result)}`, { description: errorMessage(error) });
    return null;
  } finally {
    useOnline.setState((s) => ({ placing: s.placing.filter((p) => p !== result.id) }));
  }
}

/**
 * Remove background: Select Subject on `layerId` alone, made the layer's mask (so nothing is lost: paint the mask
 * to bring any of it back). The selection there before is put back.
 */
export async function removeBackground(layerId: string): Promise<boolean> {
  const before = currentSelection();
  const working = toast.loading("Removing the background…");
  try {
    // The model looks at the layer's pixels: a layer just placed waits for its image to load.
    const layer = currentDoc()?.layers.find((l) => l.id === layerId);
    if (layer?.kind === "image") await sourceSettled(layer.mediaId);
    // The model looks at the layer's box alone: on the whole canvas, the picture itself is what stands out.
    const asset = layer?.kind === "image" ? usePhoto.getState().assets.find((a) => a.id === layer.mediaId) : undefined;
    const b = layer?.kind === "image" && asset?.width && asset.height ? bounds(layer.transform, { width: asset.width, height: asset.height }) : null;
    const selection = await selectSubject("new", layerId, b ? { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 } : undefined);
    const doc = currentDoc();
    const { projectId, assets } = usePhoto.getState();
    if (!selection || !doc || !projectId) {
      toast.dismiss(working);
      toast("No subject was found to keep.");
      return false;
    }
    const surface = await withRenderer(projectId, doc, assets, (r) => r.maskFromSelection(doc, layerId, selection));
    usePhoto.getState().commit((d) => setMask(d, layerId, surface));
    toast.dismiss(working);
    return true;
  } catch (error) {
    toast.dismiss(working);
    if (error instanceof SubjectModelMissing) {
      if (error.status.status === "downloading") toast(error.message);
      else useSubjectModel.setState({ asking: true, pending: null });
      return false;
    }
    toast.error("Couldn't remove the background", { description: errorMessage(error) });
    return false;
  } finally {
    if (currentSelection() !== before) usePhoto.getState().select(before);
  }
}

/** Resolves once an image's pixels are loaded (or it failed, or a minute passed: Select Subject then says so). */
function sourceSettled(mediaId: string): Promise<void> {
  const settled = () => (useSourceStates.getState().states[mediaId]?.state ?? "loading") !== "loading";
  if (settled()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      stop();
      clearTimeout(timer);
      resolve();
    };
    const stop = useSourceStates.subscribe(() => settled() && done());
    const timer = setTimeout(done, 60_000);
  });
}

/** A result dragged from the panel onto the canvas. */
export const ONLINE_DRAG_MIME = "application/x-vaudio-online";

export function setOnlineDragData(dt: DataTransfer, result: OnlineResult) {
  dt.setData(ONLINE_DRAG_MIME, JSON.stringify(result));
  dt.effectAllowed = "copy";
}

export const isOnlineDrag = (dt: DataTransfer) => dt.types.includes(ONLINE_DRAG_MIME);

/** Only readable on `drop`. */
export function getOnlineDragData(dt: DataTransfer): OnlineResult | null {
  try {
    const parsed = JSON.parse(dt.getData(ONLINE_DRAG_MIME) || "null") as OnlineResult | null;
    return parsed && typeof parsed.id === "string" && typeof parsed.source === "string" ? parsed : null;
  } catch {
    return null;
  }
}
