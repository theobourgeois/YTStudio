import { useEffect } from "react";
import { adjacentKeyframe } from "@shared/animation";
import { editPoints, getClip, projectDuration } from "@shared/timeline";
import { DEFAULT_TRANSITION } from "@shared/transitions";
import { clearSourceMarks, makeSubclipFromMarks, markSource, shownMarks } from "@/components/preview/source-marking";
import { deleteSelectedKeyframes } from "@/components/properties/keyframe-lanes";
import { copySelectedKeyframes, easeSelectedKeyframes, pasteCopiedKeyframes, useKeyframeSelection } from "@/components/properties/keyframe-selection";
import { retimableIds } from "@/components/timeline/speed-control";
import { timelineCommands } from "@/components/timeline/view-store";
import { useAssistant } from "@/stores/assistant";
import { useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { addMarkerAtPlayhead, deleteMarkerAtPlayhead, goToMarker } from "@/stores/markers";
import { deleteSelectedVertices, usePathEditing } from "@/stores/path-editing";
import { usePlayback } from "@/stores/playback";
import { useSourcePreview } from "@/stores/source-preview";
import { resolveShortcut, type ShortcutAction } from "./shortcuts";

const ZOOM_STEP = 1.25;
const EPS = 1e-4;
/** Actions that edit the project or selection; ignored while a timeline drag/trim is in progress. */
const EDITS = new Set<ShortcutAction>([
  "split",
  "trimStart",
  "trimEnd",
  "delete",
  "rippleDelete",
  "cut",
  "copy",
  "paste",
  "copyEffects",
  "pasteEffects",
  "easyEase",
  "easyEaseIn",
  "easyEaseOut",
  "addMarker",
  "deleteMarker",
  "duplicate",
  "newAdjustmentLayer",
  "newSolid",
  "newCamera",
  "nest",
  "nudgeLeft",
  "nudgeRight",
  "nudgeLeftMore",
  "nudgeRightMore",
  "moveUp",
  "moveDown",
  "undo",
  "redo",
  "selectAll",
  "deselect",
  "addTransition",
  "speed",
]);

/** Global editor keyboard shortcuts (one window-level listener). */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (isEditableTarget(e.target) || isOverlayOpen()) return;
      const action = resolveShortcut(e);
      // preventDefault stops Space from clicking a focused button, arrows from scrolling, etc.
      if (action && run(action)) e.preventDefault();
    };
    // Escape leaves the source preview. It's caught before anything else sees it:
    // an open tooltip (or a popover still fading out) would otherwise swallow it.
    const onEscapeCapture = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || !useSourcePreview.getState().assetId) return;
      if (isEditableTarget(e.target) || isOverlayOpen()) return;
      useSourcePreview.getState().close();
      e.preventDefault(); // not also "deselect"
    };
    window.addEventListener("keydown", onEscapeCapture, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onEscapeCapture, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

/** Actions for the whole app; the others are the video editor's, and need a video open. */
const APP_ACTIONS = new Set<ShortcutAction>(["toggleSidebar", "toggleAssistant", "showShortcuts"]);

/** Performs the action; returns false when it didn't apply (so the event is left alone). */
function run(action: ShortcutAction): boolean {
  if (runSourcePreview(action)) return true;
  const editor = useEditor.getState();
  if (!editor.projectId && !APP_ACTIONS.has(action)) return false;
  // During a drag the timeline owns the keyboard (e.g. Escape cancels the gesture).
  if (editor.gestureBase && EDITS.has(action)) return false;
  const playback = usePlayback.getState();
  const seekTo = (time: number) => {
    playback.pause();
    playback.seek(time);
  };
  const step = (seconds: number) => seekTo(usePlayback.getState().time + seconds);
  const fps = editor.project.settings.fps;
  const stepFrame = (dir: 1 | -1) => seekTo((Math.round(usePlayback.getState().time * fps) + dir) / fps);
  const hasSelection = editor.selectedClipIds.length > 0;
  const hasGapOrTransition = editor.selectedGap !== null || editor.selectedTransition !== null;

  switch (action) {
    case "toggleSidebar":
      useLayout.getState().toggleSidebar();
      return true;
    case "toggleAssistant":
      useAssistant.getState().toggle();
      return true;
    case "showShortcuts":
      useLayout.getState().setShortcutsOpen(true);
      return true;
    case "togglePlay":
      playback.toggle();
      return true;
    case "play":
      if (!playback.playing) playback.toggle();
      return true;
    case "pause":
      playback.pause();
      return true;
    case "prevFrame":
      stepFrame(-1);
      return true;
    case "nextFrame":
      stepFrame(1);
      return true;
    case "back1s":
      step(-1);
      return true;
    case "forward1s":
      step(1);
      return true;
    case "prevEdit":
    case "nextEdit": {
      const t = playback.time;
      const points = [...editPoints(editor.project), projectDuration(editor.project)];
      const target =
        action === "prevEdit"
          ? Math.max(0, ...points.filter((p) => p < t - EPS))
          : Math.min(...points.filter((p) => p > t + EPS));
      if (Number.isFinite(target)) seekTo(target);
      return true;
    }
    case "prevKeyframe":
    case "nextKeyframe": {
      const clip = getClip(editor.project, editor.selectedClipIds.at(-1) ?? "");
      const target = clip && adjacentKeyframe(clip, playback.time, action === "prevKeyframe" ? -1 : 1, fps);
      if (target === undefined || target === null) return false;
      seekTo(target);
      return true;
    }
    case "seekStart":
      playback.seek(0);
      return true;
    case "seekEnd":
      playback.seek(playback.duration);
      return true;
    // In/Out marks are only on media in the source preview (see `runSourcePreview`).
    case "markIn":
    case "markOut":
    case "goToIn":
    case "goToOut":
    case "clearMarks":
    case "makeSubclip":
      return false;
    case "split":
      editor.splitAtPlayhead();
      return true;
    case "trimStart":
      editor.trimToPlayhead("start");
      return true;
    case "trimEnd":
      editor.trimToPlayhead("end");
      return true;
    case "delete":
    case "rippleDelete":
      // A path's selected points go first, then keyframes selected in the Effect Controls (like Premiere).
      if (action === "delete" && deleteSelectedVertices()) return true;
      if (action === "delete" && hasSelection && deleteSelectedKeyframes(editor.selectedClipIds.at(-1)!)) return true;
      if (!hasSelection && !hasGapOrTransition) return false;
      // ⌫ follows Auto ripple; ⇧⌫ always ripples.
      editor.deleteSelected(action === "rippleDelete" ? true : undefined);
      return true;
    case "cut":
      if (!hasSelection) return false;
      editor.cutSelected();
      return true;
    case "copy":
      // Selected keyframes go first; copying clips afterwards makes ⌘V paste clips again.
      if (copySelectedKeyframes()) return true;
      if (!hasSelection) return false;
      useKeyframeSelection.getState().setClipboard(null);
      editor.copySelected();
      return true;
    case "paste":
      if (useKeyframeSelection.getState().clipboard) return pasteCopiedKeyframes();
      if (editor.clipboard.length === 0) return false;
      editor.paste();
      return true;
    case "addMarker":
      addMarkerAtPlayhead();
      return true;
    case "nextMarker":
      return goToMarker(1);
    case "prevMarker":
      return goToMarker(-1);
    case "deleteMarker":
      return deleteMarkerAtPlayhead();
    case "easyEase":
      return easeSelectedKeyframes("ease");
    case "easyEaseIn":
      return easeSelectedKeyframes("ease-in");
    case "easyEaseOut":
      return easeSelectedKeyframes("ease-out");
    case "copyEffects":
      if (!hasSelection) return false;
      editor.copyEffects();
      return true;
    case "pasteEffects":
      if (!hasSelection || !editor.effectsClipboard) return false;
      editor.pasteEffects();
      return true;
    case "duplicate":
      // Also keeps ⌘D from bookmarking the page.
      editor.duplicateSelected();
      return true;
    case "addTransition":
      editor.applyTransition(DEFAULT_TRANSITION);
      return true;
    case "newAdjustmentLayer":
      editor.addLayer("adjustment");
      useLayout.getState().setLeftPanel("properties");
      return true;
    case "newSolid":
      editor.addLayer("solid");
      useLayout.getState().setLeftPanel("properties");
      return true;
    case "newCamera":
      editor.addLayer("camera");
      useLayout.getState().setLeftPanel("properties");
      return true;
    case "nest":
      if (!editor.selectedClipIds.length) return false;
      editor.nestSelected();
      return true;
    case "speed":
      // Consumed either way, so ⌘R never reloads the editor.
      if (retimableIds(editor.project, editor.assets, editor.selectedClipIds).length) useLayout.getState().setSpeedOpen(true);
      return true;
    case "nudgeLeft":
    case "nudgeRight":
    case "nudgeLeftMore":
    case "nudgeRightMore": {
      if (!hasSelection) return false;
      const frames = action.endsWith("More") ? 10 : 1;
      editor.nudgeSelected(((action.startsWith("nudgeLeft") ? -1 : 1) * frames) / fps);
      return true;
    }
    case "moveUp":
    case "moveDown":
      if (!hasSelection) return false;
      editor.moveSelectedToTrack(action === "moveUp" ? -1 : 1);
      return true;
    case "undo":
      editor.undo();
      return true;
    case "redo":
      editor.redo();
      return true;
    case "selectAll":
      editor.selectAll();
      return true;
    case "deselect":
      // The pen stops drawing first, then the path stops showing its points.
      if (usePathEditing.getState().drawing) {
        usePathEditing.getState().finishDrawing();
        return true;
      }
      if (useLayout.getState().tool !== "select") {
        useLayout.getState().setTool("select");
        return true;
      }
      if (usePathEditing.getState().target) {
        usePathEditing.getState().edit(null);
        return true;
      }
      if (useKeyframeSelection.getState().refs.length) {
        useKeyframeSelection.getState().clear();
        return true;
      }
      if (!hasSelection && !hasGapOrTransition) return false;
      editor.select(null);
      return true;
    case "zoomIn":
      timelineCommands.zoomBy(ZOOM_STEP);
      return true;
    case "zoomOut":
      timelineCommands.zoomBy(1 / ZOOM_STEP);
      return true;
    case "zoomFit":
      timelineCommands.zoomToFit();
      return true;
    case "toggleSnapping":
      editor.toggleSnapping();
      return true;
    case "selectTool":
      useLayout.getState().setTool("select");
      return true;
    case "textTool":
      useLayout.getState().setTool("text");
      return true;
    case "penTool":
      useLayout.getState().setTool("pen");
      return true;
    case "rectangleTool":
      useLayout.getState().setTool("rectangle");
      return true;
    case "ellipseTool":
      useLayout.getState().setTool("ellipse");
      return true;
  }
}

/** While a library file is being previewed, the transport keys drive it (Escape is handled up front). */
function runSourcePreview(action: ShortcutAction): boolean {
  const { assetId, controller: source } = useSourcePreview.getState();
  if (!assetId || !source) return false;
  const frame = 1 / useEditor.getState().project.settings.fps;
  switch (action) {
    case "togglePlay":
      source.toggle();
      return true;
    case "play":
      source.play();
      return true;
    case "pause":
      source.pause();
      return true;
    case "prevFrame":
      source.step(-frame);
      return true;
    case "nextFrame":
      source.step(frame);
      return true;
    case "back1s":
      source.step(-1);
      return true;
    case "forward1s":
      source.step(1);
      return true;
    case "seekStart":
      source.seek(0);
      return true;
    case "seekEnd":
      source.seek(source.duration());
      return true;
    case "markIn":
    case "markOut":
      markSource(assetId, action === "markIn" ? "in" : "out", source.time(), source.duration());
      return true;
    case "goToIn":
    case "goToOut": {
      const marks = shownMarks(assetId);
      source.pause();
      source.seek(action === "goToIn" ? (marks.in ?? 0) : (marks.out ?? source.duration()));
      return true;
    }
    case "clearMarks":
      return clearSourceMarks(assetId);
    case "makeSubclip":
      return makeSubclipFromMarks();
  }
  return false;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select") !== null;
}

/** Dialogs and open menus own the keyboard (ones playing their close animation don't). */
function isOverlayOpen(): boolean {
  return (
    document.querySelector(":is([role=dialog], [role=alertdialog], [role=menu]):not([data-state=closed])") !== null
  );
}
