/**
 * The selection tools' side in the tab (docs/photo/selections.md): their options (Photoshop's options bar, kept in
 * this browser across photos, as the brush's are), the photo's pixels they look at (sampled by the renderer, kept
 * while the photo doesn't change), and the commands every selection tool, the Select menu, the canvas's right-click
 * menu and the assistant share. A selection is an undo step of the open photo (`usePhoto.select`).
 */
import { create } from "zustand";
import { toast } from "sonner";
import { type WandOptions, magicWand } from "@shared/photo/magic-wand";
import { type PixelSample, coverageToSelection, halveSample, sampleScale, selectionAtSample } from "@shared/photo/pixel-sample";
import { QuickSelection, enhance, quickLevel } from "@shared/photo/quick-select";
import { allSelection, combineSelections, coverageIn, invertSelection, pixelCoverage } from "@shared/photo/selection";
import { featherSelection } from "@shared/photo/selection-shapes";
import type { PhotoProject, PhotoSelection, SelectionMode } from "@shared/photo/types";
import { liveRenderer } from "./live";
import { currentDoc, currentSelection, usePhoto } from "./store";
import { usePhotoUi } from "./ui";

const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
const KEY = "photo-select";

export interface SelectOptions {
  /** What a selection does to the one there (Shift, Alt and both pick another for one press). */
  mode: SelectionMode;
  /** Pixels the Marquees' and the Lassos' edges are feathered by (0: none). */
  feather: number;
  /** Smooth edges: the Elliptical Marquee, the Lassos and the Magic Wand. */
  antiAlias: boolean;
  /** The Magic Wand's (0..255). */
  tolerance: number;
  contiguous: boolean;
  /** Read every layer as the photo shows (else the active layer alone): the Magic Wand, Quick and Object Selection. */
  sampleAll: boolean;
  /** The Magic Wand's sample size, in document pixels a side (1: the pixel). */
  sampleSize: number;
  /** Quick Selection's brush diameter, document pixels. */
  quickSize: number;
  /** Quick Selection smooths its edges. */
  autoEnhance: boolean;
  /** The Object Selection tool's brush diameter, document pixels. */
  objectSize: number;
}

const DEFAULTS: SelectOptions = { mode: "new", feather: 0, antiAlias: true, tolerance: 32, contiguous: true, sampleAll: true, sampleSize: 1, quickSize: 30, autoEnhance: false, objectSize: 120 };

const MODES: readonly SelectionMode[] = ["new", "add", "subtract", "intersect"];

export function sanitizeSelectOptions(o: Partial<Record<keyof SelectOptions, unknown>>): SelectOptions {
  const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    mode: MODES.includes(o.mode as SelectionMode) ? (o.mode as SelectionMode) : DEFAULTS.mode,
    feather: num(o.feather, 0, 250, DEFAULTS.feather),
    antiAlias: bool(o.antiAlias, DEFAULTS.antiAlias),
    tolerance: Math.round(num(o.tolerance, 0, 255, DEFAULTS.tolerance)),
    contiguous: bool(o.contiguous, DEFAULTS.contiguous),
    sampleAll: bool(o.sampleAll, DEFAULTS.sampleAll),
    sampleSize: Math.round(num(o.sampleSize, 1, 101, DEFAULTS.sampleSize)),
    quickSize: Math.round(num(o.quickSize, 1, 2500, DEFAULTS.quickSize)),
    autoEnhance: bool(o.autoEnhance, DEFAULTS.autoEnhance),
    objectSize: Math.round(num(o.objectSize, 1, 2500, DEFAULTS.objectSize)),
  };
}

function load(): SelectOptions {
  try {
    return sanitizeSelectOptions(JSON.parse(storage.getItem(KEY) ?? "{}"));
  } catch {
    return DEFAULTS;
  }
}

export const useSelectOptions = create<SelectOptions & { set: (patch: Partial<SelectOptions>) => void }>((set, get) => ({
  ...load(),
  set: (patch) => {
    const next = sanitizeSelectOptions({ ...get(), ...patch });
    storage.setItem(KEY, JSON.stringify(next));
    set(next);
  },
}));

// --- the pixels the tools look at ---

let kept: { doc: PhotoProject; layerId: string | null; levels: PixelSample[] } | null = null;
let sampling: { doc: PhotoProject; layerId: string | null; sample: Promise<PixelSample> } | null = null;

/** Which pixels a tool reads: every layer as shown, or the active layer's (an adjustment has none: then every layer). */
export function sampledLayer(doc: PhotoProject, sampleAll: boolean): string | null {
  if (sampleAll) return null;
  const id = usePhotoUi.getState().selectedLayerId;
  const layer = id ? doc.layers.find((l) => l.id === id) : undefined;
  return layer && layer.kind !== "adjustment" ? layer.id : null;
}

/**
 * The open photo's pixels for a selection tool (level 0: at most `MAX_SAMPLE_SIDE` a side; each level after halves
 * it), sampled once while the photo doesn't change.
 */
export async function photoSample(doc: PhotoProject, layerId: string | null, level = 0): Promise<PixelSample> {
  let levels: PixelSample[];
  if (kept?.doc === doc && kept.layerId === layerId) levels = kept.levels;
  else {
    if (!(sampling?.doc === doc && sampling.layerId === layerId)) {
      const renderer = liveRenderer();
      if (!renderer) throw new Error("No photo is open.");
      sampling = { doc, layerId, sample: renderer.then((r) => r.samplePixels(doc, sampleScale(doc.canvas), layerId)) };
    }
    const mine = sampling;
    const sample = await mine.sample.finally(() => {
      if (sampling === mine) sampling = null;
    });
    if (!(kept?.doc === doc && kept.layerId === layerId)) kept = { doc, layerId, levels: [sample] };
    levels = kept.levels;
  }
  while (levels.length <= level && (levels.at(-1)!.width > 1 || levels.at(-1)!.height > 1)) levels.push(halveSample(levels.at(-1)!));
  return levels[Math.min(level, levels.length - 1)];
}

/** Lets go of the kept pixels (another photo opened). */
export function forgetSamples() {
  kept = null;
  sampling = null;
}

usePhoto.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) forgetSamples();
});

// --- commands ---

/** A selection made by a tool, meeting the one there by `mode`: one undo step (nothing, when it's the same). */
export function applySelection(shape: PhotoSelection | null, mode: SelectionMode) {
  usePhoto.getState().select(combineSelections(currentSelection(), shape, mode));
}

/** The Magic Wand clicked at document point `at`. */
export async function wandAt(at: { x: number; y: number }, mode: SelectionMode, options: Partial<WandOptions & { sampleAll: boolean }> = {}): Promise<PhotoSelection | null> {
  const doc = currentDoc();
  if (!doc) return null;
  const o = { ...useSelectOptions.getState(), ...options };
  const sample = await photoSample(doc, sampledLayer(doc, o.sampleAll));
  const shape = magicWand(sample, at, { tolerance: o.tolerance, contiguous: o.contiguous, antiAlias: o.antiAlias, sampleSize: o.sampleSize }, doc.canvas);
  // The photo changed while it was sampled: a click on the one that was there is no longer meant.
  if (currentDoc() !== doc) return currentSelection();
  applySelection(shape, mode);
  return currentSelection();
}

export const selectActions = {
  /** ⌘A: the whole canvas. */
  all() {
    const doc = currentDoc();
    if (doc) usePhoto.getState().select(allSelection(doc.canvas));
  },
  /** ⌘D. */
  deselect() {
    usePhoto.getState().select(null);
  },
  /** ⇧⌘I: Select › Inverse. */
  inverse() {
    const doc = currentDoc();
    const s = currentSelection();
    if (!doc || !s) return;
    const inverse = invertSelection(s, doc.canvas);
    if (!inverse) toast("Everything was selected: its inverse is nothing.");
    usePhoto.getState().select(inverse);
  },
  /** Select › Modify › Feather (⇧F6), by `radius` pixels. */
  feather(radius: number) {
    const doc = currentDoc();
    const s = currentSelection();
    if (!doc || !s || !(radius > 0)) return;
    usePhoto.getState().select(featherSelection(s, radius, doc.canvas));
  },
};

// --- Quick Selection ---

/** A Quick Selection stroke (or several) in progress: its work at a sample's size, and what it began from. */
export interface QuickSession {
  q: QuickSelection;
  /** The selection when it began, at the sample's size (1 selected). */
  initial: Uint8Array;
  /** Sample pixels per document pixel. */
  scale: number;
  doc: PhotoProject;
  /** New mode: the strokes are the selection (else they add, or with `q.subtract` take away). */
  fresh: boolean;
}

/**
 * Starts Quick Selection on the open photo with a brush `radius` document pixels across: the sample it works on (the
 * photo reduced for a big brush: `quickLevel`) and the selection there at its size.
 */
export async function startQuickSelection(doc: PhotoProject, mode: SelectionMode, radius: number, sampleAll: boolean): Promise<QuickSession> {
  const layerId = sampledLayer(doc, sampleAll);
  const base = await photoSample(doc, layerId);
  const sample = await photoSample(doc, layerId, quickLevel(radius, base.scale));
  const { width, height, scale } = sample;
  const fresh = mode === "new";
  const before = fresh ? null : currentSelection();
  let initial: Uint8Array;
  if (!before) initial = new Uint8Array(width * height);
  else if (width === doc.canvas.width && height === doc.canvas.height) initial = coverageIn(before, { x: 0, y: 0, width, height });
  else initial = selectionAtSample((px, py) => pixelCoverage(before, px, py), width, height, scale);
  for (let i = 0; i < initial.length; i++) initial[i] = initial[i] >= 128 ? 1 : 0;
  return { q: new QuickSelection(sample, initial, mode === "subtract"), initial, scale, doc, fresh };
}

/**
 * What a Quick Selection session made of the selection: what its strokes changed (smoothed with Auto-Enhance) added
 * to the selection there, or taken out of it, or (New) the selection itself. Undefined when nothing changed.
 */
export function quickSelectionResult(session: QuickSession, autoEnhance: boolean): PhotoSelection | null | undefined {
  const { q, initial, scale, doc } = session;
  const selected = q.selected;
  const changed = new Uint8Array(selected.length);
  let any = false;
  for (let i = 0; i < changed.length; i++) {
    changed[i] = selected[i] !== initial[i] ? 1 : 0;
    any ||= changed[i] === 1;
  }
  if (!any) return undefined;
  const values = autoEnhance ? enhance(changed, q.width, q.height) : changed.map((v) => v * 255);
  const shape = coverageToSelection(values, q.width, q.height, scale, doc.canvas);
  return session.fresh ? shape : combineSelections(currentSelection(), shape, q.subtract ? "subtract" : "add");
}
