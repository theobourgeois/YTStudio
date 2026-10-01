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

/**
 * Three columns over the timeline: what's being added on the left (as tabs, `left` in front), the
 * monitor, then the properties of what's selected; `widths` in proportion.
 */
function threeColumns(left: VideoPanel[], widths: [number, number, number]): DockLayout<VideoPanel> {
  return {
    root: {
      type: "split",
      id: "columns",
      direction: "column",
      sizes: [625, 435],
      children: [
        {
          type: "split",
          id: "columns-top",
          direction: "row",
          sizes: widths,
          children: [group("browse", left), group("monitor", ["program"]), group("inspect", ["properties"])],
        },
        group("timeline", ["timeline"]),
      ],
    },
    floating: [],
  };
}

/** The default (Théo's): Media, Effects and Captions on the left, the monitor, Properties on the right. */
export const editingLayout = () => threeColumns(["media", "effects", "captions"], [370, 1175, 445]);

/** Every tab beside the monitor (Properties too), the timeline below: the most room for the monitor's width. */
function compactLayout(): DockLayout<VideoPanel> {
  return {
    root: {
      type: "split",
      id: "compact",
      direction: "column",
      sizes: [548, 300],
      children: [
        {
          type: "split",
          id: "compact-top",
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

/** Ready-made layouts (Premiere's workspaces), in each panel's menu. */
export const VIDEO_WORKSPACES = [
  { name: "Editing", layout: editingLayout },
  // The captions in front, with room for their transcript.
  { name: "Captions", layout: () => threeColumns(["captions", "media", "effects"], [480, 1065, 445]) },
  // Effects to drag from, and the clip's properties wide enough for their keyframes.
  { name: "Effects", layout: () => threeColumns(["effects", "media", "captions"], [370, 1035, 585]) },
  { name: "Compact", layout: compactLayout },
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
