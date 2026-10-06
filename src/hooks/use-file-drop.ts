import { useEffect, useRef, useState, type DragEvent } from "react";
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

/**
 * Whether OS files are being dragged anywhere over the page. A desktop title bar is a window drag region, which
 * gets no drag-and-drop events, so a drop zone in one turns that off while this is true.
 */
export function useFilesDragged(): boolean {
  const [dragged, setDragged] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e: globalThis.DragEvent) => {
      if (!e.dataTransfer || dragKind(e.dataTransfer) !== "files") return;
      depth++;
      setDragged(true);
    };
    const leave = (e: globalThis.DragEvent) => {
      if (!e.dataTransfer || dragKind(e.dataTransfer) !== "files") return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragged(false);
    };
    const end = () => {
      depth = 0;
      setDragged(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", end);
      window.removeEventListener("dragend", end);
    };
  }, []);
  return dragged;
}
