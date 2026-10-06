import { create } from "zustand";
import { CANVAS_PRESETS } from "@shared/photo/types";

/**
 * The photo editor's preferences, kept in this browser (Settings › Photo): the GPU memory its images may take, the
 * size new photos start at, whether the Move tool picks the layer clicked (Photoshop's Auto-Select) and whether
 * moving and resizing snap to the canvas and other layers (View › Snap).
 */
const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };

const BUDGET_KEY = "photo-gpu-budget-mb";
const PRESET_KEY = "photo-new-preset";
const AUTO_SELECT_KEY = "photo-auto-select";
const SNAP_KEY = "photo-snap";

export const BUDGETS_MB = [1024, 2048, 4096] as const;

interface PhotoPreferences {
  budgetMB: number;
  presetId: string;
  /** Move picks the layer under the pointer (⌘ held does the opposite for one click). On unless turned off. */
  autoSelect: boolean;
  /** Moving and resizing snap to the canvas's edges and centre and other layers' (Control held: not). */
  snap: boolean;
  setBudgetMB: (mb: number) => void;
  setPresetId: (id: string) => void;
  setAutoSelect: (on: boolean) => void;
  setSnap: (on: boolean) => void;
}

const storedBudget = Number(storage.getItem(BUDGET_KEY));
const storedPreset = storage.getItem(PRESET_KEY);

export const usePhotoPreferences = create<PhotoPreferences>((set) => ({
  budgetMB: (BUDGETS_MB as readonly number[]).includes(storedBudget) ? storedBudget : 2048,
  presetId: CANVAS_PRESETS.some((p) => p.id === storedPreset) ? storedPreset! : CANVAS_PRESETS[0].id,
  autoSelect: storage.getItem(AUTO_SELECT_KEY) !== "off",
  snap: storage.getItem(SNAP_KEY) !== "off",
  setBudgetMB(budgetMB) {
    storage.setItem(BUDGET_KEY, String(budgetMB));
    set({ budgetMB });
  },
  setPresetId(presetId) {
    storage.setItem(PRESET_KEY, presetId);
    set({ presetId });
  },
  setAutoSelect(autoSelect) {
    storage.setItem(AUTO_SELECT_KEY, autoSelect ? "on" : "off");
    set({ autoSelect });
  },
  setSnap(snap) {
    storage.setItem(SNAP_KEY, snap ? "on" : "off");
    set({ snap });
  },
}));

/** A new photo's choices (`ClientSuite.newProjectOptions`): its canvas size. */
export function newPhotoOptions() {
  const preset = CANVAS_PRESETS.find((p) => p.id === usePhotoPreferences.getState().presetId) ?? CANVAS_PRESETS[0];
  return { width: preset.width, height: preset.height };
}

export const budgetBytes = () => usePhotoPreferences.getState().budgetMB * 1024 ** 2;
