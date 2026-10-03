import { create } from "zustand";
import { useMusicWindows } from "../ui";

/**
 * The Modulators window (`docs/sidechain.md`): whether it's open and which modulator it shows; and each
 * modulator's level as the engine last said it (`EngineTransport.modulators`), which linked controls show.
 * Not the song's.
 */
interface ModulationUi {
  open: boolean;
  /** The modulator shown, or null for the first. */
  selected: string | null;
  /** Each modulator's level now (0..1), by id. */
  levels: Record<string, number>;
  show: (id?: string | null) => void;
  close: () => void;
  select: (id: string | null) => void;
}

export const useModulationUi = create<ModulationUi>((set) => ({
  open: false,
  selected: null,
  levels: {},
  show: (id) => {
    set((s) => ({ open: true, selected: id === undefined ? s.selected : id }));
    // In front, if it was open behind another.
    useMusicWindows.getState().focus("modulators");
  },
  close: () => set({ open: false }),
  select: (selected) => set({ selected }),
}));

const NO_LEVELS: Record<string, number> = {};

/** The levels from a transport event: kept only when they've changed (so linked knobs render only then). */
export function takeModulatorLevels(levels: Record<string, number> | undefined) {
  const next = levels ?? NO_LEVELS;
  const now = useModulationUi.getState().levels;
  const keys = Object.keys(next);
  if (keys.length === Object.keys(now).length && keys.every((k) => Math.abs(next[k] - (now[k] ?? -1)) < 1e-3)) return;
  useModulationUi.setState({ levels: next });
}
