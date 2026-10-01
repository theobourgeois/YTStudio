import type { DockLayout } from "@/components/dock/model";
import { createDock } from "@/components/dock/store";
import { type EffectKind, type MediaSource, useLayout } from "./layout";
import { type VideoWindowId, useVideoWindows } from "./video-windows";

/**
 * The video editor's panels, docked as Premiere's are (`components/workspace/video-panels.tsx` draws
 * them): the media, the effects, the captions, the selection's properties, the Program monitor and the
 * timeline. They can be dragged into other groups or beside them, resized, and floated out as windows.
 */
export type VideoPanel = "media" | "effects" | "captions" | "properties" | "program" | "timeline";

export const VIDEO_PANELS: readonly VideoPanel[] = ["media", "effects", "captions", "properties", "program", "timeline"];

/** A floating panel's window, on the video editor's desktop. */
export const panelWindow = (panel: VideoPanel): VideoWindowId => `panel:${panel}`;

const group = (id: string, panels: VideoPanel[], active = panels[0]) => ({ type: "group" as const, id, panels, active });

/** The tabs beside the monitor, the timeline below: the editor as it's always been. */
export function editingLayout(): DockLayout<VideoPanel> {
  return {
    root: {
      type: "split",
      id: "editing",
      direction: "column",
      sizes: [548, 300],
      children: [
        {
          type: "split",
          id: "editing-top",
          direction: "row",
          sizes: [344, 856],
          children: [group("browse", ["media", "effects", "captions", "properties"]), group("monitor", ["program"])],
        },
        group("timeline", ["timeline"]),
      ],
    },
    floating: [],
  };
}

/** Three columns: what's being added on the left, the monitor, then the properties of what's selected. */
function threeColumns(left: VideoPanel[], right: VideoPanel): DockLayout<VideoPanel> {
  return {
    root: {
      type: "split",
      id: "columns",
      direction: "column",
      sizes: [548, 300],
      children: [
        {
          type: "split",
          id: "columns-top",
          direction: "row",
          sizes: [320, 560, 360],
          children: [group("left", left), group("monitor", ["program"]), group("right", [right])],
        },
        group("timeline", ["timeline"]),
      ],
    },
    floating: [],
  };
}

/** Ready-made layouts (Premiere's workspaces), in each panel's menu. */
export const VIDEO_WORKSPACES = [
  { name: "Editing", layout: editingLayout },
  // Captions on the left, a caption's own style on the right.
  { name: "Captions", layout: () => threeColumns(["captions", "media", "effects"], "properties") },
  // Effects to drag from, and the clip's properties (Effect Controls) to set them in.
  { name: "Effects", layout: () => threeColumns(["effects", "media", "captions"], "properties") },
];

export const useVideoDock = createDock<VideoPanel, VideoWindowId>({
  key: "editor-video-layout",
  panels: VIDEO_PANELS,
  initial: editingLayout,
  windows: useVideoWindows,
  windowId: panelWindow,
});

/** Bring a panel to the front, wherever it is (a tab, or a floating window). */
export const showPanel = (panel: VideoPanel) => useVideoDock.getState().show(panel);

/** Show the Media panel on this source. */
export function showMedia(source: MediaSource) {
  useLayout.getState().setMediaSource(source);
  showPanel("media");
}

/** Show the Effects panel on this kind. */
export function showEffects(kind: EffectKind) {
  useLayout.getState().setEffectKind(kind);
  showPanel("effects");
}
