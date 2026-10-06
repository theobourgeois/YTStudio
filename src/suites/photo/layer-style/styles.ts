/**
 * Styles (docs/photo/layer-style/README.md, phase L4): the built-in set and the user's own (New Style…), this
 * computer's, kept in localStorage as Make Default's defaults are. A user's style carries the photo's patterns it
 * reads as PNGs, so it brings them into any photo (`materialise`: made surfaces of that photo's, the same pixels the
 * same pattern). Applying one is an edit of the selected layers: replace, or with ⇧ add.
 */
import { create } from "zustand";
import { toast } from "sonner";
import { srgbToLinear } from "@shared/photo/colour";
import { createId } from "@shared/ids";
import { BUILT_IN_STYLES, type PresetPattern, type StylePreset, applyStylePreset, presetFrom, presetOwnPatterns, remapPresetPatterns } from "@shared/photo/style/presets";
import { patternFromLinear } from "@shared/photo/style/patterns";
import { withPatterns } from "@shared/photo/style/style";
import type { PhotoLayer, PhotoPattern, PhotoProject } from "@shared/photo/types";
import { usePhoto } from "../store";
import { readSurface, surfaceFromPixels } from "../surface-pixels";
import { uploadsFor } from "../uploads";

const KEY = "photo-style-presets";

function saved(): StylePreset[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.effects)) : [];
  } catch {
    return [];
  }
}

interface StylesState {
  /** The user's own, oldest first. */
  mine: StylePreset[];
  save: (preset: StylePreset) => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
}

export const useStyles = create<StylesState>((set, get) => {
  const write = (mine: StylePreset[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(mine));
    } catch {
      toast.error("Couldn't keep the style: this computer's storage for styles is full.");
    }
    set({ mine });
  };
  return {
    mine: saved(),
    save: (preset) => write([...get().mine.filter((p) => p.id !== preset.id), preset]),
    remove: (id) => write(get().mine.filter((p) => p.id !== id)),
    rename: (id, name) => write(get().mine.map((p) => (p.id === id && name.trim() ? { ...p, name: name.trim() } : p))),
  };
});

/** Every style: the built-in ones, then the user's. */
export const allStyles = (): StylePreset[] => [...BUILT_IN_STYLES, ...useStyles.getState().mine];

export const findStyle = (idOrName: string): StylePreset | undefined => {
  const all = allStyles();
  return all.find((p) => p.id === idOrName) ?? all.find((p) => p.name.toLowerCase() === idOrName.trim().toLowerCase());
};

/** A pattern of the photo's as a PNG to keep with a style. */
async function patternPng(pattern: PhotoPattern): Promise<PresetPattern> {
  const { projectId } = usePhoto.getState();
  const linear = await readSurface(uploadsFor(projectId!), pattern.surface, pattern.size.width, pattern.size.height);
  const encoded = patternFromLinear(pattern.size.width, pattern.size.height, linear);
  const canvas = new OffscreenCanvas(pattern.size.width, pattern.size.height);
  const image = new ImageData(pattern.size.width, pattern.size.height);
  for (let i = 0; i < pattern.size.width * pattern.size.height; i++) {
    const a = encoded.data[i * 4 + 3];
    for (let c = 0; c < 3; c++) image.data[i * 4 + c] = a > 0 ? Math.round((encoded.data[i * 4 + c] / a) * 255) : 0;
    image.data[i * 4 + 3] = Math.round(a * 255);
  }
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const png = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  return { id: pattern.id, name: pattern.name, width: pattern.size.width, height: pattern.size.height, png };
}

/**
 * New Style…: a layer's style (and, with `blending`, its Blending Options) kept as one of this computer's, named
 * `name`, with the photo's patterns it reads. Returns it.
 */
export async function newStyle(doc: PhotoProject, layer: PhotoLayer, name: string, blending: boolean, effects = true): Promise<StylePreset> {
  const preset = presetFrom(createId("style"), name, layer, blending, effects);
  const own = presetOwnPatterns(preset);
  const patterns = await Promise.all((doc.patterns ?? []).filter((p) => own.includes(p.id)).map(patternPng));
  const kept = patterns.length ? { ...preset, patterns } : preset;
  useStyles.getState().save(kept);
  return kept;
}

/** Made patterns of the open photo's, by preset (a style's patterns become surfaces once a photo). */
const made = new Map<string, Promise<PhotoPattern[]>>();

/** A style's own patterns made the open photo's surfaces (uploaded; nothing for a style without any). */
export function materialise(preset: StylePreset): Promise<PhotoPattern[]> {
  const { projectId } = usePhoto.getState();
  if (!preset.patterns?.length || !projectId) return Promise.resolve([]);
  const key = `${projectId}|${preset.id}`;
  let pending = made.get(key);
  if (!pending) {
    pending = Promise.all(
      preset.patterns.map(async (p): Promise<PhotoPattern> => {
        const bitmap = await createImageBitmap(await (await fetch(p.png)).blob());
        const canvas = new OffscreenCanvas(p.width, p.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        const rgba = ctx.getImageData(0, 0, p.width, p.height).data;
        const linear = new Float32Array(p.width * p.height * 4);
        for (let i = 0; i < p.width * p.height; i++) {
          const a = rgba[i * 4 + 3] / 255;
          for (let c = 0; c < 3; c++) linear[i * 4 + c] = srgbToLinear(rgba[i * 4 + c] / 255) * a;
          linear[i * 4 + 3] = a;
        }
        const surface = await surfaceFromPixels(uploadsFor(projectId), p.width, p.height, linear);
        return { id: p.id, name: p.name, surface, size: { width: p.width, height: p.height } };
      }),
    );
    pending.catch(() => made.delete(key));
    made.set(key, pending);
  }
  return pending;
}

/**
 * The edit that applies a style to layers (`add`: ⇧, its effects added to theirs), its patterns brought in first
 * (`patterns`: `materialise`'s). Pure, for a gesture's previews too.
 */
export const styleEdit = (preset: StylePreset, ids: readonly string[], add: boolean, patterns: readonly PhotoPattern[]) => (doc: PhotoProject) => {
  const brought = withPatterns(doc, patterns, () => createId("pat"));
  return applyStylePreset(brought.doc, ids, remapPresetPatterns(preset, brought.ids), add);
};

/** Applies a style to layers: one undo step. */
export async function applyStyle(preset: StylePreset, ids: readonly string[], add: boolean) {
  if (!ids.length) return;
  let patterns: PhotoPattern[];
  try {
    patterns = await materialise(preset);
  } catch (error) {
    return void toast.error(`Couldn't bring "${preset.name}"'s patterns`, { description: error instanceof Error ? error.message : String(error) });
  }
  usePhoto.getState().commit(styleEdit(preset, ids, add, patterns));
}

