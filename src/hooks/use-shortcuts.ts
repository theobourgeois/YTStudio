import { useEffect } from "react";
import { useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { usePlayback } from "@/stores/playback";
import { resolveShortcut, type ShortcutAction } from "./shortcuts";

const ZOOM_STEP = 1.25;
/** Actions that edit the project; ignored while a timeline drag/trim is in progress. */
const EDITS = new Set<ShortcutAction>(["split", "delete", "undo", "redo", "deselect"]);

/** Global editor keyboard shortcuts (one window-level listener). */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (isEditableTarget(e.target) || isModalOpen()) return;
      const action = resolveShortcut(e);
      // preventDefault stops Space from clicking a focused button, arrows from scrolling, etc.
      if (action && run(action)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Performs the action; returns false when it didn't apply (so the event is left alone). */
function run(action: ShortcutAction): boolean {
  const editor = useEditor.getState();
  // During a drag the timeline owns the keyboard (e.g. Escape cancels the gesture).
  if (editor.gestureBase && EDITS.has(action)) return false;
  const playback = usePlayback.getState();
  const step = (seconds: number) => {
    playback.pause();
    playback.seek(usePlayback.getState().time + seconds);
  };
  const stepFrame = (dir: 1 | -1) => {
    const fps = editor.project.settings.fps;
    playback.pause();
    playback.seek((Math.round(usePlayback.getState().time * fps) + dir) / fps);
  };

  switch (action) {
    case "toggleSidebar":
      useLayout.getState().toggleSidebar();
      return true;
    case "togglePlay":
      playback.toggle();
      return true;
    case "split":
      editor.splitAtPlayhead();
      return true;
    case "delete":
      editor.deleteSelected();
      return true;
    case "undo":
      editor.undo();
      return true;
    case "redo":
      editor.redo();
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
    case "seekStart":
      playback.seek(0);
      return true;
    case "seekEnd":
      playback.seek(playback.duration);
      return true;
    case "zoomIn":
      editor.setZoom(editor.zoom * ZOOM_STEP);
      return true;
    case "zoomOut":
      editor.setZoom(editor.zoom / ZOOM_STEP);
      return true;
    case "deselect":
      if (!editor.selectedClipId) return false;
      editor.select(null);
      return true;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select") !== null;
}

function isModalOpen(): boolean {
  return document.querySelector("[role=dialog], [role=alertdialog]") !== null;
}
