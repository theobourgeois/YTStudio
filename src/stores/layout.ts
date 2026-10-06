import { create } from "zustand";

const KEYFRAMES_KEY = "editor-keyframes-open";

/**
 * Where the Media tab's files come from: this video's own media, or the Library shared by every
 * video. One tab with a switch, like CapCut's Media panel (online media is a panel of its own).
 */
export type MediaSource = "project" | "library";

/**
 * What the Effects tab browses: video effects (added to clips), presets (ready-made moves, looks
 * and adjustment-layer transitions, like After Effects' Animation Presets) or transitions (put on
 * cuts). Like Premiere's Effects panel, every kind lives in one tab with a switch, rather than a tab each.
 */
export type EffectKind = "video" | "presets" | "transitions";

/**
 * What a press on the canvas does: select and transform clips, add text (Premiere's Type
 * tool), or draw a path: a mask on the selected clip, else a shape (the Pen, Rectangle and
 * Ellipse tools).
 */
export type CanvasTool = "select" | "text" | "pen" | "rectangle" | "ellipse";

interface LayoutState {
  /** The keyboard shortcuts dialog. */
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  /** The New project picker (which suite to make a project in). */
  newProjectOpen: boolean;
  setNewProjectOpen: (open: boolean) => void;
  /** ⌘P's project search. */
  projectSearchOpen: boolean;
  setProjectSearchOpen: (open: boolean) => void;
  /** The timeline toolbar's Speed popover (⌘R, like Premiere's Speed/Duration). */
  speedOpen: boolean;
  setSpeedOpen: (open: boolean) => void;
  /** The Media panel's source (`showMedia` in `stores/video-dock.ts` also brings the panel forward). */
  mediaSource: MediaSource;
  setMediaSource: (source: MediaSource) => void;
  /** The Effects panel's kind (`showEffects` also brings it forward). */
  effectKind: EffectKind;
  setEffectKind: (kind: EffectKind) => void;
  tool: CanvasTool;
  setTool: (tool: CanvasTool) => void;
  /** The Program monitor draws at this fraction of its pixels (Premiere's Playback Resolution): 1, 0.5 or 0.25. */
  previewResolution: number;
  setPreviewResolution: (resolution: number) => void;
  /** The Properties tab shows keyframe lanes next to the values (Premiere's Effect Controls timeline). */
  keyframesOpen: boolean;
  toggleKeyframes: () => void;
  /**
   * Properties whose graph editor is open under their keyframe lane (by `graphId`), and
   * which graph each shows: the value, or the speed (After Effects' Value and Speed Graphs).
   */
  graphs: Record<string, GraphMode>;
  /** Open a property's graph (in `mode`) or, with null, close it. */
  setGraph: (id: string, mode: GraphMode | null) => void;
}

const RESOLUTION_KEY = "editor-preview-resolution";
/** The preview resolutions offered: full, half and quarter. */
export const PREVIEW_RESOLUTIONS = [1, 0.5, 0.25] as const;
/** How each preview resolution is named (the Program monitor's picker, Settings). */
export const PREVIEW_RESOLUTION_LABELS: Record<number, string> = { 1: "Full", 0.5: "1/2", 0.25: "1/4" };
function storedResolution(): number {
  const stored = Number(localStorage.getItem(RESOLUTION_KEY));
  return (PREVIEW_RESOLUTIONS as readonly number[]).includes(stored) ? stored : 1;
}

/** What a property's graph editor shows. */
export type GraphMode = "value" | "speed";

/** A property's graph editor, by effect type (so it stays open from clip to clip) and parameter. */
export const graphId = (effectType: string, key: string) => `${effectType}:${key}`;

export const useLayout = create<LayoutState>((set, get) => ({
  shortcutsOpen: false,
  setShortcutsOpen(shortcutsOpen) {
    set({ shortcutsOpen });
  },
  newProjectOpen: false,
  setNewProjectOpen(newProjectOpen) {
    // One palette at a time.
    set(newProjectOpen ? { newProjectOpen, projectSearchOpen: false } : { newProjectOpen });
  },
  projectSearchOpen: false,
  setProjectSearchOpen(projectSearchOpen) {
    set(projectSearchOpen ? { projectSearchOpen, newProjectOpen: false } : { projectSearchOpen });
  },
  speedOpen: false,
  setSpeedOpen(speedOpen) {
    set({ speedOpen });
  },
  mediaSource: "project",
  setMediaSource(mediaSource) {
    set({ mediaSource });
  },
  effectKind: "video",
  setEffectKind(effectKind) {
    set({ effectKind });
  },
  tool: "select",
  setTool(tool) {
    set({ tool });
  },
  previewResolution: storedResolution(),
  setPreviewResolution(previewResolution) {
    localStorage.setItem(RESOLUTION_KEY, String(previewResolution));
    set({ previewResolution });
  },
  keyframesOpen: localStorage.getItem(KEYFRAMES_KEY) === "true",
  toggleKeyframes() {
    const keyframesOpen = !get().keyframesOpen;
    localStorage.setItem(KEYFRAMES_KEY, String(keyframesOpen));
    set({ keyframesOpen });
  },
  graphs: {},
  setGraph(id, mode) {
    const { [id]: _, ...rest } = get().graphs;
    set({ graphs: mode ? { ...rest, [id]: mode } : rest });
  },
}));
