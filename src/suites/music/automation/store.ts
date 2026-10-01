import { create } from "zustand";
import type { PluginParameter } from "@shared/music/engine";
import { useMusic } from "../store";

/**
 * What the music editor knows of automation that isn't the song (`docs/fl-studio/automation.md`): which
 * automation clips' windows are open, the plugin parameter last touched in a plugin's window (what
 * Automate offers), the controls held by the hand (their automation lets go of them meanwhile), and
 * whether the Automate window (every control, to pick one) is open.
 */
interface AutomationUiState {
  /** The automation clips whose settings windows are open. */
  openIds: string[];
  /** The plugin parameter last touched in a plugin's window, as the engine said. */
  touched: PluginParameter | null;
  /** The controls being held by the hand, by `targetKey`: sent to the engine, which leaves their automation out meanwhile. */
  held: ReadonlySet<string>;
  /** The Automate window: every control of the song, to make an automation clip of one. */
  chooserOpen: boolean;

  hold: (key: string) => void;
  release: (key: string) => void;
}

const NONE: ReadonlySet<string> = new Set();

export const useAutomationUi = create<AutomationUiState>((set, get) => ({
  openIds: [],
  touched: null,
  held: NONE,
  chooserOpen: false,
  hold(key) {
    if (!get().held.has(key)) set({ held: new Set([...get().held, key]) });
  },
  release(key) {
    if (!get().held.has(key)) return;
    const held = new Set(get().held);
    held.delete(key);
    set({ held: held.size ? held : NONE });
  },
}));

// Another song: its own windows (what was touched in a plugin is the last song's).
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useAutomationUi.setState({ openIds: [], touched: null, held: NONE, chooserOpen: false });
});
