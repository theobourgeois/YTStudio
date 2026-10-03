import { useEffect } from "react";
import { addWindowListener } from "@/lib/window-events";

/**
 * Dropping a file anywhere that isn't a real drop target would make the
 * browser navigate away to open it. Real drop targets call `preventDefault`
 * themselves, so only unhandled file drags are neutralised here (in the
 * editor's native windows too).
 */
export function usePreventFileNavigation() {
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      if (e.type === "dragover") e.dataTransfer.dropEffect = "none";
    };
    const stops = [addWindowListener("dragover", guard), addWindowListener("drop", guard)];
    return () => {
      for (const stop of stops) stop();
    };
  }, []);
}
