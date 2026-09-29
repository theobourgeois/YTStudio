import { create } from "zustand";

const SIDEBAR_KEY = "editor-sidebar-open";
const KEYFRAMES_KEY = "editor-keyframes-open";
const PANEL_WIDTHS_KEY = "editor-left-panel-widths";

/**
 * Which width the left panel is at: its usual one, or the wider one it takes while a clip's
 * properties show their keyframe lanes (Premiere's Effect Controls timeline needs the room).
 */
export type PanelWidthMode = "normal" | "lanes";

export const DEFAULT_PANEL_WIDTHS: Record<PanelWidthMode, number> = { normal: 344, lanes: 688 };
/** The narrowest each can be dragged to (the lanes need some room beside the properties' own column). */
export const MIN_PANEL_WIDTHS: Record<PanelWidthMode, number> = { normal: 280, lanes: 520 };
export const MAX_PANEL_WIDTH = 960;

function storedPanelWidths(): Record<PanelWidthMode, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(PANEL_WIDTHS_KEY) ?? "null") as Partial<Record<PanelWidthMode, unknown>> | null;
    const width = (mode: PanelWidthMode) => {
      const w = raw?.[mode];
      return typeof w === "number" && Number.isFinite(w) ? w : DEFAULT_PANEL_WIDTHS[mode];
    };
    return { normal: width("normal"), lanes: width("lanes") };
  } catch {
    return { ...DEFAULT_PANEL_WIDTHS };
  }
}

/**
 * The tabs of the left panel: media (from `MediaSource`), effects (of an `EffectKind`), captions, and the
 * selection's properties.
 */
export type LeftPanelTab = "media" | "effects" | "captions" | "properties";

/**
 * Where the Media tab's files come from: this video's own media, the Library shared by every
 * video, or online. One tab with a switch, like CapCut's Media panel, so the tab strip stays short.
 */
export type MediaSource = "project" | "library" | "online";

/**
 * What the Effects tab browses: video effects (added to clips) or transitions (put on cuts). Like
 * Premiere's Effects panel, every kind lives in one tab with a switch, rather than a tab each.
 */
export type EffectKind = "video" | "transitions";

/** What a press on the canvas does: select and transform clips, or add text (Premiere's Type tool). */
export type CanvasTool = "select" | "text";

interface LayoutState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  /** The keyboard shortcuts dialog. */
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  /** The timeline toolbar's Speed popover (⌘R, like Premiere's Speed/Duration). */
  speedOpen: boolean;
  setSpeedOpen: (open: boolean) => void;
  leftPanel: LeftPanelTab;
  setLeftPanel: (panel: LeftPanelTab) => void;
  mediaSource: MediaSource;
  /** Shows the Media tab on this source. */
  showMedia: (source: MediaSource) => void;
  effectKind: EffectKind;
  /** Shows the Effects tab on this kind. */
  showEffects: (kind: EffectKind) => void;
  tool: CanvasTool;
  setTool: (tool: CanvasTool) => void;
  /** The Properties tab shows keyframe lanes next to the values (Premiere's Effect Controls timeline). */
  keyframesOpen: boolean;
  toggleKeyframes: () => void;
  /** The left panel's widths in px, as dragged (the panel keeps them inside the window). */
  panelWidths: Record<PanelWidthMode, number>;
  /** Set one of them (clamped); `save` remembers it for next time (at the end of a drag). */
  setPanelWidth: (mode: PanelWidthMode, width: number, save?: boolean) => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  sidebarOpen: localStorage.getItem(SIDEBAR_KEY) !== "false",
  toggleSidebar() {
    const sidebarOpen = !get().sidebarOpen;
    localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen));
    set({ sidebarOpen });
  },
  shortcutsOpen: false,
  setShortcutsOpen(shortcutsOpen) {
    set({ shortcutsOpen });
  },
  speedOpen: false,
  setSpeedOpen(speedOpen) {
    set({ speedOpen });
  },
  leftPanel: "media",
  setLeftPanel(leftPanel) {
    set({ leftPanel });
  },
  mediaSource: "project",
  showMedia(mediaSource) {
    set({ leftPanel: "media", mediaSource });
  },
  effectKind: "video",
  showEffects(effectKind) {
    set({ leftPanel: "effects", effectKind });
  },
  tool: "select",
  setTool(tool) {
    set({ tool });
  },
  keyframesOpen: localStorage.getItem(KEYFRAMES_KEY) === "true",
  toggleKeyframes() {
    const keyframesOpen = !get().keyframesOpen;
    localStorage.setItem(KEYFRAMES_KEY, String(keyframesOpen));
    set({ keyframesOpen });
  },
  panelWidths: storedPanelWidths(),
  setPanelWidth(mode, width, save = false) {
    const clamped = Math.round(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTHS[mode], width)));
    const panelWidths = { ...get().panelWidths, [mode]: clamped };
    if (clamped !== get().panelWidths[mode]) set({ panelWidths });
    if (save) localStorage.setItem(PANEL_WIDTHS_KEY, JSON.stringify(panelWidths));
  },
}));
