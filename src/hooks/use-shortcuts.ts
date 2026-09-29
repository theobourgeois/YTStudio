import { useEffect } from "react";
import { adjacentKeyframe } from "@shared/animation";
import { editPoints, getClip, projectDuration } from "@shared/timeline";
import { DEFAULT_TRANSITION } from "@shared/transitions";
import { deleteSelectedKeyframes } from "@/components/properties/keyframe-lanes";
import { useKeyframeSelection } from "@/components/properties/keyframe-selection";
import { retimableIds } from "@/components/timeline/speed-control";
import { timelineCommands } from "@/components/timeline/view-store";
import { useAssistant } from "@/stores/assistant";
import { useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { usePlayback } from "@/stores/playback";
import { useSourceMarks } from "@/stores/source-marks";
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
  "duplicate",
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

/** Performs the action; returns false when it didn't apply (so the event is left alone). */
function run(action: ShortcutAction): boolean {
  if (runSourcePreview(action)) return true;
  const editor = useEditor.getState();
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
      // Keyframes selected in the Effect Controls go first (like Premiere).
      if (action === "delete" && hasSelection && deleteSelectedKeyframes(editor.selectedClipIds.at(-1)!)) return true;
      if (!hasSelection && !hasGapOrTransition) return false;
      editor.deleteSelected(action === "rippleDelete");
      return true;
    case "cut":
      if (!hasSelection) return false;
      editor.cutSelected();
      return true;
    case "copy":
      if (!hasSelection) return false;
      editor.copySelected();
      return true;
    case "paste":
      if (editor.clipboard.length === 0) return false;
      editor.paste();
      return true;
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
      if (useLayout.getState().tool !== "select") {
        useLayout.getState().setTool("select");
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
      useSourceMarks.getState().mark(assetId, action === "markIn" ? "in" : "out", source.time(), source.duration());
      return true;
    case "goToIn":
    case "goToOut": {
      const marks = useSourceMarks.getState().marks[assetId];
      source.pause();
      source.seek(action === "goToIn" ? (marks?.in ?? 0) : (marks?.out ?? source.duration()));
      return true;
    }
    case "clearMarks":
      useSourceMarks.getState().clear(assetId);
      return true;
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
