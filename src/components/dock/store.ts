import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { WindowsStore } from "@/components/windows/store";
import { type DockLayout, type DropZone, dockPanel, floatPanel, movePanel, normalizeLayout, setSizes, showPanel } from "./model";

/**
 * A docked layout and its edits (`dock-area.tsx` draws it), remembered in localStorage under its key so
 * it's the same in every project, as a Premiere workspace is. None of it is undone: it's how the editor
 * is laid out, not the work.
 */
export interface DockState<P extends string = string> {
  layout: DockLayout<P>;
  /** Bring a panel to the front: its tab, or its window if it's floating. */
  show: (panel: P) => void;
  move: (panel: P, groupId: string, zone: DropZone, index?: number) => void;
  float: (panel: P) => void;
  dock: (panel: P) => void;
  /** A split's weights; `save` remembers them (at the end of a drag; not on each move). */
  resize: (splitId: string, sizes: number[], save?: boolean) => void;
  /** Another whole layout (a workspace preset, or the default). */
  reset: (layout?: DockLayout<P>) => void;
}

export type DockStore<P extends string = string> = UseBoundStore<StoreApi<DockState<P>>>;

interface DockOptions<P extends string, W extends string> {
  /** Where it's remembered. */
  key: string;
  /** Every panel there is (each is somewhere in the layout, exactly once). */
  panels: readonly P[];
  /** The layout it starts with, and `reset` goes back to. */
  initial: () => DockLayout<P>;
  /** The windows floating panels are on (to bring one forward when it's shown). */
  windows: WindowsStore<W>;
  /** A floating panel's window id. */
  windowId: (panel: P) => W;
  /** Where a panel added since a layout was saved goes: beside this panel (`normalizeLayout`). */
  homes?: Partial<Record<P, P>>;
}

export function createDock<P extends string, W extends string>({ key, panels, initial, windows, windowId, homes }: DockOptions<P, W>): DockStore<P> {
  const load = (): DockLayout<P> => {
    try {
      return normalizeLayout(JSON.parse(localStorage.getItem(key) ?? "null"), panels, initial(), homes);
    } catch {
      return initial();
    }
  };
  const save = (layout: DockLayout<P>) => {
    try {
      localStorage.setItem(key, JSON.stringify(layout));
    } catch {
      // Private mode or full: the layout lasts this session.
    }
  };

  return create<DockState<P>>((set, get) => {
    const apply = (edit: (layout: DockLayout<P>) => DockLayout<P>, remember = true) => {
      const layout = edit(get().layout);
      if (layout === get().layout) return;
      set({ layout });
      if (remember) save(layout);
    };
    return {
      layout: load(),
      show(panel) {
        if (get().layout.floating.some((f) => f.panel === panel)) windows.getState().focus(windowId(panel));
        // Which tab shows isn't worth remembering on every click; it is with the next real change.
        else apply((l) => showPanel(l, panel), false);
      },
      move: (panel, groupId, zone, index) => apply((l) => movePanel(l, panel, groupId, zone, index)),
      float(panel) {
        windows.getState().focus(windowId(panel));
        apply((l) => floatPanel(l, panel));
      },
      dock: (panel) => apply((l) => dockPanel(l, panel)),
      resize: (splitId, sizes, remember = false) => {
        apply((l) => setSizes(l, splitId, sizes), remember);
        if (remember) save(get().layout);
      },
      reset(layout = initial()) {
        set({ layout });
        save(layout);
      },
    };
  });
}
