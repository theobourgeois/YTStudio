import { useEffect } from "react";

/**
 * Dropping a file anywhere that isn't a real drop target would make the
 * browser navigate away to open it. Real drop targets call `preventDefault`
 * themselves, so only unhandled file drags are neutralised here.
 */
export function usePreventFileNavigation() {
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      if (e.type === "dragover") e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);
}
