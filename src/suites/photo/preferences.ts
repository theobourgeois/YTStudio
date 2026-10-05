import { create } from "zustand";
import { CANVAS_PRESETS } from "@shared/photo/types";

/**
 * The photo editor's preferences, kept in this browser (Settings › Photo): the GPU memory its images may take, and
 * the size new photos start at.
 */
const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };

const BUDGET_KEY = "photo-gpu-budget-mb";
const PRESET_KEY = "photo-new-preset";

export const BUDGETS_MB = [1024, 2048, 4096] as const;

interface PhotoPreferences {
  budgetMB: number;
  presetId: string;
  setBudgetMB: (mb: number) => void;
  setPresetId: (id: string) => void;
}

const storedBudget = Number(storage.getItem(BUDGET_KEY));
const storedPreset = storage.getItem(PRESET_KEY);

export const usePhotoPreferences = create<PhotoPreferences>((set) => ({
  budgetMB: (BUDGETS_MB as readonly number[]).includes(storedBudget) ? storedBudget : 2048,
  presetId: CANVAS_PRESETS.some((p) => p.id === storedPreset) ? storedPreset! : CANVAS_PRESETS[0].id,
  setBudgetMB(budgetMB) {
    storage.setItem(BUDGET_KEY, String(budgetMB));
    set({ budgetMB });
  },
  setPresetId(presetId) {
    storage.setItem(PRESET_KEY, presetId);
    set({ presetId });
  },
}));

/** A new photo's choices (`ClientSuite.newProjectOptions`): its canvas size. */
export function newPhotoOptions() {
  const preset = CANVAS_PRESETS.find((p) => p.id === usePhotoPreferences.getState().presetId) ?? CANVAS_PRESETS[0];
  return { width: preset.width, height: preset.height };
}

export const budgetBytes = () => usePhotoPreferences.getState().budgetMB * 1024 ** 2;
