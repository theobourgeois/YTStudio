import { useRef, useState, type DragEvent } from "react";
import { dragKind } from "@/lib/dnd";

/**
 * Turns an element into a drop zone for OS files (internal asset drags are
 * ignored). `onFiles` also gets the drop event, to read dropped folders.
 * `active` is true while files are dragged over it; an enter/leave counter
 * keeps it from flickering when the pointer crosses child elements.
 */
export function useFileDrop(onFiles: (files: File[], e: DragEvent) => void) {
  const depth = useRef(0);
  const [active, setActive] = useState(false);
  const isFileDrag = (e: DragEvent) => dragKind(e.dataTransfer) === "files";

  const handlers = {
    onDragEnter(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth.current++;
      setActive(true);
    },
    onDragOver(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave(e: DragEvent) {
      if (!isFileDrag(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    },
    onDrop(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      onFiles(Array.from(e.dataTransfer.files), e);
    },
  };

  return { active, handlers };
}
